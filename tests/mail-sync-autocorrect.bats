#!/usr/bin/env bats

setup_file() {
  if [ -z "${MAIL_SYNC_AUTOCORRECT_BIN-}" ]; then
    echo "MAIL_SYNC_AUTOCORRECT_BIN is not set" >&2
    return 1
  fi
}

setup() {
  MAIL_SYNC_TEST_ROOT=$(mktemp -d)
  mkdir -p "$MAIL_SYNC_TEST_ROOT/gmail/archive/cur"
  mkdir -p "$MAIL_SYNC_TEST_ROOT/gmail/spam/cur"
}

teardown() {
  rm -rf "$MAIL_SYNC_TEST_ROOT"
}

run_autocorrect() {
  local logfile="$1"
  shift
  env MAIL_SYNC_ROOT="$MAIL_SYNC_TEST_ROOT" \
    "$MAIL_SYNC_AUTOCORRECT_BIN" "$@" <"$logfile"
}

@test "fixes duplicate UID by renaming" {
  local original="$MAIL_SYNC_TEST_ROOT/gmail/archive/cur/msg,U=6:2,S"
  local expected="$MAIL_SYNC_TEST_ROOT/gmail/archive/cur/msg:2,S"
  touch "$original"
  local log="$MAIL_SYNC_TEST_ROOT/log1"
  cat >"$log" <<EOF
Maildir error: duplicate UID 6 in $MAIL_SYNC_TEST_ROOT/gmail/archive.
EOF
  run run_autocorrect "$log"
  [ "$status" -eq 0 ]
  [ ! -e "$original" ]
  [ -e "$expected" ]
}

@test "handles UID beyond highest assigned UID" {
  local original="$MAIL_SYNC_TEST_ROOT/gmail/spam/cur/msg,U=877:2,S"
  local expected="$MAIL_SYNC_TEST_ROOT/gmail/spam/cur/msg:2,S"
  touch "$original"
  local log="$MAIL_SYNC_TEST_ROOT/log2"
  cat >"$log" <<EOF
Maildir error: UID 877 is beyond highest assigned UID 10 in $MAIL_SYNC_TEST_ROOT/gmail/spam.
EOF
  run run_autocorrect "$log"
  [ "$status" -eq 0 ]
  [ ! -e "$original" ]
  [ -e "$expected" ]
}

@test "dry-run logs but does not rename" {
  local original="$MAIL_SYNC_TEST_ROOT/gmail/archive/cur/msg,U=42:2,S"
  touch "$original"
  local log="$MAIL_SYNC_TEST_ROOT/log3"
  cat >"$log" <<EOF
Maildir error: duplicate UID 42 in $MAIL_SYNC_TEST_ROOT/gmail/archive.
EOF
  run run_autocorrect "$log" --dry-run
  [ "$status" -eq 0 ]
  [ -e "$original" ]
}

@test "does not partially match longer UID" {
  local original="$MAIL_SYNC_TEST_ROOT/gmail/archive/cur/msg,U=7138:2,S"
  touch "$original"
  local log="$MAIL_SYNC_TEST_ROOT/log-partial"
  cat >"$log" <<EOF
Maildir error: duplicate UID 713 in $MAIL_SYNC_TEST_ROOT/gmail/archive.
EOF
  run run_autocorrect "$log"
  [ "$status" -eq 2 ]
  [ -e "$original" ]
}

@test "paths outside root return failure" {
  local log="$MAIL_SYNC_TEST_ROOT/log4"
  cat >"$log" <<EOF
Maildir error: duplicate UID 9 in /tmp/not-my-root/archive.
EOF
  run run_autocorrect "$log"
  [ "$status" -eq 2 ]
}

@test "mail-sync-run triggers autocorrect when flag enabled" {
  local maildir="$MAIL_SYNC_TEST_ROOT/maildir"
  mkdir -p "$maildir/work/archive"
  local stamp="$MAIL_SYNC_TEST_ROOT/stamp"
  local mock_autocorrect="$MAIL_SYNC_TEST_ROOT/mock-autocorrect"
  local mock_mbsync="$MAIL_SYNC_TEST_ROOT/mock-mbsync"
  local autocorrect_marker="$MAIL_SYNC_TEST_ROOT/autocorrect-called"
  local state_marker="$MAIL_SYNC_TEST_ROOT/mock-state"
  cat >"$mock_autocorrect" <<EOF
#!/usr/bin/env bash
touch "$autocorrect_marker"
exit 0
EOF
  cat >"$mock_mbsync" <<EOF
#!/usr/bin/env bash
if [ ! -f "$state_marker" ]; then
  cat <<MSG
Maildir error: duplicate UID 6 in $maildir/work/archive.
MSG
  touch "$state_marker"
  exit 1
fi
exit 0
EOF
  chmod +x "$mock_autocorrect" "$mock_mbsync"
  run env \
    MAIL_SYNC_MAILDIR="$maildir" \
    MAIL_SYNC_STAMP_FILE="$stamp" \
    MAIL_SYNC_MBSYNC_BIN="$mock_mbsync" \
    MAIL_SYNC_AUTOCORRECT_BIN="$mock_autocorrect" \
    MAIL_SYNC_LOCKFILE="$MAIL_SYNC_TEST_ROOT/lock" \
    MAIL_SYNC_SKIP_SMARTCARD=1 \
    MAIL_SYNC_AUTOCORRECT_MAX=3 \
    "$MAIL_SYNC_RUN_BIN" --autocorrect-mbsync
  [ "$status" -eq 0 ]
  [ -f "$autocorrect_marker" ]
}

@test "force uid resync scrubs entire maildir" {
  local maildir="$MAIL_SYNC_TEST_ROOT/force"
  mkdir -p "$maildir/work/archive/cur"
  touch "$maildir/work/archive/cur/msg1,U=12:2,S"
  touch "$maildir/work/archive/cur/msg2,U=99:2,S"
  local true_bin
  true_bin=$(command -v true)
  run env \
    MAIL_SYNC_MAILDIR="$maildir" \
    MAIL_SYNC_STAMP_FILE="$MAIL_SYNC_TEST_ROOT/stamp-force" \
    MAIL_SYNC_MBSYNC_BIN="$true_bin" \
    MAIL_SYNC_LOCKFILE="$MAIL_SYNC_TEST_ROOT/lock-force" \
    MAIL_SYNC_SKIP_SMARTCARD=1 \
    "$MAIL_SYNC_RUN_BIN" --force-uid-resync
  [ "$status" -eq 0 ]
  [ -e "$maildir/work/archive/cur/msg1:2,S" ]
  [ -e "$maildir/work/archive/cur/msg2:2,S" ]
}
