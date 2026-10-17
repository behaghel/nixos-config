#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { constants } from "node:os";

interface AgentSessionConfig {
	version: number;
	worktree_root: string;
	agent_command: string[];
	prepare_command: string[];
	local_links: string[];
}

interface SessionMetadata {
	version: 1;
	slug: string;
	branch: string;
	worktreePath: string;
	remote: string;
	defaultBranch: string;
	createdAt: string;
	conversation: null;
	preexistingBranches?: string[];
}

interface OperationLock {
	pid: number;
	command: string;
	createdAt: string;
}

interface SessionStatus extends SessionMetadata {
	initialBranch: string;
	currentBranch: string | null;
	ownedBranches: string[];
	state:
		| "ready"
		| "dirty"
		| "stale"
		| "dirty-stale"
		| "orphaned"
		| "unrecorded"
		| "conflict"
		| "broken";
	clean: boolean;
	fresh: boolean;
	publication: "unpublished" | "unpushed" | "behind" | "diverged" | "published";
	ahead: number;
	behind: number;
	problem?: string;
}

class CliError extends Error {
	readonly exitCode: number;

	constructor(message: string, exitCode = 1) {
		super(message);
		this.exitCode = exitCode;
	}
}

type ProgressStatus = "started" | "completed" | "failed" | "skipped";
type ProgressReporter = (
	phase: string,
	status: ProgressStatus,
	detail?: string,
) => void;

function progressReporter(command: string, json: boolean): ProgressReporter {
	return (phase, status, detail) => {
		if (json) {
			process.stderr.write(
				`${JSON.stringify({ version: 1, type: "progress", command, phase, status, ...(detail ? { detail } : {}) })}\n`,
			);
			return;
		}
		const suffix = detail ? `: ${detail}` : "";
		process.stderr.write(
			`[agent-session] ${status.toUpperCase()} ${phase}${suffix}\n`,
		);
	};
}

function runPhase<T>(
	report: ProgressReporter,
	phase: string,
	operation: () => T,
): T {
	report(phase, "started");
	try {
		const result = operation();
		report(phase, "completed");
		return result;
	} catch (error) {
		report(
			phase,
			"failed",
			error instanceof Error ? error.message : String(error),
		);
		throw error;
	}
}

function writeCommandResult(value: unknown, json: boolean, text: string): void {
	process.stdout.write(json ? `${JSON.stringify(value)}\n` : text);
}

function run(
	command: string,
	args: string[],
	cwd: string,
	stdio: "pipe" | "inherit" = "pipe",
	environment: NodeJS.ProcessEnv = process.env,
): { status: number; stdout: string; stderr: string } {
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		stdio,
		env: environment,
	});
	return {
		status: result.status ?? 1,
		stdout: typeof result.stdout === "string" ? result.stdout.trim() : "",
		stderr: typeof result.stderr === "string" ? result.stderr.trim() : "",
	};
}

function git(cwd: string, args: string[]): string {
	const result = run("git", args, cwd);
	if (result.status !== 0) {
		throw new CliError(result.stderr || `git ${args.join(" ")} failed`);
	}
	return result.stdout;
}

function repositoryRoot(cwd = process.cwd()): string {
	const result = run("git", ["rev-parse", "--show-toplevel"], cwd);
	if (result.status !== 0) {
		throw new CliError("agent-session must run inside a Git worktree.", 64);
	}
	return realpathSync(result.stdout);
}

function primaryRoot(root: string): string {
	const worktrees = git(root, ["worktree", "list", "--porcelain"]);
	const first = worktrees
		.split("\n")
		.find((line) => line.startsWith("worktree "));
	if (!first) throw new CliError("Git did not report a primary worktree.");
	return realpathSync(first.slice("worktree ".length));
}

function assertPrimaryCheckout(root: string): void {
	const primary = primaryRoot(root);
	if (root !== primary) {
		throw new CliError(
			`Run this command from the primary checkout: ${primary}`,
			64,
		);
	}
}

function stringArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new CliError(
			`Invalid devenv module configuration: ${field} must be an array of strings.`,
		);
	}
	return value as string[];
}

function loadConfig(_root: string): AgentSessionConfig {
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

function validateSlug(slug: string): void {
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

function commonGitDirectory(root: string): string {
	const path = git(root, ["rev-parse", "--git-common-dir"]);
	return realpathSync(isAbsolute(path) ? path : resolve(root, path));
}

function operationLockDirectory(root: string): string {
	return join(commonGitDirectory(root), "agent-session", "operation.lock");
}

function readOperationLock(root: string): OperationLock | undefined {
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

function withOperationLock<T>(
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

function metadataPath(root: string, slug: string): string {
	return join(sessionsDirectory(root), `${slug}.json`);
}

function writeMetadata(root: string, metadata: SessionMetadata): void {
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

function readMetadata(root: string, slug: string): SessionMetadata {
	const path = metadataPath(root, slug);
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
		metadata.version !== 1 ||
		metadata.slug !== slug ||
		typeof metadata.branch !== "string" ||
		typeof metadata.worktreePath !== "string" ||
		typeof metadata.remote !== "string" ||
		typeof metadata.defaultBranch !== "string" ||
		typeof metadata.createdAt !== "string" ||
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
		metadata.branch !== `agent/${slug}` ||
		!isAbsolute(metadata.worktreePath) ||
		canonicalWorktree === primaryRoot(root)
	) {
		throw new CliError(`Unsafe session metadata for ${slug}.`);
	}
	return metadata as SessionMetadata;
}

function metadataSlugs(root: string): string[] {
	const directory = sessionsDirectory(root);
	if (!existsSync(directory)) return [];
	return readdirSync(directory)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((name) => name.slice(0, -".json".length));
}

function brokenStatus(slug: string, problem: string): SessionStatus {
	return {
		version: 1,
		slug,
		branch: "",
		worktreePath: "",
		remote: "",
		defaultBranch: "",
		createdAt: "",
		conversation: null,
		initialBranch: "",
		currentBranch: null,
		ownedBranches: [],
		state: "broken",
		clean: false,
		fresh: false,
		publication: "unpublished",
		ahead: 0,
		behind: 0,
		problem,
	};
}

interface ManagedWorktree {
	slug: string;
	branch: string;
	worktreePath: string;
}

function resolveWorktreeRoot(root: string, configured: string): string {
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

function discoverManagedWorktrees(
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

function unrecordedStatus(worktree: ManagedWorktree): SessionStatus {
	const clean =
		git(worktree.worktreePath, [
			"status",
			"--porcelain",
			"--untracked-files=all",
		]) === "";
	return {
		version: 1,
		slug: worktree.slug,
		branch: worktree.branch,
		worktreePath: worktree.worktreePath,
		remote: "",
		defaultBranch: "",
		createdAt: "",
		conversation: null,
		initialBranch: worktree.branch,
		currentBranch: worktree.branch,
		ownedBranches: [worktree.branch],
		state: "unrecorded",
		clean,
		fresh: false,
		publication: "unpublished",
		ahead: 0,
		behind: 0,
		problem: `Session metadata is missing. Recover with: agent-session repair ${worktree.slug}`,
	};
}

function assertConfiguredWorktreePath(
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

function upstreamRemote(root: string, branch: string): string {
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

function remoteDefaultBranch(root: string, remote: string): string {
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

function ensureClean(root: string): void {
	const status = git(root, ["status", "--porcelain", "--untracked-files=all"]);
	if (status) {
		throw new CliError(`Primary checkout must be clean:\n${status}`);
	}
}

function linkLocalFiles(root: string, worktree: string, paths: string[]): void {
	for (const relativePath of paths) {
		if (
			relativePath.startsWith("/") ||
			relativePath.split("/").includes("..")
		) {
			throw new CliError(`Unsafe local_links path: ${relativePath}`);
		}
		const source = join(root, relativePath);
		const target = join(worktree, relativePath);
		if (!existsSync(source) && !lstatExists(source)) continue;
		if (existsSync(target) || lstatExists(target)) {
			throw new CliError(`Local link target already exists: ${target}`);
		}
		mkdirSync(dirname(target), { recursive: true });
		symlinkSync(source, target);
	}
}

function lstatExists(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch {
		return false;
	}
}

function executeConfigured(
	command: string[],
	cwd: string,
	environment: NodeJS.ProcessEnv = process.env,
): number {
	if (command.length === 0) return 0;
	const [executable, ...args] = command;
	if (!executable) return 0;
	return run(executable, args, cwd, "inherit", environment).status;
}

function launchAgent(
	config: AgentSessionConfig,
	metadata: SessionMetadata,
	additionalArguments: string[] = [],
): number {
	process.stderr.write(`Launching agent in ${metadata.worktreePath}\n`);
	const agentStatus = executeConfigured(
		[...config.agent_command, ...additionalArguments],
		metadata.worktreePath,
	);
	if (agentStatus !== 0) {
		process.stderr.write(
			`Agent exited with status ${agentStatus}; the session remains available to resume.\n`,
		);
	}
	return agentStatus;
}

function countRevisionRange(cwd: string, range: string): number {
	const result = run("git", ["rev-list", "--count", range], cwd);
	if (result.status !== 0) return 0;
	return Number.parseInt(result.stdout, 10) || 0;
}

function statusCannotOperate(status: SessionStatus): boolean {
	return ["broken", "orphaned", "unrecorded", "conflict"].includes(
		status.state,
	);
}

interface ReflogEntry {
	timestamp: string;
	commit: string;
	summary: string;
}

function reflogEntries(cwd: string, revision: string): ReflogEntry[] {
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

function localBranches(root: string): Set<string> {
	const output = git(root, [
		"for-each-ref",
		"--format=%(refname:short)",
		"refs/heads",
	]);
	return new Set(output ? output.split("\n") : []);
}

function sessionOwnedBranches(metadata: SessionMetadata): string[] {
	const local = localBranches(metadata.worktreePath);
	const owned = new Set([metadata.branch]);
	const preexisting = new Set(metadata.preexistingBranches ?? []);
	const legacyCreationBoundary = Math.floor(
		new Date(metadata.createdAt).getTime() / 1000,
	);
	const entries = reflogEntries(metadata.worktreePath, "HEAD").reverse();
	for (const entry of entries) {
		const rename = entry.summary.match(
			/^Branch: renamed refs\/heads\/(.+) to refs\/heads\/(.+)$/,
		);
		if (rename?.[1] && rename[2] && owned.has(rename[1])) {
			owned.add(rename[2]);
			continue;
		}
		const checkout = entry.summary.match(/^checkout: moving from .+ to (.+)$/);
		const destination = checkout?.[1];
		if (!destination || !local.has(destination)) continue;
		const creation = reflogEntries(metadata.worktreePath, destination).at(-1);
		const createdDuringSession = metadata.preexistingBranches
			? !preexisting.has(destination)
			: Number.parseInt(creation?.timestamp ?? "0", 10) >
				legacyCreationBoundary;
		if (
			createdDuringSession &&
			creation?.summary.startsWith("branch: Created from ") &&
			creation.timestamp === entry.timestamp &&
			creation.commit === entry.commit
		) {
			owned.add(destination);
		}
	}
	return [...owned].filter((branch) => local.has(branch)).sort();
}

function inspectSession(
	metadata: SessionMetadata,
	defaultBranch = metadata.defaultBranch,
): SessionStatus {
	if (!existsSync(metadata.worktreePath)) {
		return {
			...metadata,
			defaultBranch,
			initialBranch: metadata.branch,
			currentBranch: null,
			ownedBranches: [],
			state: "orphaned",
			clean: false,
			fresh: false,
			publication: "unpublished",
			ahead: 0,
			behind: 0,
			problem: `Managed worktree is missing. Recover with: agent-session finish ${metadata.slug} --force`,
		};
	}
	const actualRoot = run(
		"git",
		["rev-parse", "--show-toplevel"],
		metadata.worktreePath,
	);
	const actualBranch = run(
		"git",
		["branch", "--show-current"],
		metadata.worktreePath,
	);
	const ownedBranches = sessionOwnedBranches(metadata);
	if (
		actualRoot.status !== 0 ||
		realpathSync(actualRoot.stdout) !== metadata.worktreePath ||
		actualBranch.status !== 0 ||
		!ownedBranches.includes(actualBranch.stdout)
	) {
		const currentBranch = actualBranch.stdout || null;
		return {
			...metadata,
			defaultBranch,
			initialBranch: metadata.branch,
			currentBranch,
			ownedBranches,
			state: "conflict",
			clean: false,
			fresh: false,
			publication: "unpublished",
			ahead: 0,
			behind: 0,
			problem: [
				"Session branch conflict.",
				`Saved initial branch: ${metadata.branch}`,
				`Current branch: ${currentBranch ?? "detached HEAD"}`,
				`Session-owned branches: ${ownedBranches.join(", ") || "none"}`,
			].join(" "),
		};
	}

	const branch = actualBranch.stdout;
	const clean =
		git(metadata.worktreePath, [
			"status",
			"--porcelain",
			"--untracked-files=all",
		]) === "";
	const fresh =
		run(
			"git",
			[
				"merge-base",
				"--is-ancestor",
				`${metadata.remote}/${defaultBranch}`,
				"HEAD",
			],
			metadata.worktreePath,
		).status === 0;
	const upstream = run(
		"git",
		["rev-parse", "--abbrev-ref", `${branch}@{upstream}`],
		metadata.worktreePath,
	);
	let publication: SessionStatus["publication"] = "unpublished";
	let ahead = 0;
	let behind = 0;
	if (upstream.status === 0) {
		ahead = countRevisionRange(
			metadata.worktreePath,
			`${upstream.stdout}..HEAD`,
		);
		behind = countRevisionRange(
			metadata.worktreePath,
			`HEAD..${upstream.stdout}`,
		);
		publication =
			ahead > 0 && behind > 0
				? "diverged"
				: ahead > 0
					? "unpushed"
					: behind > 0
						? "behind"
						: "published";
	}
	const state = !clean
		? fresh
			? "dirty"
			: "dirty-stale"
		: fresh
			? "ready"
			: "stale";
	return {
		...metadata,
		branch,
		defaultBranch,
		initialBranch: metadata.branch,
		currentBranch: branch,
		ownedBranches,
		state,
		clean,
		fresh,
		publication,
		ahead,
		behind,
	};
}

function refreshMetadataRemote(
	root: string,
	metadata: SessionMetadata,
): string {
	const fetch = run("git", ["fetch", "--prune", metadata.remote], root);
	if (fetch.status !== 0) {
		throw new CliError(`Failed to fetch remote ${metadata.remote}.`);
	}
	return remoteDefaultBranch(root, metadata.remote);
}

function showStatus(
	root: string,
	slug: string | undefined,
	json: boolean,
	refresh: boolean,
): void {
	if (slug) validateSlug(slug);
	const config = loadConfig(root);
	const discovered = discoverManagedWorktrees(root, config);
	if (slug && !existsSync(metadataPath(root, slug)) && !discovered.has(slug)) {
		throw new CliError(`No managed session: ${slug}`);
	}
	const knownSlugs = [
		...new Set([...metadataSlugs(root), ...discovered.keys()]),
	].sort();
	const slugs = slug ? [slug] : knownSlugs;
	const refreshedDefaults = new Map<string, string>();
	const statuses = slugs.map((sessionSlug) => {
		if (!existsSync(metadataPath(root, sessionSlug))) {
			const worktree = discovered.get(sessionSlug);
			return worktree
				? unrecordedStatus(worktree)
				: brokenStatus(sessionSlug, `No managed session: ${sessionSlug}`);
		}
		let metadata: SessionMetadata;
		try {
			metadata = readMetadata(root, sessionSlug);
		} catch (error) {
			const problem =
				error instanceof CliError
					? error.message
					: `Invalid session: ${sessionSlug}`;
			return brokenStatus(sessionSlug, problem);
		}
		let defaultBranch = metadata.defaultBranch;
		if (refresh) {
			const known = refreshedDefaults.get(metadata.remote);
			defaultBranch = known ?? refreshMetadataRemote(root, metadata);
			refreshedDefaults.set(metadata.remote, defaultBranch);
		}
		return inspectSession(metadata, defaultBranch);
	});
	const operation = readOperationLock(root) ?? null;
	if (json) {
		process.stdout.write(
			`${JSON.stringify({ version: 1, operation, sessions: statuses })}\n`,
		);
		return;
	}
	if (operation) {
		process.stdout.write(
			`Operation active: ${operation.command} (pid ${operation.pid})\n`,
		);
	}
	if (statuses.length === 0) {
		process.stdout.write("No managed agent sessions.\n");
		return;
	}
	for (const session of statuses) {
		const hygiene = ["broken", "orphaned", "unrecorded", "conflict"].includes(
			session.state,
		)
			? session.state.toUpperCase()
			: [
					session.clean ? "CLEAN" : "DIRTY",
					session.fresh ? "FRESH" : "STALE",
					session.publication.toUpperCase(),
				].join(" ");
		const branches =
			session.ownedBranches.length > 1
				? `\n  owned branches: ${session.ownedBranches.join(", ")}`
				: "";
		process.stdout.write(
			`${session.slug}  ${session.currentBranch ?? session.branch}  ${hygiene}\n  ${session.worktreePath}${branches}\n`,
		);
		if (session.problem) process.stderr.write(`${session.problem}\n`);
	}
}

function prepareLaunch(
	root: string,
	slug: string,
): { config: AgentSessionConfig; metadata: SessionMetadata } {
	validateSlug(slug);
	assertPrimaryCheckout(root);
	const config = loadConfig(root);
	ensureClean(root);
	const metadata = readMetadata(root, slug);
	assertConfiguredWorktreePath(root, config, metadata);
	const defaultBranch = refreshMetadataRemote(root, metadata);
	const status = inspectSession(metadata, defaultBranch);
	if (statusCannotOperate(status)) {
		throw new CliError(
			status.problem ?? `Managed session ${slug} is unusable.`,
		);
	}
	if (!status.clean) {
		process.stderr.write(
			`Warning: session ${slug} is dirty; work is preserved.\n`,
		);
	}
	if (!status.fresh) {
		process.stderr.write(
			`Warning: session ${slug} has not integrated the latest ${metadata.remote}/${defaultBranch}.\n`,
		);
	}
	process.stderr.write(`Launching ${metadata.branch}\n`);
	return { config, metadata };
}

function launch(
	root: string,
	slug: string,
	operation = "launch",
	additionalArguments: string[] = [],
): number {
	const prepared = withOperationLock(root, operation, () =>
		prepareLaunch(root, slug),
	);
	return launchAgent(prepared.config, prepared.metadata, additionalArguments);
}

// Navigation and ad-hoc commands inspect only local Git evidence. Unlike launch,
// they neither fetch nor require the primary checkout or session to be clean.
function sessionDirectory(root: string, slug: string): string {
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

function runInSession(root: string, slug: string, command: string[]): number {
	const cwd = sessionDirectory(root, slug);
	const result = spawnSync("devenv", ["-q", "shell", "--", ...command], {
		cwd,
		stdio: "inherit",
	});
	if (result.error) {
		throw new CliError(`Cannot run devenv: ${result.error.message}`);
	}
	return result.status ?? (result.signal ? 128 + constants.signals[result.signal] : 1);
}

function assertNotInvokingWorktree(
	metadata: SessionMetadata,
	invocationRoot: string,
): void {
	if (metadata.worktreePath === invocationRoot) {
		throw new CliError(
			"Cannot remove the worktree containing the current shell. Run finish from another repository worktree.",
		);
	}
}

function worktreeIsRegistered(root: string, worktreePath: string): boolean {
	return git(root, ["worktree", "list", "--porcelain"])
		.split("\n")
		.includes(`worktree ${worktreePath}`);
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
	let ownedBranches = localBranches(root).has(metadata.branch)
		? [metadata.branch]
		: [];
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
				`Confirmation required. Re-run: agent-session finish ${slug} --force --yes`,
			);
		}
		const answer = prompt("Discard local session assets? [y/N]") ?? "";
		if (!["y", "yes"].includes(answer.trim().toLowerCase())) {
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

function finishUnlocked(
	root: string,
	invocationRoot: string,
	slug: string,
	yes: boolean,
	keepBranch: boolean,
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
	const diffCheck = run("git", ["diff", "--check"], metadata.worktreePath);
	if (diffCheck.status !== 0) {
		throw new CliError(diffCheck.stderr || "Git diff verification failed.");
	}
	const mergedDefault = `${metadata.remote}/${defaultBranch}`;
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
		.map((branch) => `  branch:   ${branch}${keepBranch ? " (preserved)" : ""}`)
		.join("\n");
	process.stderr.write(
		`Ready to remove local session assets:\n  worktree: ${metadata.worktreePath}\n${branchList}\n`,
	);
	if (!yes) {
		if (!process.stdin.isTTY) {
			throw new CliError(
				`Confirmation required. Re-run: agent-session finish ${slug} --yes`,
			);
		}
		const answer = prompt("Delete local worktree and branch? [y/N]") ?? "";
		if (!["y", "yes"].includes(answer.trim().toLowerCase())) {
			throw new CliError("Cleanup cancelled.");
		}
	}

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
	const disposition = keepBranch
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

function repairUnlocked(root: string, slug: string): void {
	validateSlug(slug);
	assertPrimaryCheckout(root);
	const config = loadConfig(root);
	if (existsSync(metadataPath(root, slug))) {
		throw new CliError(`Session metadata already exists: ${slug}`);
	}
	const worktree = discoverManagedWorktrees(root, config).get(slug);
	if (!worktree) {
		throw new CliError(`No unrecorded managed worktree: ${slug}`);
	}
	const primaryBranch = git(root, ["branch", "--show-current"]);
	if (!primaryBranch) {
		throw new CliError("Primary checkout must be on a branch.");
	}
	const remote = upstreamRemote(root, primaryBranch);
	process.stderr.write(`Inspecting ${remote} before repairing ${slug}...\n`);
	const metadata: SessionMetadata = {
		version: 1,
		slug,
		branch: worktree.branch,
		worktreePath: worktree.worktreePath,
		remote,
		defaultBranch: remoteDefaultBranch(root, remote),
		createdAt: new Date().toISOString(),
		conversation: null,
	};
	writeMetadata(root, metadata);
	process.stdout.write(
		`Session metadata repaired: ${slug}\nWorktree: ${worktree.worktreePath}\n`,
	);
}

function repair(root: string, slug: string): void {
	withOperationLock(root, "repair", () => repairUnlocked(root, slug));
}

function previewFinish(
	root: string,
	invocationRoot: string,
	slug: string,
	force: boolean,
	keepBranch: boolean,
	report: ProgressReporter,
	phase: string | null = "inspect-finish",
): Record<string, unknown> {
	const inspect = () => {
		validateSlug(slug);
		assertPrimaryCheckout(root);
		const config = loadConfig(root);
		const metadata = readMetadata(root, slug);
		assertConfiguredWorktreePath(root, config, metadata);
		assertNotInvokingWorktree(metadata, invocationRoot);
		const status = inspectSession(metadata);
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

function finish(
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
		const plan = previewFinish(
			root,
			invocationRoot,
			slug,
			force,
			keepBranch,
			report,
		);
		const branches = (plan.ownedBranches as string[]).join(", ") || "none";
		writeCommandResult(
			{ version: 1, command: "finish", dryRun: true, plan },
			json,
			`Would remove local worktree ${String(plan.worktreePath)} and ${keepBranch ? "preserve" : "delete"} session-owned branches: ${branches}.\n`,
		);
		return;
	}
	runPhase(report, "cleanup", () =>
		withOperationLock(root, "finish", () => {
			if (
				expected &&
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
				: finishUnlocked(root, invocationRoot, slug, yes, keepBranch);
		}),
	);
}

function branchUpstreamIsGone(root: string, branch: string): boolean {
	const result = run(
		"git",
		["for-each-ref", "--format=%(upstream:track)", `refs/heads/${branch}`],
		root,
	);
	return result.status === 0 && result.stdout.trim() === "[gone]";
}

function confirmBulkFinish(mode: "all" | "gone", count: number, yes: boolean) {
	if (yes || count === 0) return;
	if (!process.stdin.isTTY) {
		throw new CliError(
			`Confirmation required. Re-run: agent-session finish --${mode} --yes`,
		);
	}
	const answer = prompt(`Finish ${count} local session(s)? [y/N]`) ?? "";
	if (!["y", "yes"].includes(answer.trim().toLowerCase())) {
		throw new CliError("Finish cancelled.");
	}
}

function finishBulk(
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
			`Would finish ${plans.length} session(s); skip ${skipped.length}.${skippedText}`,
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
				for (const remote of new Set(records.map((record) => record.remote))) {
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
						finishUnlocked(root, invocationRoot, slug, true, keepBranch);
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

function previewCreate(
	root: string,
	slug: string,
	report: ProgressReporter,
): Record<string, unknown> {
	return runPhase(report, "inspect-create", () => {
		validateSlug(slug);
		assertPrimaryCheckout(root);
		const config = loadConfig(root);
		ensureClean(root);
		const currentBranch = git(root, ["branch", "--show-current"]);
		if (!currentBranch) {
			throw new CliError("Primary checkout must be on a branch.");
		}
		const remote = upstreamRemote(root, currentBranch);
		const defaultBranch = remoteDefaultBranch(root, remote);
		if (currentBranch !== defaultBranch) {
			throw new CliError(`Primary checkout must be on ${defaultBranch}.`);
		}
		const configuredWorktreeRoot = resolveWorktreeRoot(
			root,
			config.worktree_root,
		);
		if (
			run(
				"git",
				[
					"check-ignore",
					"--quiet",
					"--",
					`${config.worktree_root}/.agent-session-probe`,
				],
				root,
			).status !== 0
		) {
			throw new CliError(
				`Configured worktree root must be Git-ignored: ${config.worktree_root}`,
			);
		}
		const canonicalRoot = existsSync(configuredWorktreeRoot)
			? realpathSync(configuredWorktreeRoot)
			: configuredWorktreeRoot;
		const branch = `agent/${slug}`;
		const worktreePath = join(canonicalRoot, slug);
		if (existsSync(metadataPath(root, slug))) {
			throw new CliError(`Session already exists: ${slug}`);
		}
		if (existsSync(worktreePath) || lstatExists(worktreePath)) {
			throw new CliError(
				`Refusing to modify unmanaged assets at ${worktreePath}.`,
			);
		}
		if (
			run(
				"git",
				["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
				root,
			).status === 0 ||
			run(
				"git",
				["show-ref", "--verify", "--quiet", `refs/remotes/${remote}/${branch}`],
				root,
			).status === 0
		) {
			throw new CliError(
				`Refusing to modify unmanaged assets for branch ${branch}.`,
			);
		}
		return {
			slug,
			branch,
			worktreePath,
			remote,
			defaultBranch,
			base: `${remote}/${defaultBranch}`,
			agentLaunch: false,
			prepareCommand: config.prepare_command,
			localLinks: config.local_links,
		};
	});
}

function createSession(
	root: string,
	slug: string,
	report: ProgressReporter = progressReporter("create", false),
): { config: AgentSessionConfig; metadata: SessionMetadata } {
	validateSlug(slug);
	assertPrimaryCheckout(root);
	const config = loadConfig(root);
	ensureClean(root);
	const preexistingBranches = [...localBranches(root)].sort();

	const currentBranch = git(root, ["branch", "--show-current"]);
	if (!currentBranch)
		throw new CliError("Primary checkout must be on a branch.");
	const remote = upstreamRemote(root, currentBranch);
	const defaultBranch = runPhase(report, "remote-sync", () => {
		const fetch = run("git", ["fetch", "--prune", remote], root, "inherit");
		if (fetch.status !== 0) {
			throw new CliError(`Failed to fetch remote ${remote}.`);
		}
		return remoteDefaultBranch(root, remote);
	});
	if (currentBranch !== defaultBranch) {
		throw new CliError(`Primary checkout must be on ${defaultBranch}.`);
	}

	const branch = `agent/${slug}`;
	const configuredWorktreeRoot = resolveWorktreeRoot(
		root,
		config.worktree_root,
	);
	if (
		run(
			"git",
			[
				"check-ignore",
				"--quiet",
				"--",
				`${config.worktree_root}/.agent-session-probe`,
			],
			root,
		).status !== 0
	) {
		throw new CliError(
			`Configured worktree root must be Git-ignored: ${config.worktree_root}`,
		);
	}
	mkdirSync(configuredWorktreeRoot, { recursive: true });
	const worktreeRoot = realpathSync(configuredWorktreeRoot);
	const worktreePath = join(worktreeRoot, slug);
	const statePath = metadataPath(root, slug);
	if (existsSync(statePath))
		throw new CliError(`Session already exists: ${slug}`);
	if (existsSync(worktreePath) || lstatExists(worktreePath)) {
		throw new CliError(
			`Refusing to modify unmanaged assets at ${worktreePath}.`,
		);
	}
	if (
		run(
			"git",
			["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
			root,
		).status === 0 ||
		run(
			"git",
			["show-ref", "--verify", "--quiet", `refs/remotes/${remote}/${branch}`],
			root,
		).status === 0
	) {
		throw new CliError(
			`Refusing to modify unmanaged assets for branch ${branch}.`,
		);
	}

	let created = false;
	let recorded = false;
	try {
		runPhase(report, "worktree-create", () => {
			const added = run(
				"git",
				[
					"worktree",
					"add",
					"--no-track",
					"-b",
					branch,
					worktreePath,
					`${remote}/${defaultBranch}`,
				],
				root,
				"inherit",
			);
			if (added.status !== 0) {
				throw new CliError("Could not create the agent worktree.");
			}
		});
		created = true;
		runPhase(report, "worktree-prepare", () => {
			linkLocalFiles(root, worktreePath, config.local_links);
			if (executeConfigured(config.prepare_command, worktreePath) !== 0) {
				throw new CliError("Worktree preparation failed.");
			}
		});

		const metadata: SessionMetadata = {
			version: 1,
			slug,
			branch,
			worktreePath,
			remote,
			defaultBranch,
			createdAt: new Date().toISOString(),
			conversation: null,
			preexistingBranches,
		};
		runPhase(report, "metadata-record", () => writeMetadata(root, metadata));
		recorded = true;
	} finally {
		if (created && !recorded) {
			run(
				"git",
				["worktree", "remove", "--force", worktreePath],
				root,
				"inherit",
			);
			run("git", ["branch", "-D", branch], root, "inherit");
		}
	}

	process.stderr.write(`Agent worktree ready: ${branch}\n`);
	return { config, metadata: readMetadata(root, slug) };
}

function reportCreated(metadata: SessionMetadata): void {
	process.stdout.write(
		`Session created without launching the configured agent.\nWorktree: ${metadata.worktreePath}\n`,
	);
}

function create(
	root: string,
	slug: string,
	dryRun: boolean,
	json: boolean,
): number {
	const report = progressReporter("create", json);
	if (dryRun) {
		const plan = previewCreate(root, slug, report);
		writeCommandResult(
			{ version: 1, command: "create", dryRun: true, plan },
			json,
			`Would create ${String(plan.branch)} at ${String(plan.worktreePath)} from ${String(plan.base)}.\n`,
		);
		return 0;
	}
	const prepared = withOperationLock(root, "create", () =>
		createSession(root, slug, report),
	);
	reportCreated(prepared.metadata);
	return 0;
}

function start(
	root: string,
	slug: string,
	launchConfiguredAgent: boolean,
): number {
	const prepared = withOperationLock(root, "start", () =>
		createSession(root, slug, progressReporter("start", false)),
	);
	if (launchConfiguredAgent) {
		return launchAgent(prepared.config, prepared.metadata);
	}
	reportCreated(prepared.metadata);
	return 0;
}

const commandNames = [
	"cd",
	"run",
	"create",
	"launch",
	"start",
	"resume",
	"status",
	"repair",
	"finish",
	"completion",
];

function editDistance(left: string, right: string): number {
	const previous = Array.from(
		{ length: right.length + 1 },
		(_, index) => index,
	);
	for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
		const current = [leftIndex];
		for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
			current[rightIndex] = Math.min(
				(current[rightIndex - 1] ?? 0) + 1,
				(previous[rightIndex] ?? 0) + 1,
				(previous[rightIndex - 1] ?? 0) +
					(left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
			);
		}
		previous.splice(0, previous.length, ...current);
	}
	return previous[right.length] ?? left.length;
}

function didYouMean(value: string, candidates: string[]): string {
	const ranked = candidates
		.map((candidate) => ({
			candidate,
			distance: editDistance(value, candidate),
		}))
		.sort((left, right) => left.distance - right.distance);
	const nearest = ranked[0];
	return nearest && nearest.distance <= 3
		? ` Did you mean '${nearest.candidate}'?`
		: "";
}

function argumentError(message: string): CliError {
	return new CliError(`${message}\n\n${usage()}`, 64);
}

function unknownOption(
	command: string,
	option: string,
	validOptions: string[],
): CliError {
	return argumentError(
		`Unknown option '${option}' for '${command}'.${didYouMean(option, validOptions)}`,
	);
}

function parseCreateArguments(args: string[]): {
	slug: string;
	dryRun: boolean;
	json: boolean;
} {
	let slug: string | undefined;
	let dryRun = false;
	let json = false;
	for (const argument of args) {
		if (argument === "--dry-run") dryRun = true;
		else if (argument === "--json") json = true;
		else if (!argument.startsWith("-") && !slug) slug = argument;
		else if (argument.startsWith("-")) {
			throw unknownOption("create", argument, ["--dry-run", "--json"]);
		} else {
			throw argumentError(`Unexpected argument '${argument}' for 'create'.`);
		}
	}
	if (!slug) throw argumentError("Missing <task-slug> for 'create'.");
	if (json && !dryRun) {
		throw new CliError("create --json requires --dry-run.", 64);
	}
	return { slug, dryRun, json };
}

function parseStartArguments(args: string[]): {
	slug: string;
	launchConfiguredAgent: boolean;
} {
	let slug: string | undefined;
	let launchConfiguredAgent = true;
	for (const argument of args) {
		if (argument === "--no-agent") launchConfiguredAgent = false;
		else if (!argument.startsWith("-") && !slug) slug = argument;
		else if (argument.startsWith("-")) {
			throw unknownOption("start", argument, ["--no-agent"]);
		} else {
			throw argumentError(`Unexpected argument '${argument}' for 'start'.`);
		}
	}
	if (!slug) throw argumentError("Missing <task-slug> for 'start'.");
	return { slug, launchConfiguredAgent };
}

function parseFinishArguments(args: string[]): {
	slug?: string;
	yes: boolean;
	force: boolean;
	keepBranch: boolean;
	all: boolean;
	gone: boolean;
	dryRun: boolean;
	json: boolean;
	expected?: string;
} {
	let slug: string | undefined;
	let expected: string | undefined;
	let yes = false;
	let force = false;
	let keepBranch = false;
	let all = false;
	let gone = false;
	let dryRun = false;
	let json = false;
	for (let index = 0; index < args.length; index++) {
		const argument = args[index] ?? "";
		if (argument === "--expected") {
			const value = args[++index];
			if (expected || !value || !/^[a-f0-9]{64}$/.test(value))
				throw argumentError("finish --expected requires one preview receipt.");
			expected = value;
		} else if (argument === "--yes") yes = true;
		else if (argument === "--force") force = true;
		else if (argument === "--keep-branch") keepBranch = true;
		else if (argument === "--all") all = true;
		else if (argument === "--gone") gone = true;
		else if (argument === "--dry-run") dryRun = true;
		else if (argument === "--json") json = true;
		else if (!argument.startsWith("-") && !slug) slug = argument;
		else if (argument.startsWith("-")) {
			throw unknownOption("finish", argument, [
				"--yes",
				"--force",
				"--keep-branch",
				"--expected",
				"--all",
				"--gone",
				"--dry-run",
				"--json",
			]);
		} else {
			throw argumentError(`Unexpected argument '${argument}' for 'finish'.`);
		}
	}
	if ([Boolean(slug), all, gone].filter(Boolean).length !== 1) {
		throw argumentError(
			"Choose exactly one finish selector: <task-slug>, --all, or --gone.",
		);
	}
	if (json && !dryRun) {
		throw new CliError("finish --json requires --dry-run.", 64);
	}
	if (expected && (!slug || force || !keepBranch))
		throw argumentError(
			"finish --expected requires one slug, --keep-branch and non-forced cleanup.",
		);
	return { slug, yes, force, keepBranch, all, gone, dryRun, json, expected };
}

function parseStatusArguments(args: string[]): {
	slug?: string;
	json: boolean;
	refresh: boolean;
} {
	let slug: string | undefined;
	let json = false;
	let refresh = false;
	for (const argument of args) {
		if (argument === "--json") json = true;
		else if (argument === "--refresh") refresh = true;
		else if (!argument.startsWith("-") && !slug) slug = argument;
		else if (argument.startsWith("-")) {
			throw unknownOption("status", argument, ["--json", "--refresh"]);
		} else {
			throw argumentError(`Unexpected argument '${argument}' for 'status'.`);
		}
	}
	return { slug, json, refresh };
}

function parseRequiredSlug(command: string, args: string[]): string {
	if (args.length === 0) {
		throw argumentError(`Missing <task-slug> for '${command}'.`);
	}
	const [slug, ...extra] = args;
	if (extra.length > 0) {
		const argument = extra[0] ?? "";
		if (argument.startsWith("-")) {
			throw unknownOption(command, argument, []);
		}
		throw argumentError(`Unexpected argument '${argument}' for '${command}'.`);
	}
	if (slug?.startsWith("-")) throw unknownOption(command, slug, []);
	return slug ?? "";
}

function completionCandidates(command: string): string[] {
	try {
		const root = primaryRoot(repositoryRoot());
		if (command === "repair") {
			const config = loadConfig(root);
			const recorded = new Set(metadataSlugs(root));
			return [...discoverManagedWorktrees(root, config).keys()]
				.filter((slug) => !recorded.has(slug))
				.sort();
		}
		if (["cd", "run", "launch", "resume", "status", "finish"].includes(command)) {
			return metadataSlugs(root);
		}
	} catch {
		return [];
	}
	return [];
}

function completionScript(shell: string): string {
	if (shell === "bash") {
		return `# bash completion for agent-session
_agent_session() {
  local current command options sessions
  current="\${COMP_WORDS[COMP_CWORD]}"
  if [[ $COMP_CWORD -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${commandNames.join(" ")}" -- "$current") )
    return
  fi
  command="\${COMP_WORDS[1]}"
  if [[ $command == run && $COMP_CWORD -ge 3 ]]; then
    if [[ $COMP_CWORD -eq 3 ]]; then
      COMPREPLY=( $(compgen -c -- "$current") )
    else
      COMPREPLY=( $(compgen -f -- "$current") )
    fi
    return
  fi
  if [[ $command == cd && $COMP_CWORD -gt 2 ]]; then
    COMPREPLY=()
    return
  fi
  case "$command" in
    create) options="--dry-run --json" ;;
    start) options="--no-agent" ;;
    status) options="--json --refresh" ;;
    finish) options="--all --gone --keep-branch --force --yes --dry-run --json" ;;
    completion) options="bash zsh fish" ;;
    *) options="" ;;
  esac
  sessions="$(agent-session __complete "$command" 2>/dev/null)"
  COMPREPLY=( $(compgen -W "$options $sessions" -- "$current") )
}
complete -F _agent_session agent-session as
`;
	}
	if (shell === "zsh") {
		return `#compdef agent-session as
local -a commands candidates
commands=(${commandNames.map((command) => `'${command}:${command}'`).join(" ")})
if (( CURRENT == 2 )); then
  _describe 'command' commands
  return
fi
if [[ $words[2] == run ]] && (( CURRENT >= 4 )); then
  local -a run_words
  local run_current=$(( CURRENT - 3 ))
  run_words=("\${(@)words[4,-1]}")
  local -a words
  local CURRENT=$run_current
  words=("$run_words[@]")
  _normal
  return
fi
candidates=(\${(f)"$(agent-session __complete "$words[2]" 2>/dev/null)"})
if [[ $words[2] == cd || $words[2] == run ]]; then
  if (( CURRENT == 3 )); then
    _describe 'session' candidates
  fi
  return
fi
_arguments '*:session:($candidates)' \\
  '--dry-run[preview without mutation]' '--json[emit JSON]' \\
  '--refresh[refresh remote refs]' '--no-agent[do not launch the agent]' \\
  '--all[select all sessions]' '--gone[select sessions with gone upstreams]' \\
  '--keep-branch[preserve local branches]' '--force[discard unsafe local work]' \\
  '--yes[skip confirmation]'
`;
	}
	if (shell === "fish") {
		return `# fish completion for agent-session
function __agent_session_sessions
  set -l words (commandline -opc)
  agent-session __complete $words[2] 2>/dev/null
end
complete -c agent-session -f
complete -c agent-session -n '__fish_use_subcommand' -a '${commandNames.join(" ")}'
complete -c agent-session -n '__fish_seen_subcommand_from launch resume status repair finish' -a '(__agent_session_sessions)'
complete -c agent-session -n '__fish_seen_subcommand_from cd run; and test (count (commandline -opc)) -eq 2' -a '(__agent_session_sessions)'
complete -c agent-session -n '__fish_seen_subcommand_from run; and test (count (commandline -opc)) -ge 3' -a '(__fish_complete_subcommand --fcs-skip=3)'
complete -c agent-session -n '__fish_seen_subcommand_from create finish' -l dry-run
complete -c agent-session -n '__fish_seen_subcommand_from create status finish' -l json
complete -c agent-session -n '__fish_seen_subcommand_from finish' -l all
complete -c agent-session -n '__fish_seen_subcommand_from finish' -l gone
complete -c agent-session -n '__fish_seen_subcommand_from finish' -l keep-branch
complete -c agent-session -n '__fish_seen_subcommand_from finish' -l force
complete -c agent-session -n '__fish_seen_subcommand_from finish' -l yes
`;
	}
	throw argumentError(
		`Unsupported shell '${shell}'. Expected one of: bash, zsh, fish.`,
	);
}

function usage(): string {
	return [
		"Usage:",
		"  as cd <task-slug> (shell integration required)",
		"  agent-session cd <task-slug> (print the worktree path)",
		"  agent-session run <task-slug> <command> [args...]",
		"  agent-session create <task-slug> [--dry-run [--json]]",
		"  agent-session launch <task-slug>",
		"  agent-session start <task-slug> [--no-agent]",
		"  agent-session resume <task-slug>",
		"  agent-session status [task-slug] [--json] [--refresh]",
		"  agent-session repair <task-slug>",
		"  agent-session finish <task-slug> [--keep-branch [--expected <receipt>]] [--force] [--yes] [--dry-run [--json]]",
		"  agent-session finish (--all | --gone) [--keep-branch] [--force] [--yes] [--dry-run [--json]]",
		"  agent-session completion <bash|zsh|fish>",
	].join("\n");
}

export function main(args: string[]): number {
	try {
		const [command, ...rest] = args;
		if (command === "cd") {
			const slug = parseRequiredSlug(command, rest);
			process.stdout.write(`${sessionDirectory(primaryRoot(repositoryRoot()), slug)}\n`);
			return 0;
		}
		if (command === "run") {
			const slug = parseRequiredSlug(command, rest.slice(0, 1));
			const target = rest.slice(1);
			if (!target[0]) throw argumentError("Missing <command> for 'run'.");
			return runInSession(primaryRoot(repositoryRoot()), slug, target);
		}
		if (command === "create") {
			const options = parseCreateArguments(rest);
			return create(
				primaryRoot(repositoryRoot()),
				options.slug,
				options.dryRun,
				options.json,
			);
		}
		if (command === "completion") {
			if (rest.length === 0) {
				throw argumentError("Missing <shell> for 'completion'.");
			}
			if (rest.length > 1) {
				throw argumentError(
					`Unexpected argument '${rest[1]}' for 'completion'.`,
				);
			}
			process.stdout.write(completionScript(rest[0] ?? ""));
			return 0;
		}
		if (command === "__complete") {
			if (rest.length !== 1) return 0;
			const candidates = completionCandidates(rest[0] ?? "");
			if (candidates.length > 0) {
				process.stdout.write(`${candidates.join("\n")}\n`);
			}
			return 0;
		}
		if (command === "launch") {
			const slug = parseRequiredSlug("launch", rest);
			return launch(primaryRoot(repositoryRoot()), slug);
		}
		if (command === "start") {
			const options = parseStartArguments(rest);
			const root = primaryRoot(repositoryRoot());
			return start(root, options.slug, options.launchConfiguredAgent);
		}
		if (command === "resume") {
			const slug = parseRequiredSlug("resume", rest);
			return launch(primaryRoot(repositoryRoot()), slug, "resume", [
				"--continue",
			]);
		}
		if (command === "status") {
			const options = parseStatusArguments(rest);
			showStatus(
				primaryRoot(repositoryRoot()),
				options.slug,
				options.json,
				options.refresh,
			);
			return 0;
		}
		if (command === "repair") {
			const slug = parseRequiredSlug("repair", rest);
			repair(primaryRoot(repositoryRoot()), slug);
			return 0;
		}
		if (command === "finish") {
			const options = parseFinishArguments(rest);
			const invocationRoot = repositoryRoot();
			const root = primaryRoot(invocationRoot);
			if (options.all || options.gone) {
				finishBulk(
					root,
					invocationRoot,
					options.all ? "all" : "gone",
					options.yes,
					options.force,
					options.keepBranch,
					options.dryRun,
					options.json,
				);
			} else {
				finish(
					root,
					invocationRoot,
					options.slug ?? "",
					options.yes,
					options.force,
					options.keepBranch,
					options.dryRun,
					options.json,
					options.expected,
				);
			}
			return 0;
		}
		if (!command) throw argumentError("Missing command.");
		throw argumentError(
			`Unknown command '${command}'.${didYouMean(command, commandNames)}`,
		);
	} catch (error) {
		if (error instanceof CliError) {
			process.stderr.write(`${error.message}\n`);
			return error.exitCode;
		}
		process.stderr.write(`${String(error)}\n`);
		return 1;
	}
}

if (import.meta.main) {
	process.exit(main(process.argv.slice(2)));
}
