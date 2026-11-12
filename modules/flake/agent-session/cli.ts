#!/usr/bin/env node
import { CliError } from "./runtime.ts";
import { primaryRoot, repositoryRoot } from "./git.ts";
import { sessionDirectory, resolveSessionTarget } from "./sessions.ts";
import { create, createBranch, runInSession, launch, start, repair } from "./lifecycle.ts";
import { showInventory, showStatus, showExactStatus } from "./inspection.ts";
import { doctor } from "./doctor.ts";
import { finish, finishBulk, finishSessionTree } from "./finish.ts";
import { finishWorktreeBranches } from "./finish-branches.ts";
import { batchFinish } from "./batch.ts";
import { reconcileActivity } from "./activity.ts";
import { mapOwnership } from "./ownership.ts";
import {
	commandNames,
	argumentError,
	didYouMean,
	parseCreateArguments,
	parseBranchArguments,
	parseActivityArguments,
	parseOwnershipArguments,
	parseStartArguments,
	parseFinishArguments,
	parseStatusArguments,
	parseBatchArguments,
	parseDoctorArguments,
	parseRequiredSlug,
	parseInvocation,
	legacySessionSyntax,
} from "./arguments.ts";
import { completionCandidates, completionScript } from "./completion.ts";

export function main(args: string[]): number {
	try {
		const invocation = parseInvocation(args);
		const { command, args: rest } = invocation;
		if (command === "cd") {
			const slug = resolveSessionTarget(parseRequiredSlug(command, rest));
			process.stdout.write(`${sessionDirectory(primaryRoot(repositoryRoot()), slug)}\n`);
			return 0;
		}
		if (command === "run") {
			const slug = parseRequiredSlug(command, rest.slice(0, 1));
			const target = rest.slice(1);
			if (!target[0]) throw argumentError("Missing <command> for 'run'.");
			return runInSession(primaryRoot(repositoryRoot()), resolveSessionTarget(slug), target);
		}
		if (command === "activity") {
			const options = parseActivityArguments(rest);
			const invocationRoot = repositoryRoot();
			return reconcileActivity(primaryRoot(invocationRoot), resolveSessionTarget(options.slug, invocationRoot), options.dryRun, options.json);
		}
		if (command === "ownership") {
			const options = parseOwnershipArguments(rest);
			mapOwnership(primaryRoot(repositoryRoot()), { ...options, slug: resolveSessionTarget(options.slug) });
			return 0;
		}
		if (command === "branch") {
			const options = parseBranchArguments(rest);
			createBranch(primaryRoot(repositoryRoot()), resolveSessionTarget(options.slug), options.name, options.json);
			return 0;
		}
		if (command === "create") {
			const options = parseCreateArguments(rest);
			return create(
				primaryRoot(repositoryRoot()),
				options.slug,
				options.dryRun,
				options.json,
				options.pr,
				options.trustPr,
			);
		}
		if (command === "completion") {
			if (rest.length === 0) {
				throw argumentError("Missing <shell> for 'completion'.");
			}
			if (rest.length > 1) {
				throw argumentError(
					`Unexpected argument '${rest[1]}' for 'completion'.`,
				);
			}
			process.stdout.write(completionScript(rest[0] ?? ""));
			return 0;
		}
		if (command === "__complete") {
			if (rest.length !== 1) return 0;
			const candidates = completionCandidates(rest[0] ?? "");
			if (candidates.length > 0) {
				process.stdout.write(`${candidates.join("\n")}\n`);
			}
			return 0;
		}
		if (command === "launch") {
			const slug = resolveSessionTarget(parseRequiredSlug("launch", rest));
			return launch(primaryRoot(repositoryRoot()), slug);
		}
		if (command === "start") {
			const options = parseStartArguments(rest);
			const root = primaryRoot(repositoryRoot());
			return start(root, options.slug, options.launchConfiguredAgent, options.pr, options.trustPr);
		}
		if (command === "resume") {
			const slug = resolveSessionTarget(parseRequiredSlug("resume", rest));
			return launch(primaryRoot(repositoryRoot()), slug, "resume", [
				"--continue",
			]);
		}
		if (command === "batch") {
			const options = parseBatchArguments(rest);
			const invocationRoot = repositoryRoot();
			return batchFinish(primaryRoot(invocationRoot), invocationRoot, options);
		}
		if (command === "list") {
			if (rest.some((argument) => argument !== "--json"))
				throw argumentError("Use: agent-session list [--json].");
			showInventory(primaryRoot(repositoryRoot()), rest.includes("--json"));
			return 0;
		}
		if (command === "status") {
			const options = parseStatusArguments(rest);
			if (options.worktree) {
				showExactStatus(primaryRoot(repositoryRoot()), options.worktree, options.json);
				return 0;
			}
			if (invocation.global && options.slug) throw legacySessionSyntax(command);
			showStatus(
				primaryRoot(repositoryRoot()),
				options.slug === undefined ? undefined : resolveSessionTarget(options.slug),
				options.json,
				options.refresh,
			);
			return 0;
		}
		if (command === "doctor") {
			const options = parseDoctorArguments(rest);
			if (invocation.global && options.slug) throw legacySessionSyntax(command);
			return doctor(options.slug, options.json);
		}
		if (command === "repair") {
			const slug = parseRequiredSlug("repair", rest);
			repair(primaryRoot(repositoryRoot()), slug);
			return 0;
		}
		if (command === "finish") {
			const options = parseFinishArguments(rest);
			if (invocation.global && options.slug) throw legacySessionSyntax(command);
			const invocationRoot = repositoryRoot();
			const root = primaryRoot(invocationRoot);
			if (options.branches) {
				return finishWorktreeBranches(root, invocationRoot, resolveSessionTarget(options.slug!, invocationRoot), options.keepBranch, options.dryRun, options.json);
			} else if (options.slug && options.all) {
				return finishSessionTree(root, invocationRoot, resolveSessionTarget(options.slug, invocationRoot),
					options.keepBranch, options.dryRun, options.json, options.expected);
			} else if (options.all || options.gone) {
				finishBulk(
					root,
					invocationRoot,
					options.all ? "all" : "gone",
					options.yes,
					options.force,
					options.keepBranch,
					options.dryRun,
					options.json,
				);
			} else {
				finish(
					root,
					invocationRoot,
					resolveSessionTarget(options.slug ?? "", invocationRoot),
					options.yes,
					options.force,
					options.keepBranch,
					options.dryRun,
					options.json,
					options.expected,
				);
			}
			return 0;
		}
		if (!command) throw argumentError("Missing command.");
		throw argumentError(
			`Unknown command '${command}'.${didYouMean(command, commandNames)}`,
		);
	} catch (error) {
		if (error instanceof CliError) {
			process.stderr.write(`${error.message}\n`);
			return error.exitCode;
		}
		process.stderr.write(`${String(error)}\n`);
		return 1;
	}
}

if (import.meta.main) {
	// Let pending stdout/stderr writes drain before Node exits, including JSON
	// responses larger than a pipe buffer. An immediate exit can truncate them.
	process.exitCode = main(process.argv.slice(2));
}
