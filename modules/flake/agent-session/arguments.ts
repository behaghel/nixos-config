import { CliError } from "./runtime.ts";
import { validateSlug } from "./sessions.ts";
import { parsePullRequestSelection } from "./github.ts";
import type { PullRequestSelection } from "./types.ts";

export const commandNames = [
	"cd",
	"run",
	"create",
	"launch",
	"start",
	"resume",
	"status",
	"list",
	"batch",
	"doctor",
	"repair",
	"finish",
	"completion",
];

export const sessionCommandNames = commandNames.filter((name) => !["completion", "list", "batch"].includes(name));
export const globalCommandNames = ["status", "list", "batch", "doctor", "completion", "finish"];
export const currentSessionCommandNames = sessionCommandNames.filter((name) => !["create", "start", "repair"].includes(name));

export function sessionCommand(slug: string, command: string): string {
	return `agent-session ${commandNames.includes(slug) ? "-- " : ""}${slug} ${command}`;
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

export function parseCreateArguments(args: string[]): {
	slug: string;
	dryRun: boolean;
	json: boolean;
	pr?: PullRequestSelection;
	trustPr: boolean;
} {
	let slug: string | undefined;
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
	return { slug, dryRun, json, pr, trustPr };
}

export function parseStartArguments(args: string[]): {
	slug: string;
	launchConfiguredAgent: boolean;
	pr?: PullRequestSelection;
	trustPr: boolean;
} {
	let slug: string | undefined;
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
	return { slug, launchConfiguredAgent, pr, trustPr };
}

export function parseFinishArguments(args: string[]): {
	slug?: string;
	yes: boolean;
	force: boolean;
	keepBranch: boolean;
	all: boolean;
	gone: boolean;
	dryRun: boolean;
	json: boolean;
	expected?: string;
} {
	let slug: string | undefined;
	let expected: string | undefined;
	let yes = false;
	let force = false;
	let keepBranch = false;
	let all = false;
	let gone = false;
	let dryRun = false;
	let json = false;
	for (let index = 0; index < args.length; index++) {
		const argument = args[index] ?? "";
		if (argument === "--expected") {
			const value = args[++index];
			if (expected || !value || !/^[a-f0-9]{64}$/.test(value))
				throw argumentError("finish --expected requires one preview receipt.");
			expected = value;
		} else if (argument === "--yes") yes = true;
		else if (argument === "--force") force = true;
		else if (argument === "--keep-branch") keepBranch = true;
		else if (argument === "--all") all = true;
		else if (argument === "--gone") gone = true;
		else if (argument === "--dry-run") dryRun = true;
		else if (argument === "--json") json = true;
		else if (!argument.startsWith("-") && !slug) slug = argument;
		else if (argument.startsWith("-")) {
			throw unknownOption("finish", argument, [
				"--yes",
				"--force",
				"--keep-branch",
				"--expected",
				"--all",
				"--gone",
				"--dry-run",
				"--json",
			]);
		} else {
			throw argumentError(`Unexpected argument '${argument}' for 'finish'.`);
		}
	}
	if ([Boolean(slug), all, gone].filter(Boolean).length !== 1) {
		throw argumentError(
			"Choose exactly one finish selector: <task-slug>, --all, or --gone.",
		);
	}
	if (json && !dryRun) {
		throw new CliError("finish --json requires --dry-run.", 64);
	}
	if (expected && (!slug || force || !keepBranch))
		throw argumentError(
			"finish --expected requires one slug, --keep-branch and non-forced cleanup.",
		);
	return { slug, yes, force, keepBranch, all, gone, dryRun, json, expected };
}

export function parseBatchPreviewArguments(args: string[]): { inactiveFor: string; inactiveMs: number; exclusions: string[]; json: boolean } {
	if (args[0] !== "finish") throw argumentError("batch requires the finish subcommand.");
	let inactiveFor: string | undefined;
	let inactiveMs = 0;
	let dryRun = false;
	let json = false;
	const exclusions: string[] = [];
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
		} else if (argument === "--dry-run") dryRun = true;
		else if (argument === "--json") json = true;
		else if (argument === "--keep-branch") { /* Always preserve branches. */ }
		else throw unknownOption("batch finish", argument, ["--inactive-for", "--exclude", "--keep-branch", "--dry-run", "--json"]);
	}
	if (!inactiveFor) throw argumentError("batch finish requires --inactive-for.");
	if (!dryRun) throw argumentError("batch finish currently requires --dry-run; apply is not implemented.");
	return { inactiveFor, inactiveMs, exclusions: [...new Set(exclusions)].sort(), json };
}

export function parseStatusArguments(args: string[]): {
	slug?: string;
	worktree?: string;
	json: boolean;
	refresh: boolean;
} {
	let slug: string | undefined;
	let worktree: string | undefined;
	let json = false;
	let refresh = false;
	for (let index = 0; index < args.length; index++) {
		const argument = args[index] ?? "";
		if (argument === "--worktree") {
			const value = args[++index];
			if (worktree || !value || value.startsWith("-")) throw argumentError("--worktree requires exactly one path.");
			worktree = value;
		} else if (argument === "--json") json = true;
		else if (argument === "--refresh") refresh = true;
		else if (!argument.startsWith("-") && !slug) slug = argument;
		else if (argument.startsWith("-")) {
			throw unknownOption("status", argument, ["--json", "--refresh", "--worktree"]);
		} else {
			throw argumentError(`Unexpected argument '${argument}' for 'status'.`);
		}
	}
	if (worktree && (slug || refresh)) throw argumentError("--worktree cannot be combined with a session slug or --refresh.");
	return { slug, worktree, json, refresh };
}

export function parseDoctorArguments(args: string[]): { slug?: string; json: boolean } {
	let slug: string | undefined;
	let json = false;
	for (const argument of args) {
		if (argument === "--json") json = true;
		else if (argument.startsWith("-")) throw unknownOption("doctor", argument, ["--json"]);
		else if (!slug) slug = argument;
		else throw argumentError(`Unexpected argument '${argument}' for 'doctor'.`);
	}
	return { slug, json };
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
		"  agent-session <task-slug> create [--dry-run] [--json] [--pr <number-or-url> [--trust-pr] [-c|--create-branch]]",
		"  agent-session <task-slug> launch",
		"  agent-session <task-slug> start [--no-agent] [--pr <number-or-url> [--trust-pr] [-c|--create-branch]]",
		"  agent-session <task-slug> resume",
		"  agent-session <task-slug> status [--json] [--refresh]",
		"  agent-session <task-slug> repair",
		"  agent-session <task-slug> finish [--keep-branch [--expected <receipt>]] [--force] [--yes] [--dry-run [--json]]",
		"  agent-session . <cd|run|launch|resume|status|doctor|finish> (current managed worktree)",
		"  agent-session [<task-slug>] doctor [--json] (read-only diagnostics)",
		"  agent-session -- <task-slug> <command> (escape a command-word slug)",
		"  agent-session list [--json] (metadata-only inventory)",
		"  agent-session batch finish --inactive-for <duration> [--exclude <slug>] [--keep-branch] --dry-run [--json]",
		"  agent-session status [--json] [--refresh]",
		"  agent-session status --worktree <path> [--json] (read-only exact inspection)",
		"  agent-session finish (--all | --gone) [--keep-branch] [--force] [--yes] [--dry-run [--json]]",
		"  agent-session completion <bash|zsh|fish>",
	].join("\n");
}
