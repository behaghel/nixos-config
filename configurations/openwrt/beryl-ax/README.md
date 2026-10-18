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

Naming, the `ssh beryl-ax` alias, password cutover, and `beryl-ax:activate` follow
only after this fresh-key access checkpoint and native service inspection. No
exit-node or toggle configuration is included in this slice.
