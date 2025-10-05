{ pkgs, lib, config, ... }:
let
  cfg = config.hub.videoEditing;
  inherit (lib) mkEnableOption mkOption mkIf types;

  ffmpeg = pkgs.ffmpeg;
  pythonEnv = pkgs.python3.withPackages (ps: with ps; [ faster-whisper numpy soundfile tqdm ]);

  defaultDenoiseModel = pkgs.fetchurl {
    url = "https://raw.githubusercontent.com/GregorR/rnnoise-models/master/somnolent-hogwash-2018-09-01/sh.rnnn";
    sha256 = "1h6y7wpsjwzansqjx05i21q32fdxpwzwm3ciw8c1sahcxf2ndfvh";
  };

  transcribeScript = import ./transcribe.nix {
    inherit pkgs pythonEnv ffmpeg;
  };
  denoiseScript = import ./denoise.nix {
    inherit pkgs ffmpeg;
    defaultModel = cfg.denoiseModel;
  };
  trimFillersScript = import ./trim-fillers.nix {
    inherit pkgs ffmpeg pythonEnv;
    cfg = cfg;
  };
  batchScript = import ./batch.nix {
    inherit pkgs;
    transcribe = transcribeScript;
    denoise = denoiseScript;
    trimFillers = trimFillersScript;
  };
  textEditScript = import ./text-edit.nix {
    inherit pkgs ffmpeg;
  };
in
{
  options.hub.videoEditing = {
    enable = mkEnableOption "Video editing helper commands (denoise, filler trimming)";

    fillerWords = mkOption {
      type = types.listOf types.str;
      default = [ "um" "uh" "er" "ah" "hmm" "like" ];
      description = ''Default filler words to remove when using video-trim-fillers.'';
    };

    fillerPad = mkOption {
      type = types.float;
      default = 0.08;
      description = "Seconds of padding to remove around each filler word.";
    };

    fillerModel = mkOption {
      type = types.str;
      default = "base.en";
      description = ''Default faster-whisper model name or path. Models download on first use.'';
    };

    language = mkOption {
      type = types.str;
      default = "en";
      description = "Language hint passed to the transcription model.";
    };

    denoiseModel = mkOption {
      type = types.nullOr types.path;
      default = defaultDenoiseModel;
      description = ''Default RNNoise model path used by `video-denoise` when `-m` is not supplied.'';
    };
  };

  config = mkIf cfg.enable {
    home.packages = [
      transcribeScript
      denoiseScript
      trimFillersScript
      batchScript
      textEditScript
      ffmpeg
      pkgs.sox
    ];
  };
}
