# This is your nixos configuration.
# For home configuration, see /modules/home/*
{ flake, pkgs, lib, ... }:
{
  imports = [
    flake.inputs.self.nixosModules.common
  ];
  services.openssh.enable = true;

  hardware.gpgSmartcards.enable = true;
  services.pcscd.enable = true;
  services.udev.packages = lib.mkBefore [
    pkgs.ccid
  ];
}
