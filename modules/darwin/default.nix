# Configuration common to all macOS systems
{ flake, pkgs, lib, ... }:
let
  inherit (flake) inputs config;
  inherit (inputs) self;
in
{
  imports = [
    ../common/myusers.nix
    ./zsh-completion-fix.nix
    ./keyboard
    ./system-defaults.nix
    ./homebrew-apps.nix
  ];

  config = {
    nixpkgs.overlays = import ../../overlays/default.nix { inherit inputs; };
    environment.systemPackages = [ pkgs.texlive.combined.scheme-small ];
  };
}
