{ pkgs, ffmpeg ? pkgs.ffmpeg, defaultModel ? null }:
let
  defaultModelPath = if defaultModel == null then "" else toString defaultModel;
in
pkgs.writeShellApplication {
  name = "video-denoise";
  runtimeInputs = [ ffmpeg pkgs.coreutils ];
  text = ''
    set -euo pipefail

    usage() {
      cat <<'USAGE'
Usage: video-denoise [-m model-path] [-f extra-filter] [-C] INPUT [OUTPUT]

Apply RNNoise-based denoising to the primary audio stream of INPUT.
When OUTPUT is omitted, the result is written next to INPUT using the pattern
<basename>.denoise.<ext> (or <basename>.denoise if no extension).

By default the video stream is re-encoded (libx264) so audio/video timestamps stay in sync.
Pass -C to copy the original video stream instead.

Options:
  -m MODEL   Optional RNNoise model path passed to ffmpeg's arnndn filter.
             Defaults to ARNNDN_MODEL env var or the module's configured default.
  -f FILTER  Additional ffmpeg audio filters to append after denoising.
  -C         Copy the original video stream instead of re-encoding it.
  -h         Show this help.
USAGE
    }

    default_model="${defaultModelPath}"
    model="''${ARNNDN_MODEL-}"
    extra_filter=""
    copy_video=0

    while getopts ":m:f:hC" opt; do
      case "''${opt}" in
        m) model="''${OPTARG}" ;;
        f) extra_filter="''${OPTARG}" ;;
        C) copy_video=1 ;;
        h)
          usage
          exit 0
          ;;
        *)
          usage >&2
          exit 1
          ;;
      esac
    done

    shift "''$((OPTIND-1))"

    if [ "''$#" -lt 1 ] || [ "''$#" -gt 2 ]; then
      usage >&2
      exit 1
    fi

    input="''$1"
    if [ "''$#" -eq 2 ]; then
      output="''$2"
    else
      input_dir="$(dirname -- "''${input}")"
      input_base="$(basename -- "''${input}")"
      case "''${input_base}" in
        *.*)
          input_name="''${input_base%.*}"
          input_ext=".''${input_base##*.}"
          ;;
        *)
          input_name="''${input_base}"
          input_ext=""
          ;;
      esac
      output_file="''${input_name}.denoise''${input_ext}"
      if [ "''${input_dir}" = "." ]; then
        output="''${output_file}"
      else
        output="''${input_dir}/''${output_file}"
      fi
    fi

    if [ ! -f "''${input}" ]; then
      echo "video-denoise: input '""''${input}""' not found" >&2
      exit 1
    fi

    if [ -z "''${model}" ] && [ -n "''${default_model}" ]; then
      model="''${default_model}"
    fi

    if [ -n "''${model}" ] && [ ! -f "''${model}" ]; then
      echo "video-denoise: RNNoise model '""''${model}""' not found" >&2
      exit 1
    fi

    out_dir="$(dirname -- "''${output}")"
    if [ "''${out_dir}" != "." ]; then
      mkdir -p "''${out_dir}"
    fi

    filter="arnndn"
    if [ -n "''${model}" ]; then
      filter="arnndn=m=''${model}"
    fi

    filter="''${filter},aresample=async=1:first_pts=0"

    if [ -n "''${extra_filter}" ]; then
      filter="''${filter},''${extra_filter}"
    fi

    has_video=0
    if ${ffmpeg}/bin/ffprobe -v error -select_streams v:0 -show_entries stream=index -of csv=p=0 "''${input}" >/dev/null 2>&1; then
      has_video=1
    fi

    if [ "''${has_video}" -eq 1 ]; then
      if [ "''${copy_video}" -eq 1 ]; then
        ${ffmpeg}/bin/ffmpeg \
          -y -i "''${input}" \
          -filter:a "''${filter}" \
          -c:v copy \
          -vsync passthrough \
          -c:a aac \
          -movflags +faststart \
          "''${output}"
      else
        ${ffmpeg}/bin/ffmpeg \
          -y -i "''${input}" \
          -filter:a "''${filter}" \
          -c:v libx264 \
          -preset medium \
          -crf 18 \
          -pix_fmt yuv420p \
          -c:a aac \
          -movflags +faststart \
          "''${output}"
      fi
    else
      ${ffmpeg}/bin/ffmpeg \
        -y -i "''${input}" \
        -af "''${filter}" \
        "''${output}"
    fi
  '';
}
