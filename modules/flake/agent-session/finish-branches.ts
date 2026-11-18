import { createHash } from "node:crypto";
import { assertPrimaryCheckout, ensureClean, git, branchCheckedOutElsewhere, deleteBranchRef, type BranchRef } from "./git.ts";
import { inspectCandidate, completeRemoval, rootKey, type Outcome } from "./batch.ts";
import { readMetadata, readMetadataInventory, withOperationLock, metadataPath } from "./sessions.ts";
import { sessionBaseBranch } from "./inspection.ts";
import { artifactSummary } from "./artifacts.ts";
import { CliError, progressReporter, run, writeCommandResult, withInspection, type InspectionProgress } from "./runtime.ts";
import { FinishOutput } from "./finish-output.ts";
import type { PresentationOptions, ProgressReporter } from "./types.ts";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const limitation = "Retained checkout history does not establish ownership and may be incomplete after reflog expiry. Review the listed current local refs; no descendants or remote refs are selected.";

function inspectHistory(root: string, invocationRoot: string, slug: string, json: boolean, reporter?: ProgressReporter) {
	assertPrimaryCheckout(root);
	const metadata = readMetadata(root, slug);
	const report = reporter ?? progressReporter("finish --branches", json);
	let candidate: ReturnType<typeof inspectCandidate>;
	try {
		candidate = inspectCandidate(root, invocationRoot, slug,
			{ inactiveFor: "explicit-worktree", inactiveMs: 0, exclusions: [], json, dryRun: true, yes: false },
			Date.now(), undefined, report, undefined, false, "worktree-history");
	} finally {
		report.flush?.();
	}
	const evidence = new Map<string, string[]>();
	const note = (name: string, source: string) => {
		if (name) evidence.set(name, [...new Set([...(evidence.get(name) ?? []), source])]);
	};
	// No history traversal until the ordinary inspector has proved the native
	// worktree identity. A dirty but physically verified checkout can be previewed.
	const history = candidate.git ? git(metadata.worktreePath, ["reflog", "show", "--format=%H%x00%gs", "HEAD"]) : "";
	if (candidate.git) {
		note(metadata.branch, "saved initial branch");
		for (const branch of metadata.branches ?? []) note(branch.name, "recorded branch creation");
		note(candidate.git.currentBranch ?? "", "current branch");
		for (const line of history.split("\n")) {
			const match = line.slice(line.indexOf("\0") + 1).match(/^checkout: moving from (\S+) to (\S+)$/);
			if (match) { note(match[1]!, "retained checkout history"); note(match[2]!, "retained checkout history"); }
		}
	}
	const baseRef = `refs/heads/${sessionBaseBranch(metadata)}`;
	const base = run("git", ["rev-parse", "--verify", baseRef], root);
	const protectedNames = [git(root, ["branch", "--show-current"]), metadata.defaultBranch, sessionBaseBranch(metadata)];
	const others = readMetadataInventory(root).filter((record) => record.slug !== slug);
	const branches = [...evidence].sort(([a], [b]) => a.localeCompare(b)).map(([name, sources]) => {
		const tip = run("git", ["rev-parse", "--verify", `refs/heads/${name}`], root);
		let reason: string | undefined;
		if (tip.status !== 0) reason = "local branch absent or unreadable";
		else if (protectedNames.includes(name)) reason = "protected primary/default/base branch";
		else if (others.some((record) => record.branch === name || record.branches?.some((branch) => branch.name === name))) reason = "referenced by another session; shared branch preserved";
		else if (branchCheckedOutElsewhere(root, name, new Set([metadata.worktreePath]))) reason = "checked out in another worktree";
		else if (base.status !== 0) reason = `local merge base unavailable: ${baseRef}`;
		else if (run("git", ["merge-base", "--is-ancestor", tip.stdout, base.stdout], root).status !== 0) reason = `unmerged into ${baseRef}`;
		return { name, revision: tip.status === 0 ? tip.stdout : "", baseRef, baseRevision: base.status === 0 ? base.stdout : "", sources, ...(reason ? { reason } : {}) };
	});
	const rootIdentity = rootKey(root);
	return { metadata, candidate, branches, rootIdentity,
		fingerprint: hash([rootIdentity, candidate.snapshot, history, branches]),
	};
}

function describe(plan: ReturnType<typeof inspectHistory>, deleteEligible?: boolean): string {
	return `Worktree: ${plan.metadata.worktreePath}\n${limitation}\n${artifactSummary(plan.candidate.ignoredData)}${plan.branches.map((branch) => {
		const action = branch.reason ? "preserve" : deleteEligible === undefined ? "branch" : deleteEligible ? "delete" : "preserve";
		const reason = branch.reason ?? (deleteEligible === undefined ? "eligible for explicit deletion approval"
			: deleteEligible ? `merged into ${branch.baseRef} @ ${branch.baseRevision.slice(0, 12)}` : "deletion not requested");
		return `  ${action}: ${branch.name}${branch.revision ? ` @ ${branch.revision.slice(0, 12)}` : ""} (${reason}; ${branch.sources.join(", ")})\n`;
	}).join("")}${plan.candidate.snapshot ? "" : `Cleanup blocked: ${plan.candidate.problem ?? plan.candidate.reason}\n`}`;
}

function assertNoOtherClaim(root: string, branch: BranchRef): void {
	// The approved record is already gone here. Even a replacement under the
	// same slug supplies new evidence, never permission to delete its branch.
	if (readMetadataInventory(root).some((record) =>
		record.branch === branch.name || record.branches?.some((entry) => entry.name === branch.name))) throw new CliError(`Another session now references ${branch.name}; branch preserved.`);
}

export function finishWorktreeBranches(root: string, invocationRoot: string, slug: string, keepBranch: boolean, dryRun: boolean, json: boolean, options: PresentationOptions = {}): number {
	if (!dryRun && !process.stdin.isTTY) throw new CliError("finish --branches requires a terminal for explicit approval; use --dry-run to inspect without removal.");
	if (!dryRun) return withInspection("Inspecting reviewed branch cleanup", false, options,
		(progress) => applyHistory(root, invocationRoot, slug, keepBranch, options, progress));
	const plan = inspectHistory(root, invocationRoot, slug, json);
	if (dryRun) {
		writeCommandResult({ version: 1, command: "finish", mode: "worktree-branches", dryRun: true, slug,
			worktreePath: plan.metadata.worktreePath, branches: plan.branches, historyComplete: false, limitation,
			executionSupported: Boolean(plan.candidate.snapshot), inspection: plan.candidate, remoteAssetsModified: false }, json,
			`${describe(plan, !keepBranch)}No resources changed.\n`);
		return 0;
	}
	return 0;
}

function applyHistory(root: string, invocationRoot: string, slug: string, keepBranch: boolean, options: PresentationOptions, progress: InspectionProgress): number {
	if (options.verbose) progress.flush();
	const report: ProgressReporter = options.verbose ? progressReporter("finish --branches", false) : () => {};
	const plan = inspectHistory(root, invocationRoot, slug, false, report);
	const approvedTarget = plan.candidate.snapshot;
	if (!approvedTarget) { progress.flush(); process.stderr.write(describe(plan)); throw new CliError("Cleanup blocked. No resources changed."); }
	const deleteEligible = !keepBranch && plan.branches.some((branch) => !branch.reason);
	const output = new FinishOutput(options);
	progress.flush();
	output.planHistory({ slug, worktreePath: plan.metadata.worktreePath, metadataPath: metadataPath(root, slug), ignoredData: plan.candidate.ignoredData },
		plan.branches.map((branch) => ({ name: branch.name, preserve: !deleteEligible || Boolean(branch.reason),
			detail: `${branch.name}${branch.revision ? ` @ ${options.verbose ? branch.revision : branch.revision.slice(0, 12)}` : ""} (${branch.reason ?? (deleteEligible ? `merged into ${branch.baseRef} @ ${options.verbose ? branch.baseRevision : branch.baseRevision.slice(0, 12)}` : "deletion not requested")}; ${branch.sources.join(", ")})` })), limitation);
	if (!output.confirm()) throw new CliError("Cleanup cancelled. No resources changed.");
	let outcome: Outcome | undefined;
	const branches: { name: string; outcome: "deleted" | "refused"; problem?: string }[] = [];
	output.begin();
	try {
		withOperationLock(root, "finish --branches", () => {
			ensureClean(root, true);
			const current = inspectHistory(root, invocationRoot, slug, false, report);
			if (!current.candidate.snapshot || current.fingerprint !== plan.fingerprint) throw new CliError("Worktree, branch history or branch scope changed; review a fresh plan. No resources changed.");
			output.starting("worktree", "Removing", slug);
			const removed = run("git", ["worktree", "remove", "--", plan.metadata.worktreePath], root);
			if (removed.status !== 0) {
				outcome = { slug, worktreePath: plan.metadata.worktreePath, outcome: "uncertain", reason: "native-removal-unconfirmed" };
				throw new CliError(`Native worktree removal failed; all branches preserved. ${[removed.stdout, removed.stderr, removed.errorCode].filter(Boolean).join("\n")}`);
			}
			outcome = completeRemoval(root, approvedTarget, false);
			output.treeResource(outcome);
			if (outcome.outcome !== "finished") throw new CliError(`Worktree removal could not be fully confirmed; all branches preserved. ${outcome.problem ?? outcome.reason}`);
			if (deleteEligible) {
				for (const branch of plan.branches.filter((branch) => !branch.reason)) {
					try {
						if (rootKey(root) !== plan.rootIdentity) throw new CliError("Configuration changed; branch preserved.");
						assertNoOtherClaim(root, branch);
						output.starting(`branch:${branch.name}`, "Deleting", slug);
						deleteBranchRef(root, branch);
						branches.push({ name: branch.name, outcome: "deleted" });
						output.completed(`branch:${branch.name}`, "Deleted", slug);
					} catch (error) {
						const failure = new CliError(`Partial cleanup: worktree removed, ${branch.name} not confirmed deleted; later branches preserved. ${String(error)}`);
						branches.push({ name: branch.name, outcome: "refused", problem: failure.message });
						throw failure;
					}
				}
			}
		});
	} catch (error) {
		if (!outcome) outcome = { slug, worktreePath: plan.metadata.worktreePath, outcome: "refused", reason: "revalidation-failed", problem: error instanceof Error ? error.message : String(error) };
		else if (outcome.outcome !== "finished") outcome.problem = error instanceof Error ? error.message : String(error);
		process.stdout.write(output.finishTree([outcome], branches));
		return error instanceof CliError ? error.exitCode : 1;
	}
	process.stdout.write(output.finishTree([outcome!], branches));
	return 0;
}
