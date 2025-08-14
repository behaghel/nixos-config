
{ pkgs, ... }:

{
  programs.browserpass = {
    enable = true;
    browsers = [ "firefox" "chromium" ];
  };

  home.packages = with pkgs; [
    browserpass
  ];
}
