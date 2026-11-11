import { createHash } from "node:crypto";
import { inspectTreeBranches, treeBranchSummary, assertTreeBranchUnchanged, deleteTreeBranch, type TreeBranch } from "./tree-branches.ts";
import { captureProcesses, inspectCandidate, rootKey, journalStore, residualRecord, completeRemoval, type Target, type Outcome } from "./batch.ts";
import { existsSync, unlinkSync } from "node:fs";
import { sessionCommand } from "./arguments.ts";
import { inspectIgnoredData, ignoredDataProblem, type IgnoredDataInspection } from "./artifacts.ts";
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
	progressReporter,
	runPhase,
	writeCommandResult,
	run,
} from "./runtime.ts";
import type { SessionMetadata, SessionStatus, ProgressReporter, BatchFinishOptions } from "./types.ts";

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
	let ownedBranches = sessionBranchSets(metadata, root).owned;
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

function artifactSummary(evidence: IgnoredDataInspection | undefined): string {
	if (!evidence?.approvedArtifacts.length) return "";
	const artifacts = evidence.approvedArtifacts.map((path) => ({ path, tree: evidence.policyRoots.find((root) => root.path === path)?.tree ?? evidence.ignoredPaths.find((entry) => entry.path === path) }));
	const entries = artifacts.map(({ path, tree }) => {
		return `  artifact: ${path} (${tree?.type ?? "entry"}${tree?.type === "directory" ? `, entire subtree, ${tree.size.entries} entries` : tree?.type === "symlink" ? ", link only; target preserved" : ""})`;
	});
	return `${entries.join("\n")}\n${artifacts.some(({ tree }) => tree?.type === "directory") ? "  Directory scopes include all descendants, including logs and task databases.\n" : ""}`;
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
	const ignoredData = inspectIgnoredData(root, metadata.worktreePath, config.local_links, config.disposable_paths, metadataProgress, config.generated_links);
	if (!ignoredData.safe) throw new CliError(`Non-forced cleanup refused: ${ignoredDataProblem(ignoredData)}`);
	const interactive = !yes && Boolean(process.stdin.isTTY);
	if (ignoredData.approvedArtifacts.length && !expected && !interactive) throw new CliError("Artifact disposal requires terminal confirmation or a matching preview receipt: use finish --keep-branch --dry-run, then --expected <receipt>.");
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
	process.stderr.write(
		`Ready to remove local session assets:\n  worktree: ${metadata.worktreePath}\n${branchList}\n${artifactSummary(ignoredData)}`,
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
	const currentIgnoredData = inspectIgnoredData(root, metadata.worktreePath, currentConfig.local_links, currentConfig.disposable_paths, metadataProgress, currentConfig.generated_links);
	if (!currentIgnoredData.safe) throw new CliError(`Non-forced cleanup refused: ${ignoredDataProblem(currentIgnoredData)}`);
	if (JSON.stringify(currentIgnoredData) !== JSON.stringify(ignoredData) ||
		(expected && previewFinish(root, invocationRoot, slug, false, keepBranch, () => {}, null, currentIgnoredData).receipt !== expected)) {
		throw new CliError("Finish target changed; obtain a fresh preview before cleanup.");
	}
	if (approval) {
		const currentMetadata = readMetadata(root, slug);
		assertConfiguredWorktreePath(root, currentConfig, currentMetadata);
		const currentStatus = inspectSession(currentMetadata, defaultBranch);
		if (finishApprovalFingerprint(root, currentMetadata, currentStatus, currentIgnoredData) !== approval) throw new CliError("Finish target changed; inspect it again before cleanup.");
	}
	report.flush?.();
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

function finishPreviewText(plan: Record<string, unknown>, slug: string, keepBranch: boolean): string {
	if (plan.allBranchesPreserved === true) return `Would remove unrecorded local worktree ${String(plan.worktreePath)} and preserve all branches. Force discards uncommitted and ignored local files.${plan.detachedHeadMayBecomeUnreachable ? " Detached HEAD commits may become unreachable; create a branch first if needed." : ""}\n`;
	const ignoredData = plan.ignoredData as IgnoredDataInspection | undefined;
	if (ignoredData?.safe === false) return `Non-forced cleanup blocked: ${ignoredDataProblem(ignoredData)}\nNo resources changed.\n`;
	if (!plan.force && (plan.clean !== true || !["ready", "stale"].includes(String(plan.state)))) return `Non-forced cleanup blocked: state=${String(plan.state)}, clean=${String(plan.clean)}.\nNo resources changed.\n`;
	const branches = (plan.ownedBranches as string[]).join(", ") || "none";
	const summary = `Would remove local worktree ${String(plan.worktreePath)} and ${keepBranch ? "preserve" : "delete"} session-owned branches: ${branches}.\n${artifactSummary(ignoredData)}`;
	if (plan.force) return summary;
	const command = sessionCommand(slug, "finish").replace(/^agent-session /, "as ");
	return typeof plan.receipt === "string"
		? `${summary}Receipt: ${plan.receipt}\nApply: ${command} --keep-branch --expected ${plan.receipt} --yes\n`
		: `${summary}Confirm interactively: ${command}${keepBranch ? " --keep-branch" : ""}\n`;
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
		writeCommandResult(
			{ version: 1, command: "finish", dryRun: true, plan }, json,
			finishPreviewText(plan, slug, keepBranch),
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

function selectSessionTree(root: string, slug: string) {
	validateSlug(slug);
	const records = readMetadataInventory(root);
	const target = records.find((record) => record.slug === slug);
	if (!target) throw new CliError(`No managed session: ${slug}`);
	const byId = new Map<string, SessionMetadata>();
	const skipped: string[] = [];
	for (const record of records) {
		if (!record.sessionId) {
			skipped.push(`${record.slug}: unknown ancestry; explicit reviewed ownership mapping required; preserved.`);
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
	return { target, selected, records, skipped, sharedBranches };
}

export function finishSessionTree(root: string, invocationRoot: string, slug: string, keepBranch: boolean, dryRun: boolean, json: boolean, expected?: string): number {
	if (expected && !dryRun) return applySessionTree(root, invocationRoot, slug, expected, json);
	if (!dryRun && !process.stdin.isTTY) throw new CliError("Recursive finish requires a terminal, or --keep-branch --expected <tree-receipt> --yes after a dry-run preview.");
	const preview = previewSessionTree(root, invocationRoot, slug, dryRun ? keepBranch : true, json);
	if (dryRun) {
		writeCommandResult(preview.value, json, preview.text);
		return 0;
	}
	process.stderr.write(preview.summary);
	if (!preview.token) throw new CliError("Recursive cleanup blocked; resolve the reported blockers first. No resources changed.");
	const receipt = decodeTreeReceipt(root, slug, preview.token);
	const branches = inspectTreeBranches(root, receipt.targets);
	process.stderr.write(treeBranchSummary(branches, false));
	const deleteBranches = !keepBranch && branches.some((branch) => !branch.reason) && confirm("Also delete eligible local branches? [y/N]");
	process.stderr.write(`Final removal plan (descendants first):\n${preview.summary}${treeBranchSummary(branches, deleteBranches)}Remote assets will not be modified.\n`);
	if (!confirm("Remove these local session assets? [y/N]")) throw new CliError("Cleanup cancelled. No resources changed.");
	return applySessionTree(root, invocationRoot, slug, preview.token, false, deleteBranches ? branches.filter((branch) => !branch.reason) : undefined);
}

function previewSessionTree(root: string, invocationRoot: string, slug: string, keepBranch: boolean, json: boolean) {
	const { target, selected, skipped, sharedBranches } = selectSessionTree(root, slug);
	const plans: Record<string, unknown>[] = [];
	const report = progressReporter("finish", json);
	for (const record of selected) {
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
		} catch (error) {
			skipped.push(`${record.slug}: ${error instanceof Error ? error.message : String(error)}; preserved.`);
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
		return candidate;
	}) : [];
	const executable = keepBranch && !sharedBranches.length && selected.length > 0 && selected.every((record) => record.version === 3) &&
		plans.length === selected.length && candidates.every((candidate) => candidate.snapshot);
	const token = executable ? encodeTreeReceipt({ version: 1, slug, sessionId: target.sessionId!, rootKey: rootKey(root),
		observedAt, keepBranch: true, targets: candidates.map((candidate, index) => ({ ...candidate.snapshot!,
			sessionId: selected[index]!.sessionId!, parentSessionId: selected[index]!.parentSessionId! })) }) : undefined;
	const resources = candidates.map(({ snapshot, ...candidate }) => ({ ...candidate, ...(snapshot ? { fingerprint: snapshot.fingerprint } : {}) }));
	const summary = `Selected tree for ${slug}: ${plans.map((plan) => plan.slug).join(" -> ") || "no resolved resources"}.\n${resourceText}${resources.filter((resource) => resource.reason !== "eligible").map((resource) => `  ${resource.slug}: ${resource.problem ?? resource.reason}\n`).join("")}${skipped.length ? `Preserved/unresolved:\n${skipped.map((problem) => `  - ${problem}`).join("\n")}\n` : ""}`;
	return {
		value: { version: 1, command: "finish", mode: "session-all", dryRun: true,
			slug, sessionId: target.sessionId ?? null, executionSupported: executable, plans, skipped, resources, sharedBranches,
			...(token ? { receipt: token } : {}), keepBranch, remoteAssetsModified: false },
		token, summary,
		text: `Recursive preview only. ${summary}No resources changed.${token ? `\nReceipt: ${token}\nApply: ${sessionCommand(slug, "finish")} --all --keep-branch --expected ${token} --yes` : "\nNo execution receipt: use --keep-branch with a fully resolved, safe tree."}\n`,
	};
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

function applySessionTree(root: string, invocationRoot: string, slug: string, token: string, json: boolean, branchesToDelete?: TreeBranch[]): number {
	const receipt = decodeTreeReceipt(root, slug, token);
	const report = progressReporter("recursive finish", json);
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
				const candidate = inspectCandidate(root, invocationRoot, state.target.slug, treeInspectionOptions,
					Date.now(), undefined, report, initial.context, false);
				if (candidate.snapshot?.fingerprint !== state.target.fingerprint) throw new CliError(`${state.target.slug}: ${candidate.problem ?? "changed since preview"}`);
			}
			const outcomes: Outcome[] = [];
			let stopped = false;
			for (const target of receipt.targets) {
				const base = { slug: target.slug, worktreePath: target.worktreePath };
				if (stopped) { outcomes.push({ ...base, outcome: "refused", reason: "earlier-target-not-finished" }); continue; }
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
						const removed = run("git", ["worktree", "remove", "--", target.worktreePath], root);
						outcome = removed.status === 0 ? completeRemoval(root, target, false)
							: { ...base, outcome: "uncertain", reason: "native-removal-unconfirmed", problem: removed.stderr };
					}
				} catch (error) { outcome = { ...base, outcome: cleanupStarted ? "uncertain" : "refused",
					reason: cleanupStarted ? "cleanup-not-confirmed" : "revalidation-failed", problem: String(error) }; }
				outcomes.push(outcome);
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
						deleteTreeBranch(root, branch);
						branchResources.push({ name: branch.name, outcome: "deleted" });
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
		`${resources.map((resource) => `${resource.slug}: ${resource.outcome} (${resource.reason})${resource.problem ? `: ${resource.problem}` : ""}`).join("\n")}\n${branchResources.map((branch) => `${branch.name}: ${branch.outcome}${branch.problem ? `: ${branch.problem}` : ""}\n`).join("")}`);
	return success ? 0 : 1;
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
