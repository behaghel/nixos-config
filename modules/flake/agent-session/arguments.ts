import { CliError } from "./runtime.ts";

export const commandNames = [
	"cd",
	"run",
	"create",
	"launch",
	"start",
	"resume",
	"status",
	"repair",
	"finish",
	"completion",
];

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
} {
	let slug: string | undefined;
	let dryRun = false;
	let json = false;
	for (const argument of args) {
		if (argument === "--dry-run") dryRun = true;
		else if (argument === "--json") json = true;
		else if (!argument.startsWith("-") && !slug) slug = argument;
		else if (argument.startsWith("-")) {
			throw unknownOption("create", argument, ["--dry-run", "--json"]);
		} else {
			throw argumentError(`Unexpected argument '${argument}' for 'create'.`);
		}
	}
	if (!slug) throw argumentError("Missing <task-slug> for 'create'.");
	if (json && !dryRun) {
		throw new CliError("create --json requires --dry-run.", 64);
	}
	return { slug, dryRun, json };
}

export function parseStartArguments(args: string[]): {
	slug: string;
	launchConfiguredAgent: boolean;
} {
	let slug: string | undefined;
	let launchConfiguredAgent = true;
	for (const argument of args) {
		if (argument === "--no-agent") launchConfiguredAgent = false;
		else if (!argument.startsWith("-") && !slug) slug = argument;
		else if (argument.startsWith("-")) {
			throw unknownOption("start", argument, ["--no-agent"]);
		} else {
			throw argumentError(`Unexpected argument '${argument}' for 'start'.`);
		}
	}
	if (!slug) throw argumentError("Missing <task-slug> for 'start'.");
	return { slug, launchConfiguredAgent };
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

export function parseStatusArguments(args: string[]): {
	slug?: string;
	json: boolean;
	refresh: boolean;
} {
	let slug: string | undefined;
	let json = false;
	let refresh = false;
	for (const argument of args) {
		if (argument === "--json") json = true;
		else if (argument === "--refresh") refresh = true;
		else if (!argument.startsWith("-") && !slug) slug = argument;
		else if (argument.startsWith("-")) {
			throw unknownOption("status", argument, ["--json", "--refresh"]);
		} else {
			throw argumentError(`Unexpected argument '${argument}' for 'status'.`);
		}
	}
	return { slug, json, refresh };
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
		"  as cd <task-slug> (shell integration required)",
		"  agent-session cd <task-slug> (print the worktree path)",
		"  agent-session run <task-slug> <command> [args...]",
		"  agent-session create <task-slug> [--dry-run [--json]]",
		"  agent-session launch <task-slug>",
		"  agent-session start <task-slug> [--no-agent]",
		"  agent-session resume <task-slug>",
		"  agent-session status [task-slug] [--json] [--refresh]",
		"  agent-session repair <task-slug>",
		"  agent-session finish <task-slug> [--keep-branch [--expected <receipt>]] [--force] [--yes] [--dry-run [--json]]",
		"  agent-session finish (--all | --gone) [--keep-branch] [--force] [--yes] [--dry-run [--json]]",
		"  agent-session completion <bash|zsh|fish>",
	].join("\n");
}
