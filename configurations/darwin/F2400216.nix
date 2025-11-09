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
  nixpkgs.config.allowUnfree = true;
  networking.hostName = "F2400216";

  system.primaryUser = "hubertbehaghel";

  # Users provisioned on this host
  myusers = [ "hubertbehaghel" ];

  environment.systemPackages = [
    pkgs.jdk21_headless
  ];

  hub.darwin.apps = {
    enable = true;
    casks = [
      "anki"
      "zotero"
      "1password"
      "ghostty"
      "iterm2"
      "notunes"
      "vlc"
      "dropbox"
      "hammerspoon"
      "grishka/grishka/neardrop"
      "firefox"
    ];
  };

  # Use Touch ID for sudo on macOS (new option name in nix-darwin).
  security.pam.services.sudo_local.touchIdAuth = true;
}
