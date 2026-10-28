import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readlinkSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { gitRaw } from "./git.ts";

interface Identity {
	device: string;
	inode: string;
	mode: string;
	size: string;
	mtimeNs: string;
	ctimeNs: string;
}

export interface ConfiguredLinkEvidence {
	path: string;
	expectedTarget: string;
	state: "verified" | "missing" | "mismatch" | "unsafe";
	target?: string;
	identity?: Identity;
	ancestors?: { path: string; identity: Identity }[];
	problem?: string;
}

export interface IgnoredPathEvidence {
	path: string;
	type: "directory" | "symlink" | "file" | "other";
	classification: "configured-link" | "structural-parent" | "approved-artifact" | "unapproved";
	policyPath?: string;
	fingerprint?: string;
	target?: string;
	modifiedAt: string;
	size: {
		scope: "tree-no-follow" | "entry";
		apparentBytes: string;
		allocatedBytes: string | null;
		entries: number;
		uniqueInodes: number;
		complete: boolean;
		accounting: "unique-inodes-within-path";
		problems: { path: string; problem: string }[];
	};
}

interface PolicyRootEvidence {
	path: string;
	state: "present" | "missing" | "unsafe";
	ancestors: NonNullable<ConfiguredLinkEvidence["ancestors"]>;
	tree?: IgnoredPathEvidence;
	problem?: string;
}

export interface IgnoredDataInspection {
	policy: { disposablePaths: string[] };
	policyRoots: PolicyRootEvidence[];
	approvedArtifacts: string[];
	safe: boolean;
	complete: boolean;
	ignoredPaths: IgnoredPathEvidence[];
	worktreeIdentity?: Identity;
	configuredLinks: ConfiguredLinkEvidence[];
	unapprovedPaths: string[];
	blockers: { path: string; reason: string }[];
}

function identity(stat: ReturnType<typeof statEntry>): Identity {
	return {
		device: stat.dev.toString(), inode: stat.ino.toString(), mode: stat.mode.toString(),
		size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString(), ctimeNs: stat.ctimeNs.toString(),
	};
}

function statEntry(path: string) {
	return lstatSync(path, { bigint: true });
}

function relativeSetting(path: string): boolean {
	return path !== "" && !isAbsolute(path) && !/[\\\x00-\x1f\x7f]/.test(path) &&
		!path.split("/").some((part) => part === "" || part === "." || part === "..") &&
		path !== ".git" && !path.startsWith(".git/");
}

export function validDisposablePath(path: string): boolean {
	return relativeSetting(path) && !/[*?[\]{}]/.test(path) && !path.split("/").includes(".git");
}

// Neither target existence nor target contents is relevant to unlinking a
// workspace symlink. Inspect only the link and its non-symlink parent chain.
function inspectLink(root: string, worktree: string, path: string, device: bigint): ConfiguredLinkEvidence {
	const base = { path, expectedTarget: join(root, path) };
	if (!relativeSetting(path)) return { ...base, state: "unsafe", problem: "Invalid configured local-link path." };
	const ancestors: { path: string; identity: Identity }[] = [];
	try {
		const parts = path.split("/");
		for (let index = 1; index < parts.length; index++) {
			const parent = parts.slice(0, index).join("/");
			const stat = statEntry(join(worktree, parent));
			ancestors.push({ path: parent, identity: identity(stat) });
			if (!stat.isDirectory() || stat.isSymbolicLink()) return { ...base, ancestors, state: "unsafe", problem: "Configured link has a non-directory or symlink ancestor." };
			if (stat.dev !== device) return { ...base, ancestors, state: "unsafe", problem: "Configured link has a filesystem-device boundary ancestor." };
		}
		const fullPath = join(worktree, path);
		const stat = statEntry(fullPath);
		const entryIdentity = identity(stat);
		if (!stat.isSymbolicLink()) return { ...base, ancestors, identity: entryIdentity, state: "mismatch", problem: "Configured local link is not a symlink." };
		const target = readlinkSync(fullPath);
		if (JSON.stringify(identity(statEntry(fullPath))) !== JSON.stringify(entryIdentity)) return { ...base, ancestors, target, state: "unsafe", problem: "Link changed during inspection." };
		return resolve(dirname(fullPath), target) === base.expectedTarget
			? { ...base, ancestors, target, identity: entryIdentity, state: "verified" }
			: { ...base, ancestors, target, identity: entryIdentity, state: "mismatch", problem: "Configured link does not point to its expected primary-checkout path." };
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT"
			? { ...base, ancestors, state: "missing" }
			: { ...base, ancestors, state: "unsafe", problem: String(error) };
	}
}

// Metadata-only accounting. Never open file contents, follow symlink targets or
// cross a filesystem boundary. Allocation is not a reclaimed-space guarantee.
function measurePath(worktree: string, path: string, device: bigint, onProgress?: (path: string, entries: number) => void, recursive = true): IgnoredPathEvidence {
	const rootStat = statEntry(join(worktree, path));
	const type = rootStat.isSymbolicLink() ? "symlink" : rootStat.isDirectory() ? "directory" : rootStat.isFile() ? "file" : "other";
	const size: IgnoredPathEvidence["size"] = {
		scope: type === "directory" && recursive ? "tree-no-follow" : "entry", apparentBytes: "0", allocatedBytes: "0",
		entries: 0, uniqueInodes: 0, complete: true, accounting: "unique-inodes-within-path", problems: [],
	};
	const fingerprint = createHash("sha256");
	let rootTarget: string | undefined;
	let apparent = 0n, allocated = 0n, allocationKnown = true, lastProgress = Date.now();
	const seen = new Set<string>();
	const visit = (relative: string): void => {
		try {
			const fullPath = join(worktree, relative);
			const stat = statEntry(fullPath);
			const target = stat.isSymbolicLink() ? readlinkSync(fullPath) : null;
			if (relative === path && target !== null) rootTarget = target;
			fingerprint.update(JSON.stringify([relative, identity(stat), String(stat.uid), String(stat.gid), String(stat.nlink), String(stat.blocks), target]) + "\n");
			size.entries++;
			if (size.entries % 2048 === 0 || Date.now() - lastProgress >= 1000) {
				onProgress?.(path, size.entries); lastProgress = Date.now();
			}
			const key = `${stat.dev}:${stat.ino}`;
			if (seen.has(key)) return;
			seen.add(key); size.uniqueInodes++;
			apparent += stat.size;
			if (typeof stat.blocks === "bigint" && stat.blocks >= 0n) allocated += stat.blocks * 512n;
			else allocationKnown = false;
			if (stat.dev !== device) throw new Error("Filesystem boundary; subtree not inspected.");
			if (recursive && stat.isDirectory() && !stat.isSymbolicLink()) {
				for (const child of readdirSync(fullPath).sort()) visit(`${relative}/${child}`);
			}
			if (JSON.stringify(identity(statEntry(fullPath))) !== JSON.stringify(identity(stat))) throw new Error("Entry changed during size inspection.");
		} catch (error) {
			size.complete = false;
			size.problems.push({ path: relative, problem: String(error) });
		}
	};
	visit(path);
	try {
		if (JSON.stringify(identity(statEntry(join(worktree, path)))) !== JSON.stringify(identity(rootStat))) throw new Error("Root changed during size inspection.");
	} catch (error) { size.complete = false; size.problems.push({ path, problem: String(error) }); }
	size.apparentBytes = apparent.toString();
	size.allocatedBytes = allocationKnown ? allocated.toString() : null;
	onProgress?.(path, size.entries);
	return { path, type, classification: "unapproved", modifiedAt: new Date(Number(rootStat.mtimeMs)).toISOString(),
		...(rootTarget !== undefined ? { target: rootTarget } : {}), ...(size.complete ? { fingerprint: fingerprint.digest("hex") } : {}), size };
}

function inspectPolicyRoot(worktree: string, path: string, device: bigint, onProgress?: (path: string, entries: number) => void): PolicyRootEvidence {
	const ancestors: PolicyRootEvidence["ancestors"] = [];
	try {
		if (!validDisposablePath(path)) throw new Error("Invalid exact disposable path.");
		const parts = path.split("/");
		for (let index = 1; index < parts.length; index++) {
			const parent = parts.slice(0, index).join("/"), stat = statEntry(join(worktree, parent));
			ancestors.push({ path: parent, identity: identity(stat) });
			if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== device) throw new Error("Disposable path has an unsafe ancestor or filesystem boundary.");
		}
		const tree = measurePath(worktree, path, device, onProgress);
		return { path, ancestors, tree, state: tree.size.complete ? "present" : "unsafe", ...(!tree.size.complete ? { problem: "Incomplete artifact metadata tree." } : {}) };
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT"
			? { path, ancestors, state: "missing" }
			: { path, ancestors, state: "unsafe", problem: String(error) };
	}
}

// Shared by all non-forced paths. Policy is explicit, exact and empty by
// default; safe evidence alone is not approval to dispose approvedArtifacts.
export function inspectIgnoredData(root: string, worktree: string, localLinks: string[], disposablePaths: string[] = [], onProgress?: (path: string, entries: number) => void): IgnoredDataInspection {
	const result: IgnoredDataInspection = { policy: { disposablePaths: [...new Set(disposablePaths)].sort() }, policyRoots: [], approvedArtifacts: [], safe: false, complete: false, configuredLinks: [], ignoredPaths: [], unapprovedPaths: [], blockers: [] };
	try {
		const rootStat = statEntry(worktree);
		if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Worktree is not a non-symlink directory.");
		result.worktreeIdentity = identity(rootStat);
		result.configuredLinks = [...new Set(localLinks)].sort().map((path) => inspectLink(root, worktree, path, rootStat.dev));
		for (const link of result.configuredLinks) {
			if (link.state === "mismatch" || link.state === "unsafe") result.blockers.push({ path: link.path, reason: link.problem! });
		}
		result.policyRoots = result.policy.disposablePaths.map((path) => inspectPolicyRoot(worktree, path, rootStat.dev, onProgress));
		for (const policy of result.policyRoots) {
			if (policy.state === "unsafe") result.blockers.push({ path: policy.path, reason: policy.problem! });
		}
		const verified = new Set(result.configuredLinks.filter((link) => link.state === "verified").map((link) => link.path));
		const structuralPaths = [...verified, ...result.policyRoots.filter((policy) => policy.state === "present").map((policy) => policy.path)];
		const structuralParent = (path: string) => structuralPaths.some((entry) => entry.startsWith(`${path}/`));
		const inspectIgnoredEntry = (path: string): void => {
			const policy = result.policyRoots.find((policy) => policy.state === "present" && (policy.path === path || (policy.tree?.type === "directory" && path.startsWith(`${policy.path}/`))));
			const measured = policy?.path === path ? policy.tree! : measurePath(worktree, path, rootStat.dev, onProgress, !!policy || !structuralParent(path));
			const evidence = { ...measured };
			result.ignoredPaths.push(evidence);
			for (const problem of evidence.size.problems) result.blockers.push({ path: problem.path, reason: `Incomplete ignored-data inspection: ${problem.problem}` });
			if (verified.has(path)) { evidence.classification = "configured-link"; return; }
			if (policy) {
				evidence.classification = "approved-artifact"; evidence.policyPath = policy.path;
				result.approvedArtifacts.push(policy.path); return;
			}
			const stat = statEntry(join(worktree, path));
			// Git may collapse a wholly ignored container. Expand only structural
			// parents of verified links/policy roots, never symlinks or unrelated data.
			if (structuralParent(path) && stat.isDirectory() && !stat.isSymbolicLink() && stat.dev === rootStat.dev) {
				evidence.classification = "structural-parent";
				const children = readdirSync(join(worktree, path)).sort();
				if (children.length) {
					for (const child of children) inspectIgnoredEntry(`${path}/${child}`);
					return;
				}
			}
			result.unapprovedPaths.push(path);
		};
		const ignored = gitRaw(worktree, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"]);
		let entriesComplete = true;
		for (const rawPath of ignored.split("\0").filter(Boolean)) {
			const path = rawPath.replace(/\/$/, "");
			try {
				if (!relativeSetting(path)) throw new Error("Unsafe ignored-path evidence.");
				inspectIgnoredEntry(path);
			} catch (error) {
				entriesComplete = false;
				result.unapprovedPaths.push(path);
				result.blockers.push({ path, reason: `Cannot inspect ignored entry: ${String(error)}` });
			}
		}
		result.approvedArtifacts = [...new Set(result.approvedArtifacts)].sort();
		result.unapprovedPaths = [...new Set(result.unapprovedPaths)].sort();
		for (const path of result.unapprovedPaths) result.blockers.push({ path, reason: "Unapproved ignored local data." });
		if (JSON.stringify(identity(statEntry(worktree))) !== JSON.stringify(result.worktreeIdentity)) throw new Error("Worktree changed during ignored-data inspection.");
		result.complete = entriesComplete && result.policyRoots.every((policy) => policy.state !== "unsafe") && result.configuredLinks.every((link) => link.state !== "unsafe") && result.ignoredPaths.every((entry) => entry.size.complete);
		result.safe = result.complete && result.blockers.length === 0;
	} catch (error) {
		result.blockers.push({ path: ".", reason: `Cannot establish ignored-data safety: ${String(error)}` });
	}
	return result;
}

export function ignoredDataProblem(evidence: IgnoredDataInspection): string {
	return evidence.blockers.map((blocker) => `${blocker.path}: ${blocker.reason}`).join("; ");
}
