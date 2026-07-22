{ lib, ... }:

{
  options.hub.transactionalEmail.smtp2go = {
    host = lib.mkOption {
      type = lib.types.str;
      default = "mail-eu.smtp2go.com";
      description = "SMTP2GO SMTP host for transactional email.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 2525;
      description = "SMTP2GO SMTP submission port.";
    };

    username = lib.mkOption {
      type = lib.types.str;
      default = "behaghel.org";
      description = "SMTP2GO SMTP username.";
    };

    fromAddress = lib.mkOption {
      type = lib.types.str;
      default = "notifications@behaghel.org";
      description = "Default From address for transactional email.";
    };

    passwordStoreKey = lib.mkOption {
      type = lib.types.str;
      default = "behaghel.org-sender-user-smtp2go.com";
      description = "Password-store entry containing the SMTP2GO password.";
    };

    passwordFile = lib.mkOption {
      type = lib.types.path;
      default = "/etc/transactional-email-smtp-pass";
      description = "Root-only file containing the SMTP2GO password on hosts that send mail.";
    };
  };
}
