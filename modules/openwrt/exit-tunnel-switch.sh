# Managed by nixos-config OpenWrt exit-node module.
# MT3000's vendor reader treats a failed GPIO read as OFF. Use the same
# read-only kernel source, but require exactly one valid input-level record.
switch_read() {
    switch_mode=$(
        [ "$(cat /proc/gl-hw-info/model)" = mt3000 ] || exit 1
        pin=$(cat /proc/gl-hw-info/switch-button) || exit 1
        printf '%s\n' "$pin" | grep -Eq '^gpio-[0-9]+$' || exit 1
        snapshot=$(cat /sys/kernel/debug/gpio) || exit 1
        printf '%s\n' "$snapshot" | awk -v pin="$pin" '
            $1 == pin {
                count++
                if ($0 !~ /\|switch[[:space:]]*\)/) { bad=1; next }
                sub(/^.*\)[[:space:]]*/, "")
                if ($1 != "in" || ($2 != "hi" && $2 != "lo")) { bad=1; next }
                state=($2 == "hi" ? "on" : "off")
            }
            END { if (count != 1 || bad || state == "") exit 1; print state }
        '
    ) || return 1
}
switch_bound() {
    [ "$(uci -q get 'switch-button.@main[0].func')" = nixos-exit ]
}
switch_confirm() {
    [ "$switch_enabled" = 1 ] || return 0
    if switch_bound && switch_read && [ "$switch_mode" = "$1" ]; then return 0; fi
    guard armed apply || fail 'could not restore protection after switch change'
    fail 'physical switch changed or is unreadable; blocking policy retained'
}
switch_install_preflight() {
    selected_switch=$(uci -q get 'switch-button.@main[0].func' || true)
    if [ "$switch_enabled" = 1 ]; then
        [ -d /etc/gl-switch.d ] && [ ! -L /etc/gl-switch.d ] || fail 'unsupported native switch handler directory'
        [ -x /etc/rc.button/switch ] && [ -x /etc/init.d/gl_switch_button_check ] || fail 'native switch dispatcher unavailable'
        grep -Fq '/etc/gl-switch.d/$func.sh' /etc/rc.button/switch || fail 'native switch dispatcher contract changed'
        switch_read || fail 'unsupported or unreadable physical switch; no binding changed'
        case "$selected_switch" in ''|nixos-exit) ;; *) fail 'physical switch already assigned; clear its native function before applying' ;; esac
        [ "$mode" != check ] || switch_bound || fail 'native switch assignment drift'
    elif [ "$selected_switch" = nixos-exit ]; then
        [ "$mode" != check ] || fail 'native switch must be unassigned'
        [ -f /etc/gl-switch.d/nixos-exit.sh ] && [ ! -L /etc/gl-switch.d/nixos-exit.sh ] &&
            grep -Fxq '# Managed by nixos-config OpenWrt exit-node module.' /etc/gl-switch.d/nixos-exit.sh || fail 'unowned switch binding'
    fi
    if [ "$switch_enabled" = 1 ] || [ "$selected_switch" = nixos-exit ]; then
        pending_switch=$(uci changes switch-button) || fail 'cannot inspect pending switch-button changes'
        [ -z "$pending_switch" ] || fail 'pending switch-button changes; inspect first'
    fi
}
switch_install_apply() {
    # File/profile preparation happens after the first preflight. Revalidate
    # ownership and pending edits immediately before mutating native config.
    switch_install_preflight
    if [ "$switch_enabled" = 1 ]; then
        if ! switch_bound; then
            uci set 'switch-button.@main[0].func=nixos-exit'
            uci commit switch-button
            changed=1
        fi
    elif switch_bound; then
        uci delete 'switch-button.@main[0].func'
        uci commit switch-button
        rm -f /etc/gl-switch.d/nixos-exit.sh
        changed=1
    fi
}
