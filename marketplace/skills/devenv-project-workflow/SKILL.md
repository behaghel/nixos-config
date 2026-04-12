---
name: devenv-project-workflow
description: Create, update, and troubleshoot flakes-only devenv environments for Python, Node, and Rust projects. Use when Codex needs to scaffold or maintain `devenv.nix`, configure stack-specific tooling and services, define shell/process/task workflows, improve project-entry greetings, or diagnose devenv setup issues in these stacks.
---

# Devenv Project Workflow

Use this skill to build or maintain reproducible, flakes-only `devenv` workflows for Python, Node, and Rust repositories.

## Workflow

1. Identify scope before editing.
   - Detect target stack: `python`, `node`, `rust`, or mixed.
   - Confirm whether to scaffold from scratch or patch existing `devenv.nix`.
2. Inspect current environment files.
    - Check `devenv.nix`, `devenv.yaml`, `.envrc`, and `devenv.lock`.
    - Preserve existing project-specific processes and service decisions.
    - Inspect `enterShell` and any onboarding/help scripts so the project root greeting stays useful and not spammy.
3. Apply stack patterns.
    - Read `references/stack-patterns.md`.
    - Reuse the closest baseline and only add packages/services required by the task.
    - If the project has a shell greeting, keep command names stable while bringing the structure into compliance with the greeting policy below.
4. Scaffold deterministically when needed.
   - Run `scripts/bootstrap_devenv.sh --stack <python|node|rust> [--output devenv.nix]`.
   - Use `--force` only if explicit overwrite is requested.
5. Validate before finishing.
   - Run `scripts/validate_devenv.sh --stack <python|node|rust> [--file devenv.nix]`.
   - Maintain a main project health suite wired to `devenv test`.
   - Ensure `devenv test` covers linting, compiling/build checks, automated tests, and test coverage.
   - Keep app boot checks script-driven under `scripts/` so the same checks are callable from both `devenv up` hooks and non-interactive agent runs.
   - Optionally run runtime checks with `--run-runtime-checks` when `devenv` CLI is available.
6. Troubleshoot failures methodically.
   - Read `references/troubleshooting.md` and apply the smallest viable fix.
   - If running inside an agent sandbox, validate suspected CLI failures once on host execution before concluding configuration is broken.

## Rules

- Keep configurations flakes-only.
- Keep function args in `devenv.nix` compatible with flakes usage (`inputs` included).
- Prefer minimal dependencies and explicit tooling for each stack.
- Run project lifecycle and code-related commands inside `devenv shell`.
- Allow commands outside `devenv shell` only for basic core utilities (for example `ls`, `cp`, `mv`, `cat`, `mkdir`, `rm`).
- Maintain a canonical `devenv test` suite as the main health gate for the project.
- Ensure the `devenv test` suite includes linting, compile/build checks, automated tests, and test coverage checks.
- Ensure `devenv up` alone is enough to boot a fully functioning development environment.
- Ensure `devenv up` executes a startup health check and aborts startup with an informative error if health checks fail.
- Ensure failed `devenv up` startup checks stop the startup flow and return control to the developer terminal.
- Never call `devenv up` from the agent; use non-interactive scripts under `scripts/` for boot/runtime validation.
- Keep runtime/health logic DRY between `devenv.nix` and `scripts/` by invoking shared project scripts from devenv hooks.
- Manage Python modules through Nix in `devenv.nix` (for example `pkgs.python3.withPackages`); avoid global `pip install`.
- Avoid deleting existing services/processes unless explicitly requested.
- Keep edits idempotent so repeated runs do not drift configuration.
- Treat `dynamic_store.rs` panics and Nix daemon socket permission errors in sandboxed runs as possible environment-isolation artifacts; verify with a minimal host run (`devenv shell -- true`).
- Treat the project-entry greeting as part of the developer workflow, not decoration; if it is missing or non-compliant, proactively call that out and offer to fix it.

## Project Entry Greeting Policy

- Prefer a standard greeting in `enterShell` for interactive project-root entry.
- Show it spontaneously at most once every 24 hours per project by storing a timestamp under project or XDG state.
- Use terminal colors only when stdout is a TTY and color support is available.
- Organize the output into short sections with emoji headings so it is cheerful but still scannable.
- Keep the default greeting focused on day-to-day lifecycle commands; do not dump every tool on every shell entry.
- Do not mention `direnv allow` in the greeting or help output.
- Do not mention `devenv mcp` in the greeting or help output.
- Require a short description for every displayed command outside the tooling section.
- Provide an on-demand full help command using a CLI invocation that actually exists in the installed `devenv` version (for example `devenv shell -- dev-help-all`).
- Keep the tooling/version section at the very end of `dev-help-all` output.
- In the tooling section only, print each line as `<tool> <version>` with no description and without the literal word `version`.
- When auditing an existing project, spontaneously maintain this structure and offer to correct it if you discover drift.

## Devenv Up Policy

- Treat `devenv up` as the one-command developer entrypoint for interactive local development.
- Define app startup in `devenv.nix` processes/services so `devenv up` boots the app stack end-to-end.
- Run a startup health-check script before considering startup successful.
- Exit non-zero on startup health-check failure and print a clear actionable error message.
- Keep health-check/startup scripts in `scripts/` and reuse them from `devenv` hooks and CI-style non-interactive checks.
- For agent-driven verification, run non-interactive scripts (for example via `devenv shell -- <script>`) and avoid `devenv up`.

## Commands

```bash
# Scaffold a new Python-focused devenv file
devenv shell -- ./scripts/bootstrap_devenv.sh --stack python --output devenv.nix

# Validate a Rust setup with runtime checks
devenv shell -- ./scripts/validate_devenv.sh --stack rust --file devenv.nix --run-runtime-checks

# Run the canonical project health suite
devenv test

# Agent-safe startup validation path (non-interactive)
devenv shell -- ./scripts/startup-health-check.sh
```
