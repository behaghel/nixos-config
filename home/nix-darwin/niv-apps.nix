{ pkgs, config, lib, ... }:
with lib;
{
  options = {
    hub.niv-apps = {
      enable = mkOption {
        description = "Enable dmg apps managed through `niv`";
        type = types.bool;
        default = false;
      };
    };
  };

  config = let
    cfg = config.hub.niv-apps;
  in mkIf (cfg.enable) {
    home.packages = with pkgs;
      [
        niv
      ];
  };
}