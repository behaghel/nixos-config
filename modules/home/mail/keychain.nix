{ pkgs, lib, entries, account, stateFile }:
let
  entryCases =
    if entries == [ ]
    then "__no_declared_mail_key__"
    else lib.concatMapStringsSep "|" lib.escapeShellArg entries;
  entryFlags = lib.concatMapStringsSep " " (entry: "--entry ${lib.escapeShellArg entry}") entries;
  passKeychain = import ../pass-keychain { inherit pkgs; };
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
    text = ''
      set -euo pipefail
      keychain_account="''${MAIL_KEYCHAIN_ACCOUNT:-${account}}"
      default_state_file=${lib.escapeShellArg stateFile}
      state_file="''${MAIL_KEYCHAIN_STATE_FILE:-$default_state_file}"
      exec ${lib.getExe passKeychain} ensure \
        --account "$keychain_account" --state-file "$state_file" ${entryFlags}
    '';
  };
in
{
  inherit reader sync;
}
