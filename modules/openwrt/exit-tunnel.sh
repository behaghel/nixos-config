# Managed by nixos-config OpenWrt exit-node module.
set -eu
fail() { logger -t beryl-exit "$*"; echo "beryl-exit: $*" >&2; exit 1; }
operation=${1:-check}
case "$operation" in on|off|guard|reconcile|check|watch|--locked) ;; *) fail 'use on, off, or check' ;; esac
if [ "$operation" = watch ]; then
    while :; do
        "$0" reconcile || logger -t beryl-exit 'reconciliation incomplete; requested mode retained'
        sleep 5
    done
fi
if [ "$operation" != --locked ]; then
    exec flock /var/lock/nixos-exit.lock /bin/sh "$0" --locked "$@"
fi
shift
operation=${1:-check}
case "$operation" in on|off|guard|reconcile|check) ;; *) fail 'invalid operation' ;; esac
[ "$(id -u)" = 0 ] || fail 'root access required'
base=/etc/nixos-exit
stamp=/var/run/nixos-exit-applied
read_mode() {
    mode=$(cat "$base/mode" 2>/dev/null || true)
    case "$mode" in on|off) ;; *) mode=on; logger -t beryl-exit 'invalid/missing mode: enforcing protected mode' ;; esac
}
write_mode() {
    [ "$(cat "$base/mode" 2>/dev/null || true)" != "$1" ] || { mode=$1; return; }
    pending=$(mktemp "$base/.mode.XXXXXX")
    printf '%s\n' "$1" > "$pending"
    chmod 600 "$pending"
    mv "$pending" "$base/mode"
    sync
    mode=$1
}
prerequisites() {
    [ "$(uci -q get glconfig.general.mode)" = router ] || fail 'protected routing requires native router mode'
    [ "$(uci -q get mtkhnat.global.enable)" = 0 ] ||
        fail 'disable Network Acceleration and reboot before protected routing'
    for key in flow_offloading flow_offloading_hw; do
        [ "$(uci -q get "firewall.@defaults[0].$key" || printf '0')" = 0 ] || fail 'disable persistent flow offload'
    done
    filter=$(iptables-save -t filter) || fail 'cannot inspect live flow offload'
    ! printf '%s\n' "$filter" | grep -q -- '-j FLOWOFFLOAD' || fail 'live flow offload is incompatible with the guard'
    [ "$(id -u dnsmasq)" = 453 ] || fail 'native resolver identity changed'
    [ -z "$(uci -q get tailscale.settings.exit_node_ip || true)" ] ||
        fail 'leave native Custom Exit Nodes off; the controller owns exit selection'
}
# A dedicated inet table precedes fw3's filter hooks. fw3 does not own it.
# Replacement is a single atomic nft transaction; never flush the ruleset.
guard() {
    wanted=$1; action=$2
    guard_changed=0
    case "$wanted" in
        on) trusted=$on_hash ;; armed) trusted=$armed_hash ;; off) trusted=$off_hash ;; *) return 1 ;;
    esac
    profile=$(cat "$base/$wanted.nft") || return 1
    manifest=$(printf '%s\n' "$profile" | sha256sum) || return 1
    manifest=${manifest%% *}
    [ "$manifest" = "$trusted" ] || return 1
    inventory=$(nft list tables) || return 1
    listing=''
    if printf '%s\n' "$inventory" | grep -Fxq 'table inet nixos_exit_guard'; then
        listing=$(nft -n -s list table inet nixos_exit_guard) || return 1
        [ -n "$listing" ] || return 1
    fi
    live=$(printf '%s\n' "$listing" | sha256sum | awk '{print $1}')
    expected="$wanted $manifest $live"
    if [ -n "$listing" ] && [ "$(cat "$stamp" 2>/dev/null || true)" = "$expected" ]; then return 0; fi
    [ "$action" != check ] || return 1
    batch=$(mktemp /tmp/nixos-exit-nft.XXXXXX) || return 1
    trap 'rm -f "$batch"' EXIT
    trap 'exit 1' HUP INT TERM
    if [ -n "$listing" ]; then printf 'delete table inet nixos_exit_guard\n' > "$batch" || return 1; fi
    printf '%s\n' "$profile" >> "$batch" || return 1
    nft --check -f "$batch" || return 1
    nft -f "$batch" || return 1
    guard_changed=1
    listing=$(nft -n -s list table inet nixos_exit_guard) || return 1
    live=$(printf '%s\n' "$listing" | sha256sum | awk '{print $1}')
    printf '%s %s %s\n' "$wanted" "$manifest" "$live" > "$stamp"
    chmod 600 "$stamp"
    rm -f "$batch"
}
get_exit() {
    prefs=$(timeout 5 tailscale debug prefs) || return 1
    selected=$(printf '%s' "$prefs" | jsonfilter -e '@.ExitNodeID') || return 1
    lan=$(printf '%s' "$prefs" | jsonfilter -e '@.ExitNodeAllowLANAccess') || return 1
    corp_dns=$(printf '%s' "$prefs" | jsonfilter -e '@.CorpDNS') || return 1
}
clean_dns_flows() {
    for family in ipv4 ipv6; do
        for protocol in udp tcp; do
            conntrack -f "$family" -D -p "$protocol" --dport 53 >/dev/null 2>&1 || true
        done
    done
}
clear_exit() {
    if get_exit; then
        if [ -n "$selected" ] || [ "$corp_dns" != false ]; then
            if timeout 5 tailscale set --exit-node= --accept-dns=false; then changed=1; return 0; fi
        else
            return 0
        fi
    fi
    # A dead/unresponsive local daemon must not strand explicit OFF. Remove
    # only Tailscale exit defaults, preserving its host/subnet overlay routes.
    for family in -4 -6; do
        while ip "$family" route del default dev tailscale0 table 52 >/dev/null 2>&1; do changed=1; done
    done
    logger -t beryl-exit 'OFF: local preference clear pending; exit defaults removed'
}
read_mode
changed=0
case "$operation" in
    on) prerequisites; [ "$mode" = on ] || changed=1; write_mode on ;;
    off) [ "$mode" = off ] || changed=1; write_mode off ;;
esac
if [ "$operation" = guard ]; then
    if [ "$mode" = on ]; then
        # Keep an existing validated policy on reapply; a fresh boot has no
        # runtime stamp and must block all forwarding until identity is checked.
        guard on check || guard armed apply || fail 'could not arm boot protection'
    else
        guard off apply || fail 'could not restore explicit OFF'
    fi
    exit 0
fi
if [ "$operation" = check ]; then
    guard "$mode" check || fail 'independent guard drift'
    native_ready || fail 'native DNS/NAT drift'
    if [ "$mode" = on ]; then
        prerequisites
        get_exit && [ "$selected" = "$exit_id" ] && [ "$lan" = true ] && [ "$corp_dns" = false ] || fail 'exit/DNS preference drift; guard retained'
        ip -4 route get "$dns_address" uid 453 | grep -q 'dev tailscale0' || fail 'client DNS route is not the tunnel'
    elif get_exit; then
        [ -z "$selected" ] && [ "$corp_dns" = false ] || fail 'local exit/DNS preference still pending'
    else
        [ -z "$(ip -4 route show table 52 default dev tailscale0)" ] || fail 'stale exit default'
        [ -z "$(ip -6 route show table 52 default dev tailscale0)" ] || fail 'stale IPv6 exit default'
    fi
    echo "beryl-exit: $mode policy verified (connectivity needs a separate probe)"
    exit 0
fi
if [ "$mode" = on ]; then
    if ! get_exit || [ "$selected" != "$exit_id" ] || [ "$lan" != true ] || [ "$corp_dns" != false ]; then
        guard armed apply || fail 'guard installation failed; no new exit selected'
    else
        guard on check || guard armed apply || fail 'could not restore protection'
    fi
    prerequisites
    get_exit || fail 'local Tailscale unavailable; guard retained'
    if [ "$corp_dns" != false ]; then
        timeout 5 tailscale set --accept-dns=false || fail 'could not release native DNS ownership; guard retained'
        changed=1
    fi
    if ! native_ready; then
        guard armed apply || fail 'could not restore blocking policy'
        fail 'native DNS/NAT not ready; blocking policy retained'
    fi
    get_exit || fail 'local Tailscale unavailable; guard retained'
    if [ "$selected" != "$exit_id" ] || [ "$lan" != true ]; then
        peer=$(timeout 5 tailscale status --json) || fail 'peer state unavailable; guard retained'
        printf '%s' "$peer" | lua "$base/native-dns.lua" peer-check "$exit_ip" "$exit_id" ||
            fail 'exit identity/approval mismatch; guard retained'
        timeout 5 tailscale set "--exit-node=$exit_ip" --exit-node-allow-lan-access=true --accept-dns=false || fail 'exit unavailable; guard retained'
        changed=1
        get_exit && [ "$selected" = "$exit_id" ] && [ "$lan" = true ] && [ "$corp_dns" = false ] || fail 'unexpected exit identity/preferences; guard retained'
    fi
    ip -4 route get "$dns_address" uid 453 | grep -q 'dev tailscale0' || fail 'client DNS route unavailable; guard retained'
    guard on apply || fail 'could not release verified tunnel traffic'
else
    clear_exit
    # OFF deliberately releases client restrictions without a remote peer or
    # an active DNS/Tailscale control service being required.
    [ "$changed" = 0 ] || clean_dns_flows
    guard off apply || fail 'could not release owned guard'
fi
if [ "$mode" = on ] && [ "$changed" = 1 ]; then clean_dns_flows; fi
if [ "$operation" != reconcile ] || [ "$changed" = 1 ] || [ "$guard_changed" = 1 ]; then
    logger -t beryl-exit "$mode reconciled"
    echo "beryl-exit: $mode reconciled"
fi
