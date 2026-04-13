# Shared Agent Rules

## Agent Marketplace

- The agent marketplace lives at `github:behaghel/nixos-config`, input name `agent-marketplace`, `flake: false`.
- API: `import (inputs.agent-marketplace + "/marketplace/lib.nix") { inherit lib; }`.
- Returns: `plugins`, `bundles`, `select`, `skills`, `hooks`, `mcpServers`, `memory`.
- See `marketplace/README.md` for full wiring examples (Claude Code and OpenCode).

## Development Environment

- This project uses [devenv](https://devenv.sh) for reproducible development.
- Run project commands inside `devenv shell` or via `devenv shell <script>`.
- Use `devenv test` as the canonical project health gate.
- If a CLI tool is missing, check whether devenv provides it before installing globally.

## Code Quality

- Run formatters and linters before committing.
- Keep changes focused and reviewable.
- Fix root causes, not symptoms.

## Git Policy

- Write concise, imperative commit messages.
- Do not force push, rebase published history, or amend pushed commits.
- Do not commit secrets, credentials, or API keys.

## Tool Usage

- If a Nix tool is unavailable, get it ad-hoc: `nix run nixpkgs#<tool>`.
- Prefer `devenv shell -- <command>` for non-interactive validation in CI or agent contexts.
- Never call `devenv up` from an agent; use scripts under `scripts/` for startup validation.
