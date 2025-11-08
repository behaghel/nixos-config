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

## macOS Keyboard Remapping Notes (Sonoma/Sequoia)

- Internal keyboard IDs: On macOS 14/15 the Apple Internal Keyboard often reports VendorID/ProductID as 0/0 at boot and after sleep. Prefer matching by `Product` with `Built-In = 1` when applying `hidutil` mappings.
- Global vs per-device mapping: A global `hidutil property --set` overwrites per-device mappings. Apply device-specific mappings only, and avoid a subsequent global write (except for a minimal safety-net if explicitly desired).
- LaunchAgents: Use a user LaunchAgent that:
  - Re-applies periodically (e.g., `StartInterval = 15`) to survive re-enumeration.
  - Reacts to HID/USB match events via `LaunchEvents` in combination with the `xpc_set_event_stream_handler` helper.
  - Uses a retry loop (≥60s) before giving up at login so early boot races don’t drop mappings.
- Diagnostics:
  - Global mapping: `hidutil property --get 'UserKeyMapping'`
  - Built-in per-device mapping: `hidutil property --matching '{ "Product": "Apple Internal Keyboard / Trackpad", "Built-In": 1 }' --get 'UserKeyMapping'`
  - Agent status: `launchctl print "gui/$(id -u)/org.nixos.keyboard-<productId>" | rg 'state =|last exit code|runs|program ='`
  - Logs: `~/Library/Logs/keyboard-<productId>.log` and `/tmp/keyboard-<productId>.log` (from LaunchAgent StandardOut/Err)
- Known pitfall fixed here: Using a Nix boolean directly in a shell condition caused the fallback to never run. Ensure Nix emits `true`/`false` strings when used within shell `if`.

## LaunchAgent Verification Pattern

- Purpose: GUI LaunchAgents can silently fail to load, especially after upgrades or plist changes. Verifying and bootstrapping them improves reliability without requiring a logout.
- Pattern: After agents are installed, iterate plists in `~/Library/LaunchAgents`, read their `Label`, and ensure each is loaded with `launchctl print gui/$UID/$LABEL`. If missing, `launchctl bootstrap gui/$UID $PLIST`.
- Our implementation: See `modules/home/darwin-only.nix` target `home.activation.verifyLaunchAgents`.
  - It tolerates different plist parsers (`PlistBuddy`, `plutil`, `defaults`).
  - Emits a concise per-agent status and bootstraps missing ones.
- Recommended usage for new agents:
  - Rely on this verification step instead of ad‑hoc manual `launchctl bootstrap`.
  - Ensure your agent has a unique, stable `Label` and is idempotent at `RunAtLoad`.
  - Direct stdout/err to a file (e.g., `/tmp/<label>.log`) to aid first-run debugging.

## Mail Module Notes
- Gmail folders are locale-specific: this repo intentionally respects per‑account Gmail IMAP folder names based on the account language (e.g., French: `[Gmail]/Messages envoy&AOk-s`, `[Gmail]/Corbeille`, `[Gmail]/Brouillons`; English: `[Gmail]/Sent Mail`, `[Gmail]/Trash`, `[Gmail]/Draft[s]`).
- Modified UTF‑7: IMAP folder names seen in logs/config may appear in IMAP Modified UTF‑7 (e.g., `envoy&AOk-s`). This is expected and handled by isync/mbsync.
- XDG config: `mbsync` uses `~/.config/isyncrc` (XDG). Our jobs rely on the default lookup; we do not pass `-c` explicitly.
- mbsync CLI targeting: `-a` means "all channels/groups", not "account". To sync a single account in this repo, call `mbsync <accountName>` which matches the group we generate (e.g., `mbsync work`).
- mu indexing: The periodic sync job runs `mbsync` only to avoid lock contention with Emacs/mu4e. If you want a separate `mu index` timer, add it explicitly (disabled by default).

## Nix String Interpolation Tips
- Shell vars inside Nix strings: use `''${VAR}` to avoid Nix interpolation. Example: `if [ "''${FLAG-}" = 1 ]; then ... fi`.
- Embed Nix expressions once: don’t double‑interpolate variables inside `${ ... }`. Correct: `export PATH=${lib.makeBinPath [ pkgs.foo myTool ]}:"$PATH"` (note `myTool`, not `${myTool}` inside the list).
- Mixed example (mail sync): `export PATH=${lib.makeBinPath [ isyncWithGsasl pkgs.mu ]}:"$PATH"` and later `"${isyncWithGsasl}/bin/mbsync" ...`.

## Shell Scripting Notes
- Booleans: avoid constant tests like `[ "1" = "true" ]`. Use a runtime flag and test it, for example `FLAG="''${ENV_FLAG:-1}"; if [ -n "''${FLAG}" ]; then ... fi`.
- Nix → shell interpolation: in Nix strings, escape shell `${...}` as `''${...}` so Nix doesn’t try to interpolate shell parameters.
- Job roles: let mu4e own `mu index` to avoid DB lock contention; background jobs should focus on fetching (mbsync) and optional notifications.
- Logging hygiene: aim for informative one‑line logs; prevent unit failures where practical and surface transient tool errors as warnings.
