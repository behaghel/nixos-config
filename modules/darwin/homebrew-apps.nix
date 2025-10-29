{ lib, config, ... }:
with lib;

let
  cfg = config.hub.darwin.apps;
  defaultCasks = [
    "anki"
    "vlc"
    "zotero"
    "amazon-kindle"
    "glaxnimate"
    "nikitabobko/tap/aerospace"
  ];
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
  };

  config = mkIf cfg.enable {
    homebrew.enable = mkDefault true;
    homebrew.casks = mkBefore cfg.casks;
  };
}
