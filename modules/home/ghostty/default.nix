{ lib, pkgs, ... }:

let
  isDarwin = pkgs.stdenv.isDarwin;
  ghostty = import ./common.nix { inherit pkgs lib; };
  inherit (ghostty) ghosttyPkg ghosttyAvailable;
  # macOS config path for Ghostty
  ghosttyConfigPath = "Library/Application Support/com.mitchellh.ghostty/config";
  ghosttyTerminfo = "${ghosttyPkg.terminfo}/share/terminfo/x/xterm-ghostty";
in
{
  config = lib.mkMerge [
    (lib.mkIf isDarwin {
      # Minimal Ghostty config to forward Cmd+ctsr (and Cmd+Shift+c/r) as Meta-ctsr
      # for tmux navigation, and ensure Ctrl+Space reaches the shell (NUL).
      home.file."${ghosttyConfigPath}" = {
        text = ''
        # tmux navigation (BÉPO):
        # - Cmd+c/t/s/r -> ESC c/t/s/r (Meta on BEPO nav keys)
        # - Cmd+Shift+c/r -> ESC C/R (Meta-Shift for prev/next window)
        # - Alt variants too: Alt+c/t/s/r and Alt+Shift+c/r
        keybind = super+c=esc:c
        keybind = super+t=esc:t
        keybind = super+s=esc:s
        keybind = super+r=esc:r
        # Preserve Shift by sending uppercase (ESC C/R) so tmux can bind M-C/M-R
        keybind = super+shift+c=esc:C
        keybind = super+shift+r=esc:R

        # Alt (Option) variants — map to the same Meta sequences
        keybind = alt+c=esc:c
        keybind = alt+t=esc:t
        keybind = alt+s=esc:s
        keybind = alt+r=esc:r
        keybind = alt+shift+c=esc:C
        keybind = alt+shift+r=esc:R

        # Avoid consuming Cmd+Shift+C/T for tmux; keep paste bindings below.
        # Ensure paste is always available via Cmd+V
        keybind = super+v=paste_from_clipboard
        keybind = super+shift+v=paste_from_selection

        # Ensure Ctrl+Space is delivered as NUL to the terminal
        keybind = ctrl+space=text:\x00

        # Make Cmd+Enter behave like Option+Enter: send Meta-Enter (ESC + CR)
        # This allows tmux bindings for M-Enter to work with either modifier.
        keybind = alt+enter=text:\x1b\x0d
        keybind = super+enter=text:\x1b\x0d

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
    })
    (lib.mkIf ghosttyAvailable {
      # Provide terminfo entry so ncurses tools (e.g., emacsclient -t) understand TERM=xterm-ghostty.
      home.file.".terminfo/x/xterm-ghostty".source = ghosttyTerminfo;
    })
  ];
}
