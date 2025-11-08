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
        # Ensure paste is always available via Cmd+V
        keybind = super+v=paste_from_clipboard
        keybind = super+shift+v=paste_from_selection

        # Ensure Ctrl+Space is delivered as NUL to the terminal
        keybind = ctrl+space=text:\x00

        # Enter tmux copy-mode with Cmd+/ by sending Meta+.
        # On Bépo, '.' collides with Cmd+V (period on V key). Slash avoids paste.
        # tmux binds M-. to copy-mode in our config.
        keybind = super+slash=esc:.

        # Provide an easy config reload in case bindings don't seem applied
        keybind = super+shift+u=reload_config

        # Let macOS Mission Control handle these by not binding them in Ghostty
        # (avoid consuming the events at the app level)
        # We do not bind Ctrl+1..9 because on Bépo these require Shift for
        # digits and we want macOS to match Ctrl + the unshifted top-row keys
        # instead via AppleSymbolicHotKeys (ascii 0 with digit keycodes).

        # Allow macOS Mission Control to use Ctrl+Left/Right by not handling
        # these in Ghostty. This prevents the terminal from consuming them.
        keybind = ctrl+arrow_left=ignore
        keybind = ctrl+arrow_right=ignore

        # Explicitly ignore Ctrl+1..9 (and Ctrl+Shift+1..9) so Mission Control
        # can handle direct desktop switching without the terminal beeping.
        keybind = ctrl+1=ignore
        keybind = ctrl+2=ignore
        keybind = ctrl+3=ignore
        keybind = ctrl+4=ignore
        keybind = ctrl+5=ignore
        keybind = ctrl+6=ignore
        keybind = ctrl+7=ignore
        keybind = ctrl+8=ignore
        keybind = ctrl+9=ignore
        keybind = ctrl+shift+1=ignore
        keybind = ctrl+shift+2=ignore
        keybind = ctrl+shift+3=ignore
        keybind = ctrl+shift+4=ignore
        keybind = ctrl+shift+5=ignore
        keybind = ctrl+shift+6=ignore
        keybind = ctrl+shift+7=ignore
        keybind = ctrl+shift+8=ignore
        keybind = ctrl+shift+9=ignore

        # Handy: reload Ghostty configuration
        keybind = super+shift+period=reload_config
      '';
    };
  };
}
