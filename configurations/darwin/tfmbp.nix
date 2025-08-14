# Configuration for my M1 Macbook Max (using nix-darwin)
{ pkgs, flake, ... }:

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
  networking.hostName = "tfmbp";

  # Used for backwards compatibility, please read the changelog before changing.
  # $ darwin-rebuild changelog
  system.stateVersion = 4;

  environment.systemPackages = [ pkgs.jdk21_headless ]; # for languagetools from Emacs

  home-manager.users.${flake.config.me.username} = {
    imports = [
      ../../modules/home/firefox
      ../../modules/home/kitty
      ../../modules/home/alacritty
      ../../modules/home/texlive
      ../../modules/home/emacs
      ../../modules/home/password-store
      ../../modules/home/dircolors
      ../../modules/home/macos-apps
    ];
  };
}
