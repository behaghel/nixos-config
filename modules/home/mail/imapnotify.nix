{ pkgs, config, lib, ... }:
with lib;

let
  cfg = config.hub.mail.imapnotify or {};
  accounts = config.accounts.email.accounts or {};
  maildirBase = config.accounts.email.maildirBasePath or (config.home.homeDirectory + "/Mail");

  # Default: XOAUTH2 Gmail accounts (e.g., work)
  defaultAccounts = builtins.filter (name:
    let a = accounts.${name}; in
      (a ? flavor && a.flavor == "gmail.com") &&
      (a ? mbsync && a.mbsync ? extraConfig && (a.mbsync.extraConfig.account.AuthMechs or "") != null &&
        lib.strings.hasInfix "XOAUTH2" (a.mbsync.extraConfig.account.AuthMechs or ""))
  ) (builtins.attrNames accounts);

  selected = if cfg ? accounts && cfg.accounts != null && cfg.accounts != []
             then cfg.accounts
             else defaultAccounts;

  oauthPrefix = cfg.oauthPassPrefix or {};

  mkOnNewScript = name:
    pkgs.writeShellApplication {
      name = "mail-on-new-${name}";
      runtimeInputs = [ pkgs.isync pkgs.coreutils ]
        ++ lib.optional (cfg.notify or false) pkgs.libnotify;
      text = ''
        set -eu
        export SASL_LOG_LEVEL=0
        # Sync only this account's group ("-a" means all; do not use here).
        # Do not fail the unit if mbsync returns non-zero.
        if ! "${pkgs.isync}/bin/mbsync" ${name}; then
          echo "warning: mbsync returned non-zero for ${name}; proceeding anyway" >&2
        fi
        # Optional desktop notification based on latest Maildir message
        NOTIFY="''${HM_MAIL_NOTIFY:-${if (cfg.notify or false) then "1" else ""}}"
        if [ -n "''${NOTIFY}" ] && command -v notify-send >/dev/null 2>&1; then
          boxdir="${maildirBase}/${name}/inbox/new"
          latest="$(find "$boxdir" -maxdepth 1 -type f -printf '%T@ %p\n' 2>/dev/null | sort -nr | awk 'NR==1{print $2; exit}')"
          if [ -n "$latest" ] && [ -f "$latest" ]; then
            hdrfile="$latest"
            subj="$(sed -n 's/^Subject: //p' "$hdrfile" | head -n1 | tr -d '\r')"
            from="$(sed -n 's/^From: //p' "$hdrfile" | head -n1 | tr -d '\r')"
            # Fallbacks
            [ -z "$subj" ] && subj="New message"
            [ -z "$from" ] && from="Unknown sender"
            # Trim long fields
            trims() { s="$1"; max="$2"; [ "''${#s}" -le "$max" ] && printf '%s' "$s" || printf '%s…' "''${s:0:$max}"; }
            # Extract display name from From (drop email address if present)
            dname="$(printf '%s' "$from" | sed -E 's/^[[:space:]]*"?([^"<]*)"?[[:space:]]*(<.*)?$/\1/' | sed -E 's/[[:space:]]+$//')"
            [ -z "$dname" ] && dname="$from"
            tsubj="$(trims "$subj" 80)"; tfrom="$(trims "$dname" 60)"
            # Build deep-link to Emacs function on click
            msgid="$(grep -i '^Message-Id:' "$hdrfile" | head -n1 | sed -E 's/^Message-Id:[[:space:]]*//I' | tr -d '\r')"
            el="(if (fboundp 'hub/mu4e-open-message-by-id) (hub/mu4e-open-message-by-id \"$msgid\") (progn (require 'mu4e) (mu4e t)))"
            (
              sel="$(notify-send --action=default:Open --action=open:Open --wait "📬 $tsubj — $tfrom" "${name} • INBOX" -i mail-unread || true)"
              case "$sel" in
                default|open)
                  if command -v emacsclient >/dev/null 2>&1; then emacsclient -n -e "$el" >/dev/null 2>&1 || true; fi
                  ;;
              esac
            ) & disown || true
          else
            # No new/ file (e.g., moved to cur quickly); generic notify
            notify-send "📬 New mail" "${name} • INBOX" -i mail-unread || true
          fi
        fi
      '';
    };

  mkGoimapConfig = name:
    let
      a = accounts.${name};
      authMechs = a.mbsync.extraConfig.account.AuthMechs or "";
      isXOAUTH2 = lib.strings.hasInfix "XOAUTH2" authMechs;
      passCmd = if isXOAUTH2 then
        let prefix = oauthPrefix.${name} or ""; in
          if prefix == "" then "gmail-oauth2-token token"
          else "OAUTH_PASS_PREFIX=${prefix} gmail-oauth2-token token"
        else (a.passwordCommand or "");
      user = a.userName or a.address;
      host = a.imap.host or "";
      port = a.imap.port or 993;
      onNew = if (cfg.fullSync or false)
        then "systemctl --user start mail-sync.service"
        else "${(mkOnNewScript name)}/bin/mail-on-new-${name}";
    in ''
configurations:
  - alias: ${name}
    host: ${host}
    port: ${toString port}
    tls: true
    username: ${user}
    ${if isXOAUTH2 then "xoAuth2: true" else ""}
    passwordCMD: "${passCmd}"
    boxes:
      - mailbox: INBOX
        onNewMail: "${onNew}"
'';

  # Generated resources
  xdgFiles = builtins.listToAttrs (map (n: {
    # xdg.configFile keys are relative to XDG config dir
    name = "goimapnotify/${n}.yml";
    value = { text = mkGoimapConfig n; };
  }) selected);

  userServices =
    builtins.listToAttrs (map (n: {
      name = "imap-notify-${n}";
      value = {
        Unit = { Description = "IMAP notify for ${n} (goimapnotify)"; After = [ "network-online.target" ]; Wants = [ "network-online.target" ]; };
        Service = {
          Type = "simple";
          ExecStart = "${pkgs.goimapnotify}/bin/goimapnotify -log-level info -conf ${config.home.homeDirectory}/.config/goimapnotify/${n}.yml";
          Restart = "always";
          RestartSec = 5;
          Environment = [
            "SASL_LOG_LEVEL=0"
            "PATH=${config.home.profileDirectory}/bin:/run/current-system/sw/bin:/usr/bin:/bin"
          ];
        };
        Install = { WantedBy = [ "default.target" ]; };
      };
    }) selected);

in {
  options.hub.mail.imapnotify = {
    enable = mkOption { type = types.bool; default = false; description = "Enable IMAP notify (goimapnotify)."; };
    accounts = mkOption { type = types.listOf types.str; default = []; description = "Accounts to enable IMAP notify for (defaults to XOAUTH2 Gmail accounts)."; };
    oauthPassPrefix = mkOption { type = types.attrsOf types.str; default = {}; description = "Map of account -> OAUTH_PASS_PREFIX for XOAUTH2 token helper."; };
    fullSync = mkOption { type = types.bool; default = false; description = "On new mail, run full mail-sync.service instead of per-account sync+index."; };
    notify = mkOption { type = types.bool; default = false; description = "Send a desktop notification (notify-send) after per-account sync + index (ignored when fullSync=true)."; };
  };

  config = mkIf cfg.enable {
    home.packages = [ pkgs.goimapnotify ] ++ (if cfg.fullSync or false then [] else (map (n: mkOnNewScript n) selected));
    xdg.configFile = xdgFiles;
    systemd.user.services = userServices;
  };
}
