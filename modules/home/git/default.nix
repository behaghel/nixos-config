{ pkgs, flake, ... }:
{
  programs.git = {
    enable = true;
    userName = flake.config.me.fullname;
    userEmail = flake.config.me.email;
    ignores = [ "*~" "*.swp" ];
    delta = {
      enable = true;
      options = {
        features = "decorations";
        navigate = true;
        light = false;
        side-by-side = true;
      };
    };
  };

  home.file.".gitconfig".source = ./.gitconfig;

  home.packages = with pkgs; [
    gh
  ];
  # xdg.configFile."pass-git-helper/git-pass-mapping.ini".source = .config/pass-git-helper/git-pass-mapping.ini;
}
