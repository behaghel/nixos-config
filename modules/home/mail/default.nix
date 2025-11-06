{ pkgs, config, lib, ... }:
with lib;

let
  cfg = config.hub.mail;
  cacheDir = "${config.xdg.cacheHome or (config.home.homeDirectory + "/.cache")}/mail-sync";
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
    inherit pkgs lib config maildir cacheDir;
  };
  inherit (syncArtefacts) mailSyncScript;
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
  };

  config = mkIf cfg.enable {
    home.packages = with pkgs; [
      mu
      gmailOAuthHelper
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

    systemd.user.services.mail-sync = {
      Unit = {
        Description = "Fetch mail (mbsync) and index (mu)";
        After = [ "network-online.target" ];
        Wants = [ "network-online.target" ];
        X-RestartIfChanged = false;
      };
      Service = {
        Type = "oneshot";
        Environment = [ "VERBOSE=0" "MAIL_PASS_SUPPRESS_NOTIFY=1" ];
        ExecStart = "${mailSyncScript}/bin/mail-sync-run";
      };
      Install = { WantedBy = [ ]; };
    };

    systemd.user.timers.mail-sync = {
      Unit = { Description = "Periodic mail sync"; };
      Timer = {
        OnBootSec = "1m";
        OnUnitActiveSec = cfg.interval;
        Persistent = true;
        Unit = "mail-sync.service";
      };
      Install = { WantedBy = [ "timers.target" ]; };
    };

    systemd.user.services.mail-sync-health = {
      Unit = { Description = "Mail sync health check"; };
      Service = {
        Type = "oneshot";
        ExecStart = toString (pkgs.writeShellScript "mail-sync-health" ''
          set -eu
          cache_dir=${lib.escapeShellArg cacheDir}
          mkdir -p "$cache_dir"
          stamp="$cache_dir/last"
          alert_stamp="$cache_dir/last-alert"
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
            if [ "$notify" -eq 1 ] && command -v notify-send >/dev/null 2>&1; then
              if [ "$urgency" = "critical" ]; then
                notify-send --urgency=critical --expire-time=0 "📭 Mail sync stalled" "Last run: $([ "$last" -eq 0 ] && echo unknown || date -d @"$last")" -i dialog-warning || true
              else
                notify-send "📭 Mail sync stale" "Last run: $([ "$last" -eq 0 ] && echo unknown || date -d @"$last")" -i mail-unread || true
              fi
              printf '%s\n' "$now" >"$alert_stamp.tmp" && mv "$alert_stamp.tmp" "$alert_stamp"
            fi
            systemctl --user start mail-sync.service >/dev/null 2>&1 || true
          fi
        '');
      };
      Install = { WantedBy = [ ]; };
    };

    systemd.user.timers.mail-sync-health = {
      Unit = { Description = "Periodic mail sync health check"; };
      Timer = {
        OnBootSec = "5m";
        OnUnitActiveSec = cfg.interval;
        Persistent = true;
        Unit = "mail-sync-health.service";
      };
      Install = { WantedBy = [ "timers.target" ]; };
    };

    home.shellAliases.mail-sync = "VERBOSE=1 MAIL_SYNC_WAIT=1 ${mailSyncScript}/bin/mail-sync-run";
  };
}
