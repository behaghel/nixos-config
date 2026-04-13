---
description: Scaffold a devenv environment from project intent
argument-hint: [description of what the project needs]
allowed-tools: [Read, Write, Glob, Grep, Bash]
---

# Initialize Devenv Environment

Scaffolds `devenv.nix`, `devenv.yaml`, and `.envrc` from a description of what the project needs.

## Instructions

### Step 1: Assess current state

1. Check if `devenv.nix`, `devenv.yaml`, or `.envrc` already exist.
2. If they exist, ask: "devenv files already exist. Should I update them or start fresh?"
3. Inspect the project for clues: `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `build.sbt`, `mix.exs`, `Makefile`, `Dockerfile`, `docker-compose.yml`.

### Step 2: Determine requirements

From the user's description and project clues, identify:
- **Languages** needed (and versions if specified)
- **Services** needed (databases, caches, message queues)
- **Processes** for `devenv up` (app server, workers, watchers)
- **Tasks** for build/migration/seed workflows
- **Git hooks** for code quality
- **Packages** for additional CLI tools

If anything is ambiguous, ask one focused question. Do not guess at services or databases.

### Step 3: Generate devenv.yaml

Create `devenv.yaml` with the appropriate inputs:

```yaml
inputs:
  nixpkgs:
    url: github:cachix/devenv-nixpkgs/rolling
```

Add `agent-marketplace` input if the project uses marketplace skills.

### Step 4: Generate devenv.nix

Write a `devenv.nix` with:
- Correct function args: `{ pkgs, lib, config, inputs, ... }:`
- Language blocks with `enable = true` and any version/toolchain settings
- Services with sensible defaults
- Processes with dependency ordering and readiness probes where appropriate
- Packages for additional tools
- A `devenv test` entry via `enterTest` that covers at minimum: lint + build/compile check
- A concise `enterShell` greeting following the project-entry greeting pattern

### Step 5: Generate .envrc

```
eval "$(devenv direnvrc)" && use devenv
```

### Step 6: Validate

1. Run `nix-instantiate --parse devenv.nix` to verify syntax.
2. If `devenv` CLI is available, run `devenv shell -- true` to verify evaluation.
3. Report what was created and suggest next steps: `direnv allow`, `devenv shell`, `devenv up`.

## Rules

- Always include `inputs` in function args for flakes compatibility.
- Prefer language modules over raw packages (e.g., `languages.python.enable` over `pkgs.python3`).
- Use `devenv search` or MCP `search_options` to verify option names exist before using them.
- Do not add services the user didn't ask for.
- Keep the initial config minimal — it's easier to add than to remove.
