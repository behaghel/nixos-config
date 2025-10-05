{ pkgs, ffmpeg ? pkgs.ffmpeg }:

pkgs.writeScriptBin "video-text-edit" ''
#!${pkgs.python3}/bin/python3
from __future__ import annotations

import argparse
import json
import math
import pathlib
import subprocess
import sys
import tempfile
from typing import Any, Dict, List

FFMPEG = "${ffmpeg}/bin/ffmpeg"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render a video based on a Textual Join Manifest (TJM) JSON file.",
    )
    parser.add_argument("manifest", help="Path to the TJM JSON manifest")
    parser.add_argument("--output", required=True, help="Output MP4 file")
    parser.add_argument("--workdir", help="Optional directory to place intermediate files")
    parser.add_argument("--pretty-manifest", help="Write an updated manifest reflecting the rendered cut")
    return parser.parse_args()


def load_manifest(path: pathlib.Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def ensure_inputs(paths: List[pathlib.Path]) -> None:
    for p in paths:
        if not p.exists():
            raise FileNotFoundError(f"Input file '{p}' not found")


def run_ffmpeg(cmd: List[str]) -> None:
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def segment_filename(idx: int) -> str:
    return f"segment_{idx:04d}.mp4"


def build_trim_command(source: pathlib.Path, start: float, end: float, dest: pathlib.Path) -> List[str]:
    return [
        FFMPEG,
        "-y",
        "-ss",
        f"{start:.3f}",
        "-to",
        f"{end:.3f}",
        "-i",
        str(source),
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        str(dest),
    ]


def build_broll_command(source: pathlib.Path, start: float, end: float,
                         broll: Dict[str, Any], dest: pathlib.Path) -> List[str]:
    broll_file = pathlib.Path(broll["file"]).expanduser()
    if not broll_file.exists():
        raise FileNotFoundError(f"B-roll file '{broll_file}' not found")

    mode = (broll.get("mode") or "replace").lower()
    audio_policy = (broll.get("audio") or "source").lower()
    if mode not in {"replace"}:
        raise ValueError(f"Unsupported b-roll mode '{mode}' (supported: replace)")
    if audio_policy not in {"source", "broll"}:
        raise ValueError(f"Unsupported b-roll audio '{audio_policy}' (supported: source, broll)")

    broll_offset = float(broll.get("start_offset", 0.0))
    duration = float(broll.get("duration") or (end - start))

    audio_map = "0:a:0" if audio_policy == "source" else "1:a:0"

    return [
        FFMPEG,
        "-y",
        "-ss",
        f"{start:.3f}",
        "-to",
        f"{end:.3f}",
        "-i",
        str(source),
        "-ss",
        f"{broll_offset:.3f}",
        "-t",
        f"{duration:.3f}",
        "-i",
        str(broll_file),
        "-map",
        "1:v:0",
        "-map",
        audio_map,
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        str(dest),
    ]


def render_segments(manifest: Dict[str, Any], base_dir: pathlib.Path, working: pathlib.Path) -> List[pathlib.Path]:
    id_to_source = {item["id"]: pathlib.Path(item["file"]).expanduser() for item in manifest.get("sources", [])}
    ensure_inputs(list(id_to_source.values()))

    outputs: List[pathlib.Path] = []

    for idx, segment in enumerate(manifest.get("segments", []), start=1):
        source_id = segment.get("source")
        if not source_id or source_id not in id_to_source:
            raise ValueError(f"Segment {segment.get('id')} references unknown source '{source_id}'")

        start = float(segment.get("start", 0.0))
        end = float(segment.get("end", start))
        if end <= start:
            continue

        source_path = id_to_source[source_id]
        out_path = working / segment_filename(idx)

        broll = segment.get("broll")
        if broll and broll.get("file"):
            cmd = build_broll_command(source_path, start, end, broll, out_path)
        else:
            cmd = build_trim_command(source_path, start, end, out_path)

        run_ffmpeg(cmd)
        outputs.append(out_path)

    if not outputs:
        raise RuntimeError("No segments rendered; manifest may be empty")

    return outputs


def concat_segments(segments: List[pathlib.Path], destination: pathlib.Path) -> None:
    list_file = destination.parent / "concat_list.txt"
    with list_file.open("w", encoding="utf-8") as fh:
        for seg in segments:
            fh.write(f"file '{seg}'\n")

    cmd = [
        FFMPEG,
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(list_file),
        "-c",
        "copy",
        str(destination),
    ]
    run_ffmpeg(cmd)


def write_manifest(manifest: Dict[str, Any], path: pathlib.Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)


def main() -> int:
    args = parse_args()
    manifest_path = pathlib.Path(args.manifest).expanduser()
    manifest = load_manifest(manifest_path)

    working_base = pathlib.Path(args.workdir).expanduser() if args.workdir else None

    with tempfile.TemporaryDirectory(dir=working_base) as td:
        working = pathlib.Path(td)
        segments = render_segments(manifest, manifest_path.parent, working)
        output_path = pathlib.Path(args.output).expanduser()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        concat_segments(segments, output_path)

        if args.pretty_manifest:
            out_manifest = pathlib.Path(args.pretty_manifest).expanduser()
            write_manifest(manifest, out_manifest)

    return 0


if __name__ == "__main__":
    sys.exit(main())
''
