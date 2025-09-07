{ pkgs, config, lib, ... }:
with lib;

let
  cfg = config.hub.mail;
  emailAccountDefault = email: {
    address = email;
    userName = email;
    realName = "Hubert Behaghel";
    folders = {
      inbox = "inbox";
      drafts = "drafts";
      sent = "sent";
      trash = "trash";
    };
    gpg.key = email;
    mu.enable = true;
    msmtp.enable = true;
  };
  gmailAccount = name: email: lang:
    let
      # Respect per-account Gmail locale folder names (English vs French)
      farSent = if lang == "fr" then "[Gmail]/Messages envoy&AOk-s" else "[Gmail]/Sent Mail";
      farTrash = if lang == "fr" then "[Gmail]/Corbeille" else "[Gmail]/Trash";
      farDraft = if lang == "fr" then "[Gmail]/Brouillons" else "[Gmail]/Draft";
      farStarred = if lang == "fr" then "[Gmail]/Important" else "[Gmail]/Starred";
      farAll = if lang == "fr" then "[Gmail]/Tous les messages" else "[Gmail]/All Mail";
      base = emailAccountDefault email;
    in base // {
      flavor = "gmail.com";
      mbsync = {
        enable = true;
        create = "maildir";
        remove = "none";
        expunge = "both";
        groups.${name}.channels = {
          inbox = {
            patterns = [ "INBOX" ];
            extraConfig = {
              CopyArrivalDate = "yes";
              Sync = "All";
            };
          };
          all = {
            farPattern = farAll;
            nearPattern = "archive";
            extraConfig = {
              CopyArrivalDate = "yes";
              Create = "Near";
              Sync = "All";
            };
          };
          starred = {
            farPattern = farStarred;
            nearPattern = "starred";
            extraConfig = {
              CopyArrivalDate = "yes";
              Create = "Near";
              Sync = "All";
            };
          };
          trash = {
            farPattern = farTrash;
            nearPattern = "trash";
            extraConfig = {
              CopyArrivalDate = "yes";
              Create = "Near";
              Sync = "All";
            };
          };
          sent = {
            farPattern = farSent;
            nearPattern = "sent";
            extraConfig = {
              CopyArrivalDate = "yes";
              Create = "Near";
              Sync = "Pull";
            };
          };
        };
      };
    };
  # Build accounts as an attrset so we can reuse it (mu init, etc.)
  mailAccounts = {
    gmail = gmailAccount "gmail" "behaghel@gmail.com" "en" // {
      primary = true;
      passwordCommand = "${pkgs.pass}/bin/pass online/gmail/token";
    };
    "behaghel.fr" = gmailAccount "behaghel.fr" "hubert@behaghel.fr" "fr" // {
      primary = false;
      passwordCommand = "${pkgs.pass}/bin/pass online/behaghel.fr/token";
    };
    "behaghel.org" = emailAccountDefault "hubert@behaghel.org" // {
      primary = false;
      userName = "behaghel@mailfence.com";
      passwordCommand = "${pkgs.pass}/bin/pass online/mailfence.com";
      aliases = ["behaghel@mailfence.com"];
      gpg.signByDefault = true;
      imap = {
        host = "imap.mailfence.com";
        port = 993;
        tls = {
          enable = true;
        };
      };
      smtp = {
        host = "smtp.mailfence.com";
        port = 465;
        tls = {
          enable = true;
        };
      };
      mbsync = {
        enable = true;
        create = "maildir";
        remove = "none";
        expunge = "both";
        groups."behaghel.org".channels = {
          inbox = {
            # patterns = [ "*" "INBOX" "!Spam?" "!Sent Items" "!Archive" "!Trash" "!Drafts" ];
            patterns = [ "INBOX" ];
            extraConfig = {
              CopyArrivalDate = "yes";
              Sync = "All";
            };
          };
          archive = {
            farPattern = "Archive";
            nearPattern = "archive";
            extraConfig = {
              CopyArrivalDate = "yes";
              Create = "Near";
              Sync = "All";
            };
          };
          trash = {
            farPattern = "Trash";
            nearPattern = "trash";
            extraConfig = {
              CopyArrivalDate = "yes";
              Create = "Near";
              Sync = "All";
            };
          };
          sent = {
            farPattern = "Sent Items";
            nearPattern = "sent";
            extraConfig = {
              CopyArrivalDate = "yes";
              Create = "Near";
              Sync = "All";
            };
          };
        };
      };
    };
  };

  maildir = "${config.home.homeDirectory}/Mail";
  myAddressArgs = with lib; let
    addrs = map (a: a.address) (attrValues mailAccounts);
  in concatStringsSep " " (map (a: "--my-address ${escapeShellArg a}") addrs);

  isyncrcPath = (config.xdg.configHome or "${config.home.homeDirectory}/.config") + "/isyncrc";
  syncScript = pkgs.writeShellScript "mail-sync" ''
    set -eu
    if [ "''${MAIL_SYNC_DEBUG-}" = 1 ]; then set -x; fi
    export PATH=${lib.makeBinPath [ pkgs.isync pkgs.mu pkgs.pass pkgs.coreutils pkgs.util-linux ]}:"$PATH"
    # prevent overlapping runs
    LOCKFILE="${config.xdg.runtimeDir or "${config.home.homeDirectory}/.cache"}/mail-sync.lock"
    mkdir -p "$(dirname "$LOCKFILE")"
    if command -v flock >/dev/null 2>&1 && [ "''${1:-}" != _locked ]; then
      exec flock -n "$LOCKFILE" "$0" _locked "$@"
    fi
    if [ "''${1:-}" = _locked ]; then shift; fi

    # Ensure maildir exists
    mkdir -p "${maildir}"

    # 1) fetch mail (explicit config path to avoid ambiguity warnings)
    ${pkgs.isync}/bin/mbsync -c "${isyncrcPath}" -a || true

    # mu indexing is intentionally left to mu4e/Emacs to avoid lock contention.
    # If needed, create a separate timer to run `mu index` out-of-band.
  '';
in {
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
    ];
    programs = {
      # at activation it want to init db
      # but mu isn't in the path => home package instead
      mu.enable = false;
      msmtp.enable = true;
      gpg.enable = true;
      mbsync = {
        enable = true;
        extraConfig = ''
SyncState "*"

                 '';
      };
    };

    accounts.email = {
      maildirBasePath = maildir;
      accounts = mailAccounts;
    };

    # Periodic sync + index using systemd -- user units
    systemd.user.services.mail-sync = {
      Unit = {
        Description = "Fetch mail (mbsync) and index (mu)";
        After = [ "network-online.target" ];
        Wants = [ "network-online.target" ];
      };
      Service = {
        Type = "oneshot";
        ExecStart = toString syncScript;
      };
      Install = { WantedBy = [ "default.target" ]; };
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
  };
}
