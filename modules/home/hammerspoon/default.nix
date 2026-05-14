{ config, lib, pkgs, ... }:

let
  isDarwin = pkgs.stdenv.isDarwin;
  mailStatusFile = config.hub.mail.statusFile or (config.home.homeDirectory + "/.cache/mail-sync/status.json");
in
{
  config = lib.mkIf isDarwin {
    home.file = {
      ".hammerspoon/init.lua".source = ./init.lua;
      ".hammerspoon/hotkeys.lua".source = ./hotkeys.lua;
      ".hammerspoon/windows.lua".source = ./windows.lua;
      ".hammerspoon/mail.lua".source = ./mail.lua;
      ".hammerspoon/draw.lua".source = ./draw.lua;
      ".hammerspoon/settings.lua".text = ''
        return {
          mail = {
            statusFile = ${builtins.toJSON mailStatusFile},
            logFile = ${builtins.toJSON "${config.home.homeDirectory}/Library/Logs/mail-sync.log"},
          },
        }
      '';
    };

    # Ensure Hammerspoon launches at login for the GUI session.
    launchd.agents.hammerspoon = {
      enable = true;
      config = {
        Label = "org.nixos.hammerspoon";
        ProgramArguments = [
          "/bin/sh"
          "-lc"
          ''
            # Launch quietly if installed; ignore failures if missing.
            /usr/bin/open -gj -a "Hammerspoon" || true
          ''
        ];
        RunAtLoad = true;
        KeepAlive = false;
        StandardOutPath = "${config.home.homeDirectory}/Library/Logs/hammerspoon-launch.log";
        StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/hammerspoon-launch.log";
      };
    };
  };
}
