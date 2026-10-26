import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import {
	commonGitDirectory,
	git,
	primaryRoot,
	repositoryRoot,
	worktreeIsRegistered,
} from "./git.ts";
import { CliError, run } from "./runtime.ts";
import { validPullRequest } from "./github.ts";
import type {
	AgentSessionConfig,
	SessionMetadata,
	OperationLock,
	ManagedWorktree,
} from "./types.ts";

function stringArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new CliError(
			`Invalid devenv module configuration: ${field} must be an array of strings.`,
		);
	}
	return value as string[];
}

export function loadConfig(_root: string): AgentSessionConfig {
	const path = process.env.AGENT_SESSION_CONFIG;
	if (!path) {
		throw new CliError(
			"Missing devenv module configuration for agent-session.",
		);
	}
	let raw: Record<string, unknown>;
	try {
		raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	} catch (error) {
		throw new CliError(
			`Could not parse devenv module configuration: ${String(error)}`,
		);
	}
	if (raw.version !== 1 || typeof raw.worktree_root !== "string") {
		throw new CliError(
			"Invalid devenv module configuration: expected version 1 and worktree_root.",
		);
	}
	return {
		version: 1,
		worktree_root: raw.worktree_root,
		agent_command: stringArray(raw.agent_command, "agent_command"),
		prepare_command: stringArray(raw.prepare_command, "prepare_command"),
		local_links: stringArray(raw.local_links, "local_links"),
	};
}

export function validateSlug(slug: string): void {
	if (
		!slug ||
		!/^[a-z0-9][a-z0-9.-]*$/.test(slug) ||
		slug.includes("..") ||
		slug.includes("--")
	) {
		throw new CliError(
			"Use lowercase letters, numbers, dots, or dashes in the task slug.",
			64,
		);
	}
}

function operationLockDirectory(root: string): string {
	return join(commonGitDirectory(root), "agent-session", "operation.lock");
}

export function readOperationLock(root: string): OperationLock | undefined {
	const path = join(operationLockDirectory(root), "owner.json");
	if (!existsSync(path)) return undefined;
	try {
		const value = JSON.parse(
			readFileSync(path, "utf8"),
		) as Partial<OperationLock>;
		if (
			typeof value.pid === "number" &&
			typeof value.command === "string" &&
			typeof value.createdAt === "string"
		) {
			return value as OperationLock;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function processIsAlive(pid: number): boolean {
	if (!Number.isSafeInteger(pid) || pid <= 0) return true;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function acquireOperationLock(root: string, command: string): () => void {
	const directory = operationLockDirectory(root);
	mkdirSync(dirname(directory), { recursive: true });
	try {
		mkdirSync(directory);
	} catch {
		const owner = readOperationLock(root);
		if (!owner || processIsAlive(owner.pid)) {
			const detail = owner
				? `${owner.command} (pid ${owner.pid})`
				: "unknown owner";
			throw new CliError(
				`Another agent-session operation is active: ${detail}.`,
			);
		}
		rmSync(directory, { recursive: true, force: true });
		try {
			mkdirSync(directory);
		} catch {
			throw new CliError("Another agent-session operation acquired the lock.");
		}
	}
	const owner: OperationLock = {
		pid: process.pid,
		command,
		createdAt: new Date().toISOString(),
	};
	writeFileSync(join(directory, "owner.json"), `${JSON.stringify(owner)}\n`);
	return () => rmSync(directory, { recursive: true, force: true });
}

export function withOperationLock<T>(
	root: string,
	command: string,
	operation: () => T,
): T {
	const release = acquireOperationLock(root, command);
	try {
		return operation();
	} finally {
		release();
	}
}

function sessionsDirectory(root: string): string {
	return join(commonGitDirectory(root), "agent-session", "sessions");
}

export function metadataPath(root: string, slug: string): string {
	return join(sessionsDirectory(root), `${slug}.json`);
}

export function writeMetadata(root: string, metadata: SessionMetadata): void {
	const statePath = metadataPath(root, metadata.slug);
	const temporaryState = `${statePath}.tmp.${process.pid}`;
	mkdirSync(sessionsDirectory(root), { recursive: true });
	try {
		writeFileSync(temporaryState, `${JSON.stringify(metadata, null, 2)}\n`);
		renameSync(temporaryState, statePath);
	} finally {
		rmSync(temporaryState, { force: true });
	}
}

export function readMetadata(root: string, slug: string): SessionMetadata {
	return readSessionMetadata(root, slug, primaryRoot(root));
}

export function readMetadataInventory(root: string): SessionMetadata[] {
	// Repository topology is shared across this inventory, not a per-record probe.
	const primary = primaryRoot(root), directory = sessionsDirectory(root);
	return metadataSlugs(root).map((slug) =>
		readSessionMetadata(root, slug, primary, join(directory, `${slug}.json`)));
}

function readSessionMetadata(root: string, slug: string, primary: string, path = metadataPath(root, slug)): SessionMetadata {
	if (!existsSync(path)) throw new CliError(`No managed session: ${slug}`);
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new CliError(
			`Cannot read session metadata for ${slug}: ${String(error)}`,
		);
	}
	const metadata = value as Partial<SessionMetadata>;
	if (
		(metadata.version !== 1 && metadata.version !== 2) ||
		(metadata.version === 2 ? metadata.initialBranchOwned !== false : metadata.initialBranchOwned === false) ||
		metadata.slug !== slug ||
		typeof metadata.branch !== "string" ||
		typeof metadata.worktreePath !== "string" ||
		typeof metadata.remote !== "string" ||
		typeof metadata.defaultBranch !== "string" ||
		typeof metadata.createdAt !== "string" ||
		(metadata.lastWorkAt !== undefined && (typeof metadata.lastWorkAt !== "string" || !Number.isFinite(Date.parse(metadata.lastWorkAt)))) ||
		(metadata.activeOperations !== undefined &&
			(!Array.isArray(metadata.activeOperations) || metadata.activeOperations.some((operation) =>
				!operation || typeof operation.id !== "string" || !Number.isSafeInteger(operation.pid) || operation.pid <= 0 ||
				typeof operation.hostname !== "string" || typeof operation.startedAt !== "string" || !Number.isFinite(Date.parse(operation.startedAt))))) ||
		(metadata.initialBranchOwned !== undefined && typeof metadata.initialBranchOwned !== "boolean") ||
		(metadata.preexistingBranches !== undefined &&
			(!Array.isArray(metadata.preexistingBranches) ||
				metadata.preexistingBranches.some(
					(branch) => typeof branch !== "string",
				)))
	) {
		throw new CliError(`Invalid session metadata for ${slug}.`);
	}
	const canonicalWorktree = existsSync(metadata.worktreePath)
		? realpathSync(metadata.worktreePath)
		: resolve(metadata.worktreePath);
	if (
		(metadata.pr !== undefined
			? !validPullRequest(metadata.pr) ||
				metadata.branch !== (metadata.pr.mode === "independent" ? `agent/${slug}` : metadata.pr.headBranch) ||
				run("git", ["check-ref-format", "--branch", metadata.branch], root).status !== 0
			: metadata.branch !== `agent/${slug}`) ||
		(metadata.initialBranchOwned === false &&
			(metadata.pr?.mode !== "review" || !metadata.preexistingBranches?.includes(metadata.branch))) ||
		!isAbsolute(metadata.worktreePath) ||
		canonicalWorktree === primary
	) {
		throw new CliError(`Unsafe session metadata for ${slug}.`);
	}
	return metadata as SessionMetadata;
}

// Hold the global lock only while updating evidence, never while work runs.
// A crashed or interrupted owner leaves a lease: polling must not erase it or
// invent a completion time. Preview refuses such uncertain activity evidence.
export function withSessionActivity<T>(root: string, slug: string, work: () => T): T {
	const operation = { id: randomUUID(), pid: process.pid, hostname: hostname(), startedAt: new Date().toISOString() };
	withOperationLock(root, "activity-start", () => {
		const metadata = readMetadata(root, slug);
		writeMetadata(root, {
			...metadata,
			lastWorkAt: operation.startedAt,
			activeOperations: [...(metadata.activeOperations ?? []), operation],
		});
	});
	try { return work(); }
	finally {
		withOperationLock(root, "activity-end", () => {
			const metadata = readMetadata(root, slug);
			writeMetadata(root, {
				...metadata,
				lastWorkAt: new Date().toISOString(),
				activeOperations: (metadata.activeOperations ?? []).filter((entry) => entry.id !== operation.id),
			});
		});
	}
}

export function metadataSlugs(root: string): string[] {
	const directory = sessionsDirectory(root);
	try {
		return readdirSync(directory)
			.filter((name) => name.endsWith(".json"))
			.sort()
			.map((name) => name.slice(0, -".json".length));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		// ENOENT through a dangling store is not a complete empty inventory.
		assertMetadataStore(root);
		return [];
	}
}

export function resolveWorktreeRoot(root: string, configured: string): string {
	if (
		isAbsolute(configured) ||
		configured.split("/").includes("..") ||
		configured === "." ||
		configured === ""
	) {
		throw new CliError(
			"agentSession.worktreeRoot must be a project-local relative subtree.",
		);
	}
	const worktreeRoot = resolve(root, configured);
	if (!worktreeRoot.startsWith(`${root}/`)) {
		throw new CliError(
			"agentSession.worktreeRoot must remain inside the primary checkout.",
		);
	}
	return worktreeRoot;
}

export function discoverManagedWorktrees(
	root: string,
	config: AgentSessionConfig,
): Map<string, ManagedWorktree> {
	const configuredRoot = resolveWorktreeRoot(root, config.worktree_root);
	const canonicalRoot = existsSync(configuredRoot)
		? realpathSync(configuredRoot)
		: configuredRoot;
	const discovered = new Map<string, ManagedWorktree>();
	for (const record of git(root, ["worktree", "list", "--porcelain"]).split(
		/\n\n+/,
	)) {
		const path = record
			.split("\n")
			.find((line) => line.startsWith("worktree "))
			?.slice("worktree ".length);
		const branchRef = record
			.split("\n")
			.find((line) => line.startsWith("branch refs/heads/"));
		const branch = branchRef?.slice("branch refs/heads/".length);
		if (!path || !branch?.startsWith("agent/")) continue;
		const slug = branch.slice("agent/".length);
		try {
			validateSlug(slug);
		} catch {
			continue;
		}
		const canonicalPath = existsSync(path) ? realpathSync(path) : resolve(path);
		if (canonicalPath !== join(canonicalRoot, slug)) continue;
		discovered.set(slug, {
			slug,
			branch,
			worktreePath: canonicalPath,
		});
	}
	return discovered;
}

export function assertConfiguredWorktreePath(
	root: string,
	config: AgentSessionConfig,
	metadata: SessionMetadata,
): void {
	const configuredRoot = resolveWorktreeRoot(root, config.worktree_root);
	const canonicalRoot = existsSync(configuredRoot)
		? realpathSync(configuredRoot)
		: configuredRoot;
	const expectedPath = join(canonicalRoot, metadata.slug);
	if (metadata.worktreePath !== expectedPath) {
		throw new CliError(`Unsafe session metadata for ${metadata.slug}.`);
	}
}

// ENOENT through a dangling store symlink is not a missing record.
function assertMetadataStore(root: string): void {
	const store = sessionsDirectory(root);
	for (const directory of [store, dirname(store)]) {
		try {
			const stat = lstatSync(directory);
			if (stat.isSymbolicLink() ? !existsSync(directory) : !stat.isDirectory()) throw new CliError("Invalid metadata store.");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new CliError("Cannot establish session metadata-store availability.");
		}
	}
}

// A dangling record or inaccessible metadata store is not evidence of absence.
export function sessionRecordExists(root: string, slug: string): boolean {
	validateSlug(slug);
	const path = metadataPath(root, slug);
	try { lstatSync(path); return true; } catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new CliError(`Cannot establish session-record absence for ${slug}.`);
	}
	assertMetadataStore(root);
	return false;
}

export interface UnrecordedWorktree {
	slug: string;
	worktreePath: string;
	currentBranch: string | null;
	head: string;
	gitDirectory: string;
	device: string;
	inode: string;
}

// Local topology identifies a retirement target, never session-owned branches.
export function unrecordedWorktree(root: string, slug: string): UnrecordedWorktree {
	validateSlug(slug);
	if (sessionRecordExists(root, slug)) throw new CliError(`Session metadata exists for ${slug}; unrecorded cleanup is refused.`);
	const config = loadConfig(root);
	const configured = resolveWorktreeRoot(root, config.worktree_root);
	if (run("git", ["check-ignore", "--quiet", "--no-index", "--", `${config.worktree_root}/.agent-session-probe`], root).status !== 0) {
		throw new CliError("Unrecorded cleanup requires a Git-ignored configured worktree root.");
	}
	const path = join(realpathSync(configured), slug);
	const stat = lstatSync(path, { bigint: true });
	if (
		!stat.isDirectory() || realpathSync(path) !== path || path === primaryRoot(root) ||
		!worktreeIsRegistered(root, path) || repositoryRoot(path) !== path ||
		commonGitDirectory(path) !== commonGitDirectory(root)
	) throw new CliError(`No valid registered worktree in the configured slot for ${slug}.`);
	const gitDirectory = realpathSync(git(path, ["rev-parse", "--absolute-git-dir"]));
	if (existsSync(join(gitDirectory, "locked"))) throw new CliError(`Registered worktree ${slug} is locked; cleanup is refused.`);
	const branch = git(path, ["branch", "--show-current"]) || null;
	return { slug, worktreePath: path, currentBranch: branch, head: git(path, ["rev-parse", "--verify", "HEAD"]), gitDirectory, device: stat.dev.toString(), inode: stat.ino.toString() };
}

// The directory name supplies only a candidate: persisted metadata, configured
// location and Git registration must all agree before it becomes a target.
export function resolveSessionTarget(target: string, cwd = process.cwd()): string {
	if (target !== ".") return target;
	const current = repositoryRoot(cwd);
	const root = primaryRoot(current);
	if (current === root) {
		throw new CliError("The primary checkout has no current managed session; use an explicit slug.");
	}
	const slug = basename(current);
	try {
		validateSlug(slug);
	} catch {
		throw new CliError("Current worktree is not a managed session; use an explicit slug.");
	}
	if (!existsSync(metadataPath(root, slug))) {
		throw new CliError("Current worktree has no recorded managed session; use an explicit slug to inspect or repair it.");
	}
	if (sessionDirectory(root, slug) !== current) {
		throw new CliError("Current worktree does not match a recorded managed session; use an explicit slug.");
	}
	return slug;
}

// Navigation and ad-hoc commands inspect only local Git evidence. Unlike launch,
// they neither fetch nor require the primary checkout or session to be clean.
export function sessionDirectory(root: string, slug: string): string {
	validateSlug(slug);
	const config = loadConfig(root);
	const metadata = readMetadata(root, slug);
	assertConfiguredWorktreePath(root, config, metadata);
	if (!existsSync(metadata.worktreePath)) {
		throw new CliError(`Managed worktree is missing for session ${slug}.`);
	}
	const path = realpathSync(metadata.worktreePath);
	if (
		path !== metadata.worktreePath ||
		!worktreeIsRegistered(root, path) ||
		repositoryRoot(path) !== path ||
		commonGitDirectory(path) !== commonGitDirectory(root)
	) {
		throw new CliError(`Managed worktree is invalid for session ${slug}.`);
	}
	return path;
}
