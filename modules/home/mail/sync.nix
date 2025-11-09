{ pkgs, lib, config, maildir, cacheDir }:
let
  gpgBin = "${config.programs.gpg.package}/bin";
  expectSmartcard = config.programs.gpg.expectSmartcard;
  isDarwin = pkgs.stdenv.isDarwin;
  runtimeInputs =
    [ pkgs.isync pkgs.mu pkgs.pass pkgs.coreutils config.programs.gpg.package ]
    ++ lib.optionals (!isDarwin) [ pkgs.util-linux ]
    ++ lib.optionals isDarwin [ pkgs.terminal-notifier ];
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
    export PATH=${lib.makeBinPath runtimeInputs}:"$PATH"
    MBSYNC_BIN="${pkgs.isync}/bin/mbsync"
    export SASL_LOG_LEVEL=0
    if [ "$VERBOSE" = 1 ] || [ "''${MAIL_SYNC_DEBUG-}" = 1 ]; then
      echo "mail-sync: using mbsync: $MBSYNC_BIN" >&2
      if command -v ldd >/dev/null 2>&1; then ldd "$MBSYNC_BIN" >&2 || true; fi
    fi
    ${smartcardGuard}

    # Cross-platform lock: use flock(1) if available; otherwise use mkdir.
    LOCKBASE="${config.xdg.runtimeDir or (if isDarwin then "${config.home.homeDirectory}/Library/Caches" else "${config.home.homeDirectory}/.cache")}"
    mkdir -p "$LOCKBASE"
    LOCKFILE="$LOCKBASE/mail-sync.lock"
    LOCKDIR="$LOCKBASE/mail-sync.lock.d"
    if command -v flock >/dev/null 2>&1 && [ "''${MAIL_SYNC_LOCKED:-0}" != 1 ]; then
      wait_mode="''${MAIL_SYNC_WAIT:-0}"
      if [ "$wait_mode" = 1 ]; then
        exec env MAIL_SYNC_LOCKED=1 flock "$LOCKFILE" "$0" "$@"
      else
        if env MAIL_SYNC_LOCKED=1 flock -n "$LOCKFILE" "$0" "$@"; then
          exit 0
        else
          [ "$VERBOSE" = 1 ] && echo "mail-sync: another sync is already running, skipping" >&2 || true
          exit 0
        fi
      fi
    elif [ "''${MAIL_SYNC_LOCKED:-0}" != 1 ]; then
      wait_mode="''${MAIL_SYNC_WAIT:-0}"
      if [ "$wait_mode" = 1 ]; then
        while ! mkdir "$LOCKDIR" 2>/dev/null; do sleep 1; done
        trap 'rmdir "$LOCKDIR"' EXIT INT TERM
      else
        if mkdir "$LOCKDIR" 2>/dev/null; then
          trap 'rmdir "$LOCKDIR"' EXIT INT TERM
        else
          [ "$VERBOSE" = 1 ] && echo "mail-sync: another sync is already running, skipping" >&2 || true
          exit 0
        fi
      fi
      export MAIL_SYNC_LOCKED=1
    fi

    mkdir -p "${maildir}"

    if ! sync_log="$("$MBSYNC_BIN" -a 2>&1)"; then
      printf '%s\n' "$sync_log" >&2
      # Notify on failure: Linux via notify-send; macOS via terminal-notifier or osascript
      if command -v notify-send >/dev/null 2>&1; then
        notify-send "📭 Mail sync failed" "$(printf '%s\n' "$sync_log" | tail -n 20)" -i dialog-error || true
      elif command -v terminal-notifier >/dev/null 2>&1; then
        terminal-notifier -title "Mail sync failed" -message "$(printf '%s' "$sync_log" | tail -n 5)" || true
      else
        /usr/bin/osascript -e 'display notification "Mail sync failed" with title "Mail"' 2>/dev/null || true
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
