{ pkgs, ffmpeg ? pkgs.ffmpeg }:

pkgs.writeScriptBin "video-text-edit" ''
#!${pkgs.python3}/bin/python3
from __future__ import annotations

import argparse
import json
import hashlib
import pathlib
import subprocess
import sys
import tempfile
import uuid
from typing import Any, Dict, List, Optional, Tuple

FFMPEG = "${ffmpeg}/bin/ffmpeg"
FFPROBE = "${ffmpeg}/bin/ffprobe"

_VIDEO_PROBE_CACHE: Dict[pathlib.Path, Dict[str, Any]] = {}


def probe_video_characteristics(path: pathlib.Path) -> Dict[str, Any]:
    cached = _VIDEO_PROBE_CACHE.get(path)
    if cached is not None:
        return cached

    cmd = [
        FFPROBE,
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,r_frame_rate,pix_fmt",
        "-of",
        "json",
        str(path),
    ]
    result = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    data = json.loads(result.stdout)
    streams = data.get("streams") or []
    if not streams:
        raise RuntimeError(f"Unable to probe video characteristics for {path}")
    stream = streams[0]
    width = int(stream.get("width") or 0)
    height = int(stream.get("height") or 0)
    fps_str = stream.get("r_frame_rate") or "30/1"
    try:
        num, denom = fps_str.split("/")
        fps = float(num) / float(denom)
    except Exception:
        fps = 30.0
        fps_str = "30/1"
    pix_fmt = stream.get("pix_fmt") or "yuv420p"

    info = {
        "width": width,
        "height": height,
        "fps": fps,
        "fps_str": fps_str,
        "pix_fmt": pix_fmt,
    }
    _VIDEO_PROBE_CACHE[path] = info
    return info


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render a video based on a Textual Join Manifest (TJM) JSON file.",
    )
    parser.add_argument("manifest", help="Path to the TJM JSON manifest")
    parser.add_argument("--output", required=True, help="Output MP4 file")
    parser.add_argument("--workdir", help="Optional directory to place intermediate files")
    parser.add_argument("--pretty-manifest", help="Write an updated manifest reflecting the rendered cut")
    parser.add_argument(
        "--preserve-short-gaps",
        type=float,
        metavar="SECONDS",
        help="Insert original footage for intra-source gaps shorter than SECONDS",
    )
    parser.add_argument(
        "--subtitles",
        nargs="?",
        const="",
        help=(
            "Generate WebVTT subtitles. Optionally provide a path; "
            "defaults to <output>.vtt when omitted."
        ),
    )
    parser.add_argument(
        "--no-subtitle-mux",
        action="store_true",
        help="Do not mux the generated subtitles into the output container",
    )
    return parser.parse_args()


def load_manifest(path: pathlib.Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def ensure_inputs(paths: List[pathlib.Path]) -> None:
    for p in paths:
        if not p.exists():
            raise FileNotFoundError(f"Input file '{p}' not found")


def run_ffmpeg(cmd: List[str], *, context: Optional[str] = None) -> None:
    try:
        subprocess.run(
            cmd,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        details = exc.stderr or exc.stdout or ""
        message = "ffmpeg command failed"
        if context:
            message += f" while {context}"
        if details:
            message += f":\n{details.strip()}"
        raise RuntimeError(message) from exc


def compute_gap(previous: Dict[str, Any], current: Dict[str, Any]) -> Optional[Tuple[str, float, float]]:
    prev_source = previous.get("source")
    curr_source = current.get("source")
    if not prev_source or prev_source != curr_source:
        return None
    prev_end = float(previous.get("end", 0.0))
    curr_start = float(current.get("start", prev_end))
    gap = curr_start - prev_end
    if gap <= 0:
        return None
    return prev_source, prev_end, curr_start


def parse_timecode(value: Any, *, default: float = 0.0) -> float:
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return default
        parts = text.split(":")
        if len(parts) == 1:
            try:
                return float(parts[0])
            except ValueError as exc:
                raise ValueError(f"Invalid time value '{value}'") from exc
        if len(parts) > 3:
            raise ValueError(f"Invalid time value '{value}'")
        try:
            parts = [float(p) for p in parts]
        except ValueError as exc:
            raise ValueError(f"Invalid time value '{value}'") from exc
        # HH:MM:SS(.mmm) or MM:SS(.mmm)
        seconds = 0.0
        for idx, segment in enumerate(reversed(parts)):
            seconds += segment * (60 ** idx)
        return seconds
    raise TypeError(f"Unsupported time value type: {type(value)!r}")


def segment_kind(segment: Dict[str, Any]) -> str:
    return (segment.get("kind") or "segment").lower()


def segment_filename(idx: int) -> str:
    return f"segment_{idx:04d}.mp4"


def format_timestamp(seconds: float) -> str:
    total_ms = max(0, int(round(seconds * 1000)))
    hours, remainder = divmod(total_ms, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, ms = divmod(remainder, 1_000)
    return f"{hours:02}:{minutes:02}:{secs:02}.{ms:03}"


def format_minsec(seconds: float) -> str:
    total_seconds = max(0, int(round(seconds)))
    minutes, secs = divmod(total_seconds, 60)
    return f"{minutes:02}:{secs:02}"


def cue_text(segment: Dict[str, Any]) -> str:
    text = (segment.get("text") or "").strip()
    if not text:
        words = segment.get("words") or []
        text = " ".join(w.get("token", "") for w in words).strip()
    speaker = (segment.get("speaker") or "").strip()
    if speaker and text:
        return f"{speaker}: {text}"
    return text or (segment.get("id") or "")


def canonical_broll_key(segment: Dict[str, Any]) -> Optional[Tuple[Any, ...]]:
    broll = segment.get("broll")
    if not (broll and broll.get("file")):
        return None
    file_path = str(pathlib.Path(broll["file"]).expanduser())
    mode = (broll.get("mode") or "replace").lower()
    audio_policy = (broll.get("audio") or "source").lower()
    still = bool(broll.get("still"))
    position = tuple(sorted((broll.get("position") or {}).items()))
    template_flag = file_path.lower().endswith(".json")
    return (file_path, mode, audio_policy, still, position, template_flag)




def escape_drawtext_value(value: str) -> str:
    return (
        value.replace('\\', '\\\\')
        .replace(':', '\\:')
        .replace("'", "\\'")
    )


def build_drawtext_filters(
    overlays: Optional[List[Dict[str, Any]]], placeholders: Dict[str, str]
) -> str:
    filters: List[str] = []
    for overlay in overlays or []:
        placeholder = overlay.get("placeholder")
        if not placeholder:
            continue
        if placeholder not in placeholders:
            continue
        text_value = escape_drawtext_value(str(placeholders[placeholder]))
        parts: List[str] = [f"text='{text_value}'"]

        font = overlay.get("font") or overlay.get("fontfile")
        if font:
            font_path = pathlib.Path(font).expanduser()
            parts.append(f"fontfile='{escape_drawtext_value(str(font_path))}'")

        fontsize = overlay.get("fontsize") or overlay.get("size")
        if fontsize:
            parts.append(f"fontsize={fontsize}")

        color = overlay.get("color") or overlay.get("fontColor")
        if color:
            parts.append(f"fontcolor={color}")

        x_expr = overlay.get("x") or overlay.get("position_x")
        y_expr = overlay.get("y") or overlay.get("position_y")
        align = overlay.get("align") or overlay.get("alignment")
        if align == "center" and not x_expr:
            x_expr = "(w-text_w)/2"
        if align == "center" and not y_expr:
            y_expr = "(h-text_h)/2"
        parts.append(f"x={x_expr or 0}")
        parts.append(f"y={y_expr or 0}")

        box_color = overlay.get("boxColor") or overlay.get("box_color")
        if box_color:
            parts.append("box=1")
            parts.append(f"boxcolor={box_color}")

        shadow_color = overlay.get("shadowColor") or overlay.get("shadow_color")
        if shadow_color:
            parts.append(f"shadowcolor={shadow_color}")
        shadow_x = overlay.get("shadow_x") or overlay.get("shadowX")
        if shadow_x is not None:
            parts.append(f"shadowx={shadow_x}")
        shadow_y = overlay.get("shadow_y") or overlay.get("shadowY")
        if shadow_y is not None:
            parts.append(f"shadowy={shadow_y}")

        start_time = overlay.get("start")
        end_time = overlay.get("end")
        duration = overlay.get("duration")
        if start_time is not None:
            start_val = float(start_time)
            if duration is not None:
                end_val = start_val + float(duration)
            elif end_time is not None:
                end_val = float(end_time)
            else:
                end_val = start_val
            parts.append(f"enable='between(t,{start_val},{end_val})'")

        filters.append("drawtext=" + ":".join(parts))

    return ",".join(filters)


def load_broll_spec(broll: Dict[str, Any]) -> Dict[str, Any]:
    file_value = broll.get("file")
    if not file_value:
        raise ValueError("B-roll entry missing 'file' attribute")
    file_path = pathlib.Path(file_value).expanduser()

    spec: Dict[str, Any] = {
        "media_path": file_path,
        "overlays": [],
        "placeholders": {},
    }

    if file_path.suffix.lower() == ".json":
        with file_path.open("r", encoding="utf-8") as fh:
            template_spec = json.load(fh)
        template_path = template_spec.get("template")
        if not template_path:
            raise ValueError(f"Template JSON '{file_path}' missing 'template' field")
        spec["media_path"] = pathlib.Path(template_path).expanduser()
        spec["overlays"] = template_spec.get("overlays") or []
        spec["placeholders"] = template_spec.get("placeholders") or {}

    if broll.get("overlays"):
        spec["overlays"] = broll["overlays"]

    placeholders: Dict[str, str] = {}
    placeholders.update(spec.get("placeholders", {}))
    placeholders.update(broll.get("placeholders") or {})
    spec["placeholders"] = {k: str(v) for k, v in placeholders.items()}

    return spec



def prepare_broll_media(
    broll: Dict[str, Any],
    source_info: Optional[Dict[str, Any]],
    total_duration: float,
    working: pathlib.Path,
    audio_policy: str,
) -> Tuple[pathlib.Path, str]:
    spec = load_broll_spec(broll)
    media_path = spec["media_path"]
    overlays = spec.get("overlays") or []
    placeholders = spec.get("placeholders") or {}

    base_info = probe_video_characteristics(media_path)
    target_info = source_info or base_info
    if target_info is None:
        target_info = base_info
    if target_info is None:
        raise RuntimeError(f"Unable to determine video characteristics for {media_path}")

    target_width = int(target_info.get("width") or base_info.get("width") or 1920)
    target_height = int(target_info.get("height") or base_info.get("height") or 1080)
    target_width = max(2, target_width - (target_width % 2))
    target_height = max(2, target_height - (target_height % 2))

    pix_fmt = target_info.get("pix_fmt") or base_info.get("pix_fmt") or "yuv420p"
    fps_str = target_info.get("fps_str") or base_info.get("fps_str") or "30/1"

    filters: List[str] = []
    if base_info:
        base_width = int(base_info.get("width") or target_width)
        base_height = int(base_info.get("height") or target_height)
        if base_width != target_width or base_height != target_height:
            filters.append(
                f"scale={target_width}:{target_height}:force_original_aspect_ratio=increase"
            )
            filters.append(f"crop={target_width}:{target_height}")
        base_fps = base_info.get("fps_str")
        if base_fps and base_fps != fps_str:
            filters.append(f"fps={fps_str}")
    filters.append(f"format={pix_fmt}")

    draw_filters = build_drawtext_filters(overlays, placeholders)
    if draw_filters:
        filters.append(draw_filters)

    filter_chain = ",".join(filters) if filters else None

    prepared_path = working / f"broll_prepared_{uuid.uuid4().hex}.mp4"
    cmd: List[str] = [FFMPEG, "-y"]

    is_still = bool(broll.get("still")) or media_path.suffix.lower() in {".png", ".jpg", ".jpeg", ".bmp", ".gif"}
    total_needed = max(total_duration, 0.033)

    if is_still:
        cmd.extend(["-loop", "1", "-i", str(media_path), "-t", f"{total_needed:.3f}"])
        if filter_chain:
            cmd.extend(["-vf", filter_chain])
        cmd.extend([
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            pix_fmt,
            "-an",
            str(prepared_path),
        ])
    else:
        cmd.extend(["-i", str(media_path)])
        if total_duration > 0:
            cmd.extend(["-t", f"{total_needed:.3f}"])
        if filter_chain:
            cmd.extend(["-vf", filter_chain])
        cmd.extend([
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            pix_fmt,
        ])
        if audio_policy == "broll":
            cmd.extend(["-c:a", "aac"])
        else:
            cmd.extend(["-an"])
        cmd.append(str(prepared_path))

    run_ffmpeg(cmd, context=f"preparing b-roll media from {media_path}")
    return prepared_path, pix_fmt

def build_subtitle_cues(
    manifest: Dict[str, Any], preserve_gap_threshold: Optional[float] = None
) -> List[Tuple[float, float, str]]:
    cues: List[Tuple[float, float, str]] = []
    timeline = 0.0
    previous_segment: Optional[Dict[str, Any]] = None
    for segment in manifest.get("segments", []):
        if segment_kind(segment) == "marker":
            continue
        if (
            preserve_gap_threshold is not None
            and previous_segment is not None
        ):
            gap = compute_gap(previous_segment, segment)
            if gap is not None:
                _, gap_start, gap_end = gap
                gap_duration = gap_end - gap_start
                if gap_duration > 0 and gap_duration <= preserve_gap_threshold:
                    timeline += gap_duration
        start = float(segment.get("start", 0.0))
        end = float(segment.get("end", start))
        duration = max(0.0, end - start)
        if duration <= 0:
            continue
        text = cue_text(segment)
        if not text:
            timeline += duration
            continue
        cue_start = timeline
        cue_end = cue_start + duration
        cues.append((cue_start, cue_end, text))
        timeline = cue_end
        previous_segment = segment
    return cues


def write_webvtt(cues: List[Tuple[float, float, str]], path: pathlib.Path) -> None:
    if not cues:
        raise RuntimeError("No subtitle cues were generated from the manifest")
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"[video-text-edit] Writing WebVTT subtitles to {path}", flush=True)
    with path.open("w", encoding="utf-8") as fh:
        fh.write("WEBVTT\n\n")
        for idx, (start, end, text) in enumerate(cues, start=1):
            fh.write(f"{idx}\n")
            fh.write(f"{format_timestamp(start)} --> {format_timestamp(end)}\n")
            fh.write(f"{text}\n\n")


def mux_subtitles(video_path: pathlib.Path, subtitles_path: pathlib.Path) -> None:
    with tempfile.NamedTemporaryFile(
        suffix=video_path.suffix,
        dir=str(video_path.parent),
        delete=False,
    ) as tmp_file:
        tmp_path = pathlib.Path(tmp_file.name)

    try:
        cmd = [
            FFMPEG,
            "-y",
            "-i",
            str(video_path),
            "-f",
            "webvtt",
            "-i",
            str(subtitles_path),
            "-map",
            "0",
            "-map",
            "-0:d",
            "-c:v",
            "copy",
            "-c:a",
            "copy",
            "-c:s",
            "mov_text",
            "-map",
            "1:0",
            str(tmp_path),
        ]
        run_ffmpeg(cmd, context="muxing subtitles into the final video")
        tmp_path.replace(video_path)
    except Exception:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
        raise



def build_trim_command(source: pathlib.Path, start: float, end: float, dest: pathlib.Path) -> List[str]:
    info = probe_video_characteristics(source)
    pix_fmt = info.get("pix_fmt") or "yuv420p"
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
        pix_fmt,
        "-c:a",
        "aac",
        str(dest),
    ]


def build_broll_command(
    source: pathlib.Path,
    start: float,
    end: float,
    broll: Dict[str, Any],
    dest: pathlib.Path,
    working: pathlib.Path,
    *,
    effective_offset: Optional[float] = None,
    effective_duration: Optional[float] = None,
) -> List[str]:
    broll_file = pathlib.Path(broll["file"]).expanduser()
    if not broll_file.exists():
        raise FileNotFoundError(f"B-roll file '{broll_file}' not found")

    mode = (broll.get("mode") or "replace").lower()
    audio_policy = (broll.get("audio") or "source").lower()
    if mode not in {"replace", "pip"}:
        raise ValueError(
            f"Unsupported b-roll mode '{mode}' (supported: replace, pip)"
        )
    if audio_policy not in {"source", "broll"}:
        raise ValueError(f"Unsupported b-roll audio '{audio_policy}' (supported: source, broll)")

    base_offset = parse_timecode(broll.get("start_offset"), default=0.0)
    broll_offset = effective_offset if effective_offset is not None else base_offset
    duration = effective_duration if effective_duration is not None else parse_timecode(broll.get("duration"), default=0.0)
    if duration <= 0:
        duration = max(0.0, end - start)

    still = bool(broll.get("still"))
    if still and audio_policy == "broll":
        raise ValueError("Still-image b-roll cannot supply audio; set audio to 'source'")

    source_info = probe_video_characteristics(source)
    target_width = max(2, int(source_info.get("width") or 1920))
    target_height = max(2, int(source_info.get("height") or 1080))
    if target_width % 2:
        target_width -= 1
    if target_height % 2:
        target_height -= 1
    pix_fmt = source_info.get("pix_fmt") or "yuv420p"
    fps_str = source_info.get("fps_str") or "30/1"

    prepared_broll = broll_file
    if still:
        prepared_broll = working / f"broll_still_{uuid.uuid4().hex}.mp4"
        scale_filter = (
            f"scale={target_width}:{target_height}:force_original_aspect_ratio=increase,"
            f"crop={target_width}:{target_height},"
            f"fps={fps_str},"
            f"format={pix_fmt}"
        )
        loop_cmd = [
            FFMPEG,
            "-y",
            "-loop",
            "1",
            "-i",
            str(broll_file),
            "-t",
            f"{duration:.3f}",
            "-vf",
            scale_filter,
            "-an",
            "-pix_fmt",
            pix_fmt,
            str(prepared_broll),
        ]
        run_ffmpeg(loop_cmd, context=f"preparing still b-roll from {broll_file}")
        broll_offset = 0.0

    if mode == "pip":
        # Picture-in-picture overlay; use filter_complex to scale and position
        pip_position = broll.get("position") or {}
        pos_x = float(pip_position.get("x", 0.05))
        pos_y = float(pip_position.get("y", 0.05))
        width = float(pip_position.get("width", 0.3))

        if width <= 0 or width >= 1:
            raise ValueError("pip width must be between 0 and 1 (exclusive)")
        if not (0 <= pos_x <= 1) or not (0 <= pos_y <= 1):
            raise ValueError("pip position x/y must be between 0 and 1 inclusive")

        scale_expr = f"iw*{width}:-1"
        overlay_expr = f"main_w*{pos_x}:main_h*{pos_y}"

        cmd: List[str] = [
            FFMPEG,
            "-y",
            "-ss",
            f"{start:.3f}",
            "-to",
            f"{end:.3f}",
            "-i",
            str(source),
        ]

        if still:
            cmd.extend([
                "-i",
                str(prepared_broll),
            ])
        else:
            cmd.extend([
                "-ss",
                f"{broll_offset:.3f}",
                "-t",
                f"{duration:.3f}",
                "-i",
                str(prepared_broll),
            ])

        filter_complex = (
            f"[1:v]scale={scale_expr}[pip];"
            f"[0:v][pip]overlay={overlay_expr}:eof_action=repeat[outv]"
        )

        cmd.extend(
            [
                "-filter_complex",
                filter_complex,
                "-map",
                "[outv]",
                "-map",
                "0:a:0" if audio_policy == "source" else "1:a:0",
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "18",
                "-pix_fmt",
                pix_fmt,
                "-c:a",
                "aac",
                str(dest),
            ]
        )
        return cmd

    audio_map = "0:a:0" if audio_policy == "source" else "1:a:0"

    cmd: List[str] = [
        FFMPEG,
        "-y",
        "-ss",
        f"{start:.3f}",
        "-to",
        f"{end:.3f}",
        "-i",
        str(source),
    ]

    if still:
        cmd.extend([
            "-i",
            str(prepared_broll),
        ])
    else:
        cmd.extend([
            "-ss",
            f"{broll_offset:.3f}",
            "-t",
            f"{duration:.3f}",
            "-i",
            str(prepared_broll),
        ])

    cmd.extend(
        [
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
        pix_fmt,
        "-c:a",
        "aac",
        str(dest),
    ]
    )

    return cmd



def segment_duration(segment: Dict[str, Any]) -> float:
    start = segment.get("start")
    end = segment.get("end")
    duration = 0.0
    if start is not None and end is not None:
        try:
            duration = float(end) - float(start)
        except Exception:
            duration = 0.0
    if duration <= 0:
        duration = parse_timecode(segment.get("duration"), default=0.0)
    if duration <= 0:
        duration = parse_timecode((segment.get("broll") or {}).get("duration"), default=0.0)
    return max(0.0, duration)


def segment_overlay_duration(segment: Dict[str, Any]) -> float:
    override = parse_timecode((segment.get("broll") or {}).get("duration"), default=0.0)
    if override > 0:
        return override
    return segment_duration(segment)


def compute_broll_chains(
    segments: List[Dict[str, Any]]
) -> Tuple[Dict[int, Dict[str, Any]], Dict[int, Dict[str, Any]]]:
    chain_map: Dict[int, Dict[str, Any]] = {}
    chains: Dict[int, Dict[str, Any]] = {}
    chain_counter = 0
    active_chain: Optional[Dict[str, Any]] = None

    for segment in segments:
        key = canonical_broll_key(segment)
        seg_broll = segment.get("broll") or {}
        overlay_duration = segment_overlay_duration(segment)
        duration = segment_duration(segment)
        continue_flag = bool(seg_broll.get("continue"))

        if key:
            if (
                active_chain
                and active_chain["key"] == key
                and continue_flag
            ):
                offset = active_chain["overlay_sum"]
                active_chain["overlay_sum"] += overlay_duration
                active_chain["total_duration"] = active_chain["base_offset"] + active_chain["overlay_sum"]
            else:
                chain_counter += 1
                base_offset = parse_timecode(seg_broll.get("start_offset"), default=0.0)
                active_chain = {
                    "id": chain_counter,
                    "key": key,
                    "base_offset": base_offset,
                    "overlay_sum": overlay_duration,
                    "total_duration": base_offset + overlay_duration,
                }
                chains[chain_counter] = active_chain
                offset = 0.0
            chain_map[id(segment)] = {
                "chain_id": active_chain["id"],
                "offset": offset,
                "overlay_duration": overlay_duration,
                "duration": duration,
            }
            if not continue_flag:
                active_chain = None
        else:
            chain_map[id(segment)] = {
                "chain_id": None,
                "offset": 0.0,
                "overlay_duration": duration,
                "duration": duration,
            }
            active_chain = None

    return chain_map, chains



def render_segments(
    manifest: Dict[str, Any],
    base_dir: pathlib.Path,
    working: pathlib.Path,
    preserve_gap_threshold: Optional[float] = None,
) -> List[pathlib.Path]:
    id_to_source = {item["id"]: pathlib.Path(item["file"]).expanduser() for item in manifest.get("sources", [])}
    ensure_inputs(list(id_to_source.values()))

    manifest_segments = manifest.get("segments", [])
    chain_map, chains = compute_broll_chains(manifest_segments)

    def to_float(value: Any, default: float = 0.0) -> float:
        try:
            return float(value)
        except Exception:
            return default

    outputs: List[pathlib.Path] = []
    total_units = sum(
        1
        for seg in manifest_segments
        if (segment_kind(seg) != "marker" or canonical_broll_key(seg))
        and (segment_duration(seg) > 0 or canonical_broll_key(seg))
    ) or 1

    clip_index = 1
    rendered_count = 0
    previous_segment: Optional[Dict[str, Any]] = None

    for segment in manifest_segments:
        kind = segment_kind(segment)
        key = canonical_broll_key(segment)
        has_broll = bool(key)
        is_marker = kind == "marker"

        if is_marker and not has_broll:
            continue

        source_id = segment.get("source")
        source_path = id_to_source.get(source_id) if source_id in id_to_source else None

        duration = segment_duration(segment)
        if duration <= 0 and not has_broll:
            previous_segment = segment
            continue

        start_val = to_float(segment.get("start"), 0.0)
        end_val = to_float(segment.get("end"), start_val + duration)

        segment_info = chain_map.get(id(segment), {
            "chain_id": None,
            "offset": 0.0,
            "overlay_duration": duration,
            "duration": duration,
        })
        chain_meta = chains.get(segment_info.get("chain_id")) if segment_info.get("chain_id") else None

        source_info = probe_video_characteristics(source_path) if source_path else None

        gap_duration = 0.0
        gap_bounds: Optional[Tuple[str, float, float]] = None
        prev_source_path: Optional[pathlib.Path] = None
        if (
            preserve_gap_threshold is not None
            and previous_segment is not None
            and source_path is not None
        ):
            prev_source_id = previous_segment.get("source")
            if prev_source_id and prev_source_id in id_to_source:
                prev_source_path = id_to_source[prev_source_id]
                gap_info = compute_gap(previous_segment, segment)
                if gap_info is not None:
                    gap_bounds = gap_info
                    _, gap_start, gap_end = gap_info
                    gap_duration = max(0.0, gap_end - gap_start)

        skip_gap = False
        if (
            preserve_gap_threshold is not None
            and previous_segment is not None
            and key
            and (segment.get("broll") or {}).get("continue")
        ):
            prev_key = canonical_broll_key(previous_segment)
            prev_chain = chain_map.get(id(previous_segment))
            if prev_key == key and prev_chain and prev_chain.get("chain_id") == segment_info.get("chain_id"):
                skip_gap = True

        if (
            preserve_gap_threshold is not None
            and gap_duration > 0
            and gap_duration <= preserve_gap_threshold
            and not skip_gap
            and gap_bounds is not None
            and prev_source_path is not None
        ):
            gap_path = working / segment_filename(clip_index)
            clip_index += 1
            print(
                f"[video-text-edit] Preserving {gap_duration:.2f}s gap before segment {segment.get('id')}",
                flush=True,
            )
            gap_cmd = build_trim_command(
                prev_source_path,
                gap_bounds[1],
                gap_bounds[2],
                gap_path,
            )
            run_ffmpeg(
                gap_cmd,
                context=f"preserving gap before segment {segment.get('id')}",
            )
            outputs.append(gap_path)

        out_path = working / segment_filename(clip_index)
        clip_index += 1

        description = (
            f"segment {segment.get('id') or rendered_count + 1} "
            f"({(source_id or 'broll')} {start_val:.2f}s->{end_val:.2f}s)"
        )
        print(
            f"[video-text-edit] Rendering {rendered_count + 1}/{total_units}: {description}",
            flush=True,
        )

        broll = segment.get("broll") or {}
        audio_policy = (broll.get("audio") or "source").lower()
        if source_path is None and audio_policy == "source":
            audio_policy = "broll"

        overlay_duration = segment_info.get("overlay_duration", duration)
        effective_offset = 0.0
        prepared_path: Optional[pathlib.Path] = None
        prepared_pix_fmt = source_info.get("pix_fmt") if source_info else "yuv420p"

        if key and chain_meta:
            if "prepared_path" not in chain_meta:
                total_needed = max(chain_meta.get("total_duration", overlay_duration), overlay_duration)
                prepared_path, prepared_pix_fmt = prepare_broll_media(
                    broll,
                    source_info,
                    total_needed,
                    working,
                    audio_policy,
                )
                chain_meta["prepared_path"] = prepared_path
                chain_meta["prepared_pix_fmt"] = prepared_pix_fmt
            else:
                prepared_path = chain_meta["prepared_path"]
                prepared_pix_fmt = chain_meta.get("prepared_pix_fmt") or prepared_pix_fmt

            base_offset = chain_meta.get("base_offset", 0.0)
            effective_offset = base_offset + segment_info.get("offset", 0.0)

            prepared_broll = dict(broll)
            prepared_broll["file"] = str(prepared_path)
            prepared_broll["still"] = False
            prepared_broll.pop("placeholders", None)
            prepared_broll.pop("overlays", None)
            prepared_broll.pop("continue", None)
            prepared_broll.pop("duration", None)
            prepared_broll.pop("start_offset", None)

            if source_path is not None:
                cmd = build_broll_command(
                    source_path,
                    start_val,
                    end_val,
                    prepared_broll,
                    out_path,
                    working,
                    effective_offset=effective_offset,
                    effective_duration=overlay_duration,
                )
                run_ffmpeg(cmd, context=f"rendering {description}")
            else:
                trim_cmd = [
                    FFMPEG,
                    "-y",
                    "-ss",
                    f"{effective_offset:.3f}",
                    "-t",
                    f"{overlay_duration:.3f}",
                    "-i",
                    str(prepared_path),
                    "-c:v",
                    "libx264",
                    "-preset",
                    "medium",
                    "-crf",
                    "18",
                    "-pix_fmt",
                    prepared_pix_fmt,
                ]
                if audio_policy == "broll":
                    trim_cmd.extend(["-c:a", "aac"])
                else:
                    trim_cmd.extend(["-an"])
                trim_cmd.append(str(out_path))
                run_ffmpeg(trim_cmd, context=f"rendering {description}")
        else:
            if not source_path:
                raise ValueError(f"Segment {segment.get('id')} missing source and b-roll")
            cmd = build_trim_command(
                source_path,
                start_val,
                end_val,
                out_path,
            )
            run_ffmpeg(cmd, context=f"rendering {description}")

        outputs.append(out_path)
        rendered_count += 1
        previous_segment = segment

    if not outputs:
        raise RuntimeError("No segments rendered; manifest may be empty")

    return outputs

def concat_segments(segments: List[pathlib.Path], destination: pathlib.Path) -> None:
    list_file = destination.parent / "concat_list.txt"
    with list_file.open("w", encoding="utf-8") as fh:
        for seg in segments:
            fh.write(f"file '{seg}'\n")

    print(
        f"[video-text-edit] Concatenating {len(segments)} rendered clips",
        flush=True,
    )
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
    run_ffmpeg(cmd, context="concatenating rendered segments")


def write_manifest(manifest: Dict[str, Any], path: pathlib.Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"[video-text-edit] Writing manifest to {path}", flush=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)


def collect_markers(
    manifest: Dict[str, Any],
    preserve_gap_threshold: Optional[float] = None,
) -> List[Tuple[str, float]]:
    timeline = 0.0
    markers: List[Tuple[str, float]] = []
    previous_segment: Optional[Dict[str, Any]] = None

    for segment in manifest.get("segments", []):
        if (
            preserve_gap_threshold is not None
            and previous_segment is not None
        ):
            gap = compute_gap(previous_segment, segment)
            if gap is not None:
                _, gap_start, gap_end = gap
                gap_duration = gap_end - gap_start
                if gap_duration > 0 and gap_duration <= preserve_gap_threshold:
                    timeline += gap_duration

        kind = segment_kind(segment)
        if kind == "marker":
            title = (
                (segment.get("title") or "").strip()
                or (segment.get("text") or "").strip()
                or segment.get("id")
                or "marker"
            )
            markers.append((title, timeline))
            continue

        start = float(segment.get("start", 0.0))
        end = float(segment.get("end", start))
        duration = max(0.0, end - start)
        if duration <= 0:
            continue

        timeline += duration
        previous_segment = segment

    return markers


def main() -> int:
    args = parse_args()
    manifest_path = pathlib.Path(args.manifest).expanduser()
    manifest = load_manifest(manifest_path)
    markers = collect_markers(
        manifest,
        preserve_gap_threshold=args.preserve_short_gaps,
    )

    working_base = pathlib.Path(args.workdir).expanduser() if args.workdir else None

    with tempfile.TemporaryDirectory(dir=working_base) as td:
        working = pathlib.Path(td)
        segments = render_segments(
            manifest,
            manifest_path.parent,
            working,
            preserve_gap_threshold=args.preserve_short_gaps,
        )
        output_path = pathlib.Path(args.output).expanduser()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        concat_segments(segments, output_path)

        subtitles_path: Optional[pathlib.Path] = None
        if args.subtitles is not None:
            subtitles_path = (
                output_path.with_suffix(".vtt")
                if args.subtitles == ""
                else pathlib.Path(args.subtitles).expanduser()
            )
            cues = build_subtitle_cues(
                manifest,
                preserve_gap_threshold=args.preserve_short_gaps,
            )
            write_webvtt(cues, subtitles_path)
            if not args.no_subtitle_mux:
                print(
                    f"[video-text-edit] Muxing subtitles from {subtitles_path} into {output_path}",
                    flush=True,
                )
                mux_subtitles(output_path, subtitles_path)

        if args.pretty_manifest:
            out_manifest = pathlib.Path(args.pretty_manifest).expanduser()
            write_manifest(manifest, out_manifest)

        print(f"[video-text-edit] Final cut available at {output_path}", flush=True)
        for title, stamp in markers:
            print(f"[{format_minsec(stamp)}] {title}", flush=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
''
