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

After every `devenv.nix` edit, validate syntax immediately with `devenv_validate`
or `nix-instantiate --parse devenv.nix` from the selected checkout. Then evaluate
with `devenv -q shell -- true` under its normal trust/secret policy. Review lockfile
changes and preserve existing input pins. Do not activate system configuration,
run `sudo`, launch an agent or create/retire a real workspace just to test setup.
A read-only launcher/doctor check establishes availability, not capability
acceptance. Complete the gate below and report any creation prerequisites still
pending until the setup change is reviewed and integrated.

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

## Capability acceptance

This gate is mandatory for installation, migration, and upgrades. List the user's
requested operations and required flags first; do not assume every discovered
launcher supports them, or that every project needs the newest tool release.

Before declaring setup complete, verify skill discovery, the resolved launcher,
and support in both CLI usage and shell completions for the requested operations.
Report capability gaps explicitly. A newer skill does not upgrade a pinned CLI.

1. Verify native skill discovery, any bundled pointer, and the resolved launcher
   in the selected project's environment, not just the host PATH. If a host command
   or loaded completion is stale, reload the existing approved environment and
   repeat the checks before proposing a pin change.
2. Record the installed source revision alongside the executable path. Trace the
   provider import to its locked input revision; for local imports record the
   source checkout revision and dirty state. A project pin or checkout HEAD alone
   does not prove that a cached launcher was built from it. If the installed build
   cannot be correlated confidently, report its revision as unverified, with the
   expected project pin/source revision separately. Never report the skill's
   version as the tool's version, or an unknown revision as "latest".
3. Read usage from that verified executable. A no-argument call normally prints
   usage and exits 64; capture that expected status rather than skipping the rest
   of acceptance. Compare complete command/flag combinations with requested work.
4. Check completion candidates from the same executable and verify registration
   for both `as` and `agent-session` in the chosen shell (Bash, Zsh or Fish). A
   generated file on disk or a successful skill reload is not completion proof.
   In Bash, `complete -p as agent-session` inspects registration; test freshly
   loaded project-supplied completion in a subshell if the current shell is stale.
   Use equivalent registration/candidate checks for the project's other shells.

On versions advertising the completion query interface, these are read-only:

```sh
agent-session __complete commands
agent-session __complete targets
agent-session __complete options:create
agent-session __complete options:finish
agent-session __complete options:global-status
agent-session __complete options:global-batch
agent-session completion bash
```

Select the generated completion shell to match the project. Compare usage and
candidates for the actual operations, for example:

| Requested operation | Required usage/completion evidence |
|---|---|
| Prepare and run work | Session commands `create`/`run`; creation `--json` when requested. |
| Exact path inspection | Global `status` with `--worktree` in usage and `options:global-status`. |
| Guarded branch-preserving finish | `finish` with `--keep-branch`, `--dry-run` and `--expected` in usage and session completion options. |
| Inactive batch retirement | Global `batch finish` plus requested window/exclusion/receipt/apply flags, including `--inactive-for`, `--expected` and `--yes`, in usage and `options:global-batch`. |

An old version without these query scopes needs inspection of its own advertised
completion interface/resources; absent evidence is unverified support, not a
reason to invent commands. Report each requested capability as supported,
unsupported or unverified, with separate usage and completion evidence and the
installed source revision. A mismatch is a setup gap even if the command happens
to be available in one of the two surfaces.

If a required feature is missing, propose the **smallest targeted pin update** to
a reviewed provider revision supplying it. Show the current and proposed source
revisions, affected input/lock entries and the capability it adds. Obtain explicit
approval before changing the pin; never silently upgrade or refresh unrelated
inputs. If approval is declined, report the gap and incomplete requested setup.
After approval, evaluate the updated project environment and repeat launcher,
source-revision, usage and shell-completion acceptance checks.

Do not invoke retirement (`finish` or `batch finish`), even with `--dry-run`, to
test installation or migration. Do not create/repair/prune workspaces, launch an
agent or activate configuration for capability acceptance. These checks establish
advertised support, not behavioral proof of a destructive operation; a real
retirement still needs its own request, preview and approval.

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
