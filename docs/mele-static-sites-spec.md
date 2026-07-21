# Spec: MeLE Static Sites

## Problem
MeLE should make public static website hosting easy to repeat without treating simple static files as containerized dynamic apps. Adding a new static site should be a small declarative host change, backed by a clear operator command, an optional project template, and a documented deployment model.

## Context
- Dynamic MeLE apps are managed by `services.meleApps`, `/etc/mele-apps/config.json`, and the `mele-app` CLI.
- Static sites need no container, app service, health endpoint, SecretSpec contract, or Prometheus app metrics.
- Static hosting is provided by `configurations/nixos/mele-hub/static-sites.nix` through Caddy `file_server` vhosts.
- Static site source/build workflows live in external project repositories, typically Org → ox-hugo → Hugo for this use case.
- `templates/hugo-ox-static-site` provides the standard project-side workflow for personal static sites.

## Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|
| CLI surface | Use `mele-app create --static <name>` | Keeps host-slot creation under the same `mele-app create` verb as dynamic apps. |
| Creation scope | `mele-app create --static <name>` creates host-side per-site Nix files only and prints project template guidance | Host CLI owns host declarations; project creation remains explicit and separate. |
| Site declaration shape | `configurations/nixos/mele-hub/static-sites/<name>.nix` with raw site attrs | Filename is the site key; files stay tiny and reviewable. |
| Site discovery | Auto-import `static-sites/*.nix` | Creating a site requires one new file and no import-list edits. |
| Names | Require lowercase alphanumeric + hyphens | Keeps paths, domains, and deploy scripts predictable. |
| Domains | Default to `<name>.home.behaghel.org`, allow `--domain` | Matches current MeLE naming with escape hatch. |
| Validation | Full MeLE NixOS eval by default, `--no-validate` escape hatch | Invalid generated config should fail before commit/switch. |
| Filesystem changes | Declarative tmpfiles only | Avoids imperative drift; activation creates host directories. |
| Pre-deploy validation | Serve a generated “Soon here…” placeholder until first deploy | Lets users verify DNS, Caddy, and activation before project deployment exists. |
| Deploy artifacts backup | Not backed up by Restic by default | Static releases are redeployable from project source and GitHub Pages backup. |
| Monitoring | No host-side per-site monitoring in v1 | Static hosting is covered by Caddy/system health; analytics remains project-specific. |
| Project template | Prefer `om init --params '{"site-name":"<name>"}' ...#hugo-ox-static-site` | One site-name parameter derives MeLE defaults without making host creation mutate `~/ws`. |

## Acceptance Criteria
- [ ] AC-1: Given `static-sites.nix` is enabled, when MeLE config evaluates, then every `configurations/nixos/mele-hub/static-sites/*.nix` file is exposed as a Caddy static file vhost keyed by filename.
- [ ] AC-2: Given a site file `lleons-18.nix` with `domain = "lleons-18.home.behaghel.org"`, when MeLE config evaluates, then Caddy serves that domain from `/srv/static/lleons-18/current`.
- [ ] AC-3: Given a valid site name, when `mele-app create --static <name> --no-validate` runs inside `nixos-config`, then it creates `configurations/nixos/mele-hub/static-sites/<name>.nix` with a generated header and default domain, and prints the `om init` command for `hugo-ox-static-site`.
- [ ] AC-4: Given `--domain <domain>`, when `mele-app create --static <name> --domain <domain> --no-validate` runs, then the generated file uses the supplied domain.
- [ ] AC-5: Given an invalid name, when `mele-app create --static` runs, then it exits nonzero and does not create a file.
- [ ] AC-6: Given the site file already exists, when `mele-app create --static <name>` runs without `--force`, then it exits nonzero and preserves the file.
- [ ] AC-7: Given the site file already exists, when `mele-app create --static <name> --force --no-validate` runs, then it overwrites the file.
- [ ] AC-8: Given validation is enabled, when `mele-app create --static <name>` succeeds in writing the file, then it runs a full MeLE NixOS eval and reports success or failure.
- [ ] AC-9: Given the command is run outside `nixos-config`, when `mele-app create --static` runs, then it exits nonzero with a helpful repo-root error.
- [ ] AC-10: Given a static site is created and MeLE is activated before first deploy, when the domain is loaded, then Caddy serves a temporary `Soon here…` placeholder.
- [ ] AC-11: Given the static-site docs are read, when a user wants to create and deploy a site, then the guide explains host creation, `hugo-ox-static-site` initialization, manual activation, placeholder validation, release-directory deployment, rollback model, and GitHub Pages backup direction.
- [ ] AC-12: Given `om init --non-interactive --params '{"site-name":"lleons-18"}' ...#hugo-ox-static-site`, when a project is generated, then the single `site-name` value derives `baseURL`, `[params.mele].site`, and the deploy root.

## Invariants
- Static sites must not be added to `services.meleApps.apps`.
- Static sites must not create containers, app users, app env files, SecretSpec contracts, or app health probes.
- Static deploy artifacts under `/srv/static` must not be added to existing Restic app backups by default.
- Host activation remains manual; commands must not run `nix run`, switch, boot, activate, or sudo.
- Existing dynamic app CLI behavior must remain unchanged.

## Scope
**May modify:**
- `scripts/mele_app_cli.py`
- `tests/test-mele-app-cli.py`
- `configurations/nixos/mele-hub/static-sites.nix`
- `configurations/nixos/mele-hub/static-sites/*.nix`
- `configurations/nixos/mele-hub/default.nix`
- `docs/mele-static-sites.md`
- `docs/mele-static-sites-spec.md`
- `docs/mele-app-onboarding.md`

**Must not modify:**
- Dynamic app slot schema except where needed to keep CLI tests passing
- Restic backup jobs for `/srv/static`
- Dynamic app templates/devenv modules

## Verification Plan
| Criterion | Method | Automated? |
|-----------|--------|------------|
| AC-1, AC-2 | `nix eval .#nixosConfigurations.mele-hub.config.services.caddy.virtualHosts` | Yes |
| AC-3, AC-4 | Unit tests using a temporary repo root | Yes |
| AC-5, AC-6, AC-7 | Unit tests for create validation/overwrite behavior | Yes |
| AC-8 | Unit test mocking validation command; full MeLE eval in final check | Partial |
| AC-9 | Unit test from temp dir without expected repo markers | Yes |
| AC-10 | Evaluate generated Caddy config and tmpfiles placeholder symlink | Partial |
| AC-11 | Manual doc review | No |
| AC-12 | Omnix initialization smoke test and generated `hugo.toml` inspection | Yes |

## References
- `docs/mele-app-platform-spec.md`
- `docs/mele-app-onboarding.md`
- `configurations/nixos/mele-hub/apps.nix`
- `configurations/nixos/mele-hub/static-sites.nix`
- `templates/hugo-ox-static-site/`
