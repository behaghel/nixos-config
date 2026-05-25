# MeLE backup and restore

MeLE uses Restic against Backblaze B2. Secret env files are managed manually on
MeLE and are not stored in this repo.

## Repositories and helpers

- Syncthing:
  - env: `/etc/restic-syncthing.env`
  - repo: `s3:https://s3.eu-central-003.backblazeb2.com/mele-syncthing-backup/syncthing-backup`
  - helper: `bkp-syncthing ...`
  - timer: `restic-backup-syncthing.timer` at 02:30 + random delay
  - paths: `/srv/syncthing`, `/var/lib/syncthing`
- MeLE apps:
  - env: `/etc/restic-mele-apps.env`
  - repo: `s3:https://s3.eu-central-003.backblazeb2.com/mele-apps-backup/apps-backup`
  - helper: `bkp-apps ...`
  - timer: `restic-backup-mele-apps.timer` at 03:15 + random delay
  - paths: `/srv/apps/<app>/data`, `/srv/apps/<app>/state`

`bkp ...` is a deprecated alias for `bkp-syncthing ...`.

Each env file should be `root:root`, mode `0600`, and contain
`RESTIC_REPOSITORY`, `RESTIC_PASSWORD`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`, and `RESTIC_CACHE_DIR`.

## Checks

```sh
sudo bkp-syncthing snapshots
sudo bkp-apps snapshots
systemctl list-timers | grep restic
```

Restic textfile metrics use `job="syncthing"` or `job="mele-apps"`.

## Non-destructive app restore verification

```sh
sudo mele-app verify-restore hedonis \
  --target /tmp/mele-restore-hedonis \
  --marker data/restore-marker.txt
```

The target must be outside `/srv/apps` and empty or absent.

## App restore runbook

Use this only when restoring real app data.

1. Pick the snapshot:
   ```sh
   sudo bkp-apps snapshots
   sudo bkp-apps ls latest | grep '/srv/apps/<app>/'
   ```
2. Restore to staging, never directly to live paths:
   ```sh
   sudo rm -rf /tmp/mele-restore-<app>
   sudo bkp-apps restore latest \
     --include /srv/apps/<app>/data \
     --include /srv/apps/<app>/state \
     --target /tmp/mele-restore-<app>
   ```
3. Inspect the staged restore:
   ```sh
   sudo find /tmp/mele-restore-<app>/srv/apps/<app> -maxdepth 3 -ls
   ```
4. Stop the app, copy staged data/state into place, fix ownership, restart:
   ```sh
   sudo systemctl stop mele-app-<app>.service
   sudo rsync -a --delete \
     /tmp/mele-restore-<app>/srv/apps/<app>/data/ \
     /srv/apps/<app>/data/
   sudo rsync -a --delete \
     /tmp/mele-restore-<app>/srv/apps/<app>/state/ \
     /srv/apps/<app>/state/
   sudo chown -R app-<app>:app-<app> /srv/apps/<app>/data
   sudo chown -R root:root /srv/apps/<app>/state
   sudo systemctl start mele-app-<app>.service
   ```
5. Verify:
   ```sh
   sudo mele-app health <app>
   sudo mele-app status <app>
   ```

Container images are intentionally not backed up; redeploy app images from
release artifacts when needed.

## Syncthing staging restore

```sh
sudo mkdir -p /srv/restore-syncthing
sudo bkp-syncthing restore latest --target /srv/restore-syncthing --verbose
```

Syncthing excludes `**/.stversions/**` so local versioning copies do not bloat
backups.
