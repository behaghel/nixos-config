{ lib, pkgs, ... }:
{
  imports = [
    ./darwin/apps.nix
    ./darwin/bepo.nix
    ./darwin/fonts.nix
    ./ghostty
    ./hammerspoon
  ];

  # Verify Home Manager's launch agents after setupLaunchAgents.
  # This is generally useful and unrelated to keyboard remapping.
  config = lib.mkIf pkgs.stdenv.isDarwin {
    home.activation.verifyLaunchAgents = lib.hm.dag.entryAfter [ "setupLaunchAgents" ] ''
      set -euo pipefail

      AGENTS_DIR="$HOME/Library/LaunchAgents"
      if [ ! -d "$AGENTS_DIR" ]; then
        exit 0
      fi

      uid="$(/usr/bin/id -u)"
      failed=0

      get_label() {
        local plist="$1"
        if command -v /usr/libexec/PlistBuddy >/dev/null 2>&1; then
          /usr/libexec/PlistBuddy -c 'Print :Label' "$plist" 2>/dev/null && return 0
        fi
        if command -v /usr/bin/plutil >/dev/null 2>&1; then
          /usr/bin/plutil -extract Label raw -o - "$plist" 2>/dev/null && return 0
        fi
        if command -v /usr/bin/defaults >/dev/null 2>&1; then
          local base="''${plist%.plist}"
          /usr/bin/defaults read "$base" Label 2>/dev/null && return 0
        fi
        basename "$plist" .plist
      }

      echo "Verifying Home Manager launch agents in $AGENTS_DIR" >&2

      shopt -s nullglob
      for plist in "$AGENTS_DIR"/*.plist; do
        label="$(get_label "$plist")" || label="$(basename "$plist" .plist)"
        if ! /bin/launchctl print "gui/$uid/$label" >/dev/null 2>&1; then
          echo "LaunchAgent '$label' not loaded; attempting bootstrap..." >&2
          if ! /bin/launchctl bootstrap "gui/$uid" "$plist" 2>&1; then
            echo "ERROR: Failed to bootstrap LaunchAgent '$label' from $plist" >&2
            failed=1
          else
            echo "Bootstrapped '$label' successfully." >&2
          fi
        fi
      done

      if [ "$failed" -ne 0 ]; then
        echo "One or more LaunchAgents failed to load. See activation log for details." >&2
        exit 1
      fi
    '';

    # Ensure launchd propagates SSH environment to GUI/daemon apps (Emacs, etc.).
    # This lets Emacs access the GPG agent SSH socket for GitHub over SSH
    # and avoids noisy X11 askpass fallbacks.
    home.activation.exportSshEnv = lib.hm.dag.entryAfter [ "setupLaunchAgents" ] ''
      set -euo pipefail
      sock="$HOME/.gnupg/S.gpg-agent.ssh"
      /bin/launchctl setenv SSH_AUTH_SOCK "$sock"
      /bin/launchctl setenv SSH_ASKPASS /usr/bin/true
      /bin/launchctl setenv GIT_ASKPASS /usr/bin/true
      /bin/launchctl setenv SSH_ASKPASS_REQUIRE never
      # Provide a predictable PATH and UTF-8 locale to GUI apps (Emacs, etc.).
      PATH_VAL="${lib.makeBinPath [ pkgs.git pkgs.ripgrep pkgs.gnugrep pkgs.findutils pkgs.coreutils ]}:/usr/bin:/bin:/usr/sbin:/sbin"
      /bin/launchctl setenv PATH "$PATH_VAL"
      /bin/launchctl setenv LANG en_US.UTF-8
      /bin/launchctl setenv LC_ALL en_US.UTF-8
      # Also ensure the GUI (Aqua) domain has the env set, so GUI apps see it.
      uid="$(/usr/bin/id -u)"
      /bin/launchctl asuser "$uid" /bin/launchctl setenv SSH_AUTH_SOCK "$sock" || true
      /bin/launchctl asuser "$uid" /bin/launchctl setenv SSH_ASKPASS /usr/bin/true || true
      /bin/launchctl asuser "$uid" /bin/launchctl setenv GIT_ASKPASS /usr/bin/true || true
      /bin/launchctl asuser "$uid" /bin/launchctl setenv SSH_ASKPASS_REQUIRE never || true
      /bin/launchctl asuser "$uid" /bin/launchctl setenv PATH "$PATH_VAL" || true
      /bin/launchctl asuser "$uid" /bin/launchctl setenv LANG en_US.UTF-8 || true
      /bin/launchctl asuser "$uid" /bin/launchctl setenv LC_ALL en_US.UTF-8 || true
    '';

    # (no one-off cleanup tasks here; user prefers manual/explicit cleanup)
  };
}
