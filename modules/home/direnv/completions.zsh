# Loaded after the managed direnv hook. Direnv can replace FPATH after compinit,
# dropping functions that were registered when Zsh started.
typeset -ga __direnv_original_fpath
__direnv_original_fpath=("$fpath[@]")
typeset -g __direnv_agent_completion_dir=''
typeset -g __direnv_agent_previous_completion=''

__direnv_sync_completions() {
  local directory entry
  # Restore startup completion locations without discarding project additions.
  for entry in "${__direnv_original_fpath[@]}"; do
    (( ${fpath[(I)$entry]} )) || fpath+=("$entry")
  done

  directory=''
  if [[ -n ${AGENT_SESSION_COMPLETION_ROOT:-} &&
        -r $AGENT_SESSION_COMPLETION_ROOT/zsh/site-functions/_agent_session ]]; then
    directory=$AGENT_SESSION_COMPLETION_ROOT/zsh/site-functions
  fi

  if [[ -n $__direnv_agent_completion_dir && $__direnv_agent_completion_dir != $directory ]]; then
    # Only undo our own registration; never remove another project's mapping.
    if [[ ${_comps[agent-session]-} == _agent_session ]]; then
      if [[ -n $__direnv_agent_previous_completion ]]; then
        compdef "$__direnv_agent_previous_completion" agent-session
      else
        unset '_comps[agent-session]'
      fi
    fi
    if (( ! ${__direnv_original_fpath[(I)$__direnv_agent_completion_dir]} )); then
      fpath=("${(@)fpath:#$__direnv_agent_completion_dir}")
    fi
    __direnv_agent_completion_dir=''
  fi

  if [[ -n $directory ]]; then
    (( ${fpath[(I)$directory]} )) || fpath+=("$directory")
    if [[ -z $__direnv_agent_completion_dir ]]; then
      __direnv_agent_previous_completion=${_comps[agent-session]-}
      __direnv_agent_completion_dir=$directory
    fi
    compdef _agent_session agent-session
  fi
}

# direnv prepends its hook to both arrays; our hook follows its export.
if (( ${chpwd_functions[(I)_direnv_hook]} )); then
  chpwd_functions+=(__direnv_sync_completions)
  precmd_functions+=(__direnv_sync_completions)
fi
