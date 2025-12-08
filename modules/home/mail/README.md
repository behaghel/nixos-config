# Mail tray prerequisites (Ubuntu)

For the mail tray icon to work on Ubuntu with the real AppIndicator/GTK backend, install:

- `gir1.2-gtk-3.0`
- `gir1.2-pango-1.0`
- `gir1.2-gdkpixbuf-2.0`
- `gir1.2-appindicator3-0.1`
- `libappindicator3-1`
- `libnotify4`

On GNOME, ensure the AppIndicator/KStatusNotifier extension is enabled (package: `gnome-shell-extension-appindicator`; enable via GNOME Extensions or `gnome-extensions enable appindicator@extensions.gnome.org` and re-login).

If these typelibs are missing at runtime, the tray script will log the expected packages and exit instead of falling back to the dummy backend.
