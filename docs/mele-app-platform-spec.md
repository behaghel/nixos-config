# Spec: MeLE Devenv App Hosting Platform

## Problem

MeLE (`configurations/nixos/mele-hub`) should act as a small personal app server for applications developed with `devenv`. App releases must be deployable quickly without rebuilding or switching the entire MeLE NixOS system, while the host remains declarative for stable infrastructure boundaries such as users, ports, domains, routing, monitoring, and backups.

## Context

- MeLE is managed in this repository as the NixOS host `mele-hub`.
- Current MeLE services include SSH, Tailscale, Syncthing, Prometheus, Grafana, Alertmanager, node/smartctl exporters, restic backup, and persistent journald.
- MeLE LAN IP is `192.168.1.199`, but app deploys should target the stable `mele` host alias rather than the raw LAN IP.
- Public DNS is set up with `home.behaghel.org` and wildcard subdomains resolving to `79.116.72.133`.
- Router port forwarding should route public TCP `80` and `443` to MeLE.
- NAT loopback was validated using Grafana on port `3000`; LAN and cellular access both worked.
- Direct public Grafana port forwarding has been removed. Grafana is served through Caddy with authentication.
- App development environments use `devenv`; the first app should use hardcoded `devenv` tasks, with a future `devenv` extension deferred to v2.
- Secrets are described with SecretSpec in app repositories. Normal deploys must not require resolving `pass`/YubiKey secrets.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Release artifact | OCI image produced by app `devenv` tasks | Works across language stacks and avoids full host rebuilds. |
| Image transport | Direct SSH stream to MeLE | Avoids operating a registry initially. |
| Remote deploy access | Enable Tailscale on MeLE and target `hub@mele` | Keeps deploys working away from the LAN without public SSH; the `mele` alias can point to the MeLE Tailscale IP once enrolled. |
| App isolation | One Unix user per app | Limits blast radius and keeps data ownership clear. |
| App slots | Host-controlled, declared in MeLE Nix config | Stable infra boundaries remain declarative; releases remain independent. |
| New app onboarding | Requires MeLE switch | Slot creation is rare; app deploys are frequent and must not switch MeLE. |
| Routing | Caddy routes generated from app slots | Domains are infrastructure and should be host-owned. |
| Ports | Fixed localhost host port per app | Simple, inspectable, compatible with Nix-managed Caddy. |
| Service model | Root-managed systemd services running per-app containers as app users | Avoids user-systemd lingering complexity while preserving per-app isolation. |
| First deploy/bootstrap | App services and Caddy routes may exist before any image is deployed; MeLE switch must not depend on image existence | Onboarding a slot should be safe before the first app release. |
| Deploy interface | One host-side Python CLI, `mele-app`, with subcommands | Centralizes validation, deploy, rollback, status, logs, and metrics. |
| Config handoff | Nix-generated `/etc/mele-apps/config.json` | Clean boundary between Nix slot declarations and Python host logic. |
| Secrets | App deploy updates copied `secretspec.toml`; MeLE validates `/etc/mele-apps/<app>.env` against a configured SecretSpec profile, default `prod`, without resolving secrets | Adding secret keys should not require MeLE switch; normal deploys should not require YubiKey/pass. |
| Secret env files | Nix creates `/etc/mele-apps` but must not manage or overwrite secret values in `/etc/mele-apps/<app>.env` | Secret contents are host-local operational state. |
| Missing secrets | Fail before retag/restart | Protects currently running version. |
| Image tags | Immutable release tags plus mutable `current` tag | Enables rollback and observability. |
| Health checks | Optional per-app HTTP health check with automatic rollback | Prevents broken releases from staying live when health is configured. |
| Migrations | No automatic migrations in v1 | Migration rollback semantics are app-specific and should not block platform v1. |
| Persistent data | Default `/srv/apps/<app>/data` mounted as `/data` | Simple durable storage convention. |
| Logs | Journald primary | Existing persistent journald provides standard access via `journalctl`. |
| Observability | Built-in systemd/deploy/health observability; optional Prometheus `/metrics` scraping | Baseline visibility for every app; richer metrics for apps that opt in. Apps should expose generic HTTP metrics (`http_requests_total`, `http_request_duration_seconds`) with low-cardinality labels so shared dashboards can show request rate, error rate, and latency. |
| Grafana dashboard | Generic MeLE Apps dashboard first; app-specific dashboards later | Immediate baseline with low provisioning complexity. The generic dashboard separates service availability, request behavior, platform rollout/version events, and observability scrape health. |
| Release metadata | Record SHA, repo, branch, dirty state, deployer, timestamp | Makes status, rollback, and Grafana useful. |
| Rollback | First-class `mele-app rollback` with health check and metric recording | Operator-safe recovery path. |
| Hardening | Hardened defaults with per-app escape hatches | Improves security while allowing practical app exceptions. |
| Networking | Inbound localhost-only behind Caddy; outbound allowed | Practical default with Caddy as public edge. |
| Exposure | Per-app `public` or `lan` exposure | Supports both public and local apps. |
| Public app hostnames | Subdomain per app under `home.behaghel.org` | Avoids path-prefix issues and matches wildcard DNS. |
| Root hostname | `home.behaghel.org` reserved for `home` app; static 404 acceptable before app exists | Allows blueprint app to become the home portal later. |
| Unknown subdomains | Caddy returns 404 | Avoids routing arbitrary hostnames into apps. |
| TLS | Start with Caddy HTTP-01 per-host certificates | Avoids DNS API credentials on MeLE. |
| Initial app slot | Only `home` | Keeps first rollout focused and exercises full platform path. |
| Blueprint app | `mele-vite-app` TypeScript/Vite template | Proves external app deployment with the same Node/Vite pattern used by Hédonis. |
| Blueprint metrics | Expose `/metrics` from day one | Observability is a core requirement. |
| Downtime | Accept short per-app restart blip initially | Simpler than blue/green; only deployed app is interrupted. |
| Image GC | Keep last 5 releases per app by default | Preserves rollback while bounding storage growth. |
| State storage | Flat files under `/srv/apps/<app>/state` | Easy to inspect, back up, and restore. |
| Backups | Per-app backup default enabled for data/state, not images | Backs up irreplaceable data while avoiding large image archives. |
| Restore validation | Stage restores under `/srv/restore/mele-apps/...`; live cutover remains manual/deferred | Backup must be proven restorable without risking live data. |
| Module location | Start local at `configurations/nixos/mele-hub/apps.nix`, with app slot files under `configurations/nixos/mele-hub/apps/` | Keeps experimental MeLE-specific platform out of generic modules initially while making app onboarding easy to automate. |
| App onboarding | Provide `mele-app create` to create a per-app slot file using convention over configuration | New app slots should be guided, consistent, and low ceremony while remaining declarative. |
| App slot convention | Minimal per-app files should usually declare only name-derived/defaultable differences: domain override if needed, host port, exposure, health/metrics toggles | Avoids heavy repetitive wiring for every app. |
| Devenv extension | Shared `modules/flake/mele-app` devenv module | App projects import one module for image, deploy, rollback, inspection, backup-status, backup-now, and staged restore commands. |

## Acceptance Criteria

- [ ] AC-1: Given MeLE has the app-hosting substrate enabled, when the NixOS config is evaluated, then the `home` app slot declares domain `home.behaghel.org`, host port `8101`, container port `8080`, public exposure, `/health`, and `/metrics`.
- [ ] AC-2: Given Caddy is enabled on MeLE, when a request is made to an unknown `*.home.behaghel.org` hostname, then Caddy returns a 404 without proxying to an app.
- [ ] AC-3: Given `home.behaghel.org` is configured for the `home` slot and router ports `80/443` forward to MeLE, when Caddy starts, then it can serve the hostname and obtain/serve TLS via HTTP-01.
- [ ] AC-4: Given an app slot exists, when MeLE is switched, then a per-app Unix user, `/srv/apps/<app>/data`, and `/srv/apps/<app>/state` exist with app-owned permissions.
- [ ] AC-5: Given an app slot exists, when MeLE is switched, then a root-managed `mele-app-<app>.service` exists, does not make activation fail if no app image has been deployed yet, and after deployment runs the container as the app user while binding only `127.0.0.1:<hostPort>` to the app container port.
- [ ] AC-6: Given the `mele-app` CLI is installed, when `mele-app status home`, `mele-app logs home`, `mele-app health home`, `mele-app releases home`, `mele-app rollback home`, and backup/restore commands are run, then they operate only on the declared `home` app slot and reject unknown app names.
- [ ] AC-7: Given an app repository contains `secretspec.toml`, when its deploy task runs, then it copies the file to MeLE using `mele-app update-secretspec home` before streaming the image.
- [ ] AC-8: Given `/etc/mele-apps/home.env` is missing a key required by the copied `secretspec.toml` for the configured profile, when `mele-app deploy home` receives a candidate image, then it must not retag `current`, must not restart `mele-app-home.service`, and must exit nonzero with the missing keys.
- [ ] AC-9: Given all required secrets are present, when `mele-app deploy home --release <sha>` receives a valid image archive, then it loads the image, tags it as `localhost/home:<sha>`, retags `localhost/home:current`, restarts only `mele-app-home.service`, records release metadata, and writes deploy metrics.
- [ ] AC-10: Given `healthPath = "/health"`, when a newly deployed release fails health checks after restart, then `mele-app` retags the previous release as `current`, restarts `mele-app-home.service`, records rollback metadata/metrics, and exits nonzero.
- [ ] AC-11: Given more than five successful releases exist for `home`, when a successful deploy completes, then old non-current images beyond the retention window are pruned while the current and recent rollback candidates remain.
- [ ] AC-12: Given a reference MeLE app is deployed, when `GET /health` is requested through Caddy, then it returns a success response.
- [ ] AC-13: Given a reference MeLE app is deployed and metrics are enabled for the slot, when Prometheus scrapes the configured app metrics endpoint, then app metrics are collected under labels that identify `app="home"`.
- [ ] AC-14: Given a deploy or rollback occurs, when Grafana displays the generic MeLE Apps dashboard, then the `home` app shows current release, last deploy status/time, rollout/rollback events, service availability, request rate/error/latency where app metrics expose them, and separate observability scrape health.
- [ ] AC-15: Given `backup = true` for the `home` slot, when the MeLE restic backup runs, then `/srv/apps/home/data` and `/srv/apps/home/state` are included and container images are not included.
- [ ] AC-16: Given a backup has completed, when `mele-app restore home --scope data` runs, then it stages app data under `/srv/restore/mele-apps/...` without overwriting live app data; when `--verify` is used with backup status, then recent snapshots can be checked for app paths.
- [ ] AC-17: Given direct public Grafana port forwarding has been removed, when Grafana is later exposed, then it is reachable behind Caddy with authentication rather than directly on public port `3000`.
- [ ] AC-18: Given a project generated from `mele-vite-app`, when `mele:deploy` is run there, then it builds the app OCI image, updates SecretSpec metadata, streams the image to MeLE over SSH, and completes without requiring a MeLE switch.
- [ ] AC-19: Given a developer runs `mele-app create notes` from the devenv shell, when the command completes, then it creates a dedicated declarative app slot file under `configurations/nixos/mele-hub/apps/`, chooses the next available host port by convention, defaults the public domain to `notes.home.behaghel.org`, and Nix evaluation includes `notes` in `/etc/mele-apps/config.json`.
- [ ] AC-20: Given MeLE has joined Tailscale and the workstation `mele` host alias points to MeLE's Tailscale IPv4, when app helpers target `hub@mele`, then deploy/status/health/log commands work away from the LAN without exposing public SSH.

## Invariants

- Normal app releases must not require `nixos-rebuild switch`, `nix run`, or any MeLE host activation.
- Deploying one app must not restart unrelated MeLE services such as Syncthing, Grafana, Prometheus, SSH, or other apps.
- No app container may bind a public interface directly; public HTTP(S) ingress must go through Caddy.
- Unknown app names must be rejected by host tooling.
- Normal deploys must not resolve pass/SecretSpec values or require YubiKey interaction.
- Nix activation must not overwrite `/etc/mele-apps/<app>.env` secret contents.
- Existing Syncthing, restic, Prometheus, Grafana, SSH, and firewall behavior must not regress except where explicitly changed by this spec.
- Remote deploy access should use Tailscale or an equivalent private network, not public SSH exposure.
- Grafana must not be exposed directly via router/public port `3000`.
- Actual secret values must not be committed to this repository or app repositories.
- Backup restore validation must not overwrite live app data unless explicitly running a documented disaster-recovery procedure.

## Scope

**May modify:**

- `configurations/nixos/mele-hub/default.nix`
- `configurations/nixos/mele-hub/apps.nix` (new)
- `configurations/nixos/mele-hub/grafana/*` for generic app dashboard provisioning
- MeLE-specific scripts/packages generated from Nix for the `mele-app` CLI
- Restic backup configuration for app data/state includes
- Firewall/Caddy/Podman/systemd configuration needed for the app substrate
- Documentation/runbooks under `docs/`
- `templates/mele-vite-app/` as the current reference app project template
- `devenv.nix` for local `mele-app create` and MeLE app template validation scripts

**Must not modify without separate approval:**

- Syncthing folder/device configuration semantics
- Existing restic repository credentials or secret contents
- Existing mail/home/darwin modules unrelated to MeLE
- Router configuration beyond documented manual steps
- Generated agent configs unrelated to this work
- A reusable generic NixOS module under `modules/nixos/` until the local MeLE module has stabilized
- A broader generic PaaS/devenv extension beyond the current MeLE app module

## Verification Plan

| Criterion | Method | Automated? |
|---|---|---|
| AC-1 | Evaluate MeLE config and inspect generated `/etc/mele-apps/config.json` after switch | Partial |
| AC-2 | `curl -I -H 'Host: unknown.home.behaghel.org' http://192.168.1.199` returns 404 | No |
| AC-3 | From LAN and cellular, request `https://home.behaghel.org`; verify Caddy certificate and response | No |
| AC-4 | `id app-home`; `stat /srv/apps/home/data /srv/apps/home/state` | No |
| AC-5 | Before first deploy, `systemctl cat mele-app-home.service` shows the unit exists and activation succeeds; after deploy, `systemctl status` and `ss -ltnp` confirm localhost-only bind | No |
| AC-6 | Run `mele-app` subcommands for `home` and an unknown app | Partial |
| AC-7 | Run `mele:deploy` from a generated app project and verify `/srv/apps/<app>/state/secretspec.toml` updates | No |
| AC-8 | Temporarily remove a required key from `/etc/mele-apps/home.env`; deploy; verify service release unchanged | No |
| AC-9 | Deploy valid image; inspect Podman tags, systemd status, state JSONL, textfile metrics | No |
| AC-10 | Deploy intentionally unhealthy image; verify automatic rollback and metrics | No |
| AC-11 | Deploy more than retention count; inspect remaining `localhost/home:*` images | No |
| AC-12 | `curl -fsS https://home.behaghel.org/health` | No |
| AC-13 | Prometheus targets/query for `app="home"` metrics | No |
| AC-14 | Open Grafana generic MeLE Apps dashboard and inspect `home` panels | No |
| AC-15 | Run restic backup; inspect backup contents or restore listing for app data/state only | No |
| AC-16 | Run restore verification helper/runbook and verify temporary restore marker | Partial |
| AC-17 | Confirm router has no `3000` forward; later verify Grafana Caddy route/auth | No |
| AC-18 | From a generated `mele-vite-app` repo, run `mele:deploy`; verify MeLE generation unchanged and only app service restarted | No |
| AC-19 | Run `mele-app create notes` from the devenv shell; inspect new app slot file and evaluate generated config JSON for `notes` | Partial |
| AC-20 | After `sudo tailscale up`, point `mele` at `tailscale ip -4`; verify `ssh hub@mele hostname` and app helper commands from outside the LAN | No |

## Implementation Slices

1. **Host substrate skeleton**: create local `apps.nix`, slot schema, app slot file convention under `configurations/nixos/mele-hub/apps/`, `home` slot, generated config JSON, directories/users, Podman package/config.
2. **App slot onboarding command**: add `mele-app create <name>` to create per-app slot files using defaults and the next available port.
3. **Caddy edge**: enable Caddy, open `80/443`, route `home.behaghel.org`, unknown-host 404, HTTP-01 TLS.
4. **Systemd app runner**: generate `mele-app-home.service` using `localhost/home:current`, localhost-only port binding, data mount, env file.
5. **`mele-app` CLI v1**: Python CLI with config loading, app validation, status/logs/health/releases, `update-secretspec`, deploy happy path.
6. **MeLE Vite app template**: TypeScript/Vite/React app with native Node server, `/`, `/health`, `/metrics`, `.#ociImage`, and shared `mele:*` deploy/status/log tasks.
7. **Secrets validation**: parse copied SecretSpec, validate `/etc/mele-apps/<app>.env`, fail before retag/restart.
8. **Health rollback and release retention**: automatic rollback, release metadata JSONL, textfile metrics, keep last 5 releases.
9. **Observability**: Prometheus scrape config for app metrics, deploy/health textfile metrics, periodic health probes, bounded rollout event metrics, generic Grafana MeLE Apps dashboard.
10. **Backup/restore validation**: include app data/state in restic, add non-destructive restore verification helper and manual runbook.
11. **Grafana behind Caddy**: move Grafana route behind Caddy with authentication; keep direct public `3000` closed.
12. **V2 deferred**: generalize beyond the current MeLE-specific app module after the template path stabilizes.

## References

- MeLE host config: `configurations/nixos/mele-hub/default.nix`
- MeLE hardware config: `configurations/nixos/mele-hub/hardware-configuration.nix`
- Current Grafana dashboards: `configurations/nixos/mele-hub/grafana/`
- Devenv extending docs: https://devenv.sh/extending/
- Devenv containers/tasks/SecretSpec usage: project `devenv-project` skill and devenv documentation
