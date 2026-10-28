# Tmux snapshots

`tmux-snapshot` saves the primary tmux server every five minutes using launchd
(macOS) or a systemd user timer (Linux). No attached client or status-bar
callback is required. It prefers the persistent socket under
`$XDG_DATA_HOME/tmux/tmux-$UID/default`, falling back to the existing
`/tmp/tmux-$UID/default` server. It never starts a server.

After activation, reload the live tmux configuration with `Ctrl-a`, then `r`
to update existing keybindings; activation alone does not update them.

- `Ctrl-a`, then `Ctrl-s`: save now using the same validated path.
- `tmux-snapshot --check`: check backup health without saving.
- `Ctrl-a`, then `Ctrl-r`: restore the last published layout with resurrect.
- `--socket PATH`: explicitly target a server, including disposable test servers.

## Failure protection

The saver redirects resurrect's output into a private staging directory without
changing the running server's `@resurrect-dir`. Before publishing, it checks
saved panes and windows against the running layout and verifies the compressed
pane archive. The default process-command capture selects a single foreground
child per pane; background helpers such as `caffeinate` are not restored and
cannot introduce extra layout records. A single symlink switches the layout
and archive together.
Failures leave the last good pair available through resurrect's usual `last`
and `pane_contents.tar.gz` paths. Existing flat backups are preserved during
the first successful save. The five most recent complete bundles are retained
under `.snapshots/`; these files include terminal scrollback and are private.

Manual saves and timer saves share a lock. A concurrent save is skipped, and
a layout that changes during capture is rejected for retry at the next run.
Do not invoke resurrect's underlying `save.sh` directly: that bypasses staging.

## Notifications and health

Failures use the same `hub-notify` command as other repository processes. A
separate five-minute watchdog warns when no save has succeeded for 15 minutes
while the server is running. It allows a newly started server 15 minutes to
save and does not alert when there is no server. Success is tracked separately
from layout modification time: an unchanged layout is still a successful save.
Alerts are throttled to once per 15 minutes, unless health storage cannot be
written. Full errors go to the shared snapshot log.

On macOS:

```sh
launchctl print "gui/$(id -u)/org.nixos.tmux-snapshot"
launchctl print "gui/$(id -u)/org.nixos.tmux-snapshot-health"
tail -n 20 ~/Library/Logs/tmux-snapshot.log
```

On Linux, inspect `systemctl --user status tmux-snapshot{,-health}.timer` and
`journalctl --user -u tmux-snapshot -u tmux-snapshot-health`.

If another activation removes both agents, neither can notify. Verify the
agents after activation; the repository's LaunchAgent verification step checks
loading, while snapshot health checks actual saving. Layout restoration does
not resume arbitrary processes or recover process memory.

## Tests

`nix build .#checks.aarch64-darwin.tmux-recovery` runs detached save/restore and
failure/notification tests on disposable sockets, with a fake notifier. Use the
corresponding Linux check on a Linux builder. Tests never modify the live
server or send desktop notifications.
