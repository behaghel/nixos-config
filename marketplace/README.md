# Pi Marketplace

Reusable workflow skills and extensions distributed through Pi's native package
and resource settings. There is no Nix resource exporter or generated-client
symlink layer.

## Ownership

| Resource | Owner |
|---|---|
| Shared extension, skill and playbook source | This Git repository |
| Personal package/resource selection | `~/.pi/agent/settings.json` and Pi commands |
| Project package/resource selection | Trusted `.pi/settings.json` |
| Package installation and updates | Pi |
| Authentication, histories and runtime state | Pi; never copied into worktrees |
| Project tools and managed worktree launcher | devenv |

Importing this repository as a devenv input does not install Pi resources.
Templates import the shared agent-session module and launch the Pi already on
PATH. They generate no client configuration and do not modify personal Pi
settings. Existing Home Manager application configuration is outside this layer.

## Install

### Published package

Use the published domain-tree package for normal distribution:

```sh
pi install npm:@behaghel/pi-domain-tree
```

Use a versioned npm specification when a project needs a pinned release. Pi
installs runtime dependencies for npm packages. A project declaration replaces
a personal declaration of the same npm package name; this is an intentional
project override, not a second instance.

### Local development packages

Install a plugin directory from an existing checkout:

```sh
pi install /absolute/path/to/nixos-config/marketplace/plugins/devenv-workflow
pi install /absolute/path/to/nixos-config/marketplace/plugins/spec-driven
pi install /absolute/path/to/nixos-config/marketplace/plugins/spec-tdd
pi install /absolute/path/to/nixos-config/marketplace/plugins/ux-stories
```

Local packages load in place, without copying or dependency installation. Keep
local dependencies prepared through the project's declared environment. Local
paths follow changes in that checkout; a project's devenv lock does not pin
personal Pi resources loaded from those paths. Avoid configuring both an
explicit extension path and a package that supplies that same extension.

For project-only selection, use `pi install -l <source>` or edit the project's
`.pi/settings.json`. For example:

```json
{
  "packages": [
    "/absolute/path/to/nixos-config/marketplace/plugins/spec-driven"
  ]
}
```

Pi loads project resources only after project trust is granted. After changing
resource selection, start a fresh Pi session or use `/reload`. Inspect selection
with `pi list` / `pi config`; update resources through Pi, not devenv generators.

The standalone `skills/grill-me` can be selected through Pi's `skills` setting.
Repository-local skills in `.agents/skills/` remain separate from this catalogue.

## Contents

| Plugin | Pi extension capabilities | Skills |
|---|---|---|
| `devenv-workflow` | Detection, tool monitoring, environment discovery, `/devenv-*` | `devenv-project` |
| `domain-tree` | Domain navigation, coverage enforcement, `/domain-tree:*` | `domain-navigator` |
| `spec-driven` | Specification collection/verification, coverage tool | `spec-collector`, `spec-verifier` |
| `spec-tdd` | Iterative delivery guidance, `/tdd-*` | `tdd-planner` |
| `ux-stories` | Graphical UX workflow, `/story-*` | `story-writer` |

Each plugin's `package.json` declares its Pi extensions and skills. Commands are
registered by the extensions. Markdown under `commands/` and `agents/` is shared
playbook/reference material; it is not exported into other client directories.
`memory.md` contains shared rules, not an automatically installed configuration.

## Contributor guidance

Put durable workflow knowledge in shared markdown assets first. Keep consumer
adapters focused on runtime detection, tool registration, interception, and UI
glue only. In particular:

- `skills/*/SKILL.md` owns reusable knowledge and reference material.
- `commands/*.md` owns procedural playbooks and operator flows.
- `agents/*.md` retains reference guardrails, not a separate running actor.
- `pi/extension.ts` owns the native Pi integration.
- Declare extension runtime dependencies in the plugin package manifest.
- Keep host-provided Pi packages as peers, not bundled runtime dependencies.
- Keep native JavaScript build tools such as `esbuild` in `devenv.nix`, not npm
  lockfiles consumed by `pkgs.importNpmLock`.
- Mark platform-specific guidance explicitly.

Run `nix flake check` to validate Pi manifests/resources, extension syntax,
behavioral tests and template ownership boundaries.

## Existing consumers

The previous Nix exporter API and generated-client integrations are removed.
Before updating an older consumer to this revision, remove its retired
integration blocks and exporter imports from its own source configuration, and
select the desired resources through native Pi settings.

This change does not migrate existing projects or delete local resources.
Review legacy links by path, target and tracked status before removing any
individual symlink. Preserve regular files, authored assets, histories and
unrelated application installations. Removing an ignore rule does not untrack
anything already committed; do not bulk-delete or untrack a whole directory.
