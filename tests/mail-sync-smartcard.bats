#!/usr/bin/env bats

setup() {
  export MAIL_SYNC_MAILDIR="$BATS_TEST_TMPDIR/mail"
  export MAIL_SYNC_STAMP_FILE="$BATS_TEST_TMPDIR/stamp"
  export MAIL_SYNC_STATUS_FILE="$BATS_TEST_TMPDIR/status.json"
  export MAIL_SYNC_LOCKFILE="$BATS_TEST_TMPDIR/lock"
  export MAIL_SYNC_LOCKED=1
  export MAIL_SYNC_NOTIFY_SUCCESS=0
  export MAIL_SYNC_AUTOCORRECT=0
  export MAIL_SYNC_GPG_LOG="$BATS_TEST_TMPDIR/gpg.log"
  export MAIL_SYNC_TEST_LOG="$BATS_TEST_TMPDIR/mbsync.log"
  export MAIL_SYNC_TEST_CARD=0
  export PATH="$MAIL_SYNC_TEST_GPG_DIR:$PATH"
  unset MAIL_SYNC_SKIP_SMARTCARD
  export MAIL_SYNC_MBSYNC_BIN="$BATS_TEST_TMPDIR/mbsync"
  cat >"$MAIL_SYNC_MBSYNC_BIN" <<'SCRIPT'
#!/usr/bin/env bash
printf 'mbsync %s\n' "$*" >>"$MAIL_SYNC_TEST_LOG"
SCRIPT
  chmod +x "$MAIL_SYNC_MBSYNC_BIN"
}

@test "macOS sync runs without a card and never contacts GPG" {
  run "$MAIL_SYNC_DARWIN_BIN"
  [ "$status" -eq 0 ]
  [ ! -e "$MAIL_SYNC_GPG_LOG" ]
  grep -q '^mbsync -a$' "$MAIL_SYNC_TEST_LOG"
  grep -q '"status":"ok"' "$MAIL_SYNC_STATUS_FILE"
  [ -s "$MAIL_SYNC_STAMP_FILE" ]
}

@test "Linux retains GPG preparation and skips sync when its required card is absent" {
  run "$MAIL_SYNC_LINUX_BIN"
  [ "$status" -eq 0 ]
  grep -q '^gpgconf --launch gpg-agent$' "$MAIL_SYNC_GPG_LOG"
  grep -q '^gpg-connect-agent updatestartuptty /bye$' "$MAIL_SYNC_GPG_LOG"
  grep -q '^gpg-connect-agent scd serialno /bye$' "$MAIL_SYNC_GPG_LOG"
  [ ! -e "$MAIL_SYNC_TEST_LOG" ]
  [ ! -e "$MAIL_SYNC_STAMP_FILE" ]
  grep -q '"status":"missing-smartcard"' "$MAIL_SYNC_STATUS_FILE"
}

@test "Linux sync proceeds when its required card is available" {
  export MAIL_SYNC_TEST_CARD=1
  run "$MAIL_SYNC_LINUX_BIN"
  [ "$status" -eq 0 ]
  grep -q '^gpg-connect-agent scd serialno /bye$' "$MAIL_SYNC_GPG_LOG"
  grep -q '^mbsync -a$' "$MAIL_SYNC_TEST_LOG"
  grep -q '"status":"ok"' "$MAIL_SYNC_STATUS_FILE"
}
