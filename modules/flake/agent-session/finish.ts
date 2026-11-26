import { createHash } from "node:crypto";
import { FinishOutput, type CleanupScope } from "./finish-output.ts";
import { confirmReconciliation, inspectReconciliation } from "./activity.ts";
import { scopedFinishDefaults } from "./preferences.ts";
import { BatchOutput, cleanupDiagnostic, cleanupReason, type CleanupOutcome } from "./batch-output.ts";
import { CleanupPreview, type CleanupProposal } from "./cleanup-preview.ts";
import { inspectTreeBranches, assertTreeBranchUnchanged, deleteTreeBranch, type TreeBranch } from "./tree-branches.ts";
import { captureProcesses, inspectCandidate, inspectWorktreeActivity, rootKey, journalStore, residualRecord, completeRemoval, type Candidate, type Target, type Outcome } from "./batch.ts";
import { existsSync, lstatSync, unlinkSync } from "node:fs";
import { sessionCommand } from "./arguments.ts";
import { inspectIgnoredData, ignoredDataProblem, artifactSummary, type IgnoredDataInspection } from "./artifacts.ts";
import {
	git,
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
	readMetadataInventory,
	assertConfiguredWorktreePath,
	metadataPath,
	archiveMetadata,
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
	sessionBranchSets,
	snapshotExactResources,
	inspectExactResource,
	sharedBranchClaims,
} from "./inspection.ts";
import {
	CliError,
	confirm,
	formatStateTable,
	progressReporter,
	runPhase,
	writeCommandResult,
	withInspection,
	type InspectionProgress,
	run,
} from "./runtime.ts";
import type { SessionMetadata, SessionStatus, ProgressReporter, BatchFinishOptions, PresentationOptions } from "./types.ts";

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

function assertNoWorktreeActivity(metadata: SessionMetadata): void {
	const activity = inspectWorktreeActivity(metadata);
	if (!activity.blockers.length) return;
	const problems = activity.blockers.map((blocker) => blocker.reason === "live-cwd"
		? `Processes using worktree ${metadata.worktreePath}: ${activity.pids.join(", ")}. Leave or stop that work before cleanup.`
		: blocker.problem ?? blocker.reason);
	throw new CliError(`Non-forced cleanup blocked.\n${problems.join("\n")}\nNo local session assets were removed.`);
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

type CleanupOutput = Pick<FinishOutput, "plan" | "confirm" | "begin" | "starting" | "removedWorktree" | "completed" | "finish">;

function cleanupGit(root: string, args: string[], problem: string, output?: CleanupOutput, verbose = false): void {
	const result = run("git", args, root, output && !verbose ? "pipe" : "inherit");
	if (result.status !== 0) throw new CliError([problem, result.stdout, result.stderr, result.errorCode].filter(Boolean).join("\n"));
}

function forceFinishUnrecorded(root: string, invocationRoot: string, slug: string, yes: boolean, output?: CleanupOutput, verbose = false): void {
	assertPrimaryCheckout(root);
	const target = unrecordedWorktree(root, slug);
	assertNotInvokingWorktree(target, invocationRoot);
	if (output) output.plan({ slug, worktreePath: target.worktreePath, currentBranch: target.currentBranch, head: target.head, ownedBranches: [], keepBranch: true, unrecorded: true, force: true });
	else process.stderr.write(`Force-remove unrecorded worktree, including uncommitted and ignored local files:\n  worktree: ${target.worktreePath}\n  current branch: ${target.currentBranch ?? "detached HEAD"}\n  HEAD: ${target.head}\nAll branches will be preserved; no ownership metadata will be invented.\n`);
	if (!output && target.currentBranch === null) process.stderr.write("Warning: detached HEAD commits may become unreachable. Create a branch first if you need to retain them.\n");
	if (!yes) {
		if (!process.stdin.isTTY) throw new CliError(`Confirmation required. Re-run: ${sessionCommand(slug, "finish")} --force --keep-branch --yes`);
		if (!(output ? output.confirm(true) : confirm("Discard this unrecorded worktree and preserve all branches? [y/N]"))) throw new CliError("Cleanup cancelled.");
	}
	// Recheck absence and physical/Git identity after the confirmation wait. Do
	// not fall back to recorded cleanup if metadata appeared in the meantime.
	const current = unrecordedWorktree(root, slug);
	assertNotInvokingWorktree(current, invocationRoot);
	if (JSON.stringify(current) !== JSON.stringify(target)) throw new CliError("Unrecorded worktree target changed; obtain a fresh preview before cleanup.");
	output?.begin(); output?.starting("worktree", "Removing");
	cleanupGit(root, ["worktree", "remove", "--force", target.worktreePath], "Could not remove the unrecorded worktree; branches were not deleted.", output, verbose);
	output?.removedWorktree();
	const summary = "Unrecorded worktree removed locally. All branches preserved; no session record created or deleted. Remote assets were not modified.";
	if (output) output.finish(summary); else process.stdout.write(`${summary}\n`);
}

function forceFinishUnlocked(
	root: string,
	invocationRoot: string,
	slug: string,
	yes: boolean,
	keepBranch: boolean,
	output?: CleanupOutput,
	verbose = false,
	reviewOnly = false,
): void {
	validateSlug(slug);
	assertPrimaryCheckout(root);
	const config = loadConfig(root);
	const metadata = readMetadata(root, slug);
	assertConfiguredWorktreePath(root, config, metadata);
	assertNotInvokingWorktree(metadata, invocationRoot);
	let ownedBranches = sessionBranchSets(metadata, root).owned;
	let currentBranch: string | null = null;
	if (existsSync(metadata.worktreePath)) {
		const status = inspectSession(metadata);
		if (statusCannotOperate(status)) {
			throw new CliError(
				status.problem ?? `Managed session ${slug} is unusable.`,
			);
		}
		ownedBranches = status.ownedBranches;
		currentBranch = status.currentBranch;
	}

	const branchList = ownedBranches
		.map((branch) => `  branch:   ${branch}${keepBranch ? " (preserved)" : ""}`)
		.join("\n");
	if (output) output.plan({ slug, worktreePath: metadata.worktreePath, metadataPath: metadataPath(root, slug), currentBranch, ownedBranches, keepBranch, force: true });
	else process.stderr.write(
		`Force-remove local session assets, including uncommitted or unpublished work:\n  worktree: ${metadata.worktreePath}${branchList ? `\n${branchList}` : ""}\n`,
	);
	if (reviewOnly) return;
	if (!yes) {
		if (!process.stdin.isTTY) {
			throw new CliError(
				`Confirmation required. Re-run: ${sessionCommand(slug, "finish")} --force ${keepBranch ? "--keep-branch" : "--delete-branches"} --yes`,
			);
		}
		if (!(output ? output.confirm(true) : confirm("Discard local session assets? [y/N]"))) {
			throw new CliError("Cleanup cancelled.");
		}
	}

	output?.begin();
	if (existsSync(metadata.worktreePath)) {
		output?.starting("worktree", "Removing");
		cleanupGit(root, ["worktree", "remove", "--force", metadata.worktreePath], "Could not remove the local session worktree.", output, verbose);
		output?.removedWorktree();
	} else if (worktreeIsRegistered(root, metadata.worktreePath)) {
		output?.starting("worktree", "Unregistering");
		cleanupGit(root, ["worktree", "remove", "--force", metadata.worktreePath], "Could not remove the missing worktree registration.", output, verbose);
		output?.completed("worktree", "Unregistered");
	} else output?.completed("worktree", "Absent");
	if (!keepBranch) {
		for (const branch of ownedBranches) {
			output?.starting(`branch:${branch}`, "Deleting");
			cleanupGit(root, ["branch", "-D", branch], `Worktree removed, but local branch ${branch} could not be deleted.`, output, verbose);
			output?.completed(`branch:${branch}`, "Deleted");
		}
	}
	output?.starting("record", "Removing");
	unlinkSync(metadataPath(root, slug));
	output?.completed("record", "Removed");
	const disposition = keepBranch
		? ownedBranches.length === 1
			? `Local branch preserved: ${ownedBranches[0]}`
			: `Local branches preserved: ${ownedBranches.join(", ")}`
		: ownedBranches.length === 1
			? "Local branch deleted."
			: `${ownedBranches.length} local branches deleted.`;
	const summary = `Session force-finished locally. ${disposition} Remote assets were not modified.`;
	if (output) output.finish(summary); else process.stdout.write(`${summary}\nProject root: ${root}\n`);
}

// Interactive consent binds the observed scope, not a token the user must copy.
// Include refs and full binding metadata so a confirmation wait cannot approve
// changed commits or ownership merely because ignored artifacts stayed put.
function finishApprovalFingerprint(root: string, metadata: SessionMetadata, status: SessionStatus, ignoredData: IgnoredDataInspection): string {
	const branches = [...new Set([...status.ownedBranches, ...(status.currentBranch ? [status.currentBranch] : [])])].sort();
	const refs = branches.map((branch) => [branch, git(root, ["rev-parse", "--verify", `refs/heads/${branch}`])]);
	return createHash("sha256").update(JSON.stringify([
		metadata, status, ignoredData, refs,
		git(metadata.worktreePath, ["rev-parse", "--verify", "HEAD"]),
		git(metadata.worktreePath, ["rev-parse", "--absolute-git-dir"]),
	])).digest("hex");
}

function finishUnlocked(
	root: string,
	invocationRoot: string,
	slug: string,
	yes: boolean,
	keepBranch: boolean,
	expected?: string,
	report: ProgressReporter = () => {},
	output?: CleanupOutput,
	verbose = false,
	reviewOnly = false,
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
	assertNoWorktreeActivity(metadata);
	const metadataProgress = (path: string, entries: number) => report(`inspect-metadata-chunk:${slug}`, "completed", `${path}: ${entries} metadata entries scanned so far`);
	const ignoredData = inspectIgnoredData(root, metadata.worktreePath, config.local_links, config.disposable_paths, metadataProgress, config.generated_links);
	if (!ignoredData.safe) throw new CliError(`Non-forced cleanup refused: ${ignoredDataProblem(ignoredData)}`);
	const interactive = !yes && Boolean(process.stdin.isTTY);
	if (ignoredData.approvedArtifacts.length && !expected && !interactive) throw new CliError("Artifact disposal requires terminal confirmation or a matching preview receipt: use finish --keep-branch --dry-run --json, then --keep-branch --expected <receipt> --yes.");
	const approval = interactive ? finishApprovalFingerprint(root, metadata, status, ignoredData) : undefined;
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
		.map((branch) => `  branch:   ${branch} (${keepBranch ? "preserved" : "delete"})`)
		.join("\n");
	report.flush?.();
	if (output) output.plan({ slug, worktreePath: metadata.worktreePath, metadataPath: metadataPath(root, slug), currentBranch: status.currentBranch, ownedBranches: status.ownedBranches, keepBranch, ignoredData });
	else process.stderr.write(
		`Ready to remove local session assets:\n  worktree: ${metadata.worktreePath}\n${branchList}\n${artifactSummary(ignoredData)}`,
	);
	if (reviewOnly) return;
	if (!yes) {
		if (!process.stdin.isTTY) {
			throw new CliError(
				`Confirmation required. Re-run: ${sessionCommand(slug, "finish")} ${keepBranch ? "--keep-branch" : "--delete-branches"} --yes`,
			);
		}
		if (!(output ? output.confirm() : confirm(keepBranch ? "Remove local worktree and preserve branches? [y/N]" : "Delete local worktree and branch? [y/N]"))) {
			throw new CliError("Cleanup cancelled.");
		}
	}

	// Confirmation can wait while unmanaged work changes. Recheck the shared
	// ignored/link guard immediately before native removal; never unlink links
	// separately or follow their targets to make a refusal disappear.
	const currentConfig = loadConfig(root);
	const currentIgnoredData = inspectIgnoredData(root, metadata.worktreePath, currentConfig.local_links, currentConfig.disposable_paths, metadataProgress, currentConfig.generated_links);
	if (!currentIgnoredData.safe) throw new CliError(`Non-forced cleanup refused: ${ignoredDataProblem(currentIgnoredData)}`);
	if (JSON.stringify(currentIgnoredData) !== JSON.stringify(ignoredData) ||
		(expected && previewFinish(root, invocationRoot, slug, false, keepBranch, () => {}, null, currentIgnoredData).receipt !== expected)) {
		throw new CliError("Finish target changed; obtain a fresh preview before cleanup.");
	}
	const currentMetadata = readMetadata(root, slug);
	assertConfiguredWorktreePath(root, currentConfig, currentMetadata);
	if (approval) {
		const currentStatus = inspectSession(currentMetadata, defaultBranch);
		if (finishApprovalFingerprint(root, currentMetadata, currentStatus, currentIgnoredData) !== approval) throw new CliError("Finish target changed; inspect it again before cleanup.");
	}
	// Managed starts are serialized by the lifecycle lock. Unmanaged writers
	// are not: take a fresh cwd snapshot after the wait and expensive rechecks.
	assertNoWorktreeActivity(currentMetadata);
	report.flush?.();
	output?.begin(); output?.starting("worktree", "Removing");
	cleanupGit(root, ["worktree", "remove", metadata.worktreePath], "Could not remove the local session worktree.", output, verbose);
	output?.removedWorktree();
	if (!keepBranch) {
		for (const branch of status.ownedBranches) {
			output?.starting(`branch:${branch}`, "Deleting");
			cleanupGit(root, ["branch", "-D", branch], `Worktree removed, but local branch ${branch} could not be deleted.`, output, verbose);
			output?.completed(`branch:${branch}`, "Deleted");
		}
	}
	output?.starting("record", "Removing");
	unlinkSync(metadataPath(root, slug));
	output?.completed("record", "Removed");
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
	const summary = `Session finished locally. ${disposition}`;
	if (output) output.finish(summary); else process.stdout.write(`${summary}\nProject root: ${root}\n`);
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
		if (!force && !statusCannotOperate(status)) assertNoWorktreeActivity(metadata);
		const ignoredData = force ? undefined : observedIgnoredData ?? inspectIgnoredData(root, metadata.worktreePath, config.local_links, config.disposable_paths,
			(path, entries) => report(`inspect-metadata-chunk:${slug}`, "completed", `${path}: ${entries} metadata entries scanned so far`), config.generated_links);
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
	options: PresentationOptions & { deleteBranches?: boolean } = {},
): void {
	withInspection("Inspecting cleanup", json, options, (progress) => {
		const output = json ? undefined : new FinishOutput(options);
		if (options.verbose) progress.flush();
		const report = json || options.verbose ? progressReporter("finish", json) : Object.assign(((phase: string, status: string) => {
			if (!output?.started && (status === "started" || phase.startsWith("inspect-metadata-chunk:"))) progress.update("Inspecting cleanup");
		}) as ProgressReporter, { flush: () => progress.flush() });
		const assertUnrecordedChoice = () => {
			if (options.deleteBranches) throw new CliError("--delete-branches is unsupported for unrecorded cleanup; all local branches must be preserved.", 64);
		};
		try {
			if (dryRun) {
				if (force && !sessionRecordExists(root, slug)) assertUnrecordedChoice();
				const plan = force && !sessionRecordExists(root, slug)
					? runPhase(report, "inspect-finish", () => previewUnrecordedFinish(root, invocationRoot, slug))
					: previewFinish(root, invocationRoot, slug, force, keepBranch, report);
				progress.flush();
				writeCommandResult({ version: 1, command: "finish", dryRun: true, plan }, json, output?.preview(plan) ?? "");
				return;
			}
			runPhase(report, "cleanup", () => withOperationLock(root, "finish", () => {
				// Unrecorded retirement remains exclusive to this explicit-slug path.
				if (force) {
					progress.flush();
					if (!sessionRecordExists(root, slug)) {
						assertUnrecordedChoice();
						if (expected) throw new CliError("Forced unrecorded cleanup does not accept a recorded-session receipt.");
						return forceFinishUnrecorded(root, invocationRoot, slug, yes, output, options.verbose);
					}
					if (expected && previewFinish(root, invocationRoot, slug, force, keepBranch, report, null).receipt !== expected) throw new CliError("Finish target changed; obtain a fresh preview before cleanup.");
					return forceFinishUnlocked(root, invocationRoot, slug, yes, keepBranch, output, options.verbose);
				}
				return finishUnlocked(root, invocationRoot, slug, yes, keepBranch, expected, report, output, options.verbose);
			}));
		} catch (error) { progress.flush(); output?.abort(); throw error; }
	});
}

function selectSessionTree(root: string, slug: string) {
	validateSlug(slug);
	const records = readMetadataInventory(root);
	const target = records.find((record) => record.slug === slug);
	if (!target) throw new CliError(`No managed session: ${slug}`);
	const byId = new Map<string, SessionMetadata>();
	const skipped: string[] = [];
	const ancestryIssues: { slug: string; problem: string }[] = [];
	for (const record of records) {
		if (!record.sessionId) {
			skipped.push(`${record.slug}: unknown ancestry; explicit reviewed ownership mapping required; preserved.`);
			ancestryIssues.push({ slug: record.slug, problem: "Unknown ancestry; explicit reviewed ownership mapping required; preserved." });
			continue;
		}
		if (byId.has(record.sessionId)) throw new CliError("Duplicate session identity; recursive ownership is unresolved. No resources changed.");
		byId.set(record.sessionId, record);
	}
	// Check full ancestry, including orphans and cycles, without assigning an
	// old parent's surviving descendants to a newly reused slug.
	const unresolved = new Set<string>();
	for (const record of byId.values()) {
		const seen = new Set<string>();
		let current = record;
		while (current.sessionId) {
			if (seen.has(current.sessionId)) throw new CliError("Cyclic session ownership; no resources changed.");
			seen.add(current.sessionId);
			if (current.parentSessionId === null) break;
			const parent = byId.get(current.parentSessionId!);
			if (!parent) {
				unresolved.add(record.sessionId!);
				skipped.push(`${record.slug}: unresolved parent ${current.parentSessionId}; preserved.`);
				ancestryIssues.push({ slug: record.slug, problem: `Unresolved parent ${current.parentSessionId}; preserved.` });
				break;
			}
			current = parent;
		}
	}
	const selected: SessionMetadata[] = [];
	const visit = (record: SessionMetadata) => {
		if (!record.sessionId || unresolved.has(record.sessionId)) return;
		for (const child of records) {
			if (child.parentSessionId === record.sessionId) visit(child);
		}
		selected.push(record);
	};
	visit(target);
	const selectedSlugs = new Set(selected.map((record) => record.slug));
	const sharedBranches = sharedBranchClaims(records).filter((branch) => branch.claims.some((claim) => selectedSlugs.has(claim.slug)));
	return { target, selected, records, skipped, sharedBranches, ancestryIssues };
}

interface TreePreviewObserver {
	start(slugs: string[], ancestryIssues: { slug: string; problem: string }[]): void;
	checking(slug: string): void;
	planned(plan: Record<string, unknown>): void;
	failed(slug: string, problem: string): void;
	complete(candidate: Candidate): void;
}

function treePreviewProposal(slug: string, plan?: Record<string, unknown>, candidate?: Candidate): CleanupProposal {
	const ignored = plan?.ignoredData as IgnoredDataInspection | undefined;
	const unresolved = plan?.unresolvedBranches as string[] | undefined;
	const shared = plan?.sharedBranches as { name: string; claims: { slug: string }[] }[] | undefined;
	const remove = candidate ? Boolean(candidate.snapshot && plan) : Boolean(plan && ["ready", "stale"].includes(String(plan.state)) && plan.clean === true && ignored?.safe !== false && !unresolved?.length && !shared?.length);
	const reason = candidate ? candidate.reason === "eligible" ? plan ? "Checks passed; branches preserved" : "Scope inspection incomplete"
		: ({ "unresolved-ownership": "Ownership needs review", "shared-branch-claims": "Shared branch claims" }[candidate.reason] ?? cleanupReason(candidate.reason))
		: !plan ? "Scope inspection incomplete" : plan.clean === false ? "Uncommitted changes" : shared?.length ? "Shared branch claims" : unresolved?.length ? "Ownership needs review"
		: ignored?.safe === false ? "Ignored data needs review" : remove ? "Apply checks branch safety" : "Binding needs inspection";
	const path = plan?.worktreePath ?? candidate?.worktreePath;
	return { slug, remove, reason, details: [
		...(path ? [String(path)] : []),
		...(plan ? [`Recorded owned branches: ${(plan.ownedBranches as string[]).join(", ") || "none"}`] : []),
		...(unresolved?.length ? [`Unresolved branches preserved: ${unresolved.join(", ")}`] : []),
		...(shared?.map((branch) => `Shared branch preserved: ${branch.name}; claimants: ${branch.claims.map((claim) => claim.slug).join(", ")}`) ?? []),
		...(ignored?.approvedArtifacts.map((path) => `Artifact scope: ${path}; preview performs no disposal`) ?? []),
		...(ignored && !ignored.safe ? [ignoredDataProblem(ignored)] : []),
		...(candidate?.blockers.map((blocker) => blocker.problem ?? cleanupReason(blocker.reason)) ?? []),
		...(candidate?.git?.changes?.map((change) => `${change.status}: ${change.path}`) ?? []),
	] };
}

export function finishSessionTree(root: string, invocationRoot: string, slug: string, keepBranch: boolean, dryRun: boolean, json: boolean, expected?: string, options: PresentationOptions = {}): number {
	if (expected && !dryRun) return withInspection("Checking approved recursive cleanup", json, options,
		(progress) => applySessionTree(root, invocationRoot, slug, expected, json, undefined, options, progress));
	if (!dryRun && !process.stdin.isTTY) throw new CliError("Recursive finish requires a terminal, or --keep-branch --expected <tree-receipt> --yes after a dry-run preview.");
	if (dryRun && json) {
		const preview = previewSessionTree(root, invocationRoot, slug, keepBranch, true);
		writeCommandResult(preview.value, true, preview.text);
		return 0;
	}
	if (dryRun) return withInspection("Inspecting recursive cleanup preview", false, options, (progress) => {
		if (options.verbose) progress.flush();
		const nativeReport = progressReporter("finish", false);
		const report: ProgressReporter = options.verbose ? (phase, status, detail) => nativeReport(phase, status, detail === undefined ? undefined : cleanupDiagnostic(detail)) : () => {};
		let display: CleanupPreview | undefined;
		const plans = new Map<string, Record<string, unknown>>(), results = new Map<string, CleanupProposal>(), problems = new Map<string, string>();
		const inspectedSlugs = new Set<string>();
		const complete = (proposal: CleanupProposal) => {
			if (problems.has(proposal.slug)) proposal.details.push(problems.get(proposal.slug)!);
			results.set(proposal.slug, proposal); display?.complete(proposal);
		};
		const observer: TreePreviewObserver = {
			start(slugs, ancestryIssues) {
				progress.flush(); display = new CleanupPreview(slugs, options, `recursive cleanup · ${slug}`, [
					keepBranch ? "Branches preserved; all selected resources must pass before apply" : "Branch deletion requested; apply rechecks all guards; no automated deletion receipt",
					...(ancestryIssues.length ? ["Unresolved ancestry remains outside the resolved tree selection"] : []),
				]); display.start();
				for (const issue of ancestryIssues) complete({ slug: issue.slug, remove: false, reason: "Ownership needs review", details: [issue.problem] });
			},
			checking(name) { inspectedSlugs.add(name); display?.checking(name); },
			planned(plan) { plans.set(String(plan.slug), plan); if (!keepBranch) complete(treePreviewProposal(String(plan.slug), plan)); },
			failed(name, problem) { problems.set(name, problem); complete({ slug: name, remove: false, reason: problem.startsWith("Non-forced cleanup blocked.") ? "Activity blocks cleanup" : "Scope inspection incomplete", details: [] }); },
			complete(candidate) { complete(treePreviewProposal(candidate.slug, plans.get(candidate.slug), candidate)); },
		};
		try {
			const preview = previewSessionTree(root, invocationRoot, slug, keepBranch, false, report, observer);
			const blocked = keepBranch ? !preview.value.executionSupported : [...inspectedSlugs].some((name) => !results.get(name)?.remove);
			if (blocked) for (const proposal of results.values()) {
				if (proposal.remove) { proposal.remove = false; proposal.reason = "Recursive scope blocked"; display?.complete(proposal); }
			}
			process.stdout.write(display?.finish() ?? "");
			return 0;
		} catch (error) {
			display?.abort();
			const failure = new CliError(cleanupDiagnostic(error instanceof Error ? error.message : String(error)), error instanceof CliError ? error.exitCode : 1);
			failure.cause = error; failure.color = options.color; throw failure;
		}
	});
	return withInspection("Inspecting recursive cleanup", false, options, (progress) => {
		const report: ProgressReporter = options.verbose ? progressReporter("finish", false) : () => {};
		if (options.verbose) progress.flush();
		const preview = previewSessionTree(root, invocationRoot, slug, true, false, report);
		if (!preview.token) { progress.flush(); process.stderr.write(preview.summary); throw new CliError("Recursive cleanup blocked; resolve the reported blockers first. No resources changed."); }
		const receipt = decodeTreeReceipt(root, slug, preview.token);
		const branches = inspectTreeBranches(root, receipt.targets);
		const deleteBranches = !keepBranch && branches.some((branch) => !branch.reason);
		const output = new FinishOutput(options);
		const scopes = preview.value.plans.map((plan) => ({ slug: String(plan.slug), worktreePath: String(plan.worktreePath), metadataPath: String(plan.metadataPath),
			currentBranch: plan.currentBranch as string | null, ownedBranches: plan.ownedBranches as string[], keepBranch: true, ignoredData: plan.ignoredData as IgnoredDataInspection }));
		progress.flush();
		output.planTree(slug, scopes, branches.map((branch) => ({ slug: branch.metadata.slug, name: branch.name, preserve: !deleteBranches || Boolean(branch.reason),
			detail: `${branch.name} (${branch.reason ?? (deleteBranches ? `merged into ${branch.baseRef} @ ${options.verbose ? branch.baseRevision : branch.baseRevision.slice(0, 12)}; branch @ ${options.verbose ? branch.revision : branch.revision.slice(0, 12)}` : "branch preservation requested")})` })));
		if (!output.confirm()) throw new CliError("Cleanup cancelled. No resources changed.");
		output.begin();
		try { return applySessionTree(root, invocationRoot, slug, preview.token, false, deleteBranches ? branches.filter((branch) => !branch.reason) : undefined, options, undefined, output); }
		catch (error) { output.abort(); throw error; }
	});
}

function previewSessionTree(root: string, invocationRoot: string, slug: string, keepBranch: boolean, json: boolean, reporter?: ProgressReporter, observer?: TreePreviewObserver) {
	const { target, selected, skipped, sharedBranches, ancestryIssues } = selectSessionTree(root, slug);
	// Keep the structured diagnostics compatible, but don't present unrelated
	// unknown ancestry as though it belonged to the user's selected tree.
	const scopedIssues = ancestryIssues.filter((issue) => issue.slug === slug);
	const scopedSkipped = scopedIssues.map((issue) => `${issue.slug}: ${issue.problem}`);
	observer?.start([...selected.map((record) => record.slug), ...scopedIssues.map((issue) => issue.slug)], scopedIssues);
	const plans: Record<string, unknown>[] = [];
	const report = reporter ?? progressReporter("finish", json);
	for (const record of selected) {
		observer?.checking(record.slug);
		try {
			const plan = previewFinish(root, invocationRoot, record.slug, false, keepBranch, report);
			const branchSets = sessionBranchSets(record);
			const shared = sharedBranches.filter((branch) => branch.claims.some((claim) => claim.slug === record.slug));
			const sharedNames = new Set(shared.map((branch) => branch.name));
			const ownedBranches = branchSets.owned.filter((name) => !sharedNames.has(name));
			const unresolvedBranches = [...new Set([...branchSets.unresolved, ...sharedNames])].sort();
			const { receipt: _receipt, ...inspection } = plan;
			plans.push({ ...inspection, sessionId: record.sessionId, parentSessionId: record.parentSessionId,
				ownedBranches, unresolvedBranches, branchOwnership: record.branches ? "recorded" : "legacy-initial-only",
				sharedBranches: shared });
			observer?.planned(plans[plans.length - 1]);
		} catch (error) {
			observer?.failed(record.slug, error instanceof Error ? error.message : String(error));
			const problem = `${record.slug}: ${error instanceof Error ? error.message : String(error)}; preserved.`;
			skipped.push(problem);
			scopedSkipped.push(problem);
		}
	}
	const resourceText = plans.map((plan) => {
		const branches = (plan.ownedBranches as string[]).join(", ") || "none";
		const unresolvedBranches = plan.unresolvedBranches as string[];
		const shared = plan.sharedBranches as typeof sharedBranches;
		const sharedText = shared.map((branch) => `    shared branch claim (preserve): ${branch.name}; claimants: ${branch.claims.map((claim) => claim.slug).join(", ")}\n`).join("");
		return `  ${plan.slug}: ${plan.worktreePath}\n    recorded owned branches: ${branches}\n${sharedText}${artifactSummary(plan.ignoredData as IgnoredDataInspection | undefined)}${unresolvedBranches.length ? `    unresolved branch ownership (preserve): ${unresolvedBranches.join(", ")}\n` : ""}`;
	}).join("");
	const observedAt = new Date().toISOString();
	const context = keepBranch ? snapshotExactResources(root) : undefined;
	const processes = keepBranch ? captureProcesses() : undefined;
	const candidates = keepBranch ? selected.map((record) => {
		observer?.checking(record.slug);
		const candidate = inspectCandidate(root, invocationRoot, record.slug,
			treeInspectionOptions, Date.parse(observedAt), processes, report, context, false);
		if (record.version !== 3) {
			candidate.reason = "unresolved-ownership";
			candidate.problem = "Legacy ownership needs an explicitly reviewed mapping; preserved.";
			candidate.blockers.push({ reason: candidate.reason, problem: candidate.problem });
			delete candidate.snapshot;
		}
		const shared = sharedBranches.filter((branch) => branch.claims.some((claim) => claim.slug === record.slug));
		if (shared.length) {
			const problem = `Shared branch claims: ${shared.map((branch) => `${branch.name} (${branch.claims.map((claim) => claim.slug).join(", ")})`).join("; ")}; preserved pending review.`;
			candidate.blockers.push({ reason: "shared-branch-claims", problem });
			if (candidate.reason === "eligible") candidate.reason = "shared-branch-claims";
			candidate.problem = [candidate.problem, problem].filter(Boolean).join("; ");
			delete candidate.snapshot;
		}
		observer?.complete(candidate);
		return candidate;
	}) : [];
	const executable = keepBranch && !sharedBranches.length && selected.length > 0 && selected.every((record) => record.version === 3) &&
		plans.length === selected.length && candidates.every((candidate) => candidate.snapshot);
	const token = executable ? encodeTreeReceipt({ version: 1, slug, sessionId: target.sessionId!, rootKey: rootKey(root),
		observedAt, keepBranch: true, targets: candidates.map((candidate, index) => ({ ...candidate.snapshot!,
			sessionId: selected[index]!.sessionId!, parentSessionId: selected[index]!.parentSessionId! })) }) : undefined;
	const resources = candidates.map(({ snapshot, ...candidate }) => ({ ...candidate, ...(snapshot ? { fingerprint: snapshot.fingerprint } : {}) }));
	const summary = `Selected tree for ${slug}: ${plans.map((plan) => plan.slug).join(" -> ") || "no resolved resources"}.\n${resourceText}${resources.filter((resource) => resource.reason !== "eligible").map((resource) => `  ${resource.slug}: ${resource.problem ?? resource.reason}\n`).join("")}${scopedSkipped.length ? `Preserved/unresolved:\n${scopedSkipped.map((problem) => `  - ${problem}`).join("\n")}\n` : ""}`;
	return {
		value: { version: 1, command: "finish", mode: "session-all", dryRun: true,
			slug, sessionId: target.sessionId ?? null, executionSupported: executable, plans, skipped, resources, sharedBranches,
			...(token ? { receipt: token } : {}), keepBranch, remoteAssetsModified: false },
		token, summary,
		text: `Recursive preview only. ${summary}No resources changed.\n`,
	};
}

function inspectScopedFinish(root: string, invocationRoot: string, slug: string, defaults: ReturnType<typeof scopedFinishDefaults>) {
	assertPrimaryCheckout(root);
	ensureClean(root);
	const context = snapshotExactResources(root);
	const candidate = inspectCandidate(root, invocationRoot, slug, treeInspectionOptions,
		Date.now(), undefined, undefined, context, false, "worktree-history");
	const target = candidate.snapshot;
	const metadata = context.recordsBySlug.get(slug);
	const branchClaims = sharedBranchClaims([...context.recordsBySlug.values()]);
	const shared = new Set(branchClaims.filter(({ claims }) => claims.some((claim) => claim.slug === slug)).map(({ name }) => name));
	const branches = target && !defaults.keepBranches ? inspectTreeBranches(root, [target]).map((branch) => {
		const reason = metadata?.version !== 3 ? "legacy ownership is not verified"
			: shared.has(branch.name) ? "shared ownership claim" : branch.reason;
		return { ...branch, reason };
	}) : [];
	const unmerged = branches.filter((branch) => branch.reason?.startsWith("unmerged into "));
	const artifacts = candidate.ignoredData?.approvedArtifacts ?? [];
	const detached = candidate.git?.currentBranch === null;
	// A detached tip can become unreachable even though the checkout is clean.
	const record = metadata ? lstatSync(metadataPath(root, slug), { bigint: true }) : undefined;
	const duplicateIdentity = metadata?.sessionId && [...context.recordsBySlug.values()].some((entry) =>
		entry.slug !== slug && entry.sessionId === metadata.sessionId);
	const recordProblem = record && (!record.isFile() || !process.getuid || record.uid !== BigInt(process.getuid()))
		? "Session record is not a regular file owned by the current user."
		: duplicateIdentity ? "Session identity is claimed by another record." : undefined;
	const ready = Boolean(target && record && !recordProblem && !detached);
	const children = metadata?.sessionId && !duplicateIdentity && !context.problem ? [...context.recordsBySlug.values()]
		.filter((entry) => entry.sessionId && entry.parentSessionId === metadata.sessionId)
		.sort((a, b) => a.slug.localeCompare(b.slug)) : [];
	return { candidate, target, metadata, branches, unmerged, artifacts, ready, recordProblem, children,
		rootIdentity: ready ? JSON.stringify([rootKey(root), record!.dev.toString(), record!.ino.toString()]) : undefined };
}

type ScopedFinishPlan = ReturnType<typeof inspectScopedFinish>;
type ScopedFinishDefaults = ReturnType<typeof scopedFinishDefaults>;

function scopedFinishRows(plan: ScopedFinishPlan, defaults: ScopedFinishDefaults): string[][] {
	const { candidate, metadata, branches, unmerged, artifacts } = plan;
	const operations = candidate.processEvidence?.operations ?? [];
	const blockers = candidate.blockers.filter((blocker) => !["live-operation", "uncertain-operation"].includes(blocker.reason))
		.map((blocker) => blocker.reason === "live-cwd" ? `Processes using worktree: ${candidate.processEvidence?.pids.join(", ")}` : blocker.problem ?? cleanupReason(blocker.reason));
	for (const operation of operations) blockers.push(`${operation.state === "interrupted" ? "Interrupted operation" : `Operation ${operation.state}`}: ${operation.id} (pid ${operation.pid}, ${operation.hostname})`);
	if (candidate.git?.currentBranch === null) blockers.push("Detached HEAD; put the current commit on a branch before finishing.");
	if (plan.recordProblem) blockers.push(plan.recordProblem);
	const branchNames = new Set([...(candidate.git?.ownedBranches ?? []), ...(metadata?.branches?.map(({ name }) => name) ?? []),
		...(candidate.git?.currentBranch ? [candidate.git.currentBranch] : [])]);
	return [
		["Worktree", plan.ready ? "Ready" : "Blocked", [candidate.worktreePath, ...blockers].filter(Boolean).join(" · ")],
		...[...branchNames].map((name) => {
			const branch = branches.find((entry) => entry.name === name);
			return ["Local branch", branch && !branch.reason ? "Ready to delete" : branch && unmerged.includes(branch) ? "Needs approval" : "Preserve",
				[name, branch?.reason ?? (branch ? `merged into ${branch.baseRef}` : defaults.keepBranches ? "personal preference"
					: plan.ready ? "not verified as owned by this session" : "worktree not ready")].filter(Boolean).join(" · ")];
		}),
		...artifacts.map((path) => ["Local artifact", "Needs approval", path]),
		...(metadata ? [["Session record", defaults.archiveRecord ? "Archive" : "Delete", metadata.slug]] : []),
	];
}

function showScopedFinish(plan: ScopedFinishPlan, defaults: ScopedFinishDefaults, options: PresentationOptions, showChildren = false): void {
	const rows = scopedFinishRows(plan, defaults);
	if (showChildren && plan.children.length) rows.push(["Child sessions", `${plan.children.length} unselected`, "Collapsed; review to select"]);
	const colors: Record<string, number> = { Blocked: 31, "Needs approval": 33, Preserve: 2 };
	process.stdout.write(`Finish · ${plan.candidate.slug}\n\n` + formatStateTable(["ASSET", "STATE", "DETAIL"], rows.map((row) => row.map(cleanupDiagnostic)), options,
		(row, column) => column === 1 ? (colors[rows[row]![1]!] ?? 36) : undefined));
}

function acknowledgeScopedInterruption(root: string, plan: ScopedFinishPlan, options: PresentationOptions): boolean {
	const { candidate } = plan;
	const operations = candidate.processEvidence?.operations ?? [];
	if (plan.recordProblem || !operations.length || operations.some((operation) => operation.state !== "interrupted") ||
		candidate.blockers.some((blocker) => ["live-cwd", "unknown-process-evidence", "invoking-worktree", "unresolved-resource"].includes(blocker.reason))) return false;
	const reconciliation = inspectReconciliation(root, candidate.slug);
	if (!reconciliation.executionSupported) return false;
	if (JSON.stringify(reconciliation.metadata) !== JSON.stringify(plan.metadata)) {
		throw new CliError("Session changed during activity review. No local assets removed.");
	}
	confirmReconciliation(root, candidate.slug, reconciliation, options);
	return true;
}

function reviewFinishChildren(root: string, invocationRoot: string, parent: ScopedFinishPlan, defaults: ScopedFinishDefaults, options: PresentationOptions): ScopedFinishPlan[] {
	if (!confirm("Review child sessions? [y/N]")) return [];
	process.stdout.write(formatStateTable(["CHILD SESSION", "SELECTION"], parent.children.map(({ slug }) => [slug, "Unselected"]), options));
	const chosen = parent.children.filter(({ slug }) => confirm(`Select child ${slug}? [y/N]`));
	const selected: ScopedFinishPlan[] = [];
	for (const child of chosen) {
		for (;;) {
			const plan = inspectScopedFinish(root, invocationRoot, child.slug, defaults);
			if (plan.metadata?.sessionId !== child.sessionId || plan.metadata?.parentSessionId !== parent.metadata?.sessionId) {
				throw new CliError(`Child ${child.slug} changed since selection. No local assets removed.`);
			}
			showScopedFinish(plan, defaults, options);
			if (plan.ready) { selected.push(plan); break; }
			if (acknowledgeScopedInterruption(root, plan, options)) continue;
			if (!confirm(`Recheck ${child.slug}? No deselects it. [y/N]`)) break;
		}
	}
	return selected;
}

// All selected scopes must still agree before the first native effect. Recheck
// a target again just before its own effect: Git and unmanaged processes don't
// take our lifecycle lock.
function assertScopedFinishUnchanged(root: string, invocationRoot: string, plan: ScopedFinishPlan, defaults: ScopedFinishDefaults): void {
	const current = inspectScopedFinish(root, invocationRoot, plan.candidate.slug, defaults);
	if (!current.ready || current.target?.fingerprint !== plan.target?.fingerprint || current.rootIdentity !== plan.rootIdentity ||
		JSON.stringify(current.branches) !== JSON.stringify(plan.branches) || JSON.stringify(defaults) !== JSON.stringify(scopedFinishDefaults())) {
		throw new CliError(`Finish readiness or scope changed for ${plan.candidate.slug}; review it again.`);
	}
	for (const branch of plan.branches.filter((branch) => !branch.reason)) {
		assertTreeBranchUnchanged(root, branch, new Set([plan.target!.worktreePath]));
	}
}

function applyScopedFinish(root: string, plan: ScopedFinishPlan, defaults: ScopedFinishDefaults): void {
	const { target, metadata, branches } = plan;
	const slug = plan.candidate.slug;
	assertNoWorktreeActivity(metadata!);
	cleanupGit(root, ["worktree", "remove", target!.worktreePath], `Could not remove the local worktree for ${slug}.`);
	try {
		for (const branch of branches.filter((branch) => !branch.reason)) deleteTreeBranch(root, branch);
		if (defaults.archiveRecord) archiveMetadata(root, metadata!);
		else unlinkSync(metadataPath(root, slug));
	} catch (error) {
		throw new CliError(`Worktree for ${slug} removed, but finish did not complete: ${error instanceof Error ? error.message : String(error)}\nInspect the remaining local assets before retrying.`);
	}
	process.stdout.write(`Finished · ${slug}. ${defaults.archiveRecord ? "Archived session record." : "Deleted session record."} Remote assets unchanged.\n`);
}

export function finishScopedSession(root: string, invocationRoot: string, slug: string, options: PresentationOptions): number {
	const defaults = scopedFinishDefaults();
	const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
	let reviewedInterruption = false;
	for (;;) {
		const plan = inspectScopedFinish(root, invocationRoot, slug, defaults);
		showScopedFinish(plan, defaults, options, interactive);
		if (!plan.ready) {
			if (interactive && acknowledgeScopedInterruption(root, plan, options)) { reviewedInterruption = true; continue; }
			if (interactive && confirm("Recheck readiness? [y/N]")) continue;
			throw new CliError("Finish blocked. No local assets removed.");
		}
		const unreviewed = plan.unmerged.length || plan.artifacts.length;
		if (unreviewed && !interactive) throw new CliError("Confirmation required. Run finish in a terminal to review these assets.");
		const reviewChildren = interactive && plan.children.length > 0;
		const children = reviewChildren ? reviewFinishChildren(root, invocationRoot, plan, defaults, options) : [];
		const selected = [...children, plan];
		if (reviewedInterruption || unreviewed || reviewChildren) {
			const keep = plan.children.filter((child) => !children.some((entry) => entry.metadata?.sessionId === child.sessionId));
			process.stdout.write(`\nFinish: ${selected.map((entry) => entry.candidate.slug).join(", ")}\n`);
			if (keep.length) process.stdout.write(`Keep: ${keep.map((child) => child.slug).join(", ")}\n`);
			if (!confirm("Apply the listed cleanup? [y/N]")) throw new CliError("Finish cancelled. No local assets removed.");
		}
		return withOperationLock(root, "finish", () => {
			try { for (const entry of selected) assertScopedFinishUnchanged(root, invocationRoot, entry, defaults); }
			catch (error) { throw new CliError(`${error instanceof Error ? error.message : String(error)} No local assets removed.`); }
			for (const [index, entry] of selected.entries()) {
				try {
					if (selected.length > 1) assertScopedFinishUnchanged(root, invocationRoot, entry, defaults);
					applyScopedFinish(root, entry, defaults);
				} catch (error) {
					const remaining = selected.slice(index + 1).map((pending) => pending.candidate.slug);
					if (remaining.length) process.stderr.write(`Not attempted: ${remaining.join(", ")}\n`);
					throw error;
				}
			}
			return 0;
		});
	}
}

interface TreeTarget extends Target { sessionId: string; parentSessionId: string | null }
interface TreeReceipt {
	version: 1;
	slug: string;
	sessionId: string;
	rootKey: string;
	observedAt: string;
	keepBranch: true;
	targets: TreeTarget[];
}

const treeInspectionOptions: BatchFinishOptions = {
	inactiveFor: "explicit-tree", inactiveMs: 0, exclusions: [], json: false, dryRun: true, yes: false,
};
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function encodeTreeReceipt(receipt: TreeReceipt): string {
	const body = Buffer.from(JSON.stringify(receipt)).toString("base64url");
	return `tree-v1.${body}.${digest(body)}`;
}

function decodeTreeReceipt(root: string, slug: string, token: string): TreeReceipt {
	try {
		const [prefix, body = "", checksum] = token.split(".");
		if (prefix !== "tree-v1" || body.length > 2_000_000 || digest(body) !== checksum) throw new Error("Invalid receipt encoding.");
		const receipt: TreeReceipt = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
		if (receipt.version !== 1 || receipt.slug !== slug || receipt.keepBranch !== true || receipt.rootKey !== rootKey(root) ||
			!Number.isFinite(Date.parse(receipt.observedAt)) || !Array.isArray(receipt.targets) || !receipt.targets.length || receipt.targets.length > 10000) throw new Error("Preview context changed.");
		const slugs = new Set<string>(), paths = new Set<string>(), ids = new Set<string>();
		for (const target of receipt.targets) {
			validateSlug(target.slug);
			if (typeof target.sessionId !== "string" || (target.parentSessionId !== null && typeof target.parentSessionId !== "string") ||
				slugs.has(target.slug) || paths.has(target.worktreePath) || ids.has(target.sessionId) || typeof target.worktreePath !== "string" ||
				!/^[a-f0-9]{64}$/.test(target.fingerprint) || !/^[a-f0-9]{64}$/.test(target.metadataHash) ||
				!target.branches || typeof target.branches !== "object" || Array.isArray(target.branches) || !Object.keys(target.branches).length ||
				Object.values(target.branches).some((revision) => !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision))) throw new Error("Invalid target identity.");
			slugs.add(target.slug); paths.add(target.worktreePath); ids.add(target.sessionId);
		}
		if (receipt.targets.at(-1)!.slug !== slug || receipt.targets.at(-1)!.sessionId !== receipt.sessionId) throw new Error("Root identity changed.");
		return receipt;
	} catch (error) { throw new CliError(`Invalid or mismatched tree receipt; obtain a fresh preview. ${String(error)}`, 64); }
}

function applySessionTree(root: string, invocationRoot: string, slug: string, token: string, json: boolean, branchesToDelete?: TreeBranch[], options?: PresentationOptions, progress?: InspectionProgress, treeOutput?: FinishOutput): number {
	const receipt = decodeTreeReceipt(root, slug, token);
	const display = options && !json && !treeOutput ? new BatchOutput(receipt.targets, options, "Recursive cleanup") : undefined;
	progress?.flush(); display?.start();
	const report: ProgressReporter = !options || json || options.verbose ? progressReporter("recursive finish", json) : () => {};
	const branchResources: { name: string; outcome: "deleted" | "refused"; problem?: string }[] = [];
	let resources: Outcome[];
	try {
		resources = withOperationLock(root, "recursive finish", () => {
			assertPrimaryCheckout(root); ensureClean(root, true);
			const journal = journalStore(root, receipt, token);
			const scope = () => {
				if (receipt.rootKey !== rootKey(root)) throw new CliError("Tree configuration changed; obtain a fresh preview.");
				const context = snapshotExactResources(root);
				const approvedSlugs = new Set(receipt.targets.map((target) => target.slug));
				const shared = sharedBranchClaims([...context.recordsBySlug.values()]).filter((branch) => branch.claims.some((claim) => approvedSlugs.has(claim.slug)));
				if (shared.length) throw new CliError(`Shared branch claims changed or remain unresolved: ${shared.map((branch) => `${branch.name} (${branch.claims.map((claim) => claim.slug).join(", ")})`).join("; ")}; resources preserved.`);
				const states = receipt.targets.map((target) => {
					const exact = inspectExactResource(root, target.worktreePath, context);
					if (exact.resourceState === "absent" && journal.started(target)) return { target, kind: "absent" as const };
					const record = context.recordsBySlug.get(target.slug);
					if (!record || record.sessionId !== target.sessionId || record.parentSessionId !== target.parentSessionId || record.version !== 3) throw new CliError(`Tree ownership changed: ${target.slug}; approved parent ${target.parentSessionId ?? "root"}, current parent ${record ? record.parentSessionId ?? "root" : "unknown"}. Resource preserved.`);
					if (journal.started(target) && residualRecord(root, target, exact)) {
						for (const [branch, revision] of Object.entries(target.branches)) {
							if (git(root, ["rev-parse", "--verify", `refs/heads/${branch}`]) !== revision) throw new CliError(`Branch evidence changed: ${branch}.`);
						}
						return { target, kind: "residual" as const };
					}
					return { target, kind: "present" as const };
				});
				const remaining = states.filter((state) => state.kind !== "absent").map((state) => state.target.sessionId);
				const allIds = new Set(receipt.targets.map((target) => target.sessionId));
				for (const record of context.recordsBySlug.values()) {
					if (record.parentSessionId && allIds.has(record.parentSessionId) && !allIds.has(record.sessionId!)) throw new CliError("New descendant appeared; obtain a fresh tree preview.");
				}
				const current = remaining.length ? selectSessionTree(root, slug).selected.map((record) => record.sessionId) : [];
				if (JSON.stringify(current) !== JSON.stringify(remaining)) throw new CliError("Tree selection changed; obtain a fresh preview.");
				return { context, states };
			};
			// Refuse the whole operation before the first native effect when any
			// approved target has already changed. Explicit scope needs no age cutoff.
			const initial = scope();
			for (const branch of branchesToDelete ?? []) assertTreeBranchUnchanged(root, branch, new Set(receipt.targets.map((target) => target.worktreePath)));
			for (const state of initial.states) {
				if (state.kind !== "present") continue;
				display?.checking(state.target.slug);
				const candidate = inspectCandidate(root, invocationRoot, state.target.slug, treeInspectionOptions,
					Date.now(), undefined, report, initial.context, false);
				if (candidate.snapshot?.fingerprint !== state.target.fingerprint) throw new CliError(`${state.target.slug}: ${candidate.problem ?? "changed since preview"}`);
			}
			const outcomes: Outcome[] = [];
			let stopped = false;
			for (const target of receipt.targets) {
				const base = { slug: target.slug, worktreePath: target.worktreePath };
				if (stopped) {
					const outcome: Outcome = { ...base, outcome: "refused", reason: "earlier-target-not-finished" };
					outcomes.push(outcome); display?.complete(outcome); treeOutput?.treeResource(outcome); continue;
				}
				display?.checking(target.slug);
				let outcome: Outcome;
				let cleanupStarted = false;
				try {
					const current = scope(), state = current.states.find((entry) => entry.target.slug === target.slug)!;
					if (state.kind === "absent") outcome = { ...base, outcome: "absent", reason: "confirmed-absence" };
					else if (state.kind === "residual") {
						cleanupStarted = true;
						outcome = completeRemoval(root, target, true);
					}
					else {
						const candidate = inspectCandidate(root, invocationRoot, target.slug, treeInspectionOptions,
							Date.now(), undefined, report, current.context, false);
						if (candidate.snapshot?.fingerprint !== target.fingerprint) throw new CliError(candidate.problem ?? "Changed since preview.");
						scope();
						journal.start(target);
						cleanupStarted = true;
						display?.removing(target.slug);
						treeOutput?.starting("worktree", "Removing", target.slug);
						const removed = run("git", ["worktree", "remove", "--", target.worktreePath], root);
						outcome = removed.status === 0 ? completeRemoval(root, target, false)
							: { ...base, outcome: "uncertain", reason: "native-removal-unconfirmed", problem: [removed.stdout, removed.stderr, removed.errorCode].filter(Boolean).join("\n") };
					}
				} catch (error) { outcome = { ...base, outcome: cleanupStarted ? "uncertain" : "refused",
					reason: cleanupStarted ? "cleanup-not-confirmed" : "revalidation-failed", problem: String(error) }; }
				outcomes.push(outcome);
				display?.complete(outcome); treeOutput?.treeResource(outcome);
				stopped = !["finished", "absent"].includes(outcome.outcome);
				report(`apply:${target.slug}`, stopped ? "failed" : "completed", outcome.reason);
			}
			// Delete branches only after the complete tree has been removed safely.
			// A partial worktree cleanup never authorizes branch deletion.
			if (!stopped) {
				for (const branch of branchesToDelete ?? []) {
					if (branchResources.some((result) => result.outcome === "refused")) {
						branchResources.push({ name: branch.name, outcome: "refused", problem: "Earlier branch deletion failed; preserved." });
						continue;
					}
					try {
						if (receipt.rootKey !== rootKey(root)) throw new CliError("Tree configuration changed; branch preserved.");
						treeOutput?.starting(`branch:${branch.name}`, "Deleting", branch.metadata.slug);
						deleteTreeBranch(root, branch);
						branchResources.push({ name: branch.name, outcome: "deleted" });
						treeOutput?.completed(`branch:${branch.name}`, "Deleted", branch.metadata.slug);
					} catch (error) { branchResources.push({ name: branch.name, outcome: "refused", problem: String(error) }); }
				}
			}
			return outcomes;
		});
	} catch (error) {
		resources = receipt.targets.map((target) => ({ slug: target.slug, worktreePath: target.worktreePath,
			outcome: "refused", reason: "tree-preflight", problem: String(error) }));
	}
	const success = resources.every((resource) => ["finished", "absent"].includes(resource.outcome)) && branchResources.every((branch) => branch.outcome === "deleted");
	const partial = !success && resources.some((resource) => ["finished", "absent"].includes(resource.outcome));
	writeCommandResult({ version: 1, command: "finish", mode: "session-all", dryRun: false, keepBranch: branchesToDelete === undefined,
		branchesModified: branchResources.some((branch) => branch.outcome === "deleted"), remoteAssetsModified: false, success, partial, resources, branchResources }, json,
		treeOutput?.finishTree(resources, branchResources) ?? display?.finish(resources) ?? `${resources.map((resource) => `${resource.slug}: ${resource.outcome} (${resource.reason})${resource.problem ? `: ${resource.problem}` : ""}`).join("\n")}\n${branchResources.map((branch) => `${branch.name}: ${branch.outcome}${branch.problem ? `: ${branch.problem}` : ""}\n`).join("")}`);
	return success ? 0 : 1;
}

function confirmBulkFinish(mode: "all" | "gone", count: number, yes: boolean, keepBranch: boolean) {
	if (yes || count === 0) return;
	if (!process.stdin.isTTY) {
		throw new CliError(
			`Confirmation required. Re-run: agent-session finish --${mode} ${keepBranch ? "--keep-branch" : "--delete-branches"} --yes`,
		);
	}
	if (!confirm(`Finish ${count} local session(s)? [y/N]`)) {
		throw new CliError("Finish cancelled.");
	}
}

/** Observe existing cleanup callbacks without selecting scope or approving work. */
function observeBulkCleanup(slug: string, worktreePath: string | undefined, display: BatchOutput | undefined, deleted: () => void, assets?: FinishOutput) {
	let started = false, worktreeRemoved = false;
	const output: CleanupOutput = {
		plan(scope: CleanupScope) { worktreePath = scope.worktreePath; },
		confirm: () => false,
		begin: () => {},
		starting(id, state) { started = true; display?.removing(slug); assets?.starting(id, state, slug); },
		removedWorktree() { worktreeRemoved = true; assets?.removedWorktree(slug); },
		completed(id, state) { if (id.startsWith("branch:") && state === "Deleted") deleted(); assets?.completed(id, state, slug); },
		finish: () => {},
	};
	return { output, result(error?: unknown): CleanupOutcome {
		return { slug, worktreePath, outcome: error ? started ? "uncertain" : "refused" : "finished",
			reason: error ? worktreeRemoved ? "partial-cleanup" : started ? "cleanup-not-confirmed" : "bulk-refused" : "confirmed-removal",
			...(error ? { problem: error instanceof Error ? error.message : String(error) } : {}) };
	} };
}

function bulkScopeSnapshot(root: string, invocationRoot: string, slug: string, force: boolean, keepBranch: boolean, report: ProgressReporter) {
	const plan = previewFinish(root, invocationRoot, slug, force, keepBranch, report, null);
	const metadata = readMetadata(root, slug);
	const names = [...new Set([...(plan.ownedBranches as string[]), ...(plan.currentBranch ? [String(plan.currentBranch)] : [])])].sort();
	const refs = names.map((name) => [name, git(root, ["rev-parse", "--verify", `refs/heads/${name}`])]);
	const head = existsSync(metadata.worktreePath) ? git(metadata.worktreePath, ["rev-parse", "HEAD"]) : null;
	const physical = existsSync(metadata.worktreePath) ? lstatSync(metadata.worktreePath, { bigint: true }) : undefined;
	const fingerprint = createHash("sha256").update(JSON.stringify([rootKey(root), metadata, plan, refs, head,
		physical ? [physical.dev.toString(), physical.ino.toString(), physical.mode.toString()] : null])).digest("hex");
	const scope: CleanupScope = { slug, worktreePath: String(plan.worktreePath), metadataPath: String(plan.metadataPath),
		currentBranch: plan.currentBranch as string | null, ownedBranches: plan.ownedBranches as string[], keepBranch, force,
		ignoredData: plan.ignoredData as IgnoredDataInspection | undefined };
	return { fingerprint, scope };
}

function reviewBulkScope(root: string, invocationRoot: string, slug: string, force: boolean, keepBranch: boolean, report: ProgressReporter): { slug: string; scope?: CleanupScope; fingerprint?: string; problem?: string } {
	let scope: CleanupScope | undefined;
	try {
		const observer: CleanupOutput = { plan(reviewed) { scope = reviewed; }, confirm: () => false, begin() {}, starting() {}, removedWorktree() {}, completed() {}, finish() {} };
		// Run the existing guards, then stop before consent/native effects. Keep
		// yes=true: bulk review must not become artifact-disposal authority.
		if (force) forceFinishUnlocked(root, invocationRoot, slug, true, keepBranch, observer, false, true);
		else finishUnlocked(root, invocationRoot, slug, true, keepBranch, undefined, report, observer, false, true);
		return { slug, ...bulkScopeSnapshot(root, invocationRoot, slug, force, keepBranch, report) };
	} catch (error) {
		if (!scope) { try { scope = bulkScopeSnapshot(root, invocationRoot, slug, force, keepBranch, report).scope; } catch { /* No approved physical scope: keep a blocked binding row. */ } }
		return { slug, scope, problem: error instanceof Error ? error.message : String(error) };
	}
}

function bulkPreviewProposal(slug: string, plan: Record<string, unknown>): CleanupProposal {
	const ignored = plan.ignoredData as IgnoredDataInspection | undefined;
	const force = plan.force === true;
	const ready = ["ready", "stale"].includes(String(plan.state));
	const forceBinding = force && (!existsSync(String(plan.worktreePath)) || !["broken", "orphaned", "unrecorded", "conflict"].includes(String(plan.state)));
	const remove = forceBinding || !force && ready && plan.clean === true && ignored?.safe !== false && !ignored?.approvedArtifacts.length;
	const reason = force ? forceBinding ? "Force proposal; apply rechecks" : "Binding needs inspection" : plan.clean === false ? "Uncommitted changes" : !ready ? "Binding needs inspection"
		: plan.clean !== true ? "Cleanliness unknown" : ignored?.safe === false ? "Ignored data needs review" : ignored?.approvedArtifacts.length ? "Artifact approval required"
		: plan.keepBranch === true ? "Clean; branches preserved" : "Clean; apply checks branch safety";
	return { slug, remove, reason, details: [String(plan.worktreePath), `State: ${String(plan.state)}`,
		`Recorded owned branches: ${(plan.ownedBranches as string[]).join(", ") || "none"}`,
		...(ignored && !ignored.safe ? [ignoredDataProblem(ignored)] : []),
		...(ignored?.approvedArtifacts.map((path) => `Artifact scope: ${path}; bulk disposal requires a separate supported approval`) ?? [])] };
}

function inspectBulkPreview(root: string, invocationRoot: string, mode: "all" | "gone", force: boolean, keepBranch: boolean, report: ProgressReporter,
	observer?: { start(slugs: string[]): void; checking(slug: string): void; complete(result: CleanupProposal): void }) {
	const plans: Record<string, unknown>[] = [], skipped: string[] = [];
	runPhase(report, "inspect-bulk-finish", () => {
		const slugs = metadataSlugs(root); observer?.start(slugs);
		for (const slug of slugs) {
			observer?.checking(slug);
			try {
				const metadata = readMetadata(root, slug);
				if (mode === "gone" && !branchUpstreamIsGone(root, metadata.branch)) {
					observer?.complete({ slug, remove: false, reason: "Upstream not gone", details: [metadata.worktreePath, "Based on local refs; no fetch performed"] });
					continue;
				}
				const plan = previewFinish(root, invocationRoot, slug, force, keepBranch, report, null);
				plans.push(plan); observer?.complete(bulkPreviewProposal(slug, plan));
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				const problem = `${slug}: ${detail}`; skipped.push(problem);
				report(`inspect-finish:${slug}`, "skipped", problem);
				observer?.complete({ slug, remove: false, reason: detail.includes("current shell") ? "Current worktree" : detail.startsWith("Non-forced cleanup blocked.") ? "Activity blocks cleanup" : "Inspection incomplete", details: [detail] });
			}
		}
	});
	return { plans, skipped };
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
	options: PresentationOptions = {},
): void {
	const stateFirst = !dryRun;
	const report: ProgressReporter = !stateFirst || options.verbose ? progressReporter("finish", json) : () => {};
	if (dryRun) {
		const inspect = (progress?: InspectionProgress) => {
			if (options.verbose) progress?.flush();
			let display: CleanupPreview | undefined;
			const observer = json ? undefined : {
				start(slugs: string[]) {
					progress?.flush();
					display = new CleanupPreview(slugs, options, mode === "gone" ? "gone-upstream cleanup" : "repository-wide cleanup", [
						keepBranch ? "Branches preserved" : "Branch deletion requested; apply rechecks eligibility",
						...(mode === "gone" ? ["Based on local refs; no fetch performed"] : []),
						...(force ? ["Force proposal discards uncommitted and ignored data; deleting branches may discard unpublished work"] : []),
					]); display.start();
				},
				checking(slug: string) { display?.checking(slug); },
				complete(result: CleanupProposal) { display?.complete(result); },
			};
			try {
				const previewReport: ProgressReporter = json ? report : options.verbose
					? (phase, status, detail) => report(phase, status, detail === undefined ? undefined : cleanupDiagnostic(detail)) : () => {};
				const { plans, skipped } = inspectBulkPreview(root, invocationRoot, mode, force, keepBranch, previewReport, observer);
				writeCommandResult({ version: 1, command: "finish", dryRun: true, mode, plans, skipped, basedOnLocalRefs: mode === "gone" }, json, display?.finish() ?? "");
			} catch (error) {
				display?.abort();
				if (json) throw error;
				const failure = new CliError(cleanupDiagnostic(error instanceof Error ? error.message : String(error)), error instanceof CliError ? error.exitCode : 1);
				failure.cause = error; failure.color = options.color;
				throw failure;
			}
		};
		if (json) inspect(); else withInspection("Inspecting cleanup preview", false, options, inspect);
		return;
	}
	const apply = (progress?: InspectionProgress) => runPhase(report, "bulk-cleanup", () =>
		withOperationLock(root, "finish", () => {
			assertPrimaryCheckout(root);
			const slugs = metadataSlugs(root);
			let candidates = slugs;
			const preflightSkipped: string[] = [];
			const outcomes: CleanupOutcome[] = [];
			if (mode === "gone") {
				const records: SessionMetadata[] = [];
				for (const slug of slugs) {
					try {
						records.push(readMetadata(root, slug));
					} catch (error) {
						if (stateFirst) outcomes.push({ slug, outcome: "refused", reason: "unresolved-evidence", problem: error instanceof Error ? error.message : String(error) });
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
						stateFirst && !options.verbose ? "pipe" : "inherit",
					);
					if (fetched.status !== 0) {
						throw new CliError([`Could not fetch ${remote}.`, ...(stateFirst && !options.verbose ? [fetched.stdout, fetched.stderr, fetched.errorCode] : [])].filter(Boolean).join("\n"));
					}
				}
				candidates = records
					.filter((record) => branchUpstreamIsGone(root, record.branch))
					.map((record) => record.slug);
			}
			if (!yes && !process.stdin.isTTY) confirmBulkFinish(mode, candidates.length, yes, keepBranch);
			if (!yes && !candidates.length && !outcomes.length) {
				progress?.flush();
				process.stdout.write(new BatchOutput([], options, "Bulk cleanup", { emptyLabel: "No selected resources" }).finish([]));
				return;
			}
			const reviews = !yes ? candidates.map((slug) => reviewBulkScope(root, invocationRoot, slug, force, keepBranch, report)) : [];
			const assets = !yes ? new FinishOutput(options) : undefined;
			if (assets) {
				progress?.flush();
				assets.planBulk(mode === "gone" ? "gone-upstream bulk" : "bulk", [...reviews, ...outcomes.filter((outcome) => !candidates.includes(outcome.slug)).map((outcome) => ({ slug: outcome.slug, problem: outcome.problem }))], force);
				if (candidates.length && !assets.confirm(force)) throw new CliError("Finish cancelled.");
				assets.begin();
				for (const outcome of outcomes) assets.bulkResource(outcome);
			}
			const entries = stateFirst ? slugs.filter((slug) => candidates.includes(slug) || outcomes.some((outcome) => outcome.slug === slug)).map((slug) => {
				try { return { slug, worktreePath: readMetadata(root, slug).worktreePath }; } catch { return { slug }; }
			}) : [];
			let deletedBranches = 0;
			const display = yes ? new BatchOutput(entries, options, `Bulk ${mode === "gone" ? "gone-upstream " : ""}cleanup`, {
				disposition: () => keepBranch ? "branches preserved" : `${deletedBranches} branch deletion${deletedBranches === 1 ? "" : "s"} confirmed`, emptyLabel: "No selected resources",
			}) : undefined;
			progress?.flush(); display?.start();
			for (const outcome of outcomes) display?.complete(outcome);
			let finished = 0;
			const skipped = [...preflightSkipped];
			for (const slug of candidates) {
				display?.checking(slug);
				const observer = observeBulkCleanup(slug, entries.find((entry) => entry.slug === slug)?.worktreePath, display, () => deletedBranches++, assets);
				try {
					if (assets) {
						const reviewed = reviews.find((review) => review.slug === slug)!;
						if (reviewed.problem) throw new CliError(reviewed.problem);
						if (bulkScopeSnapshot(root, invocationRoot, slug, force, keepBranch, report).fingerprint !== reviewed.fingerprint) throw new CliError("Bulk target changed; review a fresh plan. No resources changed for this target.");
					}
					if (force) {
						forceFinishUnlocked(root, invocationRoot, slug, true, keepBranch, observer?.output, options.verbose);
					} else {
						finishUnlocked(root, invocationRoot, slug, true, keepBranch, undefined, report, observer?.output, options.verbose);
					}
					finished += 1;
					if (observer) { const outcome = observer.result(); outcomes.push(outcome); display?.complete(outcome); assets?.bulkResource(outcome); }
				} catch (error) {
					if (observer) { const outcome = observer.result(error); outcomes.push(outcome); display?.complete(outcome); assets?.bulkResource(outcome); }
					skipped.push(
						`${slug}: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
			if (assets) { process.stdout.write(assets.finishBulk(outcomes)); return; }
			if (display) { process.stdout.write(display.finish(outcomes)); return; }
			for (const problem of skipped) {
				process.stderr.write(`[agent-session] SKIPPED ${problem}\n`);
			}
			process.stdout.write(
				`Finished ${finished} session(s); skipped ${skipped.length}.\n`,
			);
		}),
	);
	if (stateFirst) withInspection("Inspecting bulk cleanup", false, options, (progress) => { if (options.verbose) progress.flush(); apply(progress); });
	else apply();
}
