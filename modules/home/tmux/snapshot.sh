# Invoked by tmux-snapshot's Nix wrapper; never creates a tmux server.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  uid=$(id -u)
  socket="$TMUX_SNAPSHOT_ROOT/tmux-$uid/default"
  if ! tmux -S "$socket" has-session 2>/dev/null; then
    # Existing pre-migration servers may still use tmux's legacy socket.
    socket="/tmp/tmux-$uid/default"
  fi
elif [ "$#" -eq 2 ] && [ "$1" = --socket ]; then
  socket=$2
else
  echo 'Usage: tmux-snapshot [--socket PATH]' >&2
  exit 2
fi

if ! tmux -S "$socket" has-session 2>/dev/null; then
  exit 0
fi

# Resurrect invokes tmux internally. Pin those calls to the selected server,
# not a caller's inherited TMUX context or the scheduler's socket defaults.
pid=$(tmux -S "$socket" display-message -p '#{pid}')
export TMUX="$socket,$pid,0"
unset TMUX_TMPDIR
bash "$TMUX_SNAPSHOT_SAVE_SCRIPT" quiet
