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

            LAST_EVENT=0
            NOTIFIED=0

            ${yknotify}/bin/yknotify | while IFS= read -r line; do
              NOW="$(date +%s)"

              # New session: 15s of silence means previous touch request ended
              if [ "$((NOW - LAST_EVENT))" -gt 15 ]; then
                NOTIFIED=0
              fi
              LAST_EVENT="$NOW"

              # One notification per touch session
              if [ "$NOTIFIED" -eq 1 ]; then
                continue
              fi
              NOTIFIED=1

              msg="$(printf '%s' "$line" | jq -r '.type // "touch"')" || msg="touch"
              echo "$(date '+%Y-%m-%d %H:%M:%S') notify: $msg"

              if command -v terminal-notifier >/dev/null 2>&1; then
                terminal-notifier \
                  -title "YubiKey" \
                  -message "Tap your key ($msg)" \
                  -sound "${cfg.sound}" || true
              else
                /usr/bin/osascript \
                  -e "display notification \"Tap your key ($msg)\" with title \"YubiKey\"" \
                  2>/dev/null || true
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
