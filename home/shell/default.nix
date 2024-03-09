{ pkgs, config, lib, ... }:
with lib;

# TODO: it's not really bash, it's shell, a precursor to any shell env
# currently if I enable my zsh module without this, it breaks it
let
  cfg = config.hub.bash;
in {
  options.hub.bash = {
    enable = mkOption {
      description = "Enable bash";
      type = types.bool;
      default = true;
    };

    direnv = mkOption {
      description = "Enable my direnv config";
      type = types.bool;
      default = true;
    };
  };

  config = mkIf (cfg.enable) {
    # TODO: DRY
    # technically that should look like
    # home.file.".config".source = ./.config;
    # home.file.".config".recursive = true;
    home.file.".lesskey".source = ./.lesskey;
    home.file.".ctags".source = ./.ctags;
    home.file.".aliases".source = ./.aliases;
    xdg.configFile."profile.d/hub.profile".source = ./.config/profile.d/hub.profile;
    xdg.configFile."profile.d/zz_path.profile".source = ./.config/profile.d/zz_path.profile;


    programs.direnv = {
      enable = cfg.direnv;
      enableZshIntegration = config.hub.zsh.enable;
      enableBashIntegration = config.hub.bash.enable;
      nix-direnv.enable = cfg.direnv;
    };
    xdg.configFile."direnv/direnvrc".source = ./.direnvrc;

    # Platform-independent terminal setup
    home.packages = with pkgs;
      let my-aspell = aspellWithDicts (ds: with ds; [en fr es]);
      in [
        ripgrep
        fd        # find++
        sd        # sed++
        ncdu      # du++
        moreutils # ts, etc.

        asciinema # screencast your terminal

        neofetch
        pandoc
        wget
        my-aspell
      ];

    programs = {
      # nix-index = {
      #   enable = true;
      #   enableZshIntegration = true;
      # };
      # nix-index-database.comma.enable = true;
      lsd = {
        enable = true;
        enableAliases = true;
      };
      bat.enable = true;
      zoxide.enable = true;
      fzf.enable = true;
      jq.enable = true;
      htop.enable = true;
    };
    home.activation = {
      myHomeDirs = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
                  $DRY_RUN_CMD mkdir -p $HOME/.local/share $HOME/tmp $HOME/ws;  ln -sfn ${pkgs.mu}/share/emacs $HOME/.local/share
                '';
      # link emacs, vim and password-store: git submodules don't work with home.file (they are empty)
      linkHomeConfigs = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
                  $DRY_RUN_CMD ln -sf .dotfiles/vim/.vim; ln -sf .dotfiles/emacs/.emacs.d; ln -sf .dotfiles/pass/.password-store
      '';
    };

  };
}
