{ pkgs, config, lib, flake, ... }:
with lib;

let
  cfg = config.hub.git;
in {
  options.hub.git = {
    enable = mkOption {
      description = "Enable git";
      type = types.bool;
      default = false;
    };

    github = mkOption {
      description = "Enable github tooling";
      type = types.bool;
      default = false;
    };
  };

  config = mkIf (cfg.enable) {
    programs.git = {
      enable = true;
      userName = flake.config.people.users.${config.home.username}.name;
      userEmail = flake.config.people.users.${config.home.username}.email;
    };

    home.file.".gitconfig".source = ./.gitconfig;

    home.packages = with pkgs; [
      gh              # TODO: condition this to github option above
    ];
    xdg.configFile."pass-git-helper/git-pass-mapping.ini".source = .config/pass-git-helper/git-pass-mapping.ini;
  };
}
