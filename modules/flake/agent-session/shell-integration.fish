# Source in Fish; the installed executable still handles all other commands.
function as --wraps=agent-session --description 'Coding-agent worktree sessions'
  if test "$argv[1]" = cd; and test -n "$AGENT_SESSION_CONFIG"
    set -l target (command agent-session $argv)
    or return $status
    builtin cd -- "$target"
  else
    command as $argv
  end
end
