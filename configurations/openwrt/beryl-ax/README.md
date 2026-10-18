# Beryl AX

GL.iNet firmware stays in place. Nix builds native scripts on the management
machine; the router does not need Nix. `default.nix` declares desired state,
not proof that the router has been onboarded.

## First access

Keep an existing trusted root session and web-admin access available. Bootstrap
only adds the public key from `config.nix`; it does not rename the router, disable
passwords, alter networking, or restart services.

Run on the Mac, checking each command succeeds before continuing:

```sh
# Prints public-key bootstrap, without applying it.
devenv -q shell -- nix run '.#beryl-ax:bootstrap' > /tmp/beryl-ax-bootstrap.sh
# Read-only preflight; use the router admin password when prompted.
ssh -o StrictHostKeyChecking=yes root@192.168.8.1 'sh -s -- check' < /tmp/beryl-ax-bootstrap.sh
# After reviewing preflight, install the public key through the trusted session.
ssh -o StrictHostKeyChecking=yes root@192.168.8.1 'sh -s -- apply' < /tmp/beryl-ax-bootstrap.sh
# Fresh authentication; touch the YubiKey. No password or connection reuse.
ssh -o StrictHostKeyChecking=yes -o ControlMaster=no -o ControlPath=none \
  -o BatchMode=yes -o PreferredAuthentications=publickey \
  root@192.168.8.1 'uci -q get system.@system[0].hostname'
```

Verify the router's host fingerprint through the existing trusted session if
strict checking fails; do not disable host-key verification. A missing card or
withheld touch must not authenticate a fresh connection. Stop if it does: inspect
the offered agent identity and token touch policy before hardening.

## Naming and the client alias

After fresh-key acceptance, the tool manages native/Tailnet naming and key-only
SSH policy. Keep an interactive recovery session open before applying. The tool
pins the verified host key and operator identity, never falls back to a password,
and verifies application with a second fresh SSH authentication. Expect two
YubiKey touches for an apply. Web-admin credentials are not changed.

```sh
# Read-only: exits nonzero until names and SSH password policy agree.
devenv -q shell -- beryl-ax:activate --check --target 100.101.32.55
# Human-approved naming and SSH password cutover; preserves node registration.
devenv -q shell -- beryl-ax:activate --apply --target 100.101.32.55
# Repeat check, then apply again to verify no further semantic changes.
devenv -q shell -- beryl-ax:activate --check --target 100.101.32.55
```

The address above is the currently verified router address, not a stored default.
The normal tool target is `beryl-ax`; an override still verifies the same pinned
host identity. Native UCI changes awaiting commit block application, so unrelated
pending settings cannot accidentally be committed. The identity/SSH phase only reloads native Dropbear listeners when needed;
existing sessions are retained. The exit-tunnel phase below additionally manages
native DNS/firewall settings. A compliant second apply avoids service reloads.

After renaming, manually activate the Mac's system configuration with
`nix run .#activate` to refresh Tailnet-backed aliases, and its Home Manager
configuration with `nix run` to install the SSH client block. Then verify:

```sh
ssh beryl-ax 'uci -q get system.@system[0].hostname'
devenv -q shell -- beryl-ax:activate --check
```

GL.iNet runs `tailscale up --reset` on network events. The persisted native
hostname supplies the matching default when the explicit Tailscale hostname
preference is reset; vendor scripts stay untouched. Confirm names after the next
approved reconnect/reboot. A conflicting or manually overridden Tailnet DNS label
fails verification instead of silently accepting a different name.

## SSH policy acceptance and recovery

`--check` verifies both persistent password options and live listener flags.
Application turns off `PasswordAuth` and `RootPasswordAuth` for every configured
Dropbear instance, preserving ports, interface bindings, root key access, other
keys, and web-admin credentials. Reload/flag-verification failures attempt to
restore the previous options; keep the recovery session open until fresh access
and web administration are verified.

To verify that SSH no longer offers password authentication, run on the Mac:

```sh
ssh -vv -o PubkeyAuthentication=no -o PreferredAuthentications=password \
  -o BatchMode=yes beryl-ax true 2>&1 | grep 'Authentications that can continue'
```

Expected: only `publickey` is offered, followed by authentication failure. A
connection failure or a failed exit code alone is not proof of password denial.

If recovery is necessary, run in the retained Beryl root session (these are the
original password settings on this device):

```sh
uci set dropbear.main.PasswordAuth=on
uci set dropbear.main.RootPasswordAuth=on
uci commit dropbear
/etc/init.d/dropbear reload
```

After successful acceptance, schedule a manual reboot. Recheck fresh YubiKey
access, `beryl-ax:activate --check`, password-method rejection, web administration,
and ordinary LAN internet. The inspected `sysupgrade -l` includes system,
Dropbear configuration/keys, and Tailscale state; verify after firmware upgrades
or reapply instead of assuming vendor upgrades preserve policy.

## Exit tunnel — pending live acceptance

The current declaration also enables an **unaccepted manual tunnel prototype**.
Do not use it for sensitive traffic until the packet tests below pass. The
physical switch is not assigned by this module.

Qualified baseline: MT3000 firmware 4.11.0, native fw3, Tailscale 1.92.5. The
generated armed/ON/OFF profiles passed the router's check-only nftables validation.
The scoped native DNS configuration also passed native dnsmasq syntax validation
using a temporary copy. No rules/settings were installed; actual DNS integration
and packet-level behavior still need live acceptance. Requalify after a
firmware upgrade rather than assuming the same firewall lifecycle.

- Disable **Network Acceleration**, then reboot before deployment. Persistent
  flow offload must also remain disabled; configuration checks alone do not prove
  that previously accelerated connections have stopped bypassing netfilter.
- Leave native **Custom Exit Nodes** off: vendor network events reset Tailscale
  preferences, and the controller owns selecting MeLE and restoring that choice.
- Native IP Masquerading handles client NAT. Owned native forwardings allow the
  declared LAN/guest/IoT zones outbound to Tailscale, without adding reverse
  forwardings. Masqueraded clients share the router's Tailnet identity/ACLs;
  this is not an additional guest-to-Tailnet isolation policy.
- Native DNS uses Quad9 `9.9.9.9` for clients in **both** modes. Native router-DNS
  separation keeps router bootstrap resolution on uplink DNS; local dnsmasq
  names remain available. Tailscale's `accept-dns` stays false so its OS resolver
  integration does not compete with native DNS. Health checks inspect the actual
  dnsmasq server and router resolver link, not just the admin UI metadata. There
  is no second DNS daemon.
- Native MagicDNS forwarding is narrowed from all `ts.net` to the declared
  `tailnetSuffix`. Tailscale [answers this local domain authoritatively](https://github.com/tailscale/tailscale/blob/v1.92.5/net/dns/resolver/tsdns.go),
  including NXDOMAIN for unknown local names, without upstream DNS forwarding.
  Only the native resolver gets the Quad100 exception; direct client DNS queries
  to Quad100 are blocked. Keep native Tailscale and MagicDNS enabled and requalify
  before changing the Tailnet suffix. The scoped line satisfies the vendor's
  existing presence check, so normal enabled-state restarts do not re-add its
  broader forwarder. A scope/capability mismatch blocks protected traffic.
- **ON:** initially block external forwarding and resolver upstream requests;
  verify MeLE's identity and exit approval before releasing tunnel traffic.
  External IPv6 forwarding is blocked. Unavailable MeLE means no WAN fallback.
- **OFF:** clear the exit preference and release the owned guard; Quad9 then
  uses direct WAN. A dead local daemon has a bounded preference-clear attempt
  followed by removal of only its exit-default routes, preserving overlay routes.
- A dedicated `inet nixos_exit_guard` nftables table is atomically replaced.
  Profile content must match digests embedded in the generated controller;
  missing/truncated files cannot turn replacement into a delete-only operation.
  Native fw3 rules are not its ownership boundary. Boot protection starts before
  networking; stopping the watcher does not remove kernel protection.
- Native VLAN additions require declaring their firewall zone and local link in
  `downstreamZones`/`localInterfaces`, then acceptance testing. Unknown links do
  not gain a WAN exception from the guard, but local services may remain blocked.

When cleared for deployment, use the pinned LAN transport and retain web-admin
access plus a root recovery session. Initial activation starts OFF and may reload
native firewall/DNS services. The saved original DNS API result stays root-only
at `/etc/nixos-exit/dns-before.json`; it is not copied into the repository.

```sh
# Human-run only, after prerequisites and generated-profile validation.
devenv -q shell -- beryl-ax:activate --apply --target 192.168.8.1
devenv -q shell -- beryl-ax:tunnel check
devenv -q shell -- beryl-ax:tunnel on
devenv -q shell -- beryl-ax:tunnel off
```

### Mandatory packet acceptance

Use phone cellular tethering with phone Wi-Fi off, and disconnect the Mac's home
Ethernet/other uplinks. Record the direct cellular public IP before selecting an
exit. Mock tests and `tunnel check` verify orchestration/policy, **not** connectivity
or the absence of packet leaks.

1. OFF: ordinary client internet works with the cellular public IP.
2. ON: client public IP matches MeLE's home egress, not cellular. Test fresh UDP
   and TCP DNS queries; inspect native resolver counters and capture traffic to
   establish Quad9 via Tailscale with no client-DNS WAN fallback. Router bootstrap
   DNS is an intentional separate exception. Check local names/admin access.
3. ON: interrupt MeLE/Tailscale reachability while continuously probing from a
   client; neither existing nor new flows may fall back to WAN. Repeat DNS and
   IPv6 probes and verify blocking rather than accepting timeouts as leak proof.
4. ON: repeat during fw3 reload/restart, router reboot, and uplink reconnect.
   Confirm the independent guard is retained and the correct exit reconverges.
5. Repeat on wired and guest clients; test any configured additional VLAN.
6. OFF with MeLE unavailable: direct cellular internet and DNS recover. Repeat
   ON/OFF and check that unrelated native settings and guest isolation remain.

Only after these pass should the preserved vendor switch dispatcher be wired to
explicit ON/OFF operations.

### Deferred home repeater issue

On firmware 4.11.0, the DIGI H3600 V9 home Wi-Fi associates on both bands but
repeatedly fails to obtain a DHCP lease, including with Factory MAC. Home Ethernet
and the phone's Wi-Fi hotspot both obtain leases. This Wi-Fi-specific issue is
unresolved, not a diagnosed driver bug; use Ethernet for management and cellular
hotspot for isolated tunnel tests until it is investigated separately.
