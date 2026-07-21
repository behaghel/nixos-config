# example MeLE Vite App

A minimal dynamic MeLE app: Vite + React frontend, native Node HTTP server, persistent `/data` example, and Nix-built OCI image deployable with `mele:deploy`.

## Quick start

```sh
direnv allow
app:check
app:serve
```

Open `http://127.0.0.1:8080` after `app:serve`.

## Commands

- `app:dev` — run the Vite development server.
- `app:build` — build the frontend and bundled server.
- `app:check` — run TypeScript and Vitest checks.
- `app:serve` — build and run the production server locally.
- `app:doctor` — run checks and verify the flake exposes `.#ociImage`.
- `mele:image` — build the OCI image archive.
- `mele:deploy` — deploy to the matching MeLE app slot.
- `mele:status`, `mele:health`, `mele:logs`, `mele:releases` — inspect the deployed app.
- `mele:rollback` — roll back to a retained image release.
- `mele:backup-status`, `mele:backup-now`, `mele:restore` — inspect, trigger, and stage app data backups.

## MeLE runtime contract

The server:

- listens on `0.0.0.0:${PORT:-8080}`;
- stores private persistent data under `${APP_DATA_DIR:-./data}`;
- serves the Vite build from `${APP_STATIC_DIR:-./dist}`;
- exposes `/health` for MeLE health checks;
- exposes `/metrics` as Prometheus text;
- exposes `/api/message` backed by `/data/message.json`.

## First deploy

Create the host slot in `nixos-config` first:

```sh
devenv -q shell -- mele-app create example
```

Activate MeLE manually from `nixos-config`, then deploy from this project:

```sh
mele:deploy
```

`secretspec.toml` starts with an empty `prod` profile so the deploy path is documented without requiring secrets. Add required secret tables there when the app needs runtime secrets.

## Nix image

The flake exposes:

```sh
nix build .#ociImage
```

The image is assembled with `dockerTools.buildLayeredImage`. Nix reads `package-lock.json` through `importNpmLock`, so dependency changes should be followed by `npm install --package-lock-only` or `npm install`, then `nix build .#ociImage`.

## Template parameters

When initialized with Omnix, the single `app-name` parameter replaces `example` everywhere it matters: package name, MeLE app name, image name, title, and default message.
