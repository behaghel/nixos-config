# Adopt agent-session in a devenv project

Use this path only when the user explicitly requests adoption. Load the
`devenv-project` skill for configuration/search/validation rules. Do not interpret
an unrelated coding request or a missing host `as` command as installation consent.

## Inspect and propose before editing

- Read repository policy, `git status --short --branch`, devenv configuration and
  existing imports. Establish whether this is missing setup, disabled setup or
  merely a shell/PATH issue. Do not duplicate an existing input/module/package.
- If the project has no devenv foundation, explain that prerequisite and offer
  separate onboarding; do not silently scaffold an environment.
- Propose the smallest change: module input/import, enable option, ignored
  worktree root, lock impact and a tiny skill-loader policy pointer. Explain the
  default agent (`pi`); installing the launcher does not install/launch Pi itself.
- Ask for **explicit approval before edits**. Offer optional project-level Pi
  skill selection separately; do not assume permission to alter personal settings.
  Follow existing repository policy during bootstrap. If isolation requirements
  cannot yet be satisfied, ask rather than inventing managed session metadata.

## Declarative module wiring, after approval

Reuse an input already supplying this repository and its approved revision. Only
if none exists, add an input/import following the project's conventions:

```yaml
# devenv.yaml — merge into existing inputs/imports, do not replace the file
inputs:
  nixos-config:
    url: github:behaghel/nixos-config
    flake: false
imports:
  - nixos-config/modules/flake/agent-session
```

The example URL is locked through `devenv.lock`; use an approved tag/commit in the
URL too when repository policy requires it. Keep unrelated inputs pinned. Do not
refresh all inputs or repin the project to match a newer copy of this skill.

Add to the existing Nix module:

```nix
agentSession.enable = true;
```

Read the imported module's options before customizing. The default worktree root
is `.worktrees`; add `/.worktrees/` to `.gitignore`, respecting an existing custom
root/ignore rule. Local settings links must be explicit and ignored. Never link or
copy credential stores, Pi authentication, histories, `.pi/npm/` or runtime state.
Do not add client-configuration generators or resource symlinks through devenv.

The integration defaults authorize approved retirement of `.devenv` workspace
scratch state, including logs/databases, and recognize the generated hook-config
symlink only against this project's exact `git-hooks.configFile` target. They do
not approve a real cleanup or arbitrary Nix-store links. Retain needed evidence
before finishing, or replace `agentSession.disposablePaths` (use `[]` to retain
all ordinary ignored data). Set `agentSession.recognizeGeneratedHookConfig = false`
to disable generated-hook recognition; explicit disposal paths still apply.
Do not add `.pi/npm` or other project-specific state without separate approval.

After every `devenv.nix` edit, validate syntax immediately with `devenv_validate`
or `nix-instantiate --parse devenv.nix` from the selected checkout. Then evaluate
with `devenv -q shell -- true` under its normal trust/secret policy. Review lockfile
changes and preserve existing input pins. Do not activate system configuration,
run `sudo`, launch an agent or create/retire a real workspace just to test setup.
A read-only launcher/doctor check can establish availability; report any creation
prerequisites still pending until the setup change is reviewed and integrated.

## Offer native Pi resource selection, not devenv-generated settings

The launcher is a devenv tool. Skills are native Pi resources, selected personally
or in trusted project `.pi/settings.json`; importing the module does not install
them. Review package source before offering installation/project trust. Do not
change the user's trust defaults or run a nested Pi to grant trust.

This skill ships in the existing `devenv-workflow` Pi package. From an existing,
stable source checkout, native commands are:

```sh
# Personal package selection, only when requested:
pi install /absolute/path/to/nixos-config/marketplace/plugins/devenv-workflow
# Optional project-only selection, after approval:
pi install -l /absolute/path/to/nixos-config/marketplace/plugins/devenv-workflow
```

These are placeholders for the user's actual reviewed source, not paths to copy
into every project. Do not point clients at temporary worktrees or generated Nix
store paths. Do not invent a published npm package or an unsupported git-subdirectory
source for this plugin. If no suitable shared source exists, explain the limitation.

Preserve existing Pi resource choices. This package also supplies a devenv
extension and another skill: avoid loading the same extension both explicitly
and through a package. If already selected, use its existing skill resources
rather than adding a second declaration. Offer native resource filtering when
only the skill is desired. Local sources follow their checkout; a devenv input
pin does not pin a personal Pi package. Use `/reload` in the existing Pi session
or let the human start a new one, then verify discovery of `agent-session`.

## Leave a policy pointer, not another manual

After the repository owner agrees managed worktrees are required, its `AGENTS.md`
can say:

> Before repository edits, load the `agent-session` skill. Managed worktrees are
> required. If the skill or verified launcher is unavailable, stop and ask.

Where the source is bundled in the repository, link that `SKILL.md` as a fallback
so the pointer still resolves before package reload. Otherwise verify the chosen
native Pi package/resource setup makes the skill available to contributors.
Keep branch naming, commit/signing, push/PR and activation policies in the
repository—not in the reusable skill. Do not impose a new delivery policy.

For detailed CLI/schema contracts, read the installed module's README or the
[upstream reference](https://github.com/behaghel/nixos-config/blob/master/modules/flake/agent-session/README.md)
at the project's pinned revision. The linked moving branch is not evidence that
an older installed CLI supports its newest features.
