# YubiKey touch notifications

On macOS, `hub.yknotify.enable` watches heuristic OpenPGP touch events
and sends notifications through `hub-notify`. Delivery respects macOS Focus
and notification settings. A notification is not an authorization prompt.

## False FIDO2 alerts after idle or wake

FIDO2 notifications are **disabled by default**. The upstream detector treats
USB HID client `startQueue`/`stopQueue` messages as a touch-request lifecycle.
These messages neither identify a YubiKey nor prove a user-presence request.
A queue left open after unlock or wake can cause endless tap reminders;
restarting the detector does not make that heuristic reliable.

The default log predicate now includes only CryptoTokenKit events, excluding
HID activity before it reaches diagnostics or notification throttling.
OpenPGP detection remains unchanged and is still heuristic, not proof of touch.
Actual FIDO2 requests (browser security keys, passkeys, etc.) no longer produce
these notifications; use the requesting application's prompt and key LED.
To restore the noisy experimental behavior, explicitly set
`hub.yknotify.fido2.enable = true`.

After manual activation, lock/unlock and sleep/wake with the key connected.
Expect no FIDO2 reminders. Then verify an OpenPGP signing notification using
the acceptance test below.

## Git signing context

When enabled, the module defaults Git's `gpg.openpgp.program` to a wrapper
around `programs.gpg.package`. While that wrapper is signing, OpenPGP touch
notifications include:

- One request: **Git signing pending — touch requester unverified**.
- More than one: **Multiple Git signing requests pending — touch requester
  unverified**.
- No tracked request, unavailable context, or FIDO2: **Requester unknown**.

This is correlation, not attribution. An unrelated operation can own the
current touch even when a Git signature is pending. The wrapper does not
identify signed content, a repository, SSH destination, or browser origin.
It does not prevent an operation from proceeding or require an extra approval.

The wrapper preserves GPG's arguments, standard streams, and exit status;
it forwards termination signals and removes context on completion/failure.
Context failures do not prevent signing. Empty, private marker files under
`~/Library/Caches/yknotify-requests` are locked while wrappers are alive.
After a forcibly killed wrapper, a leftover unlocked marker does not count.
No command arguments, signatures, plaintext, PINs, or key IDs are stored.
The markers are same-user advisory hints, not tamper-proof evidence.

Git config overrides (including a different `gpg.openpgp.program`), explicit
GPG invocations, SSH signing, and SSH-agent authentication are not tracked.
Verification and other non-signing GPG calls do not create context. The
OpenPGP touch-detection and reminder heuristics are unchanged.

## Opt-in diagnostic journal

Set `hub.yknotify.diagnostics.enable = true` to investigate uncovered requests.
It defaults to false and is enabled specifically for `F2400216`. Changes take
effect after manual activation; disabling it stops new records but retains
existing logs.

Private JSONL files live in `~/Library/Logs/yknotify-diagnostics/`:
`events.jsonl` and one backup, `events.jsonl.1`. Each is capped at 1 MiB;
the directory is mode 0700 and files are mode 0600. Nothing is uploaded.

- `git_request_start` / `git_request_end` share an opaque request ID. They
  record instrumented signing context, wrapper PID, duration and exit code.
  A negative exit code records termination by that signal. SIGKILL or a crash
  can leave a start without an end; live context still comes from marker locks.
- `touch_snapshot` records detection time, sampling reason, pending Git
  request IDs, candidate process names/PIDs/parent chains, and GPG-agent Unix
  socket FD labels/numeric endpoint identifiers. Candidates and ancestors
  are explicitly labeled; none proves touch ownership. Open socket FDs are
  not proof that a client is connected or making a request.
- `git_context_unavailable` reports an instrumentation failure, without raw
  error text. Missing/prohibited probes are marked unavailable in snapshots.

The observer samples the first event of each OpenPGP/FIDO2 burst independently
(after more than `sessionTimeoutSeconds` of silence) and at most once per
minute during a continuous burst. It samples even when Git signing is pending,
so overlapping uncovered requests can be investigated. These are heuristic
log events, not confirmed physical touches. Banner throttling and DND do not
suppress diagnostics.

Probes run in a bounded background queue, each command has a one-second
timeout, and the observer forwards detector events without waiting for probes.
At EOF it waits at most three seconds for diagnostics. Busy queues, writer-lock
contention, oversized records and other failures can drop diagnostic records;
logging is best effort and does not require successful notification delivery.
Snapshots cover up to 64 relevant current-user processes/ancestors and 32
agent socket FDs. Short-lived clients can be missed. Shell script names may
appear only as their interpreter. Browser origins and SSH destinations are
not recovered.

No command arguments, executable paths, repository/file paths, destinations,
plaintext, PINs, signatures, key IDs, or raw protocol/log payloads are stored.
Even limited process names and timestamps reveal activity: review records
before sharing them. The journal is advisory same-user evidence, not an audit
trail resistant to tampering.

After activation, run a normal Git signing operation, then inspect:

```sh
tail -n 20 ~/Library/Logs/yknotify-diagnostics/events.jsonl | jq .
```

Expect correlated Git start/end records. Leave the key flashing briefly to
allow a snapshot; inspect snapshots around unexplained requests as well as
those with Git pending. Keep the original process evidence labeled as
candidates when deciding which integration to instrument next.

## Verification

Automated tests use a fake GPG executable and isolated Git configuration;
they never access the real agent or key:

`devenv -q shell -- as . run python3 tests/test-yknotify-context.py`

The context suite and `tests/test-yknotify-diagnostics.py` are registered as
the `yknotify-context` flake check. Diagnostic tests use canned probes and
isolated temporary journals, not real key operations.

After manually activating the configuration, check
`git config --get gpg.openpgp.program` points to `yknotify-git-gpg`, then run:

```sh
git -c gpg.format=openpgp commit-tree -S 'HEAD^{tree}' -p HEAD \
  -m "YubiKey notification acceptance test"
```

Leave the key flashing briefly. Expect a notification explicitly saying
**touch requester unverified**, then tap. This creates an unreferenced commit
object without moving a branch or changing working files. Disable DND/Focus
for the test. Do not bypass the wrapper with a custom OpenPGP program.
