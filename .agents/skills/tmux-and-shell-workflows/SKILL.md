---
name: tmux-and-shell-workflows
description: Maintain this repository's tmux, workon, and OpenCode shell workflow safely. Use when editing tmux bindings, scrolling/copy-mode behavior, assistant launcher scripts, or session notification hooks.
---

# Tmux And Shell Workflows

Use this skill when changing `modules/home/tmux/` or the shell scripts that launch and notify assistant sessions.

## Rules

- Preserve the current tmux prefix (`C-a`) and copy-mode-first scrolling workflow unless the user explicitly asks for a change.
- Do not re-enable `focus-events` casually; in this repository it caused raw values to print on mouse movement and broke scroll behavior.
- Keep `workon` compatible with project discovery via `.workon-assistant` and `.workonrc`.
- Preserve the completion notification flow: `workon-assistant` wraps the assistant command, and `agent-notify` mirrors notifications into tmux when possible.
- When changing scrollback behavior, verify both mouse scrolling and copy-mode navigation.

## Workflow

1. Read `modules/home/tmux/default.nix` and any helper scripts it installs before changing bindings.
2. Check whether the change affects tmux keybindings, assistant launch behavior, or notification behavior.
3. Keep shell snippets POSIX-friendly unless the file already requires a stricter shell.
4. Validate tmux config syntax or surrounding Nix syntax after edits, then explain how the user can reload tmux manually.

## Repository Anchors

- Scrollback uses tmux copy mode from `modules/home/tmux/default.nix`.
- `workon` defaults to `opencode` and can wrap commands with `workon-assistant`.
- Notification helpers are installed from the tmux module, not a separate shell module.

## Manual Verification

- Enter copy mode with `prefix + ,` or `Alt-.`.
- Confirm mouse wheel scrolling works in tmux.
- Confirm `workon` still opens the expected panes and starts the assistant command.
