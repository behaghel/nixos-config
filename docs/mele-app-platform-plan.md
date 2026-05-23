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
| `hedonis` slot | `hedonis.home.behaghel.org`, host port `8102`, container port `8080`, `/health`, `/metrics`; activation performed by user. |
| App Unix identity | One Unix user/group per app; `/srv/apps/<app>/data` and `/srv/apps/<app>/state`. |
| Public edge | Caddy owns public routing/TLS; unknown hosts return safe errors; router/DNS/NAT loopback verified. |
| Podman runner | Root-managed systemd units run rootless Podman as app users, bind localhost-only host ports, mount `/data`. |
| CLI read operations | `mele-app status`, `health`, `logs`, `releases` read `/etc/mele-apps/config.json`. |
| Deploy happy path | `mele-app deploy <app> --release <id> -` loads image, tags immutable/current, restarts only that app, records release metadata. |
| Go blueprint app | `~/ws/mele-home` builds `linux/amd64` OCI image locally, deploys with `mele:deploy`, serves `/health` and `/metrics`. |
| Central app module | External projects import `nixos-config/modules/flake/mele-app` in `devenv.yaml`; no helper file copying. |
| Onboarding commands | `mele:create-app` creates/stages app slots and reminds about `mele:activate`; `mele:onboard-app` prints app-side devenv snippets. |
| Onboarding docs | `docs/mele-app-onboarding.md` documents HTTP/runtime/OCI contracts, metrics, Node/PWA guidance, and cross-arch image patterns. |
| SecretSpec gate | `mele-app update-secretspec <app> -` stores the app contract; deploy validates required keys in `/etc/mele-apps/<app>.env` before image load/tag/restart. |
| Health-check rollback | Deploy polls configured health after restart and rolls back to the previous release image when health fails. |
| Release retention | Deploy prunes older immutable app image tags beyond `keepReleases` while preserving current and rollback candidates. |
| Deploy/health textfile metrics | `mele-app` emits per-app Prometheus textfile metrics for current release, deploy status, rollback, and health checks. |
| App metrics scraping | Prometheus scrapes each metrics-enabled app at its localhost `/metrics` endpoint with `app` and `domain` labels. |

### In progress / adjacent

| Area | Status |
|---|---|
| Hédonis packaging | Hédonis agent has a WIP production server and `.#ociImage`; cross-arch builder issue was diagnosed. Preferred pattern is now documented: build portable JS artifacts locally, assemble OCI locally, include `linuxPkgs.nodejs-slim_22`. |
| Pi install/web access | Home module changes staged to install/update Pi via npm at activation and stop exposing Nix-pinned `pi`; current Pi session may still be old, so use a fresh Pi session after activation before relying on `pi-web-access`. |

### Known constraints

- Normal app releases must not run `mele:activate` or switch MeLE.
- New app slots do require user-approved activation.
- The assistant must not run activation or `sudo` directly.
- App images must target `linux/amd64`; avoid requiring a remote builder unless
  the app truly needs native Linux builds.
- Metrics are required for onboarded apps unless explicitly waived as temporary
  early-development debt.

## Remaining slices to destination

| # | Slice Goal | User Interaction Path | Tests to Write First | Expected Red Signal | Minimal Green Target | Feedback Checkpoint |
|---|---|---|---|---|---|---|
| 9 | SecretSpec contract gate without resolving secrets | From an app repo, stream/copy `secretspec.toml` with `mele-app update-secretspec <app> -`; deploy with a missing required env key and verify no tag/restart | Python tests for TOML profile parsing, required-key extraction, env-file parsing, `update-secretspec`, deploy failing before `podman load`/tag/restart | Deploy ignores missing env or requires `pass`/YubiKey | CLI stores contract in `/srv/apps/<app>/state/secretspec.toml`; deploy validates `/etc/mele-apps/<app>.env` against configured profile and fails early with missing keys | Confirm deploy hot path remains secret-store-free and broken config cannot restart apps |
| 10 | Health-check rollback | Deploy an intentionally unhealthy image; verify previous release is restored and service is healthy again | Python tests for previous-release lookup, health success/failure, retagging previous release, restart sequencing, rollback metadata | Failed health leaves `current` pointing at broken image | After restart, poll app health; on failure, retag previous successful release as `current`, restart, record rollback | Demo safe failed deploy against a test image/app |
| 11 | Release retention and image cleanup | Deploy more than `keepReleases`; inspect release log and Podman images | Python tests for retaining last N successful releases, preserving current/rollback target, pruning old image tags | Old images accumulate forever or rollback image is deleted | Keep last `keepReleases` successful release images per app and prune older immutable tags | Confirm disk usage stays bounded without sacrificing rollback |
| 12 | Deploy and health observability on host | Inspect textfile metrics or CLI status after deploy/rollback/health check | Tests for metrics record formatting and privacy; Nix eval for textfile collector path if used | No operator-visible deploy/rollback status except logs | Emit per-app deploy metadata and last health result as Prometheus-compatible textfile metrics under app/platform state | Confirm operator can answer “what version is running and was last deploy healthy?” |
| 13 | Prometheus scrape for app `/metrics` | Open Prometheus target/query for `home` and `hedonis` after deploy | Nix eval/check for scrape configs derived from `services.meleApps.apps.*.metrics`; optional generated config test | Metrics-enabled apps are not scraped | Prometheus scrapes each app with `metrics.enable = true` at `127.0.0.1:<hostPort><metrics.path>` | Confirm app metrics appear in Prometheus |
| 14 | Edge request hardening | Send oversized request bodies and bursts to a public app; verify Caddy rejects/throttles before app overload | Nix eval/check for generated Caddy request body limits and rate-limit config; HTTP smoke tests for `413`/`429` where practical | Public apps accept unbounded request bodies or request bursts | Per-app defaults for max request body size, header/read timeouts where available, and rate limiting for sensitive endpoints; app override knobs documented | Confirm malformed/abusive traffic is constrained at the edge without touching app code |
| 15 | App-level hardening contract | Run app contract tests against `/health`, `/metrics`, and representative write endpoints | App-template/contract tests or docs checklist for max payload, low-cardinality metrics, safe logging, and endpoint-specific throttling | Apps rely entirely on Caddy and accept unbounded JSON/envelopes internally | Onboarding doc requires apps to enforce domain-specific size limits, reject overlarge sync records, avoid logging payloads, and expose counters for rejected/limited requests | Confirm Hédonis and future apps have explicit in-process safeguards for domain-specific abuse |
| 16 | Generic Grafana MeLE Apps dashboard | Open dashboard and inspect app health/deploy/HTTP panels | Dashboard JSON validation if practical; Nix eval for provisioning | No single operator view for apps | Dashboard panels for service state, last deploy, health status, request rate/latency where exposed | Confirm dashboard answers core ops questions quickly |
| 17 | App data/state backup inclusion | Create marker under `/srv/apps/<app>/data`; run backup; restore to temp; verify marker | Script tests for restore-helper path safety and excludes | Backup omits app data/state or restore risks live paths | Restic includes `/srv/apps/*/{data,state}` and excludes container images; restore helper/runbook uses temp dirs only | Confirm data can be recovered non-destructively |
| 18 | App restore/migration runbook | Follow documented restore of one app into a temp or replacement slot | Runbook dry-run checks; shell helper tests if added | Restore requires ad-hoc unsafe commands | Document stop/restore/ownership/restart sequence and migration expectations | Confirm restore is executable under stress |
| 19 | Grafana behind Caddy with authentication | Visit `grafana.home.behaghel.org`; verify no direct public `:3000` dependency | Nix eval/check for Caddy route/auth and Grafana bind behavior | Grafana directly exposed or unauthenticated | Grafana proxied behind Caddy auth; direct router/public port not required | Confirm final observability access model |
| 20 | Multi-app hardening pass | Onboard/deploy two apps (`home`, `hedonis`) and verify isolation | Tests/eval for per-app users, dirs, env files, config JSON; manual cross-app checks | One app can read/write another app’s private data or deploy restarts unrelated app | App users, dirs, env files, services, releases, request limits, and metrics remain isolated by convention and permissions | Confirm PaaS is safe enough for additional apps |

## Immediate next slice

Resume with **Slice 14: Edge request hardening**.

Planned behavior:

```sh
sudo mele-app deploy home --release <id> -
```

Caddy should apply conservative per-app edge limits before proxying public
traffic: bounded request bodies and timeouts by default, with documented app slot
overrides for apps that need different limits.

## Execution notes

- Do not run host activation commands without explicit approval in the current
  session.
- Prefer `nix eval`/`nix build --dry-run`/parse checks before host switches.
- Keep each slice green before moving to the next.
- If implementation uncovers option-name or API uncertainty, use Pi web access
  from a fresh npm-installed Pi session rather than guessing.
- For app repo work, use `devenv` declaratively; do not install tooling inside
  projects imperatively.
