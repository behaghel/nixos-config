import { spawnSync } from "node:child_process";
import { git } from "./git.ts";
import { readMetadata, readMetadataInventory } from "./sessions.ts";
import { sessionBaseBranch, sessionBranchSets } from "./inspection.ts";
import { CliError, run } from "./runtime.ts";
import type { Target } from "./batch.ts";
import type { SessionMetadata } from "./types.ts";

export interface TreeBranch {
	name: string;
	revision: string;
	baseRef: string;
	baseRevision: string;
	metadata: SessionMetadata;
	reason?: string;
}

function branchCheckedOutElsewhere(root: string, name: string, allowedWorktrees: Set<string>): boolean {
	return git(root, ["worktree", "list", "--porcelain", "-z"]).split("\0\0").some((record) => {
		const fields = record.split("\0");
		return fields.includes(`branch refs/heads/${name}`) && !allowedWorktrees.has(fields.find((field) => field.startsWith("worktree "))?.slice(9) ?? "");
	});
}

// Branch deletion is a separate, terminal-only approval. The ordinary tree
// receipt continues to authorize branch-preserving worktree cleanup only.
export function inspectTreeBranches(root: string, targets: Target[]): TreeBranch[] {
	const worktrees = new Set(targets.map((target) => target.worktreePath));
	const branches: TreeBranch[] = [];
	const primaryBranch = git(root, ["branch", "--show-current"]);
	for (const target of targets) {
		const metadata = readMetadata(root, target.slug);
		const owned = sessionBranchSets(metadata, root).owned;
		const baseRef = `refs/heads/${sessionBaseBranch(metadata)}`;
		const base = run("git", ["rev-parse", "--verify", baseRef], root);
		for (const [name, revision] of Object.entries(target.branches)) {
			let reason: string | undefined;
			if (!owned.includes(name)) reason = "unclaimed or unresolved ownership";
			else if ([primaryBranch, metadata.defaultBranch, sessionBaseBranch(metadata)].includes(name)) reason = "protected base branch";
			else if (branchCheckedOutElsewhere(root, name, worktrees)) reason = "checked out outside the selected tree";
			else if (base.status !== 0) reason = `local merge base unavailable: ${baseRef}`;
			else if (run("git", ["merge-base", "--is-ancestor", revision, base.stdout], root).status !== 0) reason = `unmerged into ${baseRef}`;
			branches.push({ name, revision, baseRef, baseRevision: base.stdout, metadata, ...(reason ? { reason } : {}) });
		}
	}
	return branches;
}

export function treeBranchSummary(branches: TreeBranch[], deleteEligible: boolean): string {
	return branches.map((branch) => branch.reason
		? `  preserve: ${branch.name} (${branch.reason})\n`
		: deleteEligible ? `  delete: ${branch.name} @ ${branch.revision.slice(0, 12)} (merged into ${branch.baseRef} @ ${branch.baseRevision.slice(0, 12)})\n`
		: `  preserve: ${branch.name} (eligible for deletion; merged into ${branch.baseRef})\n`).join("");
}

export function deleteTreeBranch(root: string, branch: TreeBranch): void {
	assertTreeBranchUnchanged(root, branch, new Set());
	// Verify the merge base and compare-and-delete the tip in one ref transaction.
	const result = spawnSync("git", ["update-ref", "--stdin"], {
		cwd: root, encoding: "utf8",
		input: `start\nverify ${branch.baseRef} ${branch.baseRevision}\ndelete refs/heads/${branch.name} ${branch.revision}\nprepare\ncommit\n`,
	});
	if (result.status !== 0) throw new CliError(result.stderr?.trim() || result.error?.message || "Local branch deletion failed.");
}

export function assertTreeBranchUnchanged(root: string, branch: TreeBranch, allowedWorktrees: Set<string>): void {
	if (git(root, ["rev-parse", "--verify", `refs/heads/${branch.name}`]) !== branch.revision ||
		git(root, ["rev-parse", "--verify", branch.baseRef]) !== branch.baseRevision) throw new CliError(`Branch or merge base changed: ${branch.name}; preserved.`);
	if (!sessionBranchSets(branch.metadata, root).owned.includes(branch.name)) throw new CliError(`Branch ownership evidence changed: ${branch.name}; preserved.`);
	const claims = readMetadataInventory(root).filter((record) =>
		(record.branches?.some((entry) => entry.name === branch.name) ?? record.branch === branch.name) && record.sessionId !== branch.metadata.sessionId);
	if (claims.length) throw new CliError(`Branch has another session claim: ${branch.name}; preserved.`);
	if (branchCheckedOutElsewhere(root, branch.name, allowedWorktrees)) throw new CliError(`Branch is checked out outside the approved tree: ${branch.name}; preserved.`);
	if (run("git", ["merge-base", "--is-ancestor", branch.revision, branch.baseRevision], root).status !== 0) throw new CliError(`Branch is no longer safely merged: ${branch.name}; preserved.`);
}
