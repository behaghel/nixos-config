{ flake, config, pkgs, lib, ... }:
let
  inherit (flake) inputs;
in
{
  imports = [
    inputs.nix-index-database.homeModules.nix-index
  ];

  # Garbage collect automatically every week
  nix.gc.automatic = true;

  nix.package = lib.mkDefault pkgs.nix;
  home.packages = [
    config.nix.package
  ];

  # Nix configuration is managed globally by nix-darwin.
  # Prevent $HOME nix.conf from disrespecting it.
  home.file."~/.config/nix/nix.conf".text = "";

  programs = {
    home-manager.enable = true;
    nix-index = {
      enable = true;
      enableZshIntegration = true;
    };
    nix-index-database.comma.enable = true;
  };
}
