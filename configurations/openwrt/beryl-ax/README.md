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

After fresh-key acceptance, the generated tool checks/applies only native and
Tailnet naming. Its SSH connection pins the verified host key, selects the public
operator identity, and never falls back to a password or reuses a connection.

```sh
# Read-only: exits nonzero until all names agree.
devenv -q shell -- beryl-ax:activate --check --target 100.101.32.55
# Human-approved rename; retains the existing Tailnet registration.
devenv -q shell -- beryl-ax:activate --apply --target 100.101.32.55
# Repeat check, then apply again to verify no further semantic changes.
devenv -q shell -- beryl-ax:activate --check --target 100.101.32.55
```

The address above is the currently verified router address, not a stored default.
The normal tool target is `beryl-ax`; an override still verifies the same pinned
host identity. Native UCI changes awaiting commit block application, so unrelated
pending settings cannot accidentally be committed. No service restart is needed.

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

SSH password cutover and reboot acceptance remain the next slice. No exit-node,
DNS, forwarding, firewall, or toggle changes are included.
