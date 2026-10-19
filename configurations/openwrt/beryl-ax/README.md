# Beryl AX travel router

A GL.iNet Beryl AX (MT3000) with a physical **direct internet / Tailscale exit
node** switch. GL.iNet firmware stays in place; Nix builds native management
scripts on the Mac, not on the router.

## What the device offers

### Two internet paths, one physical switch

```text
ON:   wired / Wi-Fi clients → Beryl → Tailscale → MeLE exit node → internet
OFF:  wired / Wi-Fi clients → Beryl → local WAN uplink           → internet
```

Beryl joins the Tailnet and uses `mele-hub` as its exit node. Downstream devices
do not need their own Tailscale client. This is a single-exit-node topology,
without an additional provider VPN or separate OpenVPN/WireGuard client chain.
GL.iNet still manages Wi-Fi, Ethernet and repeater/hotspot uplinks.

| Switch | Internet access | If MeLE is unavailable |
|---|---|---|
| **ON** | Client internet and upstream client DNS go through MeLE. | Protected traffic stays blocked; no direct-WAN fallback. |
| **OFF** | Client internet and DNS use Beryl's WAN directly. | Direct access does not depend on MeLE. |

OFF stops **exit-node use**, not Tailscale itself: non-default overlay routes
remain available. Router-originated bootstrap DNS is deliberately separate from
client DNS so Beryl can establish the tunnel.

### Client networks and DNS

| Network | Qualified interface | Routed private/Tailnet access |
|---|---|---|
| Trusted LAN | `br-lan` | Allowed subject to existing native policy. |
| Guest | `br-guest` | Cannot initiate private, link-local or Tailnet connections. |
| IoT | `br-iot` | Same restriction as guest. |

Guest/IoT isolation applies in **both** switch positions, including established
original-direction flows. Replies to connections initiated by trusted LAN still
traverse normal mode/native firewall policy. These are routed-traffic controls;
existing native input policy and same-link isolation remain separate.

- Clients use Quad9 `9.9.9.9` in both modes; only its egress path changes.
- Native DHCP/DNS and local dnsmasq names remain available.
- MagicDNS is scoped to the declared Tailnet suffix, `tail21d416.ts.net`, rather
  than forwarding all `ts.net` names. Protected clients cannot query Quad100
  directly; the native resolver has the scoped exception.
- Masqueraded clients share Beryl's Tailnet identity/ACLs. The router guard adds
  the guest/IoT restrictions rather than relying on separate client identities.
- External IPv6 is disabled in the qualified deployment; do not treat this as
  an IPv6-enabled service.

### Everyday operation

Move the physical switch, then check controller health from the repository:

```sh
devenv -q shell -- beryl-ax:tunnel check
```

The current physical position is authoritative. A conflicting CLI `on` or `off`
request refuses rather than overriding it. Queued events re-read the position;
unknown hardware state or a changed native assignment blocks instead of assuming
OFF. Boot protection and the enabled watcher restore/reconcile the selected mode.

Switch handling is userspace, with five-second watcher retries—not instantaneous
electrical-edge enforcement. A successful health check verifies policy and
configuration, **not** internet connectivity or the absence of packet leaks.

### Known limits

| Area | Qualification |
|---|---|
| Leak prevention | Bounded live checks passed; not exhaustive packet-level certification. Rapid-flip/boot checks establish recovered/final state, not continuous absence of transient leaks. |
| DNS availability | Intermittent shared UDP DNS failures remain open; later successful samples do not close them. |
| Uplink selection | Automatic preferred-hotspot reconnection is not established; one recovery required manual hotspot reselection. |
| Home-ISP bootstrap DNS | A known Tailnet-range routing collision needs separate repair; see [bootstrap DNS](#bootstrap-dns-and-uplink-caveats). |
| IPv6 | IPv6-enabled filtering remains unqualified. |

## Installation and updates

Run management commands on the Mac from this repository. All apply, activation
and reboot steps below are **human-run**. Keep wired Beryl administration,
web-admin access and an existing trusted root recovery session available until
fresh access and internet behavior have been verified.

The declaration in [`default.nix`](default.nix) is desired state, not evidence
that a particular router has been onboarded.

### 1. Prepare the router and exit node

Qualified baseline: **MT3000 firmware 4.11.0, native fw3, Tailscale 1.92.5**.
Requalify after firmware upgrades; fw4 is not qualified by this module.

Before applying:

- Configure the desired LAN/guest/IoT networks and working WAN uplink in GL.iNet.
  Keep external IPv6 disabled for this qualified setup.
- Enable native Tailscale, join the intended Tailnet and keep MagicDNS enabled.
  Leave native **Custom Exit Nodes off**: the controller owns exit selection.
- Prepare MeLE's persistent exit-node role, approve **Use as exit node**, and
  check client authorization and unattended-node key expiry. See the
  [MeLE operations guide](../../nixos/mele-hub/exit-node.md#apply-and-inspect)
  and its [Admin Console gates](../../nixos/mele-hub/exit-node.md#admin-console-gates).
  Beryl's selected address, node ID and Tailnet suffix are declared in
  [`default.nix`](default.nix).
- Disable **Network Acceleration**, then reboot. Software/hardware flow offload
  must remain disabled; a changed setting alone does not prove previously
  accelerated flows have stopped bypassing netfilter.
- Leave the physical switch unassigned in the native UI. An existing different
  function or pending switch configuration blocks installation; the module does
  not take over unrelated assignments.
- Ensure router-bootstrap DNS has an independent IPv4 route outside Tailscale.
  ON requires at least one such resolver among the first three configured
  nameservers. This route check is not proof that the resolver answers.
- Verify the device host key through a trusted session. `ssh.hostKey` in
  `default.nix` pins this particular router; do not reuse it for different hardware.

### 2. Bootstrap public-key access

Bootstrap only adds the public key from `config.nix`. It does not rename the
router, disable passwords, change networking or restart services. Check each
command succeeds before continuing:

```sh
# Print the bootstrap script; this nix run target does not activate anything.
devenv -q shell -- nix run '.#beryl-ax:bootstrap' > /tmp/beryl-ax-bootstrap.sh
# Read-only preflight; use the router admin password when prompted.
ssh -o StrictHostKeyChecking=yes root@192.168.8.1 'sh -s -- check' < /tmp/beryl-ax-bootstrap.sh
# Add the public key through the trusted connection.
ssh -o StrictHostKeyChecking=yes root@192.168.8.1 'sh -s -- apply' < /tmp/beryl-ax-bootstrap.sh
# Fresh key-only authentication; touch the YubiKey. No connection reuse.
ssh -o StrictHostKeyChecking=yes -o ControlMaster=no -o ControlPath=none \
  -o BatchMode=yes -o PreferredAuthentications=publickey \
  root@192.168.8.1 'uci -q get system.@system[0].hostname'
```

`192.168.8.1` is the qualified LAN management address; adjust it if your LAN
configuration differs. If strict checking fails, verify the fingerprint through
the trusted session—never disable host-key verification. A missing card or
withheld touch must not authenticate a fresh connection. Stop and inspect the
offered agent identity and token touch policy if it does.

### 3. Apply the complete device configuration

The activation tool applies **naming, SSH hardening, DNS/firewall integration,
boot protection and physical-switch ownership together**. It is not a naming-only
operation. Finish the prerequisites above before running it.

With `hardwareSwitch.enable = true`, activation adopts the physical position:
**ON can select MeLE during application**. Choose OFF first if direct mode is
wanted. With switch ownership disabled, an initial install starts OFF.

```sh
# Read-only drift check; an unconfigured device is expected to fail this.
devenv -q shell -- beryl-ax:activate --check --target 192.168.8.1
# Apply, then automatically verify using a second fresh SSH authentication.
devenv -q shell -- beryl-ax:activate --apply --target 192.168.8.1
# Repeat the read-only check.
devenv -q shell -- beryl-ax:activate --check --target 192.168.8.1
```

The LAN override still verifies the pinned host identity; the tool never falls
back to password authentication. Expect two YubiKey touches for application.
`--check` stops at the first drift and is not a complete installation dry run
when earlier phases are unconfigured.

Pending changes in managed UCI packages block application rather than
accidentally committing unrelated settings. Naming preserves node registration; SSH hardening
preserves existing root keys, ports, bindings and web-admin credentials. Dropbear
reloads only when needed; DNS/firewall services may also reload. A compliant
repeat apply avoids unnecessary service reloads.

**If application fails, assume partial state.** Retain the recovery session and
do not reboot until the boot guard has been enabled and verified. Inspect the
failure before retrying; do not delete protection to make a check pass. The
original DNS API settings are saved root-only in `/etc/nixos-exit/dns-before.json`.

### 4. Install management-machine aliases

After the router is named, manually activate the Mac's system configuration to
refresh Tailnet-backed aliases, then Home Manager to install the SSH client block:

```sh
nix run .#activate
nix run
ssh beryl-ax 'uci -q get system.@system[0].hostname'
devenv -q shell -- beryl-ax:activate --check
devenv -q shell -- beryl-ax:tunnel check
```

Normal management uses `beryl-ax`; `--target ADDRESS` is available for activation
when an explicit reachable address is needed. The SSH policy pins both the host
key and operator identity and disables connection sharing/password fallback.

### 5. Verify before relying on it

Complete the [SSH checks](#ssh-access) and appropriate
[network acceptance checks](#network-acceptance) below. For a new deployment or
changed firmware/network boundary, do not substitute unit tests or a successful
public-IP request for packet-level qualification.

Routine updates use the same explicit `--check` / `--apply` commands. No Nix
installation or firmware replacement is needed on Beryl.

## Verification

### SSH access

`--check` inspects both persisted password settings and live listener flags.
After application, verify fresh key access and unchanged web administration.
Then confirm the server no longer offers password authentication:

```sh
ssh -vv -o PubkeyAuthentication=no -o PreferredAuthentications=password \
  -o BatchMode=yes beryl-ax true 2>&1 | grep 'Authentications that can continue'
```

Expected: only `publickey` is offered, followed by authentication failure. A
connection failure or nonzero exit alone does not prove password denial.
After a manual reboot, repeat fresh access, `beryl-ax:activate --check` and the
password-method check.

### Network acceptance

Use an isolated, distinguishable uplink: phone cellular tethering with phone
Wi-Fi off, no Mac home Ethernet/alternate auto-join or independent Tailscale path
bypassing Beryl. Wired management should connect **to Beryl**, not another router.
Record direct cellular egress before selecting MeLE; a shared home public IP
cannot distinguish the two paths.

For the focused physical-switch check:

1. ON: check health, MeLE egress and fresh UDP/TCP client DNS.
2. OFF: check health, direct cellular egress and client DNS. Move ON again;
   `beryl-ax:tunnel off` must refuse without releasing protection.
3. Flip OFF→ON rapidly, finishing ON. After reconciliation, health and egress
   must agree with the final position rather than a queued OFF event.
4. Manually reboot in ON; verify automatic protected recovery and switch control.

For broader tunnel qualification, also test:

- MeLE/Tailscale loss during existing and new client flows: no WAN fallback;
  inspect DNS counters/captures rather than treating timeouts as leak proof.
- Firewall reload/restart, reboot and uplink reconnect: protection remains and
  the selected mode reconverges.
- Wired, guest, IoT and any additional qualified VLANs in both modes: correct
  public egress; guest/IoT routed private/link-local/Tailnet probes denied,
  including established original-direction flows; trusted LAN access and
  replies to trusted-LAN-initiated IoT connections retained under normal policy.
- OFF while MeLE is unavailable: direct internet/DNS recover independently.
- Quad9 via Tailscale in ON, no client-DNS WAN fallback, local names/admin access
  retained, and only the scoped native resolver using Quad100. Router-bootstrap
  DNS is a deliberate separate exception.
- IPv6 behavior under the actual network conditions. No route on an
  IPv6-disabled network does not qualify IPv6-enabled filtering.

The [accepted bounded manual-controller checkpoint](https://github.com/behaghel/nixos-config/pull/39#issuecomment-6261615700)
and [completed focused switch checks](https://github.com/behaghel/nixos-config/pull/39#issuecomment-6263115371)
record the existing deployment's evidence and limitations. Do not repeat the full
suite solely for the already-tested switch extension, or treat successful samples
as closing the [known limits](#known-limits).

## Recovery and maintenance

### SSH recovery

Hardening disables `PasswordAuth` and `RootPasswordAuth` on all configured
Dropbear instances. Reload/flag-verification failures attempt to restore previous
options, but the retained root session is the recovery path. To restore this
device's original password settings, run there:

```sh
uci set dropbear.main.PasswordAuth=on
uci set dropbear.main.RootPasswordAuth=on
uci commit dropbear
/etc/init.d/dropbear reload
```

### Tunnel and switch recovery

Move the switch **OFF** for direct access when MeLE is unavailable. A dead local
Tailscale daemon has a bounded preference-clear attempt, then the controller
removes only its exit-default routes, preserving non-default overlay routes.
Stopping the watcher does **not** remove the kernel guard.

To relinquish physical-switch ownership, set `hardwareSwitch.enable = false` in
`default.nix` and manually reapply. This removes only the owned native assignment
and returns to CLI control, retaining the last cached mode. Then use either:

```sh
devenv -q shell -- beryl-ax:tunnel on
devenv -q shell -- beryl-ax:tunnel off
```

Do not reassign the switch in the vendor UI while Nix ownership is enabled:
assignment drift deliberately blocks rather than silently changing authority.

### Bootstrap DNS and uplink caveats

The home ISP supplies `100.90.1.1` and `100.100.1.1` as DNS servers. The vendor's
main-table `100.64.0.0/10` Tailscale route captures them, even for protected
router-originated queries. Changing **client** DNS to Quad9 does not fix this.
ON stays blocked if no independent bootstrap resolver remains; the qualified
phone hotspot supplies one. A permanent home-ISP routing repair is separate work.

Earlier home-Wi-Fi tests associated with the DIGI H3600 V9 but failed to obtain
DHCP leases, including with Factory MAC. A later recovery selected home Wi-Fi
instead of the preferred hotspot and required manual hotspot reselection. Neither
a permanent home-Wi-Fi failure nor automatic preferred-hotspot reconnection has
been established.

### Firmware, names and new networks

- Requalify firmware/firewall/GPIO contracts after upgrades. The inspected
  `sysupgrade -l` includes system, Dropbear configuration/keys and Tailscale state;
  verify preservation or reapply instead of assuming it.
- GL.iNet runs `tailscale up --reset` on network events. Persisted native hostname
  supplies the matching default after an explicit Tailscale hostname preference
  is reset. Vendor scripts remain untouched. Check names after reconnect/reboot;
  a conflicting Tailnet DNS label fails verification.
- New VLANs require declaring their zone/link in `downstreamZones` and
  `localInterfaces`, then acceptance testing. Unknown links receive no WAN
  exception or ON-mode tunnel access. New qualified links are untrusted unless
  explicitly added to `trustedInterfaces`.

## Implementation reference

Source: [`modules/openwrt`](../../../modules/openwrt). These details explain the
safety checks; they are not additional installation steps.

| Component | Managed behavior / boundary |
|---|---|
| Guard | Atomically replaces only `inet nixos_exit_guard`, independently of fw3. Embedded profile digests prevent missing/truncated files becoming delete-only replacements. |
| Native forwarding/NAT | Owned LAN/guest/IoT forwardings to Tailscale, no added reverse forwardings; native IP Masquerading provides client NAT. |
| Native DNS | Existing dnsmasq, no second daemon; Quad9 manual DNS, router/client resolver separation, Tailscale `accept-dns=false`. Checks inspect actual runtime configuration, not just UI metadata. |
| MagicDNS | Authoritative declared Tailnet suffix through Quad100, not a broad `ts.net` upstream proxy. A scope/capability mismatch blocks protected traffic. |
| Physical switch | Owned `/etc/gl-switch.d/nixos-exit.sh` and native `func=nixos-exit`; vendor dispatcher and lock remain untouched. |
| Boot/watcher | S18 guard reads hardware before networking, independently of vendor S99 replay; unknown state arms protection and still starts retries. |

Native manual DNS must have `noresolv=1`; unset `localuse` then defaults to zero
and is valid. Explicit `localuse=1` or resolver-file fallback is rejected. Keep
native Tailscale/MagicDNS enabled and requalify before changing the Tailnet suffix.

The MT3000 reader requires metadata and exactly one matching GPIO input record:
`hi` means ON, `lo` means OFF. ON arms before control-plane requests; transitions
re-read hardware before releasing a profile. A mid-operation change stays armed
for reconciliation. No vendor GPIO helper that treats read failure as OFF is used.
