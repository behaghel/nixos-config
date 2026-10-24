# NixOS Configurations

This repository uses Nix flakes. Development environments and formatting are provided via `nix develop` and `treefmt` with the [Alejandra](https://github.com/kamadorueda/alejandra) formatter.

An `.editorconfig` file defines the coding style so that editors can enforce it while editing.

Git hooks are stored in the `githooks` directory. Point `core.hooksPath` to this folder to automatically format code after each commit:

```bash
git config core.hooksPath githooks
```

## Running checks

Use `nix flake check` to evaluate the defined system configurations and verify formatting.

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
