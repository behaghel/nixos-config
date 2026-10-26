# Source in Fish; the installed executable still handles all other commands.
function as --wraps=agent-session --description 'Coding-agent worktree sessions'
  set -l action "$argv[2]"
  switch "$argv[1]"
    case --
      set action "$argv[3]"
    case status list batch doctor finish completion __complete
      set action ''
  end
  if test "$action" = cd; and test -n "$AGENT_SESSION_CONFIG"
    set -l target (command agent-session $argv)
    or return $status
    builtin cd -- "$target"
  else
    command as $argv
  end
end
