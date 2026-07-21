# MeLE Apps

MeLE apps are dynamic services hosted on the MeLE personal PaaS. Use them when a project needs a long-running process, private persistent data, APIs, health checks, metrics, or runtime secrets. For simple static files, use [MeLE static sites](./mele-static-sites.md) instead.

The primary operator surface is `mele-app`:

- `mele-app create <app>` creates a dynamic app host slot in `nixos-config`.
- `mele-app create --static <site>` creates a static-site host slot.
- `mele-app status|health|logs|releases|contract-check <app>` inspects deployed apps on MeLE.
- `mele-app deploy <app>` is the host-side deploy primitive used by project `mele:deploy` commands.

## Getting Started: new dynamic app

From a clean starting point with no app slot yet, run these commands.

### 1. Create the host slot

From `nixos-config`:

```sh
cd ~/nixos-config

devenv -q shell -- mele-app create notes
```

Review the generated slot:

```sh
git diff -- configurations/nixos/mele-hub/apps/notes.nix
```

Commit the host slot:

```sh
git add configurations/nixos/mele-hub/apps/notes.nix
git commit -m "mele: add notes app slot"
```

Activate MeLE manually so the slot, Caddy route, app user, and directories exist:

```sh
devenv -q shell -- mele:activate
```

### 2. Create the app project

Use the `om init` command printed by `mele-app create`. For example:

```sh
om init --non-interactive --params '{"app-name":"notes"}' \
  -o ~/ws/notes ~/nixos-config#mele-vite-app

cd ~/ws/notes
direnv allow
```

### 3. Verify locally

```sh
app:doctor
app:serve
```

In another terminal:

```sh
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:8080/metrics | head
curl -fsS http://127.0.0.1:8080/api/message
```

### 4. Commit the app

```sh
git init
git add .
git commit -m "Initial MeLE app"
```

### 5. Deploy

```sh
mele:image
mele:deploy
```

### 6. Verify live app and monitoring

```sh
mele:status
mele:health
mele:logs --lines 50
mele:releases
mele:contract-check

curl -fsS https://notes.home.behaghel.org/health
curl -fsS https://notes.home.behaghel.org/metrics | head
```

Expected:

- the systemd service is active;
- `/health` returns HTTP `200`;
- `/metrics` returns Prometheus text;
- Caddy routes public HTTPS to the app;
- the app listens only through its configured localhost host port on MeLE;
- `mele-app contract-check notes` passes;
- release metadata appears in `mele-app releases notes`;
- Prometheus/Grafana can scrape/render the app if metrics are enabled for the slot.

## Core concepts

### MeLE app slot

A slot is the host-side declaration for one dynamic app. Slots live in:

```text
configurations/nixos/mele-hub/apps/<app>.nix
```

A typical slot contains only convention-breaking details:

```nix
{
  exposure = "public";
  hostPort = 8103;
  containerPort = 8080;
  healthPath = "/health";
  metrics = {
    enable = true;
    path = "/metrics";
  };
}
```

The filename is the app key. By convention:

- public domain: `<app>.home.behaghel.org`;
- app data on host: `/srv/apps/<app>/data`;
- app platform state: `/srv/apps/<app>/state`;
- systemd unit: `mele-app-<app>.service`;
- current image tag: `localhost/<app>:current`.

Creating a new slot requires MeLE activation. Normal app releases do not.

### Project-side MeLE module

App projects import `modules/flake/mele-app` through `devenv.yaml`. The module supplies:

- `mele:image` — build `.#ociImage` locally;
- `mele:deploy` — update SecretSpec contract, build image, stream it to MeLE, and restart only this app;
- `mele:status`;
- `mele:health`;
- `mele:logs`.

The default SSH target is `hub@mele`; override with `MELE_HOST=...` when needed.

## Environment and secrets

Apps should support these runtime variables:

| Variable | Purpose |
|---|---|
| `PORT` | Container listen port. Default to `8080`. |
| `APP_DATA_DIR` | Persistent data directory. Default to `/data` when deployed. |
| `APP_VERSION` | Optional release/build identifier for logs and metrics. |

App-specific variables are fine, but deploys should not require local access to `pass`, SecretSpec value resolution, or YubiKey interaction.

If `secretspec.toml` exists in the app repo, `mele:deploy` copies it to MeLE before loading the image:

```sh
ssh "$MELE_HOST" "sudo mele-app update-secretspec <app> -" < secretspec.toml
```

The host validates the configured profile, default `prod`, against `/etc/mele-apps/<app>.env` without reading secret values. A missing profile or missing required keys fails the deploy before `podman load`, retagging, or restart.

Empty contract:

```toml
[profiles.prod]
```

Required and optional values:

```toml
[profiles.prod]
API_KEY = { description = "Required by default" }
OPTIONAL_TOKEN = { required = false }
```

## Packaging

Every app project must expose a gzipped OCI/Docker-compatible image archive:

```text
.#ociImage
```

The image should:

- target `linux/amd64`;
- run one foreground process;
- listen on `0.0.0.0:${PORT:-8080}`;
- write durable state only under `/data`;
- avoid writing to the Nix store or app source directory;
- avoid embedding production secrets;
- include only production runtime dependencies.

For TypeScript web apps, the reference template uses this pattern:

- build static frontend assets with Vite;
- bundle the production Node server with `esbuild`;
- build app artifacts with `pkgs.buildNpmPackage` and `importNpmLock`;
- assemble an amd64 image using `pkgs.dockerTools.buildLayeredImage`;
- include `linuxPkgs.nodejs-slim_22` as the runtime Node binary.

Validate locally:

```sh
nix build --builders '' .#ociImage
```

Inspect image architecture:

```sh
tmp=$(mktemp -d)
tar -xf result -C "$tmp" manifest.json
config=$(jq -r '.[0].Config' "$tmp/manifest.json")
tar -xf result -C "$tmp" "$config"
jq '{architecture, os, config}' "$tmp/$config"
rm -rf "$tmp"
```

Expected: `architecture = "amd64"`, `os = "linux"`.

## Observability

Every MeLE app should expose these endpoints on the same HTTP server:

| Endpoint | Required | Purpose |
|---|---:|---|
| `/health` | yes | Liveness/availability probe. Return `200` when ready. |
| `/metrics` | yes | Prometheus text metrics. Must not expose secrets or private data. |
| `/` | app-specific | Public UI or API root. |

Recommended `/health` response:

```json
{"status":"ok"}
```

Minimum `/metrics` requirement: valid Prometheus text with at least one useful app-owned series. The `mele-vite-app` template starts with uptime and request-count metrics.

Recommended mature HTTP metrics:

```text
http_requests_total{method,route,status}
http_request_duration_seconds_bucket{method,route}
app_info{version}
```

Also use the host-side probes:

```sh
mele-app health <app>
mele-app contract-check <app>
mele-app logs <app> --lines 100
```

## Deploy and rollback

Project `mele:deploy` is the normal release path:

1. build `.#ociImage`;
2. copy `secretspec.toml` to MeLE when present;
3. stream the image archive to `sudo mele-app deploy <app> --release <rev>`;
4. retag the loaded image as `localhost/<app>:<release>` and `localhost/<app>:current`;
5. restart `mele-app-<app>.service`;
6. poll `/health`;
7. record release metadata and write deploy metrics;
8. prune old release images.

If health fails after restart, the host attempts automatic rollback to the previous release and records the result.

Rollback is image-only. It retags a retained local image as `current`, restarts the app, health-checks it, and records rollback metadata. It does not restore app data or state.

Useful commands:

```sh
# From the app project
mele:deploy
mele:status
mele:health
mele:logs --follow
mele:releases
mele:rollback
mele:rollback --release <release-id>

# On MeLE or over SSH
mele-app status <app>
mele-app health <app>
mele-app releases <app>
sudo mele-app rollback <app>
sudo mele-app rollback <app> --release <release-id>
mele-app logs <app> --lines 200
```

A slot change requires MeLE activation. A normal release should not require NixOS activation.

## Backup and restore

For slots with `backup = true`, MeLE app backups include:

- `/srv/apps/<app>/data` — app-owned durable data;
- `/srv/apps/<app>/state` — platform state such as release log, current release marker, SecretSpec contract, and health markers.

They do not include container images. Image recovery is via retained local image tags (`rollback`) or redeploying from source.

Backups are stored in the MeLE apps Restic repository and run through the global `restic-backup-mele-apps.service`. `mele-app backup-now <app>` triggers that global service, so it backs up all app slots with `backup = true`; the app argument scopes validation and reporting.

Useful commands:

```sh
# From the app project
mele:backup-status
mele:backup-status --verify
mele:backup-now
mele:restore --snapshot latest --scope data

# On MeLE or over SSH
sudo mele-app backup-status <app>
sudo mele-app backup-status <app> --verify
sudo mele-app backup-now <app>
sudo mele-app restore <app> --snapshot latest --scope data
sudo mele-app restore <app> --snapshot latest --scope all --target /srv/restore/mele-apps/<app>/manual
```

`mele-app restore` is staged-only. By default it restores `data` to:

```text
/srv/restore/mele-apps/<app>/<snapshot>-<timestamp>
```

Restore scopes:

| Scope | Restores | Use when |
|---|---|---|
| `data` | `/srv/apps/<app>/data` | normal accidental data loss recovery |
| `state` | `/srv/apps/<app>/state` | platform-state inspection/recovery |
| `all` | both | full disaster-recovery staging |

Staged restore never changes the live service. Inspect the restored files before any manual cutover. A future `restore-live` command may automate stop/copy/start/health-check, but live restore is intentionally not exposed through app project wrappers yet.

## Request hardening

Apps should be boring HTTP services behind Caddy. Keep these expectations:

- bind inside the container to `0.0.0.0:${PORT:-8080}`;
- host publishes the container only on `127.0.0.1:<hostPort>`;
- Caddy is the public TLS edge;
- `/health` and `/metrics` must be cheap and non-mutating;
- reject oversized request bodies early;
- set conservative content type and cache headers;
- do not expose stack traces, environment values, or secret names in public responses;
- never trust forwarded headers unless explicitly handled by the app.

The reference template includes basic body-size protection for API requests. Existing projects should add equivalent checks before accepting user-controlled writes.

## Operational expectations

Before considering an app production-ready, verify:

- `mele-app create <app>` slot is committed in `nixos-config`;
- MeLE has been activated after slot creation;
- app repo is committed;
- `nix build .#ociImage` succeeds from a clean checkout;
- image architecture is `linux/amd64`;
- `/health` returns `200` locally and through Caddy;
- `/metrics` is valid Prometheus text and contains useful app-owned metrics;
- `mele-app contract-check <app>` passes on MeLE;
- durable writes go under `/data` only;
- logs are useful without leaking secrets;
- deploy failure rolls back or leaves the previous release running;
- app data/state is covered by the MeLE app backup policy.

## Converting an existing project

Use this when a project already exists and you want it to become a MeLE app.

### 1. Create the host slot

From `nixos-config`:

```sh
cd ~/nixos-config
devenv -q shell -- mele-app create my-app

git add configurations/nixos/mele-hub/apps/my-app.nix
git commit -m "mele: add my-app app slot"
```

Activate MeLE manually after review.

### 2. Add required HTTP contract

Your service must provide:

- `GET /health` → `200` when ready;
- `GET /metrics` → Prometheus text;
- app traffic on `0.0.0.0:${PORT:-8080}`;
- persistent data under `${APP_DATA_DIR:-/data}`.

### 3. Add `.#ociImage`

Add a flake output named `ociImage` that builds a gzipped OCI/Docker-compatible archive. Prefer Nix-native packaging and pin dependencies through the project lockfile.

### 4. Import the MeLE app devenv module

In `devenv.yaml`, import the shared module:

```yaml
inputs:
  nixos-config:
    url: github:behaghel/nixos-config
    flake: false
imports:
  - nixos-config/modules/flake/mele-app
```

In `devenv.nix`, enable the helpers and set the slot name:

```nix
{
  mele.app = {
    enable = true;
    name = "my-app";
  };
}
```

Then check available tasks:

```sh
devenv -q shell -- devenv tasks list | rg 'mele:'
```

### 5. Add SecretSpec if needed

Start with an empty contract if the app has no runtime secrets:

```toml
[profiles.prod]
```

Add required keys only when the app really needs them.

### 6. Validate and deploy

```sh
nix build --builders '' .#ociImage
mele:image
mele:deploy
mele:health
mele:contract-check
```

## Static sites

Static sites are not MeLE apps. They use static slots and file-server deployment:

```sh
cd ~/nixos-config
devenv -q shell -- mele-app create --static notes
```

Then initialize a Hugo/ox-hugo project with the printed `om init` command. See [MeLE static sites](./mele-static-sites.md).
