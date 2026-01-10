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
- `devenv shell`: Loads `devenv.nix` packages (e.g., `bats`) and installs any `git-hooks.*` definitions automatically; make sure to rerun when hooks change.
- Custom git hooks go under `git-hooks.hooks.<name>` in `devenv.nix`; set `entry` (e.g., `./tests/run-mail-sync-autocorrect-tests.sh`), keep `language = "system"`, and `pass_filenames = false` when the command doesn't expect file args. devenv symlinks `.pre-commit-config.yaml` automatically once you run `devenv shell`/`direnv allow`.
- Python helpers go through Ruff/flake8 on build: keep docstrings/help text under 79 chars (wrap via `help=("line" "...")` or multi-line `print()` args) or the derivation fails.

### Agent Activation Policy
- Always ask the user before running `nix run` (activation) or otherwise applying the configuration. The user prefers to trigger activation manually. Only proceed without asking if explicit permission was given in the current session.
- Never run `sudo` commands yourself; ask the user to run them when needed.

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

## Launchd Notes (darwin)

- When defining daemons in nix-darwin, set command arguments under `serviceConfig.ProgramArguments` (not `programArguments`). Put `EnvironmentVariables` inside `serviceConfig` as well.

## Nix Builders Gotcha

- If you change `nix.settings.builders` to a semicolon-separated list, ensure the old `builders = …key…` entry is removed from `/etc/nix/nix.conf` or the client will keep using the stale value. One-time cleanup:
  - `sudo sed -i '' '/^builders =/d;/^ssh-key/d' /etc/nix/nix.conf`
  - Then rerun activation (or set `NIX_CONFIG="builders = …"` for that run) so the new value is written.

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

Common pitfall: Bash arrays inside Nix strings
- Symptom: Nix evaluation fails with errors like `syntax error, unexpected '@'` or `$` expansion gets eaten by Nix.
- Cause: Bash array expansions such as `${!ids[@]}`, `${ids[$i]}` inside a Nix string are interpreted by Nix unless escaped.
- Fix: Escape every shell `${...}` as `''${...}` inside the Nix string.
  - Incorrect: `for i in "${!ids[@]}"; do id="${ids[$i]}"; ...`
  - Correct:   `for i in "''${!ids[@]}"; do id="''${ids[$i]}"; ...`
  - Also escape standalone `${var}` and any `${...}` appearing in `awk`, here-strings, etc.

Real-world example: avoid `${cmd[@]}` in Nix strings
- Incorrect (fails with `unexpected '@'`):
  - `local cmd=(/usr/bin/defaults "$scope" read com.apple.symbolichotkeys AppleSymbolicHotKeys)`
  - `if out="$(${cmd[@]} 2>/dev/null)"; then ... fi`
- Correct (drop arrays inside Nix strings):
  - `if out="$(/usr/bin/defaults "$scope" read com.apple.symbolichotkeys AppleSymbolicHotKeys 2>/dev/null)"; then ... fi`
- If you must use arrays, escape for Nix:
  - `if out="$(${cmd[''@]} 2>/dev/null)"; then ... fi`
  - But prefer avoiding arrays altogether in embedded shell strings for simplicity and reliability.

### Nix Interpolation Gotchas (Lesson Learned)
- Symptom: Nix evaluation error like `undefined variable 'TMP_PLIST'` inside a module.
- Cause: Writing a shell expansion as `"${TMP_PLIST}"` inside a Nix string makes Nix try to interpolate `${TMP_PLIST}` at evaluation time.
- Fix:
  - Prefer plain shell expansion without braces when possible: `"$TMP_PLIST"`.
  - If you need braces in the shell (e.g., `"${TMP_PLIST}/sub"`), escape for Nix: `"''${TMP_PLIST}/sub"` so the resulting string contains `${TMP_PLIST}` for the shell to expand at runtime.
  - Rule of thumb: `${...}` means Nix; `''${...}` means “emit `${...}` literally for the shell”.
- Tip: When mixing `defaults import`/`plutil`/helper scripts in activation strings, double-check every `${...}`: if it’s a Nix var, keep it as `${nixVar}`; if it’s a shell var, write `$var` or `''${var}`.

## Nix Syntax Learnings (Attribute Merges, Comments, Booleans)

- `//` is an attribute-set merge operator, not a comment.
  - Do not use `//` to start a comment line inside Nix expressions. Use `#` for comments.
  - Valid pattern for merging sets:
    - `final = base // (lib.optionalAttrs cond { a = 1; }) // { b = 2; };`

- Prefer `lib.optionalAttrs`/`lib.optionalString` for conditional merges/text.
  - Keeps expressions composable and avoids nested `if` in large sets.

- Booleans in shell code generated by Nix strings:
  - Do not compare to the string `"true"` blindly. Emit a flag and test non-empty: `FLAG="''${COND:+1}"; if [ -n "''${FLAG}" ]; then ... fi`.
  - Or have Nix expand to `1`/empty and check with `[ -n ]`.

- Passing values into jq in activation scripts:
  - Use `jq --arg name "$value"` and reference with `$name` inside the jq program; do not assume shell variables are visible to jq.

- AppleSymbolicHotKeys data model gotchas:
  - Values live in both user and currentHost domains; write both when asserting state.
  - IDs used here: 60/61 (input source), 64 (Spotlight), 79/80 (space left/right), 118..126 (desktop 1..9).
  - Use canonical Spotlight parameters `[32, 49, 1048576]` (Cmd+Space).

## Declarative Limits on macOS Hotkeys (Spotlight, Mission Control)

- Reality: Some toggles in System Settings → Keyboard → Keyboard Shortcuts cannot be fully “ticked” purely via plist writes.
  - AppleSymbolicHotKeys lets us write IDs, enabled flags and parameters, but the UI checkbox state may still need a one‑time manual toggle for macOS to honor it.
  - Spotlight (ID 64) on recent macOS (Sonoma/Sequoia) is the most common example.

- Conflicts to check when a shortcut won’t fire even if enabled in plists:
  - Siri: “Press and hold Command Space” can block Spotlight. Turn it off or remap.
  - Input Sources: ensure 60/61 do not use Cmd+Space (we disable them by default).
  - Third‑party launchers (Raycast/Alfred): they can seize Cmd+Space.

- Diagnostics & enforcement:
  - Read currentHost: `defaults -currentHost read com.apple.symbolichotkeys AppleSymbolicHotKeys | plutil -convert json - -o - | jq '."64"'`
  - If disabled, write 64 explicitly (both user and ByHost) via PlistBuddy:
    - Ensure `enabled = true`, `value.type = standard`, `parameters = [32,49,1048576]`, then `killall cfprefsd Dock SystemUIServer`.
  - Desktop 1..9 (118..126) work only when those Desktops exist; full‑screen app Spaces do not count.
  - Tiling (NSUserKeyEquivalents) depends on localized menu titles; add localized strings as needed.

- Practical pattern:
  - Configure (IDs + params) declaratively.
  - After first activation, open System Settings and ensure the relevant checkboxes are ON (Spotlight, Mission Control items). After that, our config keeps them consistent.


## Shell Scripting Notes
- Booleans: avoid constant tests like `[ "1" = "true" ]`. Use a runtime flag and test it, for example `FLAG="''${ENV_FLAG:-1}"; if [ -n "''${FLAG}" ]; then ... fi`.
- Nix → shell interpolation: in Nix strings, escape shell `${...}` as `''${...}` so Nix doesn’t try to interpolate shell parameters.
- Job roles: let mu4e own `mu index` to avoid DB lock contention; background jobs should focus on fetching (mbsync) and optional notifications.
- Logging hygiene: aim for informative one‑line logs; prevent unit failures where practical and surface transient tool errors as warnings.
