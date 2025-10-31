# NixOS Configurations

This repository uses Nix flakes. Development environments and formatting are provided via `nix develop` and `treefmt` with the [Alejandra](https://github.com/kamadorueda/alejandra) formatter.

An `.editorconfig` file defines the coding style so that editors can enforce it while editing.

Git hooks are stored in the `githooks` directory. Point `core.hooksPath` to this folder to automatically format code after each commit:

```bash
git config core.hooksPath githooks
```

## Running checks

Use `nix flake check` to evaluate the defined system configurations and verify formatting.

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
