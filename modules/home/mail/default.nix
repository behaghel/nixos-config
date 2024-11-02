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
in {
  options = {
    hub.mail = {
      enable = mkOption {
        description = "Enable mails";
        type = types.bool;
        default = false;
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
      maildirBasePath = "${config.home.homeDirectory}/Mail";
      accounts = {
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
    };
  };
}
