# YubiKey touch notifications

On macOS, `hub.yknotify.enable` watches heuristic OpenPGP/FIDO2 touch events
and sends notifications through `hub-notify`. Delivery respects macOS Focus
and notification settings. A notification is not an authorization prompt.

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
existing touch-detection and reminder heuristics are unchanged.

## Verification

Automated tests use a fake GPG executable and isolated Git configuration;
they never access the real agent or key:

`devenv -q shell -- as . run python3 tests/test-yknotify-context.py`

The same suite is registered as the `yknotify-context` flake check.

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
