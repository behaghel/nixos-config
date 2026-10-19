# MeLE exit-node operations

`default.nix` uses native NixOS Tailscale routing and `extraSetFlags`, not a
container, auth-key bootstrap, or imperative `tailscale up --reset`. Tailscale
owns its iptables forwarding/masquerade chains; NixOS opens its UDP listener and
persists IPv4/IPv6 forwarding. Existing NetworkManager IPv6 auto-configuration
stays intact. The host and Tailnet names remain `mele-hub`.

## Apply and inspect

From this worktree, manually activate MeLE with the existing helper:

```sh
devenv -q shell -- mele:activate
```

Then inspect over fresh SSH (touch the YubiKey):

```sh
ssh hub@mele '
  sysctl net.ipv4.ip_forward net.ipv6.conf.all.forwarding
  ip -4 route show default
  ip -6 route show default
  systemctl show tailscaled-set.service -p Result -p ExecMainStatus
  tailscale ip -4
  tailscale debug prefs | jq "{AdvertiseRoutes,NetfilterMode,NoSNAT}"
  tailscale status --json --peers=false |
    jq "{BackendState,Self:(.Self | {ID,HostName,ExitNodeOption,AllowedIPs,PrimaryRoutes,KeyExpiry}),Health}"
'
```

Expected: both forwarding values `1`, original default routes retained,
`Result=success`/`ExecMainStatus=0`, and advertised prefixes `0.0.0.0/0` and
`::/0`. Netfilter mode `2` is `on`; no new login or node registration is needed.
The last observed Tailscale IPv4 is `100.115.20.65`; verify rather than replacing
it with an assumed address. A successful oneshot setter is normally inactive
once finished; it is not a continuously running daemon.

## Admin Console gates

At <https://login.tailscale.com/admin/machines>, inspect `mele-hub`:

- Enable **Use as exit node** in route settings unless policy already approved
  the advertisement. Advertising prefixes alone does not prove approval or
  client authorization. Confirm availability from a peer before selecting it.
- Disable key expiry for this unattended exit-node role, or explicitly arrange
  reauthentication before expiry. Discovery showed expiry enabled with deadline
  **2026-12-04 06:53:29 UTC**. Nix does not manage this account-level setting or
  introduce API credentials. Recheck the device's expiry after changing it.

## Firewall verification (operator only)

On MeLE, run these read-only commands yourself; the agent does not run `sudo`:

```sh
sudo iptables -S FORWARD
sudo iptables -S ts-forward
sudo iptables -t nat -S POSTROUTING
sudo iptables -t nat -S ts-postrouting
sudo ip6tables -S FORWARD
sudo ip6tables -S ts-forward
sudo ip6tables -t nat -S POSTROUTING
sudo ip6tables -t nat -S ts-postrouting
```

Verify that live built-in chains reach Tailscale's forwarding/NAT chains and
that outbound marked traffic is masqueraded. If absent, inspect daemon health
and firewall logs before adding any duplicate rules. Finally prove actual IPv4
and IPv6 exit traffic from a peer; these rule/configuration checks alone do not
establish end-to-end routing.

For Beryl, follow the [travel-router installation manual](../../openwrt/beryl-ax/README.md#installation-and-updates)
rather than selecting an exit node in the native GL.iNet UI. MeLE setup alone
does not qualify downstream routing, DNS, fail-closed behavior or the physical
switch; the router manual covers that integration and its IPv6 limitations.
