import { existsSync, realpathSync } from "node:fs";
import { assertReviewSource } from "./github.ts";
import { sessionCommand } from "./arguments.ts";
import {
	countRevisionRange,
	git,
	localBranches,
	reflogEntries,
	remoteDefaultBranch,
} from "./git.ts";
import {
	discoverManagedWorktrees,
	loadConfig,
	metadataPath,
	metadataSlugs,
	readMetadata,
	readOperationLock,
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

export function sessionRemotes(metadata: SessionMetadata): string[] {
	return [...new Set([metadata.remote, ...(metadata.pr?.sourceRemote ? [metadata.pr.sourceRemote] : [])])];
}

export function refreshMetadataRemote(
	root: string,
	metadata: SessionMetadata,
): string {
	if (metadata.pr) assertReviewSource(root, metadata.pr.sourceRemote ?? metadata.remote, metadata.pr);
	for (const remote of sessionRemotes(metadata)) {
		const fetch = run("git", ["fetch", "--prune", remote], root);
		if (fetch.status !== 0) throw new CliError(`Failed to fetch remote ${remote}.`);
	}
	return remoteDefaultBranch(root, metadata.remote);
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
			`${session.slug}  ${session.currentBranch ?? session.branch}  ${hygiene}\n  ${session.worktreePath}${branches}\n`,
		);
		if (session.problem) process.stderr.write(`${session.problem}\n`);
	}
}
