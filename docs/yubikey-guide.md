# YubiKey Usage Guide

This repository assumes your YubiKey pair was provisioned following the
[drduh/YubiKey Guide](https://github.com/drduh/YubiKey-Guide) (sign, encrypt, and auth subkeys mirrored on both keys,
full backups held offline). Everything below explains day-to-day usage on machines managed by this repo.

---

## Prerequisites

- `keys/<fingerprint>.asc` contains the latest public key bundle exported from the provisioning machine.
- You have two identical YubiKeys with those subkeys loaded.
- Your account can run `home-manager switch --flake .#hubertbehaghel`.

---

## First-Time Setup on a Host

1. Pull the repo, ensure `keys/` is up to date, then run:
   ```sh
   home-manager switch --flake .#hubertbehaghel
   ```
   Start a new shell afterwards so `SSH_AUTH_SOCK` points at GnuPG’s socket.
2. Insert a YubiKey and confirm everything lines up:
   ```sh
   gpg --card-status      # shows the card and subkeys
   ssh-add -L             # prints ssh-ed25519 … cardno:0006…
   ssh -T git@gitlab.com  # PIN + touch, ends with “Welcome to GitLab”
   ```
3. If pinentry still prompts for legacy private keys (e.g. old Mailfence key), remove them locally:
   ```sh
   gpg --delete-secret-key <OLD_KEYID>
   ```
   You already have archival backups from provisioning.
4. On Ubuntu, consider switching to the Nix-provided GnuPG stack for better smartcard hotplug support:
   ```nix
   programs.gpg.useNixGPG = true;
   ```
   Before enabling that option, run `scripts/ubuntu-use-nix-gpg.sh` (with sudo) to remove the distro `gnupg`
   packages and enable `pcscd`. Afterwards, re-run `nix run` to apply the change.

---

## Everyday Tasks

- **Swap between tokens**
  ```sh
  gpgconf --kill scdaemon
  gpg --card-status
  ```
  The agent re-detects whichever key is inserted; SSH and `pass` pick it up automatically.

- **Signed Git commits**
  ```sh
  git commit -S …
  ```
  You’ll get a touch prompt; no passphrase is required.

- **SSH**
  ```sh
  ssh -T git@gitlab.com
  ```
  Enter the user PIN (if requested) and touch the key.

- **Password store**
  ```sh
  pass show path/to/entry
  ```
  Nothing special is needed; the store is already encrypted to the YubiKey subkey.

---

## Syncing `~/.password-store`

The activation hook only clones the repo; it doesn’t push. To sync changes:

```sh
cd ~/.password-store
git status
git pull --rebase   # if needed
git commit …
git push
```

> Avoid `pass git push`: its wrapper ignores our `SSH_AUTH_SOCK` and fails with the YubiKey-backed agent.

### Re-encrypt the store for a new subkey

```sh
pass init 17048FE819B7C2BD7F59D6835137D6FF80B95202  # replace with current fingerprint
cd ~/.password-store
git push
```

---

## Troubleshooting

- **`ssh-add -L` is empty** — open a new shell (or `source ~/.config/zsh.d/gpg.zsh`) so `SSH_AUTH_SOCK` points at
  `$(gpgconf --list-dirs agent-ssh-socket)`.
- **`ssh`/`git` complain about the card** — run `gpgconf --kill scdaemon` and retry; occasionally the CCID driver needs
  a reset after hot-swapping keys.
- **Repeated pinentry for unwanted keys** — delete those secret keys locally (`gpg --delete-secret-key`). They aren’t
  needed once the YubiKeys hold the subkeys.
- **Ubuntu-only: `/etc/ssh/ssh_config` “Unsupported option GSSAPIAuthentication”** — add
  ```
  Host *
      GSSAPIAuthentication no
  ```
  to `~/.ssh/config` to silence the warning.

---

## Updating Keys Later

1. Provision new subkeys following drduh’s guide; duplicate to both YubiKeys.
2. Update the public bundle in `keys/`, commit it, and re-run `home-manager switch`.
3. Re-encrypt the password store with `pass init <new fingerprint>` and push.
4. Regenerate and register updated SSH public keys (`gpg --export-ssh-key`).
5. Remove retired secret keys from your machines to avoid stray prompts.

Keep this file current whenever the process changes so future migrations stay predictable.
