import { realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { CliError, run } from "./runtime.ts";
import type { ReflogEntry } from "./types.ts";

export function git(cwd: string, args: string[]): string {
	const result = run("git", args, cwd);
	if (result.status !== 0) {
		throw new CliError(result.stderr || `git ${args.join(" ")} failed`);
	}
	return result.stdout;
}

// NUL-framed paths and porcelain status prefixes must not be trimmed.
export function gitRaw(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, { cwd, encoding: "utf8", env: process.env });
	if (result.status !== 0) throw new CliError(result.stderr?.trim() || result.error?.message || `git ${args.join(" ")} failed`);
	return result.stdout;
}

export interface BranchRef {
	name: string;
	revision: string;
	baseRef: string;
	baseRevision: string;
}

export function branchCheckedOutElsewhere(root: string, name: string, allowedWorktrees: Set<string>): boolean {
	return git(root, ["worktree", "list", "--porcelain", "-z"]).split("\0\0").some((record) => {
		const fields = record.split("\0");
		return fields.includes(`branch refs/heads/${name}`) && !allowedWorktrees.has(fields.find((field) => field.startsWith("worktree "))?.slice(9) ?? "");
	});
}

export function assertBranchRefsUnchanged(root: string, branch: BranchRef, allowedWorktrees: Set<string>): void {
	if (git(root, ["rev-parse", "--verify", `refs/heads/${branch.name}`]) !== branch.revision ||
		git(root, ["rev-parse", "--verify", branch.baseRef]) !== branch.baseRevision) throw new CliError(`Branch or merge base changed: ${branch.name}; preserved.`);
	if (branchCheckedOutElsewhere(root, branch.name, allowedWorktrees)) throw new CliError(`Branch is checked out outside the approved scope: ${branch.name}; preserved.`);
	if (run("git", ["merge-base", "--is-ancestor", branch.revision, branch.baseRevision], root).status !== 0) throw new CliError(`Branch is no longer safely merged: ${branch.name}; preserved.`);
}

// Callers supply either verified ownership or explicit historical-branch
// approval. Native ref mechanics never infer that authority from a reflog.
export function deleteBranchRef(root: string, branch: BranchRef): void {
	assertBranchRefsUnchanged(root, branch, new Set());
	const result = spawnSync("git", ["update-ref", "--stdin"], {
		cwd: root, encoding: "utf8",
		input: `start\nverify ${branch.baseRef} ${branch.baseRevision}\ndelete refs/heads/${branch.name} ${branch.revision}\nprepare\ncommit\n`,
	});
	if (result.status !== 0) throw new CliError(result.stderr?.trim() || result.error?.message || "Local branch deletion failed.");
}

export function repositoryRoot(cwd = process.cwd()): string {
	const result = run("git", ["rev-parse", "--show-toplevel"], cwd);
	if (result.status !== 0) {
		throw new CliError("agent-session must run inside a Git worktree.", 64);
	}
	return realpathSync(result.stdout);
}

export function primaryRoot(root: string): string {
	const worktrees = git(root, ["worktree", "list", "--porcelain"]);
	const first = worktrees
		.split("\n")
		.find((line) => line.startsWith("worktree "));
	if (!first) throw new CliError("Git did not report a primary worktree.");
	return realpathSync(first.slice("worktree ".length));
}

export function assertPrimaryCheckout(root: string): void {
	const primary = primaryRoot(root);
	if (root !== primary) {
		throw new CliError(
			`Run this command from the primary checkout: ${primary}`,
			64,
		);
	}
}

export function commonGitDirectory(root: string): string {
	const path = git(root, ["rev-parse", "--git-common-dir"]);
	return realpathSync(isAbsolute(path) ? path : resolve(root, path));
}

export function upstreamRemote(root: string, branch: string): string {
	const upstream = git(root, [
		"for-each-ref",
		"--format=%(upstream:short)",
		`refs/heads/${branch}`,
	]);
	if (!upstream?.includes("/")) {
		throw new CliError(
			`Primary branch ${branch} has no unambiguous upstream remote.`,
		);
	}
	return upstream.slice(0, upstream.indexOf("/"));
}

export function remoteDefaultBranch(root: string, remote: string): string {
	const result = run("git", ["ls-remote", "--symref", remote, "HEAD"], root);
	if (result.status !== 0) {
		throw new CliError(
			`Cannot inspect the default branch for remote ${remote}.`,
		);
	}
	const symbolicHead = result.stdout
		.split("\n")
		.find(
			(line) => line.startsWith("ref: refs/heads/") && line.endsWith("\tHEAD"),
		);
	const match = symbolicHead?.match(/^ref: refs\/heads\/(.+)\tHEAD$/);
	if (!match?.[1]) {
		throw new CliError(
			`Cannot discover the default branch for remote ${remote}.`,
		);
	}
	return match[1];
}

export function cachedRemoteDefaultBranch(root: string, remote: string): string {
	const result = run("git", ["symbolic-ref", "--quiet", `refs/remotes/${remote}/HEAD`], root);
	const prefix = `refs/remotes/${remote}/`;
	if (result.status !== 0 || !result.stdout.startsWith(prefix)) {
		throw new CliError(`No cached default branch for ${remote}. Refresh its remote HEAD explicitly before previewing; no network query was made.`);
	}
	return result.stdout.slice(prefix.length);
}

export function ensureClean(root: string, readOnly = false): void {
	const status = git(root, [...(readOnly ? ["--no-optional-locks"] : []), "status", "--porcelain", "--untracked-files=all"]);
	if (status) {
		throw new CliError(`Primary checkout must be clean:\n${status}`);
	}
}

export function countRevisionRange(cwd: string, range: string): number {
	const result = run("git", ["rev-list", "--count", range], cwd);
	if (result.status !== 0) return 0;
	return Number.parseInt(result.stdout, 10) || 0;
}

export function reflogEntries(cwd: string, revision: string): ReflogEntry[] {
	const result = run(
		"git",
		["reflog", "--format=%ct%x09%H%x09%gs", revision],
		cwd,
	);
	if (result.status !== 0 || !result.stdout) return [];
	return result.stdout.split("\n").map((line) => {
		const [timestamp = "", commit = "", ...summary] = line.split("\t");
		return { timestamp, commit, summary: summary.join("\t") };
	});
}

export function localBranches(root: string): Set<string> {
	const output = git(root, [
		"for-each-ref",
		"--format=%(refname:short)",
		"refs/heads",
	]);
	return new Set(output ? output.split("\n") : []);
}

export function worktreeIsRegistered(root: string, worktreePath: string): boolean {
	return git(root, ["worktree", "list", "--porcelain"])
		.split("\n")
		.includes(`worktree ${worktreePath}`);
}

export function branchUpstreamIsGone(root: string, branch: string): boolean {
	const result = run(
		"git",
		["for-each-ref", "--format=%(upstream:track)", `refs/heads/${branch}`],
		root,
	);
	return result.status === 0 && result.stdout.trim() === "[gone]";
}
