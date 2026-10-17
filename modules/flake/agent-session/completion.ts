import { primaryRoot, repositoryRoot } from "./git.ts";
import { loadConfig, metadataSlugs, discoverManagedWorktrees, resolveSessionTarget } from "./sessions.ts";
import {
	commandNames,
	sessionCommandNames,
	currentSessionCommandNames,
	globalCommandNames,
	argumentError,
} from "./arguments.ts";

const commandOptions: Record<string, string[]> = {
	create: ["--dry-run", "--json"],
	start: ["--no-agent"],
	status: ["--json", "--refresh"],
	doctor: ["--json"],
	"global-doctor": ["--json"],
	finish: ["--keep-branch", "--expected", "--force", "--yes", "--dry-run", "--json"],
	"global-status": ["--json", "--refresh"],
	"global-finish": ["--all", "--gone", "--keep-branch", "--force", "--yes", "--dry-run", "--json"],
};

export function completionCandidates(scope: string): string[] {
	if (scope === "commands") return sessionCommandNames;
	if (scope === "current-commands") {
		try {
			resolveSessionTarget(".");
			return currentSessionCommandNames;
		} catch {
			return [];
		}
	}
	if (scope === "shells") return ["bash", "zsh", "fish"];
	if (scope.startsWith("options:")) return commandOptions[scope.slice(8)] ?? [];
	const global = [...globalCommandNames, "--"];
	try {
		const root = primaryRoot(repositoryRoot());
		const recorded = metadataSlugs(root);
		if (scope === "repair") {
			return [...discoverManagedWorktrees(root, loadConfig(root)).keys()]
				.filter((slug) => !recorded.includes(slug))
				.sort();
		}
		if (scope === "targets" || scope === "sessions") {
			const discovered = discoverManagedWorktrees(root, loadConfig(root));
			const slugs = [...new Set([...recorded, ...discovered.keys()])].sort();
			let current: string[] = [];
			try {
				resolveSessionTarget(".");
				current = ["."];
			} catch {
				// No implicit target is offered without a verified current binding.
			}
			return scope === "sessions" ? [...current, ...slugs] : [...global, ...current, ...slugs.filter((slug) => !commandNames.includes(slug))];
		}
		if (["cd", "run", "launch", "resume", "status", "finish"].includes(scope)) return recorded;
	} catch {
		// Completion remains usable outside a configured Git checkout.
	}
	return scope === "targets" ? global : [];
}

export function completionScript(shell: string): string {
	if (shell === "bash") {
		return `# bash completion for agent-session
_agent_session() {
  local current action subject=1 action_index=2 scope candidates candidate
  current="\${COMP_WORDS[COMP_CWORD]}"
  if [[ \${COMP_WORDS[1]-} == -- ]]; then subject=2; action_index=3; fi
  if [[ $COMP_CWORD -eq $subject ]]; then
    scope=targets
    [[ $subject -eq 2 ]] && scope=sessions
  elif [[ $subject -eq 1 && " ${globalCommandNames.join(" ")} " == *" \${COMP_WORDS[1]} "* ]]; then
    if [[ \${COMP_WORDS[1]} == completion ]]; then
      [[ $COMP_CWORD -eq 2 ]] || { COMPREPLY=(); return; }
      scope=shells
    else
      scope="options:global-\${COMP_WORDS[1]}"
    fi
  elif [[ $COMP_CWORD -eq $action_index ]]; then
    scope=commands
    [[ \${COMP_WORDS[subject]} == . ]] && scope=current-commands
  else
    action="\${COMP_WORDS[action_index]}"
    if [[ $action == run && $COMP_CWORD -gt $action_index ]]; then
      if [[ $COMP_CWORD -eq $(( action_index + 1 )) ]]; then
        COMPREPLY=( $(compgen -c -- "$current") )
      else
        COMPREPLY=()
        while IFS= read -r candidate; do COMPREPLY+=("$candidate"); done < <(compgen -f -- "$current")
      fi
      return
    fi
    scope="options:$action"
  fi
  candidates="$(agent-session __complete "$scope" 2>/dev/null)"
  COMPREPLY=( $(compgen -W "$candidates" -- "$current") )
}
complete -F _agent_session agent-session as
`;
	}
	if (shell === "zsh") {
		return `#compdef agent-session as
local subject=2 action_index=3 scope action
local -a candidates
if [[ $words[2] == -- ]]; then subject=3; action_index=4; fi
if (( CURRENT == subject )); then
  scope=targets
  (( subject == 3 )) && scope=sessions
  candidates=(\${(f)"$(agent-session __complete "$scope" 2>/dev/null)"})
  _describe 'session or command' candidates
  return
fi
if (( subject == 2 )) && [[ " ${globalCommandNames.join(" ")} " == *" $words[2] "* ]]; then
  if [[ $words[2] == completion ]]; then
    (( CURRENT == 3 )) || return
    scope=shells
  else
    scope="options:global-$words[2]"
  fi
elif (( CURRENT == action_index )); then
  scope=commands
  [[ $words[$subject] == . ]] && scope=current-commands
  candidates=(\${(f)"$(agent-session __complete "$scope" 2>/dev/null)"})
  _describe 'command' candidates
  return
else
  action=$words[$action_index]
  if [[ $action == run ]] && (( CURRENT > action_index )); then
    local -a run_words
    local run_current=$(( CURRENT - action_index )) start=$(( action_index + 1 ))
    run_words=("\${(@)words[$start,-1]}")
    local -a words
    local CURRENT=$run_current
    words=("$run_words[@]")
    _normal
    return
  fi
  scope="options:$action"
fi
candidates=(\${(f)"$(agent-session __complete "$scope" 2>/dev/null)"})
_describe 'option' candidates
`;
	}
	if (shell === "fish") {
		return `# fish completion for agent-session
function __agent_session_candidates
  set -l words (commandline -opc)
  set -l count_words (count $words)
  set -l subject 2
  set -l action_index 3
  set -l scope
  if test "$words[2]" = --
    set subject 3
    set action_index 4
  end
  if test $count_words -lt $subject
    set scope targets
    if test $subject -eq 3
      set scope sessions
    end
  else if test $subject -eq 2; and contains -- "$words[2]" ${globalCommandNames.join(" ")}
    if test "$words[2]" = completion
      test $count_words -eq 2; or return
      set scope shells
    else
      set scope "options:global-$words[2]"
    end
  else if test $count_words -lt $action_index
    set scope commands
    if test "$words[$subject]" = .
      set scope current-commands
    end
  else
    if test "$words[$action_index]" = run
      # Fish skips option tokens itself, so the escape separator is not counted.
      __fish_complete_subcommand --fcs-skip=3
      return
    end
    set scope "options:$words[$action_index]"
  end
  agent-session __complete "$scope" 2>/dev/null
end
complete -c agent-session -f -a '(__agent_session_candidates)'
`;
	}
	throw argumentError(`Unsupported shell '${shell}'. Expected one of: bash, zsh, fish.`);
}
