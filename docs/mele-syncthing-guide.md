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
  - Run `sudo /etc/install-mele-hub.sh /dev/<disk> [ROOT_GiB] [DATA_GiB] [SWAP_GiB]` (defaults: 200G root, 256G data, 8G swap).
  - The script wipes the disk, creates EFI/root/syncthing/swap, formats, mounts `/mnt`, `/mnt/boot`, `/mnt/srv/syncthing`, and enables swap.
  - Then run `nixos-install --flake .#mele-hub` from the repo root.
- After install completes, reboot without the USB key; the system should boot into the configured `mele-hub` profile with Syncthing enabled and SSH authorized keys pre-seeded.

## Troubleshooting
- If the ISO build fails on remote builders, rerun with `KEYS_DIR=/path/to/keys` if keys are stored elsewhere.
- Verify the USB write by re-plugging and checking `lsblk` shows the ISO9660 partition.

## Remote monitoring & alerts (headless)
- **Disk/health alerts (low overhead):** set up a simple cron/systemd timer that runs `df -h / /srv/syncthing` and posts to a webhook (e.g., healthchecks.io, ntfy, Apprise). One-liner example for a timer: `df -h /srv/syncthing | tail -n +2 | awk '$5+0 > 85 {print}'` and send if triggered.
- **Node metrics:** the ISO enables `services.prometheus.exporters.node` by default; scrape with your Prometheus/Grafana stack and alert on `node_filesystem_avail_bytes` for `/` and `/srv/syncthing`.
- **Disk SMART checks:** the ISO enables `services.smartd`; configure email/webhook notifications for failing drives.
- **Process/service visibility:** `systemd` will restart Syncthing; expose logs via `journalctl -u syncthing@hub`. If you want remote access, consider a lightweight VPN (Tailscale/WireGuard) and monitor via Prometheus.
