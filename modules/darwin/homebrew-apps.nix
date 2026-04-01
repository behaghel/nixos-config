{ lib, config, ... }:
with lib;

let
  cfg = config.hub.darwin.apps;
  defaultCasks = [
    "anki"
    "vlc"
    "zotero"
    "ghostty"
    "iterm2"
    "notunes"
    "hammerspoon"
    "firefox"
  ];
  defaultBrews = [ ];
  defaultTaps = [ ];
in
{
  options.hub.darwin.apps = {
    enable = mkOption {
      type = types.bool;
      default = true;
      description = "Whether to manage common GUI applications via Homebrew casks.";
    };

    casks = mkOption {
      type = types.listOf types.str;
      default = defaultCasks;
      description = "Homebrew casks to install for the default macOS workstation setup.";
    };

    brews = mkOption {
      type = types.listOf types.str;
      default = defaultBrews;
      description = "Homebrew formulae to install for the default macOS workstation setup.";
    };

    taps = mkOption {
      type = types.listOf types.str;
      default = defaultTaps;
      description = "Homebrew taps required by requested casks/formulae.";
    };
  };

  config = mkIf cfg.enable {
    homebrew.enable = mkDefault true;
    homebrew.taps = mkBefore cfg.taps;
    homebrew.brews = mkBefore cfg.brews;
    homebrew.casks = mkBefore cfg.casks;
  };
}
