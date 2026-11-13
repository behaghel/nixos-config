---
name: emacs-live
description: Inspect or repair an already running Emacs session through emacs_status and approval-gated emacs_eval. Use for live Elisp diagnostics, selective definition reloads, temporary runtime repairs, and checking whether tracked fixes will survive restart.
---

# Live Emacs workflow

Use the extension tools instead of manually constructing shell-quoted
`emacsclient --eval` commands. The bridge is not a sandbox: Elisp has the full
privileges of the connected Emacs process.

## Establish the target

1. Call `emacs_status` to inspect version, configuration directory, selected
   buffer, point, and modified/read-only state. This does not read text or secrets.
2. Use an explicit `socket` when multiple local servers exist. Do not probe
   arbitrary servers. Use an existing named `buffer` for buffer-local work;
   missing targets fail rather than being created.
3. If the client/server is unavailable, explain what is missing. Let the user
   start Emacs or run `M-x server-start`. Never silently launch another instance,
   change their startup files, restart Emacs, or bypass a denied evaluation via
   bash or another tool.

## Inspect narrowly, then fix tracked source

- Arbitrary expressions require confirmation unless the user enabled session
  approval with **Allow for this session** or `/emacs-ask never`. That allows any
  Elisp and survives resuming the same Pi session, not new or forked sessions.
  `/emacs-ask` reports the setting; `/emacs-ask always` revokes allowance.
  Never enable allowance yourself or label an expression read-only to bypass
  approval. Session allowance does not replace authorization for the task.
- Return only explicit, nonsensitive fields: selected model name, backend type,
  feature presence, function source location, flags, or cache-file permissions.
  Never print an entire backend object, token plist, credential cache, process
  environment, or auth/debug payload. Error messages can contain secrets too.
- A hostname, static model list, passing unit test, or configured preference is
  not proof of the account, billing route, provider support, or live behavior.
- Reproduce the fault with a failing test. Change the authoritative tracked
  module/package first; preserve consumer-owned models, accounts, credentials,
  document identity, and authored files. Do not hide permanent policy in private
  setup files or rely on a session-only repair.
- Prefer test stubs/disposable servers before live side effects. Live inference,
  publishing, authentication, network operations, and document edits require
  their own task authorization, not just an extension confirmation dialog.

## Selectively reload definitions

Read and test the source file first. Evaluate only the named definitions that
changed, plus required declarations/registration changes. Avoid reloading the
whole module or `init.el`: top-level package setup, hooks, network operations,
keymaps, and account defaults can have unrelated effects.

A single approved expression can reload one function:

```elisp
(progn
  (with-temp-buffer
    (insert-file-contents "/absolute/path/to/reviewed-file.el")
    (goto-char (point-min))
    (condition-case nil
        (while t
          (let ((form (read (current-buffer))))
            (when (and (eq (car-safe form) 'defun)
                       (eq (cadr form) 'my-feature-function))
              (eval form t))))
      (end-of-file nil)))
  (fboundp 'my-feature-function))
```

- Adapt the explicit name list; do not evaluate every top-level form.
- Include external `defvar` declarations where dynamic binding matters.
- Reloading a `defcustom` does not necessarily change an already-bound value.
  An explicit runtime value change is a separate, approved action; never infer
  permission to change a model/account from a changed source default.
- Hook/advice registration must be idempotent. Use named callbacks and verify
  there is only one registration; preserve unrelated advice and hooks.
- Default context preservation restores the selected frame's window layout and
  relevant buffer points where possible. It does not undo variable changes,
  buffer edits, saved files, external effects, or killed buffers/windows.
  Set `preserveContext: false` only when changing the visible context is intended
  and included in the approval.

## Verify and close the loop

1. Inspect the actual effective configuration, not just defaults or loaded files.
2. Check that the editing buffer/point, unsaved content, and activation state were
   preserved. Do not save or rewrite a real document merely to test a repair.
3. Ask the user to perform the smallest live acceptance action. Distinguish
   offline request/behavior tests from actual provider or interactive success.
4. Make accepted behavior restart-safe: track the setting, pin compatible
   dependencies, and account for stale compiled libraries/build caches.
   Updating a lockfile alone does not necessarily update an existing checkout.
5. Report separately: tested source, loaded runtime patch, deployment/merge state,
   manual acceptance, and any remaining restart/rebuild step. Never call a
   temporary hot patch a permanently installed fix.

## Failures, cancellation, and bounded results

The client waits at most the requested deadline and does not automatically retry.
A timeout, abort, overflow, malformed response, or transport failure is ambiguous:
Emacs may have executed the expression already or may still be executing it.
Killing the client is not server-side cancellation. An Elisp error can also occur
**after mutations**. Do not promise rollback, undo, or safe replay.

After an ambiguous result, inspect the relevant state with a new narrowly scoped
operation before proposing another mutation. After rejection, wait for new human
instructions. Do not evade confirmation with another execution path.

Results are bounded to 4,096 printed characters, 32 list elements, and six levels.
Truncated output is not a complete value; refine the query instead of dumping a
larger object. Do not create full-output files containing potentially sensitive
results. Approved arguments/results can be retained in Pi's session history.
