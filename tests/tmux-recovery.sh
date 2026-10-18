#!/usr/bin/env bash
# All tmux operations are confined to a disposable socket and HOME.
set -euo pipefail
root=$(mktemp -d)
export HOME="$root/home"
mkdir -p "$HOME" "$root/project-a" "$root/project-b" "$root/snapshots"
socket="$root/tmux.sock"
unset TMUX TMUX_TMPDIR
cleanup() {
  tmux -S "$socket" kill-server 2>/dev/null || true
  rm -rf "$root"
}
trap cleanup EXIT

start_server() {
  tmux -S "$socket" -f /dev/null new-session -d -s recovery -n first -c "$root/project-a" "$(command -v bash) --norc --noprofile"
  tmux -S "$socket" set-option -g default-shell "$(command -v bash)"
  tmux -S "$socket" set-option -g @resurrect-dir "$root/snapshots"
  tmux -S "$socket" set-option -g @resurrect-processes false
  tmux -S "$socket" set-option -g @resurrect-capture-pane-contents on
}
layout() {
  # Pane IDs and layout checksums legitimately change after restoration.
  tmux -S "$socket" list-windows -a -F '#{session_name}:#{window_index}:#{window_name}'
  tmux -S "$socket" list-panes -a -F '#{session_name}:#{window_index}.#{pane_index}:#{pane_width}x#{pane_height}:#{pane_left},#{pane_top}:#{pane_current_path}'
}
start_server
# No attached clients; save still works without a status-bar callback.
tmux -S "$socket" set-option -g status off
tmux -S "$socket" set-option -g status-right 'custom status without continuum'
tmux -S "$socket" split-window -h -t recovery:0 -c "$root/project-b"
tmux -S "$socket" new-window -d -t recovery:1 -n second -c "$root/project-b"
tmux -S "$socket" send-keys -t recovery:0.0 'echo snapshot-test-content' Enter
for _ in {1..50}; do
  if tmux -S "$socket" capture-pane -p -t recovery:0.0 | grep -q snapshot-test-content; then break; fi
  sleep 0.1
done
layout > "$root/expected"
"$SNAPSHOT" --socket "$socket"
test -s "$root/snapshots/last"
grep -q 'project-b' "$root/snapshots/last"
test -s "$root/snapshots/pane_contents.tar.gz"

# Include a subsequent layout change: restoring must use the newest layout.
tmux -S "$socket" rename-window -t recovery:1 latest
layout > "$root/expected"
# resurrect filenames have one-second resolution.
sleep 1
"$SNAPSHOT" --socket "$socket"
grep -q ':latest' "$root/snapshots/last"
tmux -S "$socket" kill-server
for _ in {1..50}; do
  if ! tmux -S "$socket" has-session 2>/dev/null; then break; fi
  sleep 0.1
done
start_server
pid=$(tmux -S "$socket" display-message -p '#{pid}')
export TMUX="$socket,$pid,0"
# Resurrect's client-selection messages are expected without attached clients.
bash "$RESURRECT/scripts/restore.sh" > "$root/restore.log" 2>&1
layout > "$root/actual"
diff -u "$root/expected" "$root/actual"
echo 'ok: latest detached layout and working directories survive server replacement'

# A missing socket must not start a server or replace the saved layout.
cp -L "$root/snapshots/last" "$root/saved"
"$SNAPSHOT" --socket "$root/missing.sock"
test ! -S "$root/missing.sock"
cmp "$root/saved" "$root/snapshots/last"
echo 'ok: absent server is a harmless no-op'
