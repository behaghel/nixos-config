---
name: agent-session
description: Operate agent-session/as managed Git worktrees. Use before repository edits in projects configured with agent-session, for session diagnosis or explicitly requested retirement, or when the user explicitly asks to adopt/install as in a devenv project. Do not initiate adoption in unrelated projects.
---

# Agent-session operating guide

`agent-session` (shorthand `as`) is the deterministic engine: it enforces native
resource identity, locking and cleanup guards. This skill teaches its use; it
neither replaces those checks nor grants permission to bypass them. Git worktrees
are workspace isolation, not an OS security sandbox.

Follow the repository's workspace and delivery policy. Do not impose committing,
pushing, PR creation or merging on a project merely because it uses `as`.

## Permission boundaries

| Action | Authority |
|---|---|
| inspect | Routine read-only diagnosis; no repair or resource mutation. |
| work | Create/reuse a workspace and run task commands under repository/user policy. |
| adopt | Explicit approval before project configuration edits; read [the adoption guide](references/adoption.md). |
| upgrade | Explicit approval only when a needed capability is unavailable; no silent repinning. |
| repair | Explicit approval for the proposed metadata repair, registration pruning or resource replacement. |
| retire | Explicit approval to apply the exact previewed selection, following a separate retirement request. |

A diagnostic, missing directory, green test suite or merged PR is not permission
to repair, replace or retire a resource. Leave workspaces available at handoff.

## Establish the launcher and installed capabilities

1. Run `git status --short --branch` in the intended checkout. Preserve existing
   changes; never discard, stash or overwrite another person's work implicitly.
2. Inspect the project's devenv wiring and `command -v as` / `command -v agent-session`.
   `as` may be a shell function or a **system assembler**. Verify the underlying
   `agent-session` executable/package before invoking it; do not probe an unknown
   assembler with agent-session flags.
3. If the module is already configured but the launcher is unavailable outside
   the shell, bootstrap from that repository with
   `devenv -q shell -- agent-session ...`. Once available, use the launcher directly.
   A missing host command is not proof that the project needs installation.
4. Work with the **installed version**, not this skill's source revision. Read its
   module README/usage and advertised completions before relying on capabilities.
   A verified `agent-session` invocation with no arguments prints usage (normally
   exit 64); do not invent an `as --version` interface. Adapt to supported commands.
   An unsupported feature is a reason to explain the limitation and, only if
   needed, request an upgrade—not to weaken a safety check.

If the project is not configured, offer adoption only when explicitly requested.
If a required launcher/binding cannot be verified, stop and explain the blocker.

## Select one workspace, then work there

Read-only questions do not require allocating a worktree. For repository changes
subject to a managed-worktree policy:

- If already in this task's recorded worktree, verify it with `as . status --json`
  and reuse it. A new agent process/conversation is not a new resource request.
- Otherwise prepare one isolated resource with `as <task-slug> create --json`.
  Use the returned `session.worktreePath` and `session.branch`; do not infer
  identity from a directory basename or a branch-name convention.
- Creation requires a clean primary checkout on its upstream default branch.
  If blocked, report and ask. Do not switch the user's primary branch, move their
  changes, relax guards or fabricate managed metadata to get around the refusal.
- `start`, `launch` and `resume` launch the configured agent. They are human entry
  points, not ways for an already-running agent to allocate a workspace. Use
  `create`, not a nested Pi launch.

Use absolute workspace paths for file tools. For commands, prefer:

```sh
as <task-slug> run <command> [args...]
as <task-slug> run sh -c 'first-command | second-command'
```

`run` already selects the worktree and enters its quiet devenv environment. Do
not add an outer `cd ... && devenv -q shell -- as ... run ...` wrapper. An explicit
working directory is still needed for commands not run through the launcher.
`as . run ...` is equivalent only from the verified current managed worktree.
Neither named `run` nor a `cd` inside one tool call relocates subsequent tool calls
or changes paths passed to read/edit/write tools.

`as <task-slug> cd` changes a sourced human shell; the executable `agent-session
<task-slug> cd` prints a path. Do not assume it moves the coding harness.

Only explicitly configured ignored local settings may be linked into new
worktrees. Never copy credentials, private Pi histories, `.pi/npm/`, runtime state
or generated agent configuration. Read local-link policy; do not invent links.

## Diagnose without repairing

Prefer `as <task-slug> doctor --json` (or verified `as . doctor --json`) and named
status over repository-wide status when one resource is relevant. On supporting
versions, `as list --json` is cheap recorded-binding inventory, not live Git state;
its branch is the recorded initial branch. Exact `status --worktree <path> --json`
can inspect a missing directory without entering it.

Treat absent, inconsistent and unknown evidence distinctly. Empty inventory or a
missing directory alone does not prove removal: bindings, native Git registration
and filesystem evidence must agree. Do not invent a slug for a saved path, repair
on lookup, silently prune registrations or turn an unrecorded binding into a
replacement session. Doctor findings are proposals for human review, not authority.
Metadata repair does not recreate local configuration links.

## Retire only by separate request

Preview from another worktree, inspect the exact paths, actual branches,
cleanliness/refusal reasons and branch-preservation behavior, then obtain approval
for applying that selection. Always preserve branches unless a separate explicit
request authorizes their deletion. Never use force as a fallback.

On versions with receipt-guarded single-session finish:

```sh
as <task-slug> finish --keep-branch --dry-run --json
# After reviewing the preview and obtaining approval:
as <task-slug> finish --keep-branch --expected <receipt> --yes
```

The receipt is `plan.receipt`; verify `plan.worktreePath`, `plan.currentBranch`,
`plan.keepBranch` and non-forced behavior. A preview is not cleanup authorization.
If the installed version lacks the required guard, offer an approved upgrade or
operator handoff rather than substituting an unguarded/forced effect.

On versions supporting inactive batches, supply an explicit inactivity window,
exclude retained/otherwise active work, and preview with `--dry-run --json`.
Batch receipts are top-level `receipt`, not `plan.receipt`. Apply with the same
window/exclusions, `--expected <receipt> --yes --json`, only after approval.
Age alone is not disposability; preserve live, dirty, ignored-data and unresolved
resources. Do not infer eligibility from a case/PR label or update consumer history.

Report each outcome honestly, including partial success and uncertainty. Reconcile
an interrupted operation through supported read-only evidence/provider replay;
do not repeat an uncertain destructive effect or erase metadata to manufacture
success. If evidence changed or remains inconsistent, stop and ask. Never remove
the invoking worktree or other sessions simply because the current task is done.
