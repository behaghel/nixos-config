{ config, pkgs, lib, ... }:

let
  cfg = config.hub.yknotify;
  yknotify = pkgs.callPackage ./package.nix { };
in
{
  options.hub.yknotify = {
    enable = lib.mkOption {
      type = lib.types.bool;
      default = config.programs.gpg.expectSmartcard;
      description = ''
        Show a macOS notification when the YubiKey is waiting for a
        physical touch (FIDO2 or OpenPGP).
      '';
    };

    sound = lib.mkOption {
      type = lib.types.str;
      default = "Submarine";
      description = "macOS notification sound name.";
    };

    reminderSeconds = lib.mkOption {
      type = lib.types.int;
      default = 20;
      description = ''
        Seconds between repeated notifications while the same touch request
        continues.
      '';
    };

    sessionTimeoutSeconds = lib.mkOption {
      type = lib.types.int;
      default = 10;
      description = ''
        Seconds of silence after which a new YubiKey touch request is treated
        as a new session.
      '';
    };
  };

  config = lib.mkIf (cfg.enable && pkgs.stdenv.isDarwin) {
    launchd.agents.yknotify = {
      enable = true;
      config =
        let
          script = pkgs.writeShellScript "yknotify-wrapper.sh" ''
            export PATH=${lib.makeBinPath [
              yknotify
              pkgs.terminal-notifier
              pkgs.jq
              pkgs.coreutils
            ]}:/usr/bin:/bin

            set -eu

            LAST_EVENT=0
            LAST_NOTIFY=0

            ${yknotify}/bin/yknotify | while IFS= read -r line; do
              NOW="$(date +%s)"

              # New session after enough silence from yknotify.
              if [ "$LAST_EVENT" -eq 0 ] || [ "$((NOW - LAST_EVENT))" -gt ${toString cfg.sessionTimeoutSeconds} ]; then
                LAST_NOTIFY=0
              fi
              LAST_EVENT="$NOW"

              # Notify immediately, then periodically while the request persists.
              if [ "$LAST_NOTIFY" -ne 0 ] && [ "$((NOW - LAST_NOTIFY))" -lt ${toString cfg.reminderSeconds} ]; then
                continue
              fi
              LAST_NOTIFY="$NOW"

              msg="$(printf '%s' "$line" | jq -r '.type // "touch"')" || msg="touch"
              echo "$(date '+%Y-%m-%d %H:%M:%S') notify: $msg"

              if ! terminal-notifier \
                -title "YubiKey" \
                -message "Tap your key ($msg)" \
                -sound "${cfg.sound}"
              then
                echo "$(date '+%Y-%m-%d %H:%M:%S') terminal-notifier failed"
              fi
            done
          '';
        in
        {
          Label = "org.nixos.yknotify";
          ProgramArguments = [ (toString script) ];
          KeepAlive = true;
          RunAtLoad = true;
          StandardOutPath = "${config.home.homeDirectory}/Library/Logs/yknotify.log";
          StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/yknotify.log";
        };
    };
  };
}
