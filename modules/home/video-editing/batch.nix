{ pkgs, transcribe, denoise, trimFillers }:
let
  coreutils = pkgs.coreutils;
  transcribeCmd = "${transcribe}/bin/video-transcribe";
  denoiseCmd = "${denoise}/bin/video-denoise";
  trimCmd = "${trimFillers}/bin/video-trim-fillers";
in
pkgs.writeShellApplication {
  name = "video-batch";
  runtimeInputs = [ coreutils transcribe denoise trimFillers ];
  text = ''
    set -euo pipefail

    usage() {
      cat <<'USAGE'
Usage: video-batch [OPTIONS] INPUT...

Run the video-denoise and video-trim-fillers helpers over one or more files.
By default each INPUT is denoised into <name>.denoise.<ext> and then trimmed
into <name>.denoise.trim.<ext>.

Options:
  --skip-denoise        Skip the denoise stage and only run filler trimming.
  --skip-trim           Skip filler trimming; only denoise outputs are produced.
  --transcribe-manifest PATH  Run video-transcribe and write manifest before other stages.
  --skip-transcribe          Skip the transcription stage.
  --transcribe-model NAME    Model override for video-transcribe.
  --transcribe-language LANG Language override for video-transcribe.
  --denoise-dir DIR          Write denoised files into DIR (created if necessary).
  --trim-dir DIR             Write trimmed files into DIR.
  -h, --help            Show this help text.
USAGE
    }

    skip_transcribe=0
    skip_denoise=0
    skip_trim=0
    transcribe_manifest=""
    transcribe_model=""
    transcribe_language=""
    denoise_dir=""
    trim_dir=""
    inputs=()

    while [ $# -gt 0 ]; do
      case "$1" in
       --skip-denoise)
          skip_denoise=1
          shift
          ;;
        --skip-trim)
          skip_trim=1
          shift
          ;;
        --skip-transcribe)
          skip_transcribe=1
          shift
          ;;
        --transcribe-manifest)
          if [ $# -lt 2 ]; then
            echo "video-batch: --transcribe-manifest needs an argument" >&2
            exit 1
          fi
          transcribe_manifest="$2"
          shift 2
          ;;
        --transcribe-model)
          if [ $# -lt 2 ]; then
            echo "video-batch: --transcribe-model needs an argument" >&2
            exit 1
          fi
          transcribe_model="$2"
          shift 2
          ;;
        --transcribe-language)
          if [ $# -lt 2 ]; then
            echo "video-batch: --transcribe-language needs an argument" >&2
            exit 1
          fi
          transcribe_language="$2"
          shift 2
          ;;
        --denoise-dir)
          if [ $# -lt 2 ]; then
            echo "video-batch: --denoise-dir needs an argument" >&2
            exit 1
          fi
          denoise_dir="$2"
          shift 2
          ;;
        --trim-dir)
          if [ $# -lt 2 ]; then
            echo "video-batch: --trim-dir needs an argument" >&2
            exit 1
          fi
          trim_dir="$2"
          shift 2
          ;;
        --help|-h)
          usage
          exit 0
          ;;
        --)
          shift
          while [ $# -gt 0 ]; do
            inputs+=( "$1" )
            shift
          done
          break
          ;;
        -*)
          echo "video-batch: unknown option '$1'" >&2
          usage >&2
          exit 1
          ;;
        *)
          inputs+=( "$1" )
          shift
          ;;
      esac
    done

    if [ ''${#inputs[@]} -lt 1 ]; then
      usage >&2
      exit 1
    fi

    if [ $skip_transcribe -eq 1 ] && [ $skip_denoise -eq 1 ] && [ $skip_trim -eq 1 ]; then
      echo "video-batch: all stages disabled" >&2
      exit 1
    fi

    if [ $skip_transcribe -eq 0 ]; then
      if [ -z "$transcribe_manifest" ]; then
        first_base=$(basename -- "''${inputs[0]}")
        case "$first_base" in
          *.*)
            transcribe_manifest="''${first_base%.*}.tjm.json"
            ;;
          *)
            transcribe_manifest="''${first_base}.tjm.json"
            ;;
        esac
      fi

      transcribe_dir=$(dirname -- "$transcribe_manifest")
      if [ "$transcribe_dir" != "." ]; then
        mkdir -p -- "$transcribe_dir"
      fi

      cmd=("${transcribeCmd}" --output "$transcribe_manifest")
      if [ -n "$transcribe_model" ]; then
        cmd+=("--model" "$transcribe_model")
      fi
      if [ -n "$transcribe_language" ]; then
        cmd+=("--language" "$transcribe_language")
      fi
      cmd+=("--pretty")
      for item in "''${inputs[@]}"; do
        cmd+=("$item")
      done
      echo "[video-batch] transcribe -> $transcribe_manifest"
      "''${cmd[@]}"
    fi

    mkdir_if_needed() {
      local path="$1"
      local dir
      dir=$(dirname -- "$path")
      if [ "$dir" != "." ]; then
        mkdir -p -- "$dir"
      fi
    }

    denoise_out_path() {
      local input="$1"
      local base dir name ext
      dir=$(dirname -- "$input")
      base=$(basename -- "$input")
      case "$base" in
        *.*)
          name="''${base%.*}"
          ext=".''${base##*.}"
          ;;
        *)
          name="$base"
          ext=""
          ;;
      esac
      local out="''${name}.denoise''${ext}"
      if [ -n "$denoise_dir" ]; then
        mkdir -p -- "$denoise_dir"
        printf '%s\n' "$denoise_dir/$out"
      elif [ "$dir" = "." ]; then
        printf '%s\n' "$out"
      else
        printf '%s/%s\n' "$dir" "$out"
      fi
    }

    trim_out_path() {
      local input="$1"
      local base dir name ext
      dir=$(dirname -- "$input")
      base=$(basename -- "$input")
      case "$base" in
        *.*)
          name="''${base%.*}"
          ext=".''${base##*.}"
          ;;
        *)
          name="$base"
          ext=""
          ;;
      esac
      local out="''${name}.trim''${ext}"
      if [ -n "$trim_dir" ]; then
        mkdir -p -- "$trim_dir"
        printf '%s\n' "$trim_dir/$out"
      elif [ "$dir" = "." ]; then
        printf '%s\n' "$out"
      else
        printf '%s/%s\n' "$dir" "$out"
      fi
    }

    process_file() {
      local source="$1"
      local current_input="$source"
      local denoised_path=""
      local trimmed_path=""

      if [ $skip_denoise -eq 0 ]; then
        denoised_path=$(denoise_out_path "$current_input")
        mkdir_if_needed "$denoised_path"
        echo "[video-batch] denoise: $current_input -> $denoised_path"
        "${denoiseCmd}" "$current_input" "$denoised_path"
        current_input="$denoised_path"
      fi

      if [ $skip_trim -eq 0 ]; then
        trimmed_path=$(trim_out_path "$current_input")
        mkdir_if_needed "$trimmed_path"
        echo "[video-batch] trim    : $current_input -> $trimmed_path"
        "${trimCmd}" "$current_input" "$trimmed_path"
      fi
    }

    for input in "''${inputs[@]}"; do
      if [ ! -f "$input" ]; then
        echo "video-batch: input '$input' not found" >&2
        continue
      fi
      process_file "$input"
    done
  '';
}
