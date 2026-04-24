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

  myusers = [ "hub" ];

  nix.linux-builder.enable = true;

  environment.systemPackages = [
    pkgs.gemini-cli
    pkgs.jdk21_headless # for languagetools from Emacs
  ];

  hub.darwin.apps = {
    casks = [
      "anki"
      "zotero"
    ];
  };

  # No Touch ID override for sudo; fall back to default PAM stack.
}
