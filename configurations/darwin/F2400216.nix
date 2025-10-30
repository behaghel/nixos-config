{ flake, pkgs, ... }:

let
  inherit (flake) inputs;
  inherit (inputs) self;
in
{
  imports = [
    self.darwinModules.default
    ../../modules/nixos/gui/fonts.nix
  ];

  nixpkgs.hostPlatform = "aarch64-darwin";
  networking.hostName = "F2400216";

  system.stateVersion = 4;
  system.primaryUser = "hubertbehaghel";

  environment.systemPackages = [ pkgs.jdk21_headless ];
}
