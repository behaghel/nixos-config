# Configuration common to all macOS systems
{ flake, ... }:
let
  inherit (flake) inputs config;
  inherit (inputs) self;
in
{
  imports = [
    self.nixosModules.common
    ./zsh-completion-fix.nix
    ./keyboard
    ./system-defaults.nix
    ./homebrew-apps.nix
  ];

  config = {
    nixpkgs.overlays = import ../../overlays/default.nix { inherit inputs; };
    home-manager.sharedModules = [
      self.homeModules.default
      self.homeModules.darwin-only
    ];
  };
}
