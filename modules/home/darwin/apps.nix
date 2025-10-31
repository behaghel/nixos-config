{ pkgs, lib, ... }:
lib.mkIf pkgs.stdenv.isDarwin (
  let
    ghosttyPkg = pkgs.ghostty;
    ghosttyAvailable = !(ghosttyPkg.meta.broken or false);
  in
  {
    home.packages =
      (with pkgs; [
        terminal-notifier
        coreutils
        yubikey-manager
        yubikey-personalization
      ])
      ++ lib.optional ghosttyAvailable ghosttyPkg;
  }
)
