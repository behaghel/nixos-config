{ ... }:

{
  # BEPO navigation: map c t s r to hjkl equivalents
  programs.tmux.extraConfig = ''
    # Pane navigation with Meta on BEPO keys
    bind -n M-c select-pane -L
    bind -n M-t select-pane -D
    bind -n M-s select-pane -U
    bind -n M-r select-pane -R

    # Copy-mode vi movement on BEPO keys
    bind -T copy-mode-vi c send -X cursor-left
    bind -T copy-mode-vi t send -X cursor-down
    bind -T copy-mode-vi s send -X cursor-up
    bind -T copy-mode-vi r send -X cursor-right

    # Optional: remap h/l to vi-like motions (BEPO preference)
    bind -T copy-mode-vi h send -X jump-to-forward
    bind -T copy-mode-vi H send -X jump-to-backward
  '';
}
