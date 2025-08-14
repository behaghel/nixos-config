
{ pkgs, ... }:

{
  home.packages = with pkgs; [
    terminal-notifier
    coreutils

    glaxnimate
    #nivApps.Dropbox
    nivApps.Anki
    nivApps.VLC
    nivApps.Zotero
    nivApps.Kindle
  ];
}
