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
mele-app create --static lleons-18
```

This creates:

```text
configurations/nixos/mele-hub/static-sites/lleons-18.nix
```

Default domain:

```text
lleons-18.home.behaghel.org
```

The command also prints the recommended project initialization command:

```bash
om init --non-interactive --params '{"site-name":"lleons-18"}' \
  -o ~/ws/lleons-18 /Users/hubertbehaghel/nixos-config#hugo-ox-static-site
```

The single `site-name` value derives `baseURL`, `[params.mele].site`, and the MeLE deploy root in the generated Hugo project.

Use a custom domain when needed:

```bash
mele-app create --static notes --domain notes.behaghel.org
```

Custom domains affect the host slot. The `hugo-ox-static-site` template currently assumes the standard `<site-name>.home.behaghel.org` convention, so edit `hugo.toml` manually after initialization when using a custom domain.

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

The `hugo-ox-static-site` template provides direct shell commands for the common Org/ox-hugo/Hugo workflow:

```bash
site:doctor
site:build
site:deploy:mele
site:rollback:mele --release <release-id>
github:setup
```

`site:deploy:mele` builds locally, copies `public/` to a release directory, and repoints `current` atomically. Generated Markdown under `content/` is committed; `public/` is not.

## Rollback model

Rollback is a symlink move: repoint `/srv/static/<name>/current` to an older release directory and reload or let Caddy continue serving the new target.

## Backup host

For public static sites, use GitHub Pages as the backup serving target. The `hugo-ox-static-site` template includes a GitHub Pages workflow and `github:setup` helper. Private GitHub Pages repositories may require a paid GitHub plan; public backup repositories work on the free plan.

The Hugo template commits Org sources under `content-org/` and generated Hugo Markdown under `content/`, while GitHub Actions builds `public/` from those committed files.

## Analytics

Host-side per-site monitoring is intentionally out of scope. The Hugo template includes an analytics partial placeholder, but enabling a concrete analytics provider remains project-specific.
