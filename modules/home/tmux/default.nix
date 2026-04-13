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
      # Prefix and key handling
      set -g prefix C-a
      unbind C-b
      bind C-a send-prefix
      set -g xterm-keys on
      set -s extended-keys on
      set -s escape-time 10
      # Surface bell activity from any window.
      set -g bell-action any
      set -g visual-bell on
      setw -g monitor-bell on
      set-hook -g alert-bell 'run-shell "$HOME/.local/bin/tmux-bell-notify \"#{session_name}\" \"#{window_name}\" \"#{pane_current_command}\""'

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
      bind - split-window -v
      bind _ split-window -v
      bind | split-window -h

      # Resizing (BEPO: C/T/S/R)
      unbind H
      unbind J
      unbind K
      unbind L
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

      # Reload config: prefix + r (reloads XDG path symlinked by Home Manager)
      bind r source-file "$HOME/.config/tmux/tmux.conf" \; display-message "tmux config reloaded"

      # Equalize pane widths across the window
      bind = select-layout even-horizontal

      # Enter copy-mode with comma
      unbind ,
      bind , copy-mode

      # Window navigation shortcuts
      unbind -n M-,
      bind -n M-, last-window   # previous selected window
      unbind -n M-.
      bind -n M-. copy-mode     # enter copy-mode

      # Toggle zoom for the active pane (acts like full-screen for the window)
      bind f resize-pane -Z

      # Rename current window with prefix + l
      bind l command-prompt -I "#W" "rename-window '%%'"

      # Extra paste shortcut: prefix + Ctrl-y
      bind C-y paste-buffer

      # Close current window: prefix + k
      bind k kill-window

      # Notification self-test: prefix + N
      bind N run-shell "$HOME/.local/bin/agent-notify 'tmux' 'Manual notification test'"
    '';
  };

  home.file.".local/bin/agent-notify" = {
    executable = true;
    text = ''
      #!/usr/bin/env sh
      set -u

      ring_bell=1
      if [ "''${1-}" = "--no-bell" ]; then
        ring_bell=0
        shift
      fi

      title="''${1:-Agent done}"
      message="''${2:-Task finished}"

      if command -v terminal-notifier >/dev/null 2>&1; then
        terminal-notifier -title "$title" -message "$message" >/dev/null 2>&1 || true
      elif command -v notify-send >/dev/null 2>&1; then
        notify-send "$title" "$message" >/dev/null 2>&1 || true
      elif [ -x /usr/bin/osascript ]; then
        esc_title="$(printf '%s' "$title" | sed 's/\\/\\\\/g; s/"/\\"/g')"
        esc_message="$(printf '%s' "$message" | sed 's/\\/\\\\/g; s/"/\\"/g')"
        /usr/bin/osascript -e "display notification \"$esc_message\" with title \"$esc_title\"" >/dev/null 2>&1 || true
      fi

      if [ "$ring_bell" = "1" ]; then
        printf '\a' || true
      fi

      # And mirror in tmux status line when applicable.
      if [ -n "''${TMUX-}" ] && command -v tmux >/dev/null 2>&1; then
        tmux display-message "$title: $message" >/dev/null 2>&1 || true
      fi
    '';
  };

  home.file.".local/bin/tmux-bell-notify" = {
    executable = true;
    text = ''
      #!/usr/bin/env sh
      set -u

      session="''${1:-unknown-session}"
      window="''${2:-unknown-window}"
      pane_cmd="''${3:-unknown-cmd}"

      uid="$(id -u 2>/dev/null || echo user)"
      stamp="/tmp/tmux-bell-notify-''${uid}.stamp"
      debounce="''${TMUX_BELL_NOTIFY_DEBOUNCE:-2}"

      now="$(date +%s 2>/dev/null || echo 0)"
      last=0
      if [ -r "$stamp" ]; then
        last="$(cat "$stamp" 2>/dev/null || echo 0)"
      fi

      if [ "$now" -gt 0 ] && [ "$last" -gt 0 ]; then
        if [ $((now - last)) -lt "$debounce" ]; then
          exit 0
        fi
      fi

      printf '%s\n' "$now" > "$stamp" 2>/dev/null || true

      "$HOME/.local/bin/agent-notify" --no-bell "🔔 tmux bell" "$session/$window • $pane_cmd"
    '';
  };

  home.file.".local/bin/workon-assistant" = {
    executable = true;
    text = ''
      #!/usr/bin/env sh
      set -u

      export DEVENV_TUI="''${DEVENV_TUI:-false}"

      resolve_default_assistant() {
        opencode_path="$(command -v opencode 2>/dev/null || true)"
        if [ -n "$opencode_path" ] && [ -x "$opencode_path" ]; then
          printf '%s\n' "$opencode_path"
          return 0
        fi

        for candidate in /opt/homebrew/bin/opencode /usr/local/bin/opencode; do
          if [ -x "$candidate" ]; then
            printf '%s\n' "$candidate"
            return 0
          fi
        done

        printf '%s\n' "opencode"
      }

      if [ "$#" -eq 0 ]; then
        cmd="$(resolve_default_assistant)"
      else
        cmd="$*"
      fi

      started="$(date +%s 2>/dev/null || echo 0)"

      set +e
      eval "$cmd"
      rc=$?
      set -e

      ended="$(date +%s 2>/dev/null || echo 0)"
      if [ "$started" -gt 0 ] && [ "$ended" -ge "$started" ]; then
        elapsed="$((ended - started))s"
      else
        elapsed="unknown duration"
      fi

      if [ "$rc" -eq 0 ]; then
        title="✅ Agent finished"
      else
        title="⚠️ Agent exited ($rc)"
      fi

      "$HOME/.local/bin/agent-notify" "$title" "$cmd • $elapsed"
      exit "$rc"
    '';
  };

  # Simple project/session launcher: workon [options] [dir] [name] [window]
  # -a, --assistant CMD   One-off override for assistant command
  # Env override: ASSIST_CMD
  # Env override: WORKON_NOTIFY_ON_EXIT=0 disables completion wrapper
  # Project discovery: looks for .workon-assistant or .workonrc up the tree
  home.file.".local/bin/workon" = {
    executable = true;
    text = ''
      #!/usr/bin/env sh
      # workon: ensure a session, and on each call create a new two-pane window
      # Usage: workon [-a|--assistant CMD] [dir] [session-name] [window-name]
      # Be POSIX-sh friendly; enable pipefail only when supported (bash/zsh)
      set -eu
      if [ "''${BASH-}''${ZSH_VERSION-}" ]; then
        set -o pipefail 2>/dev/null || true
      fi

      usage() {
        cat <<EOF
Usage: workon [-a|--assistant CMD] [dir] [session-name] [window-name]

Options:
  -a, --assistant CMD   One-off assistant command to run in left pane
  -h, --help            Show this help and exit

Resolution order for assistant command:
  1) CLI flag -a/--assistant
  2) Env var ASSIST_CMD
  3) Project file .workon-assistant (plain command, first non-empty non-comment line)
  4) Project file .workonrc (ASSIST_CMD=...)
  5) Default: opencode

By default, assistant commands run via a completion wrapper that sends a
desktop notification + bell when the process exits.
Set WORKON_NOTIFY_ON_EXIT=0 to disable this behavior.
EOF
      }

      # Parse options
      assistant_override=""
      while [ $# -gt 0 ]; do
        case "$1" in
          -a|--assistant)
            if [ $# -lt 2 ]; then echo "Missing value for $1" >&2; exit 2; fi
            assistant_override="$2"; shift 2 ;;
          -h|--help)
            usage; exit 0 ;;
          --)
            shift; break ;;
          -*)
            echo "Unknown option: $1" >&2; usage; exit 2 ;;
          *)
            break ;;
        esac
      done

      dir="''${1:-$PWD}"
      name="''${2:-$(basename "$dir")}"
      wname="''${3:-$(basename "$dir")}"

      # Discover assistant command from project files up the directory tree
      discover_assistant() {
        d="$1"
        while true; do
          if [ -f "$d/.workon-assistant" ]; then
            # First non-empty, non-comment line is the command
            sed -E '/^[[:space:]]*#/d; /^[[:space:]]*$/d; q' "$d/.workon-assistant"
            return 0
          fi
          if [ -f "$d/.workonrc" ]; then
            # Extract ASSIST_CMD=... (strip surrounding quotes and whitespace)
            awk -F= '/^ASSIST_CMD[[:space:]]*=/ {val=$2; gsub(/^[ \t"\047]+|[ \t"\047]+$/, "", val); print val; exit}' "$d/.workonrc"
            return 0
          fi
          if [ "$d" = "/" ] || [ -z "$d" ]; then
            break
          fi
          parent="$(dirname "$d")"
          if [ "$parent" = "$d" ]; then
            break
          fi
          d="$parent"
        done
        return 0
      }

      resolve_default_assistant() {
        opencode_path="$(command -v opencode 2>/dev/null || true)"
        if [ -n "$opencode_path" ] && [ -x "$opencode_path" ]; then
          printf '%s\n' "$opencode_path"
          return 0
        fi

        for candidate in /opt/homebrew/bin/opencode /usr/local/bin/opencode; do
          if [ -x "$candidate" ]; then
            printf '%s\n' "$candidate"
            return 0
          fi
        done

        printf '%s\n' "opencode"
      }

      assist="''${assistant_override-}"
      if [ -z "''${assist-}" ]; then
        assist="''${ASSIST_CMD-}"
      fi
      if [ -z "''${assist-}" ]; then
        assist="$(discover_assistant "$dir" | head -n1)"
      fi
      if [ -z "''${assist-}" ]; then
        assist="$(resolve_default_assistant)"
      fi

      launch_cmd="$assist"
      if [ "''${WORKON_NOTIFY_ON_EXIT:-1}" = "1" ]; then
        launch_cmd="$HOME/.local/bin/workon-assistant \"$assist\""
      fi

      if [ "''${WORKON_DEBUG-}" = "1" ]; then
        echo "workon: dir=$dir name=$name wname=$wname assist=$assist launch=$launch_cmd" >&2
      fi

      if command -v tmux >/dev/null 2>&1; then
        tmux start-server >/dev/null 2>&1 || true
        tmux set-environment -g PATH "$PATH" >/dev/null 2>&1 || true
      fi

      if tmux has-session -t "$name" 2>/dev/null; then
        # Create a new window in the existing session
        idx="$(tmux new-window -P -F '#I' -t "$name" -c "$dir" -n "$wname")"
        # Layout: assistant (left) + shell (right)
        pane="$(tmux split-window -h -b -P -F '#{pane_id}' -t "$name:$idx" -c "$dir")"
        tmux send-keys -t "$pane" "$launch_cmd" C-m
        tmux select-pane -t "$pane"
        # Focus the new window
        tmux select-window -t "$name:$idx"
        if [ -z "''${TMUX-}" ]; then
          tmux attach -t "$name"
        fi
      else
        # Create session and first window
        tmux new-session -d -s "$name" -c "$dir" -n "$wname"
        pane="$(tmux split-window -h -b -P -F '#{pane_id}' -t "$name:1" -c "$dir")"
        tmux send-keys -t "$pane" "$launch_cmd" C-m
        tmux select-pane -t "$pane"
        tmux select-window -t "$name:1"
        if [ -n "''${TMUX-}" ]; then
          tmux switch-client -t "$name"
        else
          tmux attach -t "$name"
        fi
      fi
    '';
  };
}
