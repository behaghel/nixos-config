{ flake, pkgs, ... }:

let
  inherit (flake) inputs;
  inherit (inputs) self;
in
{
  imports = [
    self.darwinModules.default
    ../../modules/nixos/gui/fonts.nix
    ../../modules/darwin/utm-builder.nix
  ];

  nixpkgs.hostPlatform = "aarch64-darwin";
  nixpkgs.config.allowUnfree = true;
  networking.hostName = "F2400216";

  system.primaryUser = "hubertbehaghel";

  # Users provisioned on this host
  myusers = [ "hubertbehaghel" ];

  environment.systemPackages = [
    pkgs.jdk21_headless
    pkgs.qemu
  ];

  hub.darwin.apps = {
    casks = [
      "anki"
      "zotero"
      "1password"
      "codex"
      "iterm2"
    ];
  };

  # No Touch ID override for sudo; fall back to default PAM stack.

  nix.linux-builder.enable = true;

  home-manager.sharedModules = [
    ({ pkgs, ... }:
      let
        pi = pkgs.stdenvNoCC.mkDerivation rec {
          pname = "pi-coding-agent";
          version = "0.70.2";

          src = pkgs.fetchurl {
            url = "https://github.com/badlogic/pi-mono/releases/download/v${version}/pi-darwin-arm64.tar.gz";
            hash = "sha256-TgOQUDZ9gr/5Y+Ff6o2FyiaPewKEuD9fFZOarQhzU6Q=";
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
            platforms = [ "aarch64-darwin" ];
          };
        };

        piLocal = pkgs.writeShellApplication {
          name = "pi-local";
          runtimeInputs = [
            pi
            pkgs.ollama
            pkgs.curl
            pkgs.coreutils
          ];
          text = ''
            set -euo pipefail

            default_model="qwen2.5-coder:14b"
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
                exec pi "$@"
                ;;
            esac

            ensure_ollama

            if ! ollama show "$ollama_model" >/dev/null 2>&1; then
              echo "Pulling $ollama_model..." >&2
              ollama pull "$ollama_model"
            fi

            if [ -z "$explicit_pi_model" ]; then
              exec pi --model "$pi_model" "$@"
            else
              exec pi "$@"
            fi
          '';
        };
      in
      {
        home.packages = [
          pi
          piLocal
          pkgs.ollama
        ];

        home.file.".pi/agent/models.json".text = builtins.toJSON {
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
      })
  ];

  hub.darwin.utmBuilder = {
    enable = true;
    imagePath = "/var/lib/utm-builder/builder-x86_64-25.11.qcow2";
    port = 2223;
    cpus = 4;
    memoryMB = 4096;
    # Key is pre-installed at /etc/nix/utm-builder_ed25519 (git-ignored); leave
    # privateKeySource unset so evaluation does not try to copy it into the store.
    additionalBuilders = [
      "ssh-ng://builder@builder-arm aarch64-linux /etc/nix/builder_ed25519 2 1 kvm,benchmark,big-parallel"
    ];
    sshConfigExtra = ''
      Host builder-arm
        Hostname 127.0.0.1
        Port 31022
        IdentityFile /etc/nix/builder_ed25519
        IdentitiesOnly yes
    '';
  };

  # Make Home Manager share the system pkgs (avoids rebuilding stdenv/toolchain twice).
  home-manager.backupFileExtension = "backup";
  home-manager.useGlobalPkgs = true;
  home-manager.useUserPackages = true;
}
