import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { captureCreatorConversation, creatorConversationMatches } from "./creator.ts";
import { resolvePullRequest, fetchPullRequestHead, assertPullRequestTarget, prepareReviewSource, borrowedReviewSource, pullRequestSummary } from "./github.ts";
import { existsSync, lstatSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { constants } from "node:os";
import { unrecordedRetirementHint } from "./arguments.ts";
import { dirname, join } from "node:path";
import {
	git,
	assertPrimaryCheckout,
	ensureClean,
	localBranches,
	upstreamRemote,
	remoteDefaultBranch,
	cachedRemoteDefaultBranch,
	repositoryRoot,
} from "./git.ts";
import {
	loadConfig,
	validateSlug,
	readMetadata,
	readMetadataInventory,
	assertConfiguredWorktreePath,
	sessionDirectory,
	withOperationLock,
	metadataPath,
	sessionRecordExists,
	unrecordedWorktree,
	discoverManagedWorktrees,
	writeMetadata,
	withSessionActivity,
	resolveWorktreeRoot,
	creationParentSessionId,
	branchCreationMessage,
} from "./sessions.ts";
import {
	refreshMetadataRemote,
	inspectSession,
	statusCannotOperate,
	sessionBaseBranch,
} from "./inspection.ts";
import {
	CliError,
	confirm,
	progressReporter,
	withPreparation,
	styleText,
	runPhase,
	writeCommandResult,
	run,
} from "./runtime.ts";
import type { AgentSessionConfig, SessionMetadata, BranchOwnership, ProgressReporter, PullRequestSelection, PullRequestMetadata, PresentationOptions } from "./types.ts";

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
	stdio: "pipe" | "inherit" | "capture" = "inherit",
): number {
	if (command.length === 0) return 0;
	const [executable, ...args] = command;
	if (!executable) return 0;
	const result = run(executable, args, cwd, stdio, environment);
	if (stdio !== "inherit" && result.status !== 0) {
		const diagnostic = [result.stdout, result.stderr].filter(Boolean).join("\n");
		throw new CliError(`Configured command exited with status ${result.status}.${diagnostic ? `\n${diagnostic}` : ""}`);
	}
	return result.status;
}

function launchAgent(
	root: string,
	config: AgentSessionConfig,
	metadata: SessionMetadata,
	additionalArguments: string[] = [],
): number {
	process.stderr.write(`Launching agent in ${metadata.worktreePath}\n`);
	const agentStatus = withSessionActivity(root, metadata.slug, () => executeConfigured(
		[...config.agent_command, ...additionalArguments],
		metadata.worktreePath,
	));
	if (agentStatus !== 0) {
		process.stderr.write(
			`Agent exited with status ${agentStatus}; the session remains available to resume.\n`,
		);
	}
	return agentStatus;
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
			`Warning: session ${slug} has not integrated the latest ${metadata.remote}/${sessionBaseBranch(metadata, defaultBranch)}.\n`,
		);
	}
	process.stderr.write(`Launching ${metadata.branch}\n`);
	return { config, metadata };
}

export function launch(
	root: string,
	slug: string,
	operation = "launch",
	additionalArguments: string[] = [],
): number {
	const prepared = withOperationLock(root, operation, () =>
		prepareLaunch(root, slug),
	);
	return launchAgent(root, prepared.config, prepared.metadata, additionalArguments);
}

export function resume(root: string, slug: string): number {
	const prepared = withOperationLock(root, "resume", () => {
		const creator = readMetadata(root, slug).creatorConversation;
		if (!creator) return { ...prepareLaunch(root, slug), args: ["--continue"] };
		const parents = readMetadataInventory(root).filter((record) => record.sessionId === creator.parentSessionId);
		if (parents.length !== 1) throw new CliError("Creator worktree is missing or ambiguous; no substitute conversation was launched.");
		const parent = parents[0];
		try { sessionDirectory(root, parent.slug); }
		catch { throw new CliError(`Creator worktree ${parent.slug} is unavailable; no substitute conversation was launched.`); }
		if (!creatorConversationMatches(creator, parent.worktreePath)) {
			throw new CliError("Creator conversation is unavailable or no longer matches its recorded identity/worktree; no substitute conversation was launched.");
		}
		const target = prepareLaunch(root, parent.slug);
		if (target.metadata.sessionId !== creator.parentSessionId || target.metadata.worktreePath !== parent.worktreePath) {
			throw new CliError("Creator worktree identity changed; no substitute conversation was launched.");
		}
		// Preparation can refresh remotes; the origin may disappear or change
		// while that runs. Never let an exact-session launch create a substitute.
		if (!creatorConversationMatches(creator, target.metadata.worktreePath)) {
			throw new CliError("Creator conversation changed during resume preparation; no substitute conversation was launched.");
		}
		return { ...target, args: ["--session", creator.sessionFile] };
	});
	return launchAgent(root, prepared.config, prepared.metadata, prepared.args);
}

export function runInSession(root: string, slug: string, command: string[]): number {
	const cwd = sessionDirectory(root, slug);
	const result = withSessionActivity(root, slug, () => spawnSync("devenv", ["-q", "shell", "--", ...command], {
		cwd,
		stdio: "inherit",
	}));
	if (result.error) {
		throw new CliError(`Cannot run devenv: ${result.error.message}`);
	}
	return result.status ?? (result.signal ? 128 + constants.signals[result.signal] : 1);
}

export function createBranch(root: string, slug: string, name: string, json: boolean): void {
	withOperationLock(root, "branch-create", () => {
		const cwd = sessionDirectory(root, slug);
		const metadata = readMetadata(root, slug);
		if (!metadata.sessionId || !metadata.branches) throw new CliError("Branch creation requires recorded session identity and branch ownership; legacy sessions need an explicitly reviewed mapping.");
		if (!name || name === "HEAD" || name.startsWith("-") || run("git", ["check-ref-format", `refs/heads/${name}`], cwd).status !== 0) {
			throw new CliError(`Invalid branch name: ${name}`, 64);
		}
		if (localBranches(root).has(name)) throw new CliError(`Local branch ${name} already exists; refusing to adopt it.`);
		if (metadata.branches.some((branch) => branch.name === name)) throw new CliError(`Branch ${name} has an earlier ownership record; refusing to reuse its identity.`);
		inspectCreationBranch(root, name);
		const branch: BranchOwnership = { name, id: randomUUID(), creationCommit: git(cwd, ["rev-parse", "--verify", "HEAD"]) };
		// An empty expected old value makes ref creation atomic against ordinary
		// concurrent Git commands too. The unique marker proves this incarnation;
		// deleting/recreating the name or losing its log cannot inherit ownership.
		git(cwd, ["update-ref", "--create-reflog", "-m", branchCreationMessage(metadata.sessionId, branch.id),
			`refs/heads/${name}`, branch.creationCommit, ""]);
		try {
			writeMetadata(root, { ...metadata, branches: [...metadata.branches, branch], lastWorkAt: new Date().toISOString() });
		} catch (error) {
			// Preserve the ref on uncertain recording, never delete concurrent work.
			throw new CliError(`Branch ${name} was created but ownership recording failed; preserved as unclaimed. ${String(error)}`);
		}
		writeCommandResult({ version: 1, command: "branch", action: "create", slug, branch }, json,
			`Created session-owned branch ${name} at ${branch.creationCommit}. Current branch unchanged; switch explicitly when needed.\n`);
	});
}

function repairUnlocked(root: string, slug: string): void {
	validateSlug(slug);
	assertPrimaryCheckout(root);
	const config = loadConfig(root);
	if (sessionRecordExists(root, slug)) {
		throw new CliError(`Session metadata already exists: ${slug}`);
	}
	const worktree = discoverManagedWorktrees(root, config).get(slug);
	if (!worktree) {
		unrecordedWorktree(root, slug); // Establish a real local target before suggesting retirement.
		throw new CliError(unrecordedRetirementHint(slug));
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

export function repair(root: string, slug: string): void {
	withOperationLock(root, "repair", () => repairUnlocked(root, slug));
}

function previewCreate(
	root: string,
	slug: string,
	report: ProgressReporter,
	selection?: PullRequestSelection,
): Record<string, unknown> {
	return runPhase(report, "inspect-create", () => {
		validateSlug(slug);
		assertPrimaryCheckout(root);
		const config = loadConfig(root);
		creationParentSessionId(root);
		ensureClean(root, selection !== undefined);
		const currentBranch = git(root, ["branch", "--show-current"]);
		if (!currentBranch) {
			throw new CliError("Primary checkout must be on a branch.");
		}
		const remote = upstreamRemote(root, currentBranch);
		if (selection?.repository) assertPullRequestTarget(root, remote, selection);
		const defaultBranch = selection === undefined
			? remoteDefaultBranch(root, remote)
			: cachedRemoteDefaultBranch(root, remote);
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
		const branch = selection === undefined || selection.mode === "independent" ? `agent/${slug}` : null;
		const worktreePath = join(canonicalRoot, slug);
		if (sessionRecordExists(root, slug)) {
			throw new CliError(`Session already exists: ${slug}`);
		}
		if (existsSync(worktreePath) || lstatExists(worktreePath)) {
			throw new CliError(
				`Refusing to modify unmanaged assets at ${worktreePath}.`,
			);
		}
		if (branch !== null && (
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
		)) {
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
			base: selection === undefined ? `${remote}/${defaultBranch}` : null,
			...(selection === undefined ? {} : {
				pr: { number: selection.number, resolved: false, mode: selection.mode ?? "review", repository: null,
					url: null, baseBranch: null, headBranch: null, headCommit: null },
				trustRequired: true,
			}),
			agentLaunch: false,
			prepareCommand: config.prepare_command,
			localLinks: config.local_links,
		};
	});
}

function inspectCreationBranch(root: string, branch: string, independentRemote?: string, pr?: PullRequestMetadata): boolean {
	const occupied = git(root, ["worktree", "list", "--porcelain"]).split(/\n\n+/)
		.find((record) => record.split("\n").includes(`branch refs/heads/${branch}`));
	if (occupied) {
		const path = occupied.split("\n").find((line) => line.startsWith("worktree "))?.slice(9);
		throw new CliError(`PR branch ${branch} is already checked out at ${path}.`);
	}
	if (localBranches(root).has(branch)) {
		if (pr?.mode === "review") {
			borrowedReviewSource(root, branch, pr);
			return true;
		}
		throw new CliError(`Refusing to adopt preexisting local branch ${branch}.`);
	}
	if (independentRemote && run("git", ["show-ref", "--verify", "--quiet", `refs/remotes/${independentRemote}/${branch}`], root).status === 0) {
		throw new CliError(`Refusing to modify unmanaged assets for branch ${branch}.`);
	}
	const branchPattern = branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	if (run("git", ["config", "--get-regexp", `^branch\\.${branchPattern}\\.`], root).status === 0) {
		throw new CliError(`Refusing to overwrite preexisting local branch configuration for ${branch}.`);
	}
	return false;
}

function createSession(
	root: string,
	slug: string,
	report: ProgressReporter = progressReporter("create", false),
	json = false,
	selection?: PullRequestSelection,
	trustPr = false,
	verbose = false,
): { config: AgentSessionConfig; metadata: SessionMetadata } {
	validateSlug(slug);
	assertPrimaryCheckout(root);
	const config = loadConfig(root);
	ensureClean(root);
	const parentSessionId = creationParentSessionId(root);
	const creatorConversation = captureCreatorConversation(parentSessionId, repositoryRoot());
	const preexistingBranches = [...localBranches(root)].sort();

	const currentBranch = git(root, ["branch", "--show-current"]);
	if (!currentBranch)
		throw new CliError("Primary checkout must be on a branch.");
	const remote = upstreamRemote(root, currentBranch);
	if (selection?.repository) assertPullRequestTarget(root, remote, selection);
	const stdio = json ? "pipe" : verbose ? "inherit" : "capture";
	const defaultBranch = runPhase(report, "remote-sync", () => {
		const fetch = run("git", ["fetch", "--prune", remote], root, stdio);
		if (fetch.status !== 0) {
			const diagnostic = fetch.stderr || fetch.stdout;
			throw new CliError(`Failed to fetch remote ${remote}.${diagnostic ? `\n${diagnostic}` : ""}`);
		}
		return remoteDefaultBranch(root, remote);
	});
	if (currentBranch !== defaultBranch) {
		throw new CliError(`Primary checkout must be on ${defaultBranch}.`);
	}

	const pr = selection === undefined ? undefined : runPhase(report, "pr-resolve", () =>
		resolvePullRequest(root, remote, selection),
	);
	const branch = pr?.mode === "review" ? pr.headBranch : `agent/${slug}`;
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
	if (sessionRecordExists(root, slug))
		throw new CliError(`Session already exists: ${slug}`);
	if (existsSync(worktreePath) || lstatExists(worktreePath)) {
		throw new CliError(
			`Refusing to modify unmanaged assets at ${worktreePath}.`,
		);
	}
	let borrowed = false;
	if (pr) {
		borrowed = inspectCreationBranch(root, branch, pr.mode === "independent" ? remote : undefined, pr);
		if (borrowed && !preexistingBranches.includes(branch)) throw new CliError("PR branch appeared during creation; inspect it and retry.");
		runPhase(report, "pr-fetch", () => fetchPullRequestHead(root, remote, pr));
		if (!trustPr) runPhase(report, "pr-trust", () => {
			if (!process.stdin.isTTY) throw new CliError("PR execution requires explicit trust. Inspect the PR and re-run with --trust-pr.");
			report.flush?.();
			const accepted = confirm(`Trust ${pullRequestSummary(pr)} at commit ${pr.headCommit}? Its environment and preparation can execute code. [y/N]`);
			process.stderr.write("\n");
			if (!accepted) throw new CliError("PR creation cancelled; no PR code was executed.");
			// Confirmation can wait indefinitely; do not populate a slot or alter
			// branch configuration that appeared while the user was deciding.
			if (sessionRecordExists(root, slug) || lstatExists(worktreePath) ||
				git(root, ["branch", "--show-current"]) !== currentBranch) {
				throw new CliError("PR creation target changed during confirmation. Inspect it and retry.");
			}
			ensureClean(root);
			if (inspectCreationBranch(root, branch, pr.mode === "independent" ? remote : undefined, pr) !== borrowed) {
				throw new CliError("PR branch ownership changed during confirmation; inspect it and retry.");
			}
		});
	} else if (
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

	const sessionId = randomUUID();
	const initialOwnership: BranchOwnership | undefined = borrowed ? undefined : {
		name: branch, id: randomUUID(), creationCommit: git(root, ["rev-parse", pr?.headCommit ?? `${remote}/${defaultBranch}`]),
	};
	let created = false;
	let createdBranch = false;
	let recorded = false;
	let createdSourceRemote: string | undefined;
	try {
		if (pr?.mode === "review") runPhase(report, "pr-source", () => {
			const source = prepareReviewSource(root, remote, slug, pr, borrowed ? borrowedReviewSource(root, branch, pr) : undefined);
			if (borrowed) borrowedReviewSource(root, branch, pr);
			if (source.created) createdSourceRemote = source.remote;
			pr.sourceRemote = source.remote;
			if (source.missing) pr.sourceBranchMissing = true;
		});
		runPhase(report, "worktree-create", () => {
			if (initialOwnership) {
				git(root, ["update-ref", "--create-reflog", "-m", branchCreationMessage(sessionId, initialOwnership.id),
					`refs/heads/${branch}`, initialOwnership.creationCommit, ""]);
				createdBranch = true;
			}
			const added = run(
				"git",
				[
					"worktree",
					"add",
					worktreePath, branch,
				],
				root,
				stdio,
			);
			if (added.status !== 0) {
				const diagnostic = added.stderr || added.stdout;
				throw new CliError(`Could not create the agent worktree.${diagnostic ? `\n${diagnostic}` : ""}`);
			}
		});
		created = true;
		if (pr?.mode === "review" && !borrowed) runPhase(report, "pr-track", () => {
			if (pr.sourceBranchMissing) {
				git(root, ["config", `branch.${branch}.remote`, pr.sourceRemote!]);
				git(root, ["config", `branch.${branch}.merge`, `refs/heads/${pr.headBranch}`]);
			} else {
				git(root, ["branch", `--set-upstream-to=${pr.sourceRemote}/${branch}`, branch]);
			}
			if (git(root, ["config", "--get", `branch.${branch}.merge`]) !== `refs/heads/${pr.headBranch}` ||
				git(root, ["config", "--get", `branch.${branch}.remote`]) !== pr.sourceRemote) {
				throw new CliError("Conflicting PR source tracking; refusing to target another source branch.");
			}
			git(root, ["config", `branch.${branch}.pushRemote`, pr.sourceRemote!]);
		});
		runPhase(report, "worktree-prepare", () => {
			linkLocalFiles(root, worktreePath, config.local_links);
			try {
				const status = executeConfigured(config.prepare_command, worktreePath, process.env, stdio);
				if (status !== 0) throw new CliError(`Configured command exited with status ${status}.`);
			} catch (error) {
				throw new CliError(`Worktree preparation failed.\n${error instanceof Error ? error.message : String(error)}`);
			}
		});

		const metadata: SessionMetadata = {
			version: 3,
			sessionId,
			parentSessionId,
			branches: initialOwnership ? [initialOwnership] : [],
			slug,
			branch,
			worktreePath,
			remote,
			defaultBranch,
			createdAt: new Date().toISOString(),
			conversation: null,
			...(creatorConversation ? { creatorConversation } : {}),
			preexistingBranches,
			initialBranchOwned: !borrowed,
			...(pr ? { pr } : {}),
		};
		runPhase(report, "metadata-record", () => writeMetadata(root, metadata));
		recorded = true;
	} finally {
		if (created && !recorded) {
			const removed = run(
				"git",
				["worktree", "remove", "--force", worktreePath],
				root,
				stdio,
			);
			if (!json && removed.status !== 0) {
				report.flush?.();
				process.stderr.write(`Worktree cleanup could not be confirmed at ${worktreePath}; inspect it before retrying.\n${[removed.stdout, removed.stderr].filter(Boolean).join("\n")}\n`);
			}
		}
		if (createdBranch && !recorded && initialOwnership) {
			const head = run("git", ["rev-parse", "--verify", `refs/heads/${branch}`], root);
			// Keep native branch-deletion safeguards: update-ref -d would bypass
			// protection for a branch still checked out after failed removal.
			if (head.status === 0 && head.stdout === initialOwnership.creationCommit) {
				const deleted = run("git", ["branch", "-D", branch], root, stdio);
				if (!json && deleted.status !== 0) process.stderr.write(`Branch cleanup could not be confirmed for ${branch}; inspect it before retrying.\n${[deleted.stdout, deleted.stderr].filter(Boolean).join("\n")}\n`);
			} else process.stderr.write(`Branch ${branch} changed during preparation; preserved for review.\n`);
		}
		if (!recorded && createdSourceRemote) git(root, ["remote", "remove", createdSourceRemote]);
	}

	return { config, metadata: readMetadata(root, slug) };
}

function prepareSession(
	root: string, slug: string, report: ProgressReporter, json: boolean,
	selection?: PullRequestSelection, trustPr = false, verbose = false,
): { config: AgentSessionConfig; metadata: SessionMetadata; reused: boolean } {
	if (selection && sessionRecordExists(root, slug)) {
		return runPhase(report, "session-reuse", () => {
			const config = loadConfig(root);
			const metadata = readMetadata(root, slug);
			const primaryBranch = git(root, ["branch", "--show-current"]);
			const repository = assertPullRequestTarget(root, upstreamRemote(root, primaryBranch), selection);
			if (!metadata.pr || metadata.pr.repository !== repository || metadata.pr.number !== selection.number ||
				metadata.pr.mode !== (selection.mode ?? "review")) {
				throw new CliError(`Session ${slug} is bound to a different PR or branch mode; refusing to convert it.`);
			}
			sessionDirectory(root, slug);
			const status = inspectSession(metadata);
			if (statusCannotOperate(status)) throw new CliError(status.problem ?? `Session ${slug} is unusable.`);
			return { config, metadata, reused: true };
		});
	}
	if (selection && !trustPr && !process.stdin.isTTY) {
		throw new CliError("PR execution requires explicit trust. Inspect the PR and re-run with --trust-pr.");
	}
	return { ...createSession(root, slug, report, json, selection, trustPr, verbose), reused: false };
}

function reportCreated(metadata: SessionMetadata, json = false, reused = false, options: PresentationOptions = {}): void {
	writeCommandResult(
		{ version: 1, command: "create", dryRun: false, session: metadata },
		json,
		`${styleText(`Ready · ${metadata.slug}${reused ? " (reused)" : ""}`, 32, options.color)}\n  Branch: ${metadata.branch}\n  Worktree: ${metadata.worktreePath}\n${metadata.pr ? `  PR: ${pullRequestSummary(metadata.pr)}; base: ${metadata.pr.baseBranch}\n` : ""}`,
	);
}

export function create(
	root: string,
	slug: string,
	dryRun: boolean,
	json: boolean,
	selection?: PullRequestSelection,
	trustPr = false,
	options: PresentationOptions = {},
): number {
	if (dryRun) {
		const plan = withPreparation("create", slug, json, options, (report) => previewCreate(root, slug, report, selection));
		writeCommandResult(
			{ version: 1, command: "create", dryRun: true, plan },
			json,
			selection === undefined
				? `Would create ${String(plan.branch)} at ${String(plan.worktreePath)} from ${String(plan.base)}.\n`
				: `Would prepare PR #${selection.number} at ${String(plan.worktreePath)}. ${selection.mode === "independent" ? `Independent branch ${String(plan.branch)} requested; PR identity and head are unresolved` : "PR identity, branch and head are unresolved"}; offline preview uses cached ${String(plan.remote)}/${String(plan.defaultBranch)} for the primary-checkout guard. Execution requires trust.\n`,
		);
		return 0;
	}
	const prepared = withPreparation("create", slug, json, options, (report) => withOperationLock(root, "create", () =>
		prepareSession(root, slug, report, json, selection, trustPr, options.verbose),
	));
	reportCreated(prepared.metadata, json, prepared.reused, options);
	return 0;
}

export function start(
	root: string,
	slug: string,
	launchConfiguredAgent: boolean,
	selection?: PullRequestSelection,
	trustPr = false,
	options: PresentationOptions = {},
): number {
	const prepared = withPreparation("start", slug, false, options, (report) => withOperationLock(root, "start", () =>
		prepareSession(root, slug, report, false, selection, trustPr, options.verbose),
	));
	if (launchConfiguredAgent) {
		return launchAgent(root, prepared.config, prepared.metadata);
	}
	reportCreated(prepared.metadata, false, prepared.reused, options);
	return 0;
}
