import { spawnSync } from "node:child_process";
import { resolvePullRequest, fetchPullRequestHead, assertPullRequestTarget, prepareReviewSource } from "./github.ts";
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
} from "./git.ts";
import {
	loadConfig,
	validateSlug,
	readMetadata,
	assertConfiguredWorktreePath,
	sessionDirectory,
	withOperationLock,
	metadataPath,
	sessionRecordExists,
	unrecordedWorktree,
	discoverManagedWorktrees,
	writeMetadata,
	resolveWorktreeRoot,
} from "./sessions.ts";
import {
	refreshMetadataRemote,
	inspectSession,
	statusCannotOperate,
} from "./inspection.ts";
import {
	CliError,
	confirm,
	progressReporter,
	runPhase,
	writeCommandResult,
	run,
} from "./runtime.ts";
import type { AgentSessionConfig, SessionMetadata, ProgressReporter, PullRequestSelection } from "./types.ts";

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
	stdio: "pipe" | "inherit" = "inherit",
): number {
	if (command.length === 0) return 0;
	const [executable, ...args] = command;
	if (!executable) return 0;
	const result = run(executable, args, cwd, stdio, environment);
	if (stdio === "pipe" && result.status !== 0) {
		const diagnostic = result.stderr || result.stdout;
		throw new CliError(`Configured command exited with status ${result.status}.${diagnostic ? `\n${diagnostic}` : ""}`);
	}
	return result.status;
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

export function launch(
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

export function runInSession(root: string, slug: string, command: string[]): number {
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

function assertNewSessionBranch(root: string, branch: string, independentRemote?: string): void {
	const occupied = git(root, ["worktree", "list", "--porcelain"]).split(/\n\n+/)
		.find((record) => record.split("\n").includes(`branch refs/heads/${branch}`));
	if (occupied) {
		const path = occupied.split("\n").find((line) => line.startsWith("worktree "))?.slice(9);
		throw new CliError(`PR branch ${branch} is already checked out at ${path}.`);
	}
	if (localBranches(root).has(branch)) {
		throw new CliError(`Refusing to adopt preexisting local branch ${branch}; branch reuse is not supported yet.`);
	}
	if (independentRemote && run("git", ["show-ref", "--verify", "--quiet", `refs/remotes/${independentRemote}/${branch}`], root).status === 0) {
		throw new CliError(`Refusing to modify unmanaged assets for branch ${branch}.`);
	}
	const branchPattern = branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	if (run("git", ["config", "--get-regexp", `^branch\\.${branchPattern}\\.`], root).status === 0) {
		throw new CliError(`Refusing to overwrite preexisting local branch configuration for ${branch}.`);
	}
}

function createSession(
	root: string,
	slug: string,
	report: ProgressReporter = progressReporter("create", false),
	json = false,
	selection?: PullRequestSelection,
	trustPr = false,
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
	if (selection?.repository) assertPullRequestTarget(root, remote, selection);
	const defaultBranch = runPhase(report, "remote-sync", () => {
		const fetch = run("git", ["fetch", "--prune", remote], root, json ? "pipe" : "inherit");
		if (fetch.status !== 0) {
			const diagnostic = fetch.stderr || fetch.stdout;
			throw new CliError(`Failed to fetch remote ${remote}.${diagnostic ? `\n${diagnostic}` : ""}`);
		}
		return remoteDefaultBranch(root, remote);
	});
	if (currentBranch !== defaultBranch) {
		throw new CliError(`Primary checkout must be on ${defaultBranch}.`);
	}

	const pr = selection === undefined ? undefined : runPhase(report, "pr-resolve", () => {
		const resolved = resolvePullRequest(root, remote, selection);
		if (resolved.baseBranch !== defaultBranch) {
			throw new CliError("PRs targeting a non-default base branch are not supported yet.");
		}
		return resolved;
	});
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
	if (pr) {
		assertNewSessionBranch(root, branch, pr.mode === "independent" ? remote : undefined);
		runPhase(report, "pr-fetch", () => fetchPullRequestHead(root, remote, pr));
		if (!trustPr) runPhase(report, "pr-trust", () => {
			if (!process.stdin.isTTY) throw new CliError("PR execution requires explicit trust. Inspect the PR and re-run with --trust-pr.");
			const accepted = confirm(`Trust ${pr.url} at commit ${pr.headCommit}? Its environment and preparation can execute code. [y/N]`);
			process.stderr.write("\n");
			if (!accepted) throw new CliError("PR creation cancelled; no PR code was executed.");
			// Confirmation can wait indefinitely; do not populate a slot or alter
			// branch configuration that appeared while the user was deciding.
			if (sessionRecordExists(root, slug) || lstatExists(worktreePath) ||
				git(root, ["branch", "--show-current"]) !== currentBranch) {
				throw new CliError("PR creation target changed during confirmation. Inspect it and retry.");
			}
			ensureClean(root);
			assertNewSessionBranch(root, branch, pr.mode === "independent" ? remote : undefined);
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

	let created = false;
	let recorded = false;
	let createdSourceRemote: string | undefined;
	try {
		if (pr?.mode === "review") runPhase(report, "pr-source", () => {
			const source = prepareReviewSource(root, remote, slug, pr);
			if (source.created) createdSourceRemote = source.remote;
			pr.sourceRemote = source.remote;
		});
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
					pr?.headCommit ?? `${remote}/${defaultBranch}`,
				],
				root,
				json ? "pipe" : "inherit",
			);
			if (added.status !== 0) {
				const diagnostic = added.stderr || added.stdout;
				throw new CliError(`Could not create the agent worktree.${diagnostic ? `\n${diagnostic}` : ""}`);
			}
		});
		created = true;
		if (pr?.mode === "review") runPhase(report, "pr-track", () => {
			git(root, ["branch", `--set-upstream-to=${pr.sourceRemote}/${branch}`, branch]);
			if (git(root, ["config", "--get", `branch.${branch}.merge`]) !== `refs/heads/${pr.headBranch}` ||
				git(root, ["config", "--get", `branch.${branch}.remote`]) !== pr.sourceRemote) {
				throw new CliError("Conflicting PR source tracking; refusing to target another source branch.");
			}
			git(root, ["config", `branch.${branch}.pushRemote`, pr.sourceRemote!]);
		});
		runPhase(report, "worktree-prepare", () => {
			linkLocalFiles(root, worktreePath, config.local_links);
			if (executeConfigured(config.prepare_command, worktreePath, process.env, json ? "pipe" : "inherit") !== 0) {
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
			...(pr ? { pr } : {}),
		};
		runPhase(report, "metadata-record", () => writeMetadata(root, metadata));
		recorded = true;
	} finally {
		if (created && !recorded) {
			run(
				"git",
				["worktree", "remove", "--force", worktreePath],
				root,
				json ? "pipe" : "inherit",
			);
			run("git", ["branch", "-D", branch], root, json ? "pipe" : "inherit");
		}
		if (!recorded && createdSourceRemote) git(root, ["remote", "remove", createdSourceRemote]);
	}

	if (!json) process.stderr.write(`Agent worktree ready: ${branch}\n`);
	return { config, metadata: readMetadata(root, slug) };
}

function reportCreated(metadata: SessionMetadata, json = false): void {
	writeCommandResult(
		{ version: 1, command: "create", dryRun: false, session: metadata },
		json,
		`Session created without launching the configured agent.\nWorktree: ${metadata.worktreePath}\n${metadata.pr ? `PR: ${metadata.pr.url} (${metadata.pr.state})\n` : ""}`,
	);
}

export function create(
	root: string,
	slug: string,
	dryRun: boolean,
	json: boolean,
	selection?: PullRequestSelection,
	trustPr = false,
): number {
	if (!dryRun && selection !== undefined && !trustPr && !process.stdin.isTTY) {
		throw new CliError("PR execution requires explicit trust. Inspect the PR and re-run with --trust-pr.");
	}
	const report = progressReporter("create", json);
	if (dryRun) {
		const plan = previewCreate(root, slug, report, selection);
		writeCommandResult(
			{ version: 1, command: "create", dryRun: true, plan },
			json,
			selection === undefined
				? `Would create ${String(plan.branch)} at ${String(plan.worktreePath)} from ${String(plan.base)}.\n`
				: `Would prepare PR #${selection.number} at ${String(plan.worktreePath)}. ${selection.mode === "independent" ? `Independent branch ${String(plan.branch)} requested; PR identity and head are unresolved` : "PR identity, branch and head are unresolved"}; offline preview uses cached ${String(plan.remote)}/${String(plan.defaultBranch)} for the primary-checkout guard. Execution requires trust.\n`,
		);
		return 0;
	}
	const prepared = withOperationLock(root, "create", () =>
		createSession(root, slug, report, json, selection, trustPr),
	);
	reportCreated(prepared.metadata, json);
	return 0;
}

export function start(
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
