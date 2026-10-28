import { createHash } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { assertPrimaryCheckout, commonGitDirectory, ensureClean, git, gitRaw } from "./git.ts";
import { inspectExactResource, snapshotExactResources, type ExactInspectionContext } from "./inspection.ts";
import { inspectIgnoredData, ignoredDataProblem, type IgnoredDataInspection } from "./artifacts.ts";
import {
	assertConfiguredWorktreePath, discoverManagedWorktrees, loadConfig,
	metadataPath, metadataSlugs, readMetadata, validateSlug, withOperationLock,
} from "./sessions.ts";
import { CliError, progressReporter, run, writeCommandResult } from "./runtime.ts";
import type { BatchFinishOptions, ProgressReporter, SessionMetadata } from "./types.ts";

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

interface ActivityEvidence {
	lastWorkAt: string | null;
	limitingEvidence: string | null;
	sources: string[];
	observations: { source: string; timestamp: string }[];
	filesChecked: number;
	complete: boolean;
	inactive: boolean | null;
	problems: string[];
}

interface ProcessSnapshot {
	observedAt: string;
	entries: { pid: number; path: string }[];
	problem?: string;
}

interface Candidate {
	slug: string;
	worktreePath?: string;
	reason: string;
	problem?: string;
	blockers: { reason: string; problem?: string }[];
	inspectionComplete: boolean;
	activity?: ActivityEvidence;
	ignoredData?: IgnoredDataInspection;
	resource?: { state: string; evidence: unknown; bindingSlugs: string[] };
	git?: { state: string; currentBranch: string | null; ownedBranches: string[]; clean: boolean | null; changes: { status: string; path: string; originalPath?: string }[] | null };
	processEvidence?: { observedAt: string; source: string; pids: number[]; operations: unknown[]; problem?: string };
	snapshot?: Target;
}

interface Outcome {
	slug: string;
	worktreePath: string;
	outcome: "finished" | "absent" | "refused" | "uncertain";
	reason: string;
	problem?: string;
	inspection?: Omit<Candidate, "snapshot">;
}

// Same-user cwd evidence supplements managed activity records, not arbitrary
// editors with cwd elsewhere, detached jobs, other users or remote processes.
function processDirectories(): { pid: number; path: string }[] {
	if (!process.getuid) throw new CliError("Process cwd evidence is unavailable on this platform.");
	const result = run("lsof", ["-n", "-P", "-a", "-d", "cwd", "-u", String(process.getuid()), "-F0pn"], process.cwd());
	if (result.status !== 0 || result.stderr) throw new CliError("Cannot establish process cwd evidence; check lsof availability and permissions.");
	const directories: { pid: number; path: string }[] = [];
	let pid: number | undefined;
	let hasCwd = false;
	for (const raw of result.stdout.split("\0")) {
		const field = raw.replace(/^\n/, "");
		if (!field) continue;
		if (/^p\d+$/.test(field)) {
			if (pid !== undefined && !hasCwd) throw new CliError("Incomplete process cwd evidence.");
			pid = Number(field.slice(1)); hasCwd = false;
			if (!Number.isSafeInteger(pid) || pid <= 0) throw new CliError("Unrecognized process cwd evidence.");
		} else if (field === "fcwd" && pid !== undefined) {
			continue;
		} else if (field.startsWith("n/") && pid !== undefined && !hasCwd) {
			directories.push({ pid, path: field.slice(1) }); hasCwd = true;
		} else throw new CliError("Unrecognized process cwd evidence.");
	}
	if (pid !== undefined && !hasCwd) throw new CliError("Incomplete process cwd evidence.");
	if (!directories.length) throw new CliError("Process cwd evidence was empty or unrecognized.");
	return directories;
}

function operationIsLive(pid: number): boolean {
	try { process.kill(pid, 0); return true; }
	catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

function latestObservedWork(metadata: SessionMetadata, branches: string[], now: number, inactiveMs: number): ActivityEvidence {
	const evidence: ActivityEvidence = {
		lastWorkAt: null, limitingEvidence: null, filesChecked: 0, complete: true, inactive: null, problems: [], observations: [],
		sources: ["creation", ...(metadata.lastWorkAt ? ["managed-work"] : []), "checkout-and-owned-branch-reflogs", "working-file-mtimes"],
	};
	const observe = (source: string, timestamp: number) => {
		if (!Number.isFinite(timestamp) || Math.abs(timestamp) > 8.64e15) { evidence.problems.push(`Invalid timestamp: ${source}`); return; }
		evidence.observations.push({ source, timestamp: new Date(timestamp).toISOString() });
	};
	observe("creation", Date.parse(metadata.createdAt));
	if (metadata.lastWorkAt) observe("managed-work", Date.parse(metadata.lastWorkAt));
	// Reflog event time, not the commit timestamp: checking out an old commit
	// is recent activity even though its author/committer dates are old.
	for (const revision of ["HEAD", ...branches]) {
		try {
			const entries = git(metadata.worktreePath, ["reflog", "show", "--date=unix", "--format=%gD", revision]);
			let latest: number | undefined;
			for (const entry of entries ? entries.split("\n") : []) {
				const match = entry.match(/@\{(\d+)\}$/);
				if (!match) throw new CliError("Unrecognized reflog activity evidence.");
				latest = Math.max(latest ?? 0, Number(match[1]) * 1000);
			}
			if (latest !== undefined) observe(`reflog:${revision}`, latest);
		} catch (error) { evidence.problems.push(`reflog:${revision}: ${String(error)}`); }
	}
	try {
		const files = gitRaw(metadata.worktreePath, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
		let latestFile: { path: string; timestamp: number } | undefined;
		for (const file of [...new Set(files.split("\0").filter(Boolean))].sort()) {
			try {
				const timestamp = lstatSync(join(metadata.worktreePath, file)).mtimeMs;
				evidence.filesChecked++;
				if (!latestFile || timestamp > latestFile.timestamp) latestFile = { path: file, timestamp };
			} catch (error) { evidence.problems.push(`file:${file}: ${String(error)}`); }
		}
		if (latestFile) observe(`file:${latestFile.path}`, latestFile.timestamp);
	} catch (error) { evidence.problems.push(`working-file-mtimes: ${String(error)}`); }
	for (const observation of evidence.observations) {
		if (!evidence.lastWorkAt || Date.parse(observation.timestamp) > Date.parse(evidence.lastWorkAt)) {
			evidence.lastWorkAt = observation.timestamp; evidence.limitingEvidence = observation.source;
		}
	}
	evidence.complete = evidence.problems.length === 0 && evidence.lastWorkAt !== null;
	evidence.inactive = evidence.complete ? Date.parse(evidence.lastWorkAt!) <= now - inactiveMs : null;
	return evidence;
}

function captureProcesses(): ProcessSnapshot {
	const observedAt = new Date().toISOString();
	try { return { observedAt, entries: processDirectories() }; }
	catch (error) { return { observedAt, entries: [], problem: String(error) }; }
}

function workingChanges(worktree: string) {
	const fields = gitRaw(worktree, ["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0");
	const changes: { status: string; path: string; originalPath?: string }[] = [];
	for (let index = 0; index < fields.length; index++) {
		const field = fields[index]!;
		if (!field) continue;
		if (field.length < 4 || field[2] !== " ") throw new CliError("Unrecognized working-tree status evidence.");
		const status = field.slice(0, 2);
		const change: { status: string; path: string; originalPath?: string } = { status, path: field.slice(3) };
		if (/[RC]/.test(status)) {
			const originalPath = fields[++index];
			if (!originalPath) throw new CliError("Incomplete rename/copy status evidence.");
			change.originalPath = originalPath;
		}
		changes.push(change);
	}
	return changes;
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

function metadataHash(root: string, slug: string, commonDirectory?: string): string {
	const path = commonDirectory ? join(commonDirectory, "agent-session", "sessions", `${slug}.json`) : metadataPath(root, slug);
	return hash(readFileSync(path, "utf8"));
}

function inspectCandidate(root: string, invocationRoot: string, slug: string, options: BatchFinishOptions,
	now = Date.now(), processes?: ProcessSnapshot, report?: ProgressReporter, sharedContext?: ExactInspectionContext): Candidate {
	const candidate: Candidate = { slug, reason: "eligible", blockers: [], inspectionComplete: true };
	const block = (reason: string, problem?: string) => candidate.blockers.push({ reason, ...(problem ? { problem } : {}) });
	const finish = () => {
		const priority = ["excluded", "invoking-worktree", "unresolved-resource", "dirty", "uncertain-operation", "live-operation", "unknown-process-evidence", "live-cwd", "other-owner", "ignored-local-data", "unknown-activity", "recent-activity", "worktree-locked", "submodules", "unresolved-evidence"];
		candidate.blockers.sort((a, b) => priority.indexOf(a.reason) - priority.indexOf(b.reason));
		candidate.reason = candidate.blockers[0]?.reason ?? "eligible";
		if (candidate.blockers.length) candidate.problem = candidate.blockers.map((item) => item.problem ?? item.reason).join("; ");
		return candidate;
	};
	if (options.exclusions.includes(slug)) {
		block("excluded"); candidate.inspectionComplete = false;
		return finish();
	}
	try {
		const config = sharedContext?.config ?? loadConfig(root);
		const metadata = sharedContext ? sharedContext.recordsBySlug.get(slug) : readMetadata(root, slug);
		if (!metadata) throw new CliError(`No managed session: ${slug}`);
		assertConfiguredWorktreePath(root, config, metadata);
		candidate.worktreePath = metadata.worktreePath;
		if (metadata.worktreePath === invocationRoot) block("invoking-worktree");
		const exact = inspectExactResource(root, metadata.worktreePath, sharedContext);
		candidate.resource = { state: exact.resourceState, evidence: exact.evidence, bindingSlugs: exact.bindingSlugs };
		if (exact.resourceState !== "present") block("unresolved-resource", exact.problem);
		const status = exact.sessions[0];
		// A returned session proves the physical checkout identity, even when its
		// current branch conflicts. Without it, do not inspect an unsafe path.
		if (!status) { candidate.inspectionComplete = false; return finish(); }
		candidate.git = { state: status.state, currentBranch: status.currentBranch, ownedBranches: status.ownedBranches, clean: null, changes: null };
		try {
			const changes = status.clean ? [] : workingChanges(metadata.worktreePath);
			candidate.git.clean = changes.length === 0; candidate.git.changes = changes;
			if (changes.length) block("dirty");
		} catch (error) { candidate.inspectionComplete = false; block("unresolved-evidence", `Working-tree status unavailable: ${String(error)}`); }
		const operations = (metadata.activeOperations ?? []).map((operation) => {
			const state = operation.hostname !== hostname() ? "foreign-host" : operationIsLive(operation.pid) ? "live" : "interrupted";
			block(state === "live" ? "live-operation" : "uncertain-operation", `Managed operation ${operation.id} (pid ${operation.pid}, ${operation.hostname}): ${state}`);
			return { ...operation, state };
		});
		candidate.activity = latestObservedWork(metadata, status.ownedBranches, now, options.inactiveMs);
		if (!candidate.activity.complete) { candidate.inspectionComplete = false; block("unknown-activity", candidate.activity.problems.join("; ")); }
		else if (!candidate.activity.inactive) block("recent-activity");
		candidate.ignoredData = inspectIgnoredData(root, metadata.worktreePath, config.local_links, config.disposable_paths,
			(path, entries) => report?.(`inspect-metadata-chunk:${slug}`, "completed", `${path}: ${entries} metadata entries scanned so far`));
		if (!candidate.ignoredData.complete) candidate.inspectionComplete = false;
		if (!candidate.ignoredData.safe) block("ignored-local-data", ignoredDataProblem(candidate.ignoredData));
		const stat = lstatSync(metadata.worktreePath);
		if (process.getuid && stat.uid !== process.getuid()) block("other-owner");
		let gitDirectory: string | undefined;
		try {
			gitDirectory = realpathSync(git(metadata.worktreePath, ["rev-parse", "--absolute-git-dir"]));
			try { lstatSync(join(gitDirectory, "locked")); block("worktree-locked"); }
			catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
			if (git(metadata.worktreePath, ["ls-files", "--stage"]).split("\n").some((line) => line.startsWith("160000 "))) block("submodules", "Submodule worktrees require separate review.");
		} catch (error) { candidate.inspectionComplete = false; block("unresolved-evidence", `Native worktree evidence unavailable: ${String(error)}`); }
		// Preview shares one observed process catalogue. Apply captures a fresh
		// one here, after potentially expensive metadata work, for each target.
		const processSnapshot = processes ?? captureProcesses();
		const live = processSnapshot.entries.filter((entry) => entry.path === metadata.worktreePath || entry.path.startsWith(`${metadata.worktreePath}/`));
		candidate.processEvidence = { observedAt: processSnapshot.observedAt, source: processes ? "preview-snapshot" : "apply-recheck", pids: live.map((entry) => entry.pid), operations, ...(processSnapshot.problem ? { problem: processSnapshot.problem } : {}) };
		if (processSnapshot.problem) { candidate.inspectionComplete = false; block("unknown-process-evidence", processSnapshot.problem); }
		if (live.length) block("live-cwd");
		if (!candidate.blockers.length) {
			const branches = Object.fromEntries([...new Set([...status.ownedBranches, status.currentBranch!])].sort()
				.map((branch) => [branch, git(root, ["rev-parse", "--verify", `refs/heads/${branch}`])]));
			const snapshot = { slug, worktreePath: metadata.worktreePath, metadataHash: metadataHash(root, slug, sharedContext?.commonDirectory), branches };
			const fingerprint = hash(JSON.stringify([
				snapshot, identity(metadata.worktreePath), gitDirectory, identity(gitDirectory!),
				git(metadata.worktreePath, ["rev-parse", "--verify", "HEAD"]), candidate.activity, candidate.ignoredData,
			]));
			candidate.snapshot = { ...snapshot, fingerprint };
		}
	} catch (error) { candidate.inspectionComplete = false; block("unresolved-evidence", String(error)); }
	return finish();
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
	const report = progressReporter("batch finish", options.json);
	if (options.dryRun) {
		const config = loadConfig(root);
		const observedAt = new Date().toISOString();
		const slugs = [...new Set([...metadataSlugs(root), ...discoverManagedWorktrees(root, config).keys(), ...options.exclusions])].sort();
		const context = snapshotExactResources(root);
		report("preview-process-snapshot", "started");
		const processes = captureProcesses();
		report("preview-process-snapshot", processes.problem ? "failed" : "completed", processes.problem);
		const candidates = slugs.map((slug, index) => {
			report(`inspect:${slug}`, "started", `${index + 1}/${slugs.length}`);
			const candidate = inspectCandidate(root, invocationRoot, slug, options, Date.parse(observedAt), processes, report, context);
			report(`inspect:${slug}`, "completed", `${candidate.reason}; ${candidate.blockers.length} blocker(s)`);
			return candidate;
		});
		const receipt = encodeReceipt({ version: 1, rootKey: rootKey(root), observedAt, inactiveMs: options.inactiveMs,
			exclusions: options.exclusions, keepBranch: true, targets: candidates.flatMap((candidate) => candidate.snapshot ? [candidate.snapshot] : []) });
		const resources = candidates.map(({ snapshot, ...candidate }) => ({ ...candidate, keepBranch: true, allBranchesPreserved: true, ...(snapshot ? { fingerprint: snapshot.fingerprint } : {}) }));
		writeCommandResult({ version: 1, command: "batch finish", dryRun: true, inactiveFor: options.inactiveFor,
			observedAt, cutoff: new Date(Date.parse(observedAt) - options.inactiveMs).toISOString(),
			keepBranch: true, remoteAssetsModified: false, exclusions: options.exclusions, resources, receipt,
			processSnapshot: { observedAt: processes.observedAt, complete: !processes.problem, entries: processes.entries.length, ...(processes.problem ? { problem: processes.problem } : {}) },
			limitations: [
				"Observed inactivity is not proof of disposability; explicitly exclude retained or otherwise active work.",
				"Managed launch/resume/run record start and completion; interrupted activity records refuse eligibility.",
				"Unmanaged evidence covers checkout/owned-branch reflogs and current non-ignored file mtimes, not a complete history.",
				"Process evidence covers same-user cwd, not editors elsewhere, other users or remote processes.",
				"Restored timestamps and expired reflogs can hide activity; unapproved ignored local data is refused.",
				"Ignored sizes are metadata-only footprint observations, not reclaimable-space guarantees. Symlink targets and filesystem boundaries are not traversed.",
				"Byte totals count unique inodes within each reported path, not across separate paths/worktrees. Incomplete scans are explicit and block eligibility.",
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
				report(`apply:${target.slug}`, "started");
				const operate = (): Outcome => {
					try {
						const context = snapshotExactResources(root);
						const exact = inspectExactResource(root, target.worktreePath, context);
						if (exact.resourceState === "absent") return { ...base, outcome: "absent", reason: "confirmed-absence" };
						if (journal.started(target) && residualRecord(root, target, exact)) return completeRemoval(root, target, true);
						report(`recheck:${target.slug}`, "started");
						const candidate = inspectCandidate(root, invocationRoot, target.slug, options, Date.now(), undefined, report, context);
						report(`recheck:${target.slug}`, "completed", candidate.reason);
						const { snapshot: _snapshot, ...inspection } = candidate;
						if (candidate.reason !== "eligible") return { ...base, outcome: "refused", reason: candidate.reason, problem: candidate.problem, inspection };
						if (candidate.snapshot?.fingerprint !== target.fingerprint || candidate.worktreePath !== target.worktreePath) return { ...base, outcome: "refused", reason: "changed-since-preview", inspection };
						journal.start(target);
						const removed = run("git", ["worktree", "remove", "--", target.worktreePath], root);
						if (removed.status !== 0) return { ...base, outcome: "uncertain", reason: "native-removal-unconfirmed", problem: removed.stderr };
						return completeRemoval(root, target, false);
					} catch (error) { return { ...base, outcome: "uncertain", reason: "inspection-or-cleanup-failed", problem: String(error) }; }
				};
				const outcome = operate();
				report(`apply:${target.slug}`, outcome.outcome === "refused" ? "skipped" : outcome.outcome === "uncertain" ? "failed" : "completed", outcome.reason);
				return outcome;
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
