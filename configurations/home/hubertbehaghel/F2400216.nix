{ pkgs, ... }:

{
  # Standalone Home Manager activation does not inherit nix-darwin settings.
  hub.yknotify.diagnostics.enable = true;

  home.packages = with pkgs; [
    ffmpeg
  ];
}
