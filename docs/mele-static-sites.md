# MeLE Static Sites

MeLE can serve simple public static websites directly with Caddy. Use this for Hugo/ox-hugo sites and other build outputs that do not need a long-running app process.

## Architecture

- Host declaration: `configurations/nixos/mele-hub/static-sites/<name>.nix`
- Served root: `/srv/static/<name>/current`
- Release storage: `/srv/static/<name>/releases/<release-id>`
- Web server: Caddy `file_server`
- Backup target: project source repo and optional GitHub Pages, not Restic on MeLE

Static sites are intentionally separate from `meleApps`: no container, no service, no SecretSpec, no app health endpoint, and no app metrics.

## Create a host slot

From inside `nixos-config`:

```bash
mele-app static create lleons-18
```

This creates:

```text
configurations/nixos/mele-hub/static-sites/lleons-18.nix
```

Default domain:

```text
lleons-18.home.behaghel.org
```

Use a custom domain when needed:

```bash
mele-app static create notes --domain notes.behaghel.org
```

The command validates the MeLE NixOS config by default. Use `--no-validate` only when iterating quickly.

## Activate host config

Commit the nixos-config change, push if desired, then activate MeLE manually with the usual host activation flow. The agent must not run activation for you.

Activation creates the deploy directories and a temporary placeholder:

```text
/srv/static/<name>
/srv/static/<name>/releases
/srv/static/<name>/placeholder/index.html -> /nix/store/...placeholder.html
```

Before the first deploy, opening `https://<domain>` should show `Soon here…`. Use this to validate DNS, Caddy, certificates, and host activation.

## Deploy model

Project repositories should build static output locally, copy it to a new release directory on MeLE, then atomically repoint `current` to that release. Once `current` exists, it takes precedence over the placeholder.

The intended shape is:

```text
/srv/static/<name>/releases/<release-id>/...
/srv/static/<name>/current -> /srv/static/<name>/releases/<release-id>
```

A future website project template will provide convenient `devenv.nix` tasks for build, deploy, rollback, and GitHub Pages backup deployment.

## Rollback model

Rollback is a symlink move: repoint `/srv/static/<name>/current` to an older release directory and reload or let Caddy continue serving the new target.

## Backup host

For public static sites, use GitHub Pages as the backup serving target. Prefer GitHub Actions building from source rather than committing generated files.

## Analytics

Host-side per-site monitoring is intentionally out of scope. A future static website project template may include Analyzati (`analyzati.com`) or another analytics integration.
