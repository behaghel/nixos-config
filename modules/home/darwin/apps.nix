{ pkgs, lib, ... }:
lib.mkIf pkgs.stdenv.isDarwin {
  home.packages = with pkgs; [
    coreutils
    yubikey-manager
    yubikey-personalization
  ];
}
