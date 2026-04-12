# Agent Marketplace

Reusable skills, hooks, MCP servers, and settings for AI coding agents (Claude Code, OpenCode, Codex, Gemini CLI).

Projects consume this marketplace via [devenv](https://devenv.sh) by adding it as an input.

## Directory Structure

```
marketplace/
├── lib.nix                 # Explicit opt-in API
├── plugins/                # Modular plugins (skills + commands + agents)
│   ├── spec-driven/
│   ├── spec-tdd/
│   ├── domain-tree/
│   └── ux-stories/
├── memory.md               # Shared agent rules (git policy, dev workflow, etc.)
├── skills/                 # Standalone tool-agnostic skills
├── commands/               # Standalone slash-commands
├── mcp/                    # MCP server definitions
├── hooks/                  # Claude Code hook definitions
└── settings/               # Per-tool settings fragments
```

## Usage in a devenv Project

### 1. Add the marketplace as a devenv input

In `devenv.yaml`:

```yaml
inputs:
  nixpkgs:
    url: github:cachix/devenv-nixpkgs/rolling
  agent-marketplace:
    url: github:behaghel/nixos-config
    flake: false
```

### 2. Wire it in `devenv.nix`

The recommended way to use the marketplace is via the `lib.nix` API. This allows you to explicitly opt-in to specific plugins or bundles.

```nix
{ lib, inputs, ... }:

let
  mp = import (inputs.agent-marketplace + "/marketplace/lib.nix") { inherit lib; };
  bundle = mp.bundles.total-spec;
in {
  # Claude Code
  claude.code = {
    enable = true;
    commands = bundle.commands;
    hooks = mp.hooks;
    mcpServers.devenv = mp.mcpServers.devenv;
  };

  # OpenCode
  opencode = {
    enable = true;
    skills = mp.skills // bundle.skills;
    commands = bundle.commands;
    agents = bundle.agents;
  };
}
```

## Bundles

Bundles are pre-defined collections of plugins.

- `total-spec`: Includes `spec-driven`, `spec-tdd`, `domain-tree`, and `ux-stories`.

### Cherry-pick what you need

You don't have to use everything. You can cherry-pick specific plugins or use the `select` helper:

**Per-plugin cherry-pick:**
```nix
opencode.skills = mp.skills // mp.plugins.spec-tdd.skills;
opencode.commands = mp.plugins.spec-tdd.commands;
```

**Select helper:**
```nix
let chosen = mp.select [ "spec-tdd" "domain-tree" ];
in { opencode.skills = mp.skills // chosen.skills; }
```

## Adding Skills

Create a directory under `marketplace/skills/` with a `SKILL.md` file:

```
marketplace/skills/my-new-skill/
└── SKILL.md
```

The `SKILL.md` file uses YAML frontmatter:

```markdown
---
name: my-new-skill
description: One-line description of when to use this skill.
---

# Skill Title

Instructions, rules, and workflow for the skill.
```

Skills are consumed by OpenCode natively via `opencode.skills`. Claude Code can reference them as custom instructions or commands.

## Updating in Projects

Projects pin the marketplace via `devenv.lock`. To get the latest skills:

```bash
devenv update agent-marketplace
```

## Relationship to `.agents/skills/`

The `.agents/skills/` directory at the repo root contains **repo-local** skills specific to this nixos-config repository (nix-editing, darwin-launchd-debugging, etc.). These are NOT part of the marketplace.

The marketplace contains **general-purpose** skills suitable for any project.
