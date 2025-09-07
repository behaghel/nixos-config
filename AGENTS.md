# Repository Guidelines

## Project Structure & Module Organization
- `flake.nix`/`flake.lock`: Flake entry and inputs (nixos-unified autowiring).
- `modules/`: Reusable modules
  - `nixos/`, `darwin/`, `home/`, `flake/` (formatter/devshell/templates glue).
- `configurations/`: Host- or user-specific configs
  - `nixos/HOSTNAME/` (create per host), `darwin/*.nix`, `home/*.nix`.
- `overlays/`: Nixpkgs overlays (e.g., Emacs overlay, custom packages).
- `templates/`: Project templates; metadata read by `modules/flake/templates.nix`.
- `tests/`: Template validation (see `tests/test-templates.nix`).

## Build, Test, and Development Commands
- `nix develop`: Enter dev shell (includes `just`, `nixd`).
- `nix run .#activate`: First-time activation on a new machine.
- `nix run`: Apply changes (autowired default in this repo).
  - Notes: `nixos-unified` autowires `nix run` to the appropriate activation for the current user; selectors like `.#switch`, `.#boot`, `.#test`, `.#build`, and `.#rollback` remain available if you prefer them explicitly.
- `nix flake check`: Evaluate flake, run basic checks/format validation.
- `nix fmt`: Format Nix files (uses `nixpkgs-fmt` via flake `formatter`).

## nixos-unified Autowiring
- Default run target: `modules/flake/toplevel.nix` sets `apps.default` and `packages.default` so `nix run` executes the activation app for the current user (via `modules/flake/activate-home.nix`).
- Practical upshot: after editing configs, just run `nix run` to apply changes; use explicit `nix run .#switch` only if you want the named action.

## Coding Style & Naming Conventions
- Indentation: 2 spaces for `.nix` (see `.editorconfig`).
- Style: Keep modules small and composable; prefer `default.nix` entrypoints.
- Naming: `kebab-case` for directories, `lowerCamelCase` for Nix attrs.
- Formatting: Run `nix fmt`. Alejandra and `treefmt` are available in the dev env if preferred.

## Testing Guidelines
- Flake checks: `nix flake check` before opening a PR.
- Template tests: See `tests/test-templates.nix` as reference; run in an isolated env if adapting.
- CI expectations: Ensure evaluation succeeds for all targets you touched (NixOS, Darwin, Home).

## Commit & Pull Request Guidelines
- Commits: Imperative, concise subject; include why and what. Example: `nixos: add bluetooth service to laptop`.
- Scope: Reference touched area (e.g., `home:`, `darwin:`, `overlays:`) when helpful.
- PRs: Include summary, affected hosts/modules, test notes (`nix flake check` output), and any breaking changes.
- Link issues where applicable; keep changes focused and reviewable.

## Security & Configuration Tips
- Do not commit secrets. Prefer external secret stores (e.g., `password-store`, GPG) and import at runtime.
- Pin inputs via `flake.lock`; update with `nix run .#update` and review diffs.

## Mail Module Notes
- Gmail folders are locale-specific: this repo intentionally respects per‑account Gmail IMAP folder names based on the account language (e.g., French: `[Gmail]/Messages envoy&AOk-s`, `[Gmail]/Corbeille`, `[Gmail]/Brouillons`; English: `[Gmail]/Sent Mail`, `[Gmail]/Trash`, `[Gmail]/Draft[s]`).
- Modified UTF‑7: IMAP folder names seen in logs/config may appear in IMAP Modified UTF‑7 (e.g., `envoy&AOk-s`). This is expected and handled by isync/mbsync.
- XDG config: `mbsync` uses `~/.config/isyncrc` (XDG). The sync job calls `mbsync -c ~/.config/isyncrc` explicitly; `~/.mbsyncrc` is not used.
- mu indexing: The periodic sync job runs `mbsync` only to avoid lock contention with Emacs/mu4e. If you want a separate `mu index` timer, add it explicitly (disabled by default).
