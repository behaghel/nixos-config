# Managed by nixos-config OpenWrt exit-node module.
# Shared read-only native DNS/firewall contract for installer and controller.
native_zones() {
    uci show firewall | awk -F= '
        $2 == "zone" { zones[$1]=1 }
        $1 ~ /\.name$/ {
            section=$1; sub(/\.name$/, "", section)
            name=$2; gsub(/\047/, "", name)
            if (zones[section]) printf "%s ", name
        }
    '
}
native_dns_get() {
    timeout 10 ubus call gl-session call '{"module":"dns","func":"get_config"}'
}
peer_ready() {
    peer=$(timeout 5 tailscale status --json) || return 1
    printf '%s' "$peer" | lua "$base/native-dns.lua" peer-check "$exit_ip" "$exit_id" "$tailnet_suffix"
}
# Check Tailscale's protected (0x80000) router-originated DNS route. This is
# not a DNS reachability probe. OFF never depends on this prerequisite.
bootstrap_ready() {
    servers=$(awk '$1 == "nameserver" { if (++n <= 3) print $2; else exit }' \
        /tmp/resolv.conf.d/resolv.conf.auto) || return 1
    for server in $servers; do
        case "$server" in ''|*[!0-9.]*) continue ;; esac
        route=$(ip -4 route get "$server" mark 0x80000 uid 0 2>/dev/null) || continue
        case " $route " in
            *" dev tailscale0 "*|*" dev lo "*|*" linkdown "*) ;;
            *" dev "*) return 0 ;;
        esac
    done
    return 1
}
native_ready() {
    dns=$(native_dns_get) || return 1
    printf '%s' "$dns" | lua "$base/native-dns.lua" check "$dns_address" || return 1
    lua "$base/native-dns.lua" scope-check "$tailnet_suffix" < /etc/dnsmasq.conf || return 1
    [ "$(uci -q get tailscale.settings.enabled)" = 1 ] || return 1
    [ "$(uci -q get dhcp.@dnsmasq[0].server)" = "$dns_address" ] || return 1
    # Native manual DNS sets noresolv=1 and deletes localuse. The native
    # dnsmasq service then defaults localuse to 0; an explicit 1 is unsafe.
    [ "$(uci -q get dhcp.@dnsmasq[0].noresolv)" = 1 ] || return 1
    case "$(uci -q get dhcp.@dnsmasq[0].localuse || true)" in ''|0) ;; *) return 1 ;; esac
    [ "$(uci -q get dhcp.@dnsmasq[0].queryport || printf '0')" = 0 ] || return 1
    [ "$(readlink /tmp/resolv.conf)" = /tmp/resolv.conf.d/resolv.conf.auto ] || return 1
    [ "$(uci -q get tailscale.settings.masq)" = 1 ] || return 1
    [ "$(uci -q get firewall.tailscale0.masq)" = 1 ] || return 1
    iptables -t nat -S zone_tailscale0_postrouting | grep -q -- '-j MASQUERADE' || return 1
    iptables -t nat -S POSTROUTING | grep -q 'tailscale0.*zone_tailscale0_postrouting' || return 1
    zones=$(native_zones) || return 1
    for zone in $downstream_zones; do
        case " $zones " in
            *" $zone "*)
                section="firewall.nixos_exit_$zone"
                [ "$(uci -q get "$section")" = forwarding ] &&
                [ "$(uci -q get "$section.name")" = 'nixos-config exit-tunnel' ] &&
                [ "$(uci -q get "$section.src")" = "$zone" ] &&
                [ "$(uci -q get "$section.dest")" = tailscale0 ] || return 1
                iptables -S "zone_${zone}_forward" | grep -q -- '-j zone_tailscale0_dest_ACCEPT' || return 1 ;;
        esac
    done
}
