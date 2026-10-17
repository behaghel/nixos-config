import { spawnSync } from "node:child_process";
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
	progressReporter,
	runPhase,
	writeCommandResult,
	run,
} from "./runtime.ts";
import type { AgentSessionConfig, SessionMetadata, ProgressReporter } from "./types.ts";

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
	json = false,
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
				json ? "pipe" : "inherit",
			);
			if (added.status !== 0) {
				const diagnostic = added.stderr || added.stdout;
				throw new CliError(`Could not create the agent worktree.${diagnostic ? `\n${diagnostic}` : ""}`);
			}
		});
		created = true;
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
	}

	if (!json) process.stderr.write(`Agent worktree ready: ${branch}\n`);
	return { config, metadata: readMetadata(root, slug) };
}

function reportCreated(metadata: SessionMetadata, json = false): void {
	writeCommandResult(
		{ version: 1, command: "create", dryRun: false, session: metadata },
		json,
		`Session created without launching the configured agent.\nWorktree: ${metadata.worktreePath}\n`,
	);
}

export function create(
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
		createSession(root, slug, report, json),
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
