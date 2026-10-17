# Source from Bash or Zsh. The executable remains available for scripts and all
# non-navigation commands; only the calling shell can implement `as <slug> cd`.
as() {
  local action="${2-}"
  case "${1-}" in
    --) action="${3-}" ;;
    status|finish|completion|__complete) action= ;;
  esac
  if [ "$action" = cd ] && [ -n "${AGENT_SESSION_CONFIG-}" ]; then
    local target
    target="$(command agent-session "$@")" || return $?
    builtin cd -- "$target"
  else
    command as "$@"
  fi
}
