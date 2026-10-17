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
as create my-task                   # prepare without launching a nested agent
as start my-task                    # prepare and launch Pi
as status                          # reconcile worktrees and session records
as launch my-task                   # launch in an existing worktree
as resume my-task                   # launch with --continue
as cd my-task                       # change the current shell's directory
as run my-task bun test             # run devenv -q shell -- bun test there
as finish my-task --dry-run         # preview local cleanup
as finish my-task                   # guarded local cleanup, with confirmation
```

Session metadata remains in the shared Git directory at
`agent-session/sessions/`. Existing Herbert sessions need no data migration.
Cleanup preserves remote assets and refuses unsafe work unless explicitly forced.

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

`as cd <slug>` changes the current shell's directory. It needs the shell function
shipped with the package: an executable cannot change its parent shell's directory.
Without that function, `as cd` reports how to enable it instead of pretending to navigate.
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
`agent-session cd <slug>` prints the validated absolute worktree path.

`as run <slug> <command> [args...]` runs exactly one command inside that worktree
through `devenv -q shell --`. Arguments, empty arguments, stdout, stderr, and exit
status are preserved; the caller's directory is unchanged. Slugs and commands are
required, and command arguments are not evaluated as shell code. Use an explicit
shell for pipelines or shell operators:

```sh
as run my-task sh -c 'bun test && bun run lint'
```

Both commands work from any checkout in the same repository, including a dirty
primary checkout or worktree, without fetching or launching an agent. They reject
unknown sessions, missing worktrees, invalid metadata, and unregistered paths
without changing directories or running a command.

## Completions

Both command names have installed completions. The module exports
`AGENT_SESSION_COMPLETION_ROOT` and defaults `DIRENV_ZSH_COMPLETION_DIRS` to its
Zsh completion directory. `cd` and `run` complete session names; after the slug,
`run` switches to command completion (command/file names in Bash, native command
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
