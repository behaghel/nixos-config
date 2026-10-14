#!/usr/bin/env bash
set -euo pipefail

root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
mkdir -p "$root/home" "$root/config" "$root/pass-functions" "$root/agent/zsh/site-functions" "$root/project"
printf '#compdef pass\n: \n' > "$root/pass-functions/_pass"
printf '#compdef other-tool\n: \n' > "$root/pass-functions/_other_tool"
printf '#compdef agent-session\n: \n' > "$root/agent/zsh/site-functions/_agent_session"
printf 'export FPATH=%s\nexport AGENT_SESSION_COMPLETION_ROOT=%s\n' \
  "$root/agent/zsh/site-functions" "$root/agent" > "$root/project/.envrc"
HOME="$root/home" XDG_CONFIG_HOME="$root/config" direnv allow "$root/project" >/dev/null

ROOT="$root" HOOK_FILE="${HOOK_FILE:-$(dirname "$0")/../modules/home/direnv/completions.zsh}" \
  HOME="$root/home" XDG_CONFIG_HOME="$root/config" zsh -f <<'ZSH'
set -e
fpath=("$ROOT/pass-functions" $fpath)
autoload -Uz compinit
compinit -D
[[ $_comps[pass] == _pass && $_comps[other-tool] == _other_tool ]]
eval "$(direnv hook zsh)"
source "$HOOK_FILE"
cd "$ROOT/project"
[[ $_comps[pass] == _pass && $_comps[agent-session] == _agent_session ]]
autoload -Uz +X _pass _agent_session
[[ -n $functions[_pass] && -n $functions[_agent_session] ]]
cd "$ROOT"
[[ $_comps[pass] == _pass && -z ${_comps[agent-session]-} ]]
[[ -z ${fpath[(r)$ROOT/agent/zsh/site-functions]} ]]
cd "$ROOT/project"
[[ $_comps[pass] == _pass && $_comps[agent-session] == _agent_session ]]
(( ${fpath[(Ie)$ROOT/agent/zsh/site-functions]} > 0 ))
__direnv_sync_completions
[[ $_comps[pass] == _pass && $_comps[other-tool] == _other_tool && $_comps[agent-session] == _agent_session ]]
count=0
for directory in "$fpath[@]"; do
  [[ $directory == "$ROOT/agent/zsh/site-functions" ]] && (( ++count ))
done
[[ $count == 1 ]]
ZSH
