# Onboarding existing projects to MeLE apps

This document is the contract for adapting an existing project to run on the
MeLE personal PaaS.

MeLE app projects import a central devenv module from this repository. They do
not copy scripts from `nixos-config` and do not need this repository checked out
at runtime.

## Platform model

- Caddy owns public routing and TLS.
- Each app runs as its own Unix user on MeLE.
- Each app is deployed as an OCI image streamed over SSH; there is no registry
  requirement yet.
- Normal app deploys must not require `nixos-rebuild switch`.
- App slot onboarding may require MeLE activation; app releases must not.
- The runtime host is `x86_64-linux`; images must be `linux/amd64`.
- The app process listens inside the container on `PORT`, defaulting to `8080`.
- Persistent private app data lives at `/data` in the container.

## App HTTP contract

Every MeLE app should expose these endpoints on the same HTTP server:

| Endpoint | Required | Purpose |
|---|---:|---|
| `/health` | yes | Liveness/availability probe. Return `200` when the app is ready to serve traffic. |
| `/metrics` | yes | Prometheus-format metrics for observability. Must not expose secrets or private domain data. |
| `/` | app-specific | Public app entrypoint, usually a static UI or API root. |

Recommended `/health` response:

```json
{"status":"ok"}
```

Minimum `/metrics` requirement: return valid Prometheus text format with at least one useful app-owned series. The `mele-vite-app` template starts with simple uptime and request-count metrics.

Recommended mature HTTP metrics:

```text
http_requests_total{method,route,status}
http_request_duration_seconds_bucket{method,route,status,le}
http_request_duration_seconds_count{method,route,status}
http_request_duration_seconds_sum{method,route,status}
```

Use seconds for duration metrics, following Prometheus/OpenMetrics base-unit
conventions. Grafana can render these values as milliseconds. The `route` label
must be a normalized route template such as `/api/items/:id`, not a raw path.

Recommended additional metrics where applicable:

```text
app_build_info{version,commit} 1
http_requests_in_flight
app_rejected_requests_total{reason}
app_dependency_up{name}
```

Keep `reason` and `name` values low-cardinality, for example
`payload_too_large`, `rate_limited`, `invalid_envelope`, `database`, or `redis`.
Metrics labels must remain low-cardinality. Do not put user IDs, player names,
card titles, sync-space IDs, tokens, or free-form paths in labels.

## Runtime environment contract

Apps should support these runtime variables:

| Variable | Purpose |
|---|---|
| `PORT` | Container listen port. Default to `8080`. |
| `APP_DATA_DIR` | Persistent data directory. Default to `/data` when deployed. |
| `APP_VERSION` | Optional release/build identifier for logs and metrics. |

App-specific variables are fine, but deploys should not require local access to
secret stores such as `pass` or a YubiKey. Use SecretSpec as a contract and make
runtime secret resolution a platform concern.

If `secretspec.toml` exists in the app repository, `mele:deploy` copies it to
MeLE with `sudo mele-app update-secretspec <app> -` before streaming the image.
The host validates the configured profile (default `prod`) against
`/etc/mele-apps/<app>.env` without resolving secret values. A missing profile or
missing required keys fail the deploy before `podman load`, image tags, or
service restarts. Mark optional values with `required = false`.

## Packaging contract

The project must expose an OCI archive as flake output:

```text
.#ociImage
```

`.#ociImage` must be a gzipped OCI/Docker-compatible image archive that Podman
can load on MeLE.

The image should:

- target `linux/amd64`;
- run one foreground process;
- listen on `0.0.0.0:${PORT:-8080}`;
- write durable state only under `/data`;
- avoid writing to the Nix store or application source directory;
- avoid embedding production secrets;
- include only production runtime dependencies.

Pure Go apps can use `pkgs.pkgsCross.gnu64` and `dockerTools.buildLayeredImage`.
Node/TypeScript apps should build production artifacts locally with Nix and then
package only the runtime closure into an amd64 Linux image.

### Cross-architecture build guidance

Avoid making the entire `.#ociImage` derivation an `x86_64-linux` derivation
when developing on macOS ARM. That forces Nix to use an x86_64 Linux builder and
will fail if the remote builder is unavailable:

```text
Required system: x86_64-linux
Current system: aarch64-darwin
```

Preferred pattern:

- build portable application artifacts locally where practical;
- assemble the OCI archive locally with the host package set's
  `dockerTools.buildLayeredImage`;
- set `architecture = "amd64"` on the image;
- include target-runtime Linux packages from an imported Linux package set only
  as image contents or command paths.

For example, a Node/TypeScript app can build `dist/` and `server.mjs` on Darwin,
then put `linuxPkgs.nodejs-slim_22` into the image:

```nix
let
  pkgs = import nixpkgs { system = "aarch64-darwin"; };
  linuxPkgs = import nixpkgs { system = "x86_64-linux"; };
  app = pkgs.buildNpmPackage { ... };
in
pkgs.dockerTools.buildLayeredImage {
  name = "my-app";
  tag = "latest";
  architecture = "amd64";
  contents = [
    app
    linuxPkgs.nodejs-slim_22
  ];
  config = {
    Cmd = [
      "${linuxPkgs.nodejs-slim_22}/bin/node"
      "${app}/share/my-app/server.mjs"
    ];
    Env = [
      "NODE_ENV=production"
      "PORT=8080"
      "APP_DATA_DIR=/data"
    ];
  };
}
```

This works because JavaScript/static assets are architecture-independent, while
Node itself comes from a cached `linux/amd64` package. If the app has native npm
modules, this simple pattern may not be sufficient; build those modules for
Linux amd64 or use an actual x86_64 Linux builder/CI.

For Go, Rust, or other compiled apps, prefer true cross-compilation when
available. For pure Go, `pkgs.pkgsCross.gnu64` plus `CGO_ENABLED=0` is usually
straightforward.

Validate locally without remote builders when possible:

```sh
nix build --builders '' .#ociImage
```

Then inspect the image config:

```sh
tmp=$(mktemp -d)
tar -xf result -C "$tmp" manifest.json
config=$(jq -r '.[0].Config' "$tmp/manifest.json")
tar -xf result -C "$tmp" "$config"
jq '{architecture, os, config}' "$tmp/$config"
rm -rf "$tmp"
```

Expected:

```json
{"architecture":"amd64","os":"linux"}
```

## New MeLE app projects

For a new TypeScript web app, prefer the `mele-vite-app` template:

```sh
om init --non-interactive --params '{"app-name":"notes"}' \
  -o ~/ws/notes /Users/hubertbehaghel/nixos-config#mele-vite-app
```

The single `app-name` value derives the npm package name, MeLE app name, OCI image name, HTML title, and starter API message. The generated project includes:

- Vite + React + TypeScript;
- native Node production server, not Vite preview;
- `/health`, `/metrics`, and `/api/message`;
- persistent state under `${APP_DATA_DIR:-./data}` locally and `/data` on MeLE;
- `.#ociImage` built by Nix;
- `app:check`, `app:build`, `app:serve`, `app:doctor`, and imported `mele:*` commands.

The template intentionally does not include PWA support, Playwright, GitHub Actions, domain-tree scaffolding, or auto-commits. Add those per project when needed.

## Node/TypeScript and PWA guidance

Do not deploy Vite's development server. Do not rely on `npm run preview` as the
production server unless it has the required health, metrics, persistence, and
routing behavior.

For TypeScript apps, including PWA apps like Hédonis:

- build the static frontend (`dist/`) during the image build;
- run a small production Node server in the container;
- serve the static frontend and API/SSE backend from the same origin;
- expose `/health` and `/metrics` from that production server;
- bind to `0.0.0.0:${PORT:-8080}`;
- store SQLite or other durable files under `/data`.

For simple static sites, do not use the dynamic MeLE app platform. Use the static-site hosting flow instead; see [MeLE static sites](./mele-static-sites.md).

Same-origin deployment is preferred. For example:

```text
https://hedonis.home.behaghel.org/          -> static PWA
https://hedonis.home.behaghel.org/sync/...  -> encrypted sync API
https://hedonis.home.behaghel.org/events    -> SSE stream
https://hedonis.home.behaghel.org/health    -> health
https://hedonis.home.behaghel.org/metrics   -> metrics
```

Avoid production builds that hardcode LAN or loopback backend URLs such as
`http://127.0.0.1:8787`. If the frontend needs a backend URL, prefer relative
same-origin paths.

For Hédonis specifically:

- `HEDONIS_SYNC_HOST` should be `0.0.0.0` in the container;
- `HEDONIS_SYNC_DB_PATH` should point under `/data`, for example
  `/data/sync.sqlite`;
- raw inspection endpoints such as `/inspect` must remain disabled by default;
- logs and metrics must not expose plaintext card/commitment/player data or
  bearer tokens;
- SSE events should remain operational hints only, such as `records-available`.

## Import the MeLE devenv module

Use `mele:onboard-app` from this repository to print snippets for an existing
project:

```sh
devenv -q shell -- mele:onboard-app ~/ws/hedonis --app-name hedonis
```

Add the module import to the project's `devenv.yaml`:

```yaml
inputs:
  nixos-config:
    url: github:behaghel/nixos-config
    flake: false
imports:
  - nixos-config/modules/flake/mele-app
```

Then enable the app in the project's `devenv.nix`:

```nix
{ ... }:
{
  mele.app = {
    enable = true;
    name = "hedonis";
  };
}
```

The imported module supplies:

- `mele:deploy`
- `mele:image`
- `mele:status`
- `mele:health`
- `mele:logs`

`mele:deploy` updates the host SecretSpec contract when `secretspec.toml` is
present, builds `.#ociImage` locally, streams it over SSH, and runs
`sudo mele-app deploy` on the MeLE host.

The default host is `hub@mele`. The `mele` host alias should resolve to the
MeLE host; after Tailscale enrollment, point it at MeLE's Tailscale IPv4 so the
same deploy commands work both on and away from the LAN. Override per command
with:

```sh
MELE_HOST=hub@other-host mele:deploy
```

## Remote deploy over Tailscale

MeLE enables Tailscale for remote admin/deploy access without public SSH. This
MacBook Pro enables the open-source Homebrew `tailscale` formula via
`hub.darwin.openSourceTailscale.enable = true`. First time setup on MeLE after
activation:

```sh
sudo tailscale up
tailscale ip -4
```

Then update this repo's local-network alias so `mele` points to that Tailscale
IP, activate the workstation config, log the workstation into the same tailnet
with `sudo tailscale up` if needed, and use the normal app commands:

```sh
ssh hub@mele hostname
mele:deploy
```

The LAN IP remains useful for diagnostics, but app helpers should use `hub@mele`.

## Create the MeLE app slot

Before the first deploy, create an app slot in `nixos-config`:

```sh
devenv -q shell -- mele:create-app hedonis
```

The command creates only the host slot and prints project initialization guidance. It does not create or modify `~/ws/<app>`.

For new apps, use the printed `om init` command. For existing projects, use `mele:onboard-app` as described above.

For apps that implement `/metrics` as required, keep metrics enabled. If an app
is temporarily missing metrics during early development, create the slot with
`--no-metrics` and treat adding `/metrics` as follow-up work.

After creating a new slot, the operator activates MeLE manually:

```sh
devenv -q shell -- mele:activate
```

Do not expect normal app releases to require this activation step.

## Release validation checklist

After `mele:deploy`:

```sh
mele:status
mele:health
ssh "$MELE_HOST" "mele-app contract-check <app-name>"
curl -fsS https://<app-domain>/health
curl -fsS https://<app-domain>/metrics | head
```

Expected:

- the systemd service is active;
- `/health` returns HTTP `200`;
- `/metrics` returns Prometheus text format;
- Caddy routes public HTTPS to the app;
- the app listens only through its configured localhost host port on MeLE;
- `mele-app contract-check <app>` passes required health/metrics checks;
- release metadata appears in `mele-app releases <app>`.

## Request hardening expectations

Apps should not rely on the reverse proxy alone for abuse protection. Caddy
applies coarse edge defaults for every app slot:

- `edge.maxBodySize = "10MiB"`
- `edge.dialTimeout = "5s"`
- `edge.responseHeaderTimeout = "30s"`

Override these in the app slot when needed. Apps with representative write
endpoints should also enable an oversized payload probe so `mele-app
contract-check` can verify in-process rejection behavior.

For example:

```nix
{
  hostPort = 8103;
  edge.maxBodySize = "100MiB";
  edge.responseHeaderTimeout = "2m";
  contract.writeProbe = {
    enable = true;
    path = "/api/write";
    method = "POST";
    contentType = "application/json";
    bodySize = "11MiB";
  };
}
```

`mele-app contract-check <app>` currently hard-fails missing or invalid
`/health` and `/metrics` responses, hard-fails write probes that accept overlarge
payloads with `2xx` or crash with `5xx`, and warns when generic checks cannot
prove domain-specific behavior.

Caddy can apply coarse edge limits, but each app must enforce domain-specific
constraints.

Minimum expectations:

- reject overlarge request bodies with a clear `4xx` response;
- define maximum JSON/envelope sizes for write endpoints;
- define maximum string/array counts where domain data is accepted;
- rate-limit or debounce expensive or abuse-prone endpoints where practical;
- keep SSE/WebSocket connection counts and idle behavior bounded;
- expose metrics for rejected requests, rate-limited requests, and payload-size
  failures;
- never log request bodies, bearer tokens, ciphertext payloads, or private domain
  data when rejecting requests.

For Hédonis specifically, encrypted sync endpoints should bound pairing package
size, record envelope size, batch size, and SSE subscriptions per sync space or
client where practical. Metrics should report aggregate rejection counts without
sync-space IDs or player-identifying labels.

## Operational expectations

- Log concise operational events, not request bodies or private payloads.
- Prefer structured logs if practical.
- Keep metrics useful but privacy-preserving.
- Persist user data under `/data` only. On MeLE this maps to
  `/srv/apps/<app>/data`, which is included in the MeLE data backup when the
  app slot has `backup = true`.
- Platform state under `/srv/apps/<app>/state` is also backed up for slots with
  `backup = true`; container images are intentionally excluded and should be
  redeployable from app release artifacts.
- MeLE app backups use their own Restic repository
  (`mele-apps-backup/apps-backup`) via `bkp-apps` and
  `/etc/restic-mele-apps.env`. Syncthing uses `/etc/restic-syncthing.env`.
  Keeping separate env files, keys, and repository names reduces emergency
  restore ambiguity. See [MeLE backup and restore](./mele-backup-restore.md).
- Document backup/restore for any durable state before relying on the app for
  important data. Use `mele-app verify-restore <app> --target <temp-dir>` for a
  non-destructive restore check into a temporary location.
- Design migrations to run safely on container start or provide an explicit
  admin command before deployment.
