import { CliError } from "./runtime.ts";
import { personalBranches, personalColor } from "./preferences.ts";
import { validateSlug } from "./sessions.ts";
import { parsePullRequestSelection } from "./github.ts";
import type { BatchFinishOptions, PullRequestSelection, OwnershipOptions, PresentationOptions } from "./types.ts";

export const commandNames = [
	"cd",
	"run",
	"branch",
	"ownership",
	"activity",
	"create",
	"launch",
	"start",
	"resume",
	"list",
	"batch",
	"doctor",
	"repair",
	"finish",
	"completion",
];

export const sessionCommandNames = commandNames.filter((name) => !["completion", "batch"].includes(name));
export const globalCommandNames = ["list", "batch", "doctor", "completion", "finish"];

// Retired command words stay reserved: never reinterpret an old invocation as
// authority to create, enter or remove a same-named session.
export function isCommandWord(value: string): boolean {
	return commandNames.includes(value) || value === "status";
}

function retiredStatus(slug?: string): CliError {
	const replacement = slug ? sessionCommand(slug, "list --inspect") : "agent-session list --inspect";
	return argumentError(`'status' has been removed. Use: ${replacement}. Existing inspection flags follow --inspect. To address a session named status, use: agent-session -- status <command>.`);
}
export const currentSessionCommandNames = sessionCommandNames.filter((name) => !["create", "start", "repair"].includes(name));

export function sessionCommand(slug: string, command: string): string {
	return `agent-session ${isCommandWord(slug) ? "-- " : ""}${slug} ${command}`;
}

export function unrecordedRetirementHint(slug: string): string {
	const command = sessionCommand(slug, "finish");
	return `Automatic repair cannot recover missing metadata on a renamed or detached branch. Keep the worktree intact unless retiring it. Preview with: ${command} --force --dry-run. If intended, run: ${command} --force. This discards uncommitted and ignored local files but will preserve all branches; verify ownership and active use first.`;
}

export function legacySessionSyntax(command: string): CliError {
	return argumentError(`Session commands use <task-slug> <command>. Use: agent-session <task-slug> ${command}. Command-word slugs require: agent-session -- <task-slug> <command>.`);
}

export function parseInvocation(args: string[]): {
	command: string;
	args: string[];
	global: boolean;
} {
	const [first, ...rest] = args;
	if (!first) throw argumentError("Missing command.");
	if (first === "status") throw retiredStatus();
	if (first === "__complete" || globalCommandNames.includes(first)) {
		return { command: first, args: rest, global: true };
	}
	if (commandNames.includes(first)) {
		if (rest.length === 0) throw argumentError(`Missing <task-slug> for '${first}'. Use: agent-session <task-slug> ${first}.`);
		throw legacySessionSyntax(first);
	}
	const [slug, command, ...tail] = first === "--" ? rest : args;
	if (!slug) throw argumentError("Missing <task-slug>.");
	if (slug !== ".") validateSlug(slug);
	if (!command) throw argumentError(`Missing <command> for session '${slug}'.`);
	if (command === "status") throw retiredStatus(slug);
	if (!sessionCommandNames.includes(command)) {
		throw argumentError(`Unknown command '${command}'.${didYouMean(command, sessionCommandNames)}`);
	}
	if (slug === "." && !currentSessionCommandNames.includes(command)) {
		throw argumentError(`Command '${command}' requires an explicit slug, not the current-session target '.'.`);
	}
	return { command, args: [slug, ...tail], global: false };
}

function editDistance(left: string, right: string): number {
	const previous = Array.from(
		{ length: right.length + 1 },
		(_, index) => index,
	);
	for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
		const current = [leftIndex];
		for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
			current[rightIndex] = Math.min(
				(current[rightIndex - 1] ?? 0) + 1,
				(previous[rightIndex] ?? 0) + 1,
				(previous[rightIndex - 1] ?? 0) +
					(left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
			);
		}
		previous.splice(0, previous.length, ...current);
	}
	return previous[right.length] ?? left.length;
}

export function didYouMean(value: string, candidates: string[]): string {
	const ranked = candidates
		.map((candidate) => ({
			candidate,
			distance: editDistance(value, candidate),
		}))
		.sort((left, right) => left.distance - right.distance);
	const nearest = ranked[0];
	return nearest && nearest.distance <= 3
		? ` Did you mean '${nearest.candidate}'?`
		: "";
}

export function argumentError(message: string): CliError {
	return new CliError(`${message}\n\n${usage()}`, 64);
}

function unknownOption(
	command: string,
	option: string,
	validOptions: string[],
): CliError {
	return argumentError(
		`Unknown option '${option}' for '${command}'.${didYouMean(option, validOptions)}`,
	);
}

export function parseOwnershipArguments(args: string[]): OwnershipOptions {
	const [slug, ...tail] = args;
	let parent: string | null | undefined, expected: string | undefined;
	let dryRun = false, json = false, yes = false;
	for (let index = 0; index < tail.length; index++) {
		const option = tail[index];
		if (option === "--root" || option === "--parent") {
			if (parent !== undefined) throw argumentError("Declare exactly one ownership root or parent.");
			parent = option === "--root" ? null : tail[++index];
			if (parent === undefined) throw argumentError("--parent requires a mapped session slug.");
			if (parent !== null) validateSlug(parent);
		} else if (option === "--expected") {
			const token = tail[++index] ?? "";
			if (expected || !/^ownership-v1\.[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(token)) throw argumentError("--expected requires one ownership preview receipt.");
			expected = token;
		} else if (option === "--dry-run") dryRun = true;
		else if (option === "--json") json = true;
		else if (option === "--yes") yes = true;
		else throw argumentError(`Unknown ownership option: ${option}`);
	}
	if (!slug || parent === undefined) throw argumentError("Use: agent-session <slug> ownership (--root | --parent <slug>) (--dry-run | --expected <receipt> --yes) [--json].");
	if (dryRun && (expected || yes)) throw argumentError("Ownership preview does not accept approval flags.");
	if (!dryRun && (!expected || !yes)) throw argumentError("Ownership mapping requires a reviewed --expected receipt and --yes.");
	return { slug, parent, dryRun, json, yes, expected };
}

export function parseActivityArguments(args: string[]): { slug: string; action: "touch" | "reconcile"; dryRun: boolean; json: boolean } {
	const [slug, action, ...options] = args;
	if (slug && action === "touch" && options.length === 0) return { slug, action, dryRun: false, json: false };
	if (!slug || action !== "reconcile" || options.some((option) => !["--dry-run", "--json"].includes(option)) ||
		(options.includes("--json") && !options.includes("--dry-run"))) {
		throw argumentError("Use: agent-session <slug> activity touch, or agent-session <slug> activity reconcile [--dry-run [--json]]. Reconciliation requires terminal confirmation; --yes and --force are not supported.");
	}
	return { slug, action, dryRun: options.includes("--dry-run"), json: options.includes("--json") };
}

export function parseBranchArguments(args: string[]): { slug: string; name: string; json: boolean } {
	const [slug, action, name, ...options] = args;
	if (!slug || action !== "create" || !name || options.some((option) => option !== "--json") || options.length > 1) {
		throw argumentError("Use: agent-session <task-slug> branch create <name> [--json]. Creates without switching; plain Git branches are not adopted.");
	}
	return { slug, name, json: options.includes("--json") };
}

function presentationArguments(input: string[]): PresentationOptions & { args: string[] } {
	let color: PresentationOptions["color"];
	let verbose = false;
	const args = input.filter((argument) => {
		if (argument === "--verbose") { verbose = true; return false; }
		if (!argument.startsWith("--color=")) return true;
		const value = argument.slice("--color=".length);
		if (!["auto", "always", "never"].includes(value)) throw argumentError("--color requires auto|always|never.");
		color = value as PresentationOptions["color"];
		return false;
	});
	return { args, color: personalColor(color, args.includes("--json")), verbose };
}

export function parseCreateArguments(input: string[]): PresentationOptions & {
	slug: string;
	dryRun: boolean;
	json: boolean;
	pr?: PullRequestSelection;
	trustPr: boolean;
} {
	let slug: string | undefined;
	const { args, color, verbose } = presentationArguments(input);
	let dryRun = false;
	let json = false;
	let pr: PullRequestSelection | undefined;
	let trustPr = false;
	let createBranch = false;
	for (let index = 0; index < args.length; index++) {
		const argument = args[index] ?? "";
		if (argument === "--dry-run") dryRun = true;
		else if (argument === "--json") json = true;
		else if (argument === "--trust-pr") trustPr = true;
		else if (argument === "-c" || argument === "--create-branch") createBranch = true;
		else if (argument === "--pr") {
			const value = args[++index] ?? "";
			if (pr !== undefined) throw argumentError("--pr requires exactly one selection.");
			try { pr = parsePullRequestSelection(value); }
			catch { throw argumentError("--pr requires a positive PR number or a github.com PR URL."); }
		}
		else if (!argument.startsWith("-") && !slug) slug = argument;
		else if (argument.startsWith("-")) {
			throw unknownOption("create", argument, ["--dry-run", "--json", "--pr", "--trust-pr", "-c", "--create-branch"]);
		} else {
			throw argumentError(`Unexpected argument '${argument}' for 'create'.`);
		}
	}
	if (!slug) throw argumentError("Missing <task-slug> for 'create'.");
	if (trustPr && pr === undefined) throw argumentError("--trust-pr requires --pr.");
	if (createBranch && pr === undefined) throw argumentError("--create-branch (-c) requires --pr.");
	if (createBranch && pr) pr = { ...pr, mode: "independent" };
	return { slug, dryRun, json, pr, trustPr, color, verbose };
}

export function parseStartArguments(input: string[]): PresentationOptions & {
	slug: string;
	launchConfiguredAgent: boolean;
	pr?: PullRequestSelection;
	trustPr: boolean;
} {
	let slug: string | undefined;
	const { args, color, verbose } = presentationArguments(input);
	let launchConfiguredAgent = true;
	let pr: PullRequestSelection | undefined;
	let trustPr = false;
	let createBranch = false;
	for (let index = 0; index < args.length; index++) {
		const argument = args[index] ?? "";
		if (argument === "--no-agent") launchConfiguredAgent = false;
		else if (argument === "--trust-pr") trustPr = true;
		else if (argument === "-c" || argument === "--create-branch") createBranch = true;
		else if (argument === "--pr") {
			if (pr !== undefined) throw argumentError("--pr requires exactly one selection.");
			try { pr = parsePullRequestSelection(args[++index] ?? ""); }
			catch { throw argumentError("--pr requires a positive PR number or a github.com PR URL."); }
		}
		else if (!argument.startsWith("-") && !slug) slug = argument;
		else if (argument.startsWith("-")) {
			throw unknownOption("start", argument, ["--no-agent", "--pr", "--trust-pr", "-c", "--create-branch"]);
		} else {
			throw argumentError(`Unexpected argument '${argument}' for 'start'.`);
		}
	}
	if (!slug) throw argumentError("Missing <task-slug> for 'start'.");
	if (trustPr && !pr) throw argumentError("--trust-pr requires --pr.");
	if (createBranch && !pr) throw argumentError("--create-branch (-c) requires --pr.");
	if (createBranch && pr) pr = { ...pr, mode: "independent" };
	return { slug, launchConfiguredAgent, pr, trustPr, color, verbose };
}

export function parseFinishArguments(input: string[]): PresentationOptions & {
	slug?: string;
	yes: boolean;
	force: boolean;
	keepBranch: boolean;
	deleteBranches: boolean;
	all: boolean;
	branches: boolean;
	gone: boolean;
	dryRun: boolean;
	json: boolean;
	expected?: string;
} {
	let slug: string | undefined;
	const { args, color, verbose } = presentationArguments(input);
	let expected: string | undefined;
	let yes = false;
	let force = false;
	let explicitKeep = false;
	let explicitDelete = false;
	let all = false;
	let branches = false;
	let gone = false;
	let dryRun = false;
	let json = false;
	for (let index = 0; index < args.length; index++) {
		const argument = args[index] ?? "";
		if (argument === "--expected") {
			const value = args[++index];
			if (expected || !value || !/^(?:[a-f0-9]{64}|tree-v1\.[A-Za-z0-9_-]+\.[a-f0-9]{64})$/.test(value))
				throw argumentError("finish --expected requires one preview receipt.");
			expected = value;
		} else if (argument === "--yes") yes = true;
		else if (argument === "--force") force = true;
		else if (argument === "--keep-branch") explicitKeep = true;
		else if (argument === "--delete-branches") explicitDelete = true;
		else if (argument === "--all") all = true;
		else if (argument === "--branches") branches = true;
		else if (argument === "--gone") gone = true;
		else if (argument === "--dry-run") dryRun = true;
		else if (argument === "--json") json = true;
		else if (!argument.startsWith("-") && !slug) slug = argument;
		else if (argument.startsWith("-")) {
			throw unknownOption("finish", argument, [
				"--yes",
				"--force",
				"--keep-branch",
				"--delete-branches",
				"--expected",
				"--all",
				"--branches",
				"--gone",
				"--dry-run",
				"--json",
			]);
		} else {
			throw argumentError(`Unexpected argument '${argument}' for 'finish'.`);
		}
	}
	const presentedApply = !dryRun && Boolean(slug ? all || branches : yes && (all || gone));
	if ((all || branches || gone) && !presentedApply && input.some((argument) => argument === "--verbose" || argument.startsWith("--color="))) throw argumentError("Presentation flags require a single-session selector, scoped recursive/history apply, or explicit --yes bulk apply.");
	if (branches && (!slug || all || gone || force || yes || expected || (json && !dryRun))) throw argumentError("finish --branches requires one slug, terminal confirmation (or --dry-run), and no --all, --gone, --force, --yes or --expected.");
	if ((!slug && !all && !gone) || (gone && (Boolean(slug) || all))) {
		throw argumentError(
			"Choose a finish selector: <task-slug> [--all], --all, or --gone.",
		);
	}
	const automated = yes || expected !== undefined;
	const usePersonal = !automated && Boolean(slug) && (dryRun || Boolean(process.stdin.isTTY));
	const keepBranch = explicitKeep || (!explicitDelete && (!usePersonal || personalBranches() === "preserve"));
	if (yes && !explicitKeep && !explicitDelete) throw argumentError("Automated finish requires an explicit branch disposition: --keep-branch or --delete-branches.");
	if (slug && all && force) throw argumentError("Session-scoped --all does not accept --force.");
	if (slug && all && !dryRun && (expected || yes) && (!keepBranch || !expected || !yes)) {
		throw argumentError("Recursive finish requires --keep-branch, --expected <tree-receipt> and --yes.");
	}
	if (slug && all && json && !dryRun && !expected) throw argumentError("Interactive recursive finish does not accept --json; use a receipt for automation.");
	if (expected && (all ? !expected.startsWith("tree-v1.") : expected.startsWith("tree-v1."))) throw argumentError("Receipt does not match the finish selector.");
	if (json && !dryRun && !(slug && all)) {
		throw new CliError("finish --json requires --dry-run.", 64);
	}
	if (expected && (!slug || force || !explicitKeep))
		throw argumentError(
			"finish --expected requires one slug, --keep-branch and non-forced cleanup.",
		);
	return { slug, yes, force, keepBranch, deleteBranches: explicitDelete && !explicitKeep, all, branches, gone, dryRun, json, expected, color, verbose };
}

export function parseBatchArguments(args: string[]): BatchFinishOptions {
	if (args[0] !== "finish") throw argumentError("batch requires the finish subcommand.");
	let inactiveFor: string | undefined;
	let inactiveMs = 0;
	let dryRun = false;
	let json = false;
	let yes = false;
	let expected: string | undefined;
	const exclusions: string[] = [];
	let color: BatchFinishOptions["color"];
	let verbose = false;
	for (let index = 1; index < args.length; index++) {
		const argument = args[index] ?? "";
		if (argument === "--inactive-for") {
			const value = args[++index] ?? "";
			const match = value.match(/^([1-9]\d*)(s|m|h|d|w)$/);
			if (inactiveFor || !match) throw argumentError("--inactive-for requires one positive duration, e.g. 7d.");
			const units: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
			inactiveMs = Number(match[1]) * (units[match[2] ?? ""] ?? 0);
			if (!Number.isSafeInteger(inactiveMs) || inactiveMs > Date.now()) throw argumentError("Inactivity window is out of range.");
			inactiveFor = value;
		} else if (argument === "--exclude") {
			const slug = args[++index] ?? "";
			validateSlug(slug);
			exclusions.push(slug);
		} else if (argument === "--expected") {
			const value = args[++index] ?? "";
			if (expected || !/^batch-v1\.[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(value)) throw argumentError("--expected requires one batch preview receipt.");
			expected = value;
		} else if (argument.startsWith("--color=")) {
			const value = argument.slice("--color=".length);
			if (!["auto", "always", "never"].includes(value)) throw argumentError("--color requires auto|always|never.");
			color = value as BatchFinishOptions["color"];
		} else if (argument === "--dry-run") dryRun = true;
		else if (argument === "--yes") yes = true;
		else if (argument === "--json") json = true;
		else if (argument === "--keep-branch") { /* Always preserve branches. */ }
		else if (argument === "--verbose") verbose = true;
		else throw unknownOption("batch finish", argument, ["--inactive-for", "--exclude", "--keep-branch", "--dry-run", "--expected", "--yes", "--json", "--color=auto", "--color=always", "--color=never", "--verbose"]);
	}
	if (!inactiveFor) throw argumentError("batch finish requires --inactive-for.");
	if (dryRun && (expected || yes)) throw argumentError("Batch preview does not accept --expected or --yes.");
	if (!dryRun && (!expected || !yes)) throw argumentError("Batch apply requires --expected <preview-receipt> and --yes.");
	return { inactiveFor, inactiveMs, exclusions: [...new Set(exclusions)].sort(), json, dryRun, yes, expected, color: personalColor(color, json), verbose };
}

export function parseListArguments(input: string[], scoped = false): PresentationOptions & {
	inspect: boolean;
	slug?: string;
	worktree?: string;
	json: boolean;
	refresh: boolean;
} {
	let slug: string | undefined;
	const { args, color, verbose } = presentationArguments(input);
	let worktree: string | undefined;
	let json = false;
	let refresh = false;
	let inspect = false;
	for (let index = 0; index < args.length; index++) {
		const argument = args[index] ?? "";
		if (argument === "--inspect") inspect = true;
		else if (argument === "--worktree") {
			const value = args[++index];
			if (worktree || !value || value.startsWith("-")) throw argumentError("--worktree requires exactly one path.");
			worktree = value;
		} else if (argument === "--json") json = true;
		else if (argument === "--refresh") refresh = true;
		else if (!argument.startsWith("-") && scoped && !slug) slug = argument;
		else if (argument.startsWith("-")) {
			throw unknownOption("list", argument, ["--inspect", "--json", "--refresh", "--worktree", "--verbose", "--color=auto", "--color=always", "--color=never"]);
		} else throw argumentError("Use: agent-session <task-slug> list --inspect, not agent-session list <task-slug>.");
	}
	if (!inspect && (refresh || worktree || slug)) throw argumentError("Live inspection and session selectors require list --inspect.");
	if (worktree && (slug || refresh)) throw argumentError("--worktree cannot be combined with a session slug or --refresh.");
	return { slug, worktree, json, refresh, inspect, color, verbose };
}

export function parseDoctorArguments(input: string[]): PresentationOptions & { slug?: string; json: boolean } {
	const { args, color, verbose } = presentationArguments(input);
	let slug: string | undefined;
	let json = false;
	for (const argument of args) {
		if (argument === "--json") json = true;
		else if (argument.startsWith("-")) throw unknownOption("doctor", argument, ["--json", "--verbose", "--color=auto", "--color=always", "--color=never"]);
		else if (!slug) slug = argument;
		else throw argumentError(`Unexpected argument '${argument}' for 'doctor'.`);
	}
	return { slug, json, color, verbose };
}

export function parseRequiredSlug(command: string, args: string[]): string {
	if (args.length === 0) {
		throw argumentError(`Missing <task-slug> for '${command}'.`);
	}
	const [slug, ...extra] = args;
	if (extra.length > 0) {
		const argument = extra[0] ?? "";
		if (argument.startsWith("-")) {
			throw unknownOption(command, argument, []);
		}
		throw argumentError(`Unexpected argument '${argument}' for '${command}'.`);
	}
	if (slug?.startsWith("-")) throw unknownOption(command, slug, []);
	return slug ?? "";
}

function usage(): string {
	return [
		"Usage:",
		"  as <task-slug> cd (shell integration required)",
		"  agent-session <task-slug> cd (print the worktree path)",
		"  agent-session <task-slug> run <command> [args...]",
		"  agent-session <task-slug> branch create <name> [--json] (create and record ownership without switching)",
		"  agent-session <task-slug> ownership (--root | --parent <slug>) (--dry-run | --expected <receipt> --yes) [--json] (explicitly reviewed legacy mapping)",
		"  agent-session <task-slug> create [--dry-run] [--json] [--color=auto|always|never] [--verbose] [--pr <number-or-url> [--trust-pr] [-c|--create-branch]]",
		"  agent-session <task-slug> launch",
		"  agent-session <task-slug> start [--no-agent] [--color=auto|always|never] [--verbose] [--pr <number-or-url> [--trust-pr] [-c|--create-branch]]",
		"  agent-session <task-slug> resume (recorded creator conversation in parent, otherwise latest own conversation)",
		"  agent-session <task-slug> list --inspect [--json] [--refresh] [--color=auto|always|never] [--verbose]",
		"  agent-session <task-slug> activity touch (record current engagement, without changing operation records)",
		"  agent-session <task-slug> activity reconcile [--dry-run [--json]] (review and acknowledge interrupted operations, never mark completion)",
		"  agent-session <task-slug> repair",
		"  agent-session <task-slug> finish [--keep-branch|--delete-branches] [--expected <receipt>] [--force] [--yes] [--dry-run [--json]] [--color=auto|always|never] [--verbose]",
		"  agent-session <task-slug> finish --branches [--keep-branch|--delete-branches] [--color=auto|always|never] [--verbose] (review branches used in this worktree and reuse the asset plan; no descendants)",
		"  agent-session <task-slug> finish --branches --dry-run [--keep-branch|--delete-branches] [--json] (read-only branch-history review)",
		"  agent-session <task-slug> finish --all [--keep-branch|--delete-branches] [--color=auto|always|never] [--verbose] (review recorded descendants, confirm once and reuse the asset plan; branches preserved by default)",
		"  agent-session <task-slug> finish --all --dry-run [--keep-branch|--delete-branches] [--json] (preview recorded descendants before their parent)",
		"  agent-session <task-slug> finish --all --keep-branch --expected <tree-receipt> --yes [--json] [--color=auto|always|never] [--verbose] (guarded branch-preserving recursive cleanup; state output)",
		"  agent-session . <cd|run|branch|ownership|activity|launch|resume|list|doctor|finish> (current managed worktree)",
		"  agent-session [<task-slug>] doctor [--json] [--color=auto|always|never] [--verbose] (read-only diagnostics)",
		"  agent-session -- <task-slug> <command> (escape a command-word slug)",
		"  agent-session list [--json] [--color=auto|always|never] [--verbose] (recorded bindings only; no checkout inspection)",
		"  agent-session batch finish --inactive-for <duration> [--exclude <slug>] [--keep-branch] (--dry-run | --expected <receipt> --yes) [--json] [--color=auto|always|never] [--verbose] (preview/apply state output; branches preserved)",
		"  agent-session list --inspect [--json] [--refresh] [--color=auto|always|never] [--verbose] (live Git/binding table)",
		"  agent-session list --inspect --worktree <path> [--json] [--color=auto|always|never] [--verbose] (read-only exact inspection)",
		"  agent-session finish (--all | --gone) [--keep-branch|--delete-branches] [--force] [--yes] [--dry-run [--json]]",
		"  agent-session finish (--all | --gone) (--keep-branch | --delete-branches) --yes [--force] [--color=auto|always|never] [--verbose] (explicit --yes bulk state output; legacy exit behaviour)",
		"  agent-session completion <bash|zsh|fish>",
		"",
		"Personal colour and interactive branch defaults: $XDG_CONFIG_HOME/agent-session/config.json (fallback ~/.config/agent-session/config.json).",
		"Personal keys: color=auto|always|never; branches=preserve|delete (reviewed interactive cleanup and previews only).",
		"Branches default to preserve; --keep-branch wins. Automated finish --yes requires an explicit branch flag. JSON ignores colour preferences.",
	].join("\n");
}
