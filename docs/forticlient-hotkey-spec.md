# Spec: FortiClient VPN hotkey

## Problem

Connecting to the configured Ireland VPN requires navigating FortiClient and
entering a password before MFA. One hotkey leaves only YubiKey/PIN approval when
needed and entering the MFA code followed by Enter.

## Context

Hammerspoon supplies macOS application hotkeys. FortiClient exposes an Electron
login form after enabling manual accessibility, and a separate native FortiTray
OTP dialog. The existing V binding opens VLC and is replaced by VPN.

## Decisions

- Cmd+Opt+Ctrl+V requests the configured Ireland profile through FortiClient.
- Password Store remains authoritative; the password is the entry's first line.
- MFA stays in FortiClient/FortiTray; Enter remains a user action.
- An existing Ireland connection is left alone. Any other active profile is
  preserved. An existing connection attempt is focused, never duplicated.
- Failure/cancellation stops automation, leaves native errors available, and
  never retries a login automatically or disconnects a VPN.

## Acceptance criteria

- From disconnected, the hotkey selects Ireland, retrieves its password, fills
  the identified secure password field and requests Connect exactly once.
- The native dialog labelled "Please enter OTP" receives focus in its unique
  enabled secure Code field. The user types their MFA code and presses Enter.
- A named Ireland connection and native Connected status, without a pending OTP
  prompt, establish success. Only then is success reported and the previous app
  restored, unless the user has deliberately switched elsewhere.
- Already connected, another active profile, repeated hotkeys, cancelled secret
  retrieval, rejected writes, uncertain actions, changed profile and timeouts
  cannot cause duplicate logins, false success, or automatic disconnection.

## Invariants

- Passwords and MFA codes never enter the clipboard, logs, alerts, command
  arguments, repository files, or global keyboard capture.
- The password is short-lived process memory, not a new cache. Lua/native strings
  cannot promise cryptographic zeroization. MFA field contents are never read.
- Password writes target a unique, enabled AXSecureTextField in the expected
  FortiClient application/profile. No coordinate or blind-keystroke fallback.
- GPG/PIN cancellation prevents Connect. Original non-secret process failures
  remain available in the controller's private in-memory diagnostics.
- Missing or ambiguous UI/state evidence fails closed. Bounded UI observation
  may stop without cancelling a native connection whose outcome is unknown.
- Linux, other hotkeys, VPN trust settings and company authentication policy
  are unchanged. No implicit certificate acceptance or password saving.

## Scope and verification

The macOS Hammerspoon module, its Nix wiring and synthetic Lua tests own this
change. Native mocked tests cover the state/authority boundaries and existing
hotkeys; flake checks validate wiring. A separate human rehearsal proves actual
password insertion, native MFA focus, Enter submission, connection verification
and focus return. Passing synthetic tests alone does not establish live success.
