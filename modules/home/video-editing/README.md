# Video Editing Tools Module

This Home Manager module installs CLI helpers aimed at streamlining quick post-processing passes on spoken-word footage from cameras such as the DJI Osmo Pocket 3.

## Commands

- `video-denoise` – wrap `ffmpeg`'s RNNoise (`arnndn`) filter so you can remove broadband noise while keeping the original video stream intact.
- `video-trim-fillers` – transcribe audio with `faster-whisper`, drop filler words from the timeline, and re-encode the result.
- `video-batch` – orchestrate the denoise/trim pipeline across one or more files with a single command.
- `video-transcribe` – generate a multi-source Textual Join Manifest (`.tjm.json`) with per-word timestamps ready for text-based editing.
- `video-text-edit` – read a TJM file and render a new MP4 that follows the edited segment order (including simple b-roll substitution).

## Usage Examples

### 1. Denoise a clip while keeping the video stream
```bash
video-denoise raw/pocket3_take01.mp4
```
- Audio is denoised with RNNoise.
- Video is copied (`-c:v copy`), so the process is fast and visually lossless.
- Output defaults to `raw/pocket3_take01.denoise.mp4` (same directory, `.denoise` suffix).
- Supplying an explicit output path automatically creates its parent directory.

Fine‑tune with an explicit model or extra filters:
```bash
video-denoise -m ~/.cache/rnnoise/custom.rnnoise -f loudnorm intro.wav intro.clean.wav
```

### 2. Trim filler words from a talking-head video
```bash
video-trim-fillers raw/weekly-update.mp4 edits/weekly-update_trim.mp4 \
  --pad 0.05 \
  --save-ranges edits/weekly-update_filler-ranges.json
```
- Removes phrases such as “um”, “uh”, “like”, and friends (see `hub.videoEditing.fillerWords`).
- `--pad` keeps a small context around each removal to avoid choppy audio.
- `--save-ranges` records exactly what was cut.

List the active filler dictionary without modifying media:
```bash
video-trim-fillers --list-fillers dummy.mp4 dummy.mp4
```

### Typical Workflow
1. Extract best audio: `video-denoise` to clean up background noise.
2. Tighten delivery: run `video-trim-fillers` on the denoised file (or original video) to erase filler words automatically.
3. Review the generated edit list (`--save-ranges`) and iterate if you want to adjust `hub.videoEditing.fillerWords`, padding, or codecs.

### 3. Batch both steps at once
```bash
video-batch raw/*.MP4 --denoise-dir denoised --trim-dir edited
```
- `video-batch` denoises into `denoised/` (e.g., `denoised/DJI_0001.denoise.MP4`) and then trims into `edited/` (`DJI_0001.denoise.trim.MP4`).
- Use `--skip-denoise` or `--skip-trim` to run a single stage, or omit the directory flags to keep outputs next to the sources.
- Options may be placed before or after the input list; add `--` if you need to stop option parsing early.
- Add `--transcribe-manifest transcripts/project.tjm.json` to emit a TJM manifest during the batch run (use `--skip-transcribe` to disable).
- `--transcribe-model` / `--transcribe-language` forward directly to `video-transcribe` for fine-tuning recognition.

### 4. Produce a transcript manifest
```bash
video-transcribe --output transcripts/weekly.tjm.json raw/*.MP4 --model small.en --pretty
```
- The manifest lists each input clip under `sources` and every detected sentence under `segments`, including per-word timestamps and empty `broll` metadata ready for editing.
- Use `--max-segment-duration` to split long segments at word boundaries.

### 5. Render edits from a TJM file
```bash
video-text-edit transcripts/weekly-edited.tjm.json --output edits/weekly-cut.mp4
```
- Generates temporary trimmed segments and concatenates them in manifest order.
- Simple b-roll replacement is supported: set the `broll` object in the manifest to point to an overlay clip (current mode `replace` with `audio` = `source` or `broll`).

## Configuration Knobs

All options live under `hub.videoEditing`:
- `enable` – turn the module on.
- `fillerWords` – default list of filler tokens to drop (lowercased strings, no punctuation needed).
- `fillerPad` – seconds of context trimmed before/after each filler occurrence.
- `fillerModel` – `faster-whisper` model name (`base.en`, `small.en`, or a path on disk).
- `language` – language hint passed to the transcription engine.
- `denoiseModel` – RNNoise model used when `video-denoise` runs without `-m` (defaults to GregorR’s “somnolent-hogwash” model).
- `video-transcribe` accepts `--model` / `--language` per run; adjust defaults by wrapping the command or updating your shell aliases.

Example snippet:
```nix
{
  hub.videoEditing = {
    enable = true;
    fillerPad = 0.05;
    fillerWords = [ "uh" "um" "like" "you know" ];
    fillerModel = "small.en";
  };
}
```

Whisper models download on first run and are cached by `faster-whisper`.

## Requirements

The module installs `ffmpeg`, `sox`, `video-denoise`, and `video-trim-fillers`. GPU use is automatic when available through `faster-whisper`'s device detection.
- Supplying an explicit output path automatically creates its parent directory.
