{ pkgs, lib, config, ... }:

let
  cfg = config.hub.pi;
  system = pkgs.stdenv.hostPlatform.system;
  assets = {
    aarch64-darwin = {
      url = "https://github.com/earendil-works/pi/releases/download/v0.74.0/pi-darwin-arm64.tar.gz";
      hash = "sha256-MGMXmCPGqYVjQxIkDFcBUCQxb3/mZh7dQfFMd9ixXhA=";
    };
    x86_64-darwin = {
      url = "https://github.com/earendil-works/pi/releases/download/v0.74.0/pi-darwin-x64.tar.gz";
      hash = "sha256-+mXJjyxlHsL4n7Goo9ybmHlHvJsQI2Gi8XiGKrrMdWA=";
    };
    aarch64-linux = {
      url = "https://github.com/earendil-works/pi/releases/download/v0.74.0/pi-linux-arm64.tar.gz";
      hash = "sha256-JhqpEoeMqYPJA9nEoECDEN2GN7WDCFZR2bXdtwyd9XI=";
    };
    x86_64-linux = {
      url = "https://github.com/earendil-works/pi/releases/download/v0.74.0/pi-linux-x64.tar.gz";
      hash = "sha256-1nZXow1JyfrKgIaNKkvbpN/KwEcCiT9FptFLJJNF640=";
    };
  };
  asset = assets.${system} or (throw "hub.pi: unsupported platform ${system}");

  piPackage = pkgs.stdenvNoCC.mkDerivation rec {
    pname = "pi-coding-agent";
    version = "0.74.0";

    src = pkgs.fetchurl {
      inherit (asset) url hash;
    };

    sourceRoot = "pi";
    dontBuild = true;

    installPhase = ''
      runHook preInstall

      mkdir -p "$out/libexec/pi" "$out/bin"
      cp -R . "$out/libexec/pi"
      ln -s "$out/libexec/pi/pi" "$out/bin/pi"

      runHook postInstall
    '';

    meta = with pkgs.lib; {
      description = "Minimal terminal coding harness";
      homepage = "https://pi.dev";
      license = licenses.mit;
      mainProgram = "pi";
      platforms = builtins.attrNames assets;
    };
  };

  piLocal = pkgs.writeShellApplication {
    name = "pi-local";
    runtimeInputs = [
      cfg.package
      pkgs.ollama
      pkgs.curl
      pkgs.coreutils
    ];
    text = ''
      set -euo pipefail

      agent_dir="$HOME/.local/share/pi-local/agent"
      default_model=${lib.escapeShellArg cfg.local.defaultModel}
      selected_model="''${PI_LOCAL_MODEL:-$default_model}"
      explicit_pi_model=""
      previous=""

      for arg in "$@"; do
        if [ "$previous" = "--model" ]; then
          explicit_pi_model="$arg"
          previous=""
          continue
        fi

        case "$arg" in
          --model=*)
            explicit_pi_model="''${arg#--model=}"
            ;;
          --model)
            previous="--model"
            ;;
          *)
            previous=""
            ;;
        esac
      done

      ensure_ollama() {
        if curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
          return 0
        fi

        mkdir -p "$HOME/.cache"
        echo "Starting Ollama on localhost:11434..." >&2
        nohup ollama serve >"$HOME/.cache/pi-local-ollama.log" 2>&1 &

        i=0
        while [ "$i" -lt 30 ]; do
          if curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
            return 0
          fi
          sleep 1
          i=$((i + 1))
        done

        echo "Ollama did not become ready on localhost:11434" >&2
        exit 1
      }

      case "$explicit_pi_model" in
        "")
          pi_model="ollama/$selected_model"
          ollama_model="$selected_model"
          ;;
        ollama/*)
          pi_model="$explicit_pi_model"
          ollama_model="''${explicit_pi_model#ollama/}"
          ;;
        *)
          exec ${lib.getExe cfg.package} "$@"
          ;;
      esac

      ensure_ollama

      mkdir -p "$agent_dir"
      export PI_CODING_AGENT_DIR="$agent_dir"

      if ! ollama show "$ollama_model" >/dev/null 2>&1; then
        echo "Pulling $ollama_model..." >&2
        ollama pull "$ollama_model"
      fi

      if [ -z "$explicit_pi_model" ]; then
        exec ${lib.getExe cfg.package} --model "$pi_model" "$@"
      else
        exec ${lib.getExe cfg.package} "$@"
      fi
    '';
  };

  localModelsJson = builtins.toJSON {
    providers = {
      ollama = {
        baseUrl = "http://localhost:11434/v1";
        api = "openai-completions";
        apiKey = "ollama";
        compat = {
          supportsDeveloperRole = false;
          supportsReasoningEffort = false;
          thinkingFormat = "qwen-chat-template";
        };
        models = [
          {
            id = "qwen2.5-coder:14b";
            name = "Qwen2.5 Coder 14B (default local)";
          }
          {
            id = "qwen2.5-coder:7b";
            name = "Qwen2.5 Coder 7B (lighter fallback)";
          }
          {
            id = "qwen3.6:27b";
            name = "Qwen3.6 27B (heavy opt-in)";
          }
        ];
      };
    };
  };
in
{
  options.hub.pi = {
    enable = lib.mkEnableOption "Pi coding agent";

    package = lib.mkOption {
      type = lib.types.package;
      default = piPackage;
      description = "Pi package to install when hub.pi is enabled.";
    };

    local = {
      enable = lib.mkEnableOption "local Ollama-backed Pi wrapper and generated models.json";

      defaultModel = lib.mkOption {
        type = lib.types.str;
        default = "qwen2.5-coder:14b";
        description = "Default local Ollama model used by pi-local.";
      };
    };

    ds4 = {
      enable = lib.mkEnableOption "DeepSeek-backed Pi wrapper using pass";

      passEntry = lib.mkOption {
        type = lib.types.str;
        default = "dev/deepseek-api-key";
        description = "Password-store entry used to populate DEEPSEEK_API_KEY for pi-ds4.";
      };

      model = lib.mkOption {
        type = lib.types.str;
        default = "deepseek-v4-flash";
        description = "Pi model name used by pi-ds4.";
      };
    };

  };

  config = lib.mkIf cfg.enable {
    home.packages =
      [ cfg.package ]
      ++ lib.optionals cfg.local.enable [ piLocal pkgs.ollama ];

    hub.passLaunchers =
      lib.optionalAttrs cfg.ds4.enable {
        pi-ds4 = {
          enable = true;
          command = [
            (lib.getExe cfg.package)
            "--model"
            cfg.ds4.model
          ];
          passEnv.DEEPSEEK_API_KEY = cfg.ds4.passEntry;
        };
      };

    home.file = lib.mkIf cfg.local.enable {
      ".local/share/pi-local/agent/models.json".text = localModelsJson;
    };
  };
}
