# Native naming only: no daemon/network restart, login, or route changes.
set -eu
case "${1:-check}" in
    check|apply) mode=${1:-check} ;;
    *) echo 'usage: naming.sh [check|apply]' >&2; exit 2 ;;
esac
fail() { echo "naming: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail 'root access required'
for command in uci tailscale jsonfilter; do
    command -v "$command" >/dev/null || fail "$command unavailable"
done
[ -z "$(uci changes system)" ] || fail 'uncommitted system changes; inspect first'
old_name=$(uci -q get 'system.@system[0].hostname') || fail 'native hostname missing'
old_kernel=$(cat /proc/sys/kernel/hostname)

read_node() {
    status=$(tailscale status --json) || fail 'Tailscale status unavailable'
    backend=$(printf '%s' "$status" | jsonfilter -e '@.BackendState')
    [ "$backend" = Running ] || fail 'Tailscale is not running; will not log in'
    node_id=$(printf '%s' "$status" | jsonfilter -e '@.Self.ID')
    node_name=$(printf '%s' "$status" | jsonfilter -e '@.Self.HostName')
    dns_name=$(printf '%s' "$status" | jsonfilter -e '@.Self.DNSName')
    dns_label=${dns_name%%.*}
    [ -n "$node_id" ] && [ -n "$node_name" ] || fail 'node identity unavailable'
}
read_node
original_id=$node_id

compliant() {
    [ "$(uci -q get 'system.@system[0].hostname')" = "$desired_name" ] &&
    [ "$(cat /proc/sys/kernel/hostname)" = "$desired_name" ] &&
    [ "$node_name" = "$desired_name" ] && [ "$dns_label" = "$desired_name" ]
}
if [ "$mode" = check ]; then
    compliant || fail "name drift: UCI=$old_name kernel=$old_kernel Tailscale=$node_name DNS=$dns_label"
    echo "naming: $desired_name verified ($node_id)"
    exit 0
fi

restore_native() {
    uci set "system.@system[0].hostname=$old_name" && uci commit system
    printf '%s\n' "$old_kernel" > /proc/sys/kernel/hostname
}
if [ "$old_name" != "$desired_name" ]; then
    uci set "system.@system[0].hostname=$desired_name"
    if ! uci commit system; then
        uci -q revert 'system.@system[0].hostname'
        fail 'could not persist hostname'
    fi
fi
if ! printf '%s\n' "$desired_name" > /proc/sys/kernel/hostname; then
    restore_native
    fail 'could not set native hostname; restored previous native name'
fi
if [ "$node_name" != "$desired_name" ]; then
    if ! tailscale set "--hostname=$desired_name"; then
        restore_native
        fail 'Tailscale rejected rename; restored previous native name'
    fi
fi

# Control-plane DNS updates can lag. Do not accept a conflicting suffixed name.
attempt=0
while :; do
    read_node
    [ "$node_id" = "$original_id" ] || fail 'Tailnet node identity changed unexpectedly'
    if compliant; then
        echo "naming: $desired_name verified ($node_id)"
        exit 0
    fi
    attempt=$((attempt + 1))
    [ "$attempt" -lt 5 ] ||
        fail "rename not verified (DNS=$dns_label); native name retained, inspect Tailnet naming conflicts and retry check"
    sleep 1
done
