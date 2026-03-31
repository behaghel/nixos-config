---
name: nixos-config-activation-safety
description: Follow this repository's activation safety rules when editing flake, NixOS, nix-darwin, or Home Manager config. Use when deciding whether to run `nix run`, `.#switch`, `.#boot`, `.#test`, `.#activate`, or any command that would apply configuration changes.
---

# Nixos-config Activation Safety

Use this skill whenever work touches activation, deployment, or other commands that would apply changes from this repository to a machine.

## Rules

- Never run `nix run`, `nix run .#switch`, `nix run .#boot`, `nix run .#test`, `nix run .#activate`, or `nix run .#rollback` unless the user explicitly asks in the current session.
- Never run `sudo` yourself. If validation or cleanup truly requires elevated privileges, tell the user the exact command to run.
- Prefer non-applying validation first: `nix flake check`, `nix fmt`, targeted parsing checks, and repository tests.
- Treat activation as a manual user step even after a code change is complete.
- If a fix depends on activation, finish the code and explain what the user should run afterward.

## Workflow

1. Confirm whether the task requires only code changes or also an apply step.
2. Do all safe repository work first: edit files, run non-applying checks, and summarize the expected effect.
3. If activation would be the next step, stop and hand the user the exact command instead of running it.
4. When a task mentions `nix run`, interpret that as a possible activation command and check the repo guidance before acting.

## Safe Commands

```bash
nix flake check
nix fmt
nix-instantiate --parse path/to/file.nix
```

## Handoff Pattern

- Good: "The config change is ready. Please run `nix run` yourself when you want to apply it."
- Bad: running `nix run` automatically after editing.
