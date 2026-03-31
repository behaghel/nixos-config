---
name: darwin-launchd-debugging
description: Debug and maintain this repository's nix-darwin LaunchAgents, launchctl verification flow, and macOS keyboard remap behavior. Use when editing darwin modules, LaunchAgents, plist generation, or hidutil-based remapping.
---

# Darwin Launchd Debugging

Use this skill for macOS launchd work in this repository, especially GUI LaunchAgents, keyboard remaps, and activation-side verification.

## Rules

- In nix-darwin daemons, put command arguments under `serviceConfig.ProgramArguments`, not `programArguments`.
- Put `EnvironmentVariables` inside `serviceConfig`.
- Prefer the repository's LaunchAgent verification pattern over ad hoc `launchctl bootstrap` instructions.
- For Apple internal keyboards, prefer matching by `Product` with `Built-In = 1` rather than relying on vendor/product IDs.
- Avoid global `hidutil` writes when the config intends per-device mappings.

## Workflow

1. Read the relevant darwin module and confirm whether it creates LaunchAgents, activation checks, or keyboard remap scripts.
2. Preserve or extend `home.activation.verifyLaunchAgents` behavior when adding GUI agents.
3. For keyboard issues, check the device-matching strategy before changing key maps.
4. When a shortcut still fails, inspect both plist state and the macOS UI limitations before blaming the generated config.

## Diagnostics

```bash
launchctl print "gui/$(id -u)/<label>"
hidutil property --get 'UserKeyMapping'
hidutil property --matching '{ "Product": "Apple Internal Keyboard / Trackpad", "Built-In": 1 }' --get 'UserKeyMapping'
```

## Repository Anchors

- `AGENTS.md` sections: `Launchd Notes (darwin)`, `macOS Keyboard Remapping Notes`, and `LaunchAgent Verification Pattern`
- `modules/home/darwin-only.nix` for the verification activation step
