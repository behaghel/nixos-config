{ pkgs, lib, ... }:

let
  isDarwin = pkgs.stdenv.isDarwin;
  fontsPkgs = with pkgs; [
    # Common fallback/web fonts
    dejavu_fonts
    liberation_ttf
    inter
    roboto
    raleway
    ubuntu-classic
    # Personal/fonts used in Emacs
    etBook
    emacs-all-the-icons-fonts
    # Coding fonts (Nerd Fonts variants provide symbols/icons)
    source-sans-pro
    source-serif-pro
    nerd-fonts.iosevka
    nerd-fonts.fira-code
    nerd-fonts.hack
    nerd-fonts.inconsolata
    nerd-fonts.jetbrains-mono
    nerd-fonts.hasklug
    nerd-fonts.noto
    font-awesome
  ];

in
{
  config = lib.mkIf isDarwin {
    # Keep font packages in the profile without exploding each font file into a
    # Home Manager link. Recursive links under ~/Library/Fonts made activation
    # spend minutes in checkLinkTargets/linkGeneration/cleanOldGen.
    home.packages = fontsPkgs;
  };
}
