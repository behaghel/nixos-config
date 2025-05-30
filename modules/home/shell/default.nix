{ flake, pkgs, lib, ... }:

let
  inherit (flake) inputs;
in
# TODO: it's not really bash, it's shell, a precursor to any shell env
# currently if I enable my zsh module without this, it breaks it
{
  imports = [
    inputs.nix-index-database.hmModules.nix-index
  ];
  # TODO: DRY
  # technically that should look like
  # home.file.".config".source = ./.config;
  # home.file.".config".recursive = true;
  home.file.".lesskey".source = ./.lesskey;
  home.file.".ctags".source = ./.ctags;
  home.file.".aliases".source = ./.aliases;
  xdg.configFile."profile.d/hub.profile".source = ./.config/profile.d/hub.profile;
  xdg.configFile."profile.d/zz_path.profile".source = ./.config/profile.d/zz_path.profile;

  programs.bash.profileExtra = let
    sysBin = "/nix/var/nix/profiles/default/bin";
    usrBin =
      "/etc/profiles/per-user/$USER/bin";
  in ''
        case :$PATH: in
          *:${sysBin}:*)  ;;  # do nothing
          *) PATH=${sysBin}:$PATH ;;
        esac
        case :$PATH: in
          *:${usrBin}:*)  ;;  # do nothing
          *) PATH=${usrBin}:$PATH ;;
        esac
        export PATH
      '';

  # Platform-independent terminal setup
  home.packages = with pkgs;
    let my-aspell = aspellWithDicts (ds: with ds; [en fr es]);
    in [
      ripgrep
      fd        # find++
      sd        # sed++
      # ncdu      # du++
      moreutils # ts, etc.

      asciinema # screencast your terminal

      neofetch
      pandoc
      wget
      my-aspell
    ];

  programs = {
    nix-index = {
      enable = true;
      enableZshIntegration = true;
    };
    nix-index-database.comma.enable = true;
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
  };
}
