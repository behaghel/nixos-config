{ pkgs, config, lib, ... }:
with lib;

let
  cfg = config.hub.mail;
  cacheDir = "${config.xdg.cacheHome or (config.home.homeDirectory + "/.cache")}/mail-sync";
  stampFile = "${cacheDir}/last";
  alertStampFile = "${cacheDir}/last-alert";
  statusFile = "${cacheDir}/status.json";
  passCacheDir = "${cacheDir}/pass";
  passCacheTtl = 14400; # 4 hours

  cacheArtefacts = import ./cache.nix {
    inherit pkgs lib passCacheDir passCacheTtl;
  };
  inherit (cacheArtefacts) passCacheScript gmailOAuthHelper;

  accountsArtefacts = import ./accounts.nix {
    inherit pkgs lib passCacheScript gmailOAuthHelper;
  };
  inherit (accountsArtefacts) mailAccounts;

  maildir = "${config.home.homeDirectory}/Mail";

  syncArtefacts = import ./sync.nix {
    inherit pkgs lib config maildir;
    stampFile = cfg.stampFile;
    statusFile = cfg.statusFile;
  };
  inherit (syncArtefacts) mailSyncScript mailSyncAutocorrectScript;
  mailTrayScript = syncArtefacts.mailTrayScript;
  trayLauncher = pkgs.writeShellScript "mail-sync-tray-launch" ''
    set -euo pipefail
    RUNTIME_DIR="''${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
    export XDG_RUNTIME_DIR="$RUNTIME_DIR"
    export DBUS_SESSION_BUS_ADDRESS="''${DBUS_SESSION_BUS_ADDRESS:-unix:path=$RUNTIME_DIR/bus}"
    if [ -z "''${WAYLAND_DISPLAY-}" ] && [ -S "$RUNTIME_DIR/wayland-0" ]; then
      export WAYLAND_DISPLAY="wayland-0"
    fi
    if [ -z "''${DISPLAY-}" ] && [ -S /tmp/.X11-unix/X0 ]; then
      export DISPLAY=":0"
    fi
    exec ${mailTrayScript}/bin/mail-tray
  '';
in {
  imports = [ ./imapnotify.nix ];

  options.hub.mail = {
    enable = mkOption {
      description = "Enable mails";
      type = types.bool;
      default = false;
    };
    interval = mkOption {
      description = "How often to sync mail and re-index (systemd timer syntax).";
      type = types.str;
      default = "10m";
      example = "5m";
    };
    cacheDir = mkOption {
      description = "Directory used by mail-sync for cache files and health stamps.";
      type = types.str;
      default = cacheDir;
      readOnly = true;
    };
    stampFile = mkOption {
      description = "File storing the epoch of the last successful mail sync run.";
      type = types.str;
      default = stampFile;
      readOnly = true;
    };
    alertStampFile = mkOption {
      description = "File storing when the last mail-sync health alert was shown.";
      type = types.str;
      default = alertStampFile;
      readOnly = true;
    };
    statusFile = mkOption {
      description = "File storing last mail-sync attempt, success, and status.";
      type = types.str;
      default = statusFile;
      readOnly = true;
    };
  };

  config = mkIf cfg.enable {
    home.packages = with pkgs; [
      mu
      gmailOAuthHelper
      mailTrayScript
    ];

    programs = {
      mu.enable = false;
      msmtp.enable = true;
      gpg.enable = true;
      mbsync = {
        enable = true;
        package = pkgs.isync;
        extraConfig = ''
SyncState "*"

                 '';
      };
    };

    accounts.email = {
      maildirBasePath = maildir;
      accounts = mailAccounts;
    };

    systemd.user.services.mail-sync = lib.mkIf pkgs.stdenv.isLinux {
      Unit = {
        Description = "Fetch mail (mbsync) and index (mu)";
        After = [ "network-online.target" ];
        Wants = [ "network-online.target" ];
        X-RestartIfChanged = false;
      };
      Service = {
        Type = "oneshot";
        Environment = [
          "VERBOSE=0"
          "MAIL_PASS_SUPPRESS_NOTIFY=1"
          "MAIL_SYNC_AUTOCORRECT=1"
        ];
        ExecStart = "${mailSyncScript}/bin/mail-sync-run";
      };
      Install = { WantedBy = [ ]; };
    };

    systemd.user.timers.mail-sync = lib.mkIf pkgs.stdenv.isLinux {
      Unit = { Description = "Periodic mail sync"; };
      Timer = {
        OnBootSec = "1m";
        OnUnitActiveSec = cfg.interval;
        Persistent = true;
        Unit = "mail-sync.service";
      };
      Install = { WantedBy = [ "timers.target" ]; };
    };

    systemd.user.services.mail-sync-health = lib.mkIf pkgs.stdenv.isLinux {
      Unit = { Description = "Mail sync health check"; };
      Service = {
        Type = "oneshot";
        ExecStart = toString (pkgs.writeShellScript "mail-sync-health" ''
          set -eu
          stamp=${lib.escapeShellArg cfg.stampFile}
          alert_stamp=${lib.escapeShellArg cfg.alertStampFile}
          stamp_dir="$(dirname "$stamp")"
          alert_dir="$(dirname "$alert_stamp")"
          mkdir -p "$stamp_dir"
          mkdir -p "$alert_dir"
          now=$(date +%s)
          parse() { s="$1"; case "$s" in *m) echo $(( ''${s%m} * 60 ));; *h) echo $(( ''${s%h} * 3600 ));; *s) echo ''${s%s};; *) echo "$s";; esac; }
          interval_sec=$(parse "${cfg.interval}") || interval_sec=600
          threshold=$(( interval_sec * 3 ))
          critical_threshold=14400
          alert_interval=$(( interval_sec * 3 / 2 ))
          [ "$alert_interval" -lt 900 ] && alert_interval=900
          last=0
          [ -f "$stamp" ] && last=$(cat "$stamp" 2>/dev/null || echo 0)
          age=$(( now - last ))
          last_alert=0
          [ -f "$alert_stamp" ] && last_alert=$(cat "$alert_stamp" 2>/dev/null || echo 0)
          notify=0
          urgency="normal"
          if [ "$last" -eq 0 ] || [ "$age" -gt "$threshold" ]; then
            if [ $(( now - last_alert )) -ge "$alert_interval" ]; then
              notify=1
              if [ "$age" -gt "$critical_threshold" ]; then
                urgency="critical"
              fi
            fi
            if systemctl --user is-active --quiet mail-sync.service; then
              notify=0
            fi
            if [ "$notify" -eq 1 ]; then
              if command -v notify-send >/dev/null 2>&1; then
                if [ "$urgency" = "critical" ]; then
                  notify-send --urgency=critical --expire-time=0 "📭 Mail sync stalled" "Last run: $([ "$last" -eq 0 ] && echo unknown || date -d @"$last")" -i dialog-warning || true
                else
                  notify-send "📭 Mail sync stale" "Last run: $([ "$last" -eq 0 ] && echo unknown || date -d @"$last")" -i mail-unread || true
                fi
              fi
              printf '%s\n' "$now" >"$alert_stamp.tmp" && mv "$alert_stamp.tmp" "$alert_stamp"
            fi
            systemctl --user start mail-sync.service >/dev/null 2>&1 || true
          fi
        '');
      };
      Install = { WantedBy = [ ]; };
    };

    systemd.user.timers.mail-sync-health = lib.mkIf pkgs.stdenv.isLinux {
      Unit = { Description = "Periodic mail sync health check"; };
      Timer = {
        OnBootSec = "5m";
        OnUnitActiveSec = cfg.interval;
        Persistent = true;
        Unit = "mail-sync-health.service";
      };
      Install = { WantedBy = [ "timers.target" ]; };
    };

    systemd.user.services.mail-sync-tray = lib.mkIf pkgs.stdenv.isLinux {
      Unit = {
        Description = "Mail sync tray status";
        After = [ "graphical-session.target" ];
        PartOf = [ "graphical-session.target" ];
      };
      Service = {
        Type = "simple";
        ExecStart = "${trayLauncher}";
        Environment = [
          "MAIL_SYNC_STATUS_FILE=${cfg.statusFile}"
          "MAIL_SYNC_STAMP_FILE=${cfg.stampFile}"
          "MAIL_SYNC_MAILDIR=${maildir}"
          "MAIL_SYNC_INTERVAL=${cfg.interval}"
          "PYSTRAY_BACKEND=appindicator"
          "GI_TYPELIB_PATH=${mailTrayScript.giTypelibPath}"
          "MAIL_TRAY_GI_TYPELIB_PATH=${mailTrayScript.giTypelibPath}"
          "LD_LIBRARY_PATH=${mailTrayScript.giLibraryPath}:$LD_LIBRARY_PATH"
          "PATH=${pkgs.mu}/bin:$PATH"
        ];
      };
      Install = { WantedBy = [ "graphical-session.target" ]; };
    };

    home.shellAliases = {
      mail-sync = "MAIL_SYNC_WAIT=1 ${mailSyncScript}/bin/mail-sync-run";
      mail-sync-verbose = "MAIL_SYNC_WAIT=1 ${mailSyncScript}/bin/mail-sync-run --verbose";
      mail-sync-autocorrect = "${mailSyncAutocorrectScript}/bin/mail-sync-autocorrect";
    };
  };
}
