{ pkgs, lib, ... }:
lib.mkIf pkgs.stdenv.isDarwin {
  home.packages = with pkgs; [
    terminal-notifier
    coreutils
    glaxnimate
    ghostty
    yubikey-manager
    yubikey-personalization
  ];
}
