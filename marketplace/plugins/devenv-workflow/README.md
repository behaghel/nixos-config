# devenv-workflow

Declarative dev environment management with [devenv](https://devenv.sh) — scaffold, maintain, diagnose, and extend `devenv.nix` configurations.

## What's included

| Component | Type | Description |
|-----------|------|-------------|
| Devenv Project | Skill | Core knowledge for working in devenv-based projects |
| `/devenv-init` | Command | Scaffold devenv.nix from project intent and existing clues |
| `/devenv-add` | Command | Add a language, service, process, task, or tool |
| `/devenv-diagnose` | Command | Systematic troubleshooting for devenv issues |
| `devenv-expert` | Agent | Catches imperative installs, commands outside devenv shell, and config anti-patterns |

## Philosophy

devenv.nix is the project's **source of truth** for tooling, services, and developer workflow. This plugin ensures the AI agent treats it that way:

- **Declarative over imperative** — add to devenv.nix, don't `pip install`
- **Inside the shell** — run project commands via `devenv shell --`, not bare
- **Language-agnostic** — devenv supports 50+ languages; use `devenv search` to discover options
- **Minimal by default** — start small, add as needed; easier to grow than to trim

## Coverage

The skill covers all major devenv 2.0 features:

- Languages, packages, and services
- Processes with readiness probes, file watching, and dependency ordering
- Tasks with namespaces, dependencies, and file-change triggers
- Profiles for selective environment activation
- Git hooks (100+ pre-configured)
- Containers and outputs
- Secrets via SecretSpec
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

The `devenv-expert` agent runs passively, catching anti-patterns and redirecting toward declarative configuration.

## Wiring Notes

- For OpenCode, wire this plugin through `mp.plugins.devenv-workflow` from `marketplace/lib.nix`.
- Do not read agent markdown files from `plugins/devenv-workflow/agents/` directly.
- Reason: the marketplace library applies OpenCode compatibility processing to agents, including stripping Claude-style frontmatter that OpenCode rejects.
- Safe pattern:

```nix
let
  mp = import (inputs.agent-marketplace + "/marketplace/lib.nix") { inherit lib; };
  devenv = mp.plugins.devenv-workflow;
in {
  opencode.skills = devenv.skills;
  opencode.commands = devenv.commands;
  opencode.agents = devenv.agents;
}
```
