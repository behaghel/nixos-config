{
  home.stateVersion = "24.11";
  imports = [
    ./me.nix
    ./shell
    ./zsh
    ./direnv
    ./gpg.nix
    ./starship.nix
    ./git
    ./ghostty
    ./ssh
    ./nix.nix
    ./tmux
    # ./dropbox
    # ./emacs.nix
    ./mail
  ];
}
