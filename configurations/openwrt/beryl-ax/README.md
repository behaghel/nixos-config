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
pending settings cannot accidentally be committed. Only native Dropbear listeners
are reloaded when needed; existing sessions are retained. Networking and
Tailscale are not restarted. A compliant second apply does not reload anything.

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

No exit-node, DNS, forwarding, firewall, or toggle changes are included.
