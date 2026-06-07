# Iteration Plan: MeLE Devenv App Hosting Platform

**Source spec:** `docs/mele-app-platform-spec.md`

**Destination:** a small personal PaaS on MeLE where existing devenv projects can
be onboarded, packaged as `linux/amd64` OCI images, deployed frequently without a
MeLE rebuild, observed through shared metrics/logs, protected by deploy-time
checks and rollback, and covered by backup/restore runbooks.

**Vertical-slice rule:** each iteration must produce behavior a human can
exercise through Nix evaluation, MeLE host commands, HTTP requests, or an app
deploy. Host activation (`nix run`, switch, boot, test, activate) requires
explicit user approval before execution.

## Current status

### Completed and validated

| Area | Status |
|---|---|
| App slot model | `services.meleApps.apps` loads per-app files from `configurations/nixos/mele-hub/apps/`. |
| `home` slot | `home.behaghel.org`, host port `8101`, container port `8080`, `/health`, `/metrics`. |
| `hedonis` slot | `hedonis.home.behaghel.org`, host port `8102`, container port `8080`, `/health`, `/metrics`. |
| App Unix identity | One Unix user/group per app; `/srv/apps/<app>/data` and `/srv/apps/<app>/state`. |
| Public edge | Caddy owns public routing/TLS; unknown hosts return safe errors; router/DNS/NAT loopback verified. |
| Podman runner | Root-managed systemd units run rootless Podman as app users, bind localhost-only host ports, mount `/data`. |
| CLI read operations | `mele-app status`, `health`, `logs`, `releases`, `contract-check`, and `verify-restore` read `/etc/mele-apps/config.json`. |
| Deploy happy path | `mele-app deploy <app> --release <id> -` loads image, tags immutable/current, restarts only that app, records release metadata. |
| Go blueprint app | `~/ws/mele-home` builds `linux/amd64` OCI image locally, deploys with `mele:deploy`, serves `/health` and `/metrics`. |
| Generic HTTP metrics | `mele-home` emits `http_requests_total`, `http_request_duration_seconds`, `http_requests_in_flight`, and `app_build_info`. |
| Central app module | External projects import `nixos-config/modules/flake/mele-app` in `devenv.yaml`; no helper file copying. |
| Onboarding commands | `mele:create-app` creates/stages app slots and reminds about `mele:activate`; `mele:onboard-app` prints app-side devenv snippets. |
| Onboarding docs | `docs/mele-app-onboarding.md` documents HTTP/runtime/OCI contracts, metrics, Node/PWA guidance, and cross-arch image patterns. |
| SecretSpec gate | `mele-app update-secretspec <app> -` stores the app contract; deploy validates required keys in `/etc/mele-apps/<app>.env` before image load/tag/restart. |
| Health-check rollback | Deploy polls configured health after restart and rolls back to the previous release image when health fails. |
| Release retention | Deploy prunes older immutable app image tags beyond `keepReleases` while preserving current and rollback candidates. |
| Deploy/health textfile metrics | `mele-app` emits per-app Prometheus textfile metrics for current release, deploy status, rollback, and health checks. |
| App metrics scraping | Prometheus scrapes each metrics-enabled app at its localhost `/metrics` endpoint with `app` and `domain` labels. |
| Edge request hardening | Caddy applies per-app request body limits and reverse-proxy dial/header timeouts, with documented overrides. |
| App-level hardening contract | `mele-app contract-check <app>` verifies health/metrics contracts and optional oversized write probes; onboarding docs define in-process safeguards. |
| Generic Grafana dashboard | `MeLE Apps` dashboard is provisioned with service availability, user-facing request behavior, operational request behavior, rollout/version tables, and observability health sections. |
| Backup inclusion | App `/srv/apps/<app>/data` and `/srv/apps/<app>/state` are backed up to the separate MeLE apps Restic repository for slots with `backup = true`. |
| Restore validation | `mele-app verify-restore <app> --target <temp-dir> [--marker data/...|state/...]` restores app data/state non-destructively from the apps repo. |
| Backup/restore runbook | `docs/mele-backup-restore.md` documents repositories, helpers, credential files, checks, app restore, and Syncthing restore. |
| Grafana access | Grafana is bound to `127.0.0.1:3000` and proxied at `grafana.home.behaghel.org` through Caddy basic auth; direct port `3000` is not exposed. |
| Remote deploy access | MeLE enables Tailscale; app and activation helpers target `hub@mele` so the alias can resolve to the Tailscale IP when remote. |

### Deferred / optional

| Area | Status |
|---|---|
| Slice 20 multi-app hardening pass | Intentionally skipped for now. Existing per-app users, dirs, env files, services, ports, Caddy routes, and metrics labels are considered sufficient unless a concrete isolation issue appears. |
| Hédonis generic HTTP metrics | Still a good next app-specific improvement: emit the same generic HTTP metrics contract as `mele-home`. |
| Hédonis production packaging | Hédonis has WIP production server and `.#ociImage`; preferred cross-arch pattern is documented: build portable JS artifacts locally, assemble OCI locally, include `linuxPkgs.nodejs-slim_22`. |
| Plugin-focused dashboard views | GitHub-style rollout calendars/heatmaps remain deferred until there is a plugin-focused slice. |

### Known constraints

- Normal app releases must not run `mele:activate` or switch MeLE.
- New app slots do require user-approved activation.
- The assistant must not run activation or `sudo` directly.
- App images must target `linux/amd64`; avoid requiring a remote builder unless
  the app truly needs native Linux builds.
- Metrics are required for onboarded apps unless explicitly waived as temporary
  early-development debt.
- Secret files such as `/etc/restic-syncthing.env`,
  `/etc/restic-mele-apps.env`, and `/etc/caddy/grafana-basicauth` are managed
  manually on MeLE and must not be committed.

## Iteration outcome

| # | Slice Goal | Outcome |
|---|---|---|
| 9 | SecretSpec contract gate without resolving secrets | Complete. Deploy fails early when required env keys are missing. |
| 10 | Health-check rollback | Complete. Failed health after restart rolls back to previous release where available. |
| 11 | Release retention and image cleanup | Complete. Old immutable release images are pruned beyond `keepReleases`. |
| 12 | Deploy and health observability on host | Complete. Textfile metrics expose deploy, rollback, current release, and health state. |
| 13 | Prometheus scrape for app `/metrics` | Complete. Metrics-enabled apps are scraped with per-app labels. |
| 14 | Edge request hardening | Complete. Caddy body limits and reverse-proxy timeouts are generated per app. |
| 15 | App-level hardening contract | Complete. `mele-app contract-check` and onboarding docs define app-side safeguards. |
| 16 | Generic Grafana MeLE Apps dashboard | Complete. Dashboard is provisioned and refined for user-facing vs operational traffic. |
| 17 | App data/state backup inclusion | Complete. Apps backup to a separate Restic repository; restore verification tested against `hedonis`. |
| 18 | App restore/migration runbook | Complete. Concise runbook lives in `docs/mele-backup-restore.md`. |
| 19 | Grafana behind Caddy with authentication | Complete. Caddy basic auth protects `grafana.home.behaghel.org`; Grafana is localhost-only. |
| 20 | Multi-app hardening pass | Skipped/deferred. Revisit only if a concrete isolation concern appears. |

## Current operating model

- Add app slots declaratively under `configurations/nixos/mele-hub/apps/`, then
  manually activate MeLE.
- Build and deploy app releases from each app repo using the shared `mele.app`
  devenv module and `mele:deploy`; helpers target `hub@mele` by default.
- Use `mele-app status|health|logs|releases|contract-check|verify-restore` for
  day-to-day operations.
- Observe apps in Grafana through:
  - `MeLE Apps`
  - `MeLE Hub Health`
  - `Syncthing & Restic`
- Use `bkp-syncthing` for Syncthing backups and `bkp-apps` for app backups.
- Restore apps only through temporary staging first; never restore directly into
  live `/srv/apps/<app>` paths.

## Suggested next work

1. Add the generic HTTP metrics contract to Hédonis so the `MeLE Apps` request,
   error, and latency panels populate for the real app.
2. Finish/clean up Hédonis production packaging and deploy flow.
3. Revisit multi-app isolation only if adding untrusted apps or if an actual
   boundary problem appears.

## Execution notes

- Do not run host activation commands without explicit approval in the current
  session.
- Prefer `nix eval`/`nix build --dry-run`/parse checks before host switches.
- Keep each slice green before moving to the next.
- For app repo work, use `devenv` declaratively; do not install tooling inside
  projects imperatively.
