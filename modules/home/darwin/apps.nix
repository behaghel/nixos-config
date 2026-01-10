{ pkgs, lib, ... }:
lib.mkIf pkgs.stdenv.isDarwin (
  let
    ghostty = import ../ghostty/common.nix { inherit pkgs lib; };
    inherit (ghostty) ghosttyPkg ghosttyAvailable;
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
