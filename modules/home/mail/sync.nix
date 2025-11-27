{ pkgs, lib, config, maildir, stampFile }:
let
  gpgBin = "${config.programs.gpg.package}/bin";
  expectSmartcard = config.programs.gpg.expectSmartcard;
  isDarwin = pkgs.stdenv.isDarwin;
  runtimeInputs =
    [ pkgs.isync pkgs.mu pkgs.pass pkgs.coreutils config.programs.gpg.package ]
    ++ lib.optionals (!isDarwin) [ pkgs.util-linux ]
    ++ lib.optionals isDarwin [ pkgs.terminal-notifier ];
  smartcardGuard = lib.optionalString expectSmartcard ''
    if [ "''${MAIL_SYNC_SKIP_SMARTCARD:-0}" != 1 ]; then
      if ! ${gpgBin}/gpg-connect-agent 'scd serialno' /bye 2>/dev/null | grep -q '^S SERIALNO'; then
        if [ "$VERBOSE" = 1 ] || [ "''${MAIL_SYNC_DEBUG-}" = 1 ]; then
          echo "mail-sync: smartcard not detected, skipping sync" >&2
        fi
        exit 0
      fi
    fi
  '';

  mailSyncAutocorrectScript = import ./autocorrect-script.nix { inherit pkgs; };

  mailSyncScript = pkgs.writeShellScriptBin "mail-sync-run" ''
    set -euo pipefail
    VERBOSE="''${VERBOSE:-0}"
    export PATH=${lib.makeBinPath [ pkgs.isync pkgs.mu pkgs.pass pkgs.coreutils pkgs.util-linux pkgs.gawk config.programs.gpg.package ]}:"$PATH"
    MBSYNC_BIN="''${MAIL_SYNC_MBSYNC_BIN-${pkgs.isync}/bin/mbsync}"
    MAILDIR_DEFAULT="${maildir}"
    STAMP_DEFAULT="${stampFile}"
    MAILDIR="''${MAIL_SYNC_MAILDIR-$MAILDIR_DEFAULT}"
    STAMP_FILE="''${MAIL_SYNC_STAMP_FILE-$STAMP_DEFAULT}"
    AUTOCORRECT_BIN="''${MAIL_SYNC_AUTOCORRECT_BIN-${mailSyncAutocorrectScript}/bin/mail-sync-autocorrect}"
    AUTOCORRECT_FLAG="''${MAIL_SYNC_AUTOCORRECT:-0}"
    AUTOCORRECT_DRY_RUN="''${MAIL_SYNC_AUTOCORRECT_DRY_RUN:-0}"
    NOTIFY_SUCCESS="''${MAIL_SYNC_NOTIFY_SUCCESS:-1}"
    export SASL_LOG_LEVEL=0

    FORCE_UID_RESYNC=0
    FORCE_UID_SCOPE=""

    usage() {
      cat <<'USAGE'
mail-sync-run [--autocorrect-mbsync] [--force-uid-resync[=PATH]]

Options:
  --autocorrect-mbsync   Attempt to fix duplicate UID errors by running mail-sync-autocorrect, then rerun mbsync.
  --force-uid-resync[=PATH]
                         Scrub all ,U=<n> markers before syncing. Optional PATH limits the scrub to a subdirectory.
  --verbose              Enable verbose shell tracing for this run.
  -h, --help             Show this help.
USAGE
    }

    autocorrect_log() {
      local log="$1"
      local args=""
      if [ "$AUTOCORRECT_DRY_RUN" = 1 ]; then
        args="--dry-run"
      fi
      printf '%s\n' "$log" | env MAIL_SYNC_ROOT="$MAILDIR" \
        "$AUTOCORRECT_BIN" $args
    }

    LOCKFILE_DEFAULT="${config.xdg.runtimeDir or (config.home.homeDirectory + "/.cache")}/mail-sync.lock"
    LOCKFILE="''${MAIL_SYNC_LOCKFILE-$LOCKFILE_DEFAULT}"
    mkdir -p "$(dirname "$LOCKFILE")"
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
    fi
    if [ "''${MAIL_SYNC_LOCKED:-0}" = 1 ]; then
      export MAIL_SYNC_LOCKED=1
    fi

    while [ "$#" -gt 0 ]; do
      case "$1" in
        --autocorrect-mbsync)
          AUTOCORRECT_FLAG=1
          shift
          ;;
        --force-uid-resync)
          FORCE_UID_RESYNC=1
          FORCE_UID_SCOPE=""
          if [ "$#" -gt 1 ]; then
            case "$2" in
              --*) ;;
              *) FORCE_UID_SCOPE="$2"; shift ;;
            esac
          fi
          shift
          ;;
        --force-uid-resync=*)
          FORCE_UID_RESYNC=1
          FORCE_UID_SCOPE="''${1#*=}"
          shift
          ;;
        --verbose)
          VERBOSE=1
          shift
          ;;
        -h|--help)
          usage
          exit 0
          ;;
        --)
          shift
          break
          ;;
        *)
          echo "mail-sync: unknown argument: $1" >&2
          usage >&2
          exit 64
          ;;
      esac
    done
    if [ "$#" -gt 0 ]; then
      echo "mail-sync: unexpected positional arguments: $*" >&2
      exit 64
    fi

    if [ "$VERBOSE" = 1 ] || [ "''${MAIL_SYNC_DEBUG-}" = 1 ]; then
      set -x
      echo "mail-sync: using mbsync: $MBSYNC_BIN" >&2
      if command -v ldd >/dev/null 2>&1; then ldd "$MBSYNC_BIN" >&2 || true; fi
    fi
    ${smartcardGuard}

    mkdir -p "$MAILDIR"

    if [ "$FORCE_UID_RESYNC" = 1 ]; then
      scope_arg=()
      scope_path=""
      if [ -n "$FORCE_UID_SCOPE" ]; then
        case "$FORCE_UID_SCOPE" in
          /*) scope_path="$FORCE_UID_SCOPE" ;;
          "") scope_path="" ;;
          *) scope_path="$MAILDIR/$FORCE_UID_SCOPE" ;;
        esac
        if [ -n "$scope_path" ]; then
          scope_arg=(--scope "$scope_path")
        fi
      fi
      if [ "$VERBOSE" = 1 ]; then
        target_label="''${scope_path:-$MAILDIR}"
        echo "mail-sync: forcing UID resync for $target_label" >&2
      fi
      env MAIL_SYNC_ROOT="$MAILDIR" "$AUTOCORRECT_BIN" --force "''${scope_arg[@]}"
    fi

    run_mbsync() {
      "$MBSYNC_BIN" -a 2>&1
    }

    autocorrect_attempts=0
    max_autocorrect_attempts="''${MAIL_SYNC_AUTOCORRECT_MAX:-0}"
    case "$max_autocorrect_attempts" in
      ""|*[!0-9]*) max_autocorrect_attempts=0 ;;
    esac
    previous_sync_log=""
    while true; do
      if sync_log="$(run_mbsync)"; then
        break
      fi
      if [ "$AUTOCORRECT_FLAG" = 1 ]; then
        if [ "$max_autocorrect_attempts" -gt 0 ] && [ "$autocorrect_attempts" -ge "$max_autocorrect_attempts" ]; then
          echo "mail-sync: reached autocorrect attempt limit ($max_autocorrect_attempts)" >&2
          printf '%s\n' "$sync_log" >&2
          if command -v notify-send >/dev/null 2>&1; then
            notify-send "📭 Mail sync failed after autocorrect limit" "$(printf '%s\n' "$sync_log" | tail -n 20)" -i dialog-error || true
          fi
          exit 1
        fi
        if [ "$sync_log" = "$previous_sync_log" ]; then
          echo "mail-sync: duplicate UID errors unchanged after autocorrect; aborting" >&2
          printf '%s\n' "$sync_log" >&2
          if command -v notify-send >/dev/null 2>&1; then
            notify-send "📭 Mail sync failed after autocorrect" "$(printf '%s\n' "$sync_log" | tail -n 20)" -i dialog-error || true
          fi
          exit 1
        fi
        if autocorrect_log "$sync_log"; then
          autocorrect_attempts=$((autocorrect_attempts + 1))
          previous_sync_log="$sync_log"
          if [ "$max_autocorrect_attempts" -gt 0 ]; then
            echo "mail-sync: UID conflicts corrected; retrying mbsync ($autocorrect_attempts/$max_autocorrect_attempts)" >&2
          else
            echo "mail-sync: UID conflicts corrected; retrying mbsync ($autocorrect_attempts)" >&2
          fi
          continue
        fi
      fi
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
    done
    if [ "$VERBOSE" = 1 ] || [ "''${MAIL_SYNC_DEBUG-}" = 1 ]; then
      printf '%s\n' "$sync_log"
    fi

    if [ "$NOTIFY_SUCCESS" = 1 ] && command -v notify-send >/dev/null 2>&1; then
      new_total=$(printf '%s\n' "$sync_log" | awk 'match($0,/Near: \+([0-9]+)/,m){sum+=m[1]} END{print sum+0}')
      notify-send "📬 Mail synced" "Fetched $new_total new messages" -i mail-read || true
    fi

    STAMP_DIR="$(dirname "$STAMP_FILE")"
    mkdir -p "$STAMP_DIR"
    tmp="$STAMP_DIR/.last.$$"
    date +%s >"$tmp"
    mv "$tmp" "$STAMP_FILE"

    if [ "$VERBOSE" = 1 ]; then
      echo "mail-sync: completed successfully" >&2
    fi
  '';
in
{
  inherit mailSyncScript mailSyncAutocorrectScript;
}
