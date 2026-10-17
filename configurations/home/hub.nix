{ flake, pkgs, lib, ... }:
let
  inherit (flake) inputs;
  inherit (inputs) self;
  user = (import ../../config.nix).me;
in
{
  imports = [
    self.homeModules.default
    self.homeModules.emacs
    self.homeModules.password-store
    self.homeModules.linux-only
  ];

  me = {
    inherit (user) username fullname email;
  };

  # Keep this headless-friendly. Use the nixpkgs devenv package here so
  # evaluating this Linux host on macOS doesn't require a Linux IFD builder.
  hub.linux.graphicalTools.enable = false;
  home.packages = [ pkgs.devenv ];

  programs.gpg.useNixGPG = true;

  hub.mail = {
    enable = true;
    keychainPassEntries = import ./mail-pass-entries.nix;
  };
  hub.syncthing.enable = lib.mkIf (!pkgs.stdenv.isLinux) true;

  targets.genericLinux.enable = pkgs.stdenv.isLinux;

  home.stateVersion = "24.11";
}
