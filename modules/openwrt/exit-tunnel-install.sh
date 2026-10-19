# Managed by nixos-config OpenWrt exit-node module.
set -eu
mode=${1:-check}
case "$mode" in check|apply) ;; *) echo 'invalid install mode' >&2; exit 2 ;; esac
fail() { echo "exit-tunnel install: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail 'root access required'
for command in fw3 nft lua iptables iptables-save dnsmasq tailscale jsonfilter flock conntrack sha256sum timeout; do
    command -v "$command" >/dev/null || fail "missing native command: $command"
done
if command -v fw4 >/dev/null; then fail 'fw4 lifecycle is not qualified by this module'; fi
lua -e 'require("cjson")' || fail 'native JSON codec unavailable'
[ "$(uci -q get mtkhnat.global.enable)" = 0 ] ||
    fail 'disable Network Acceleration in GL.iNet, then reboot before deployment'
for key in flow_offloading flow_offloading_hw; do
    [ "$(uci -q get "firewall.@defaults[0].$key" || printf '0')" = 0 ] || fail 'disable flow offload before deployment'
done
filter=$(iptables-save -t filter) || fail 'cannot inspect live flow offload'
! printf '%s\n' "$filter" | grep -q -- '-j FLOWOFFLOAD' || fail 'live flow offload is incompatible with the guard'
[ "$(id -u dnsmasq)" = 453 ] || fail 'unexpected native resolver identity'
[ "$(uci -q get glconfig.general.mode)" = router ] || fail 'native router mode required'
[ -z "$(uci -q get tailscale.settings.exit_node_ip || true)" ] || fail 'leave native Custom Exit Nodes off; controller owns selection'
for package in firewall tailscale gl-dns-v2 dhcp; do
    [ -z "$(uci changes "$package")" ] || fail "pending $package changes; inspect first"
done
switch_install_preflight
[ ! -L /etc/nixos-exit ] || fail 'refusing a symlink configuration directory'
if nft list table inet nixos_exit_guard >/dev/null 2>&1; then
    grep -Fxq '# Managed by nixos-config OpenWrt exit-node module.' /usr/sbin/nixos-exit-node || fail 'unowned nft namespace'
fi
changed=0
if [ "$mode" = apply ]; then
    mkdir -p /etc/nixos-exit
    chown 0:0 /etc/nixos-exit
    chmod 700 /etc/nixos-exit
fi
write_owned() {
    path=$1; permissions=$2
    tmp=$(mktemp /tmp/nixos-exit-file.XXXXXX)
    cat > "$tmp"
    if [ -L "$path" ] || { [ -e "$path" ] && [ ! -f "$path" ]; }; then
        rm -f "$tmp"; fail "unsupported target: $path"
    fi
    if [ -f "$path" ] && ! grep -Fxq \
        -e '# Managed by nixos-config OpenWrt exit-node module.' \
        -e '-- Managed by nixos-config OpenWrt exit-node module.' "$path"; then
        rm -f "$tmp"; fail "unowned target: $path"
    fi
    if ! cmp -s "$tmp" "$path"; then
        if [ "$mode" = check ]; then rm -f "$tmp"; fail "file drift: $path"; fi
        staged=$(mktemp "$path.XXXXXX")
        cat "$tmp" > "$staged"
        chmod "$permissions" "$staged"
        mv "$staged" "$path"
        changed=1
    fi
    rm -f "$tmp"
    metadata=$(ls -ldn "$path" | awk '{print $1, $3, $4}')
    case "$permissions" in 0755) wanted='-rwxr-xr-x 0 0' ;; 0644) wanted='-rw-r--r-- 0 0' ;; esac
    if [ "$metadata" != "$wanted" ]; then
        [ "$mode" = apply ] || fail "ownership/mode drift: $path"
        chown 0:0 "$path"
        chmod "$permissions" "$path"
        changed=1
    fi
}
