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
Repository-wide commands remain command-first: `as status`,
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
`resume`, `status`, and `finish`. The escape form `as -- . status` also works.

The existing invoking-worktree cleanup guard still rejects `as . finish`, even
with `--force` or `--dry-run`. Move to the primary checkout and finish by slug.
Bash, Zsh, and Fish offer `.` only for a valid current binding and filter its
action completions to existing-session commands.

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
| `inspection.ts` | Local session state, branch ownership, and status reporting |
| `lifecycle.ts` | Creation, preparation, launch/resume, repair, and one-off execution |
| `finish.ts` | Cleanup previews, receipts, confirmations, and guarded removal |
| `runtime.ts` | Shared command errors, subprocess execution, and progress output |
| `types.ts` | Shared configuration, metadata, and status types |

The Nix wrapper packages this source directory as a unit so Node can resolve the
relative TypeScript imports in the Nix store. No bundler or npm dependencies are
required. The module dependency graph is acyclic; shared records and Git primitives
do not import command dispatch or lifecycle operations.

## Runtime and verification

The command uses Nix-provided Node.js 24's native TypeScript support and Git.
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
