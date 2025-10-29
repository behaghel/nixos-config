{ config, pkgs, lib, ... }:
let
  ghosttyBin = lib.getExe pkgs.ghostty;
  hmApps = "${config.home.homeDirectory}/Applications/Home Manager Apps";
  openApp = app: "exec-and-forget /usr/bin/open -na ${lib.escapeShellArg app}";
  openFirefoxProfile = profile:
    "exec-and-forget /usr/bin/open -na ${lib.escapeShellArg "${hmApps}/Firefox.app"} --args -P ${lib.escapeShellArg profile}";
in
{
  home.file.".config/aerospace/aerospace.toml".text = ''
after-startup-command = []
start-at-login = false
enable-normalization-flatten-containers = true
enable-normalization-opposite-orientation-for-nested-containers = true
accordion-padding = 10
default-root-container-layout = 'tiles'
default-root-container-orientation = 'auto'
automatically-unhide-macos-hidden-apps = false

[key-mapping]
    preset = 'qwerty'

[gaps]
    inner.horizontal = 0
    inner.vertical = 0
    outer.left = 0
    outer.bottom = 0
    outer.top = 0
    outer.right = 0

[mode.main.binding]
    alt-enter = "exec-and-forget ${ghosttyBin}"
    alt-shift-enter = "${openApp "${hmApps}/Kitty.app"}"
    alt-b = "${openFirefoxProfile "home"}"
    alt-shift-b = "${openFirefoxProfile "work"}"
    alt-e = "${openApp "${hmApps}/Emacs.app"}"

    alt-c = "focus left"
    alt-t = "focus down"
    alt-s = "focus up"
    alt-r = "focus right"
    alt-d = "focus dfs-prev"
    alt-g = "focus dfs-next"
    alt-l = "focus-back-and-forth"

    alt-shift-c = "move left"
    alt-shift-t = "move down"
    alt-shift-s = "move up"
    alt-shift-r = "move right"

    alt-h = "layout horizontal vertical"
    alt-v = "layout horizontal vertical"
    alt-f = "fullscreen"
    alt-m = "macos-native-fullscreen"
    alt-period = "layout floating tiling"

    alt-tab = "workspace-back-and-forth"
    alt-left = "workspace --wrap-around prev"
    alt-right = "workspace --wrap-around next"

    alt-1 = "workspace 1"
    alt-2 = "workspace 2"
    alt-3 = "workspace 3"
    alt-4 = "workspace 4"
    alt-5 = "workspace 5"
    alt-6 = "workspace 6"
    alt-7 = "workspace 7"
    alt-8 = "workspace 8"
    alt-9 = "workspace 9"
    alt-0 = "workspace 10"

    alt-shift-1 = ['move-node-to-workspace 1', 'workspace 1']
    alt-shift-2 = ['move-node-to-workspace 2', 'workspace 2']
    alt-shift-3 = ['move-node-to-workspace 3', 'workspace 3']
    alt-shift-4 = ['move-node-to-workspace 4', 'workspace 4']
    alt-shift-5 = ['move-node-to-workspace 5', 'workspace 5']
    alt-shift-6 = ['move-node-to-workspace 6', 'workspace 6']
    alt-shift-7 = ['move-node-to-workspace 7', 'workspace 7']
    alt-shift-8 = ['move-node-to-workspace 8', 'workspace 8']
    alt-shift-9 = ['move-node-to-workspace 9', 'workspace 9']
    alt-shift-0 = ['move-node-to-workspace 10', 'workspace 10']

    ctrl-alt-shift-c = "move-workspace-to-monitor left"
    ctrl-alt-shift-r = "move-workspace-to-monitor right"

    alt-escape = ['reload-config']
  '';
}
