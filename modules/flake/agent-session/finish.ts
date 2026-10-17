import { createHash } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { sessionCommand } from "./arguments.ts";
import {
	git,
	localBranches,
	worktreeIsRegistered,
	assertPrimaryCheckout,
	ensureClean,
	countRevisionRange,
	branchUpstreamIsGone,
} from "./git.ts";
import {
	validateSlug,
	loadConfig,
	readMetadata,
	assertConfiguredWorktreePath,
	metadataPath,
	withOperationLock,
	metadataSlugs,
} from "./sessions.ts";
import {
	inspectSession,
	statusCannotOperate,
	refreshMetadataRemote,
} from "./inspection.ts";
import {
	CliError,
	confirm,
	progressReporter,
	runPhase,
	writeCommandResult,
	run,
} from "./runtime.ts";
import type { SessionMetadata, ProgressReporter } from "./types.ts";

function assertNotInvokingWorktree(
	metadata: SessionMetadata,
	invocationRoot: string,
): void {
	if (metadata.worktreePath === invocationRoot) {
		throw new CliError(
			"Cannot remove the worktree containing the current shell. Run finish from another repository worktree.",
		);
	}
}

function forceFinishUnlocked(
	root: string,
	invocationRoot: string,
	slug: string,
	yes: boolean,
	keepBranch: boolean,
): void {
	validateSlug(slug);
	assertPrimaryCheckout(root);
	const config = loadConfig(root);
	const metadata = readMetadata(root, slug);
	assertConfiguredWorktreePath(root, config, metadata);
	assertNotInvokingWorktree(metadata, invocationRoot);
	let ownedBranches = localBranches(root).has(metadata.branch)
		? [metadata.branch]
		: [];
	if (existsSync(metadata.worktreePath)) {
		const status = inspectSession(metadata);
		if (statusCannotOperate(status)) {
			throw new CliError(
				status.problem ?? `Managed session ${slug} is unusable.`,
			);
		}
		ownedBranches = status.ownedBranches;
	}

	const branchList = ownedBranches
		.map((branch) => `  branch:   ${branch}${keepBranch ? " (preserved)" : ""}`)
		.join("\n");
	process.stderr.write(
		`Force-remove local session assets, including uncommitted or unpublished work:\n  worktree: ${metadata.worktreePath}${branchList ? `\n${branchList}` : ""}\n`,
	);
	if (!yes) {
		if (!process.stdin.isTTY) {
			throw new CliError(
				`Confirmation required. Re-run: ${sessionCommand(slug, "finish")} --force --yes`,
			);
		}
		if (!confirm("Discard local session assets? [y/N]")) {
			throw new CliError("Cleanup cancelled.");
		}
	}

	if (existsSync(metadata.worktreePath)) {
		const removed = run(
			"git",
			["worktree", "remove", "--force", metadata.worktreePath],
			root,
			"inherit",
		);
		if (removed.status !== 0) {
			throw new CliError("Could not remove the local session worktree.");
		}
	} else if (worktreeIsRegistered(root, metadata.worktreePath)) {
		const removed = run(
			"git",
			["worktree", "remove", "--force", metadata.worktreePath],
			root,
			"inherit",
		);
		if (removed.status !== 0) {
			throw new CliError("Could not remove the missing worktree registration.");
		}
	}
	if (!keepBranch) {
		for (const branch of ownedBranches) {
			const deleted = run("git", ["branch", "-D", branch], root, "inherit");
			if (deleted.status !== 0) {
				throw new CliError(
					`Worktree removed, but local branch ${branch} could not be deleted.`,
				);
			}
		}
	}
	unlinkSync(metadataPath(root, slug));
	const disposition = keepBranch
		? ownedBranches.length === 1
			? `Local branch preserved: ${ownedBranches[0]}`
			: `Local branches preserved: ${ownedBranches.join(", ")}`
		: ownedBranches.length === 1
			? "Local branch deleted."
			: `${ownedBranches.length} local branches deleted.`;
	process.stdout.write(
		`Session force-finished locally. ${disposition} Remote assets were not modified.\nProject root: ${root}\n`,
	);
}

function finishUnlocked(
	root: string,
	invocationRoot: string,
	slug: string,
	yes: boolean,
	keepBranch: boolean,
): void {
	validateSlug(slug);
	assertPrimaryCheckout(root);
	const config = loadConfig(root);
	ensureClean(root);
	const metadata = readMetadata(root, slug);
	assertConfiguredWorktreePath(root, config, metadata);
	assertNotInvokingWorktree(metadata, invocationRoot);
	const defaultBranch = keepBranch
		? metadata.defaultBranch
		: refreshMetadataRemote(root, metadata);
	const status = inspectSession(metadata, defaultBranch);
	if (statusCannotOperate(status)) {
		throw new CliError(
			status.problem ?? `Managed session ${slug} is unusable.`,
		);
	}
	if (!status.clean) {
		throw new CliError("Working tree is not clean.");
	}
	const diffCheck = run("git", ["diff", "--check"], metadata.worktreePath);
	if (diffCheck.status !== 0) {
		throw new CliError(diffCheck.stderr || "Git diff verification failed.");
	}
	const mergedDefault = `${metadata.remote}/${defaultBranch}`;
	const branchChecks = status.ownedBranches.map((branch) => {
		const merged =
			run(
				"git",
				["merge-base", "--is-ancestor", branch, mergedDefault],
				metadata.worktreePath,
			).status === 0;
		const upstream = run(
			"git",
			["rev-parse", "--abbrev-ref", `${branch}@{upstream}`],
			metadata.worktreePath,
		);
		const ahead =
			upstream.status === 0
				? countRevisionRange(
						metadata.worktreePath,
						`${upstream.stdout}..${branch}`,
					)
				: 0;
		return { branch, merged, upstream, ahead };
	});
	if (!keepBranch) {
		for (const check of branchChecks) {
			if (check.merged) continue;
			if (check.upstream.status !== 0) {
				throw new CliError(
					`Branch has no upstream: ${check.branch}. Push it before finishing.`,
				);
			}
			if (check.ahead !== 0) {
				throw new CliError(`Branch ${check.branch} has unpushed commits.`);
			}
		}
	}

	const branchList = status.ownedBranches
		.map((branch) => `  branch:   ${branch}${keepBranch ? " (preserved)" : ""}`)
		.join("\n");
	process.stderr.write(
		`Ready to remove local session assets:\n  worktree: ${metadata.worktreePath}\n${branchList}\n`,
	);
	if (!yes) {
		if (!process.stdin.isTTY) {
			throw new CliError(
				`Confirmation required. Re-run: ${sessionCommand(slug, "finish")} --yes`,
			);
		}
		if (!confirm(keepBranch ? "Remove local worktree and preserve branches? [y/N]" : "Delete local worktree and branch? [y/N]")) {
			throw new CliError("Cleanup cancelled.");
		}
	}

	const removed = run(
		"git",
		["worktree", "remove", metadata.worktreePath],
		root,
		"inherit",
	);
	if (removed.status !== 0) {
		throw new CliError("Could not remove the local session worktree.");
	}
	if (!keepBranch) {
		for (const branch of status.ownedBranches) {
			const deleted = run("git", ["branch", "-D", branch], root, "inherit");
			if (deleted.status !== 0) {
				throw new CliError(
					`Worktree removed, but local branch ${branch} could not be deleted.`,
				);
			}
		}
	}
	unlinkSync(metadataPath(root, slug));
	const onlyCheck = branchChecks.length === 1 ? branchChecks[0] : undefined;
	const disposition = keepBranch
		? status.ownedBranches.length === 1
			? `Local branch preserved: ${status.ownedBranches[0]}`
			: `Local branches preserved: ${status.ownedBranches.join(", ")}`
		: branchChecks.length > 1
			? `${branchChecks.length} local branches deleted. Remote assets preserved.`
			: onlyCheck?.merged
				? `Merged into: ${mergedDefault}`
				: `Remote branch preserved: ${onlyCheck?.upstream.stdout ?? "none"}`;
	process.stdout.write(
		`Session finished locally. ${disposition}\nProject root: ${root}\n`,
	);
}

function previewFinish(
	root: string,
	invocationRoot: string,
	slug: string,
	force: boolean,
	keepBranch: boolean,
	report: ProgressReporter,
	phase: string | null = "inspect-finish",
): Record<string, unknown> {
	const inspect = () => {
		validateSlug(slug);
		assertPrimaryCheckout(root);
		const config = loadConfig(root);
		const metadata = readMetadata(root, slug);
		assertConfiguredWorktreePath(root, config, metadata);
		assertNotInvokingWorktree(metadata, invocationRoot);
		const status = inspectSession(metadata);
		const plan = {
			slug,
			branch: status.currentBranch ?? metadata.branch,
			initialBranch: metadata.branch,
			currentBranch: status.currentBranch,
			ownedBranches: status.ownedBranches,
			worktreePath: metadata.worktreePath,
			metadataPath: metadataPath(root, slug),
			force,
			keepBranch,
			state: status.state,
			clean: status.clean,
			remoteAssetsModified: false,
		};
		if (force || !keepBranch) return plan;
		const head = existsSync(metadata.worktreePath)
			? run("git", ["rev-parse", "HEAD"], metadata.worktreePath)
			: null;
		return {
			...plan,
			receipt: createHash("sha256")
				.update(
					JSON.stringify([
						plan,
						metadata.createdAt,
						head?.status === 0 ? head.stdout : null,
					]),
				)
				.digest("hex"),
		};
	};
	return phase ? runPhase(report, phase, inspect) : inspect();
}

export function finish(
	root: string,
	invocationRoot: string,
	slug: string,
	yes: boolean,
	force: boolean,
	keepBranch: boolean,
	dryRun: boolean,
	json: boolean,
	expected?: string,
): void {
	const report = progressReporter("finish", json);
	if (dryRun) {
		const plan = previewFinish(
			root,
			invocationRoot,
			slug,
			force,
			keepBranch,
			report,
		);
		const branches = (plan.ownedBranches as string[]).join(", ") || "none";
		writeCommandResult(
			{ version: 1, command: "finish", dryRun: true, plan },
			json,
			`Would remove local worktree ${String(plan.worktreePath)} and ${keepBranch ? "preserve" : "delete"} session-owned branches: ${branches}.\n`,
		);
		return;
	}
	runPhase(report, "cleanup", () =>
		withOperationLock(root, "finish", () => {
			if (
				expected &&
				previewFinish(
					root,
					invocationRoot,
					slug,
					force,
					keepBranch,
					report,
					null,
				).receipt !== expected
			)
				throw new CliError(
					"Finish target changed; obtain a fresh preview before cleanup.",
				);
			return force
				? forceFinishUnlocked(root, invocationRoot, slug, yes, keepBranch)
				: finishUnlocked(root, invocationRoot, slug, yes, keepBranch);
		}),
	);
}

function confirmBulkFinish(mode: "all" | "gone", count: number, yes: boolean) {
	if (yes || count === 0) return;
	if (!process.stdin.isTTY) {
		throw new CliError(
			`Confirmation required. Re-run: agent-session finish --${mode} --yes`,
		);
	}
	if (!confirm(`Finish ${count} local session(s)? [y/N]`)) {
		throw new CliError("Finish cancelled.");
	}
}

export function finishBulk(
	root: string,
	invocationRoot: string,
	mode: "all" | "gone",
	yes: boolean,
	force: boolean,
	keepBranch: boolean,
	dryRun: boolean,
	json: boolean,
): void {
	const report = progressReporter("finish", json);
	if (dryRun) {
		const plans: Record<string, unknown>[] = [];
		const skipped: string[] = [];
		runPhase(report, "inspect-bulk-finish", () => {
			for (const slug of metadataSlugs(root)) {
				try {
					const metadata = readMetadata(root, slug);
					if (mode === "gone" && !branchUpstreamIsGone(root, metadata.branch)) {
						continue;
					}
					plans.push(
						previewFinish(
							root,
							invocationRoot,
							slug,
							force,
							keepBranch,
							report,
							null,
						),
					);
				} catch (error) {
					const problem = `${slug}: ${error instanceof Error ? error.message : String(error)}`;
					skipped.push(problem);
					report(`inspect-finish:${slug}`, "skipped", problem);
				}
			}
		});
		const skippedText = skipped.length
			? `\nSkipped:\n${skipped.map((problem) => `  - ${problem}`).join("\n")}\n`
			: "";
		writeCommandResult(
			{
				version: 1,
				command: "finish",
				dryRun: true,
				mode,
				plans,
				skipped,
				basedOnLocalRefs: mode === "gone",
			},
			json,
			`Would finish ${plans.length} session(s); skip ${skipped.length}.${skippedText}`,
		);
		return;
	}
	runPhase(report, "bulk-cleanup", () =>
		withOperationLock(root, "finish", () => {
			assertPrimaryCheckout(root);
			const slugs = metadataSlugs(root);
			let candidates = slugs;
			const preflightSkipped: string[] = [];
			if (mode === "gone") {
				const records: SessionMetadata[] = [];
				for (const slug of slugs) {
					try {
						records.push(readMetadata(root, slug));
					} catch (error) {
						preflightSkipped.push(
							`${slug}: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
				}
				for (const remote of new Set(records.map((record) => record.remote))) {
					const fetched = run(
						"git",
						["fetch", "--prune", remote],
						root,
						"inherit",
					);
					if (fetched.status !== 0) {
						throw new CliError(`Could not fetch ${remote}.`);
					}
				}
				candidates = records
					.filter((record) => branchUpstreamIsGone(root, record.branch))
					.map((record) => record.slug);
			}
			confirmBulkFinish(mode, candidates.length, yes);
			let finished = 0;
			const skipped = [...preflightSkipped];
			for (const slug of candidates) {
				try {
					if (force) {
						forceFinishUnlocked(root, invocationRoot, slug, true, keepBranch);
					} else {
						finishUnlocked(root, invocationRoot, slug, true, keepBranch);
					}
					finished += 1;
				} catch (error) {
					skipped.push(
						`${slug}: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
			for (const problem of skipped) {
				process.stderr.write(`[agent-session] SKIPPED ${problem}\n`);
			}
			process.stdout.write(
				`Finished ${finished} session(s); skipped ${skipped.length}.\n`,
			);
		}),
	);
}
