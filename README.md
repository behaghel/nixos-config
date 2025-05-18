# NixOS Configurations

This repository uses Nix flakes. Development environments and formatting are provided via `nix develop` and `treefmt`.

## Running checks

Use `nix flake check` to evaluate system configurations (e.g., `linux-builder`) and ensure formatting is correct. The same checks run automatically for pull requests via GitHub Actions.
