{ ... }:

{
  # BEPO navigation: map c t s r to hjkl equivalents
  programs.tmux.extraConfig = ''
    # Pane navigation with Meta on BEPO keys
    bind -n M-c select-pane -L
    bind -n M-t select-pane -D
    bind -n M-s select-pane -U
    bind -n M-r select-pane -R

    # Leave Alt+Arrow to applications (Pi uses Alt+Up to edit queued messages).
    # Explicitly clear the old pane bindings when reloading an existing server.
    unbind -n M-Left
    unbind -n M-Down
    unbind -n M-Up
    unbind -n M-Right

    # Copy-mode vi movement on BEPO keys
    bind -T copy-mode-vi c send -X cursor-left
    bind -T copy-mode-vi t send -X cursor-down
    bind -T copy-mode-vi s send -X cursor-up
    bind -T copy-mode-vi r send -X cursor-right

    # Additional BEPO motion helpers
    bind -T copy-mode-vi é send -X next-word

    # Optional: remap 'h' similar to Vim 'f/t' motions (tmux supports 'jump-to-forward/backward')
    bind -T copy-mode-vi h send -X jump-to-forward
    bind -T copy-mode-vi H send -X jump-to-backward

    # Window navigation on BEPO keys
    bind -n M-R next-window      # next window
    bind -n M-C previous-window  # previous window
    # Also support explicit Shift-modified forms
    bind -n M-S-R next-window      # next window (Shift)
    bind -n M-S-C previous-window  # previous window (Shift)
  '';
}
