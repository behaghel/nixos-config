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
      nerd-fonts.iosevka
      nerd-fonts.fira-code
      nerd-fonts.hack
      nerd-fonts.inconsolata
      nerd-fonts.jetbrains-mono
      nerd-fonts.hasklig
      nerd-fonts.meslo
      nerd-fonts.noto
      font-awesome
    ];
  };
}
