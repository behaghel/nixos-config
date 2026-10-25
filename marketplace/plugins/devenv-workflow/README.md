# devenv-workflow

Declarative dev environment management with [devenv](https://devenv.sh) — scaffold, maintain, diagnose, and extend `devenv.nix` configurations.

## What's included

| Component | Type | Description |
|-----------|------|-------------|
| Devenv Project | Skill | Core knowledge for working in devenv-based projects |
| `/devenv-init` | Command | Scaffold devenv.nix from project intent and existing clues |
| `/devenv-add` | Command | Add a language, service, process, task, or tool |
| `/devenv-diagnose` | Command | Systematic troubleshooting for devenv issues |
| Devenv expert guidance | Extension + references | Catches imperative installs, commands outside devenv shell, and config anti-patterns |

## Philosophy

devenv.nix is the project's **source of truth** for tooling, services, and developer workflow. This plugin ensures the AI agent treats it that way:

- **Declarative over imperative** — add to devenv.nix, don't `pip install`
- **Inside the shell** — run project commands via `devenv shell --`, not bare
- **Language-agnostic** — devenv supports 50+ languages; use `devenv search` to discover options
- **Minimal by default** — start small, add as needed; easier to grow than to trim
- **Low-noise by default** — when agents run `devenv` non-interactively, prefer `devenv -q ...` unless verbose output is explicitly needed

## Coverage

The skill covers all major devenv 2.0 features:

- Languages, packages, and services
- Processes with readiness probes, file watching, and dependency ordering
- Tasks with namespaces, dependencies, and file-change triggers
- Profiles for selective environment activation
- Git hooks (100+ pre-configured)
- Containers and outputs
- Secrets via SecretSpec, including provider/profile wiring and pass URI mapping
- Nix language-server support through `devenv lsp` / generated nixd config
- MCP server integration for live package/option search

## Workflow

```
/devenv-init → scaffold from intent
  ↓
(develop normally — skill keeps agent devenv-aware)
  ↓
/devenv-add → extend config as needs grow
  ↓
/devenv-diagnose → fix issues when they arise
```

The Pi extension monitors tool calls and redirects anti-patterns toward
declarative configuration. Markdown under `agents/` is reference guidance,
not a separately running agent.

## Pi setup

Pi uses the `pi` package manifest in `package.json` to discover the extension and skill.

#### Per-project (quick start)

Add to `.pi/settings.json`:

```json
{
  "extensions": [
    "/absolute/path/to/marketplace/plugins/devenv-workflow/pi/extension.ts"
  ],
  "skills": [
    "/absolute/path/to/marketplace/plugins/devenv-workflow/skills"
  ],
  "enableSkillCommands": true
}
```

#### Via pi install (local development package)

```bash
pi install /absolute/path/to/marketplace/plugins/devenv-workflow
# For project-only selection:
pi install -l /absolute/path/to/nixos-config/marketplace/plugins/devenv-workflow
```

#### What you get
| Resource | Type | Description |
|----------|------|-------------|
| `devenv-project` | Skill | Core knowledge — loaded on-demand when pi detects a devenv project |
| `devenv_search` | Tool | Search packages/options via `devenv search` |
| `devenv_validate` | Tool | Syntax + evaluation check after editing `devenv.nix` |
| `devenv_read_config` | Tool | Read and summarize devenv configuration files |
| `/devenv-diagnose` | Command | Systematic troubleshooting ladder |
| `/devenv-init` | Command | Scaffold a new devenv environment |
| `/devenv-add` | Command | Add a capability to existing config |
| Devenv Expert | Passive | Anti-pattern detection — catches imperative installs, redirects to declarative config |
