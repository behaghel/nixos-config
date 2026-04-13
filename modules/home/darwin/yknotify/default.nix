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
            set -euo pipefail
            export PATH=${lib.makeBinPath [
              yknotify
              pkgs.terminal-notifier
              pkgs.jq
              pkgs.coreutils
            ]}:/usr/bin:/bin

            # Smart throttle: per touch "session" (events within 10s of each
            # other), send one immediate notification plus one reminder after
            # ~5s, then suppress until the session ends.  This prevents the
            # non-stop notification flood that occurs when scdaemon keeps
            # polling a YubiKey waiting for touch.
            LAST_NOTIFY=0
            LAST_EVENT=0
            SESSION_COUNT=0

            ${yknotify}/bin/yknotify | while IFS= read -r line; do
              NOW="$(date +%s)"

              # Reset session after 10s of silence from yknotify
              if [ "$((NOW - LAST_EVENT))" -gt 10 ]; then
                SESSION_COUNT=0
              fi
              LAST_EVENT="$NOW"

              # Already sent initial + reminder → suppress until session ends
              if [ "$SESSION_COUNT" -ge 2 ]; then
                continue
              fi

              # Reminder waits 5s after the first notification
              if [ "$SESSION_COUNT" -eq 1 ] && [ "$NOW" -le "$((LAST_NOTIFY + 5))" ]; then
                continue
              fi

              SESSION_COUNT=$((SESSION_COUNT + 1))
              LAST_NOTIFY="$NOW"

              msg="$(printf '%s' "$line" | jq -r '.type // "touch"')"

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
