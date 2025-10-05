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
    -f lavfi -i testsrc2=size=320x240:rate=30:duration=2 \
    -f lavfi -i sine=frequency=440:duration=2 \
    -c:v libx264 -preset veryfast -pix_fmt yuv420p \
    -c:a aac -movflags +faststart sample.mp4

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
      "end": 1.0,
      "text": "segment one",
      "words": [
        { "start": 0.0, "end": 0.3, "token": "segment" },
        { "start": 0.3, "end": 0.6, "token": "one" }
      ],
      "tags": [],
      "notes": "",
      "broll": null
    }
  ]
}
JSON

  video-text-edit edit.tjm.json --output final.mp4
  test -s final.mp4

  video-batch sample.mp4 --skip-trim --transcribe-manifest batch.json --denoise-dir denoised_out
  test -s denoised_out/sample.denoise.mp4
  test -s batch.json

  echo ok > $out
''
