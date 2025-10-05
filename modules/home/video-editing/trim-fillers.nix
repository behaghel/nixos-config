{ pkgs, ffmpeg, pythonEnv, cfg }:
let
  fillerWordsJson = builtins.toJSON cfg.fillerWords;
  defaultModel = cfg.fillerModel;
  defaultLanguage = cfg.language;
  defaultPad = builtins.toString cfg.fillerPad;
in
pkgs.writeScriptBin "video-trim-fillers" ''
#!${pythonEnv}/bin/python3
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Iterable, List, Sequence, Tuple

from faster_whisper import WhisperModel

FFMPEG = "${ffmpeg}/bin/ffmpeg"
FFPROBE = "${ffmpeg}/bin/ffprobe"

DEFAULT_FILLERS = ${fillerWordsJson}
DEFAULT_MODEL = "${defaultModel}"
DEFAULT_LANGUAGE = "${defaultLanguage}"
DEFAULT_PAD = ${defaultPad}

_WORD_RE = re.compile(r"[^a-z0-9']+")


def _normalise(word: str) -> str:
    return _WORD_RE.sub("", word.lower())


def _has_video(path: Path) -> bool:
    proc = subprocess.run(
        [FFPROBE, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=index", "-of", "csv=p=0", str(path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    return bool(proc.stdout.strip())


def _merge_ranges(ranges: Sequence[Tuple[float, float]]) -> List[Tuple[float, float]]:
    if not ranges:
        return []
    merged: List[Tuple[float, float]] = []
    current_start, current_end = ranges[0]
    for start, end in ranges[1:]:
        if start <= current_end:
            current_end = max(current_end, end)
        else:
            merged.append((current_start, current_end))
            current_start, current_end = start, end
    merged.append((current_start, current_end))
    return merged


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Transcribe audio, remove filler words, and render a trimmed media file.",
    )
    parser.add_argument("input", type=Path, help="Input audio/video file")
    parser.add_argument("output", type=Path, help="Output file path")
    parser.add_argument(
        "--model",
        default=os.environ.get("VIDEO_FILLER_MODEL", DEFAULT_MODEL),
        help="faster-whisper model name or path",
    )
    parser.add_argument(
        "--language",
        default=os.environ.get("VIDEO_FILLER_LANG", DEFAULT_LANGUAGE),
        help="Language hint for transcription",
    )
    parser.add_argument(
        "--pad",
        type=float,
        default=DEFAULT_PAD,
        help="Seconds to pad before/after each filler word",
    )
    parser.add_argument(
        "--filler",
        action="append",
        default=None,
        help="Additional filler word to remove (repeatable)",
    )
    parser.add_argument(
        "--video-codec",
        default="libx264",
        help="Video codec to use when re-encoding",
    )
    parser.add_argument(
        "--audio-codec",
        default="aac",
        help="Audio codec to use when re-encoding",
    )
    parser.add_argument(
        "--list-fillers",
        action="store_true",
        help="Print the filler list and exit",
    )
    parser.add_argument(
        "--save-ranges",
        type=Path,
        default=None,
        help="Write JSON information about removed ranges",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.list_fillers:
        fillers = sorted({w.lower() for w in DEFAULT_FILLERS})
        if args.filler:
            fillers.extend([w.lower() for w in args.filler])
        for filler in sorted(set(fillers)):
            print(filler)
        return 0

    if not args.input.exists():
        parser.error(f"input file '{args.input}' does not exist")

    fillers = [w.lower() for w in DEFAULT_FILLERS]
    if args.filler:
        fillers.extend([w.lower() for w in args.filler])
    filler_set = {_normalise(w) for w in fillers if _normalise(w)}

    with tempfile.TemporaryDirectory() as td:
        audio_path = Path(td) / "audio.wav"
        extract_cmd = [
            FFMPEG,
            "-y",
            "-i",
            str(args.input),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-vn",
            str(audio_path),
        ]
        subprocess.run(extract_cmd, check=True)

        model = WhisperModel(args.model, device="auto", compute_type="int8")
        segments, _info = model.transcribe(
            str(audio_path),
            beam_size=5,
            language=args.language,
            word_timestamps=True,
        )

        filler_ranges: List[Tuple[float, float]] = []
        for segment in segments:
            if not segment.words:
                continue
            for word in segment.words:
                if word.start is None or word.end is None:
                    continue
                cleaned = _normalise(word.word)
                if not cleaned:
                    continue
                if cleaned in filler_set:
                    start = max(0.0, word.start - args.pad)
                    end = word.end + args.pad
                    if end > start:
                        filler_ranges.append((start, end))

    filler_ranges.sort()
    filler_ranges = _merge_ranges(filler_ranges)

    if args.save_ranges:
        ranges_doc = {
            "input": str(args.input),
            "output": str(args.output),
            "pad": args.pad,
            "filler_words": sorted(filler_set),
            "removed": [
                {"start": round(start, 4), "end": round(end, 4)}
                for start, end in filler_ranges
            ],
        }
        args.save_ranges.write_text(json.dumps(ranges_doc, indent=2))

    if not filler_ranges:
        subprocess.run([FFMPEG, "-y", "-i", str(args.input), "-c", "copy", str(args.output)], check=True)
        return 0

    drop_tests = [f"between(t,{start:.3f},{end:.3f})" for start, end in filler_ranges]
    drop_expr = "+".join(drop_tests)
    select_expr = f"not({drop_expr})" if drop_expr else "1"

    has_video = _has_video(args.input)

    if has_video:
        filter_complex = (
            f"[0:v]select='{select_expr}',setpts=N/FRAME_RATE/TB[v];"
            f"[0:a]aselect='{select_expr}',asetpts=N/SR/TB[a]"
        )
        cmd = [
            FFMPEG,
            "-y",
            "-i",
            str(args.input),
            "-filter_complex",
            filter_complex,
            "-map",
            "[v]",
            "-map",
            "[a]",
            "-c:v",
            args.video_codec,
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            args.audio_codec,
            "-movflags",
            "+faststart",
            str(args.output),
        ]
    else:
        filter_complex = f"[0:a]aselect='{select_expr}',asetpts=N/SR/TB[a]"
        cmd = [
            FFMPEG,
            "-y",
            "-i",
            str(args.input),
            "-filter_complex",
            filter_complex,
            "-map",
            "[a]",
            "-c:a",
            args.audio_codec,
            str(args.output),
        ]

    subprocess.run(cmd, check=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
''
