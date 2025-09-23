{ pkgs, config, lib, ... }:
with lib;

let
  cfg = config.hub.mail;

  mkBaseAccount = { address, userName ? address, realName ? "Hubert Behaghel"
                  , authMechs, passwordCommand ? null, imap ? null, smtp ? null
                  , gpgKey ? address }:
    {
      inherit address userName realName;
      folders = { inbox = "inbox"; drafts = "drafts"; sent = "sent"; trash = "trash"; };
      gpg.key = gpgKey;
      mu.enable = true;
      msmtp.enable = true;
      mbsync.extraConfig.account = {
        AuthMechs = authMechs;
        TLSType = "IMAPS";
      };
    }
    // optionalAttrs (passwordCommand != null) { inherit passwordCommand; }
    // optionalAttrs (imap != null) { inherit imap; }
    // optionalAttrs (smtp != null) { inherit smtp; };

  mkGmailAccount = { name, email, lang, authMechs, passwordCommand ? null }:
    let
      farSent    = if lang == "fr" then "[Gmail]/Messages envoyés" else "[Gmail]/Sent Mail";
      farTrash   = if lang == "fr" then "[Gmail]/Corbeille"             else "[Gmail]/Trash";
      farStarred = if lang == "fr" then "[Gmail]/Important"             else "[Gmail]/Starred";
      farAll     = if lang == "fr" then "[Gmail]/Tous les messages"      else "[Gmail]/All Mail";
      farSpam    = "[Gmail]/Spam";
      base = mkBaseAccount { address = email; userName = email; inherit authMechs passwordCommand; };
    in base // {
      flavor = "gmail.com";
      imap = { host = "imap.gmail.com"; port = 993; tls.enable = true; };
      smtp = { host = "smtp.gmail.com"; port = 465; tls.enable = true; };
      msmtp = (base.msmtp or { }) // {
        enable = true;
        extraConfig = lib.optionalAttrs (lib.strings.hasInfix "XOAUTH2" authMechs) { auth = "oauthbearer"; };
      };
      mbsync = (base.mbsync or { }) // {
        enable = true; create = "maildir"; remove = "none"; expunge = "both";
        groups.${name}.channels = {
          inbox  = { patterns = [ "INBOX" ];                           extraConfig = { CopyArrivalDate = "yes"; Sync = "All"; }; };
          all    = { farPattern = farAll;      nearPattern = "archive"; extraConfig = { CopyArrivalDate = "yes"; Create = "Near"; Sync = "All"; }; };
          starred= { farPattern = farStarred;  nearPattern = "starred"; extraConfig = { CopyArrivalDate = "yes"; Create = "Near"; Sync = "All"; }; };
          trash  = { farPattern = farTrash;    nearPattern = "trash";   extraConfig = { CopyArrivalDate = "yes"; Create = "Near"; Sync = "All"; }; };
          sent   = { farPattern = farSent;     nearPattern = "sent";    extraConfig = { CopyArrivalDate = "yes"; Create = "Near"; Sync = "Pull"; }; };
          spam   = { farPattern = farSpam;     nearPattern = "spam";    extraConfig = { CopyArrivalDate = "yes"; Create = "Near"; Sync = "Push"; }; };
        };
      };
    };

  mailAccounts = {
    gmail = mkGmailAccount {
      name = "gmail"; email = "behaghel@gmail.com"; lang = "en";
      authMechs = "PLAIN";
      passwordCommand = "${pkgs.pass}/bin/pass online/gmail/app-password-mbsync";
    } // { primary = true; };

    "behaghel.fr" = mkGmailAccount {
      name = "behaghel.fr"; email = "hubert@behaghel.fr"; lang = "fr";
      authMechs = "PLAIN";
      passwordCommand = "${pkgs.pass}/bin/pass online/behaghel.fr/token";
    } // { primary = false; };

    "behaghel.org" = (mkBaseAccount {
      address = "hubert@behaghel.org";
      # Mailfence IMAP username is the local part only (per provider docs)
      userName = "behaghel";
      authMechs = "PLAIN";
      passwordCommand = "${pkgs.pass}/bin/pass online/mailfence.com";
      imap = { host = "imap.mailfence.com"; port = 993; tls.enable = true; };
      smtp = { host = "smtp.mailfence.com"; port = 465; tls.enable = true; };
    }) // {
      primary = false;
      aliases = ["behaghel@mailfence.com"];
      gpg.signByDefault = true;
      mbsync = {
        enable = true; create = "maildir"; remove = "none"; expunge = "both";
        groups."behaghel.org".channels = {
          inbox = { patterns = [ "INBOX" ]; extraConfig = { CopyArrivalDate = "yes"; Sync = "All"; }; };
          archive = { farPattern = "Archive"; nearPattern = "archive"; extraConfig = { CopyArrivalDate = "yes"; Create = "Near"; Sync = "All"; }; };
          trash = { farPattern = "Trash"; nearPattern = "trash"; extraConfig = { CopyArrivalDate = "yes"; Create = "Near"; Sync = "All"; }; };
          sent = { farPattern = "Sent Items"; nearPattern = "sent"; extraConfig = { CopyArrivalDate = "yes"; Create = "Near"; Sync = "All"; }; };
          spam = { farPattern = "Spam?"; nearPattern = "spam"; extraConfig = { CopyArrivalDate = "yes"; Create = "Near"; Sync = "Push"; }; };
        };
        extraConfig = { account = { TLSType = "IMAPS"; }; };
      };
    };

    work = mkGmailAccount {
      name = "work"; email = "hubert.behaghel@veriff.net"; lang = "en";
      authMechs = "XOAUTH2";
      passwordCommand = "OAUTH_PASS_PREFIX=veriff/mail ${gmailOAuthHelper}/bin/gmail-oauth2-token token";
    } // { primary = false; };
  };


  maildir = "${config.home.homeDirectory}/Mail";
  myAddressArgs = with lib; let
    addrs = map (a: a.address) (attrValues mailAccounts);
  in concatStringsSep " " (map (a: "--my-address ${escapeShellArg a}") addrs);

  # IDLE handler moved to modules/home/mail/imapnotify.nix


  # Helper to obtain an OAuth2 access token from a stored refresh token
  # Reads secrets from pass(1): defaults to prefix 'online/work-gmail'
  gmailOAuthHelper = pkgs.writeShellApplication {
    name = "gmail-oauth2-token";
    runtimeInputs = [ pkgs.curl pkgs.jq pkgs.pass pkgs.coreutils pkgs.gnused ];
    text = ''
      set -euo pipefail
      mode="''${1:-token}"
      shift || true

      # Default secret prefix for your work account
      prefix="''${OAUTH_PASS_PREFIX:-veriff/mail}"
      # Allow env overrides; otherwise read from pass(1)
      CLIENT_ID="''${CLIENT_ID:-}"
      CLIENT_SECRET="''${CLIENT_SECRET:-}"
      REFRESH_TOKEN="''${REFRESH_TOKEN:-}"
      if [ -z "''${CLIENT_ID}" ]; then CLIENT_ID="$(pass show "$prefix/client-id" | head -n1 || true)"; fi
      if [ -z "''${CLIENT_SECRET}" ]; then CLIENT_SECRET="$(pass show "$prefix/client-secret" | head -n1 || true)"; fi
      if [ -z "''${REFRESH_TOKEN}" ]; then REFRESH_TOKEN="$(pass show "$prefix/refresh-token" | head -n1 || true)"; fi
      if [ -z "''${CLIENT_ID}" ] || [ -z "''${CLIENT_SECRET}" ] || [ -z "''${REFRESH_TOKEN}" ]; then
        echo "error: missing OAuth secret(s). Expected in env or pass under $prefix/{client-id,client-secret,refresh-token}" >&2
        exit 1
      fi
      resp=$(curl -sS --fail \
        -d client_id="''${CLIENT_ID}" \
        -d client_secret="''${CLIENT_SECRET}" \
        -d refresh_token="''${REFRESH_TOKEN}" \
        -d grant_type=refresh_token \
        https://oauth2.googleapis.com/token) || { echo "error: token endpoint failure" >&2; exit 1; }
      token=$(printf '%s' "$resp" | jq -r '.access_token // empty')
      if [ -z "$token" ]; then
        echo "error: could not parse access_token from response" >&2
        echo "$resp" >&2
        exit 1
      fi

      case "$mode" in
        token)
          printf '%s' "$token" ;;
        xoauth2)
          email="''${1:?usage: gmail-oauth2-token xoauth2 <email>}"
          # Build SASL XOAUTH2 initial client response: base64(user=..\x01auth=Bearer TOKEN\x01\x01)
          printf 'user=%s\001auth=Bearer %s\001\001' "$email" "$token" | base64 | tr -d '\n' ;;
        oauthbearer)
          email="''${1:?usage: gmail-oauth2-token oauthbearer <email> [host] [port]}"; host="''${2:-imap.gmail.com}"; port="''${3:-993}"
          # RFC 7628 OAUTHBEARER: n,a=<authzid>,\x01host=..\x01port=..\x01auth=Bearer TOKEN\x01\x01
          printf 'n,a=%s,\001host=%s\001port=%s\001auth=Bearer %s\001\001' "$email" "$host" "$port" "$token" | base64 | tr -d '\n' ;;
        inspect)
          # Print token metadata (scope, audience, expiry). Beware: sends token to Google tokeninfo.
          curl -sS --fail "https://oauth2.googleapis.com/tokeninfo?access_token=$(printf '%s' "$token" | sed 's/\n$//')" | jq -r . ;;
        profile)
          # Query Gmail profile for the authenticated user to verify scope and account binding.
          curl -sS --fail -H "Authorization: Bearer $token" \
            "https://gmail.googleapis.com/gmail/v1/users/me/profile" | jq -r . ;;
        *)
          echo "error: unknown mode '$mode' (expected: token|xoauth2|oauthbearer|inspect|profile)" >&2; exit 2 ;;
      esac
    '';
  };

  syncScript = pkgs.writeShellScript "mail-sync" ''
    set -eu
    if [ "''${MAIL_SYNC_DEBUG-}" = 1 ]; then set -x; fi
    export PATH=${lib.makeBinPath [ pkgs.isync pkgs.mu pkgs.pass pkgs.coreutils pkgs.util-linux ]}:"$PATH"
    MBSYNC_BIN="${pkgs.isync}/bin/mbsync"
    # Silence Cyrus SASL XOAUTH2 debug chatter
    export SASL_LOG_LEVEL=0
    if [ "''${MAIL_SYNC_DEBUG-}" = 1 ]; then
      echo "mail-sync: using mbsync: $MBSYNC_BIN" >&2
      if command -v ldd >/dev/null 2>&1; then ldd "$MBSYNC_BIN" >&2 || true; fi
    fi
    # prevent overlapping runs
    LOCKFILE="${config.xdg.runtimeDir or "${config.home.homeDirectory}/.cache"}/mail-sync.lock"
    mkdir -p "$(dirname "$LOCKFILE")"
    if command -v flock >/dev/null 2>&1 && [ "''${1:-}" != _locked ]; then
      exec flock -n "$LOCKFILE" "$0" _locked "$@"
    fi
    if [ "''${1:-}" = _locked ]; then shift; fi

    # Ensure maildir exists
    mkdir -p "${maildir}"

    # 1) fetch mail using default config resolution
    "$MBSYNC_BIN" -a || true

    # stamp last successful attempt time (regardless of mbsync exit)
    STAMP_DIR="${config.xdg.cacheHome or (config.home.homeDirectory + "/.cache")}/mail-sync"
    mkdir -p "$STAMP_DIR"
    date +%s >"$STAMP_DIR/last"

    # mu indexing is intentionally left to mu4e/Emacs to avoid lock contention.
    # If needed, create a separate timer to run `mu index` out-of-band.
  '';
in {
  imports = [ ./imapnotify.nix ];
  options = {
    hub.mail = {
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
  };
  config = mkIf (cfg.enable) {
    home.packages = with pkgs; [
      mu
      gmailOAuthHelper
    ];
    programs = {
      # at activation it want to init db
      # but mu isn't in the path => home package instead
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

    # goimapnotify moved to modules/home/mail/imapnotify.nix

    accounts.email = {
      maildirBasePath = maildir;
      accounts = mailAccounts;
    };


    # Fire-and-forget style sync service, triggered by timer only
    systemd.user.services.mail-sync = {
      Unit = {
        Description = "Fetch mail (mbsync) and index (mu)";
        After = [ "network-online.target" ];
        Wants = [ "network-online.target" ];
        X-RestartIfChanged = false;
      };
      Service = {
        Type = "oneshot";
        ExecStart = toString syncScript;
      };
      # Do not hook into default.target; only the timer triggers it.
      Install = { WantedBy = [ ]; };
    };

    # Timer triggers the mail-sync service periodically
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

    # Health check: alert if mail sync appears stale
    systemd.user.services.mail-sync-health = {
      Unit = { Description = "Mail sync health check"; }; 
      Service = {
        Type = "oneshot";
        ExecStart = toString (pkgs.writeShellScript "mail-sync-health" ''
          set -eu
          cache_dir="${config.xdg.cacheHome or (config.home.homeDirectory + "/.cache")}/mail-sync"
          stamp="$cache_dir/last"
          now=$(date +%s)
          # parse interval like 10m/1h into seconds
          parse() { s="$1"; case "$s" in *m) echo $(( ''${s%m} * 60 ));; *h) echo $(( ''${s%h} * 3600 ));; *s) echo ''${s%s};; *) echo "$s";; esac; }
          interval_sec=$(parse "${cfg.interval}") || interval_sec=600
          # consider stale if older than 3x interval
          threshold=$(( interval_sec * 3 ))
          last=0
          [ -f "$stamp" ] && last=$(cat "$stamp" 2>/dev/null || echo 0)
          age=$(( now - last ))
          if [ "$last" -eq 0 ] || [ "$age" -gt "$threshold" ]; then
            if command -v notify-send >/dev/null 2>&1; then
              notify-send "📭 Mail sync stale" "Last run: $([ "$last" -eq 0 ] && echo unknown || date -d @"$last")\nAttempting a sync now." -i mail-unread || true
            fi
            systemctl --user start mail-sync.service || true
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
  };
}
