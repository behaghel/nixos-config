{
  home.stateVersion = "24.11";
  imports = [
    ./me.nix
    ./shell
    ./pass-launchers.nix
    ./zsh
    ./direnv
    ./gpg.nix
    ./starship.nix
    ./git
    ./ghostty
    ./ssh
    ./nix.nix
    ./opencode
    ./pi
    ./tmux
    ./darwin-only.nix
    # ./emacs.nix
    ./mail
  ];
}
