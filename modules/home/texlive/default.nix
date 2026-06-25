{ pkgs, ... }:
let
  emacsTexlive = import ../emacs/texlive.nix { inherit pkgs; };
in
{
  home.packages = [ emacsTexlive ];
}
