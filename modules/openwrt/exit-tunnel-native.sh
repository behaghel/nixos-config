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
native_ready() {
    dns=$(native_dns_get) || return 1
    printf '%s' "$dns" | lua "$base/native-dns.lua" check "$dns_address" || return 1
    [ "$(uci -q get dhcp.@dnsmasq[0].server)" = "$dns_address" ] || return 1
    [ "$(uci -q get dhcp.@dnsmasq[0].localuse)" = 0 ] || return 1
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
