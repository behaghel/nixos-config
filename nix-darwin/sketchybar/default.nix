{ pkgs, lib, ... }:

let scripts = ./scripts;
in {
  services.sketchybar = {
    enable = true;
    package = pkgs.sketchybar;
    extraPackages = [ pkgs.jq pkgs.gh ];
    config = lib.replaceStrings [("\${" + "scripts" + "}")] ["${scripts}"] (lib.readFile ./sketchybarrc);
  };
  services.yabai.config.external_bar = "main:25:0";
  system.defaults.NSGlobalDomain._HIHideMenuBar = true;
  launchd.user.agents.sketchybar.serviceConfig = {
    StandardErrorPath = "/tmp/sketchybar.log";
    StandardOutPath = "/tmp/sketchybar.log";
  };
}
