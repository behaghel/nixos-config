---
description: Diagnose and fix devenv environment issues
argument-hint: [error message or symptom description]
allowed-tools: [Read, Glob, Grep, Bash]
---

# Diagnose Devenv Issues

Systematic troubleshooting for devenv environment problems.

## Instructions

### Step 1: Gather context

1. Read `devenv.nix`, `devenv.yaml`, and `.envrc`.
2. If the user provided an error message, identify the error class:
   - **Evaluation error** — Nix syntax or module error in devenv.nix
   - **Missing tool** — command not found inside devenv shell
   - **Service failure** — service won't start or connect
   - **Process failure** — process crashes or won't reach ready state
   - **Lock/input error** — stale lock, missing input, fetch failure
   - **Sandbox artifact** — `dynamic_store.rs` panic, daemon socket error
   - **direnv error** — blocked, stale, or missing .envrc

### Step 2: Apply diagnostic ladder

Work through these in order. Stop at the first fix that resolves the issue.

**2a. Syntax check**
```bash
nix-instantiate --parse devenv.nix
```
If this fails, the error is in Nix syntax. Fix it.

**2b. Function args**
Verify devenv.nix starts with `{ pkgs, lib, config, inputs, ... }:`. Missing `inputs` breaks flakes evaluation.

**2c. Language/package availability**
If a tool is missing, check:
- Is the language block enabled? (`languages.<name>.enable = true`)
- Is the tool in `packages`?
- Use `devenv -q search <tool>` to find the correct package name.

**2d. Service configuration**
If a service won't start:
- Is it enabled? (`services.<name>.enable = true`)
- Check port conflicts: `lsof -i :<port>`
- Check logs: services log to the process manager output
- Try `devenv up` manually to see the error interactively

**2e. Input/lock freshness**
```bash
devenv -q update
```
Then retry. Stale locks cause evaluation failures when upstream changes.

**2f. Sandbox detection**
If the error mentions `dynamic_store.rs`, Nix daemon sockets, or `Operation not permitted`:
```bash
devenv -q shell -- true
```
If this succeeds on the host, the error is sandbox-induced — not a config bug.

**2g. direnv state**
```bash
direnv status
```
If blocked: `direnv allow`. If stale: the `.envrc` or devenv.nix changed and direnv needs to reload.

**2h. SecretSpec / GPG / YubiKey prompts**
If `devenv shell` hangs waiting for SecretSpec-backed GPG or YubiKey access, bypass SecretSpec temporarily to isolate whether the shell startup problem is secret-related:

```bash
devenv -q shell --secretspec-provider "env://BYPASS" -- <cmd>
```

Or set `SECRETSPEC_PROVIDER=env://BYPASS` before retrying the command. This is a diagnostic bypass for commands that do not actually need the secret values.

**2i. macOS XeLaTeX font resolution**
If Nix-provided `xelatex` cannot find macOS fonts that are visibly installed:

- Add `env.OSFONTDIR = "/Library/Fonts:$HOME/Library/Fonts:/System/Library/Fonts";` to `devenv.nix`
- Re-enter the shell and retry the export
- If the document uses `\newfontface` with an already-bold face, remove any extra `\bfseries` that would force fontspec to look for a non-existent b-variant

### Step 3: Report findings

Present:
1. **Root cause** — what went wrong and why
2. **Fix applied** — what you changed (or what the user needs to do)
3. **Verification** — how to confirm the fix worked

## Rules

- Fix the root cause, not the symptom.
- Make the smallest viable change.
- Do not delete services or processes while troubleshooting unless they are the cause.
- When an agent runs `devenv` non-interactively, prefer `-q` / `--quiet` unless the user explicitly asked for verbose output.
- If you cannot determine the cause after the diagnostic ladder, say so and suggest checking `devenv` GitHub issues or the devenv Discord.
