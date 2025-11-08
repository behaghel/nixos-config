Darwin Modules

Keyboard Shortcuts: Manual Tick Required (macOS)
- macOS stores keyboard shortcuts in `com.apple.symbolichotkeys` and reflects them in System Settings → Keyboard → Keyboard Shortcuts.
- We configure AppleSymbolicHotKeys declaratively (IDs, enabled flags, parameters), but certain toggles still need to be ticked once in the UI for macOS to honor them (notably Spotlight on recent macOS).

After activation, please verify in System Settings:
- Spotlight → “Show Spotlight Search” is ON (⌘ Space).
- Mission Control → “Move left/right a space” are ON.
- Mission Control → “Switch to Desktop N” are ON for the Desktops you actually have (Desktop 2..N only exist if you created them in Mission Control).

If a shortcut still won’t fire:
- Check conflicts: Siri “Press and hold Command Space”, Input Sources shortcuts (60/61), or third‑party launchers (Raycast/Alfred).
- A quick nudge often helps: `killall cfprefsd Dock SystemUIServer`.

