{ pkgs }:
let
  pythonEnv = pkgs.python3.withPackages (ps: with ps; [ faster-whisper numpy soundfile tqdm ]);
  ffmpeg = pkgs.ffmpeg;
  defaultDenoiseModel = pkgs.fetchurl {
    url = "https://raw.githubusercontent.com/GregorR/rnnoise-models/master/somnolent-hogwash-2018-09-01/sh.rnnn";
    sha256 = "1h6y7wpsjwzansqjx05i21q32fdxpwzwm3ciw8c1sahcxf2ndfvh";
  };

  transcribe = import ../modules/home/video-editing/transcribe.nix {
    inherit pkgs pythonEnv ffmpeg;
  };
  denoise = import ../modules/home/video-editing/denoise.nix {
    inherit pkgs ffmpeg;
    defaultModel = defaultDenoiseModel;
  };
  trim = import ../modules/home/video-editing/trim-fillers.nix {
    inherit pkgs ffmpeg pythonEnv;
    cfg = {
      fillerWords = [ "um" "uh" ];
      fillerPad = 0.05;
      fillerModel = "base.en";
      language = "en";
    };
  };
  batch = import ../modules/home/video-editing/batch.nix {
    inherit pkgs transcribe denoise;
    trimFillers = trim;
  };
  textEdit = import ../modules/home/video-editing/text-edit.nix {
    inherit pkgs ffmpeg;
  };
in
pkgs.runCommand "video-editing-tests" {
  buildInputs = [
    ffmpeg
    pkgs.coreutils
    pkgs.jq
    transcribe
    denoise
    trim
    batch
    textEdit
  ];
} ''
  set -euo pipefail
  export PATH=${transcribe}/bin:${denoise}/bin:${trim}/bin:${batch}/bin:${textEdit}/bin:$PATH

  mkdir work
  cd work

  export VIDEO_TRANSCRIBE_STUB=1

  ffmpeg -hide_banner -loglevel error \
    -f lavfi -i testsrc2=size=320x240:rate=30:duration=3 \
    -f lavfi -i sine=frequency=440:duration=3 \
    -c:v libx264 -preset veryfast -pix_fmt yuv420p \
    -c:a aac -movflags +faststart sample.mp4

  ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=blue:s=320x240 -frames:v 1 still.png
  ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc=size=160x120:rate=30 -t 2 pip.mp4

  video-denoise sample.mp4 denoised.mp4
  test -s denoised.mp4

  video-transcribe --output transcript.json --model tiny.en --pretty --stub sample.mp4
  jq '.sources | length' transcript.json | grep 1

  cat > edit.tjm.json <<'JSON'
{
  "version": 1,
  "sources": [ { "id": "clip01", "file": "sample.mp4" } ],
  "segments": [
    {
      "id": "clip01-s0001",
      "source": "clip01",
      "start": 0.0,
      "end": 0.6,
      "text": "segment one",
      "words": [
        { "start": 0.0, "end": 0.3, "token": "segment" },
        { "start": 0.3, "end": 0.6, "token": "one" }
      ],
      "tags": [],
      "notes": "",
      "broll": null
    },
    {
      "id": "clip01-s0002",
      "source": "clip01",
      "start": 0.9,
      "end": 1.5,
      "text": "segment two",
      "words": [
        { "start": 0.9, "end": 1.2, "token": "segment" },
        { "start": 1.2, "end": 1.5, "token": "two" }
      ],
      "tags": [],
      "notes": "",
      "broll": {
        "file": "still.png",
        "mode": "replace",
        "still": true,
        "duration": "0:00:00.6"
      }
    },
    {
      "id": "clip01-s0003",
      "source": "clip01",
      "start": 1.5,
      "end": 2.0,
      "text": "segment three",
      "words": [
        { "start": 1.5, "end": 1.7, "token": "segment" },
        { "start": 1.7, "end": 2.0, "token": "three" }
      ],
      "tags": [],
      "notes": "",
      "broll": {
        "file": "pip.mp4",
        "mode": "pip",
        "start_offset": 0.2,
        "duration": 0.5,
        "position": { "x": 0.7, "y": 0.7, "width": 0.25 }
      }
    },
    {
      "id": "clip01-s0004",
      "kind": "marker",
      "title": "Break",
      "notes": "forces unit split"
    },
    {
      "id": "clip01-s0004",
      "source": "clip01",
      "start": 2.0,
      "end": 2.5,
      "text": "segment four",
      "words": [
        { "start": 2.0, "end": 2.2, "token": "segment" },
        { "start": 2.2, "end": 2.5, "token": "four" }
      ],
      "tags": [],
      "notes": "",
      "broll": {
        "file": "pip.mp4",
        "mode": "pip",
        "continue": true,
        "duration": 0.5,
        "position": { "x": 0.7, "y": 0.7, "width": 0.25 }
      }
    }
  ]
}
JSON

  video-text-edit edit.tjm.json --output final.mp4 --subtitles final.vtt --preserve-short-gaps 0.5 | tee render.log
  test -s final.mp4
  test -s final.vtt
  ffprobe -loglevel error -select_streams s -show_entries stream=codec_type -of csv=p=0 final.mp4 | grep -q subtitle
  duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 final.mp4)
  awk -v dur="$duration" 'BEGIN { if (dur <= 2.00) exit 1 }'
  grep -q "\[00:02\] Break" render.log
  grep -q "segment clip01-s0004" render.log
  if grep -q "before segment clip01-s0004" render.log; then exit 1; fi

  video-batch sample.mp4 --skip-trim --transcribe-manifest batch.json --denoise-dir denoised_out
  test -s denoised_out/sample.denoise.mp4
  test -s batch.json

  echo ok > $out
''
