import { primaryRoot, repositoryRoot } from "./git.ts";
import { loadConfig, metadataSlugs, discoverManagedWorktrees } from "./sessions.ts";
import { commandNames, argumentError } from "./arguments.ts";

export function completionCandidates(command: string): string[] {
	try {
		const root = primaryRoot(repositoryRoot());
		if (command === "repair") {
			const config = loadConfig(root);
			const recorded = new Set(metadataSlugs(root));
			return [...discoverManagedWorktrees(root, config).keys()]
				.filter((slug) => !recorded.has(slug))
				.sort();
		}
		if (["cd", "run", "launch", "resume", "status", "finish"].includes(command)) {
			return metadataSlugs(root);
		}
	} catch {
		return [];
	}
	return [];
}

export function completionScript(shell: string): string {
	if (shell === "bash") {
		return `# bash completion for agent-session
_agent_session() {
  local current command options sessions
  current="\${COMP_WORDS[COMP_CWORD]}"
  if [[ $COMP_CWORD -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${commandNames.join(" ")}" -- "$current") )
    return
  fi
  command="\${COMP_WORDS[1]}"
  if [[ $command == run && $COMP_CWORD -ge 3 ]]; then
    if [[ $COMP_CWORD -eq 3 ]]; then
      COMPREPLY=( $(compgen -c -- "$current") )
    else
      COMPREPLY=( $(compgen -f -- "$current") )
    fi
    return
  fi
  if [[ $command == cd && $COMP_CWORD -gt 2 ]]; then
    COMPREPLY=()
    return
  fi
  case "$command" in
    create) options="--dry-run --json" ;;
    start) options="--no-agent" ;;
    status) options="--json --refresh" ;;
    finish) options="--all --gone --keep-branch --force --yes --dry-run --json" ;;
    completion) options="bash zsh fish" ;;
    *) options="" ;;
  esac
  sessions="$(agent-session __complete "$command" 2>/dev/null)"
  COMPREPLY=( $(compgen -W "$options $sessions" -- "$current") )
}
complete -F _agent_session agent-session as
`;
	}
	if (shell === "zsh") {
		return `#compdef agent-session as
local -a commands candidates
commands=(${commandNames.map((command) => `'${command}:${command}'`).join(" ")})
if (( CURRENT == 2 )); then
  _describe 'command' commands
  return
fi
if [[ $words[2] == run ]] && (( CURRENT >= 4 )); then
  local -a run_words
  local run_current=$(( CURRENT - 3 ))
  run_words=("\${(@)words[4,-1]}")
  local -a words
  local CURRENT=$run_current
  words=("$run_words[@]")
  _normal
  return
fi
candidates=(\${(f)"$(agent-session __complete "$words[2]" 2>/dev/null)"})
if [[ $words[2] == cd || $words[2] == run ]]; then
  if (( CURRENT == 3 )); then
    _describe 'session' candidates
  fi
  return
fi
_arguments '*:session:($candidates)' \\
  '--dry-run[preview without mutation]' '--json[emit JSON]' \\
  '--refresh[refresh remote refs]' '--no-agent[do not launch the agent]' \\
  '--all[select all sessions]' '--gone[select sessions with gone upstreams]' \\
  '--keep-branch[preserve local branches]' '--force[discard unsafe local work]' \\
  '--yes[skip confirmation]'
`;
	}
	if (shell === "fish") {
		return `# fish completion for agent-session
function __agent_session_sessions
  set -l words (commandline -opc)
  agent-session __complete $words[2] 2>/dev/null
end
complete -c agent-session -f
complete -c agent-session -n '__fish_use_subcommand' -a '${commandNames.join(" ")}'
complete -c agent-session -n '__fish_seen_subcommand_from launch resume status repair finish' -a '(__agent_session_sessions)'
complete -c agent-session -n '__fish_seen_subcommand_from cd run; and test (count (commandline -opc)) -eq 2' -a '(__agent_session_sessions)'
complete -c agent-session -n '__fish_seen_subcommand_from run; and test (count (commandline -opc)) -ge 3' -a '(__fish_complete_subcommand --fcs-skip=3)'
complete -c agent-session -n '__fish_seen_subcommand_from create finish' -l dry-run
complete -c agent-session -n '__fish_seen_subcommand_from create status finish' -l json
complete -c agent-session -n '__fish_seen_subcommand_from finish' -l all
complete -c agent-session -n '__fish_seen_subcommand_from finish' -l gone
complete -c agent-session -n '__fish_seen_subcommand_from finish' -l keep-branch
complete -c agent-session -n '__fish_seen_subcommand_from finish' -l force
complete -c agent-session -n '__fish_seen_subcommand_from finish' -l yes
`;
	}
	throw argumentError(
		`Unsupported shell '${shell}'. Expected one of: bash, zsh, fish.`,
	);
}
