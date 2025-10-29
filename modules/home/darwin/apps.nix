{ pkgs, ... }:

{
  home.packages = with pkgs; [
    terminal-notifier
    coreutils
    glaxnimate
    ghostty
  ];
}
