
{ pkgs, ... }:

{
  programs.emacs = {
    enable = true;
    package = pkgs.emacs-unstable;
    extraPackages = epkgs: [ epkgs.mu4e ];
  };
}
