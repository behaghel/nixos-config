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

## Exit tunnel and physical switch

The bounded manual-controller checkpoint was accepted, with the qualifications
recorded in [PR #39](https://github.com/behaghel/nixos-config/pull/39#issuecomment-6261615700).
Physical-switch ownership was human-deployed and its focused flip/ON-boot checks
[passed](https://github.com/behaghel/nixos-config/pull/39#issuecomment-6263115371).
Rapid-flip and boot checks establish recovered/final state, not continuous
packet-level absence of transient leaks. Intermittent shared UDP DNS failures,
automatic preferred-hotspot reconnection and IPv6-enabled filtering remain
unqualified; external IPv6 remains disabled.

Qualified baseline: MT3000 firmware 4.11.0, native fw3, Tailscale 1.92.5. The
current armed/ON/OFF profiles, including guest/IoT isolation, passed the router's
check-only nftables validation; the table inventory stayed empty afterward.
The scoped native DNS configuration passed native dnsmasq syntax validation
using a temporary copy. Both the controller and physical-switch extension have
since been installed and sampled live. Requalify after a firmware upgrade rather
than assuming the same firewall and GPIO contracts.

- Disable **Network Acceleration**, then reboot before deployment. Persistent
  flow offload must also remain disabled; configuration checks alone do not prove
  that previously accelerated connections have stopped bypassing netfilter.
- Leave native **Custom Exit Nodes** off: vendor network events reset Tailscale
  preferences, and the controller owns selecting MeLE and restoring that choice.
- Native IP Masquerading handles client NAT. Owned native forwardings allow the
  declared LAN/guest/IoT zones outbound to Tailscale, without adding reverse
  forwardings. Masqueraded clients share the router's Tailnet identity/ACLs, so
  the guard separately restricts untrusted client interfaces in **both modes**.
- Only `trustedInterfaces` (default `br-lan`) may initiate routed connections to
  private/Tailnet destinations. Other qualified local links (guest and IoT by
  default) are blocked from RFC1918, CGNAT/Tailnet, IPv4 link-local, IPv6 ULA and
  IPv6 link-local destinations, including established original-direction flows.
  Replies to connections initiated by trusted LAN still traverse the normal
  mode/native firewall rules. Router DHCP/DNS and native input/L2 isolation remain
  unchanged; these rules govern routed traffic, not same-link client isolation.
- Native DNS uses Quad9 `9.9.9.9` for clients in **both** modes. Native router-DNS
  separation keeps router bootstrap resolution on uplink DNS; local dnsmasq
  names remain available. Tailscale's `accept-dns` stays false so its OS resolver
  integration does not compete with native DNS. Health checks inspect the actual
  dnsmasq server and router resolver link, not just the admin UI metadata. Native
  manual DNS uses `noresolv=1`; unset `localuse` then defaults to zero and is valid.
  An explicit `localuse=1` or resolver-file fallback is rejected. There is no
  second DNS daemon.
- ON also requires an independent router-bootstrap DNS route among the first
  three configured resolvers. A route into Tailscale/loopback is not independent;
  missing resolvers keep ON blocked. This is a route check, not proof that a DNS
  server answers. OFF installation/recovery does not depend on this prerequisite.
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
- **OFF:** clear the exit preference and release exit-specific restrictions;
  guest/IoT private-destination isolation remains active. Quad9 then uses direct WAN. A dead local daemon has a bounded preference-clear attempt
  followed by removal of only its exit-default routes, preserving overlay routes.
- A dedicated `inet nixos_exit_guard` nftables table is atomically replaced.
  Profile content must match digests embedded in the generated controller;
  missing/truncated files cannot turn replacement into a delete-only operation.
  Native fw3 rules are not its ownership boundary. Boot protection starts before
  networking; stopping the watcher does not remove kernel protection.
- Native VLAN additions require declaring their firewall zone and local link in
  `downstreamZones`/`localInterfaces`, then acceptance testing. Unknown links do
  not gain a WAN exception or ON-mode tunnel forwarding before qualification.
  Newly qualified links are untrusted unless explicitly added to `trustedInterfaces`.

When cleared for deployment, use the pinned LAN transport and retain web-admin
access plus a root recovery session. If application fails, assume partial state;
do not reboot until the boot guard has been enabled and verified. Retrying after
an inspected/fixed failure must preserve compliant native settings.
With `hardwareSwitch.enable = true`, activation adopts the physical position;
ON can therefore select MeLE during activation. With switch ownership disabled,
an initial install starts OFF. Activation may reload native firewall/DNS services. The saved original DNS API result stays root-only
at `/etc/nixos-exit/dns-before.json`; it is not copied into the repository.

```sh
# Human-run only, after prerequisites and generated-profile validation.
as beryl-ax-init run beryl-ax:activate --apply --target 192.168.8.1
as beryl-ax-init run beryl-ax:tunnel check
# Move the physical switch for ON/OFF once switch ownership is installed.
# Before binding, or with hardwareSwitch.enable = false:
as beryl-ax-init run beryl-ax:tunnel on
as beryl-ax-init run beryl-ax:tunnel off
```

### Physical-switch contract and focused acceptance

- ON selects the protected MeLE mode; OFF selects direct WAN. The physical
  position, not the last event argument or persisted cache, is authoritative.
  Conflicting CLI mode requests fail and ask the operator to move the switch.
- The vendor `/etc/rc.button/switch` and its lock remain untouched. The module
  owns only `/etc/gl-switch.d/nixos-exit.sh` and the native `func=nixos-exit`
  assignment. An existing different assignment or pending switch configuration
  prevents installation; no unrelated native function is taken over.
- MT3000 metadata and exactly one matching GPIO input record are required:
  `hi` means ON and `lo` means OFF. Missing, ambiguous or unsupported state,
  including a changed native assignment, blocks rather than assuming OFF.
- The S18 boot guard reads hardware before networking, independently of the
  vendor's S99 replay. Unknown boot state installs the armed profile and still
  starts the retrying watcher. Stopping the watcher does not remove protection.
- Queued events read the current position inside the existing controller lock.
  ON arms before control-plane requests; both transitions re-read hardware
  before releasing a profile. A mid-operation change stays armed for the next
  reconciliation. Event handling is userspace, with five-second watcher retries;
  this does not promise instantaneous electrical-edge enforcement.
- Set `hardwareSwitch.enable = false` and manually reapply to relinquish an owned
  native assignment and return to CLI control, retaining the last cached mode.
  Do not reassign the switch through the vendor UI while Nix ownership is enabled.

Retain wired Beryl administration and a root recovery session. Use the existing
isolated cellular setup, not another Mac uplink. After human deployment:

1. Check health with the physical switch ON; confirm MeLE egress and client DNS.
2. Move OFF; check health, direct cellular egress and client DNS. Move ON again;
   a conflicting `beryl-ax:tunnel off` must refuse without releasing protection.
3. Flip OFF→ON rapidly, finishing ON; after reconciliation, health and egress must
   agree with the final position, not a queued OFF event.
4. Manually reboot in ON; verify automatic protected recovery and switch control
   afterward. Do not repeat the complete tunnel qualification below solely for
   this extension. Record DNS failures separately rather than declaring them fixed.

### Tunnel packet-acceptance reference

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
6. In both ON and OFF, guest/IoT attempts to reach private LAN, MeLE's Tailnet
   address and private/link-local test addresses fail; public internet and local
   router DNS/DHCP still work. Test an already-established guest-private flow as
   well as new connections. Trusted LAN retains its previous private access;
   replies to trusted-LAN-initiated IoT connections remain subject to normal
   mode/native firewall policy.
7. OFF with MeLE unavailable: direct cellular internet and DNS recover. Repeat
   ON/OFF and check that unrelated native settings and guest isolation remain.

The accepted bounded pass and its limitations are linked above. Physical-switch
acceptance extends that checkpoint; it does not silently close its open findings.

### Deferred home repeater issue

Earlier firmware 4.11.0 tests associated with DIGI H3600 V9 home Wi-Fi but failed
to obtain DHCP leases, including with Factory MAC. A later uplink-recovery test
selected home Wi-Fi instead of the preferred phone hotspot; manual hotspot
reselection was required. Neither a permanent home-Wi-Fi failure nor automatic
preferred-hotspot reconnection has been established. Keep these separate from
switch acceptance; use wired Beryl management and cellular for isolated tests.

The home ISP also supplies DNS servers `100.90.1.1` and `100.100.1.1`. The vendor's
main-table `100.64.0.0/10` Tailscale route captures them, including protected
router-originated queries. That bootstrap-routing collision is not repaired by
changing client DNS to Quad9. ON is blocked if no independent resolver remains;
the phone hotspot supplies a separately routed DNS server for isolated tests.
A permanent home-ISP bootstrap-routing fix remains separate work.
