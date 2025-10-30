{ pkgs, lib, ... }:
lib.mkIf pkgs.stdenv.isDarwin (
  let
    ghosttyPkg = pkgs.ghostty;
    ghosttyAvailable = !(ghosttyPkg.meta.broken or false);
  in
  {
    home.packages =
      (with pkgs;
        [
          terminal-notifier
          coreutils
          glaxnimate
          yubikey-manager
          yubikey-personalization
          notunes
          iterm2
        ]
      )
      ++ lib.optional ghosttyAvailable ghosttyPkg;
  }
)
