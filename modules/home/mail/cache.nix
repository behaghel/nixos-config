{ pkgs, lib, passCacheDir, passCacheTtl }:
let
  passCacheScript = pkgs.writeShellScriptBin "mail-pass" ''
    set -euo pipefail
    entry="''${1:?usage: mail-pass <pass-entry>}"
    cache_dir=${lib.escapeShellArg passCacheDir}
    ttl=${toString passCacheTtl}
    mkdir -p "$cache_dir"
    lock_file="$cache_dir/.pass-lock"
    exec 9>"$lock_file"
    if command -v flock >/dev/null 2>&1; then
      flock -x 9
    else
      lockdir="$lock_file.d"
      tries=0
      # Busy-wait with mkdir-based lock (portable) with a short retry loop
      while ! mkdir "$lockdir" 2>/dev/null; do
        tries=$((tries + 1))
        [ $tries -ge 30 ] && break
        sleep 1
      done
      trap 'rmdir "$lockdir" 2>/dev/null || true' EXIT INT TERM
    fi
    key=$(printf '%s' "$entry" | sha256sum | awk '{print $1}')
    cache_file="$cache_dir/$key"
    now=$(date +%s)
    fresh=0
    if [ -f "$cache_file" ]; then
      if stat --version >/dev/null 2>&1; then
        mtime=$(stat -c %Y "$cache_file" 2>/dev/null || echo 0)
      else
        mtime=$(stat -f %m "$cache_file" 2>/dev/null || echo 0)
      fi
      if [ "$mtime" -ne 0 ] && [ $(( now - mtime )) -lt "$ttl" ]; then
        fresh=1
      fi
    fi
    if [ "$fresh" -eq 0 ]; then
      if [ -z "''${MAIL_PASS_SUPPRESS_NOTIFY:-}" ] && [ -z "''${MAIL_PASS_NOTIFIED:-}" ] && command -v notify-send >/dev/null 2>&1; then
        notify-send "📭 Mail sync" "Touch your YubiKey to decrypt $entry." -i mail-unread || true
        export MAIL_PASS_NOTIFIED=1
      fi
      secret="$(pass show "$entry")" || exit $?
      printf '%s\n' "$secret" >"$cache_file.tmp"
      mv "$cache_file.tmp" "$cache_file"
      printf '%s\n' "$secret"
    else
      cat "$cache_file"
    fi
  '';

  gmailOAuthHelper = pkgs.writeShellApplication {
    name = "gmail-oauth2-token";
    runtimeInputs = [ pkgs.curl pkgs.jq pkgs.pass pkgs.coreutils pkgs.gnused ];
    text = ''
      set -euo pipefail
      cache_dir=${lib.escapeShellArg passCacheDir}
      ttl=${toString passCacheTtl}
      mkdir -p "$cache_dir"
      lock_file="$cache_dir/.oauth-lock"
      exec 9>"$lock_file"
      if command -v flock >/dev/null 2>&1; then
        flock -x 9
      else
        lockdir="$lock_file.d"
        tries=0
        while ! mkdir "$lockdir" 2>/dev/null; do
          tries=$((tries + 1))
          [ $tries -ge 30 ] && break
          sleep 1
        done
        trap 'rmdir "$lockdir" 2>/dev/null || true' EXIT INT TERM
      fi

      pass_cached() {
        key="$1"
        hash=$(printf '%s' "$key" | sha256sum | awk '{print $1}')
        cache_file="$cache_dir/$hash"
        now=$(date +%s)
        fresh=0
        if [ -f "$cache_file" ]; then
          if stat --version >/dev/null 2>&1; then
            mtime=$(stat -c %Y "$cache_file" 2>/dev/null || echo 0)
          else
            mtime=$(stat -f %m "$cache_file" 2>/dev/null || echo 0)
          fi
          if [ "$mtime" -ne 0 ] && [ $(( now - mtime )) -lt "$ttl" ]; then
            fresh=1
          fi
        fi
        if [ "$fresh" -eq 0 ]; then
          if [ -z "''${MAIL_PASS_SUPPRESS_NOTIFY:-}" ] && [ -z "''${MAIL_PASS_NOTIFIED:-}" ] && command -v notify-send >/dev/null 2>&1; then
            notify-send "📭 Mail sync" "Touch your YubiKey to decrypt $key." -i mail-unread || true
            export MAIL_PASS_NOTIFIED=1
          fi
          value="$(pass show "$key")" || return $?
          printf '%s\n' "$value" >"$cache_file.tmp"
          mv "$cache_file.tmp" "$cache_file"
          printf '%s\n' "$value"
        else
          cat "$cache_file"
        fi
      }

      mode="''${1:-token}"
      shift || true

      # Default secret prefix for your work account
      prefix="''${OAUTH_PASS_PREFIX:-veriff/mail}"
      # Allow env overrides; otherwise read from pass(1)
      CLIENT_ID="''${CLIENT_ID:-}"
      CLIENT_SECRET="''${CLIENT_SECRET:-}"
      REFRESH_TOKEN="''${REFRESH_TOKEN:-}"
      if [ -z "''${CLIENT_ID}" ]; then CLIENT_ID="$(pass_cached "$prefix/client-id" | head -n1 || true)"; fi
      if [ -z "''${CLIENT_SECRET}" ]; then CLIENT_SECRET="$(pass_cached "$prefix/client-secret" | head -n1 || true)"; fi
      if [ -z "''${REFRESH_TOKEN}" ]; then REFRESH_TOKEN="$(pass_cached "$prefix/refresh-token" | head -n1 || true)"; fi
      if [ -z "''${CLIENT_ID}" ] || [ -z "''${CLIENT_SECRET}" ] || [ -z "''${REFRESH_TOKEN}" ]; then
        echo "error: missing OAuth secret(s). Expected in env or pass under $prefix/{client-id,client-secret,refresh-token}" >&2
        exit 1
      fi
      resp=$(curl -sS --fail \
        -d client_id="''${CLIENT_ID}" \
        -d client_secret="''${CLIENT_SECRET}" \
        -d refresh_token="''${REFRESH_TOKEN}" \
        -d grant_type=refresh_token \
        https://oauth2.googleapis.com/token) || { echo "error: token endpoint failure" >&2; exit 1; }
      token=$(printf '%s' "$resp" | jq -r '.access_token // empty')
      if [ -z "$token" ]; then
        echo "error: could not parse access_token from response" >&2
        echo "$resp" >&2
        exit 1
      fi

      case "$mode" in
        token)
          printf '%s' "$token" ;;
        xoauth2)
          email="''${1:?usage: gmail-oauth2-token xoauth2 <email>}"
          printf 'user=%s\001auth=Bearer %s\001\001' "$email" "$token" | base64 | tr -d '\n' ;;
        oauthbearer)
          email="''${1:?usage: gmail-oauth2-token oauthbearer <email> [host] [port]}"; host="''${2:-imap.gmail.com}"; port="''${3:-993}"
          printf 'n,a=%s,\001host=%s\001port=%s\001auth=Bearer %s\001\001' "$email" "$host" "$port" "$token" | base64 | tr -d '\n' ;;
        inspect)
          curl -sS --fail "https://oauth2.googleapis.com/tokeninfo?access_token=$(printf '%s' "$token" | sed 's/\n$//')" | jq -r . ;;
        profile)
          curl -sS --fail -H "Authorization: Bearer $token" \
            "https://gmail.googleapis.com/gmail/v1/users/me/profile" | jq -r . ;;
        *)
          echo "error: unknown mode '$mode' (expected: token|xoauth2|oauthbearer|inspect|profile)" >&2; exit 2 ;;
      esac
    '';
  };
in
{
  inherit passCacheScript gmailOAuthHelper;
}
