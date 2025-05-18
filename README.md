# NixOS Configurations

This repository uses Nix flakes. Development environments and formatting are provided via `nix develop` and `treefmt` with the [Alejandra](https://github.com/kamadorueda/alejandra) formatter.

An `.editorconfig` file defines the coding style so that editors can enforce it while editing.

Git hooks are stored in the `githooks` directory. Point `core.hooksPath` to this folder to automatically format code after each commit:

```bash
git config core.hooksPath githooks
```

## Running checks

Use `nix flake check` to evaluate the defined system configurations and verify formatting.
