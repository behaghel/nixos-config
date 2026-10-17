#!/usr/bin/env bats

setup() {
  export TEST_ROOT="$BATS_TEST_TMPDIR/mail-keychain"
  export MAIL_KEYCHAIN_TEST_LOG="$TEST_ROOT/actions.log"
  export MAIL_KEYCHAIN_STATE_FILE="$TEST_ROOT/state/mail.json"
  export PASSWORD_STORE_DIR="$TEST_ROOT/store"
  export PASS_KEYCHAIN_PASS_BIN="$TEST_ROOT/bin/pass"
  export PASS_KEYCHAIN_SECURITY_BIN="$TEST_ROOT/bin/security"
  export MAIL_KEYCHAIN_SECURITY_BIN="$PASS_KEYCHAIN_SECURITY_BIN"
  export PASS_KEYCHAIN_WRITER_BIN="$TEST_ROOT/bin/keychain-write"
  export MAIL_KEYCHAIN_ACCOUNT=test-user
  mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/keychain" \
    "$PASSWORD_STORE_DIR/veriff/mail" "$PASSWORD_STORE_DIR/online/gmail"
  printf 'ciphertext 1\n' >"$PASSWORD_STORE_DIR/veriff/mail/client-id.gpg"
  printf 'ciphertext 2\n' >"$PASSWORD_STORE_DIR/veriff/mail/refresh-token.gpg"

  cat >"$PASS_KEYCHAIN_PASS_BIN" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
[ "$1" = show ]
printf 'pass %s\n' "$2" >>"$MAIL_KEYCHAIN_TEST_LOG"
[ "${PASS_KEYCHAIN_FAIL_ENTRY-}" != "$2" ] || exit 2
printf 'secret-for-%s\nmetadata\n' "$2"
SCRIPT

  cat >"$PASS_KEYCHAIN_SECURITY_BIN" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
[ "$1" = find-generic-password ] || exit 64
[ -z "${PASS_KEYCHAIN_FAIL_LOOKUP-}" ] || exit 77
service=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -s) service="$2"; shift 2 ;;
    *) shift ;;
  esac
done
[ -f "$TEST_ROOT/keychain/${service//\//_}" ] || exit 44
if [ -n "${PASS_KEYCHAIN_FAIL_READBACK-}" ]; then
  printf 'unexpected value\n'
else
  printf '%s\n' "$(<"$TEST_ROOT/keychain/${service//\//_}")"
fi
SCRIPT

  cat >"$PASS_KEYCHAIN_WRITER_BIN" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
[ "$1" = write ] && [ "$#" -eq 3 ] || exit 64
printf 'write %s\n' "$3" >>"$MAIL_KEYCHAIN_TEST_LOG"
[ "${PASS_KEYCHAIN_FAIL_WRITE-}" != "$3" ] || exit 3
cat >"$TEST_ROOT/keychain/${3//\//_}"
SCRIPT
  if [ -z "${MAIL_KEYCHAIN_SYNC_BIN-}" ]; then
    # Exercise the generic implementation without requiring a Nix store build.
    export MAIL_KEYCHAIN_SYNC_BIN="$TEST_ROOT/bin/mail-keychain-pass-sync"
    export MAIL_KEYCHAIN_READER_BIN="$TEST_ROOT/bin/mail-keychain-pass"
    cat >"$MAIL_KEYCHAIN_SYNC_BIN" <<'SCRIPT'
#!/usr/bin/env bash
exec "$PASS_KEYCHAIN_BIN" ensure --account "$MAIL_KEYCHAIN_ACCOUNT" \
  --state-file "$MAIL_KEYCHAIN_STATE_FILE" \
  --entry veriff/mail/client-id --entry veriff/mail/refresh-token
SCRIPT
    cat >"$MAIL_KEYCHAIN_READER_BIN" <<'SCRIPT'
#!/usr/bin/env bash
case "$1" in
  veriff/mail/client-id|veriff/mail/refresh-token)
    exec "$MAIL_KEYCHAIN_SECURITY_BIN" find-generic-password \
      -a "$MAIL_KEYCHAIN_ACCOUNT" -s "$1" -w ;;
  *) echo "undeclared pass key: $1" >&2; exit 64 ;;
esac
SCRIPT
    # Generic CLI runs from source in the local test harness.
    export PASS_KEYCHAIN_BIN="$TEST_ROOT/bin/pass-keychain"
    cat >"$PASS_KEYCHAIN_BIN" <<'SCRIPT'
#!/usr/bin/env bash
exec python3 "$(git rev-parse --show-toplevel)/modules/home/pass-keychain/promote.py" "$@"
SCRIPT
  fi
  chmod +x "$TEST_ROOT/bin/"*
}

@test "first run verifies pass against Keychain and stores a durable baseline" {
  printf 'secret-for-veriff/mail/client-id' >"$TEST_ROOT/keychain/veriff_mail_client-id"
  printf 'secret-for-veriff/mail/refresh-token' >"$TEST_ROOT/keychain/veriff_mail_refresh-token"
  run "$MAIL_KEYCHAIN_SYNC_BIN"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [ -f "$MAIL_KEYCHAIN_STATE_FILE" ]
  [ "$(grep -c '^pass ' "$MAIL_KEYCHAIN_TEST_LOG")" -eq 2 ]
  ! grep -q '^write ' "$MAIL_KEYCHAIN_TEST_LOG"
  [ "$(/usr/bin/stat -f %Lp "$MAIL_KEYCHAIN_STATE_FILE")" = 600 ]
  ! grep -q 'secret-for-' "$MAIL_KEYCHAIN_STATE_FILE"
}

@test "unchanged ciphertext and readable Keychain never call pass or writer again" {
  "$MAIL_KEYCHAIN_SYNC_BIN"
  : >"$MAIL_KEYCHAIN_TEST_LOG"
  run "$MAIL_KEYCHAIN_SYNC_BIN"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [ ! -s "$MAIL_KEYCHAIN_TEST_LOG" ]
}

@test "changed ciphertext is promoted even with preserved mtime" {
  "$MAIL_KEYCHAIN_SYNC_BIN"
  : >"$MAIL_KEYCHAIN_TEST_LOG"
  file="$PASSWORD_STORE_DIR/veriff/mail/client-id.gpg"
  cp -p "$file" "$TEST_ROOT/old.gpg"
  printf 'new ciphertext\n' >"$file"
  touch -r "$TEST_ROOT/old.gpg" "$file"
  run "$MAIL_KEYCHAIN_SYNC_BIN"
  [ "$status" -eq 0 ]
  [ "$(grep -c '^pass ' "$MAIL_KEYCHAIN_TEST_LOG")" -eq 1 ]
  ! grep -q '^write ' "$MAIL_KEYCHAIN_TEST_LOG"
  : >"$MAIL_KEYCHAIN_TEST_LOG"
  "$MAIL_KEYCHAIN_SYNC_BIN"
  [ ! -s "$MAIL_KEYCHAIN_TEST_LOG" ]
}

@test "missing Keychain item triggers promotion even if ciphertext is unchanged" {
  "$MAIL_KEYCHAIN_SYNC_BIN"
  rm "$TEST_ROOT/keychain/veriff_mail_client-id"
  : >"$MAIL_KEYCHAIN_TEST_LOG"
  run "$MAIL_KEYCHAIN_SYNC_BIN"
  [ "$status" -eq 0 ]
  [ "$(grep -c '^pass ' "$MAIL_KEYCHAIN_TEST_LOG")" -eq 1 ]
  [ "$(grep -c '^write ' "$MAIL_KEYCHAIN_TEST_LOG")" -eq 1 ]
}

@test "unavailable Keychain fails without requesting a YubiKey" {
  export PASS_KEYCHAIN_FAIL_LOOKUP=1
  run "$MAIL_KEYCHAIN_SYNC_BIN"
  [ "$status" -ne 0 ]
  [ ! -e "$MAIL_KEYCHAIN_TEST_LOG" ]
  [ ! -f "$MAIL_KEYCHAIN_STATE_FILE" ]
}

@test "empty Keychain item is repaired even with unchanged ciphertext" {
  "$MAIL_KEYCHAIN_SYNC_BIN"
  : >"$TEST_ROOT/keychain/veriff_mail_client-id"
  : >"$MAIL_KEYCHAIN_TEST_LOG"
  run "$MAIL_KEYCHAIN_SYNC_BIN"
  [ "$status" -eq 0 ]
  [ "$(grep -c '^pass ' "$MAIL_KEYCHAIN_TEST_LOG")" -eq 1 ]
  [ "$(grep -c '^write ' "$MAIL_KEYCHAIN_TEST_LOG")" -eq 1 ]
}

@test "failed decryption does not log secrets or advance the baseline" {
  export PASS_KEYCHAIN_FAIL_ENTRY=veriff/mail/refresh-token
  run "$MAIL_KEYCHAIN_SYNC_BIN"
  [ "$status" -ne 0 ]
  [[ "$output" != *secret-for-* ]]
  [ ! -f "$MAIL_KEYCHAIN_STATE_FILE" ]
  ! grep -q 'secret-for-' "$MAIL_KEYCHAIN_TEST_LOG"
}

@test "missing ciphertext stops before decrypting or writing" {
  rm "$PASSWORD_STORE_DIR/veriff/mail/refresh-token.gpg"
  run "$MAIL_KEYCHAIN_SYNC_BIN"
  [ "$status" -ne 0 ]
  [ ! -e "$MAIL_KEYCHAIN_TEST_LOG" ]
  [ ! -f "$MAIL_KEYCHAIN_STATE_FILE" ]
}

@test "failed read-back does not advance the baseline" {
  export PASS_KEYCHAIN_FAIL_READBACK=1
  run "$MAIL_KEYCHAIN_SYNC_BIN"
  [ "$status" -ne 0 ]
  [ ! -f "$MAIL_KEYCHAIN_STATE_FILE" ]
  [[ "$output" != *secret-for-* ]]
}

@test "failed writer does not advance the baseline" {
  export PASS_KEYCHAIN_FAIL_WRITE=veriff/mail/refresh-token
  run "$MAIL_KEYCHAIN_SYNC_BIN"
  [ "$status" -ne 0 ]
  [ ! -f "$MAIL_KEYCHAIN_STATE_FILE" ]
  [[ "$output" != *secret-for-* ]]
}

@test "check never decrypts pass; refresh always verifies it" {
  run "$PASS_KEYCHAIN_BIN" check --account test-user \
    --entry veriff/mail/client-id
  [ "$status" -ne 0 ]
  [ ! -e "$MAIL_KEYCHAIN_TEST_LOG" ]
  "$MAIL_KEYCHAIN_SYNC_BIN"
  : >"$MAIL_KEYCHAIN_TEST_LOG"
  run "$PASS_KEYCHAIN_BIN" refresh --account test-user \
    --state-file "$MAIL_KEYCHAIN_STATE_FILE" --entry veriff/mail/client-id
  [ "$status" -eq 0 ]
  [ "$(grep -c '^pass ' "$MAIL_KEYCHAIN_TEST_LOG")" -eq 1 ]
  ! grep -q '^write ' "$MAIL_KEYCHAIN_TEST_LOG"
}

@test "generic utility maps pass entries to arbitrary Keychain services" {
  printf 'different ciphertext\n' >"$PASSWORD_STORE_DIR/online/gmail/password.gpg"
  run "$PASS_KEYCHAIN_BIN" ensure --account test-user \
    --state-file "$MAIL_KEYCHAIN_STATE_FILE" \
    --entry 'online/gmail/password=mail/gmail'
  [ "$status" -eq 0 ]
  [ -f "$TEST_ROOT/keychain/mail_gmail" ]
  grep -q '^pass online/gmail/password$' "$MAIL_KEYCHAIN_TEST_LOG"
  grep -q '^write mail/gmail$' "$MAIL_KEYCHAIN_TEST_LOG"
  ! grep -q 'secret-for-' "$MAIL_KEYCHAIN_TEST_LOG"
}

profile_fixture() {
  cat >"$TEST_ROOT/secretspec.toml" <<'TOML'
[project]
name = "herbert"
revision = "1.0"
[profiles.default]
SHARED_TOKEN = { required = true }
[profiles.live]
LIVE_TOKEN = { required = true }
OPTIONAL_TOKEN = { required = false }
[profiles.other]
OTHER_TOKEN = { required = true }
TOML
  cat >"$TEST_ROOT/bin/secretspec" <<'SCRIPT'
#!/usr/bin/env python3
import json
import os
import subprocess
import sys

args = sys.argv[1:]
provider = args[args.index("--provider") + 1]
kind = "source" if provider.startswith("pass:") else "target"
state = os.environ["TEST_ROOT"] + "/secretspec-state.json"
with open(state, encoding="utf-8") as stream:
    data = json.load(stream)
with open(os.environ["TEST_ROOT"] + "/calls.log", "a", encoding="utf-8") as stream:
    stream.write(json.dumps(args) + "\n")
if os.environ.get("FAIL_PROVIDER") == kind:
    print("PRIVATE_CANARY_BACKEND_ERROR", file=sys.stderr)
    sys.exit(7)
if "run" in args:
    child = args[args.index("--") + 1:]
    env = dict(os.environ)
    env.update(data[kind])
    sys.exit(subprocess.run(child, env=env, check=False).returncode)
if "set" in args:
    key = args[args.index("set") + 1]
    if os.environ.get("FAIL_SET") == key:
        print("PRIVATE_CANARY_WRITE_ERROR", file=sys.stderr)
        sys.exit(8)
    data["target"][key] = sys.stdin.read().strip()
    if os.environ.get("CORRUPT_SET") == key:
        data["target"][key] += "-corrupt"
    with open(state, "w", encoding="utf-8") as stream:
        json.dump(data, stream)
    sys.exit(0)
sys.exit(64)
SCRIPT
  chmod +x "$TEST_ROOT/bin/secretspec"
  printf '%s' '{"source":{"SHARED_TOKEN":"synthetic-shared","LIVE_TOKEN":"synthetic-live","OTHER_TOKEN":"synthetic-other"},"target":{}}' \
    >"$TEST_ROOT/secretspec-state.json"
  mkdir -p "$PASSWORD_STORE_DIR/herbert/live"
  printf 'cipher shared' >"$PASSWORD_STORE_DIR/herbert/live/SHARED_TOKEN.gpg"
  printf 'cipher live' >"$PASSWORD_STORE_DIR/herbert/live/LIVE_TOKEN.gpg"
}

profile_run() {
  env PATH="$TEST_ROOT/bin:$PATH" "$PASS_KEYCHAIN_BIN" "$1" \
    --file "$TEST_ROOT/secretspec.toml" --profile "${2:-live}"
}

@test "SecretSpec promotion inherits defaults, skips absent optional entries, and stays profile-scoped" {
  profile_fixture
  run profile_run promote
  [ "$status" -eq 0 ]
  [[ "$output" == *'"result": "verified"'* ]]
  [[ "$output" == *'"created": 2'* ]]
  grep -q '"LIVE_TOKEN": "synthetic-live"' "$TEST_ROOT/secretspec-state.json"
  ! grep -q '"OTHER_TOKEN": "synthetic-other"' <<<"$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["target"])' "$TEST_ROOT/secretspec-state.json")"
  [[ "$output" != *synthetic-live* ]]
  ! grep -q 'PRIVATE_CANARY' <<<"$output"
}

@test "promote refuses all conflicting targets before writing; refresh rotates them" {
  profile_fixture
  printf '%s' '{"source":{"SHARED_TOKEN":"synthetic-shared","LIVE_TOKEN":"synthetic-live"},"target":{"LIVE_TOKEN":"synthetic-old"}}' \
    >"$TEST_ROOT/secretspec-state.json"
  run profile_run promote
  [ "$status" -ne 0 ]
  [[ "$output" == *'"result": "target_conflict"'* ]]
  ! grep -q '"set"' "$TEST_ROOT/calls.log"
  run profile_run refresh
  [ "$status" -eq 0 ]
  [[ "$output" == *'"updated": 1'* ]]
  [[ "$output" == *'"created": 1'* ]]
}

@test "check reads only Keychain and reports absent required credentials" {
  profile_fixture
  run profile_run check
  [ "$status" -ne 0 ]
  [[ "$output" == *'"result": "required_credentials_missing"'* ]]
  ! grep -q 'pass://' "$TEST_ROOT/calls.log"
  run profile_run promote
  [ "$status" -eq 0 ]
  : >"$TEST_ROOT/calls.log"
  run profile_run check
  [ "$status" -eq 0 ]
  ! grep -q 'pass://' "$TEST_ROOT/calls.log"
}

@test "profile rejects provider redirects before accessing stores" {
  profile_fixture
  python3 - "$TEST_ROOT/secretspec.toml" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
path.write_text(path.read_text().replace(
    'OPTIONAL_TOKEN = { required = false }',
    'OPTIONAL_TOKEN = { required = false, providers = ["other"] }',
))
PY
  run profile_run promote
  [ "$status" -ne 0 ]
  [ ! -e "$TEST_ROOT/calls.log" ]
}

@test "unavailable profile source or target fails closed with no writes" {
  for provider in source target; do
    profile_fixture
    export FAIL_PROVIDER="$provider"
    run profile_run promote
    [ "$status" -ne 0 ]
    [[ "$output" == *'"result": "'"$provider"'_unavailable"'* ]]
    [[ "$output" != *PRIVATE_CANARY* ]]
    ! grep -q '"set"' "$TEST_ROOT/calls.log"
    unset FAIL_PROVIDER
    : >"$TEST_ROOT/calls.log"
  done
}

@test "profile refuses unsafe source values before any write" {
  profile_fixture
  printf '%s' '{"source":{"SHARED_TOKEN":"synthetic-shared","LIVE_TOKEN":"synthetic-live\n"},"target":{}}' \
    >"$TEST_ROOT/secretspec-state.json"
  run profile_run refresh
  [ "$status" -ne 0 ]
  ! grep -q '"set"' "$TEST_ROOT/calls.log"
  [[ "$output" != *synthetic-live* ]]
}

@test "interior newlines are preserved through the SecretSpec setter" {
  profile_fixture
  printf '%s' '{"source":{"SHARED_TOKEN":"synthetic-shared","LIVE_TOKEN":"synthetic-line1\nline2"},"target":{}}' \
    >"$TEST_ROOT/secretspec-state.json"
  run profile_run promote
  [ "$status" -eq 0 ]
  devenv_test_value=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["target"]["LIVE_TOKEN"])' "$TEST_ROOT/secretspec-state.json")
  [ "$devenv_test_value" = $'synthetic-line1\nline2' ]
  [[ "$output" != *synthetic-line1* ]]
}

@test "ensure fingerprints ciphertext, ignores absent optional entries, and retries changed values" {
  profile_fixture
  export XDG_STATE_HOME="$TEST_ROOT/state"
  run profile_run ensure
  [ "$status" -eq 0 ]
  : >"$TEST_ROOT/calls.log"
  run profile_run ensure
  [ "$status" -eq 0 ]
  ! grep -q 'pass://' "$TEST_ROOT/calls.log"
  printf 'rotated ciphertext' >"$PASSWORD_STORE_DIR/herbert/live/LIVE_TOKEN.gpg"
  : >"$TEST_ROOT/calls.log"
  run profile_run ensure
  [ "$status" -eq 0 ]
  [ "$(grep -c 'pass://' "$TEST_ROOT/calls.log")" -eq 1 ]
  ! grep -q '"set"' "$TEST_ROOT/calls.log"
}

@test "first ensure refuses stale existing values before writing anything" {
  profile_fixture
  export XDG_STATE_HOME="$TEST_ROOT/state"
  printf '%s' '{"source":{"SHARED_TOKEN":"synthetic-shared","LIVE_TOKEN":"synthetic-live"},"target":{"LIVE_TOKEN":"synthetic-old"}}' \
    >"$TEST_ROOT/secretspec-state.json"
  run profile_run ensure
  [ "$status" -ne 0 ]
  [[ "$output" == *'"result": "target_conflict"'* ]]
  ! grep -q '"set"' "$TEST_ROOT/calls.log"
}

@test "failed profile write or read-back never advances its fingerprint baseline" {
  profile_fixture
  export XDG_STATE_HOME="$TEST_ROOT/state"
  export FAIL_SET=LIVE_TOKEN
  run profile_run ensure
  [ "$status" -ne 0 ]
  [[ "$output" != *PRIVATE_CANARY* ]]
  ! find "$TEST_ROOT/state" -name '*.json' | grep -q .
  unset FAIL_SET
  export CORRUPT_SET=LIVE_TOKEN
  run profile_run ensure
  [ "$status" -ne 0 ]
  ! find "$TEST_ROOT/state" -name '*.json' | grep -q .
}

@test "reader resolves the declared Keychain service" {
  printf 'keychain-secret-for-veriff/mail/refresh-token' \
    >"$TEST_ROOT/keychain/veriff_mail_refresh-token"
  run "$MAIL_KEYCHAIN_READER_BIN" veriff/mail/refresh-token
  [ "$status" -eq 0 ]
  [ "$output" = keychain-secret-for-veriff/mail/refresh-token ]
}

@test "reader rejects undeclared pass keys" {
  run "$MAIL_KEYCHAIN_READER_BIN" undeclared/key
  [ "$status" -eq 64 ]
  [[ "$output" == *'undeclared pass key: undeclared/key'* ]]
}
