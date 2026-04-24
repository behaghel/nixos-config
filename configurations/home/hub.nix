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
    self.homeModules.dev
    self.homeModules.password-store
    self.homeModules.linux-only
  ];

  me = {
    inherit (user) username fullname email;
  };

  # Keep this headless-friendly: skip graphical extras from linux-only.
  hub.linux.graphicalTools.enable = false;

  programs.gpg.useNixGPG = true;

  hub.mail.enable = true;
  hub.syncthing.enable = lib.mkIf (!pkgs.stdenv.isLinux) true;

  targets.genericLinux.enable = pkgs.stdenv.isLinux;

  home.stateVersion = "24.11";
}
