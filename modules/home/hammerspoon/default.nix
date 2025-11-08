{ lib, pkgs, ... }:

let
  isDarwin = pkgs.stdenv.isDarwin;
in
{
  config = lib.mkIf isDarwin {
    # Basic Hammerspoon config to focus apps with Ctrl+Alt+Cmd chords.
    home.file.".hammerspoon/init.lua".text = ''
      -- App focus hotkeys
      local bindings = {
        t = "Ghostty",
        e = "Emacs",
        f = "Firefox",
        v = "VLC",
        s = "Slack",
      }

      for key, appName in pairs(bindings) do
        hs.hotkey.bind({"ctrl","alt","cmd"}, key, function()
          hs.application.launchOrFocus(appName)
          local app = hs.appfinder.appFromName(appName)
          if app then app:activate(true) end
          hs.alert.show("→ " .. appName, 0.5)
        end)
      end

      -- Quick reload: Ctrl+Alt+Cmd+Shift+R
      hs.hotkey.bind({"ctrl","alt","cmd","shift"}, "r", function()
        hs.reload()
        hs.alert.show("Hammerspoon reloaded")
      end)

      hs.alert.show("Hammerspoon ready", 0.3)
    '';
  };
}
