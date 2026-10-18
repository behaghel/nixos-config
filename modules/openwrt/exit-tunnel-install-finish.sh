# Managed by nixos-config OpenWrt exit-node module.
base=/etc/nixos-exit
if [ ! -f "$base/mode" ]; then
    [ "$mode" = apply ] || fail 'mode file missing'
    printf 'off\n' > "$base/mode"
    chmod 600 "$base/mode"
fi
for profile in on armed off; do
    batch=$(mktemp /tmp/nixos-exit-check.XXXXXX)
    if nft list table inet nixos_exit_guard >/dev/null 2>&1; then
        printf 'delete table inet nixos_exit_guard\n' > "$batch"
    fi
    cat "$base/$profile.nft" >> "$batch"
    if ! nft --check -f "$batch"; then rm -f "$batch"; fail 'kernel does not support guard profile'; fi
    rm -f "$batch"
done
if [ "$mode" = check ]; then
    /etc/init.d/nixos-exit enabled || fail 'guard boot service disabled'
    /etc/init.d/nixos-exit running || fail 'guard watcher not running'
    /usr/sbin/nixos-exit-node check
    exit 0
fi
# Protect an existing ON before touching native services. An initial install
# explicitly starts OFF; no exit is selected as a side effect of activation.
/usr/sbin/nixos-exit-node guard || fail 'could not establish requested guard'
[ "$(uci -q get firewall.tailscale0)" = zone ] || fail 'enable native Tailscale first'
[ "$(uci -q get firewall.tailscale0.name)" = tailscale0 ] || fail 'native Tailscale zone changed'
prefs=$(timeout 5 tailscale debug prefs) || fail 'native Tailscale unavailable'
corp_dns=$(printf '%s' "$prefs" | jsonfilter -e '@.CorpDNS') || fail 'unexpected Tailscale DNS schema'
if [ "$corp_dns" != false ]; then
    timeout 5 tailscale set --accept-dns=false || fail 'cannot release native DNS ownership'
fi
before=$(native_dns_get) || fail 'native DNS API unavailable'
zones=$(native_zones)
for zone in $downstream_zones; do
    case " $zones " in *" $zone "*) ;; *) continue ;; esac
    section="firewall.nixos_exit_$zone"
    if uci -q get "$section" >/dev/null; then
        [ "$(uci -q get "$section.name")" = 'nixos-config exit-tunnel' ] || fail "unowned forwarding: $section"
    fi
done
firewall_changed=0
for key in tailscale.settings.masq firewall.tailscale0.masq; do
    if [ "$(uci -q get "$key" || true)" != 1 ]; then
        uci set "$key=1"
        firewall_changed=1
    fi
done
for zone in $downstream_zones; do
    case " $zones " in *" $zone "*) ;; *) continue ;; esac
    section="firewall.nixos_exit_$zone"
    for entry in "$section=forwarding" "$section.name=nixos-config exit-tunnel" "$section.src=$zone" "$section.dest=tailscale0"; do
        key=${entry%%=*}; value=${entry#*=}
        if [ "$(uci -q get "$key" || true)" != "$value" ]; then
            uci set "$entry"
            firewall_changed=1
        fi
    done
done
if [ "$firewall_changed" = 1 ]; then
    uci commit tailscale
    uci commit firewall
    /etc/init.d/firewall reload
fi
if ! printf '%s' "$before" | lua "$base/native-dns.lua" check "$dns_address"; then
    if [ ! -f "$base/dns-before.json" ]; then
        printf '%s' "$before" > "$base/dns-before.json"
        chmod 600 "$base/dns-before.json"
    fi
    payload=$(printf '%s' "$before" | lua "$base/native-dns.lua" payload "$dns_address") || fail 'native DNS schema changed'
    timeout 15 ubus call gl-session call "$payload" >/dev/null || true
    after=$(native_dns_get) || after='{}'
    if ! printf '%s' "$after" | lua "$base/native-dns.lua" check "$dns_address"; then
        restore=$(printf '%s' "$before" | lua "$base/native-dns.lua" restore "$dns_address")
        timeout 15 ubus call gl-session call "$restore" >/dev/null || true
        fail 'native DNS configuration failed; previous settings restoration attempted'
    fi
fi
native_ready || fail 'native DNS/NAT/forwarding validation failed; requested guard retained'
/etc/init.d/nixos-exit enable
if [ "$changed" = 1 ] || ! /etc/init.d/nixos-exit running; then
    /etc/init.d/nixos-exit restart
fi
/usr/sbin/nixos-exit-node reconcile
/usr/sbin/nixos-exit-node check
sync
