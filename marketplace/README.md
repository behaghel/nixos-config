# Agent Marketplace

Reusable skills, hooks, MCP servers, and settings for AI coding agents (Claude Code, OpenCode).

Projects consume this marketplace via [devenv](https://devenv.sh). devenv generates all agent configuration files declaratively — no manual JSON editing required.

## Directory Structure

```
marketplace/
├── lib.nix                 # Explicit opt-in API
├── plugins/                # Modular plugins (skills + commands + agents)
│   ├── devenv-workflow/
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

---

## Installation

### Prerequisites

- [devenv](https://devenv.sh) installed
- [direnv](https://direnv.net/) installed and hooked into your shell

### New project from template

Templates ship with the marketplace pre-wired:

```bash
nix flake new my-project --template github:behaghel/nixos-config#python-basic-devenv
cd my-project
direnv allow
```

Available templates: `python-basic-devenv`, `scala-basic-devenv`, `guile-basic-devenv`, `guile-hall-devenv`, `pharo-basic-devenv`. Done — plugins are active for both Claude Code and OpenCode.

### Existing project

**Step 1.** If the project has no devenv yet, scaffold it:

```bash
devenv init --override-input agent-marketplace "github:behaghel/nixos-config flake=false"
```

If devenv is already set up, add the input to `devenv.yaml` instead:

```yaml
inputs:
  agent-marketplace:
    url: github:behaghel/nixos-config
    flake: false
```

**Step 2.** Wire plugins in `devenv.nix`. Add `inputs` to the function args if missing, then add the section for your agent. See the Claude Code or OpenCode tabs below.

**Step 3.** Activate: `direnv allow` (or `devenv shell`).

Once loaded, `/devenv-init` is available to flesh out languages, services, and processes. `/devenv-add` and `/devenv-diagnose` help from there.

---

## Claude Code

Add to `devenv.nix`:

```nix
{ pkgs, lib, config, inputs, ... }:

let
  mp = import (inputs.agent-marketplace + "/marketplace/lib.nix") { inherit lib; };
in {
  # ... your existing config ...

  claude.code = {
    enable = true;
    commands = mp.plugins.devenv-workflow.commands;
    hooks = mp.hooks;
    mcpServers.devenv = mp.mcpServers.devenv;
  };
}
```

### What gets generated

On `devenv shell`, devenv creates `.claude/settings.json` and `.claude/commands/*.md`. These are managed by devenv — change `devenv.nix`, not the generated files. Add `.claude/` to `.gitignore`.

### What becomes available

- `/devenv-init` — scaffold languages, services, processes from project intent
- `/devenv-add` — add a language, service, process, task, or tool
- `/devenv-diagnose` — systematic troubleshooting for devenv issues
- `devenv` MCP server — live `search_packages` and `search_options` queries

> **Let your agent do it.** Paste this prompt into Claude Code:
>
> *"Add a devenv input called agent-marketplace pointing to github:behaghel/nixos-config (flake: false). Then in devenv.nix, import its lib at /marketplace/lib.nix and wire mp.plugins.devenv-workflow into claude.code — enable commands, hooks (mp.hooks), and the devenv MCP server (mp.mcpServers.devenv)."*

---

## OpenCode

Add to `devenv.nix`:

```nix
{ pkgs, lib, config, inputs, ... }:

let
  mp = import (inputs.agent-marketplace + "/marketplace/lib.nix") { inherit lib; };
in {
  # ... your existing config ...

  opencode = {
    enable = true;
    skills = mp.plugins.devenv-workflow.skills;
    commands = mp.plugins.devenv-workflow.commands;
    agents = mp.plugins.devenv-workflow.agents;
    mcp.devenv = {
      type = "local";
      command = [ "devenv" "mcp" ];
      environment.DEVENV_TUI = "false";
    };
  };
}
```

### What gets generated

On `devenv shell`, devenv creates `.opencode/skills/*/SKILL.md`, `.opencode/commands/*.md`, and `.opencode/agents/*.md`. These are managed by devenv — change `devenv.nix`, not the generated files. Add `.opencode/` to `.gitignore`.

### What becomes available

- **Skill**: `devenv-project` — core devenv knowledge, loaded automatically
- **Commands**: `/devenv-init`, `/devenv-add`, `/devenv-diagnose`
- **Agent**: `devenv-expert` — catches imperative installs, commands outside devenv shell, config anti-patterns
- **MCP**: `devenv` server — live `search_packages` and `search_options` queries

> **Let your agent do it.** Paste this prompt into OpenCode:
>
> *"Add a devenv input called agent-marketplace pointing to github:behaghel/nixos-config (flake: false). Then in devenv.nix, import its lib at /marketplace/lib.nix and wire mp.plugins.devenv-workflow into the opencode section — enable skills, commands, agents, and add an mcp.devenv entry running `devenv mcp` with DEVENV_TUI=false."*

---

## Using both agents

If the project uses both Claude Code and OpenCode, combine both sections:

```nix
let
  mp = import (inputs.agent-marketplace + "/marketplace/lib.nix") { inherit lib; };
in {
  claude.code = {
    enable = true;
    commands = mp.plugins.devenv-workflow.commands;
    hooks = mp.hooks;
    mcpServers.devenv = mp.mcpServers.devenv;
  };

  opencode = {
    enable = true;
    skills = mp.plugins.devenv-workflow.skills;
    commands = mp.plugins.devenv-workflow.commands;
    agents = mp.plugins.devenv-workflow.agents;
    mcp.devenv = {
      type = "local";
      command = [ "devenv" "mcp" ];
      environment.DEVENV_TUI = "false";
    };
  };
}
```

---

## Selecting plugins

### Bundles

Pre-defined plugin collections:

- `total-spec`: `spec-driven` + `spec-tdd` + `domain-tree` + `ux-stories`

### Cherry-pick

```nix
opencode.skills = mp.plugins.devenv-workflow.skills;
opencode.commands = mp.plugins.devenv-workflow.commands;
```

### Select multiple

```nix
let chosen = mp.select [ "spec-tdd" "devenv-workflow" ];
in {
  opencode.skills = chosen.skills;
  opencode.commands = chosen.commands;
  opencode.agents = chosen.agents;
}
```

### Combine plugins and bundles

```nix
let
  bundle = mp.bundles.total-spec;
  devenv = mp.plugins.devenv-workflow;
in {
  opencode.skills = bundle.skills // devenv.skills;
  opencode.commands = bundle.commands // devenv.commands;
  opencode.agents = bundle.agents // devenv.agents;
}
```

---

## Adding a new plugin

```
marketplace/plugins/my-plugin/
├── .claude-plugin/plugin.json   # { "name", "version", "description" }
├── README.md
├── skills/
│   └── my-skill/SKILL.md       # YAML frontmatter + markdown
├── commands/
│   └── my-command.md            # YAML frontmatter + instructions
└── agents/
    └── my-agent.md              # YAML frontmatter + system prompt
```

`lib.nix` auto-discovers plugins. No registration needed — create the directory and it appears in `mp.plugins`. Run `nix flake check` to validate.

---

## Updating in projects

```bash
devenv update agent-marketplace
```

Then `direnv reload` or `devenv shell` to regenerate agent config files.

---

## Relationship to `.agents/skills/`

`.agents/skills/` at the repo root contains **repo-local** skills specific to this nixos-config repository. These are NOT part of the marketplace.

The marketplace contains **general-purpose** skills suitable for any project.
