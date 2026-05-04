---
name: devenv-project
description: |
  Declarative dev environment management with devenv. Use when scaffolding or editing devenv.nix, adding languages/services/processes/tasks, configuring profiles or secrets, troubleshooting devenv issues, or when any project uses devenv as its environment foundation.
---

# Devenv Project Workflow

Use this skill whenever you work inside a project that uses [devenv](https://devenv.sh). devenv.nix is the project's source of truth for tooling, services, and developer workflow. Treat it with the same care as the main application code.

## When to activate

- The project has `devenv.nix`, `devenv.yaml`, or `.envrc` with `use devenv`
- The user asks to add a language, service, process, task, or tool
- A command fails because a tool is missing from the environment
- The user says "set up the dev environment", "add postgres", "fix devenv", etc.

## Configuration files

| File | Role | Committed? |
|------|------|-----------|
| `devenv.nix` | Main declarative config (Nix module) | Yes |
| `devenv.yaml` | Inputs, imports, process manager, secrets provider | Yes |
| `.envrc` | direnv integration (`use devenv`) | Yes |
| `devenv.lock` | Pinned inputs for reproducibility | Yes |
| `devenv.local.nix` | Local overrides (personal prefs, debug flags) | No |
| `devenv.local.yaml` | Local input/import overrides | No |

### devenv.nix structure

Every `devenv.nix` is a Nix module function:

```nix
{ pkgs, lib, config, inputs, ... }:
{
  # Always include `inputs` for flakes compatibility.
  # Configuration goes here.
}
```

### devenv.yaml structure

```yaml
inputs:
  nixpkgs:
    url: github:cachix/devenv-nixpkgs/rolling
imports:
  - ./shared           # local sub-module
  - /nix               # from git root (monorepo)
```

## Key configuration categories

### Languages

devenv supports 50+ languages. Enable them declaratively:

```nix
languages.<name>.enable = true;
```

Use `devenv search <language>` or the MCP server to discover available language options and their sub-settings (version, package manager, toolchain channel, etc.). Do NOT memorize language options — query them live.

### Packages

Add tools from nixpkgs (100,000+ packages):

```nix
packages = [ pkgs.git pkgs.jq pkgs.ripgrep ];
```

Use `devenv search <query>` to find package names.

If `devenv search` fails to find a known nixpkgs package, verify it explicitly before assuming it does not exist:

```bash
nix eval nixpkgs#<pkg-name>.outPath
```

If that returns a store path, the package exists and can usually still be added to `devenv.nix`.

### Services

Pre-configured services (PostgreSQL, Redis, Nginx, RabbitMQ, etc.):

```nix
services.postgres = {
  enable = true;
  initialDatabases = [{ name = "myapp"; }];
};
```

Each service exposes `enable`, version/package, config options, and port management.

### Processes

Long-running processes managed by `devenv up`:

```nix
processes.api.exec = "python -m uvicorn main:app --reload";
processes.worker = {
  exec = "celery -A tasks worker";
  after = [ "api" ];                       # dependency ordering
  restart = "on_failure";                  # on_failure | always | never
  ready.http.url = "http://localhost:8000/health";  # readiness probe
  watch.paths = [ "src/" ];               # auto-restart on file changes
};
```

### Tasks

Namespace-scoped, dependency-aware task runner (replaces ad-hoc shell scripts):

```nix
tasks."myapp:migrate" = {
  exec = "alembic upgrade head";
  before = [ "devenv:processes:api" ];     # run before api starts
  status = "alembic check";               # skip if returns 0
};
tasks."myapp:seed".after = [ "myapp:migrate" ];
```

Tasks support `input`/`output` JSON, `execIfModified` glob patterns, and `cwd`.

### Profiles

Selective environment activation for different workflows:

```nix
profiles.backend.module = { ... }: {
  services.postgres.enable = true;
  processes.api.exec = "...";
};
profiles.frontend.module = { ... }: {
  languages.javascript.enable = true;
};
profiles.hostname."ci-runner".module = { ... }: {
  # auto-activates on this hostname
};
```

Activate with `devenv --profile backend shell`.

### Git hooks

Pre-configured hooks (100+ available: ruff, eslint, clippy, prettier, nixfmt, etc.):

```nix
git-hooks.hooks.prettier.enable = true;
git-hooks.hooks.custom-lint = {
  enable = true;
  entry = "./scripts/lint.sh";
  language = "system";
  pass_filenames = false;
};
```

### Containers

Build OCI containers from the environment:

```nix
containers.app = {
  copyToRoot = [ ./. ];
  startupCommand = config.processes.api.exec;
};
```

Build with `devenv container build app`, push with `devenv container copy app`.

### Outputs

Package the application as a Nix derivation:

```nix
outputs.default = pkgs.writeShellApplication { ... };
```

Build with `devenv build`.

### Secrets (SecretSpec)

Declarative secret definitions with pluggable providers (keyring, 1Password, dotenv, env):

```nix
secretspec.enable = true;
secretspec.secrets.DATABASE_URL = {};
```

Configure provider in `devenv.yaml`:
```yaml
secretspec:
  provider: keyring
```

If `devenv shell` hangs on GPG/YubiKey access during diagnostics, bypass SecretSpec temporarily for a one-off command:

```bash
devenv shell --secretspec-provider "env://BYPASS" -- <cmd>
```

Or set:

```bash
SECRETSPEC_PROVIDER=env://BYPASS
```

SecretSpec accepts any `env://<VAR>` provider and reads the named environment variable. This is for diagnostics and non-secret code paths, not for replacing the real provider permanently.

### Shell hooks

```nix
enterShell = ''
  echo "Environment ready"
'';
enterTest = ''
  python -m pytest
'';
dotenv.enable = true;  # load .env file
```

### MCP server

devenv exposes an MCP server for AI agents:

```
devenv mcp          # stdio mode
devenv mcp --http 8080  # HTTP mode
```

Tools: `search_packages`, `search_options`. Use this to discover packages and configuration options at runtime instead of guessing.

## Platform-specific notes

### macOS XeLaTeX font resolution

Nix-provided `xelatex` on macOS may fail to discover fonts that exist in system font directories. In devenv-managed projects, prefer an explicit `OSFONTDIR` in `devenv.nix` when TeX exports depend on macOS fonts:

```nix
env.OSFONTDIR = "/Library/Fonts:$HOME/Library/Fonts:/System/Library/Fonts";
```

Also avoid combining `\bfseries` with a `\newfontface` that already names a bold or extra-bold face. `fontspec` will try to resolve a non-existent b-variant of the already-bold face.

## Agent interaction rules

### Commands to run

| Action | Command | Notes |
|--------|---------|-------|
| Enter environment | `devenv shell` | Interactive shell with all tools |
| Run inside env | `devenv shell -- <cmd>` | Non-interactive, agent-safe |
| Start processes | `devenv up` | **Never run from agent** — interactive only |
| Run tests | `devenv test` | Runs `enterTest` + processes lifecycle |
| Run a task | `devenv tasks run <ns:name>` | |
| Search packages | `devenv search <query>` | Or use MCP `search_packages` |
| Search options | `devenv search <query>` | Or use MCP `search_options` |
| Build output | `devenv build` | |
| Update inputs | `devenv update` | |

### What to run inside devenv shell

All project lifecycle and code-related commands. Only basic core utilities (`ls`, `cp`, `cat`, `mkdir`, `rm`, `git`) are allowed outside `devenv shell`.

### What NOT to do

- **Never call `devenv up` from the agent** — it is interactive and blocks. Use non-interactive scripts or `devenv shell -- <cmd>` for validation.
- **Never delete existing services or processes** unless explicitly requested.
- **Never use `pip install`, `npm install -g`**, or other global package managers — declare everything in `devenv.nix`.
- **Never suppress Nix evaluation errors** — fix the root cause.
- **Treat sandbox failures as environment artifacts** — if `devenv shell` panics with `dynamic_store.rs` or Nix daemon socket errors, verify with `devenv shell -- true` on host before concluding the config is broken.

### Editing devenv.nix

1. Read the existing file first — preserve services, processes, and task names.
2. Keep edits idempotent — repeated runs must not drift.
3. Keep the function args compatible with flakes: `{ pkgs, lib, config, inputs, ... }:`.
4. Validate after editing: `nix-instantiate --parse devenv.nix` at minimum, `devenv test` when available.

## Troubleshooting

Apply fixes in order; stop at the first that resolves the issue:

1. **Missing function args** — ensure `{ pkgs, lib, config, inputs, ... }:` header.
2. **Language not enabled** — check `languages.<name>.enable = true;`.
3. **Tool missing in shell** — add to `packages` or enable the right language module.
4. **Service/process drift** — preserve names; add incrementally; validate after each change.
5. **CLI errors** — run static validation first, runtime checks only when `devenv` CLI is healthy.
6. **Sandbox false negatives** — re-run `devenv shell -- true` on host; if it passes, the error is sandbox-induced.
7. **Stale lock** — run `devenv update` to refresh inputs.

## Project-entry greeting (recommended pattern)

For interactive projects, add a rate-limited greeting in `enterShell`:

- Show at most once every 24 hours (store timestamp in `.devenv/state/`).
- Use colors only when stdout is a TTY.
- Organize into short emoji-headed sections.
- Focus on daily lifecycle commands; offer `dev-help-all` for the full guide.
- Do not mention `direnv allow` or `devenv mcp` in output.

This is a recommended convention, not a hard requirement. Adapt to the project's style.

## devenv up policy

- Treat `devenv up` as the one-command developer entrypoint for interactive local work.
- Define startup in `devenv.nix` processes/services so `devenv up` boots the full stack.
- Add a startup health check that aborts on failure with a clear error.
- Keep health scripts in `scripts/` and reuse them from hooks and CI.
- For agent validation, use `devenv shell -- ./scripts/<check>.sh`, never `devenv up`.
