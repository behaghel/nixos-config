# Mail synchronization

## Credential authority

Password Store (`pass`) is the cross-platform source of truth for mail credentials.

On macOS, `hub.mail.keychainPassEntries` declares exact `pass` keys that Home Manager exports during activation. Each value is upserted into the Login Keychain with:

- account: the Home Manager username;
- service: the exact `pass` key;
- secret: the decrypted `pass` value.

The synchronization is one-way from Password Store to Keychain. Activation fails if a declared value cannot be decrypted or stored, and does not print secret values. Scheduled macOS mail processes read Keychain without invoking GPG or requiring a YubiKey. Linux continues to read `pass` through the bounded mail credential cache.

Adding or rotating a mail secret requires updating `pass` and running Home Manager activation on each macOS machine.

## Mailbox scope

Gmail Inbox and Starred channels synchronize independently. Inbox flag propagation carries the IMAP `Flagged` marker used by Gmail Starred; local synchronization of Gmail All Mail is intentionally disabled.

## Mail tray prerequisites (Ubuntu)

For the mail tray icon to work on Ubuntu with the real AppIndicator/GTK backend, install:

- `gir1.2-gtk-3.0`
- `gir1.2-pango-1.0`
- `gir1.2-gdkpixbuf-2.0`
- `gir1.2-appindicator3-0.1`
- `libappindicator3-1`
- `libnotify4`

On GNOME, ensure the AppIndicator/KStatusNotifier extension is enabled (package: `gnome-shell-extension-appindicator`; enable via GNOME Extensions or `gnome-extensions enable appindicator@extensions.gnome.org` and re-login).

If these typelibs are missing at runtime, the tray script will log the expected packages and exit instead of falling back to the dummy backend.
