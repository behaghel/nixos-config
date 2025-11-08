{ lib, pkgs, config, ... }:
let
  cfg = config.services.local-modules.nix-darwin.keyboard.bepo or { enable = false; };
  layoutPath = ../../darwin/keyboard/bepo.keylayout;
in
{
  options.services.local-modules.nix-darwin.keyboard.bepo.enable = lib.mkOption {
    type = lib.types.bool;
    default = false;
    description = "Install the bépo keyboard layout and make it the default input source.";
  };

  config = lib.mkIf (pkgs.stdenv.isDarwin && cfg.enable) {
    home.activation.installBepoLayout = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
      if [ "$(uname -s)" != "Darwin" ]; then
        exit 0
      fi

      set -euo pipefail

      layout_dir="$HOME/Library/Keyboard Layouts"
      layout_target="$layout_dir/bepo.keylayout"
      layout_tmp="$layout_target.tmp"

      /bin/mkdir -p "$layout_dir"
      # Install/update non-interactively: skip if identical, force replace otherwise.
      if [ -f "$layout_target" ]; then
        if /usr/bin/cmp -s "$layout_target" "${layoutPath}"; then
          : # already up to date
        else
          /bin/cp "${layoutPath}" "$layout_tmp"
          /bin/chmod 0644 "$layout_tmp" 2>/dev/null || true
          /usr/bin/xattr -d com.apple.quarantine "$layout_tmp" 2>/dev/null || true
          /usr/bin/chflags nouchg "$layout_target" 2>/dev/null || true
          /bin/mv -f "$layout_tmp" "$layout_target"
          /usr/bin/xattr -d com.apple.quarantine "$layout_target" 2>/dev/null || true
        fi
      else
        /bin/cp "${layoutPath}" "$layout_tmp"
        /bin/chmod 0644 "$layout_tmp" 2>/dev/null || true
        /bin/mv -f "$layout_tmp" "$layout_target"
        /usr/bin/xattr -d com.apple.quarantine "$layout_target" 2>/dev/null || true
      fi
      /usr/bin/defaults write com.apple.HIToolbox AppleDefaultAsciiInputSource -dict \
        "InputSourceKind" "Keyboard Layout" \
        "KeyboardLayout ID" -6538 \
        "KeyboardLayout Name" "bépo"

      /usr/bin/defaults write com.apple.HIToolbox AppleSelectedInputSources -array \
        '{ "InputSourceKind" = "Keyboard Layout"; "KeyboardLayout ID" = -6538; "KeyboardLayout Name" = "bépo"; }'

      /usr/bin/defaults write com.apple.HIToolbox AppleEnabledInputSources -array \
        '{ "InputSourceKind" = "Keyboard Layout"; "KeyboardLayout ID" = -6538; "KeyboardLayout Name" = "bépo"; }'

      /usr/bin/defaults write com.apple.HIToolbox AppleInputSourceHistory -array \
        '{ "InputSourceKind" = "Keyboard Layout"; "KeyboardLayout ID" = -6538; "KeyboardLayout Name" = "bépo"; }'

      /usr/bin/defaults write com.apple.HIToolbox AppleCurrentKeyboardLayoutInputSourceID -string "com.apple.keylayout.bepo"
      /usr/bin/defaults -currentHost write com.apple.HIToolbox AppleCurrentKeyboardLayoutInputSourceID -string "com.apple.keylayout.bepo"

      /usr/bin/killall -u "$USER" cfprefsd 2>/dev/null || true
      /usr/bin/defaults read com.apple.HIToolbox >/dev/null 2>&1 || true
    '';

    # Hotkey disabling moved to nix-darwin keyboard module (user LaunchAgent).
  };
}
