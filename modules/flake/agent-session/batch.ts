import { createHash } from "node:crypto";
import { sessionCommand } from "./arguments.ts";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertPrimaryCheckout, commonGitDirectory, ensureClean, git, gitRaw } from "./git.ts";
import { inspectExactResource, snapshotExactResources, sessionActivityTree, type ExactInspectionContext } from "./inspection.ts";
import { inspectIgnoredData, ignoredDataProblem, type IgnoredDataInspection } from "./artifacts.ts";
import {
	assertConfiguredWorktreePath, discoverManagedWorktrees, loadConfig,
	metadataPath, metadataSlugs, readMetadata, validateSlug, withOperationLock, inspectActiveOperation,
} from "./sessions.ts";
import { CliError, progressReporter, run, withInspection, writeCommandResult, type InspectionProgress } from "./runtime.ts";
import { BatchOutput } from "./batch-output.ts";
import { BatchPreview } from "./batch-preview.ts";
import type { BatchFinishOptions, ProgressReporter, SessionMetadata } from "./types.ts";

export interface Target {
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

export interface Candidate {
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

export interface Outcome {
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

function completeActivity(evidence: ActivityEvidence, now: number, inactiveMs: number): ActivityEvidence {
	for (const observation of evidence.observations) {
		if (!evidence.lastWorkAt || Date.parse(observation.timestamp) > Date.parse(evidence.lastWorkAt)) {
			evidence.lastWorkAt = observation.timestamp; evidence.limitingEvidence = observation.source;
		}
	}
	evidence.complete = evidence.problems.length === 0 && evidence.lastWorkAt !== null;
	evidence.inactive = evidence.complete ? Date.parse(evidence.lastWorkAt!) <= now - inactiveMs : null;
	return evidence;
}

interface ActivityProjection {
	nodes: Map<string, ReturnType<typeof sessionActivityTree>[number]>;
	problem?: string;
}

// A preview shares one immutable catalogue; each apply target gets a fresh one.
// Cache only on that snapshot, never across lifecycle effects or invocations.
const activityProjections = new WeakMap<ExactInspectionContext, ActivityProjection>();
function activityProjection(context: ExactInspectionContext): ActivityProjection {
	const cached = activityProjections.get(context);
	if (cached) return cached;
	const projection: ActivityProjection = { nodes: new Map() };
	try {
		if (context.problem) throw new CliError(context.problem);
		for (const node of sessionActivityTree([...context.recordsBySlug.values()])) projection.nodes.set(node.metadata.slug, node);
	} catch (error) { projection.problem = String(error); }
	activityProjections.set(context, projection);
	return projection;
}

function listedActivity(root: string, metadata: SessionMetadata, now: number, inactiveMs: number, context?: ExactInspectionContext): ActivityEvidence {
	const projection = activityProjection(context ?? snapshotExactResources(root));
	const node = projection.nodes.get(metadata.slug), own = node?.metadata ?? metadata;
	const evidence: ActivityEvidence = {
		lastWorkAt: null, limitingEvidence: null, filesChecked: 0, complete: true, inactive: null, problems: [], observations: [],
		sources: ["creation", ...(own.lastWorkAt ? ["managed-work"] : []), "creator-subtree"],
	};
	const observe = (source: string, timestamp: number) => {
		if (!Number.isFinite(timestamp)) { evidence.problems.push(`Invalid timestamp: ${source}`); return; }
		evidence.observations.push({ source, timestamp: new Date(timestamp).toISOString() });
	};
	observe("creation", Date.parse(own.createdAt));
	if (own.lastWorkAt) observe("managed-work", Date.parse(own.lastWorkAt));
	if (projection.problem) evidence.problems.push(projection.problem);
	else if (!node?.complete) evidence.problems.push(`Incomplete activity in creator subtree of ${metadata.slug}.`);
	if (node && node.limitingSlug !== metadata.slug) observe(`descendant:${node.limitingSlug}`, node.activity);
	return completeActivity(evidence, now, inactiveMs);
}

// Explicit non-age cleanup retains its existing conservative inspection evidence.
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
	return completeActivity(evidence, now, inactiveMs);
}

export function captureProcesses(): ProcessSnapshot {
	const observedAt = new Date().toISOString();
	try { return { observedAt, entries: processDirectories() }; }
	catch (error) { return { observedAt, entries: [], problem: String(error) }; }
}

// Shared by batch and single-session non-forced cleanup. Every unsettled
// operation blocks: PID absence means interruption, not successful completion.
export function inspectWorktreeActivity(metadata: SessionMetadata, snapshot = captureProcesses()) {
	const blockers: Candidate["blockers"] = [];
	const operations = (metadata.activeOperations ?? []).map((operation) => {
		const observation = inspectActiveOperation(operation);
		blockers.push({ reason: observation.state === "live" ? "live-operation" : "uncertain-operation",
			problem: `Managed operation ${operation.id} (pid ${operation.pid}, ${operation.hostname}): ${observation.state}${observation.problem ? ` (${observation.problem})` : ""}${observation.state === "interrupted" ? `; review with ${sessionCommand(metadata.slug, "activity reconcile")}` : ""}` });
		return { ...operation, ...observation };
	});
	const pids = snapshot.entries.filter((entry) => entry.path === metadata.worktreePath || entry.path.startsWith(`${metadata.worktreePath}/`)).map((entry) => entry.pid);
	if (snapshot.problem) blockers.push({ reason: "unknown-process-evidence", problem: snapshot.problem });
	if (pids.length) blockers.push({ reason: "live-cwd" });
	return { snapshot, operations, pids, blockers };
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

export function rootKey(root: string): string {
	const common = commonGitDirectory(root);
	return hash(JSON.stringify([root, identity(root), common, identity(common), loadConfig(root)]));
}

function metadataHash(root: string, slug: string, commonDirectory?: string): string {
	const path = commonDirectory ? join(commonDirectory, "agent-session", "sessions", `${slug}.json`) : metadataPath(root, slug);
	return hash(readFileSync(path, "utf8"));
}

export function inspectCandidate(root: string, invocationRoot: string, slug: string, options: BatchFinishOptions,
	now = Date.now(), processes?: ProcessSnapshot, report?: ProgressReporter, sharedContext?: ExactInspectionContext, requireInactivity = true, branchScope: "owned" | "worktree-history" = "owned"): Candidate {
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
		const status = exact.sessions[0];
		// Historical selection does not manufacture branch ownership. It permits
		// review of a different checked-out branch only after proving the same
		// uniquely bound native worktree. Every other resource/activity guard stays.
		const reviewedConflict = branchScope === "worktree-history" && status?.state === "conflict" && status.currentBranch &&
			exact.bindingSlugs.length === 1 && exact.bindingSlugs[0] === slug &&
			exact.evidence.registered === true && exact.evidence.filesystem === "present" &&
			realpathSync(git(metadata.worktreePath, ["rev-parse", "--show-toplevel"])) === metadata.worktreePath;
		if (exact.resourceState !== "present" && !reviewedConflict) block("unresolved-resource", exact.problem);
		// A returned session proves the physical checkout identity, even when its
		// current branch conflicts. Without it, do not inspect an unsafe path.
		if (!status) { candidate.inspectionComplete = false; return finish(); }
		candidate.git = { state: status.state, currentBranch: status.currentBranch, ownedBranches: status.ownedBranches, clean: null, changes: null };
		try {
			const changes = status.clean ? [] : workingChanges(metadata.worktreePath);
			candidate.git.clean = changes.length === 0; candidate.git.changes = changes;
			if (changes.length) block("dirty");
		} catch (error) { candidate.inspectionComplete = false; block("unresolved-evidence", `Working-tree status unavailable: ${String(error)}`); }
		candidate.activity = requireInactivity ? listedActivity(root, metadata, now, options.inactiveMs, sharedContext)
			: latestObservedWork(metadata, status.ownedBranches, now, options.inactiveMs);
		if (!candidate.activity.complete) { candidate.inspectionComplete = false; block("unknown-activity", candidate.activity.problems.join("; ")); }
		else if (requireInactivity && !candidate.activity.inactive) block("recent-activity");
		candidate.ignoredData = inspectIgnoredData(root, metadata.worktreePath, config.local_links, config.disposable_paths,
			(path, entries) => report?.(`inspect-metadata-chunk:${slug}`, "completed", `${path}: ${entries} metadata entries scanned so far`), config.generated_links);
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
		const activity = inspectWorktreeActivity(metadata, processes);
		candidate.processEvidence = { observedAt: activity.snapshot.observedAt, source: processes ? "preview-snapshot" : "apply-recheck", pids: activity.pids, operations: activity.operations, ...(activity.snapshot.problem ? { problem: activity.snapshot.problem } : {}) };
		if (activity.snapshot.problem) candidate.inspectionComplete = false;
		for (const blocker of activity.blockers) block(blocker.reason, blocker.problem);
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

export function journalStore(root: string, receipt: Pick<Receipt, "targets">, token: string) {
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

export function residualRecord(root: string, target: Target, exact: ReturnType<typeof inspectExactResource>): boolean {
	return exact.resourceState === "inconsistent" && exact.evidence.filesystem === "absent" && exact.evidence.registered === false &&
		exact.bindingSlugs.length === 1 && exact.bindingSlugs[0] === target.slug && metadataHash(root, target.slug) === target.metadataHash &&
		readMetadata(root, target.slug).worktreePath === target.worktreePath;
}

export function completeRemoval(root: string, target: Target, reconciled: boolean): Outcome {
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
	if (!options.dryRun) return withInspection("Checking approved cleanup", options.json, options, (progress) => applyBatch(root, invocationRoot, options, progress));
	const report = progressReporter("batch finish", options.json, options.dryRun);
	if (options.dryRun) {
		const observedAt = new Date().toISOString();
		const display = options.json ? undefined : new BatchPreview([], options.inactiveFor, Date.parse(observedAt), options.color, options.verbose);
		// Announce before discovery, not after the shared namespace and activity
		// snapshots have already been collected. JSON event sequences stay intact.
		if (display && !display.live) process.stderr.write("Inspecting worktrees...\n");
		const { slugs, context, entries } = (() => {
			display?.discover();
			try {
				const config = loadConfig(root);
				const slugs = [...new Set([...metadataSlugs(root), ...discoverManagedWorktrees(root, config).keys(), ...options.exclusions])].sort();
				const context = snapshotExactResources(root);
				const projection = activityProjection(context);
				const entries = [...projection.nodes.values()].map((node) => ({ slug: node.metadata.slug, label: node.prefix + node.metadata.slug, activity: node.activity }));
				const displayed = new Set(entries.map((entry) => entry.slug));
				for (const slug of slugs) if (!displayed.has(slug)) entries.push({ slug, label: slug, activity: NaN });
				return { slugs, context, entries };
			} catch (error) { display?.abort(); throw error; }
		})();
		const previewReport: ProgressReporter = options.json ? report : (phase, status, detail) => {
			if (!display?.live && status === "failed") report(phase, status, detail);
		};
		let processes: ProcessSnapshot;
		let candidates: Candidate[];
		try {
			display?.sessions(entries);
			previewReport("preview-process-snapshot", "started");
			processes = captureProcesses();
			previewReport("preview-process-snapshot", processes.problem ? "failed" : "completed", processes.problem);
			candidates = slugs.map((slug, index) => {
				display?.checkingSession(slug);
				previewReport(`inspect:${slug}`, "started", `${index + 1}/${slugs.length}`);
				const candidate = inspectCandidate(root, invocationRoot, slug, options, Date.parse(observedAt), processes, previewReport, context);
				previewReport(`inspect:${slug}`, "completed", `${candidate.reason}; ${candidate.blockers.length} blocker(s)`);
				display?.complete(candidate);
				return candidate;
			});
		} catch (error) { display?.abort(); throw error; }
		report.flush?.();
		// This independent batch is not recursive finish. Ancestors precede
		// selected descendants so our own approved removals cannot change an
		// ancestor's activity fingerprint before its apply recheck.
		const ranks = new Map([...activityProjection(context).nodes.keys()].map((slug, index) => [slug, index]));
		const targets = candidates.flatMap((candidate) => candidate.snapshot ? [candidate.snapshot] : [])
			.sort((a, b) => (ranks.get(a.slug) ?? Infinity) - (ranks.get(b.slug) ?? Infinity));
		const receipt = encodeReceipt({ version: 1, rootKey: rootKey(root), observedAt, inactiveMs: options.inactiveMs,
			exclusions: options.exclusions, keepBranch: true, targets });
		const resources = candidates.map(({ snapshot, ...candidate }) => ({ ...candidate, keepBranch: true, allBranchesPreserved: true, ...(snapshot ? { fingerprint: snapshot.fingerprint } : {}) }));
		writeCommandResult({ version: 1, command: "batch finish", dryRun: true, inactiveFor: options.inactiveFor,
			observedAt, cutoff: new Date(Date.parse(observedAt) - options.inactiveMs).toISOString(),
			keepBranch: true, remoteAssetsModified: false, exclusions: options.exclusions, resources, receipt,
			processSnapshot: { observedAt: processes.observedAt, complete: !processes.problem, entries: processes.entries.length, ...(processes.problem ? { problem: processes.problem } : {}) },
			limitations: [
				"Observed inactivity is not proof of disposability; explicitly exclude retained or otherwise active work.",
				"Managed launch/resume/run record start and completion; interrupted activity records refuse eligibility.",
				"The inactivity clock matches list: creation/managed engagement rolled up through the recorded creator subtree, including excluded descendants.",
				"Process evidence covers same-user cwd, not editors elsewhere, other users or remote processes.",
				"Unrecorded edits and checkout events do not advance this clock; dirty work and unapproved ignored local data are independently refused.",
				"Ignored sizes are metadata-only footprint observations, not reclaimable-space guarantees. Symlink targets and filesystem boundaries are not traversed.",
				"Byte totals count unique inodes within each reported path, not across separate paths/worktrees. Incomplete scans are explicit and block eligibility.",
			],
		}, options.json, display?.finish() ?? "");
		return 0;
	}
	return 0;
}

function applyBatch(root: string, invocationRoot: string, options: BatchFinishOptions, progress: InspectionProgress): number {
	if (options.verbose) progress.flush();
	const report: ProgressReporter = options.json || options.verbose ? progressReporter("batch finish", options.json) : () => {};
	const receipt = decodeReceipt(root, options);
	const display = options.json ? undefined : new BatchOutput(receipt.targets, options);
	progress.flush(); display?.start();
	let resources: Outcome[];
	try {
		resources = withOperationLock(root, "batch finish", () => {
			assertPrimaryCheckout(root);
			ensureClean(root, true);
			const journal = journalStore(root, receipt, options.expected!);
			return receipt.targets.map((target): Outcome => {
				const base = { slug: target.slug, worktreePath: target.worktreePath };
				report(`apply:${target.slug}`, "started");
				display?.checking(target.slug);
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
						display?.removing(target.slug);
						const removed = run("git", ["worktree", "remove", "--", target.worktreePath], root);
						if (removed.status !== 0) return { ...base, outcome: "uncertain", reason: "native-removal-unconfirmed", problem: [removed.stdout, removed.stderr, removed.errorCode].filter(Boolean).join("\n") };
						return completeRemoval(root, target, false);
					} catch (error) { return { ...base, outcome: "uncertain", reason: "inspection-or-cleanup-failed", problem: String(error) }; }
				};
				const outcome = operate();
				report(`apply:${target.slug}`, outcome.outcome === "refused" ? "skipped" : outcome.outcome === "uncertain" ? "failed" : "completed", outcome.reason);
				display?.complete(outcome);
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
		display?.finish(resources) ?? "");
	return success ? 0 : 1;
}
