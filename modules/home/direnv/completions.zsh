# Direnv exports can replace FPATH after compinit has registered startup functions.
# Projects declare colon-separated absolute directories in
# DIRENV_ZSH_COMPLETION_DIRS, not commands or executable scripts.
typeset -ga __direnv_original_fpath __direnv_completion_dirs __direnv_added_dirs
__direnv_original_fpath=("$fpath[@]")
__direnv_completion_dirs=()
__direnv_added_dirs=()
typeset -gA __direnv_previous_comps __direnv_registered_comps __direnv_had_comp

__direnv_sync_completions() {
  local directory command changed=0
  local -a wanted
  local -A before

  for directory in "${__direnv_original_fpath[@]}"; do
    (( ${fpath[(Ie)$directory]} )) || fpath+=("$directory")
  done

  wanted=()
  for directory in "${(s/:/)DIRENV_ZSH_COMPLETION_DIRS:-}"; do
    # Absolute, accessible directories only. Do not source project code.
    [[ $directory == /* && -d $directory && -r $directory && -x $directory ]] || continue
    (( ${wanted[(Ie)$directory]} )) || wanted+=("$directory")
  done

  [[ "${(j/:/)wanted}" == "${(j/:/)__direnv_completion_dirs}" ]] || changed=1
  for directory in "${__direnv_added_dirs[@]}"; do
    if (( ! ${wanted[(Ie)$directory]} && ! ${__direnv_original_fpath[(Ie)$directory]} )); then
      fpath=("${(@)fpath:#$directory}")
    fi
  done
  local -a added
  added=()
  for directory in "${wanted[@]}"; do
    if (( ! ${fpath[(Ie)$directory]} )); then
      fpath+=("$directory")
      added+=("$directory")
    elif (( ${__direnv_added_dirs[(Ie)$directory]} )); then
      added+=("$directory")
    fi
  done
  __direnv_added_dirs=("${added[@]}")
  (( changed )) || return 0

  # Undo only registrations made by our previous scan, and only if nobody has
  # replaced them since. compinit itself never clears stale _comps entries.
  for command in "${(@k)__direnv_registered_comps}"; do
    if [[ ${_comps[$command]-} == ${__direnv_registered_comps[$command]} ]]; then
      if [[ ${__direnv_had_comp[$command]-} == 1 ]]; then
        _comps[$command]=${__direnv_previous_comps[$command]}
      else
        unset "_comps[$command]"
      fi
    fi
  done
  __direnv_previous_comps=()
  __direnv_registered_comps=()
  __direnv_had_comp=()
  __direnv_completion_dirs=("${wanted[@]}")

  before=("${(@kv)_comps}")
  # No dump: a cached compdump may not know about newly declared directories.
  autoload -Uz compinit
  compinit -D
  for command in "${(@k)_comps}"; do
    if (( ! ${+before[$command]} )) || [[ ${before[$command]} != ${_comps[$command]} ]]; then
      __direnv_had_comp[$command]=${+before[$command]}
      __direnv_previous_comps[$command]=${before[$command]-}
      __direnv_registered_comps[$command]=${_comps[$command]}
    fi
  done
}

# direnv prepends its hook; repair completion after each export.
if (( ${chpwd_functions[(I)_direnv_hook]} )); then
  chpwd_functions+=(__direnv_sync_completions)
  precmd_functions+=(__direnv_sync_completions)
fi
