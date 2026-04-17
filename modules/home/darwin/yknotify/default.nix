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
    launchd.agents =
      let
        yknotifyScript = pkgs.writeShellScript "yknotify-wrapper.sh" ''
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

        yknotifyWakeWatchdog = pkgs.writeShellScript "yknotify-wake-watchdog.sh" ''
          export PATH=${lib.makeBinPath [ pkgs.coreutils ]}:/usr/bin:/bin

          set -eu

          state_dir="$HOME/Library/Caches"
          state_file="$state_dir/yknotify-watchdog.last"
          restart_guard_file="$state_dir/yknotify-watchdog.restart-last"
          log_file="$HOME/Library/Logs/yknotify.log"
          now="$(date +%s)"
          last=0
          last_restart=0

          mkdir -p "$state_dir"
          if [ -f "$state_file" ]; then
            last="$(cat "$state_file" 2>/dev/null || printf '0')"
          fi
          if [ -f "$restart_guard_file" ]; then
            last_restart="$(cat "$restart_guard_file" 2>/dev/null || printf '0')"
          fi
          printf '%s\n' "$now" > "$state_file"

          restart_yknotify() {
            local reason="$1"
            if [ "$((now - last_restart))" -lt 300 ]; then
              return 0
            fi
            printf '%s\n' "$now" > "$restart_guard_file"
            echo "$(date '+%Y-%m-%d %H:%M:%S') $reason; restarting yknotify" >> "$log_file"
            /bin/launchctl kickstart -k "gui/$(/usr/bin/id -u)/org.nixos.yknotify" || true
          }

          if [ "$last" -gt 0 ] && [ "$((now - last))" -gt 180 ]; then
            restart_yknotify "wake gap detected ($((now - last))s)"
          fi

          if [ -f "$log_file" ]; then
            recent_notify_lines="$(${pkgs.coreutils}/bin/tail -n 12 "$log_file" | /usr/bin/grep ' notify: ' || true)"
            recent_count="$(printf '%s\n' "$recent_notify_lines" | /usr/bin/sed '/^$/d' | /usr/bin/wc -l | /usr/bin/tr -d ' ')"

            if [ "${recent_count:-0}" -ge 6 ]; then
              first_ts="$(printf '%s\n' "$recent_notify_lines" | /usr/bin/sed -n '1s/^\(.\{19\}\).*/\1/p')"
              last_ts="$(printf '%s\n' "$recent_notify_lines" | /usr/bin/sed -n '$s/^\(.\{19\}\).*/\1/p')"
              first_epoch="$(date -d "$first_ts" +%s 2>/dev/null || printf '0')"
              last_epoch="$(date -d "$last_ts" +%s 2>/dev/null || printf '0')"
              unique_types="$(printf '%s\n' "$recent_notify_lines" | /usr/bin/sed 's/^.*notify: //' | /usr/bin/sort -u | /usr/bin/wc -l | /usr/bin/tr -d ' ')"

              if [ "$first_epoch" -gt 0 ] && [ "$last_epoch" -gt 0 ] && [ "$((last_epoch - first_epoch))" -ge 100 ] && [ "$unique_types" -eq 1 ]; then
                only_type="$(printf '%s\n' "$recent_notify_lines" | /usr/bin/sed -n '1s/^.*notify: //p')"
                restart_yknotify "runaway notify streak detected (${only_type})"
              fi
            fi
          fi
        '';
      in {
        yknotify = {
          enable = true;
          config = {
            Label = "org.nixos.yknotify";
            ProgramArguments = [ (toString yknotifyScript) ];
            KeepAlive = true;
            RunAtLoad = true;
            StandardOutPath = "${config.home.homeDirectory}/Library/Logs/yknotify.log";
            StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/yknotify.log";
          };
        };

        yknotifyWakeWatchdog = {
          enable = true;
          config = {
            Label = "org.nixos.yknotify-wake-watchdog";
            ProgramArguments = [ "/bin/sh" (toString yknotifyWakeWatchdog) ];
            RunAtLoad = true;
            StartInterval = 60;
            StandardOutPath = "${config.home.homeDirectory}/Library/Logs/yknotify.log";
            StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/yknotify.log";
          };
        };
      };
  };
}
