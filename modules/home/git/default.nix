{ pkgs, config, ... }:
{
  programs.git = {
    enable = true;
    ignores = [ "*~" "*.swp" ];
    settings.user = {
      name = config.me.fullname;
      email = config.me.email;
    };
  };

  programs.delta = {
    enable = true;
    enableGitIntegration = true;
    options = {
      features = "decorations";
      navigate = true;
      light = false;
      side-by-side = true;
    };
  };

  home.file.".gitconfig".source = ./.gitconfig;

  home.packages = with pkgs; [
    gh
  ];
  # xdg.configFile."pass-git-helper/git-pass-mapping.ini".source = .config/pass-git-helper/git-pass-mapping.ini;
}
