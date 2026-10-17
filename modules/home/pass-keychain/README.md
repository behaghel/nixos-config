# pass-keychain

Reusable, allowlist-only promotion from `pass` to the macOS login Keychain.
Flake package: `.#pass-keychain`. The macOS mail module uses this same package;
other projects can consume it without depending on mail. SecretSpec profile
mode also works on Linux; raw Keychain writing requires macOS.

- `ensure`: check each Keychain item and SHA-256 of its `.gpg` ciphertext. Read
  `pass` only on first use, changed ciphertext or missing Keychain items.
- `refresh`: decrypt every selected entry to verify or update Keychain.
- `check`: check selected Keychain items without reading `pass` or state.

Example (entry names and service names are not secrets):

```sh
pass-keychain ensure --account "$USER" \
  --state-file "$HOME/.local/state/pass-keychain/my-profile.json" \
  --entry 'work/mail/password=mail/password'
```

Specify `--entry` more than once; without `=`, the Keychain service name equals
the pass entry. Use a distinct state file per account/profile. The default pass
store is `~/.password-store`; `PASSWORD_STORE_DIR` overrides it. Removed entries
are **not** deleted from Keychain. Existing mismatched items are updated.

The first `ensure` deliberately decrypts all selected entries and verifies or
repairs their Keychain values. Later runs read Keychain but not `pass` while the
ciphertext is unchanged. Re-encryption of the same plaintext can cause an extra
YubiKey tap; changing Keychain data out of band without changing the ciphertext
cannot be detected without decryption, so run `refresh` to audit it. A missing
item triggers promotion regardless of fingerprint. State contains only mappings
and encrypted-file hashes, mode 0600. A failed promotion does not advance it;
partial Keychain writes are retried on the next run.

The writer reads secret bytes from stdin via Security.framework; it never puts
plaintext in process arguments or shell logs. Keychain access permissions may
prompt once when switching from the old `/usr/bin/security` writer. Do not use
`--entry` with untrusted input. Never print `pass show` output in logs.

## SecretSpec profiles

When SecretSpec is available on `PATH`, use its manifest and provider semantics
instead of raw `--entry` arguments:

```sh
pass-keychain promote --file secretspec.toml --profile live
pass-keychain ensure --file secretspec.toml --profile live
pass-keychain refresh --file secretspec.toml --profile live
pass-keychain check --file secretspec.toml --profile live
```

`promote` refuses any differing existing entry before writing. `refresh`
explicitly updates differing entries. `ensure` records a first-run baseline,
then checks Keychain without reading `pass` for unchanged encrypted files;
changed ciphertext is promoted, while an unverified first-run conflict is
refused. `check` never reads `pass`. Declared required entries must exist;
optional absent source entries are neither read nor deleted. Inherited default
profile declarations are included. Redirecting provider aliases, file-backed
settings and generation are rejected. This mode uses SecretSpec's own
`pass://{project}/{profile}/{key}` and `keyring://{project}/{profile}/{key}`
providers, including its Keychain identity. Its pinned 0.8.x stdin setter trims
leading/trailing whitespace; affected values are refused before any writes.
Failure and success reports are metadata-only JSON. A distinct owner-only
baseline is derived from the manifest path, project and profile in
`$XDG_STATE_HOME/pass-keychain/` (override with `--state-file`).
