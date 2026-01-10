{ pkgs, lib, ... }:

let
  isDarwin = pkgs.stdenv.isDarwin;
  fontsPkgs = with pkgs; [
    # Common fallback/web fonts
    dejavu_fonts
    liberation_ttf
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

  nameOf = p: (p.pname or (lib.getName p));

  linkFor = p:
    let shareFonts = "${p}/share/fonts"; in
    lib.optionalAttrs (builtins.pathExists shareFonts) {
      "Library/Fonts/Nix/${nameOf p}" = {
        source = shareFonts;
        recursive = true;
      };
    };

  fontLinks = lib.mkMerge (map linkFor fontsPkgs);
in
{
  config = lib.mkIf isDarwin {
    # Ensure the font packages are present in the profile so sources exist.
    home.packages = fontsPkgs;

    # Declaratively expose their font directories to macOS by symlinking
    # into ~/Library/Fonts/Nix/<pkg>.
    home.file = fontLinks;
  };
}
