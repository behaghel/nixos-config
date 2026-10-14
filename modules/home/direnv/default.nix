{ config, pkgs, lib, ... }:

{
  programs.direnv = {
    enable = true;
    nix-direnv = {
      enable = true;
      # Until https://github.com/nix-community/home-manager/pull/5773
      package = lib.mkIf (config.nix.package != null)
        (pkgs.nix-direnv.override { nix = config.nix.package; });
    };
    enableZshIntegration = true;
    enableBashIntegration = config.programs.bash.enable;

    config.global = {
      hide_env_diff = true;
    };
  };
  # The direnv hook is installed earlier in zshrc; run completion repair after it.
  programs.zsh.initContent = lib.mkOrder 2100 ''
    source ${./completions.zsh}
  '';
  xdg.configFile."direnv/direnvrc".source = ./.direnvrc;
}
