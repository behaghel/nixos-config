{ pkgs, lib, ... }:
lib.mkIf pkgs.stdenv.isDarwin (
  {
    home.packages =
      (with pkgs; [
        terminal-notifier
        coreutils
        glaxnimate
        yubikey-manager
        yubikey-personalization
      ]);
  }
)
