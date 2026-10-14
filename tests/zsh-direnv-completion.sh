#!/usr/bin/env bash
set -euo pipefail

root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
mkdir -p "$root/home" "$root/config" "$root/pass-functions" \
  "$root/agent/zsh/site-functions" "$root/other/functions" \
  "$root/project-a" "$root/project-b" "$root/missing"
printf '#compdef pass\n: \n' > "$root/pass-functions/_pass"
printf '#compdef other-tool\n: \n' > "$root/pass-functions/_other_tool"
printf '#compdef agent-session\n: \n' > "$root/agent/zsh/site-functions/_agent_session"
printf '#compdef herbert herbert-live\n: \n' > "$root/agent/zsh/site-functions/_herbert"
printf '#compdef alternate-tool\n: \n' > "$root/other/functions/_alternate"
printf 'export FPATH=%s\nexport DIRENV_ZSH_COMPLETION_DIRS=%s:%s:%s:%s\n' \
  "$root/agent/zsh/site-functions" "$root/agent/zsh/site-functions" \
  "$root/agent/zsh/site-functions" "$root/missing/no-such-dir" "$root/pass-functions" \
  > "$root/project-a/.envrc"
printf 'export FPATH=%s\nexport DIRENV_ZSH_COMPLETION_DIRS=%s\n' \
  "$root/other/functions" "$root/other/functions" > "$root/project-b/.envrc"
HOME="$root/home" XDG_CONFIG_HOME="$root/config" direnv allow "$root/project-a" >/dev/null
HOME="$root/home" XDG_CONFIG_HOME="$root/config" direnv allow "$root/project-b" >/dev/null

ROOT="$root" HOOK_FILE="${HOOK_FILE:-$(dirname "$0")/../modules/home/direnv/completions.zsh}" \
  HOME="$root/home" XDG_CONFIG_HOME="$root/config" zsh -f <<'ZSH'
set -e
fpath=("$ROOT/pass-functions" $fpath)
autoload -Uz compinit
compinit -D
[[ $_comps[pass] == _pass && $_comps[other-tool] == _other_tool ]]
eval "$(direnv hook zsh)"
source "$HOOK_FILE"
assert_base() {
  [[ $_comps[pass] == _pass && $_comps[other-tool] == _other_tool ]]
  (( ${fpath[(Ie)$ROOT/pass-functions]} ))
}
assert_agent() {
  [[ $_comps[agent-session] == _agent_session && $_comps[herbert] == _herbert &&
     $_comps[herbert-live] == _herbert ]]
  [[ -r $ROOT/agent/zsh/site-functions/_agent_session &&
     -r $ROOT/agent/zsh/site-functions/_herbert ]]
  local count=0 dir
  for dir in "$fpath[@]"; do
    [[ $dir == "$ROOT/agent/zsh/site-functions" ]] && (( ++count ))
  done
  [[ $count == 1 ]]
}
assert_no_agent() {
  [[ -z ${_comps[agent-session]-} && -z ${_comps[herbert]-} &&
     -z ${_comps[herbert-live]-} ]]
  [[ -z ${fpath[(r)$ROOT/agent/zsh/site-functions]} ]]
}
cd "$ROOT/project-a"
assert_base
autoload -Uz +X _pass _agent_session _herbert
assert_agent
[[ -z ${fpath[(r)$ROOT/missing/no-such-dir]} ]]
__direnv_sync_completions
assert_agent
cd "$ROOT"
assert_base
assert_no_agent
cd "$ROOT/project-a"
assert_agent
cd "$ROOT/project-b"
assert_base
assert_no_agent
[[ $_comps[alternate-tool] == _alternate ]]
cd "$ROOT/project-a"
[[ -z ${_comps[alternate-tool]-} ]]
assert_agent
cd "$ROOT"
assert_base
assert_no_agent
[[ -z ${_comps[alternate-tool]-} ]]
ZSH
