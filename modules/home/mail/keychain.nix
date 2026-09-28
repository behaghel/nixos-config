{ pkgs, lib, entries, account }:
let
  entryCases =
    if entries == [ ]
    then "__no_declared_mail_key__"
    else lib.concatMapStringsSep "|" lib.escapeShellArg entries;
  entryWords = lib.concatMapStringsSep " " lib.escapeShellArg entries;
  reader = pkgs.writeShellApplication {
    name = "mail-keychain-pass";
    runtimeInputs = [ pkgs.coreutils ];
    text = ''
      set -euo pipefail
      entry="''${1:?usage: mail-keychain-pass <pass-key>}"
      case "$entry" in
        ${entryCases}) ;;
        *)
          printf 'mail-keychain-pass: undeclared pass key: %s\n' "$entry" >&2
          exit 64
          ;;
      esac
      security_bin="''${MAIL_KEYCHAIN_SECURITY_BIN:-/usr/bin/security}"
      keychain_account="''${MAIL_KEYCHAIN_ACCOUNT:-${account}}"
      exec "$security_bin" find-generic-password \
        -a "$keychain_account" \
        -s "$entry" \
        -w
    '';
  };
  sync = pkgs.writeShellApplication {
    name = "mail-keychain-pass-sync";
    runtimeInputs = [ pkgs.coreutils pkgs.pass ];
    text = ''
      set -euo pipefail
      security_bin="''${MAIL_KEYCHAIN_SECURITY_BIN:-/usr/bin/security}"
      pass_bin="''${MAIL_KEYCHAIN_PASS_BIN:-${lib.getExe pkgs.pass}}"
      keychain_account="''${MAIL_KEYCHAIN_ACCOUNT:-${account}}"
      for entry in ${entryWords}; do
        pass_value="$("$pass_bin" show "$entry")"
        secret="''${pass_value%%$'\n'*}"
        "$security_bin" add-generic-password \
          -U \
          -a "$keychain_account" \
          -s "$entry" \
          -w "$secret" \
          >/dev/null
        unset pass_value secret
      done
    '';
  };
in
{
  inherit reader sync;
}
