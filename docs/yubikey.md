# YubiKey setup (GPG + SSH)

This repository follows the excellent [drduh/YubiKey Guide](https://github.com/drduh/YubiKey-Guide/blob/master/README.md).
The notes below connect that guide to our nix-darwin/Home Manager configuration so you can get an SSH-capable YubiKey
without having to reverse-engineer how the repo is wired.

## 0. Apply the latest configuration

```sh
nix run
```

Key pieces landed in the repo:

- `services.gpg-agent` is enabled with SSH support and `scdaemon` for smartcard access.
- `pinentry-mac` (Darwin) / `pinentry-gtk2` (Linux) is packaged automatically.
- `ykman` (`yubikey-manager`) and `yubikey-personalization` CLI tools are placed in your profile,
  and `homebrew.casks` installs the GUI YubiKey Manager on macOS.
- `SSH_AUTH_SOCK` points at GnuPG’s SSH socket so `ssh` and `git` automatically see the token.

Log out and back in (or restart your shell) after switching so the environment picks up the new `SSH_AUTH_SOCK`.

## 1. Prepare the provisioning environment

Generate keys on something you trust. The guide recommends an ephemeral Debian live system.
Follow these sections verbatim:

1. [Prepare environment](https://github.com/drduh/YubiKey-Guide/blob/master/README.md#prepare-environment)
2. [Install software](https://github.com/drduh/YubiKey-Guide/blob/master/README.md#install-software)
3. [Prepare GnuPG](https://github.com/drduh/YubiKey-Guide/blob/master/README.md#prepare-gnupg)
4. [Create Certify key](https://github.com/drduh/YubiKey-Guide/blob/master/README.md#create-certify-key)
5. [Create Subkeys](https://github.com/drduh/YubiKey-Guide/blob/master/README.md#create-subkeys)

Important: create a **sign** subkey, an **encrypt** subkey, and—most relevant here—an **authentication** subkey.
Export, back up, and revoke keys exactly as described in the guide before continuing.

## 2. Personalise the YubiKey

Continue with these sections on the offline machine while the primary keys are still available:

6. [Configure YubiKey](https://github.com/drduh/YubiKey-Guide/blob/master/README.md#configure-yubikey)
7. [Transfer Subkeys](https://github.com/drduh/YubiKey-Guide/blob/master/README.md#transfer-subkeys)
8. [Verify transfer](https://github.com/drduh/YubiKey-Guide/blob/master/README.md#verify-transfer)

At the end of this step `gpg --card-status` should show the authentication (SSH) key stored on-device.

## 3. Import the public material on your daily machine

On the macOS host that uses this repo:

```sh
gpg --import ~/path/to/exported-public.asc          # master + subkeys
gpg --card-status                                   # populate card stub details
ssh-add -L                                          # should now print the YubiKey-backed key
```

If you do not see the key, make sure `gpg-agent` is managing SSH:

```sh
echo $SSH_AUTH_SOCK    # -> .../gnupg/S.gpg-agent.ssh
```

### Copy the SSH public key

Export the OpenSSH-formatted key and add it wherever you expect Git/SSH access (GitHub, servers, etc.):

```sh
gpg --export-ssh-key <KEYID> | tee ~/.ssh/id_yubikey.pub
```

The public key comment will include `cardno:NNNNNNNN`.

## 4. Test SSH

Touch the YubiKey and confirm you can authenticate:

```sh
ssh -T git@github.com
```

A green `Authentication succeeded` prompt after touching the token means everything is wired correctly.

If you need to forward the agent through another host, the guide’s
[SSH agent forwarding](https://github.com/drduh/YubiKey-Guide/blob/master/README.md#ssh-agent-forwarding) chapter
explains both `ssh-agent` and `S.gpg-agent.ssh` forwarding styles. Because our setup already relies on the GnuPG SSH
socket, follow the `Use S.gpg-agent.ssh` instructions one-for-one.

## 5. Optional niceties

- Require touch for the authentication key: follow [Configure touch](https://github.com/drduh/YubiKey-Guide/blob/master/README.md#configure-touch) (auth slot).
- Rotate/renew subkeys periodically; document checkpoints in your password manager alongside the YubiKey PIN/PUK.
- Keep an encrypted copy of the certifying key offline so you can recover if the YubiKey is lost.

## Troubleshooting tips

- If `gpg --card-status` hangs, unplug/replug the key and run `pkill scdaemon`.
- On macOS the first access after login may trigger the “allow access” dialog; click “Always Allow” so GnuPG can talk to the token.
- For more detail, the upstream [Troubleshooting](https://github.com/drduh/YubiKey-Guide/blob/master/README.md#troubleshooting) section is excellent.
