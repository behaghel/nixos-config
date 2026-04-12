# Agent Marketplace

Reusable skills, hooks, MCP servers, and settings for AI coding agents (Claude Code, OpenCode, Codex, Gemini CLI).

Projects consume this marketplace via [devenv](https://devenv.sh) by adding it as an input.

## Directory Structure

```
marketplace/
├── memory.md               # Shared agent rules (git policy, dev workflow, etc.)
├── skills/                 # Tool-agnostic skills (SKILL.md format)
│   ├── devenv-project-workflow/
│   └── spec-driven-tdd/
├── commands/               # Shared slash-commands (markdown)
├── mcp/                    # MCP server definitions (Nix attrsets)
│   └── devenv.nix          # devenv MCP server (search_packages, search_options)
├── hooks/                  # Claude Code hook definitions
│   └── notification.nix    # Desktop notifications on idle/permission/stop
└── settings/               # Per-tool settings fragments
    ├── claude-code.nix
    └── opencode.nix
```

## Usage in a devenv Project

### 1. Add the marketplace as a devenv input

In `devenv.yaml`:

```yaml
inputs:
  nixpkgs:
    url: github:cachix/devenv-nixpkgs/rolling
  agent-marketplace:
    url: github:hubertbehaghel/nixos-config
    flake: false
```

### 2. Wire it in `devenv.nix`

```nix
{ pkgs, inputs, ... }:

{
  # ... your project config ...

  # Claude Code
  claude.code = {
    enable = true;
    hooks = import (inputs.agent-marketplace + "/marketplace/hooks/notification.nix");
    mcpServers.devenv = import (inputs.agent-marketplace + "/marketplace/mcp/devenv.nix");
  };

  # OpenCode
  opencode = {
    enable = true;
    skills = inputs.agent-marketplace + "/marketplace/skills";
  };
}
```

### 3. Cherry-pick what you need

You don't have to use everything. Import only what your project needs:

```nix
# Just Claude Code hooks, no OpenCode
claude.code = {
  enable = true;
  hooks = import (inputs.agent-marketplace + "/marketplace/hooks/notification.nix");
};

# Just OpenCode skills, no Claude
opencode = {
  enable = true;
  skills = inputs.agent-marketplace + "/marketplace/skills";
};

# Just the MCP server
claude.code.mcpServers.devenv = import (inputs.agent-marketplace + "/marketplace/mcp/devenv.nix");
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
