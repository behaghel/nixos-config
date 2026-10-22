# Agent sessions for devenv

Project-scoped Git worktrees for concurrent coding agents. Includes `agent-session`,
its executable shorthand `as`, and dynamic Bash, Zsh, and Fish completions.

## Adopt in a project

Add to `devenv.yaml` (reuse an existing input for this repository if present):

```yaml
inputs:
  nixos-config:
    url: github:behaghel/nixos-config
    flake: false
imports:
  - nixos-config/modules/flake/agent-session
```

Enable in `devenv.nix`:

```nix
agentSession.enable = true;
```

Add `/.worktrees/` to `.gitignore`. Commit project setup before creating sessions:
creation requires a clean primary checkout on the upstream remote's default branch.
The remote tip is fetched for creation; `status` does not fetch unless requested.
The default agent is `pi`, which must be available in your environment.

```sh
as my-task create                   # prepare without launching a nested agent
as my-task start                    # prepare and launch Pi
as status                           # reconcile all sessions
as my-task status                   # inspect one session
as my-task launch                   # launch in an existing worktree
as my-task resume                   # launch with --continue
as my-task cd                       # change the current shell's directory
as my-task run bun test             # run devenv -q shell -- bun test there
as my-task finish --dry-run         # preview local cleanup
as my-task finish                   # guarded local cleanup, with confirmation
```

## Command grammar and migration

Both `as` and `agent-session` use `<slug> <command>` for session-scoped actions.
Repository-wide commands remain command-first: `as status`, `as doctor`,
`as finish --all|--gone`, and `as completion bash|zsh|fish`.

Command words are reserved in the first position so old command-first calls cannot
be mistaken for an action on a differently named session. To address an existing
session whose slug is a command word, put `--` before the slug:

```sh
as -- status create
as -- status cd
as -- status run bun test
```

The separator is valid for any slug. Legacy forms such as `as create my-task` and
`as status my-task` fail with migration hints before any Git mutation or execution.
Update scripts and their pinned input together; older pins keep their old grammar.
Session metadata, existing JSON schemas, and cleanup receipts are unchanged.
Creation supports both preview JSON and an actual creation receipt.

Session metadata remains in the shared Git directory at
`agent-session/sessions/`. Existing Herbert sessions need no data migration.
Cleanup preserves remote assets and refuses unsafe work unless explicitly forced.
Interactive cleanup uses Node-compatible confirmation for normal, forced and bulk
finish. Only `y` or `yes` (case-insensitive) confirms; empty input, EOF, or a failed
prompt cancels without cleanup. Non-terminal calls require explicit `--yes`.
`--yes` skips only confirmation, not ownership or cleanup safety checks.

## Current-session targeting

Inside a recorded managed worktree, including its nested directories, use the
explicit target `.` instead of repeating its slug:

```sh
as . status --json
as . cd
as . run bun test
as . resume
```

Resolution verifies the current Git worktree against its configured location,
persisted metadata, and shared Git registration. It does not infer identity from
the current branch name, fetch, allocate, or repair anything. The selected command
retains its normal behavior, and JSON output uses the canonical slug, never `.`.
Renaming the current branch does not change the session identity.

There is no implicit default target: `as status` still lists all sessions. `.` is
rejected from the primary checkout, unmanaged worktrees, and unrecorded or invalid
bindings. A nested Git repository is a separate context, not its outer session.
Use an explicit slug to inspect or repair missing metadata. Creation, `start`,
and `repair` require explicit slugs; `.` supports only `cd`, `run`, `launch`,
`resume`, `status`, `doctor`, and `finish`. The escape form `as -- . status` also works.

The existing invoking-worktree cleanup guard still rejects `as . finish`, even
with `--force` or `--dry-run`. Move to the primary checkout and finish by slug.
Bash, Zsh, and Fish offer `.` only for a valid current binding and filter its
action completions to existing-session commands.

## Retiring an unrecorded worktree

If a registered worktree has lost its session record, explicit forced cleanup can
retire it without inventing ownership metadata:

```sh
as my-task finish --force --dry-run
as my-task finish --force --dry-run --json
as my-task finish --force
```

This requires genuinely absent metadata and an existing, non-symlink worktree in
the configured Git-ignored slot, registered to the same repository. Locked
worktrees, the primary checkout, and the invoking worktree remain protected.
Malformed, mismatched, inaccessible or dangling records are not absence and
never enable this path. Use the explicit slug: `.` cannot identify an unrecorded
session.

**All branches are preserved**, regardless of whether `--keep-branch` was passed.
No branch ownership is inferred, no session record is created or removed, and no
remote is contacted. Force discards the worktree's uncommitted and ignored local
files; verify ownership, active use and needed local data before confirming.
Detached HEAD commits can become unreachable: create a branch first if needed.
After confirmation, the held operation lock protects revalidation of metadata
absence, canonical location, directory identity, Git registration, branch and
HEAD before removal. A changed target is refused rather than reinterpreted.

The JSON preview has `state: "unrecorded"`, effective `keepBranch: true`,
`allBranchesPreserved: true`, `ownedBranches: []`, `initialBranch: null`, and
`clean: null` (cleanliness is not assessed). It exposes the observed `head` and
`currentBranch` plus `uncommittedWorkWillBeDiscarded` and
`detachedHeadMayBecomeUnreachable`. Preview changes nothing and supplies no
recorded-session receipt. `--expected` remains restricted to non-forced,
branch-preserving recorded cleanup; no fallback weakens that contract.

This path is explicit-slug-only: `finish --all` and `finish --gone` still consider
recorded sessions exclusively, including when forced. Existing recorded-session
force behavior is unchanged. `repair` continues to restore only recognizable
original managed branches; for renamed/detached unrecorded slots it refuses to
invent history and instead prints the guarded preview/retirement commands.
Metadata repair does not recreate local configuration links.

## Read-only diagnostics

```sh
as doctor
as doctor --json
as my-task doctor --json
as . doctor --json
```

Doctor checks module configuration, ignored worktree-root policy, installed shell
and completion files, recorded bindings and registered managed slots, configured
local symlinks, and lifecycle locks. It also finds registered slots whose metadata
is missing after a branch rename. Named reports restrict binding/link checks to
that slug; repository/configuration/integration/lock checks remain project-wide.
An unresolved `.` reports a `current-target` error and skips binding/link checks
rather than guessing or falling back. Use a named or repository-wide report to
inspect a broken binding.

Doctor never fetches, probes remotes, executes agent/preparation commands, calls
credential helpers, acquires/removes locks, repairs state, or deletes files. Its
Git queries are limited to local topology and ignore policy; it does not run
`git status`, refresh the index, or invoke fsmonitor. It does not read local-link
file contents or print configuration commands, metadata values, remote URLs, or
raw parse errors. Optional absent local sources do not require links; existing
sources require matching, non-dangling symlinks in valid sessions.

JSON is one newline-terminated document with `version: 1`, `command: "doctor"`,
`ok`, and a `checks` array. Scoped reports contain `slug` unless the current
target could not be resolved.
Each check has `id`, `status` (`ok`, `info`, `warning`, or `error`), and `message`;
binding/link checks can include `slug` and a project-relative link `path`.
Binding errors can also include a safe `code` explaining the failure:

| Code | Meaning and next step |
|------|-----------------------|
| `metadata-missing` | Expected managed branch has no record; explicitly `repair` it after verifying ownership. |
| `metadata-missing-renamed` | Registered slot has no record and uses a renamed/detached branch; `repair` cannot recover it. Keep it intact or explicitly preview and retire it with `finish --force`, preserving all branches. |
| `metadata-invalid` | Record is unreadable, malformed or unsafe; inspect/restore it rather than overwriting it. |
| `metadata-path-mismatch` | Configured slot and record disagree; check for a moved worktree or changed configuration. |
| `worktree-missing` | Record exists but directory is absent; locate moved work and preserve branches before stale-record cleanup. |
| `git-binding-invalid` | Directory exists but Git registration or repository identity disagrees; inspect local registration. |
| `session-unknown` | Neither a record nor a registered configured slot exists for the requested slug. |

A healthy binding does not imply cleanup eligibility: doctor does not run the
freshness, publication or dirty-work checks required by `finish`.
Exit status is `0` with no errors (warnings are allowed), `1` for diagnostic
errors, and `64` for invalid CLI arguments. Valid diagnostic requests still
return JSON when configuration or repository context is missing.

Installed files cannot prove that the parent shell loaded its functions or
completions; the `shell-parent` informational check asks you to verify `type as`
there. Lock warnings report only stored owner information, not process liveness
or proven ownership. Neither a successful report nor a warning grants authority
to repair or remove anything. Use `status` for dirtiness, freshness, publication,
and branch-ownership diagnostics; doctor is not a replacement for cleanup guards.
There are no `--fix`, `--repair`, or `--refresh` options.

## JSON creation receipts

```sh
as my-task create --json
as my-task create --dry-run --json
```

Actual creation writes one newline-terminated JSON document to stdout:

| Field | Value |
|-------|-------|
| `version` | `1` |
| `command` | `"create"` |
| `dryRun` | `false` |
| `session` | The persisted session metadata |
| `session.slug` | The requested slug |
| `session.branch` | The initial `agent/<slug>` branch |
| `session.worktreePath` | The canonical absolute worktree path |

The receipt also retains the metadata's remote, default branch, creation time,
and preexisting branch snapshot. Consumers can use the returned binding without
parsing human output or discovering it through another status call. It describes
what was recorded at creation, not a fresh inspection of its current state.

Lifecycle progress is newline-delimited JSON on stderr. Successful Git and
preparation output is captured rather than streamed in JSON mode, so it cannot
corrupt stdout or progress records. Failed commands retain their diagnostic text
in failed-phase records and stderr diagnostics. A failed preparation emits no
creation receipt and rolls back only the worktree and branch created by that
attempt. Creation still prepares without launching the configured agent.

Preview output is unchanged: `dryRun` is `true`, and `plan` describes the proposed
creation without fetching or modifying Git. Human-readable creation and agent
startup output are unchanged. The entrypoint drains pending stdout/stderr writes
before exiting, including JSON responses larger than a pipe buffer.

## Reviewing a GitHub PR

```sh
as review-auth create --pr 123                  # ask before executing PR code
as review-auth create --pr https://github.com/owner/repo/pull/123
as review-auth create --pr 123 --trust-pr --json # explicit non-interactive trust
as review-auth create --pr 123 --dry-run --json  # offline, unresolved preview
```

This checks out the PR's source head, not its synthetic merge commit, and
prepares a managed worktree without launching an agent or pushing. The packaged
launcher includes `gh`; authenticate it with `gh auth login` before use.

Inspect the PR before granting trust: its environment configuration can execute
code. On a terminal, creation displays the PR URL and exact fetched head commit
and asks for confirmation before creating the checkout or running preparation.
Only `y` or `yes` (case-insensitive) confirms; no, empty input, EOF, or prompt
failure cancels. The operation lock remains held while waiting; creation
rechecks the local target after approval rather than populating a slot that
appeared during confirmation. Prompts go to stderr, including with `--json`;
stdout remains reserved for the creation receipt.

`--trust-pr` explicitly authorizes preparation and later execution in this PR
checkout without prompting. Non-terminal creation requires this flag. Trust is
recorded against the fetched head commit, not against future remote updates.

PR dry runs require no trust, GitHub lookup, remote query, checkout, preparation,
or session-record write. They use cached remote HEAD to check the primary
branch; missing cached information fails without an online fallback. The plan
contains `pr.number`, `pr.resolved: false`, `trustRequired: true`, and null values
for unverified PR URL/repository/base/head and the proposed branch/base. This
previews the request, not PR existence or checkout eligibility.

Selection accepts a positive PR number or an HTTPS `github.com` PR URL. Both
identify a PR targeting this checkout's configured upstream repository; repository
names are compared case-insensitively. A URL for another target repository is
refused without GitHub lookup or cloning. Numbers never select another project.
PRs may come from forks; checkout does not require push permission.

The PR must be open, non-draft, and target the default branch. Its local source
branch must not already exist or have saved configuration. If checked out
elsewhere, the error identifies that path. Separate-work mode, `start --pr`, and
reuse of an existing session are not available. Unsupported requests fail rather
than falling back to default-branch creation.

The new local branch tracks the PR's source branch for `git push`. For a fork,
creation reuses a matching configured remote without changing it, or adds
`as-pr-<slug>` pointing to the source repository over HTTPS. Conflicting remote
configuration or an existing ref namespace is preserved and refused. A failed
creation removes only a source remote created by that attempt. Successful
sessions retain their source remote after cleanup so preserved branches keep
working tracking; remote repositories and their branches are never deleted.

Conflicting push URLs, explicit remote push refspecs, mirror mode,
`push.default=matching`, and fetch mappings that would track another source branch
are refused rather than rewritten. Git transport rewrites and credentials remain
under the user's control. Creation verifies that the resolved PR head, fetched
PR ref, and fetched source branch agree before preparing the checkout.

Creation receipts and `status --json` expose a `pr` object containing `number`,
`url`, `repository`, `baseBranch`, `headBranch`, `headCommit`, `state`, `isDraft`,
`mode`, `trustedHeadCommit`, `sourceRepository`, and `sourceRemote`. Older records
without source fields remain readable. Status is offline by default; explicit
refresh and guarded cleanup fetch both the target and source remotes when they
differ. Freshness uses the target branch; publication uses the source upstream.
Normal cleanup protects unpushed review fixes and removes only session-owned
local assets; it never deletes the remote PR branch.

## Project settings

```nix
agentSession = {
  enable = true;
  worktreeRoot = ".worktrees";
  agentCommand = [ "pi" ];
  prepareCommand = [ ];
  localLinks = [ "devenv.local.nix" ".envrc.local" ];
};
```

Local links are explicit ignored paths, not automatic secret copying. Keep
project-specific links and preparation commands in the consuming project.

## Navigation and one-off commands

`as <slug> cd` changes the current shell's directory. It needs the shell function
shipped with the package: an executable cannot change its parent shell's directory.
Without that function, `as <slug> cd` reports how to enable it instead of pretending to navigate.
This repository's managed Bash, Zsh, and Fish configs load it at startup after
Home Manager activation. Bash devenv startup and Fish's vendor startup also load
it. In an already-running shell, or on another machine, initialize it explicitly:

```sh
# Bash or Zsh
source "$AGENT_SESSION_SHELL_ROOT/init.sh"
# Fish
source "$AGENT_SESSION_SHELL_ROOT/init.fish"
```

The `as` executable is retained for scripts and every other subcommand. Outside
an enabled project the function delegates unchanged to the executable on PATH,
including the system assembler. For scripts that need just a path,
`agent-session <slug> cd` prints the validated absolute worktree path.

`as <slug> run <command> [args...]` runs exactly one command inside that worktree
through `devenv -q shell --`. Arguments, empty arguments, stdout, stderr, and exit
status are preserved; the caller's directory is unchanged. Slugs and commands are
required, and command arguments are not evaluated as shell code. Use an explicit
shell for pipelines or shell operators:

```sh
as my-task run sh -c 'bun test && bun run lint'
```

Both commands work from any checkout in the same repository, including a dirty
primary checkout or worktree, without fetching or launching an agent. They reject
unknown sessions, missing worktrees, invalid metadata, and unregistered paths
without changing directories or running a command.

## Completions

Both command names have installed completions. The module exports
`AGENT_SESSION_COMPLETION_ROOT` and defaults `DIRENV_ZSH_COMPLETION_DIRS` to its
Zsh completion directory. Completion offers session names and global commands
first, session actions after the slug, and options after the action. After `run`,
it switches to command completion (command/file names in Bash, native command
completion in Zsh and Fish). This repository's managed post-direnv hook registers
these after `compinit`, preserves existing completions, and restores registrations
on project exit. Plain direnv cannot register completions in an already-running
Zsh without that shell integration.

Projects with their own completions override the directory list explicitly:

```nix
env.DIRENV_ZSH_COMPLETION_DIRS =
  "${config.env.AGENT_SESSION_COMPLETION_ROOT}/zsh/site-functions:${myCompletions}/share/zsh/site-functions";
```

Do not export `FPATH` through direnv: it replaces the running shell's `fpath`.
Manual loading is also available:

```sh
source <(agent-session completion bash)
agent-session completion fish | source
```

For manual Zsh setup, save `agent-session completion zsh` output as
`_agent_session` in a directory on `fpath`, then rerun `compinit`.

## Implementation layout

`cli.ts` remains the executable entrypoint for packaged and source-based consumers.
It dispatches to modules with explicit imports and no initialization side effects:

| Module | Responsibility |
|--------|----------------|
| `arguments.ts` | Argument parsing, command names, help, and diagnostics |
| `completion.ts` | Dynamic candidates and Bash/Zsh/Fish completion scripts |
| `sessions.ts` | Configuration, session records, locks, discovery, and path validation |
| `git.ts` | Git execution, repository roots, refs, and worktree registration |
| `github.ts` | GitHub PR resolution, source-head verification, and review push safeguards |
| `inspection.ts` | Local session state, branch ownership, and status reporting |
| `doctor.ts` | Read-only configuration, integration, binding, local-link, and lock diagnostics |
| `lifecycle.ts` | Creation, preparation, launch/resume, repair, and one-off execution |
| `finish.ts` | Cleanup previews, receipts, confirmations, and guarded removal |
| `runtime.ts` | Shared command errors, subprocess execution, and progress output |
| `types.ts` | Shared configuration, metadata, and status types |

The Nix wrapper packages this source directory as a unit so Node can resolve the
relative TypeScript imports in the Nix store. No bundler or npm dependencies are
required. The module dependency graph is acyclic; shared records and Git primitives
do not import command dispatch or lifecycle operations.

## Runtime and verification

The command uses Nix-provided Node.js 24's native TypeScript support, Git,
and the GitHub CLI (`gh`) for PR selection.
`run` also needs the `devenv` executable on PATH.
It needs no npm dependencies, install step, or Bun runtime. Bun remains only in
this repository's optional regression-test profile; the default shell does not
include it. Package cache availability still depends on the consumer's nixpkgs pin.

From this repository:

```sh
devenv -q --profile agent-session-tests build outputs.agent-session-tests
devenv -q --profile agent-session-tests shell -- bash tests/zsh-direnv-completion.sh
```

The regression tests run the CLI with Node against disposable local Git remotes.
They cover creation, resumption, recovery, cleanup guards, installed completions,
and default-on template wiring. The Nix check also runs outside a Git checkout.
