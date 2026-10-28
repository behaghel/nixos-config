import { createHash } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { sessionCommand } from "./arguments.ts";
import { inspectIgnoredData, ignoredDataProblem, type IgnoredDataInspection } from "./artifacts.ts";
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
	sessionRecordExists,
	unrecordedWorktree,
} from "./sessions.ts";
import {
	inspectSession,
	statusCannotOperate,
	refreshMetadataRemote,
	sessionRemotes,
	sessionBaseBranch,
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
	metadata: Pick<SessionMetadata, "worktreePath">,
	invocationRoot: string,
): void {
	if (metadata.worktreePath === invocationRoot) {
		throw new CliError(
			"Cannot remove the worktree containing the current shell. Run finish from another repository worktree.",
		);
	}
}

function previewUnrecordedFinish(root: string, invocationRoot: string, slug: string): Record<string, unknown> {
	assertPrimaryCheckout(root);
	const target = unrecordedWorktree(root, slug);
	assertNotInvokingWorktree(target, invocationRoot);
	return {
		slug, branch: target.currentBranch, initialBranch: null, currentBranch: target.currentBranch,
		head: target.head, ownedBranches: [], worktreePath: target.worktreePath,
		metadataPath: metadataPath(root, slug), force: true, keepBranch: true,
		state: "unrecorded", clean: null, allBranchesPreserved: true,
		uncommittedWorkWillBeDiscarded: true, detachedHeadMayBecomeUnreachable: target.currentBranch === null,
		remoteAssetsModified: false,
	};
}

function forceFinishUnrecorded(root: string, invocationRoot: string, slug: string, yes: boolean): void {
	assertPrimaryCheckout(root);
	const target = unrecordedWorktree(root, slug);
	assertNotInvokingWorktree(target, invocationRoot);
	process.stderr.write(`Force-remove unrecorded worktree, including uncommitted and ignored local files:\n  worktree: ${target.worktreePath}\n  current branch: ${target.currentBranch ?? "detached HEAD"}\n  HEAD: ${target.head}\nAll branches will be preserved; no ownership metadata will be invented.\n`);
	if (target.currentBranch === null) process.stderr.write("Warning: detached HEAD commits may become unreachable. Create a branch first if you need to retain them.\n");
	if (!yes) {
		if (!process.stdin.isTTY) throw new CliError(`Confirmation required. Re-run: ${sessionCommand(slug, "finish")} --force --yes`);
		if (!confirm("Discard this unrecorded worktree and preserve all branches? [y/N]")) throw new CliError("Cleanup cancelled.");
	}
	// Recheck absence and physical/Git identity after the confirmation wait. Do
	// not fall back to recorded cleanup if metadata appeared in the meantime.
	const current = unrecordedWorktree(root, slug);
	assertNotInvokingWorktree(current, invocationRoot);
	if (JSON.stringify(current) !== JSON.stringify(target)) throw new CliError("Unrecorded worktree target changed; obtain a fresh preview before cleanup.");
	const removed = run("git", ["worktree", "remove", "--force", target.worktreePath], root, "inherit");
	if (removed.status !== 0) throw new CliError("Could not remove the unrecorded worktree; branches were not deleted.");
	process.stdout.write("Unrecorded worktree removed locally. All branches preserved; no session record created or deleted. Remote assets were not modified.\n");
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
	let ownedBranches = metadata.initialBranchOwned !== false && localBranches(root).has(metadata.branch)
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
	expected?: string,
	report: ProgressReporter = () => {},
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
	const metadataProgress = (path: string, entries: number) => report(`inspect-metadata-chunk:${slug}`, "completed", `${path}: ${entries} metadata entries scanned so far`);
	const ignoredData = inspectIgnoredData(root, metadata.worktreePath, config.local_links, config.disposable_paths, metadataProgress);
	if (!ignoredData.safe) throw new CliError(`Non-forced cleanup refused: ${ignoredDataProblem(ignoredData)}`);
	if (ignoredData.approvedArtifacts.length && !expected) throw new CliError("Artifact disposal requires a matching preview receipt: use finish --keep-branch --dry-run, then --expected <receipt>.");
	if (expected && previewFinish(root, invocationRoot, slug, false, keepBranch, () => {}, null, ignoredData).receipt !== expected) throw new CliError("Finish target changed; obtain a fresh preview before cleanup.");
	const diffCheck = run("git", ["diff", "--check"], metadata.worktreePath);
	if (diffCheck.status !== 0) {
		throw new CliError(diffCheck.stderr || "Git diff verification failed.");
	}
	const mergedDefault = `${metadata.remote}/${sessionBaseBranch(metadata, defaultBranch)}`;
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

	// Confirmation can wait while unmanaged work changes. Recheck the shared
	// ignored/link guard immediately before native removal; never unlink links
	// separately or follow their targets to make a refusal disappear.
	const currentConfig = loadConfig(root);
	const currentIgnoredData = inspectIgnoredData(root, metadata.worktreePath, currentConfig.local_links, currentConfig.disposable_paths, metadataProgress);
	if (!currentIgnoredData.safe) throw new CliError(`Non-forced cleanup refused: ${ignoredDataProblem(currentIgnoredData)}`);
	if (JSON.stringify(currentIgnoredData) !== JSON.stringify(ignoredData) ||
		(expected && previewFinish(root, invocationRoot, slug, false, keepBranch, () => {}, null, currentIgnoredData).receipt !== expected)) {
		throw new CliError("Finish target changed; obtain a fresh preview before cleanup.");
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
	const disposition = status.ownedBranches.length === 0
		? "Borrowed branches preserved."
		: keepBranch
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
	observedIgnoredData?: IgnoredDataInspection,
): Record<string, unknown> {
	const inspect = () => {
		validateSlug(slug);
		assertPrimaryCheckout(root);
		const config = loadConfig(root);
		const metadata = readMetadata(root, slug);
		assertConfiguredWorktreePath(root, config, metadata);
		assertNotInvokingWorktree(metadata, invocationRoot);
		const status = inspectSession(metadata);
		const ignoredData = force ? undefined : observedIgnoredData ?? inspectIgnoredData(root, metadata.worktreePath, config.local_links, config.disposable_paths,
			(path, entries) => report(`inspect-metadata-chunk:${slug}`, "completed", `${path}: ${entries} metadata entries scanned so far`));
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
			...(ignoredData ? { ignoredData, artifactDisposalRequiresReceipt: ignoredData.approvedArtifacts.length > 0 } : {}),
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
		const plan = force && !sessionRecordExists(root, slug)
			? runPhase(report, "inspect-finish", () => previewUnrecordedFinish(root, invocationRoot, slug))
			: previewFinish(root, invocationRoot, slug, force, keepBranch, report);
		const branches = (plan.ownedBranches as string[]).join(", ") || "none";
		writeCommandResult(
			{ version: 1, command: "finish", dryRun: true, plan },
			json,
			plan.allBranchesPreserved === true
				? `Would remove unrecorded local worktree ${String(plan.worktreePath)} and preserve all branches. Force discards uncommitted and ignored local files.${plan.detachedHeadMayBecomeUnreachable ? " Detached HEAD commits may become unreachable; create a branch first if needed." : ""}\n`
				: (plan.ignoredData as IgnoredDataInspection | undefined)?.safe === false
					? `Non-forced cleanup blocked: ${ignoredDataProblem(plan.ignoredData as IgnoredDataInspection)}\nNo resources changed.\n`
					: `Would remove local worktree ${String(plan.worktreePath)} and ${keepBranch ? "preserve" : "delete"} session-owned branches: ${branches}.\n`,
		);
		return;
	}
	runPhase(report, "cleanup", () =>
		withOperationLock(root, "finish", () => {
			// Only this explicit-slug entrypoint may retire an unrecorded slot.
			// Bulk cleanup continues to use recorded metadata exclusively.
			if (force && !sessionRecordExists(root, slug)) {
				if (expected) throw new CliError("Forced unrecorded cleanup does not accept a recorded-session receipt.");
				return forceFinishUnrecorded(root, invocationRoot, slug, yes);
			}
			if (
				expected && force &&
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
				: finishUnlocked(root, invocationRoot, slug, yes, keepBranch, expected, report);
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
			`Previewed cleanup plans for ${plans.length} session(s); skip ${skipped.length}. Apply rechecks all guards; no resources changed.${skippedText}`,
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
				for (const remote of new Set(records.flatMap(sessionRemotes))) {
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
						finishUnlocked(root, invocationRoot, slug, true, keepBranch, undefined, report);
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
