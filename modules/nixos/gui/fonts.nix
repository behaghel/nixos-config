{ pkgs, ... }:
{
  fonts = {
    packages = with pkgs; [
      # fonts that many things (apps, websites) expect
      dejavu_fonts
      liberation_ttf
      roboto
      raleway
      ubuntu_font_family
      # unfree
      # corefonts
      # helvetica-neue-lt-std
      # fonts I use
      etBook
      emacs-all-the-icons-fonts
      # coding fonts
      source-sans-pro
      source-serif-pro
      nerd-fonts.Iosevka
      nerd-fonts.FiraCode
      nerd-fonts.Hack
      nerd-fonts.Inconsolata
      nerd-fonts.JetBrainsMono
      nerd-fonts.Hasklig
      nerd-fonts.Meslo
      nerd-fonts.Noto
      font-awesome
    ];
  };
}
