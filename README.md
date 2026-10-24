# NixOS Configurations

This repository uses Nix flakes. Development environments and formatting are provided via `nix develop` and `treefmt` with the [Alejandra](https://github.com/kamadorueda/alejandra) formatter.

An `.editorconfig` file defines the coding style so that editors can enforce it while editing.

Git hooks are stored in the `githooks` directory. Point `core.hooksPath` to this folder to automatically format code after each commit:

```bash
git config core.hooksPath githooks
```

## Running checks

Use `nix flake check` to evaluate the flake and build/run checks for the current
system. `--no-build` evaluates without running checks; combine it with
`--all-systems` to evaluate the other declared systems without cross-building.

The source-discovery regression is `as . run python3 tests/test-flake-source-root.py`.
It exercises the actual flake entrypoint against fresh sources, without fetching
project inputs or relying on previously realised source copies.

## Pi and managed worktrees

This repository enables its local [agent-session module](modules/flake/agent-session/README.md)
in `devenv.nix`, with `pi` as the agent and `.worktrees/` as the ignored workspace
root. Enter `devenv shell` to make `as` and its shell integration available; no
system activation is required. Pi must already be available on your PATH.

Human operators can launch Pi in a new managed worktree:

```sh
devenv shell
as my-task start
```

An existing Pi session must prepare without launching another agent:

```sh
devenv -q shell -- as my-task create --json
```

Use the returned `session.worktreePath` for all subsequent edits and command
working directories. Existing managed tasks use `as . status --json`,
`as . run <command>`, and `as . doctor --json` from their worktree, including nested
directories. A shell `cd` does not move an already-running Pi process or change
future tool-call directories. Pi automatically loads [AGENTS.md](AGENTS.md), which
contains the coding-agent workflow; no custom Pi extension or generated
Claude/OpenCode configuration is required.

Creation requires the primary checkout to be clean and on its upstream default
branch. A feature branch or someone else's dirty work is a blocker to report,
not permission to switch their checkout or bypass the tool's guards. After
merging this setup, use an updated checkout and a new Pi session (or reload its
instructions) to pick up the workflow.

Only existing `.envrc.local`, `devenv.local.nix`, `devenv.local.yaml`, and
`.workon-assistant` are linked into newly created worktrees. They are ignored by
Git; no contents are copied or committed. Existing worktrees are not changed.
Doctor may identify missing links in older worktrees; metadata `repair` does not
restore links, and existing files must never be overwritten blindly. Worktrees
separate Git work, not operating-system permissions or credential access.

### Restricted Pi mode (experimental, macOS)

The opt-in `agent-sandbox` devenv profile wraps the existing Pi npm runtime
with revision-pinned [agent-sandbox.nix](https://github.com/archie-judd/agent-sandbox.nix).
Normal `as` commands and the host Nix configuration are unchanged. The wrapper
requires Pi at `~/.local/share/pi-npm` and a prepared linked worktree; it refuses
a primary checkout or a launch from a worktree subdirectory.

From a host terminal, launch it in an existing managed worktree:

```sh
as my-task run devenv -q --profile agent-sandbox shell -- pi-sandboxed
```

The inner devenv command provisions the opt-in profile on the host **before**
entering the sandbox. Inside, use the supplied tools directly: Python, Node,
Git and basic CLI tools. Nix/devenv, MCP, discovered extensions/skills/context,
Git signing and publication stay outside this mode. No host credential variables
or global Git configuration are forwarded; commit signing remains required.
Pi management subcommands are refused, except `auth check`.
Review changes, commit, sign and push from the host with normal `as` commands.

State is separate at `~/.local/state/pi-sandbox/agent`, initially empty. No
credentials, settings, extensions or histories are copied from normal Pi.
To authenticate, start ordinary Pi on the host with this dedicated state:

```sh
PI_CODING_AGENT_DIR="$HOME/.local/state/pi-sandbox/agent" \
  pi --no-approve --no-extensions --no-mcp --no-context-files \
     --no-skills --no-prompt-templates --no-themes
```

Use `/login`, then exit; return to `pi-sandboxed` for actual work. Dedicated
credentials are visible to the sandboxed agent and must be treated accordingly.
Your ordinary Pi runtime is read-only inside; updating that runtime remains a
separate host operation. This mode does not pin or replace the Pi installation.

The sandbox permits worktree edits and dedicated state writes while hiding
unrelated home files. Internet access is **unrestricted**; host-local ports and
UNIX sockets (including the Nix daemon) are denied. Shared Git history and much
of its metadata remain accessible, so this is not isolation between branches
or a guarantee that other agents' Git work cannot be affected. Protected Git
configuration/hooks are read-only. macOS uses deprecated `sandbox-exec`, not a
VM; do not treat the pilot as an absolute security boundary.

Run the real boundary checks from a linked worktree; the test uses a disposable
fixture, does not call a model, and never invokes your signing key:

```sh
as . run devenv -q --profile agent-sandbox shell -- python3 tests/test-agent-sandbox.py -v
```

Each boundary run prints individual outcomes and retains a mode-0600 JSON report
in `.devenv/state/sandbox-evidence/` (ignored, never committed). It records the
original absolute host paths, the sandbox's synthetic HOME, actual errno values,
and successful host controls before and after the sandbox attempt. An unavailable
host control fails the test; `ENOENT` is labelled `not_visible`, not a permission
denial. Reports also identify the probe executable and hash of the test source.
Normal Pi state is tested by listing its original host directory, not by reading
credential contents; directory entries are not recorded. The Nix positive control
opens and closes a daemon socket connection without sending requests.

These are specific boundary probes using the same confinement policy as Pi,
not model-driven Pi turns or proof against every escape/exfiltration route.

### Nix discovery in Pi

The project-local `.pi/mcp.json` connects current Pi's native MCP support to a
revision-pinned [MCP-NixOS](https://github.com/utensils/mcp-nixos) server. It runs
through `nix shell`, needs no API credentials, and provides package/option
lookups and read-only flake source inspection, not configuration activation.
The first connection may take longer while Nix builds the server. Pi's project
trust controls loading this configuration; it does not install a global server.
Run Pi from the worktree root so it discovers the project configuration.

Check connectivity with `as . run pi mcp list`; inside Pi, use `/mcp` to inspect
or disable the server. Run `/reload` after changing the configuration, or start
a fresh session. `pi --no-mcp` disables MCP for one launch.

Online documentation describes its own release/channel, not necessarily this
project's locked dependencies. Inspect pinned flake sources and evaluate the
local package/option before asserting availability. Source inspection can
establish a declaration; it cannot prove a successful build or runtime result.
The server exposes read-only query operations but is not a security sandbox;
local Nix discovery can fetch inputs and populate caches/the Nix store, and
online searches send query text to upstream services. Keep secrets out of queries.

Run the checks from the worktree root:

```sh
as . run python3 tests/test-pi-mcp.py
# Opt in to real server, online search, and pinned-source checks:
as . run env MCP_NIXOS_LIVE=1 python3 tests/test-pi-mcp.py
```

### Clickable file references in Pi

With `hub.pi.enable`, Pi and `pi-local` make existing inline-code file paths
and relative Markdown links in assistant responses clickable. The visible path
stays relative; its hyperlink targets an absolute `file://` URL. Paths resolve
from the Git worktree root, even when Pi starts in a subdirectory. Outside Git,
the window's `workon` root takes precedence over Pi's starting directory.
Code blocks, images, web links, user messages, and stored history are unchanged.
This requires a current Pi with `registerMarkdownTransformer` support.

On macOS in Ghostty/tmux, Cmd+Shift+click opens Markdown files through the
existing Emacs association. After manually activating the configuration, reload
tmux with prefix + r, detach/reattach the Ghostty client to refresh terminal
capabilities, and restart Pi or run `/reload`. To smoke-test, start Pi from a
repository subdirectory and ask it to mention `AGENTS.md` in inline code;
Cmd+Shift+click should open the file at that worktree's root in Emacs.

The regression suite is `nix build .#checks.aarch64-darwin.pi-relative-paths`
(use the appropriate system name on other platforms).

## Agent Skills

- Repo-local agent skills live under `.agents/skills/`.
- Use `npx skills ...` to add or update shared skills; Home Manager installs `nodejs`, which provides `npx`.
- Reuse the existing global `devenv-project-workflow` skill for `devenv.nix` and `.envrc` work instead of copying it into `.agents/skills/`.

## Prerequisite: Install Nix

This repository assumes Nix (or Lix) is available before you run any of the `nix run` or `nix develop` commands. For nix-darwin hosts we recommend the [Lix installer](https://lix.systems/install/), which provides a compatible multi-user setup:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://install.lix.systems/lix | sh -s -- install
```

If you previously installed Determinate Nix, remove it first:

```bash
sudo /Library/determinate/uninstaller
```

After installing Lix, restart your shell and verify with `nix --version`.

## Adding NixOS Host Configurations

To add a new NixOS host configuration to this repository:

1. **Customize your configuration**: Edit `./modules/nixos/*.nix` files to customize your NixOS configuration modules.

2. **Import existing configuration**: If you have an existing NixOS configuration, import it by running:
   ```bash
   mv /etc/nixos/*.nix ./configurations/nixos/HOSTNAME/
   ```
   Replace `HOSTNAME` with your actual hostname.

3. **Apply the configuration**: Run the following command to apply your configuration:
   ```bash
   nix --extra-experimental-features "nix-command flakes" run
   ```

## Workflow

This repository follows the [nixos-unified](https://nixos-unified.org/#why) conventions. nixos-unified exposes several `nix run` commands to manage the configuration throughout its life cycle.

### Hardware tokens
- [YubiKey setup notes](docs/yubikey.md) – ties the upstream drduh guide into this repo’s GnuPG/SSH configuration.

### Activate
Run `nix run .#activate` once on a new machine to set up links and defaults.

### Apply changes
After editing the configuration, build and switch to it with `nix run .#switch`. Use `.#boot`, `.#test`, or `.#build` for the corresponding `nixos-rebuild` actions.

### Roll back
If needed, revert to the previous generation via `nix run .#rollback`.

### Update sources
Refresh flake inputs by executing `nix run .#update`.
