{ lib, pkgs, ... }:

let
  isDarwin = pkgs.stdenv.isDarwin;
  # macOS config path for Ghostty
  ghosttyConfigPath = "Library/Application Support/com.mitchellh.ghostty/config";
in
{
  config = lib.mkIf isDarwin {
    # Minimal Ghostty config to forward Cmd+ctsr as Meta-ctsr for tmux pane nav
    # and ensure Ctrl+Space reaches the shell (NUL) for zsh autosuggest.
    home.file."${ghosttyConfigPath}" = {
      text = ''
        # tmux pane navigation (BEPO): Cmd+c/t/s/r -> ESC c/t/s/r
        # Note: this overrides the default copy (Cmd+C) and new tab (Cmd+T).
        # You can still copy via Cmd+Shift+C (explicitly mapped below).
        keybind = super+c=esc:c
        keybind = super+t=esc:t
        keybind = super+s=esc:s
        keybind = super+r=esc:r

        # Provide an alternative copy binding since Cmd+C is repurposed above.
        keybind = super+shift+c=copy_to_clipboard

        # Ensure Ctrl+Space is delivered as NUL to the terminal
        keybind = ctrl+space=text:\x00
      '';
    };
  };
}

