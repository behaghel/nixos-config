{
  perSystem = { self', pkgs, lib, ... }: {
    # Enables 'nix run' to activate home-manager config.
    apps.default = {
      inherit (self'.packages.activate) meta;
      program = pkgs.writeShellApplication {
        name = "activate-home";
        text = ''
          #!/usr/bin/env bash
          # Be loud and fail fast during activation
          set -Eeuo pipefail
          set -x

          # Capture logs for troubleshooting while still printing to console
          LOG_DIR="''${XDG_CACHE_HOME:-$HOME/.cache}/nix-activate"
          LOG_FILE="$LOG_DIR/activate-home.log"
          mkdir -p "$LOG_DIR"
          # tee both stdout and stderr
          exec > >(tee -a "$LOG_FILE") 2>&1

          trap 'echo "Activation failed. See $LOG_FILE for details." >&2' ERR

          # Forward any extra args to the activator (e.g., --verbose)
          ${lib.getExe self'.packages.activate} "$(id -un)"@ "$@"
        '';
      };
    };
  };
}
