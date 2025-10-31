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
    home.file."Library/Keyboard Layouts/bepo.keylayout" = {
      source = layoutPath;
    };

    home.activation.setBepoKeyboardLayout = ''
      if [ "$(uname -s)" != "Darwin" ]; then
        exit 0
      fi

      set -euo pipefail

      /usr/bin/defaults write com.apple.HIToolbox AppleDefaultAsciiInputSource -dict \
        "InputSourceKind" "Keyboard Layout" \
        "KeyboardLayout ID" -6538 \
        "KeyboardLayout Name" "bépo"

      /usr/bin/defaults write com.apple.HIToolbox AppleSelectedInputSources -array \
        '{ "InputSourceKind" = "Keyboard Layout"; "KeyboardLayout ID" = -6538; "KeyboardLayout Name" = "bépo"; }'

      /usr/bin/defaults write com.apple.HIToolbox AppleEnabledInputSources -array \
        '{ "InputSourceKind" = "Keyboard Layout"; "KeyboardLayout ID" = -6538; "KeyboardLayout Name" = "bépo"; }'
    '';
  };
}
