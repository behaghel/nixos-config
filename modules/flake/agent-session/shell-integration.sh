# Source from Bash or Zsh. The executable remains available for scripts and all
# non-navigation commands; only the calling shell can implement `as cd`.
as() {
  if [ "${1-}" = cd ] && [ -n "${AGENT_SESSION_CONFIG-}" ]; then
    local target
    target="$(command agent-session "$@")" || return $?
    builtin cd -- "$target"
  else
    command as "$@"
  fi
}
