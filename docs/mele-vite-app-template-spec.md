# MeLE Vite App Template Spec

## Problem
Creating a new dynamic MeLE app should be as repeatable as creating a static site. The app project should start with the MeLE deployment contract already wired: local development, tests, a Nix-built OCI image, and `mele:deploy` commands.

## Context
- MeLE apps are containerized services declared as app slots in `configurations/nixos/mele-hub/apps/`.
- App projects deploy through the shared `modules/flake/mele-app` devenv module.
- The deploy module expects a flake output `.#ociImage` by default.
- Hédonis proves the preferred pattern: Vite/React app, Node production server, `buildNpmPackage`, and `dockerTools.buildLayeredImage`.
- Static project templates now use Omnix parameters for one-value initialization.

## Decisions
- Template name: `mele-vite-app`.
- Stack: TypeScript, Vite, React, Vitest, native `node:http` server.
- No PWA, Playwright, GitHub Actions, domain-tree scaffold, or auto-commit in v1.
- Package manager: npm with committed `package-lock.json`.
- Nix build: `buildNpmPackage` with `importNpmLock`; production server bundled with `esbuild`; OCI image via `dockerTools.buildLayeredImage`.
- Runtime contract:
  - listens on `0.0.0.0:${PORT:-8080}`;
  - persistent data under `${APP_DATA_DIR:-./data}`;
  - exposes `/health`, `/metrics`, and `/api/message`;
  - serves Vite `dist/` for all other paths.
- SecretSpec: include empty `secretspec.toml` with a `[profiles.prod]` table and no required keys.
- Omnix: one parameter, `app-name`, placeholder `example`.
- `mele-app create <name>` prints project initialization guidance; it does not create project files.

## Template Structure
```text
templates/mele-vite-app/
  .editorconfig
  .envrc
  .gitignore
  README.md
  devenv.nix
  devenv.yaml
  flake.nix
  index.html
  package.json
  package-lock.json
  secretspec.toml
  tsconfig.json
  vite.config.ts
  src/client/App.tsx
  src/client/main.tsx
  src/client/styles.css
  src/server/main.ts
  src/server/server.ts
  src/server/server.test.ts
  src/shared/message.ts
```

## Commands
Direct shell commands in `devenv.nix`:
- `app:dev` — run Vite dev server.
- `app:build` — run production build.
- `app:check` — run TypeScript and Vitest checks.
- `app:serve` — build and run the production server locally.
- `app:doctor` — run checks and verify `.#ociImage` exists.

Imported MeLE commands:
- `mele:image`
- `mele:deploy`
- `mele:status`
- `mele:health`
- `mele:logs`

## Acceptance Criteria
- `nix flake new demo --template .#mele-vite-app` creates all required files.
- `om init --non-interactive --params '{"app-name":"demo-app"}'` replaces `example` with `demo-app` in package name, MeLE app name, image name, title, and message defaults.
- `devenv -q shell -- app:check` passes in a generated project.
- `nix build .#ociImage --no-link` evaluates/builds the OCI image for the default template and for an Omnix-generated app.
- `secretspec.toml` does not block first deploy.
- `mele-app create demo-app --no-validate` output suggests the Omnix command and one `app-name` value.
