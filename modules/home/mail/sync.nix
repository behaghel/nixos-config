{ pkgs, lib, config, maildir, cacheDir }:
let
  gpgBin = "${config.programs.gpg.package}/bin";
  expectSmartcard = config.programs.gpg.expectSmartcard;
  smartcardGuard = lib.optionalString expectSmartcard ''
    if ! ${gpgBin}/gpg-connect-agent 'scd serialno' /bye 2>/dev/null | grep -q '^S SERIALNO'; then
      if [ "$VERBOSE" = 1 ] || [ "''${MAIL_SYNC_DEBUG-}" = 1 ]; then
        echo "mail-sync: smartcard not detected, skipping sync" >&2
      fi
      exit 0
    fi
  '';

  mailSyncScript = pkgs.writeShellScriptBin "mail-sync-run" ''
    set -euo pipefail
    VERBOSE="''${VERBOSE:-0}"
    if [ "$VERBOSE" = 1 ] || [ "''${MAIL_SYNC_DEBUG-}" = 1 ]; then set -x; fi
    export PATH=${lib.makeBinPath [ pkgs.isync pkgs.mu pkgs.pass pkgs.coreutils pkgs.util-linux config.programs.gpg.package ]}:"$PATH"
    MBSYNC_BIN="${pkgs.isync}/bin/mbsync"
    export SASL_LOG_LEVEL=0
    if [ "$VERBOSE" = 1 ] || [ "''${MAIL_SYNC_DEBUG-}" = 1 ]; then
      echo "mail-sync: using mbsync: $MBSYNC_BIN" >&2
      if command -v ldd >/dev/null 2>&1; then ldd "$MBSYNC_BIN" >&2 || true; fi
    fi
    ${smartcardGuard}
    LOCKFILE="${config.xdg.runtimeDir or "${config.home.homeDirectory}/.cache"}/mail-sync.lock"
    mkdir -p "$(dirname "$LOCKFILE")"
    if command -v flock >/dev/null 2>&1 && [ "''${MAIL_SYNC_LOCKED:-0}" != 1 ]; then
      wait_mode="''${MAIL_SYNC_WAIT:-0}"
      if [ "$wait_mode" = 1 ]; then
        exec env MAIL_SYNC_LOCKED=1 flock "$LOCKFILE" "$0" "$@"
      else
        if env MAIL_SYNC_LOCKED=1 flock -n "$LOCKFILE" "$0" "$@"; then
          exit 0
        else
          if [ "$VERBOSE" = 1 ]; then
            echo "mail-sync: another sync is already running, skipping" >&2
          fi
          exit 0
        fi
      fi
    fi
    if [ "''${MAIL_SYNC_LOCKED:-0}" = 1 ]; then
      export MAIL_SYNC_LOCKED=1
    fi

    mkdir -p "${maildir}"

    if ! sync_log="$("$MBSYNC_BIN" -a 2>&1)"; then
      printf '%s\n' "$sync_log" >&2
      if command -v notify-send >/dev/null 2>&1; then
        notify-send "📭 Mail sync failed" "$(printf '%s\n' "$sync_log" | tail -n 20)" -i dialog-error || true
      fi
      exit 1
    fi
    if [ "$VERBOSE" = 1 ] || [ "''${MAIL_SYNC_DEBUG-}" = 1 ]; then
      printf '%s\n' "$sync_log"
    fi

    STAMP_DIR=${lib.escapeShellArg cacheDir}
    mkdir -p "$STAMP_DIR"
    date +%s >"$STAMP_DIR/last"

    if [ "$VERBOSE" = 1 ]; then
      echo "mail-sync: completed successfully" >&2
    fi
  '';
in
{
  inherit mailSyncScript;
}
