{ flake, pkgs, ... }:
let
  inherit (flake) inputs;
  inherit (inputs) self;
in
{
  imports = [
    self.homeModules.default
    self.homeModules.linux-only
    self.homeModules.dev
    self.homeModules.alacritty
  ];
  # Defined by /modules/home/me.nix
  # And used all around in /modules/home/*
  me = {
    username = "hubertbehaghel";
    fullname = "Hubert Behaghel";
    email = "hubert.behaghel@veriff.net";
  };

  home.stateVersion = "24.11";

  # Linux-specific Alacritty configuration to fix OpenGL issues
  programs.alacritty.settings = {
    general.live_config_reload = true;
    env.LIBGL_ALWAYS_SOFTWARE = "1";
  };

  # Ensure Mesa software rendering is available on Linux
  home.packages = with pkgs; [
    mesa
  ];
}
