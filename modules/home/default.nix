{
  home.stateVersion = "24.11";
  imports = [
    ./me.nix
    ./shell
    ./notify
    ./pass-launchers.nix
    ./zsh
    ./direnv
    ./gpg.nix
    ./starship.nix
    ./git
    ./ghostty
    ./ssh
    ./nix.nix
    ./pi
    ./tmux
    ./darwin-only.nix
    # ./emacs.nix
    ./mail
  ];
}
