# Native Dropbear policy. Only password options are owned; no credential,
# listener address/port, root-login, web-admin, or authorized-key changes.
set -eu
case "${1:-check}" in
    check|apply) mode=${1:-check} ;;
    *) echo 'usage: ssh-policy.sh [check|apply]' >&2; exit 2 ;;
esac
fail() { echo "ssh-policy: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail 'root access required'
[ -x /etc/init.d/dropbear ] || fail 'native Dropbear service unavailable'
[ -z "$(uci changes dropbear)" ] || fail 'uncommitted Dropbear settings; inspect first'
[ -f /etc/dropbear/authorized_keys ] || fail 'operator authorization unavailable'
blob=$(printf '%s\n' "$operator_key" | awk '{print $2}')
[ -n "$blob" ] || fail 'operator identity unavailable'
awk -v key="$blob" '$1 == "ssh-ed25519" && $2 == key { found=1 }
    END { exit !found }' /etc/dropbear/authorized_keys ||
    fail 'canonical operator key must be installed before password cutover'

sections=$(uci show dropbear | awk -F= '$2 == "dropbear" {print $1}')
[ -n "$sections" ] || fail 'no native Dropbear instances'
snapshot=
changed=0
for section in $sections; do
    enabled=$(uci -q get "$section.enable" || printf '1')
    root_login=$(uci -q get "$section.RootLogin" || printf '1')
    case "$enabled:$root_login" in
        0:*|off:*|false:*|no:*) ;;
        *:0|*:off|*:false|*:no)
            fail "root key login disabled in $section; inspect before reloading" ;;
    esac
    for option in PasswordAuth RootPasswordAuth; do
        setting=$section.$option
        value=$(uci -q get "$setting" || printf '__unset__')
        case "$value" in
            0|off|false|no) ;;
            1|on|true|yes|__unset__) changed=1 ;;
            *) fail "unsupported boolean $setting; inspect first" ;;
        esac
        snapshot="$snapshot$setting|$value
"
    done
done

listener_hardened() {
    found=0
    for pid_file in /var/run/dropbear.*.pid; do
        [ -f "$pid_file" ] || continue
        found=1
        pid=$(cat "$pid_file")
        case "$pid" in ''|*[!0-9]*) return 1 ;; esac
        [ -r "/proc/$pid/cmdline" ] || return 1
        args=$(tr '\000' '\n' < "/proc/$pid/cmdline")
        printf '%s\n' "$args" | grep -Fxq /usr/sbin/dropbear || return 1
        printf '%s\n' "$args" | grep -Fxq -- -s || return 1
        printf '%s\n' "$args" | grep -Fxq -- -g || return 1
    done
    [ "$found" = 1 ]
}
if [ "$changed" = 0 ] && listener_hardened; then
    echo 'ssh-policy: password access disabled in configuration and live listeners'
    exit 0
fi
[ "$mode" = apply ] || fail 'SSH password policy drift (configuration or live listener)'

restore_options() {
    while IFS='|' read -r setting value; do
        [ -n "$setting" ] || continue
        if [ "$value" = __unset__ ]; then
            uci -q delete "$setting" || return 1
        else
            uci set "$setting=$value" || return 1
        fi
    done <<EOF
$snapshot
EOF
    uci commit dropbear
}
rollback() {
    if restore_options && /etc/init.d/dropbear reload; then
        echo 'ssh-policy: restored previous password settings' >&2
    else
        echo 'ssh-policy: rollback incomplete; use the retained recovery session' >&2
    fi
}
if [ "$changed" = 1 ]; then
    if ! (
        for section in $sections; do
            uci set "$section.PasswordAuth=off" || exit 1
            uci set "$section.RootPasswordAuth=off" || exit 1
        done
        uci commit dropbear || exit 1
    ); then
        rollback
        fail 'could not persist password policy'
    fi
fi
# Native procd reload replaces listeners, not established client sessions.
if ! /etc/init.d/dropbear reload; then
    rollback
    fail 'native service reload failed'
fi
attempt=0
until listener_hardened; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 10 ]; then
        rollback
        fail 'new listener flags not verified'
    fi
    sleep 1
done
echo 'ssh-policy: password access disabled in configuration and live listeners'
