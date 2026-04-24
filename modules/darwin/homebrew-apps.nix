{ lib, config, ... }:
with lib;

let
  cfg = config.hub.darwin.apps;
  defaultCasks = [
    "gimp"
    "vlc"
    "ghostty"
    "notunes"
    "hammerspoon"
    "firefox"
    "localsend"
    "mpv"
    "utm"
  ];
  defaultBrews = [ "sst/tap/opencode" ];
  defaultTaps = [ "sst/tap" ];
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
      description = "Homebrew casks to install for the shared macOS workstation setup.";
    };

    brews = mkOption {
      type = types.listOf types.str;
      default = defaultBrews;
      description = "Homebrew formulae to install for the shared macOS workstation setup.";
    };

    taps = mkOption {
      type = types.listOf types.str;
      default = defaultTaps;
      description = "Homebrew taps required by the shared macOS workstation setup.";
    };
  };

  config = mkIf cfg.enable {
    homebrew.enable = mkDefault true;
    homebrew.taps = mkBefore cfg.taps;
    homebrew.brews = mkBefore cfg.brews;
    homebrew.casks = mkBefore cfg.casks;
  };
}
