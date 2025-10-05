{ pkgs, pythonEnv, ffmpeg ? pkgs.ffmpeg }:

pkgs.writeScriptBin "video-transcribe" ''
#!${pythonEnv}/bin/python3
from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import sys
import tempfile

from typing import Any, Dict, List

from faster_whisper import WhisperModel

FFMPEG = "${ffmpeg}/bin/ffmpeg"


def positive_float(value: str) -> float:
    try:
        v = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc
    if v < 0:
        raise argparse.ArgumentTypeError("must be >= 0")
    return v


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Transcribe media files and emit a Textual Join Manifest (TJM) JSON with per-word timings.",
    )
    parser.add_argument("inputs", nargs="+", help="Input media files (audio or video)")
    parser.add_argument("--output", required=True, help="Manifest JSON path to write")
    parser.add_argument("--model", default="base.en", help="faster-whisper model name/path (default: base.en)")
    parser.add_argument("--language", default="en", help="Language hint passed to the model")
    parser.add_argument("--beam-size", type=int, default=5, help="Beam size for decoding")
    parser.add_argument("--device", default="auto", help="Device override for faster-whisper (auto / cpu / cuda)")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON (indentation)")
    parser.add_argument("--max-segment-duration", type=positive_float, default=0.0,
                        help="Optional maximum segment duration in seconds; segments longer than this are split at word boundaries.")
    parser.add_argument("--stub", action="store_true", help=argparse.SUPPRESS)
    return parser.parse_args()


def ensure_dir(path: pathlib.Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def ffmpeg_extract(input_path: pathlib.Path, output_path: pathlib.Path) -> None:
    cmd = [
        FFMPEG,
        "-y",
        "-i",
        str(input_path),
        "-ac",
        "1",
        "-ar",
        "16000",
        "-vn",
        str(output_path),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def segment_to_dict(source_id: str, index: int, seg, max_duration: float) -> List[Dict[str, Any]]:
    words = [
        {
            "start": round(word.start, 3) if word.start is not None else None,
            "end": round(word.end, 3) if word.end is not None else None,
            "token": word.word.strip(),
        }
        for word in seg.words or []
        if word.word.strip()
    ]

    text = " ".join(word["token"] for word in words) if words else seg.text.strip()

    start = round(seg.start or 0.0, 3)
    end = round(seg.end or start, 3)

    if max_duration and words:
        return split_segment(source_id, index, start, end, text, words, max_duration)

    return [
        {
            "id": f"{source_id}-s{index:04d}",
            "source": source_id,
            "start": start,
            "end": end,
            "speaker": getattr(seg, "speaker", None),
            "text": text,
            "words": words,
            "tags": [],
            "notes": "",
            "broll": None,
        }
    ]


def split_segment(source_id: str, index: int, start: float, end: float, text: str,
                   words: List[Dict[str, Any]], max_duration: float) -> List[Dict[str, Any]]:
    buckets: List[List[Dict[str, Any]]] = []
    current: List[Dict[str, Any]] = []
    bucket_start = start

    for word in words:
        if not current:
            bucket_start = word["start"] or bucket_start
        bucket_end = word["end"] or bucket_start
        duration = (bucket_end or bucket_start) - bucket_start
        if duration > max_duration and current:
            buckets.append(current)
            current = [word]
            bucket_start = word["start"] or bucket_start
        else:
            current.append(word)
    if current:
        buckets.append(current)

    slices: List[Dict[str, Any]] = []
    for idx, bucket in enumerate(buckets, start=0):
        slice_start = bucket[0]["start"] or start
        slice_end = bucket[-1]["end"] or slice_start
        slice_text = " ".join(w["token"] for w in bucket)
        slices.append(
            {
                "id": f"{source_id}-s{index:04d}-{idx}",
                "source": source_id,
                "start": round(slice_start, 3),
                "end": round(slice_end, 3),
                "speaker": None,
                "text": slice_text,
                "words": bucket,
                "tags": [],
                "notes": "",
                "broll": None,
            }
        )
    return slices


def main() -> int:
    args = parse_args()

    inputs = [pathlib.Path(p).expanduser() for p in args.inputs]
    for path in inputs:
        if not path.exists():
            print(f"video-transcribe: input '{path}' not found", file=sys.stderr)
            return 1

    stub_mode = args.stub or os.environ.get("VIDEO_TRANSCRIBE_STUB")
    model = None if stub_mode else WhisperModel(args.model, device=args.device, compute_type="int8")

    manifest_sources: List[Dict[str, Any]] = []
    manifest_segments: List[Dict[str, Any]] = []

    with tempfile.TemporaryDirectory() as td:
        tmpdir = pathlib.Path(td)
        for idx, media_path in enumerate(inputs, start=1):
            source_id = f"clip{idx:02d}"
            manifest_sources.append({"id": source_id, "file": str(media_path)})

            if stub_mode:
                continue

            wav_path = tmpdir / f"audio_{idx:02d}.wav"
            ffmpeg_extract(media_path, wav_path)

            segments, _info = model.transcribe(
                str(wav_path),
                beam_size=args.beam_size,
                language=args.language,
                vad_filter=False,
                word_timestamps=True,
            )

            for seg_index, segment in enumerate(segments, start=1):
                manifest_segments.extend(
                    segment_to_dict(source_id, seg_index, segment, args.max_segment_duration)
                )

    manifest: Dict[str, Any] = {
        "version": 1,
        "sources": manifest_sources,
        "segments": manifest_segments,
    }

    output_path = pathlib.Path(args.output).expanduser()
    ensure_dir(output_path)
    with output_path.open("w", encoding="utf-8") as fh:
        if args.pretty:
            json.dump(manifest, fh, indent=2, ensure_ascii=False)
        else:
            json.dump(manifest, fh, separators=(",", ":"), ensure_ascii=False)
            fh.write("\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
''
