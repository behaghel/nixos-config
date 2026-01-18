# MeLE Syncthing Hub install & ISO usage

## Locate the ISO after the build
- Run `nix run .#build-mele-hub-iso` from the repo root.
- The build leaves a `result` symlink in your current directory pointing to the store path with `iso/nixos-minimal-<version>-x86_64-linux.iso` inside.
- Example path: `$(pwd)/result/iso/nixos-minimal-25.11pre-git-x86_64-linux.iso`.

## Copy the ISO to a USB drive
- Identify the USB device: `lsblk` (look for something like `/dev/sdX` or `/dev/disk/by-id/...`).
- Write the image (⚠️ destroys the target device):
  - Linux: `sudo dd if=result/iso/nixos-minimal-*-x86_64-linux.iso of=/dev/sdX bs=4M status=progress oflag=sync`
  - macOS: `sudo dd if=result/iso/nixos-minimal-*-x86_64-linux.iso of=/dev/rdiskN bs=4m status=progress`
- Safely eject/unmount the USB key before removing it.

## Install on the MeLE hardware
- Connect keyboard/monitor and the prepared USB key, then boot the MeLE and select the USB device (often via F7/F11 boot menu).
- In the live shell, set up networking if needed (e.g., `nmcli device wifi connect <ssid> password <pw>`), then pull this repo if it’s not already present.
- Partition and install using the helper script on the ISO:
  - Basic: `sudo /etc/install-mele-hub.sh /dev/<disk> [ROOT_GiB] [DATA_GiB] [SWAP_GiB]`
  - One-shot install (build + install): add `--install` to also build and install `.#mele-hub` with the emacs Cachix enabled. Run from the repo root (or set `FLAKE_ROOT=/path/to/repo`):
    - `sudo /etc/install-mele-hub.sh --install /dev/<disk> [ROOT_GiB] [DATA_GiB] [SWAP_GiB]`
  - The script wipes the disk, creates EFI/root/syncthing/swap, formats, mounts `/mnt`, `/mnt/boot`, `/mnt/srv/syncthing`, and enables swap. With `--install` it also copies the built system closure to `/mnt` and runs `nixos-install --system …`.
- After install completes, reboot without the USB key; the system should boot into the configured `mele-hub` profile with Syncthing enabled and SSH authorized keys pre-seeded.

## Troubleshooting
- If the ISO build fails on remote builders, rerun with `KEYS_DIR=/path/to/keys` if keys are stored elsewhere.
- Verify the USB write by re-plugging and checking `lsblk` shows the ISO9660 partition.

## Observability
- **Built-in Grafana (internal, open access):** Grafana listens on `http://<mele-hub-ip>:3000` with anonymous read-only access and a pre-provisioned "MeLE Hub Health" dashboard (uptime, CPU, memory, root disk, network, disk IO). Datasource is the local Prometheus (`127.0.0.1:9090`); node_exporter is bound to `127.0.0.1:9100`.
- **Disk/health alerts (low overhead):** set up a simple cron/systemd timer that runs `df -h / /srv/syncthing` and posts to a webhook (e.g., healthchecks.io, ntfy, Apprise). One-liner example for a timer: `df -h /srv/syncthing | tail -n +2 | awk '$5+0 > 85 {print}'` and send if triggered.
- **Disk SMART checks:** the ISO enables `services.smartd`; configure email/webhook notifications for failing drives.
- **Process/service visibility:** `systemd` will restart Syncthing; expose logs via `journalctl -u syncthing@hub`. If you want remote access, consider a lightweight VPN (Tailscale/WireGuard) and monitor via Prometheus.

## Syncthing usage
- Syncthing runs as the `syncthing` user with data in `/srv/syncthing`, config in `/var/lib/syncthing`, and GUI bound to `127.0.0.1:8384` (tunnel with `ssh -L 8384:127.0.0.1:8384 hub@<mele-ip>`).
- Add remote devices via the GUI and share folders from `/srv/syncthing` as needed. Syncthing’s own file versioning creates `.stversions/`; backups exclude these.
- Firewall allows TCP 22000 and UDP 21027 on the hub; peers must be able to reach those ports.

## Backups (Restic to B2)
- Secrets live in `/etc/restic.env` (root:root, 600) with `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`, `AWS_ACCESS_KEY_ID/SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`, `RESTIC_CACHE_DIR`. Choose a simple password (no shell quoting needed).
- Helper CLI: `bkp …` (root path) wraps restic with the env file. Examples:
  - `sudo bkp snapshots`
  - `sudo bkp backup /srv/syncthing --tag manual`
- Scheduled backup: systemd timer `restic-backup-syncthing.timer` (02:30 CET ± random delay) runs `restic backup /srv/syncthing --exclude-file=…` then `forget --keep-daily 4 --keep-weekly 4 --keep-monthly 12 --prune`.
- One-time init (after placing `/etc/restic.env` and choosing the password): `sudo bkp init` (or `restic init` via the helper) against the B2 bucket.
- Restore (staging): `sudo mkdir -p /srv/restore-syncthing` then `sudo bkp restore latest --target /srv/restore-syncthing --verbose`.
- Excludes: `**/.stversions/**` so Syncthing’s versioning copies don’t bloat backups.
