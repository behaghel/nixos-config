{ pkgs, lib, ... }:

{
  imports = [ ./bepo.nix ];
  programs.tmux = {
    enable = true;
    prefix = "C-a";
    terminal = "tmux-256color";
    mouse = true;
    keyMode = "vi";
    baseIndex = 1;
    extraConfig = ''
      unbind C-b
      bind C-a send-prefix

      setw -g mode-keys vi
      setw -g pane-base-index 1

      # Status bar: elegant, sober theme at bottom
      set -g status-position bottom
      set -g status-interval 2
      set -g status-justify centre
      set -g status-style bg=colour234,fg=colour245
      set -g window-status-separator ""
      set -g window-status-style bg=colour234,fg=colour244
      set -g window-status-format " #[fg=colour240]#[fg=colour250,bg=colour240] #I #[fg=colour252]#W #[fg=colour240,bg=colour234] "
      set -g window-status-current-style bg=colour234,fg=colour252
      set -g window-status-current-format " #[fg=colour31]#[fg=colour254,bg=colour31,bold] #I #[fg=colour255]#W #[fg=colour31,bg=colour234] "
      set -g status-left-length 40
      set -g status-right-length 80
      set -g status-left  " #[fg=colour39,bold]#S #[fg=colour240]| #[fg=colour250]#(whoami)@#h "
      set -g status-right " #[fg=colour244]%Y-%m-%d #[fg=colour240]| #[fg=colour250]%H:%M #[fg=colour240]| #[fg=colour246]#{session_windows} win "

      # Border and modes
      set -g pane-border-style fg=colour238
      set -g pane-active-border-style fg=colour39
      set -g message-style bg=colour236,fg=colour250
      set -g mode-style bg=colour24,fg=colour254

      set -ga terminal-overrides ",xterm-256color:RGB"
      set -g set-clipboard on

      # Splits
      bind _ split-window -v
      bind | split-window -h

      # Resizing (BEPO: C/T/S/R)
      unbind -r H
      unbind -r J
      unbind -r K
      unbind -r L
      bind -r C resize-pane -L 5
      bind -r T resize-pane -D 2
      bind -r S resize-pane -U 2
      bind -r R resize-pane -R 5

      # Pane selection (Alt on QWERTY and BEPO)
      unbind -n M-h
      unbind -n M-j
      unbind -n M-k
      unbind -n M-l

      # Copy to system clipboard (Wayland, X11, or macOS)
      if-shell "command -v wl-copy >/dev/null" 'bind -T copy-mode-vi y send -X copy-pipe-and-cancel "wl-copy"'
      if-shell "command -v xclip >/dev/null"   'bind -T copy-mode-vi y send -X copy-pipe-and-cancel "xclip -selection clipboard"'
      if-shell "command -v pbcopy >/dev/null"  'bind -T copy-mode-vi y send -X copy-pipe-and-cancel "pbcopy"'
      bind C-c run-shell "tmux save-buffer - | (wl-copy || xclip -selection clipboard || pbcopy)"

      bind s choose-tree -Zw
      bind S command-prompt -p "New session name:" "new-session -A -s %1"
    '';
  };

  # Simple project/session launcher: tmx [dir] [name]
  home.file.".local/bin/tmx" = {
    executable = true;
    text = ''
      #!/usr/bin/env bash
      set -euo pipefail
      dir="${1:-$PWD}"
      name="${2:-$(basename "$dir")}"
      assist="${ASSIST_CMD:-codex}"
      tmux has-session -t "$name" 2>/dev/null || {
        tmux new-session -d -s "$name" -c "$dir" -n dev
        tmux split-window -h -c "$dir"
        tmux select-pane -L
        tmux send-keys "$assist" C-m
      }
      tmux attach -t "$name"
    '';
  };
}
