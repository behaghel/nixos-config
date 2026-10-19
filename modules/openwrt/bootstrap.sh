# Native OpenWrt shell; Nix prepends managed_keys. No Nix runtime on the router.
set -eu

case "${1:-check}" in
    check|apply) mode=${1:-check} ;;
    *) echo 'usage: sh bootstrap.sh [check|apply]' >&2; exit 2 ;;
esac

fail() { echo "bootstrap: $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail 'run from the existing root session'
command -v dropbear >/dev/null || fail 'native Dropbear not found; inspect first'
command -v uci >/dev/null || fail 'UCI not found; inspect first'
[ "$(uci -q get 'dropbear.@dropbear[0]')" = dropbear ] ||
    fail 'native Dropbear configuration not found; inspect first'

key_dir=/etc/dropbear
key_file=$key_dir/authorized_keys
[ -d "$key_dir" ] && [ ! -L "$key_dir" ] ||
    fail 'expected a real /etc/dropbear directory'
[ ! -L "$key_file" ] || fail 'refusing symlink authorized_keys'
[ ! -e "$key_file" ] || [ -f "$key_file" ] ||
    fail 'authorized_keys is not a regular file'
[ -n "$managed_keys" ] || fail 'no managed keys'

# Inspect every key before writing. Never bypass an existing restriction by
# appending an unrestricted copy of the same credential.
key_status() {
    file=${3:-$key_file}
    [ -f "$file" ] || return 1
    awk -v type="$1" -v key="$2" '
        /^[[:space:]]*#/ { next }
        $1 == type && $2 == key { unrestricted = 1 }
        { for (i = 2; i <= NF; i++)
            if ($i == type && $(i+1) == key) restricted = 1 }
        END { if (restricted) exit 2; if (unrestricted) exit 0; exit 1 }
    ' "$file"
}

while IFS= read -r key; do
    type=${key%% *}
    rest=${key#* }
    blob=${rest%% *}
    if key_status "$type" "$blob"; then
        echo "bootstrap: $type key already present" >&2
    else
        status=$?
        [ "$status" = 1 ] || fail 'key has existing restrictions; inspect first'
        echo "bootstrap: $type key missing" >&2
    fi
done <<EOF
$managed_keys
EOF

[ "$mode" = apply ] || exit 0

# Atomic replacement on the same filesystem. Preserve all existing entries.
umask 077
tmp=$(mktemp "$key_dir/.authorized_keys.XXXXXX")
trap 'rm -f "$tmp"' EXIT
trap 'exit 1' HUP INT TERM
if [ -f "$key_file" ]; then
    cp "$key_file" "$tmp"
    # Separate an unterminated existing entry from the new key.
    [ ! -s "$tmp" ] || [ -z "$(tail -c 1 "$tmp")" ] || printf '\n' >> "$tmp"
fi
while IFS= read -r key; do
    type=${key%% *}
    rest=${key#* }
    blob=${rest%% *}
    if ! key_status "$type" "$blob" "$tmp"; then
        printf '%s\n' "$key" >> "$tmp"
    fi
done <<EOF
$managed_keys
EOF
chmod 700 "$key_dir"
chmod 600 "$tmp"
if [ -f "$key_file" ] && cmp -s "$tmp" "$key_file"; then
    chmod 600 "$key_file"
else
    mv "$tmp" "$key_file"
fi

echo 'bootstrap: public key installed; password policy and services unchanged' >&2
echo 'bootstrap: keep this session open; test a fresh key-only SSH connection' >&2
