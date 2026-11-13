# Emacs for Pi

Live control of an **already running local Emacs server**. This package supplies
`emacs_status`, `emacs_eval`, and the `emacs-live` skill. It does not manage your
Emacs configuration, authentication, packages, or Pi installation.

## Contract

- `emacs_status` returns predefined session and buffer metadata, never buffer
  contents, variable values, backend records, tokens, or environment variables.
- `emacs_eval` asks for human approval by default: **Deny**, **Allow once**, or
  **Allow for this session**. Session approval permits **any Elisp**, not just
  the displayed expression, with full Emacs privileges. It survives resuming
  that same Pi session and reloading the extension; new and forked/cloned
  sessions ask again. No confirmation UI means no execution, even with saved
  approval. There is no model-asserted approval flag or read-only exemption.
- Target buffers must already exist. A socket name/path can explicitly select
  another local server; otherwise Emacs's normal local socket selection applies.
- The bridge invokes `emacsclient` without a shell and disables alternate-editor
  fallback. It never starts/restarts Emacs, creates a frame, or retries a call.
- Evaluation preserves the selected frame's window configuration and relevant
  buffer points by default. `preserveContext: false` explicitly opts out.
  This is best-effort context restoration, **not rollback**: buffer contents,
  definitions, variables, external effects, and destroyed resources are not undone.
- Client waiting and output are bounded. Timeout, cancellation, output overflow,
  or an unconfirmed transport response means execution may have happened or may
  still be running in Emacs. Killing the client does not cancel server-side Elisp.
  Never automatically retry such an operation.
- Lisp errors report the error symbol, not potentially sensitive error data.
  Arbitrary evaluation results are intentionally returned to Pi. Review the code
  before approving or enabling session approval: arguments/results can appear
  in session history. Never
  return credentials, full authentication records, or entire backend objects.
- No background processes, automatic probes, persistent logs, or credential
  stores are created by the extension. The approval preference is stored as a
  custom entry in Pi's existing session history, bound to that session's ID.

## Use

Requires `emacsclient` on PATH and a local Emacs server (`M-x server-start`).
Starting the server is a user action, not an extension fallback.

Select the package through Pi, not a Nix-generated resource link:

```sh
pi install /absolute/path/to/nixos-config/marketplace/plugins/emacs
```

For a one-invocation trial without changing resource selection:

```sh
pi -e /absolute/path/to/nixos-config/marketplace/plugins/emacs/pi/extension.ts
```

Then ask Pi to inspect Emacs or evaluate a small expression. Raw evaluation
shows the exact server, buffer, context policy, and expression for approval
unless you have enabled session approval. A denied/aborted approval never invokes
the client or enables session approval. Print/JSON modes can inspect metadata
but cannot evaluate; TUI or an approval-capable RPC host is required.

Control the current Pi session's approval preference directly:

- `/emacs-ask`: show the current setting.
- `/emacs-ask always`: ask before every evaluation (default); revoke allowance.
- `/emacs-ask never`: allow any Elisp in this session, including after resume;
  equivalent to choosing **Allow for this session** in the approval prompt.

While allowance is active, the footer shows `Emacs ask: never`. This preference
is session-wide: navigating `/tree` does not undo a grant or revocation. It does
not grant task authorization for unrelated edits, network calls, or other effects.

Examples:

- Inspect: `emacs_status {}`.
- Inspect a named buffer: `emacs_status {"buffer":"notes.org"}`.
- Evaluate: `emacs_eval {"expression":"(+ 1 2)"}` and approve the dialog.
- Reload only selected definitions using the recipe in the companion skill,
  rather than evaluating `init.el` or reloading unrelated modules.

The default client timeout is 5 seconds (configurable per call, up to 30 seconds).
Printed values are bounded to 4,096 characters, 32 list elements, and six nested
levels. Transport capture is capped at 64 KiB. The `truncated` flag reports the
character limit; Lisp's structural print limits can also abbreviate a value with
ellipsis/level markers. Complete unbounded output is not written to a temporary
file.

## Development and acceptance

```sh
node --test marketplace/plugins/emacs/test/*.test.mjs
```

Run inside the repository's devenv/managed session. Tests use fake transports and
approval UIs plus an isolated temporary Emacs server. They do not connect to your
personal server or use accounts/network services. The marketplace flake check
runs the same behavioral suite with declared Node and Emacs dependencies.

Manual acceptance: load the extension, inspect an existing server, deny an eval
and observe no change, approve a harmless variable change in a scratch buffer,
then selectively reload a test definition without losing editing context.
Choose **Allow for this session**, evaluate a different harmless expression with
no prompt, and resume the same session to verify allowance persists. Check the
footer indicator and `/emacs-ask`; use `/emacs-ask always` to restore prompts.
New and forked/cloned sessions must ask again. Missing-server checks must fail
without starting Emacs.
