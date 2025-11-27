{ pkgs, lib, passCacheScript, gmailOAuthHelper }:
let
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
    // lib.optionalAttrs (passwordCommand != null) { inherit passwordCommand; }
    // lib.optionalAttrs (imap != null) { inherit imap; }
    // lib.optionalAttrs (smtp != null) { inherit smtp; };

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
          # all    = { farPattern = farAll;      nearPattern = "archive"; extraConfig = { CopyArrivalDate = "yes"; Create = "Near"; Sync = "Push"; }; };
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
      passwordCommand = "${passCacheScript}/bin/mail-pass online/gmail/app-password-mbsync";
    } // { primary = true; };

    "behaghel.fr" = mkGmailAccount {
      name = "behaghel.fr"; email = "hubert@behaghel.fr"; lang = "fr";
      authMechs = "PLAIN";
      passwordCommand = "${passCacheScript}/bin/mail-pass online/behaghel.fr/token";
    } // { primary = false; };

    "behaghel.org" = (mkBaseAccount {
      address = "hubert@behaghel.org";
      userName = "behaghel";
      authMechs = "PLAIN";
      passwordCommand = "${passCacheScript}/bin/mail-pass online/mailfence.com";
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

in
{
  inherit mailAccounts;
}
