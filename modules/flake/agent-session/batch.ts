import { createHash } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { assertPrimaryCheckout, commonGitDirectory, ensureClean, git } from "./git.ts";
import { inspectExactResource } from "./inspection.ts";
import { inspectIgnoredData, ignoredDataProblem, type IgnoredDataInspection } from "./artifacts.ts";
import {
	assertConfiguredWorktreePath, discoverManagedWorktrees, loadConfig,
	metadataPath, metadataSlugs, readMetadata, validateSlug, withOperationLock,
} from "./sessions.ts";
import { CliError, run, writeCommandResult } from "./runtime.ts";
import type { BatchFinishOptions, SessionMetadata } from "./types.ts";

interface Target {
	slug: string;
	worktreePath: string;
	metadataHash: string;
	branches: Record<string, string>;
	fingerprint: string;
}

interface Receipt {
	version: 1;
	rootKey: string;
	observedAt: string;
	inactiveMs: number;
	exclusions: string[];
	keepBranch: true;
	targets: Target[];
}

interface Candidate {
	slug: string;
	worktreePath?: string;
	reason: string;
	problem?: string;
	activity?: { lastWorkAt: string; sources: string[] };
	ignoredData?: IgnoredDataInspection;
	snapshot?: Target;
}

interface Outcome {
	slug: string;
	worktreePath: string;
	outcome: "finished" | "absent" | "refused" | "uncertain";
	reason: string;
	problem?: string;
}

// Same-user cwd evidence supplements managed activity records, not arbitrary
// editors with cwd elsewhere, detached jobs, other users or remote processes.
function processDirectories(): { pid: number; path: string }[] {
	if (!process.getuid) throw new CliError("Process cwd evidence is unavailable on this platform.");
	const result = run("lsof", ["-n", "-P", "-a", "-d", "cwd", "-u", String(process.getuid()), "-F0pn"], process.cwd());
	if (result.status !== 0 || result.stderr) throw new CliError("Cannot establish process cwd evidence; check lsof availability and permissions.");
	const directories: { pid: number; path: string }[] = [];
	let pid: number | undefined;
	for (const raw of result.stdout.split("\0")) {
		const field = raw.replace(/^\n/, "");
		if (/^p\d+$/.test(field)) pid = Number(field.slice(1));
		else if (field.startsWith("n") && pid) directories.push({ pid, path: field.slice(1) });
	}
	if (!directories.length) throw new CliError("Process cwd evidence was empty or unrecognized.");
	return directories;
}

function operationIsLive(pid: number): boolean {
	try { process.kill(pid, 0); return true; }
	catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

function latestObservedWork(metadata: SessionMetadata, branches: string[]): { lastWorkAt: string; sources: string[] } {
	const timestamps = [Date.parse(metadata.createdAt), Date.parse(metadata.lastWorkAt ?? metadata.createdAt)];
	const sources = ["creation", ...(metadata.lastWorkAt ? ["managed-work"] : []), "checkout-and-owned-branch-reflogs", "working-file-mtimes"];
	// Commit timestamps (%ct) do not date checkout/reset events. %gD with
	// --date=unix supplies their actual reflog event times, including old commits.
	for (const revision of ["HEAD", ...branches]) {
		const entries = git(metadata.worktreePath, ["reflog", "show", "--date=unix", "--format=%gD", revision]);
		for (const entry of entries ? entries.split("\n") : []) {
			const match = entry.match(/@\{(\d+)\}$/);
			if (!match) throw new CliError("Unrecognized reflog activity evidence.");
			timestamps.push(Number(match[1]) * 1000);
		}
	}
	const files = git(metadata.worktreePath, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
	for (const file of files.split("\0").filter(Boolean)) timestamps.push(lstatSync(join(metadata.worktreePath, file)).mtimeMs);
	if (timestamps.some((timestamp) => !Number.isFinite(timestamp))) throw new CliError("Invalid activity timestamps.");
	return { lastWorkAt: new Date(timestamps.reduce((latest, timestamp) => Math.max(latest, timestamp))).toISOString(), sources };
}

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function identity(path: string): string[] {
	const stat = lstatSync(path, { bigint: true });
	return [stat.dev.toString(), stat.ino.toString()];
}

function rootKey(root: string): string {
	const common = commonGitDirectory(root);
	return hash(JSON.stringify([root, identity(root), common, identity(common), loadConfig(root)]));
}

function metadataHash(root: string, slug: string): string {
	return hash(readFileSync(metadataPath(root, slug), "utf8"));
}

function inspectCandidate(root: string, invocationRoot: string, slug: string, options: BatchFinishOptions, now = Date.now()): Candidate {
	const base = { slug };
	if (options.exclusions.includes(slug)) return { ...base, reason: "excluded" };
	try {
		const metadata = readMetadata(root, slug);
		assertConfiguredWorktreePath(root, loadConfig(root), metadata);
		const target = { slug, worktreePath: metadata.worktreePath };
		if (metadata.worktreePath === invocationRoot) return { ...target, reason: "invoking-worktree" };
		const exact = inspectExactResource(root, metadata.worktreePath);
		if (exact.resourceState !== "present") return { ...target, reason: "unresolved-resource", problem: exact.problem };
		const status = exact.sessions[0];
		if (!status?.clean) return { ...target, reason: "dirty" };
		for (const operation of metadata.activeOperations ?? []) {
			if (operation.hostname !== hostname()) return { ...target, reason: "uncertain-operation", problem: "Activity owner is on another host." };
			return operationIsLive(operation.pid)
				? { ...target, reason: "live-operation" }
				: { ...target, reason: "uncertain-operation", problem: "Interrupted managed operation has no confirmed completion; inspect its saved activity record." };
		}
		const live = processDirectories().filter((entry) => entry.path === metadata.worktreePath || entry.path.startsWith(`${metadata.worktreePath}/`));
		if (live.length) return { ...target, reason: "live-cwd" };
		const stat = lstatSync(metadata.worktreePath);
		if (process.getuid && stat.uid !== process.getuid()) return { ...target, reason: "other-owner" };
		const ignoredData = inspectIgnoredData(root, metadata.worktreePath, loadConfig(root).local_links);
		if (!ignoredData.safe) return { ...target, ignoredData, reason: "ignored-local-data", problem: ignoredDataProblem(ignoredData) };
		const activity = latestObservedWork(metadata, status.ownedBranches);
		if (Date.parse(activity.lastWorkAt) > now - options.inactiveMs) return { ...target, ignoredData, reason: "recent-activity", activity };
		const branches = Object.fromEntries([...new Set([...status.ownedBranches, status.currentBranch!])].sort()
			.map((branch) => [branch, git(root, ["rev-parse", "--verify", `refs/heads/${branch}`])]));
		const gitDirectory = realpathSync(git(metadata.worktreePath, ["rev-parse", "--absolute-git-dir"]));
		try {
			lstatSync(join(gitDirectory, "locked"));
			return { ...target, reason: "worktree-locked" };
		} catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
		if (git(metadata.worktreePath, ["ls-files", "--stage"]).split("\n").some((line) => line.startsWith("160000 "))) return { ...target, reason: "submodules", problem: "Submodule worktrees require separate review." };
		const snapshot = { ...target, metadataHash: metadataHash(root, slug), branches };
		const fingerprint = hash(JSON.stringify([
			snapshot, identity(metadata.worktreePath), gitDirectory, identity(gitDirectory),
			git(metadata.worktreePath, ["rev-parse", "--verify", "HEAD"]), activity, ignoredData,
		]));
		return { ...target, ignoredData, reason: "eligible", activity, snapshot: { ...snapshot, fingerprint } };
	} catch (error) {
		return { ...base, reason: String(error).includes("process cwd evidence") ? "unknown-process-evidence" : "unresolved-evidence", problem: String(error) };
	}
}

function encodeReceipt(receipt: Receipt): string {
	const body = Buffer.from(JSON.stringify(receipt)).toString("base64url");
	return `batch-v1.${body}.${hash(body)}`;
}

function decodeReceipt(root: string, options: BatchFinishOptions): Receipt {
	try {
		const [prefix, body = "", checksum] = options.expected!.split(".");
		if (prefix !== "batch-v1" || body.length > 2_000_000 || hash(body) !== checksum) throw new Error("Invalid checksum.");
		const value: Receipt = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
		if (value.version !== 1 || value.keepBranch !== true || value.rootKey !== rootKey(root) ||
			!Number.isFinite(Date.parse(value.observedAt)) || value.inactiveMs !== options.inactiveMs ||
			JSON.stringify(value.exclusions) !== JSON.stringify(options.exclusions) || !Array.isArray(value.targets) || value.targets.length > 10000) throw new Error("Preview context does not match.");
		const slugs = new Set<string>(), paths = new Set<string>();
		for (const target of value.targets) {
			validateSlug(target.slug);
			if (slugs.has(target.slug) || paths.has(target.worktreePath) || options.exclusions.includes(target.slug) ||
				typeof target.worktreePath !== "string" || !/^[a-f0-9]{64}$/.test(target.fingerprint) || !/^[a-f0-9]{64}$/.test(target.metadataHash) ||
				!target.branches || typeof target.branches !== "object" || Array.isArray(target.branches) || !Object.keys(target.branches).length ||
				Object.values(target.branches).some((revision) => !/^[a-f0-9]{40,64}$/.test(revision))) throw new Error("Invalid preview selection.");
			slugs.add(target.slug); paths.add(target.worktreePath);
		}
		return value;
	} catch (error) { throw new CliError(`Invalid or mismatched batch receipt; obtain a fresh preview. ${String(error)}`, 64); }
}

interface Journal {
	version: 1;
	receiptHash: string;
	started: Record<string, string>;
}

function journalStore(root: string, receipt: Receipt, token: string) {
	const directory = join(commonGitDirectory(root), "agent-session", "retirements");
	const receiptHash = hash(token);
	const path = join(directory, `${receiptHash}.json`);
	let journal: Journal = { version: 1, receiptHash, started: {} };
	try {
		const stat = lstatSync(directory);
		if (!stat.isDirectory() || stat.isSymbolicLink()) throw new CliError("Invalid retirement journal directory.");
		try {
			const file = lstatSync(path);
			if (!file.isFile() || file.isSymbolicLink()) throw new CliError("Invalid retirement journal file.");
			const value = JSON.parse(readFileSync(path, "utf8")) as Journal;
			if (value.version !== 1 || value.receiptHash !== receiptHash || !value.started || typeof value.started !== "object" || Array.isArray(value.started) ||
				Object.entries(value.started).some(([slug, fingerprint]) => !receipt.targets.some((target) => target.slug === slug && target.fingerprint === fingerprint))) throw new CliError("Invalid retirement journal content.");
			journal = value;
		} catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	} catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	return {
		started: (target: Target) => journal.started[target.slug] === target.fingerprint,
		start: (target: Target) => {
			mkdirSync(directory, { recursive: true });
			if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new CliError("Invalid retirement journal directory.");
			journal.started[target.slug] = target.fingerprint;
			const temporary = `${path}.tmp.${process.pid}`;
			let fd: number | undefined;
			try {
				fd = openSync(temporary, "wx", 0o600);
				writeFileSync(fd, `${JSON.stringify(journal)}\n`);
				fsyncSync(fd);
				closeSync(fd); fd = undefined;
				renameSync(temporary, path);
				const directoryFd = openSync(directory, "r");
				try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
			} finally {
				if (fd !== undefined) closeSync(fd);
				rmSync(temporary, { force: true });
			}
		},
	};
}

function residualRecord(root: string, target: Target, exact: ReturnType<typeof inspectExactResource>): boolean {
	return exact.resourceState === "inconsistent" && exact.evidence.filesystem === "absent" && exact.evidence.registered === false &&
		exact.bindingSlugs.length === 1 && exact.bindingSlugs[0] === target.slug && metadataHash(root, target.slug) === target.metadataHash &&
		readMetadata(root, target.slug).worktreePath === target.worktreePath;
}

function completeRemoval(root: string, target: Target, reconciled: boolean): Outcome {
	const base = { slug: target.slug, worktreePath: target.worktreePath };
	const exact = inspectExactResource(root, target.worktreePath);
	if (!residualRecord(root, target, exact)) return { ...base, outcome: "uncertain", reason: "residual-evidence-changed", problem: exact.problem ?? "Expected unique unchanged metadata and confirmed native/filesystem absence." };
	for (const [branch, revision] of Object.entries(target.branches)) {
		if (git(root, ["rev-parse", "--verify", `refs/heads/${branch}`]) !== revision) return { ...base, outcome: "uncertain", reason: "branch-evidence-changed" };
	}
	unlinkSync(metadataPath(root, target.slug));
	const confirmed = inspectExactResource(root, target.worktreePath);
	return confirmed.resourceState === "absent"
		? { ...base, outcome: "finished", reason: reconciled ? "reconciled-removal" : "confirmed-removal" }
		: { ...base, outcome: "uncertain", reason: "removal-not-confirmed", problem: confirmed.problem };
}

export function batchFinish(root: string, invocationRoot: string, options: BatchFinishOptions): number {
	if (options.dryRun) {
		const config = loadConfig(root);
		const observedAt = new Date().toISOString();
		const slugs = [...new Set([...metadataSlugs(root), ...discoverManagedWorktrees(root, config).keys(), ...options.exclusions])].sort();
		const candidates = slugs.map((slug) => inspectCandidate(root, invocationRoot, slug, options, Date.parse(observedAt)));
		const receipt = encodeReceipt({ version: 1, rootKey: rootKey(root), observedAt, inactiveMs: options.inactiveMs,
			exclusions: options.exclusions, keepBranch: true, targets: candidates.flatMap((candidate) => candidate.snapshot ? [candidate.snapshot] : []) });
		const resources = candidates.map(({ snapshot, ...candidate }) => ({ ...candidate, keepBranch: true, allBranchesPreserved: true, ...(snapshot ? { fingerprint: snapshot.fingerprint } : {}) }));
		writeCommandResult({ version: 1, command: "batch finish", dryRun: true, inactiveFor: options.inactiveFor,
			observedAt, cutoff: new Date(Date.parse(observedAt) - options.inactiveMs).toISOString(),
			keepBranch: true, remoteAssetsModified: false, exclusions: options.exclusions, resources, receipt,
			limitations: [
				"Observed inactivity is not proof of disposability; explicitly exclude retained or otherwise active work.",
				"Managed launch/resume/run record start and completion; interrupted activity records refuse eligibility.",
				"Unmanaged evidence covers checkout/owned-branch reflogs and current non-ignored file mtimes, not a complete history.",
				"Process evidence covers same-user cwd, not editors elsewhere, other users or remote processes.",
				"Restored timestamps and expired reflogs can hide activity; ignored local data is refused.",
			],
		}, options.json, `Inactive-session preview; no resources changed.\n${resources.map((resource) => `  ${resource.slug}: ${resource.reason}`).join("\n")}\nReceipt: ${receipt}\n`);
		return 0;
	}
	const receipt = decodeReceipt(root, options);
	let resources: Outcome[];
	try {
		resources = withOperationLock(root, "batch finish", () => {
			assertPrimaryCheckout(root);
			ensureClean(root, true);
			const journal = journalStore(root, receipt, options.expected!);
			return receipt.targets.map((target): Outcome => {
				const base = { slug: target.slug, worktreePath: target.worktreePath };
				try {
					const exact = inspectExactResource(root, target.worktreePath);
					if (exact.resourceState === "absent") return { ...base, outcome: "absent", reason: "confirmed-absence" };
					if (journal.started(target) && residualRecord(root, target, exact)) return completeRemoval(root, target, true);
					const candidate = inspectCandidate(root, invocationRoot, target.slug, options);
					if (candidate.reason !== "eligible") return { ...base, outcome: "refused", reason: candidate.reason, problem: candidate.problem };
					if (candidate.snapshot?.fingerprint !== target.fingerprint || candidate.worktreePath !== target.worktreePath) return { ...base, outcome: "refused", reason: "changed-since-preview" };
					journal.start(target);
					const removed = run("git", ["worktree", "remove", "--", target.worktreePath], root);
					if (removed.status !== 0) return { ...base, outcome: "uncertain", reason: "native-removal-unconfirmed", problem: removed.stderr };
					return completeRemoval(root, target, false);
				} catch (error) { return { ...base, outcome: "uncertain", reason: "inspection-or-cleanup-failed", problem: String(error) }; }
			});
		});
	} catch (error) {
		resources = receipt.targets.map((target) => ({ slug: target.slug, worktreePath: target.worktreePath, outcome: "refused", reason: "operation-guard", problem: String(error) }));
	}
	const success = resources.every((resource) => ["finished", "absent"].includes(resource.outcome));
	const partial = !success && resources.some((resource) => ["finished", "absent"].includes(resource.outcome));
	writeCommandResult({ version: 1, command: "batch finish", dryRun: false, keepBranch: true,
		branchesModified: false, remoteAssetsModified: false, success, partial, resources }, options.json,
		`${resources.map((resource) => `${resource.slug}: ${resource.outcome} (${resource.reason})`).join("\n")}\n`);
	return success ? 0 : 1;
}
