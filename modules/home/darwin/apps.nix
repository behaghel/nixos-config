{ pkgs, lib, ... }:
lib.mkIf pkgs.stdenv.isDarwin {
  home.packages = with pkgs; [
    terminal-notifier
    coreutils
    yubikey-manager
    yubikey-personalization
  ];
}
