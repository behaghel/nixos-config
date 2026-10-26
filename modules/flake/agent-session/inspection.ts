import { existsSync, lstatSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { assertReviewSource, pullRequestSummary } from "./github.ts";
import { sessionCommand } from "./arguments.ts";
import {
	countRevisionRange,
	commonGitDirectory,
	git,
	localBranches,
	reflogEntries,
	remoteDefaultBranch,
} from "./git.ts";
import {
	assertConfiguredWorktreePath,
	discoverManagedWorktrees,
	loadConfig,
	metadataPath,
	metadataSlugs,
	readMetadata,
	readMetadataRecord,
	readOperationLock,
	resolveWorktreeRoot,
	sessionRecordExists,
	validateSlug,
} from "./sessions.ts";
import { CliError, run } from "./runtime.ts";
import type { SessionMetadata, SessionStatus, ManagedWorktree } from "./types.ts";

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

function unrecordedStatus(worktree: ManagedWorktree): SessionStatus {
	const clean =
		git(worktree.worktreePath, [
			"--no-optional-locks",
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
		problem: `Session metadata is missing. Recover with: ${sessionCommand(worktree.slug, "repair")}`,
	};
}

export function statusCannotOperate(status: SessionStatus): boolean {
	return ["broken", "orphaned", "unrecorded", "conflict"].includes(
		status.state,
	);
}

function sessionBranchSets(metadata: SessionMetadata): { owned: string[]; allowed: string[] } {
	const local = localBranches(metadata.worktreePath);
	const owned = new Set<string>(metadata.initialBranchOwned === false ? [] : [metadata.branch]);
	const allowed = new Set([metadata.branch]);
	const preexisting = new Set(metadata.preexistingBranches ?? []);
	const legacyCreationBoundary = Math.floor(
		new Date(metadata.createdAt).getTime() / 1000,
	);
	const entries = reflogEntries(metadata.worktreePath, "HEAD").reverse();
	for (const entry of entries) {
		const rename = entry.summary.match(
			/^Branch: renamed refs\/heads\/(.+) to refs\/heads\/(.+)$/,
		);
		if (rename?.[1] && rename[2] && allowed.has(rename[1])) {
			allowed.add(rename[2]);
			if (owned.has(rename[1])) owned.add(rename[2]);
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
			allowed.add(destination);
		}
	}
	return {
		owned: [...owned].filter((branch) => local.has(branch)).sort(),
		allowed: [...allowed].filter((branch) => local.has(branch)),
	};
}

export function sessionBaseBranch(metadata: SessionMetadata, defaultBranch = metadata.defaultBranch): string {
	return metadata.pr?.baseBranch ?? defaultBranch;
}

export function inspectSession(
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
			problem: `Managed worktree is missing. Recover with: ${sessionCommand(metadata.slug, "finish")} --force`,
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
	const { owned: ownedBranches, allowed: allowedBranches } = sessionBranchSets(metadata);
	if (
		actualRoot.status !== 0 ||
		realpathSync(actualRoot.stdout) !== metadata.worktreePath ||
		actualBranch.status !== 0 ||
		!allowedBranches.includes(actualBranch.stdout)
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
			"--no-optional-locks",
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
				`${metadata.remote}/${sessionBaseBranch(metadata, defaultBranch)}`,
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

export function sessionRemotes(metadata: SessionMetadata): string[] {
	return [...new Set([metadata.remote, ...(metadata.pr?.mode === "review" && metadata.pr.sourceRemote ? [metadata.pr.sourceRemote] : [])])];
}

export function refreshMetadataRemote(
	root: string,
	metadata: SessionMetadata,
): string {
	if (metadata.pr?.mode === "review") assertReviewSource(root, metadata.pr.sourceRemote ?? metadata.remote, metadata.pr);
	for (const remote of sessionRemotes(metadata)) {
		const fetch = run("git", ["fetch", "--prune", remote], root);
		if (fetch.status !== 0) throw new CliError(`Failed to fetch remote ${remote}.`);
	}
	return remoteDefaultBranch(root, metadata.remote);
}

// Inventory deliberately avoids native worktree discovery and checkout status.
// Invalid records remain visible instead of silently disappearing from the list.
export function showInventory(root: string, json: boolean): void {
	const directory = join(commonGitDirectory(root), "agent-session", "sessions");
	const sessions = metadataSlugs(root).map((slug) => {
		try { return { ...readMetadataRecord(join(directory, `${slug}.json`), slug), metadataState: "recorded" }; }
		catch (error) { return { slug, metadataState: "unknown", problem: String(error) }; }
	});
	if (json) process.stdout.write(`${JSON.stringify({ version: 1, inventory: "metadata-only", sessions })}\n`);
	else for (const session of sessions) process.stdout.write(`${session.slug}  ${session.metadataState}\n`);
}

// Resolve aliases even when the final component is missing, without treating
// dangling symlinks or inaccessible ancestors as evidence of absence.
function canonicalResourcePath(path: string): string {
	const absolute = resolve(path);
	try {
		lstatSync(absolute);
		return realpathSync(absolute);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		try {
			if (lstatSync(absolute).isSymbolicLink()) throw new CliError("Target is a dangling symlink.");
		} catch (probe) {
			if ((probe as NodeJS.ErrnoException).code !== "ENOENT") throw probe;
		}
		const parent = dirname(absolute);
		if (parent === absolute) throw error;
		return join(canonicalResourcePath(parent), basename(absolute));
	}
}

export function inspectExactResource(root: string, path: string) {
	let worktreePath = resolve(path);
	let resourceState: "present" | "absent" | "inconsistent" | "unknown" = "unknown";
	const evidence: { filesystem: string; metadata: string; registered: boolean | null } = {
		filesystem: "unknown", metadata: "unknown", registered: null,
	};
	const sessions: SessionStatus[] = [];
	let problem: string | undefined;
	try {
		worktreePath = canonicalResourcePath(path);
		const config = loadConfig(root);
		const configuredRoot = canonicalResourcePath(resolveWorktreeRoot(root, config.worktree_root));
		const slug = basename(worktreePath);
		validateSlug(slug);
		if (worktreePath !== join(configuredRoot, slug)) throw new CliError("Target is outside the configured managed-worktree slots.");
		try {
			const stat = lstatSync(worktreePath);
			evidence.filesystem = stat.isDirectory() ? "present" : "not-directory";
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			evidence.filesystem = "absent";
		}
		const registrations = git(root, ["worktree", "list", "--porcelain", "-z"])
			.split("\0").filter((field) => field.startsWith("worktree "))
			.map((field) => resolve(field.slice("worktree ".length)));
		evidence.registered = registrations.includes(worktreePath);
		// Inspect only this slot's record. Other records cannot authorize this
		// configured slot, and corrupt unrelated records must not block lookup.
		const recorded = sessionRecordExists(root, slug);
		evidence.metadata = recorded ? "recorded" : "absent";
		if (!recorded && !evidence.registered && evidence.filesystem === "absent") {
			resourceState = "absent";
		} else if (recorded && evidence.registered && evidence.filesystem === "present") {
			const metadata = readMetadata(root, slug);
			assertConfiguredWorktreePath(root, config, metadata);
			if (canonicalResourcePath(metadata.worktreePath) !== worktreePath || commonGitDirectory(worktreePath) !== commonGitDirectory(root)) {
				throw new CliError("Managed metadata and native checkout identity do not agree.");
			}
			const status = inspectSession(metadata);
			sessions.push(status);
			resourceState = statusCannotOperate(status) ? "inconsistent" : "present";
			problem = status.problem;
		} else {
			resourceState = "inconsistent";
			problem = "Filesystem, managed record and Git registration do not agree. Inspect with doctor; no resources were changed.";
		}
	} catch (error) {
		problem = `Cannot establish exact resource state: ${String(error)} No resources were changed.`;
	}
	return { version: 1, worktreePath, resourceState, evidence, sessions, ...(problem ? { problem } : {}) };
}

export function showExactStatus(root: string, path: string, json: boolean): void {
	const result = inspectExactResource(root, path);
	if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
	else process.stdout.write(`${result.worktreePath}  ${result.resourceState.toUpperCase()}${result.problem ? `\n${result.problem}` : ""}\n`);
}

export function showStatus(
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
			const key = JSON.stringify(sessionRemotes(metadata));
			const known = refreshedDefaults.get(key);
			defaultBranch = known ?? refreshMetadataRemote(root, metadata);
			refreshedDefaults.set(key, defaultBranch);
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
			`${session.slug}  ${session.currentBranch ?? session.branch}  ${hygiene}\n  ${session.worktreePath}${branches}${session.pr ? `\n  PR: ${pullRequestSummary(session.pr)}; base: ${session.pr.baseBranch}` : ""}\n`,
		);
		if (session.problem) process.stderr.write(`${session.problem}\n`);
	}
}
