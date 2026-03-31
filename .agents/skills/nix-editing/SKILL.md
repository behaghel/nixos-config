---
name: nix-editing
description: Follow this repository's Nix editing and embedded shell rules. Use when changing `.nix` files, shell snippets embedded in Nix strings, jq or awk fragments, attribute merges, or Home Manager module wiring.
---

# Nix Editing

Use this skill for `.nix` files in this repository.

For `devenv.nix`, `devenv.yaml`, or `.envrc` work, also load `devenv-project-workflow` if it is available in the environment.

## Rules

- Escape shell `${...}` inside Nix strings as `''${...}` unless the interpolation is meant for Nix itself.
- Prefer plain shell variables like `$TMP_PLIST` when braces are unnecessary.
- Do not use `//` as a comment marker. In Nix, `//` merges attribute sets; use `#` for comments.
- Prefer `lib.optionalAttrs` and `lib.optionalString` for conditional structure.
- Be careful with bash arrays inside Nix strings; they often need escaping or simplification.
- When passing shell values into `jq`, use `jq --arg` rather than assuming shell vars are visible inside the jq program.

## Workflow

1. Identify whether `${...}` in the file is intended for Nix evaluation or the runtime shell.
2. Simplify embedded shell when possible before adding more escaping.
3. Keep modules small, composable, and consistent with the existing repository structure.
4. Run `nix fmt` or a targeted parse/eval check after edits.

## Repository Anchors

- `AGENTS.md` sections: `Nix String Interpolation Tips`, `Nix Syntax Learnings`, and `Shell Scripting Notes`
- `modules/home/` and `modules/darwin/` follow small composable module patterns

## Safe Checks

```bash
nix fmt
nix-instantiate --parse path/to/file.nix
```
