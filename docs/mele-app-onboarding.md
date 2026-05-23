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

Recommended `/metrics` minimum:

- process/runtime metrics if available;
- request count by method/path/status;
- request duration histogram;
- app build/version info.

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

## Node/TypeScript and PWA guidance

Do not deploy Vite's development server. Do not rely on `npm run preview` as the
production server unless it has the required health, metrics, persistence, and
routing behavior.

For apps like Hédonis that have both a PWA and a backend:

- build the static frontend (`dist/`) during the image build;
- run a small production Node server in the container;
- serve the static PWA and API/SSE backend from the same origin;
- expose `/health` and `/metrics` from that production server;
- bind to `0.0.0.0:${PORT:-8080}`;
- store SQLite or other durable files under `/data`.

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

The default host is `hub@192.168.1.199`. Override it per command with:

```sh
MELE_HOST=hub@other-host mele:deploy
```

## Create the MeLE app slot

Before the first deploy, create an app slot in `nixos-config`:

```sh
devenv -q shell -- mele:create-app hedonis
```

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
curl -fsS https://<app-domain>/health
curl -fsS https://<app-domain>/metrics | head
```

Expected:

- the systemd service is active;
- `/health` returns HTTP `200`;
- `/metrics` returns Prometheus text format;
- Caddy routes public HTTPS to the app;
- the app listens only through its configured localhost host port on MeLE;
- release metadata appears in `mele-app releases <app>`.

## Request hardening expectations

Apps should not rely on the reverse proxy alone for abuse protection. Caddy
applies coarse edge defaults for every app slot:

- `edge.maxBodySize = "10MiB"`
- `edge.dialTimeout = "5s"`
- `edge.responseHeaderTimeout = "30s"`

Override these in the app slot when needed, for example:

```nix
{
  hostPort = 8103;
  edge.maxBodySize = "100MiB";
  edge.responseHeaderTimeout = "2m";
}
```

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
- Persist user data under `/data` only.
- Document backup/restore for any durable state before relying on the app for
  important data.
- Design migrations to run safely on container start or provide an explicit
  admin command before deployment.
