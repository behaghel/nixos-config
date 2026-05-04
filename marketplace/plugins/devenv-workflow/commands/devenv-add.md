---
description: Add a language, service, process, task, or tool to devenv.nix
argument-hint: <what to add, e.g. "postgres", "python 3.12", "redis", "eslint hook">
allowed-tools: [Read, Write, Bash]
---

# Add to Devenv Environment

Adds a capability to an existing devenv.nix configuration.

## Instructions

### Step 1: Read current config

1. Read `devenv.nix` and understand what's already configured.
2. Identify what the user wants to add. Classify it:
   - **Language** — `languages.<name>.enable = true`
   - **Service** — `services.<name>.enable = true`
   - **Process** — `processes.<name>.exec = "..."`
   - **Task** — `tasks."<ns>:<name>".exec = "..."`
   - **Package** — add to `packages` list
   - **Git hook** — `git-hooks.hooks.<name>.enable = true`
   - **Profile** — `profiles.<name>.module = ...`

### Step 2: Discover the right options

Use `devenv search <query>` or the MCP server `search_options` tool to find:
- The exact option path (e.g., `services.postgres.enable`, not `services.postgresql.enable`)
- Available sub-options (port, version, initial config)
- Required companion packages

Do NOT guess option names. Verify they exist.

If `devenv search` misses a package you expect to exist, verify the nixpkgs package directly before concluding it is unavailable:

```bash
nix eval nixpkgs#<pkg-name>.outPath
```

### Step 3: Edit devenv.nix

1. Add the new configuration block in the appropriate section.
2. Preserve existing configuration — do not reorder, reformat, or delete unrelated code.
3. If the addition needs a dependency on another service or process, add `after = [...]`.
4. If the addition needs a new input, update `devenv.yaml` too.

### Step 4: Validate

1. `nix-instantiate --parse devenv.nix`
2. If devenv CLI is available: `devenv shell -- true`
3. For services: note that verification requires `devenv up` (interactive) — tell the user to test manually.

### Step 5: Report

Tell the user:
- What was added and where in the file
- Any manual steps needed (e.g., "run `devenv up` to start the new service")
- Any related options they might want to configure

## Rules

- One addition at a time. If the user asks for multiple things, handle them sequentially.
- Preserve existing process names and service configuration.
- Keep edits idempotent.
- Prefer language modules over raw packages.
- Add git hooks to `git-hooks.hooks`, not as custom scripts, when a pre-configured hook exists.
