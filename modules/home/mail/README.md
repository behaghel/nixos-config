Mail Module Overview
====================

This module wires several cooperating units to keep local Maildirs fresh, warn
when syncing stalls, and surface new message notifications without stomping on
Emacs/mu.

Components
----------

* `mail-sync.service` — `oneshot` unit that runs `mail-sync-run`.
  * Script lives in `modules/home/mail/sync.nix` and wraps `mbsync -a` plus
    optional smartcard checks.
  * On success it updates `hub.mail.stampFile` (default
    `${XDG_CACHE_HOME:-~/.cache}/mail-sync/last`) atomically. The stamp is the
    single source of truth for “last successful sync”.
  * Failures surface via `notify-send` (when available) but do not touch the
    stamp so the health monitor can detect real regressions.

* `mail-sync.timer` — triggers the service every `hub.mail.interval` (10m by
  default) and once on boot. Set this interval per-host/user via the module
  option to adjust how aggressively you poll.

* `mail-sync-health.service` + timer — sanity check that mail has synced
  recently.
  * Parses `hub.mail.interval`, sets warning threshold to `3× interval`, and
    critical at 4 hours.
  * Reads `hub.mail.stampFile` and uses `hub.mail.alertStampFile` to rate-limit
    notifications to at most once per hour even if syncing remains broken.
  * Automatically starts `mail-sync.service` whenever it notices staleness.
  * Notifications are best-effort; the alert stamp still updates even when
    `notify-send` is missing so we do not spam later.

* `imapnotify` integration — optional (enabled on Linux laptop).
  * Each configured account gets a `goimapnotify` job watching INBOX.
  * On new mail, per-account `mbsync <account>` runs (never `-a`). Successful
    runs update the same `hub.mail.stampFile`, so the health service stays happy
    even if the periodic timer doesn’t fire for a while.
  * Optional desktop notification highlights sender/subject and can deep-link
    into Emacs when clicked.

* Cache + credentials helpers — see `cache.nix` and `accounts.nix`.
  * Passwords flow through `passCacheScript` with a 4h TTL so `mbsync` stays
    non-interactive.
  * Gmail OAuth tokens are fetched lazily using the helper packaged into
    `home.packages`.

Manual tools
------------

* `mail-sync` shell alias blocks until the lock is free and runs quietly by
  default (pass `--verbose` if you really want trace output).
* `mail-sync --autocorrect-mbsync` runs the same command but, on `mbsync`
  errors such as “duplicate UID”/“UID … beyond highest assigned UID”, it feeds
  the log to `mail-sync-autocorrect`, scrubs conflicted `,U=` markers, and
  retries automatically until the mailbox is clean (or the helper stops making
  progress).
* `mail-sync-verbose` is a convenience wrapper that always adds `--verbose` when
  you actually want `set -x` style tracing.
* `mail-sync-autocorrect` is a standalone helper (stdout-driven) so you can pipe
  historical logs through it for debugging or run with `--dry-run` to see what
  would be renamed without touching the Maildir.
* `mail-sync --force-uid-resync[=<subdir>]` pre-scrubs every `,U=<n>` suffix
  under the whole Maildir (or the provided relative/absolute path) before
  running `mbsync`. Useful when you want to reset UID state in bulk.
* Successful runs raise a desktop notification with the number of new messages
  fetched; set `MAIL_SYNC_NOTIFY_SUCCESS=0` to disable.
* `mail-sync.lock` prevents overlapping runs; `MAIL_SYNC_WAIT=1` acquires the
  lock instead of bailing.

Extending/Debugging
-------------------

* Prefer tweaking module options instead of editing scripts directly:
  * `hub.mail.interval` — nudges both the timer and the health thresholds.
  * `hub.mail.cacheDir`, `hub.mail.stampFile`, `hub.mail.alertStampFile` —
    exposed as read-only options so other modules (e.g., `imapnotify`) can
    reference consistent paths.
* To inspect recent runs: `journalctl --user -u mail-sync -u mail-sync-health`.
* To test the health path, temporarily remove the stamp file or bump its
  timestamp with `touch -d '5 hours ago' ~/.cache/mail-sync/last` and run
  `systemctl --user start mail-sync-health.service`.
