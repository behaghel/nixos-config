#!/usr/bin/env bats

setup() {
  export TEST_ROOT="$BATS_TEST_TMPDIR/mail-keychain"
  export MAIL_KEYCHAIN_TEST_LOG="$TEST_ROOT/security.log"
  mkdir -p "$TEST_ROOT/bin"

  cat >"$TEST_ROOT/bin/pass" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
[ "$1" = show ]
printf 'secret-for-%s\n' "$2"
SCRIPT

  cat >"$TEST_ROOT/bin/security" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  add-generic-password)
    service=""
    password=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        -s) service="$2"; shift 2 ;;
        -w) password="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    printf '%s\n' "-s $service" >>"$MAIL_KEYCHAIN_TEST_LOG"
    [ "$password" = "secret-for-$service" ]
    ;;
  find-generic-password)
    service=""
    while [ "$#" -gt 0 ]; do
      if [ "$1" = -s ]; then service="$2"; shift 2; else shift; fi
    done
    printf 'keychain-secret-for-%s\n' "$service"
    ;;
  *) exit 64 ;;
esac
SCRIPT
  chmod +x "$TEST_ROOT/bin/pass" "$TEST_ROOT/bin/security"
}

@test "declarative pass entries are upserted under their exact names" {
  run env \
    MAIL_KEYCHAIN_PASS_BIN="$TEST_ROOT/bin/pass" \
    MAIL_KEYCHAIN_SECURITY_BIN="$TEST_ROOT/bin/security" \
    MAIL_KEYCHAIN_ACCOUNT=test-user \
    "$MAIL_KEYCHAIN_SYNC_BIN"

  [ "$status" -eq 0 ]
  [ -z "$output" ]
  grep -q -- '-s veriff/mail/client-id' "$MAIL_KEYCHAIN_TEST_LOG"
  grep -q -- '-s veriff/mail/refresh-token' "$MAIL_KEYCHAIN_TEST_LOG"
  ! grep -q -- 'secret-for-' "$MAIL_KEYCHAIN_TEST_LOG"
  [ "$(wc -l <"$MAIL_KEYCHAIN_TEST_LOG" | tr -d ' ')" -eq 2 ]
}

@test "reader resolves the exact pass-key name from Keychain" {
  run env \
    MAIL_KEYCHAIN_SECURITY_BIN="$TEST_ROOT/bin/security" \
    MAIL_KEYCHAIN_ACCOUNT=test-user \
    "$MAIL_KEYCHAIN_READER_BIN" veriff/mail/refresh-token

  [ "$status" -eq 0 ]
  [ "$output" = keychain-secret-for-veriff/mail/refresh-token ]
}

@test "reader rejects pass keys absent from the declarative list" {
  run env \
    MAIL_KEYCHAIN_SECURITY_BIN="$TEST_ROOT/bin/security" \
    MAIL_KEYCHAIN_ACCOUNT=test-user \
    "$MAIL_KEYCHAIN_READER_BIN" undeclared/key

  [ "$status" -eq 64 ]
  [[ "$output" == *"undeclared pass key: undeclared/key"* ]]
  [ ! -e "$MAIL_KEYCHAIN_TEST_LOG" ]
}

@test "sync fails without printing a secret when pass export fails" {
  cat >"$TEST_ROOT/bin/pass" <<'SCRIPT'
#!/usr/bin/env bash
printf 'decrypt failed\n' >&2
exit 2
SCRIPT
  chmod +x "$TEST_ROOT/bin/pass"

  run env \
    MAIL_KEYCHAIN_PASS_BIN="$TEST_ROOT/bin/pass" \
    MAIL_KEYCHAIN_SECURITY_BIN="$TEST_ROOT/bin/security" \
    MAIL_KEYCHAIN_ACCOUNT=test-user \
    "$MAIL_KEYCHAIN_SYNC_BIN"

  [ "$status" -eq 2 ]
  [[ "$output" != *secret-for-* ]]
}
