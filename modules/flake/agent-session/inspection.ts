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
	readMetadataInventory,
	readOperationLock,
	resolveWorktreeRoot,
	validateSlug,
	branchCreationMessage,
} from "./sessions.ts";
import { CliError, run, formatActivityTime, formatStateTable, formatLines, displayText, styleText, type InspectionProgress } from "./runtime.ts";
import type { AgentSessionConfig, SessionMetadata, SessionStatus, ManagedWorktree, PresentationOptions } from "./types.ts";

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

// Declared claims are not proof of ownership. Conflicting claims require
// review even when one claimant's creation evidence is missing or stale.
export function sharedBranchClaims(records: SessionMetadata[]) {
	const byBranch = new Map<string, { slug: string; sessionId: string | null; worktreePath: string }[]>();
	for (const record of records) {
		const names = record.branches ? record.branches.map((branch) => branch.name)
			: record.initialBranchOwned === false ? [] : [record.branch];
		for (const name of new Set(names)) {
			byBranch.set(name, [...(byBranch.get(name) ?? []), { slug: record.slug,
				sessionId: record.sessionId ?? null, worktreePath: record.worktreePath }]);
		}
	}
	return [...byBranch].filter(([, claims]) => claims.length > 1)
		.map(([name, claims]) => ({ name, claims })).sort((a, b) => a.name.localeCompare(b.name));
}

export function sessionBranchSets(metadata: SessionMetadata, cwd = metadata.worktreePath): { owned: string[]; allowed: string[]; unresolved: string[] } {
	const local = localBranches(cwd);
	const owned = new Set<string>();
	const unresolved = new Set<string>();
	if (metadata.branches) {
		for (const branch of metadata.branches) {
			if (!local.has(branch.name)) continue;
			const marker = branchCreationMessage(metadata.sessionId!, branch.id);
			const verified = reflogEntries(cwd, `refs/heads/${branch.name}`).some((entry) =>
				entry.summary === marker && entry.commit === branch.creationCommit);
			if (verified) owned.add(branch.name);
			else unresolved.add(branch.name);
		}
	} else if (metadata.initialBranchOwned !== false && local.has(metadata.branch)) {
		// Legacy metadata records only its initial branch. Never expand ownership
		// from timestamps, checkout messages or rename history.
		owned.add(metadata.branch);
	}
	const current = git(cwd, ["branch", "--show-current"]);
	if (current && !owned.has(current)) unresolved.add(current);
	const allowed = new Set(owned);
	if (metadata.initialBranchOwned === false || !metadata.branches) allowed.add(metadata.branch);
	return { owned: [...owned].sort(), allowed: [...allowed].filter((branch) => local.has(branch)),
		unresolved: [...unresolved].sort() };
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
		if (fetch.status !== 0) {
			const failure = new CliError(`Failed to fetch remote ${remote}.`);
			failure.cause = fetch; throw failure;
		}
	}
	return remoteDefaultBranch(root, metadata.remote);
}

function inventoryActivityTime(metadata: SessionMetadata): number {
	return Math.max(...[metadata.createdAt, metadata.lastWorkAt ?? ""]
		.map((timestamp) => Date.parse(timestamp)).filter(Number.isFinite));
}

// One local engagement projection for list ordering/labels and inactivity age.
export function sessionActivityTree(metadata: SessionMetadata[]) {
	type Node = { metadata: SessionMetadata; activity: number; complete: boolean; limitingSlug: string; prefix: string; children: Node[] };
	const nodes: Node[] = metadata.map((record) => ({ metadata: record, activity: inventoryActivityTime(record),
		complete: Number.isFinite(Date.parse(record.createdAt)) && (record.lastWorkAt === undefined || Number.isFinite(Date.parse(record.lastWorkAt))),
		limitingSlug: record.slug, prefix: "", children: [] }));
	const byId = new Map<string, Node>();
	for (const node of nodes) {
		const id = node.metadata.sessionId;
		if (!id) continue;
		if (byId.has(id)) throw new CliError("Ambiguous session identities in creator tree; no inventory emitted.");
		byId.set(id, node);
	}
	const roots: Node[] = [];
	for (const node of nodes) {
		const creator = node.metadata.creatorConversation;
		const parent = creator ? byId.get(creator.parentSessionId) : undefined;
		if (parent) parent.children.push(node);
		else roots.push(node);
	}
	const visiting = new Set<Node>(), visited = new Set<Node>();
	function rollup(node: Node): number {
		if (visiting.has(node)) throw new CliError("Cycle in creator tree; no inventory emitted.");
		if (visited.has(node)) return node.activity;
		visiting.add(node);
		for (const child of node.children) {
			const activity = rollup(child);
			node.complete = node.complete && child.complete;
			if (activity > node.activity) { node.activity = activity; node.limitingSlug = child.limitingSlug; }
		}
		visiting.delete(node); visited.add(node);
		return node.activity;
	}
	// Visit every node so a cyclic component cannot disappear as a rootless tree.
	for (const node of nodes) rollup(node);
	const compare = (a: Node, b: Node) => b.activity - a.activity ||
		(a.metadata.slug < b.metadata.slug ? -1 : a.metadata.slug > b.metadata.slug ? 1 : 0);
	const ordered: Node[] = [];
	function append(node: Node, prefix = "", connector = "") {
		node.prefix = prefix + connector;
		ordered.push(node);
		const childPrefix = prefix + (connector ? connector === "└── " ? "    " : "│   " : "");
		const children = node.children.sort(compare);
		children.forEach((child, index) => append(child, childPrefix, index === children.length - 1 ? "└── " : "├── "));
	}
	for (const root of roots.sort(compare)) append(root);
	return ordered;
}

// Binding inventory, not a claim about live Git state or cleanup eligibility.
// Read every record before output: an unreadable record cannot prove absence.
export function showInventory(root: string, json: boolean, options: PresentationOptions = {}, progress?: InspectionProgress): void {
	const records = sessionActivityTree(readMetadataInventory(root));
	const sessions = records.map(({ metadata: { slug, branch, worktreePath } }) =>
		({ slug, branch, worktreePath }));
	progress?.flush();
	if (json) {
		process.stdout.write(`${JSON.stringify({ version: 1, command: "list", sessions })}\n`);
		return;
	}
	if (!sessions.length) {
		process.stdout.write("No recorded agent sessions.\n");
		return;
	}
	const now = Date.now();
	const headers = ["SESSION", "BRANCH", "LAST ACTIVE", ...(options.verbose ? ["WORKTREE"] : [])];
	const rows = records.map(({ metadata, activity, prefix }) =>
		[prefix + metadata.slug, metadata.branch, formatActivityTime(activity, now), ...(options.verbose ? [metadata.worktreePath] : [])]);
	process.stdout.write(formatStateTable(headers, rows, options, (_row, column) => column === 0 ? 1 : column === 2 ? 36 : 2));
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

export interface ExactInspectionContext {
	root: string;
	config: AgentSessionConfig;
	configuredRoot: string;
	commonDirectory: string;
	registrations: Set<string> | null;
	recordsBySlug: Map<string, SessionMetadata>;
	bindingsByPath: Map<string, SessionMetadata[]>;
	problem?: string;
}

// A preview may share this read-only namespace snapshot. Standalone inspection
// and every apply target create a fresh one; never reuse it across effects.
export function snapshotExactResources(root: string): ExactInspectionContext {
	const config = loadConfig(root);
	const context: ExactInspectionContext = {
		root, config, configuredRoot: canonicalResourcePath(resolveWorktreeRoot(root, config.worktree_root)),
		commonDirectory: commonGitDirectory(root), registrations: null, recordsBySlug: new Map(), bindingsByPath: new Map(),
	};
	try {
		context.registrations = new Set(git(root, ["worktree", "list", "--porcelain", "-z"])
			.split("\0").filter((field) => field.startsWith("worktree ")).map((field) => resolve(field.slice("worktree ".length))));
		for (const record of readMetadataInventory(root)) {
			context.recordsBySlug.set(record.slug, record);
			const path = canonicalResourcePath(record.worktreePath);
			context.bindingsByPath.set(path, [...(context.bindingsByPath.get(path) ?? []), record]);
		}
	} catch (error) { context.problem = String(error); }
	return context;
}

export function inspectExactResource(root: string, path: string, sharedContext?: ExactInspectionContext) {
	let worktreePath = resolve(path);
	let resourceState: "present" | "absent" | "inconsistent" | "unknown" = "unknown";
	const evidence: { filesystem: string; metadata: string; registered: boolean | null } = {
		filesystem: "unknown", metadata: "unknown", registered: null,
	};
	const sessions: SessionStatus[] = [];
	let bindingSlugs: string[] = [];
	let problem: string | undefined;
	try {
		worktreePath = canonicalResourcePath(path);
		const context = sharedContext ?? snapshotExactResources(root);
		if (context.root !== root) throw new CliError("Inspection snapshot belongs to another repository.");
		const { config, configuredRoot } = context;
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
		evidence.registered = context.registrations?.has(worktreePath) ?? null;
		if (context.problem) throw new CliError(context.problem);
		// A directory name supplies a slot, not ownership or absence proof.
		// Read binding metadata, never unrelated checkout Git state. Ambiguous,
		// moved or unreadable records must not manufacture an absent resource.
		const ownRecord = context.recordsBySlug.get(slug);
		const bindings = context.bindingsByPath.get(worktreePath) ?? [];
		bindingSlugs = bindings.map((binding) => binding.slug);
		const recorded = ownRecord !== undefined;
		evidence.metadata = recorded || bindings.length ? "recorded" : "absent";
		if (bindings.length > 1 || (bindings.length === 1 && bindings[0]?.slug !== slug) || (ownRecord && !bindings.includes(ownRecord))) {
			resourceState = "inconsistent";
			problem = "Managed bindings are moved or ambiguous for this exact path. Inspect the binding catalogue; no resources were changed.";
		} else if (!recorded && !evidence.registered && evidence.filesystem === "absent") {
			resourceState = "absent";
		} else if (recorded && evidence.registered && evidence.filesystem === "present") {
			const metadata = ownRecord!;
			assertConfiguredWorktreePath(root, config, metadata);
			if (canonicalResourcePath(metadata.worktreePath) !== worktreePath || commonGitDirectory(worktreePath) !== context.commonDirectory) {
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
	return { version: 1, worktreePath, resourceState, evidence, bindingSlugs, sessions, ...(problem ? { problem } : {}) };
}

export function showExactStatus(root: string, path: string, json: boolean, options: PresentationOptions = {}, progress?: InspectionProgress): void {
	const result = inspectExactResource(root, path);
	progress?.flush();
	if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
	else {
		const state = result.resourceState[0].toUpperCase() + result.resourceState.slice(1);
		const colour = result.resourceState === "present" ? 32 : result.resourceState === "absent" ? 2 : 31;
		process.stdout.write(formatStateTable(["WORKTREE", "STATE"], [[result.worktreePath, state]], options, (_row, column) => column === 1 ? colour : undefined, { table: true }));
		process.stdout.write(formatLines(["", "1 resource inspected",
			...(options.verbose && result.problem ? result.problem.split("\n").map((line) => `  ${displayText(line)}`) : []),
		]));
	}
}

export function showStatus(
	root: string,
	slug: string | undefined,
	json: boolean,
	refresh: boolean,
	options: PresentationOptions = {},
	progress?: InspectionProgress,
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
		progress?.update(`Inspecting ${sessionSlug}`);
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
	progress?.flush();
	if (json) {
		process.stdout.write(
			`${JSON.stringify({ version: 1, operation, sessions: statuses })}\n`,
		);
		return;
	}
	if (operation) process.stdout.write(formatLines([
		styleText(`Operation active: ${displayText(operation.command)} (pid ${operation.pid})`, 33, options.color),
	]));
	if (statuses.length === 0) {
		process.stdout.write("No managed agent sessions.\n");
		return;
	}
	const special: Partial<Record<SessionStatus["state"], string>> = {
		broken: "Metadata needs inspection", orphaned: "Worktree missing", unrecorded: "Metadata missing", conflict: "Branch conflict",
	};
	const needsAttention = (session: SessionStatus) => session.state !== "ready" || ["unpushed", "behind", "diverged"].includes(session.publication);
	const colour = (session: SessionStatus) => special[session.state] ? 31 : needsAttention(session) ? 33 : 32;
	const state = (session: SessionStatus) => special[session.state] ?? [
		session.clean ? "Clean" : "Dirty", session.fresh ? "Fresh" : "Stale",
		session.publication[0].toUpperCase() + session.publication.slice(1),
	].join(" · ");
	const prDetail = (session: SessionStatus) => session.pr
		? [`  PR: ${displayText(pullRequestSummary(session.pr))}; base: ${displayText(session.pr.baseBranch)}`] : [];
	const details = (session: SessionStatus) => [
		`  Current branch: ${displayText(session.currentBranch ?? "unknown")}`,
		`  Initial branch: ${displayText(session.initialBranch || "unknown")}`,
		`  Owned branches: ${displayText(session.ownedBranches.join(", ") || "none")}`,
		...(session.problem ? session.problem.split("\n").map((line) => `  ${displayText(line)}`) : []),
	];
	const hasPr = statuses.some((session) => session.pr);
	process.stdout.write(formatStateTable(["SESSION", "BRANCH", "STATE", ...(hasPr ? ["PR"] : [])], statuses.map((session) =>
		[session.slug, (session.currentBranch ?? session.branch) || "unknown", state(session),
			...(hasPr ? [session.pr ? `#${session.pr.number} · ${session.pr.state}${session.pr.isDraft ? " · DRAFT" : ""}` : "—"] : [])]), options,
		(row, column) => column === 2 ? colour(statuses[row]) : column === 0 ? 1 : column === 3 ? 36 : undefined,
		{ table: true, shortenColumns: [1] }));
	if (slug && statuses[0].pr) process.stdout.write(formatLines(prDetail(statuses[0])));
	const count = statuses.filter(needsAttention).length;
	process.stdout.write(formatLines(["", `${statuses.length} session${statuses.length === 1 ? "" : "s"} · ${count} ${count === 1 ? "needs" : "need"} attention`]));
	if (options.verbose) for (const session of statuses) process.stdout.write(formatLines([
		"", `${displayText(session.slug)}:`, `  Worktree: ${displayText(session.worktreePath) || "unknown"}`, ...(!slug ? prDetail(session) : []), ...details(session),
	]));
}
