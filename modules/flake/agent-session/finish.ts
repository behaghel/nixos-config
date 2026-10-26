import { createHash } from "node:crypto";
import { existsSync, lstatSync, unlinkSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { sessionCommand } from "./arguments.ts";
import {
	git,
	localBranches,
	worktreeIsRegistered,
	assertPrimaryCheckout,
	ensureClean,
	countRevisionRange,
	branchUpstreamIsGone,
} from "./git.ts";
import {
	validateSlug,
	loadConfig,
	readMetadata,
	assertConfiguredWorktreePath,
	metadataPath,
	withOperationLock,
	metadataSlugs,
	sessionRecordExists,
	unrecordedWorktree,
	discoverManagedWorktrees,
} from "./sessions.ts";
import {
	inspectSession,
	inspectExactResource,
	statusCannotOperate,
	refreshMetadataRemote,
	sessionRemotes,
	sessionBaseBranch,
} from "./inspection.ts";
import {
	CliError,
	confirm,
	progressReporter,
	runPhase,
	writeCommandResult,
	run,
} from "./runtime.ts";
import type { SessionMetadata, ProgressReporter } from "./types.ts";

function assertNotInvokingWorktree(
	metadata: Pick<SessionMetadata, "worktreePath">,
	invocationRoot: string,
): void {
	if (metadata.worktreePath === invocationRoot) {
		throw new CliError(
			"Cannot remove the worktree containing the current shell. Run finish from another repository worktree.",
		);
	}
}

function previewUnrecordedFinish(root: string, invocationRoot: string, slug: string): Record<string, unknown> {
	assertPrimaryCheckout(root);
	const target = unrecordedWorktree(root, slug);
	assertNotInvokingWorktree(target, invocationRoot);
	return {
		slug, branch: target.currentBranch, initialBranch: null, currentBranch: target.currentBranch,
		head: target.head, ownedBranches: [], worktreePath: target.worktreePath,
		metadataPath: metadataPath(root, slug), force: true, keepBranch: true,
		state: "unrecorded", clean: null, allBranchesPreserved: true,
		uncommittedWorkWillBeDiscarded: true, detachedHeadMayBecomeUnreachable: target.currentBranch === null,
		remoteAssetsModified: false,
	};
}

function forceFinishUnrecorded(root: string, invocationRoot: string, slug: string, yes: boolean): void {
	assertPrimaryCheckout(root);
	const target = unrecordedWorktree(root, slug);
	assertNotInvokingWorktree(target, invocationRoot);
	process.stderr.write(`Force-remove unrecorded worktree, including uncommitted and ignored local files:\n  worktree: ${target.worktreePath}\n  current branch: ${target.currentBranch ?? "detached HEAD"}\n  HEAD: ${target.head}\nAll branches will be preserved; no ownership metadata will be invented.\n`);
	if (target.currentBranch === null) process.stderr.write("Warning: detached HEAD commits may become unreachable. Create a branch first if you need to retain them.\n");
	if (!yes) {
		if (!process.stdin.isTTY) throw new CliError(`Confirmation required. Re-run: ${sessionCommand(slug, "finish")} --force --yes`);
		if (!confirm("Discard this unrecorded worktree and preserve all branches? [y/N]")) throw new CliError("Cleanup cancelled.");
	}
	// Recheck absence and physical/Git identity after the confirmation wait. Do
	// not fall back to recorded cleanup if metadata appeared in the meantime.
	const current = unrecordedWorktree(root, slug);
	assertNotInvokingWorktree(current, invocationRoot);
	if (JSON.stringify(current) !== JSON.stringify(target)) throw new CliError("Unrecorded worktree target changed; obtain a fresh preview before cleanup.");
	const removed = run("git", ["worktree", "remove", "--force", target.worktreePath], root, "inherit");
	if (removed.status !== 0) throw new CliError("Could not remove the unrecorded worktree; branches were not deleted.");
	process.stdout.write("Unrecorded worktree removed locally. All branches preserved; no session record created or deleted. Remote assets were not modified.\n");
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
	let ownedBranches = metadata.initialBranchOwned !== false && localBranches(root).has(metadata.branch)
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
				`Confirmation required. Re-run: ${sessionCommand(slug, "finish")} --force --yes`,
			);
		}
		if (!confirm("Discard local session assets? [y/N]")) {
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
	const mergedDefault = `${metadata.remote}/${sessionBaseBranch(metadata, defaultBranch)}`;
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
				`Confirmation required. Re-run: ${sessionCommand(slug, "finish")} --yes`,
			);
		}
		if (!confirm(keepBranch ? "Remove local worktree and preserve branches? [y/N]" : "Delete local worktree and branch? [y/N]")) {
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
	const disposition = status.ownedBranches.length === 0
		? "Borrowed branches preserved."
		: keepBranch
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

export function finish(
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
		const plan = force && !sessionRecordExists(root, slug)
			? runPhase(report, "inspect-finish", () => previewUnrecordedFinish(root, invocationRoot, slug))
			: previewFinish(root, invocationRoot, slug, force, keepBranch, report);
		const branches = (plan.ownedBranches as string[]).join(", ") || "none";
		writeCommandResult(
			{ version: 1, command: "finish", dryRun: true, plan },
			json,
			plan.allBranchesPreserved === true
				? `Would remove unrecorded local worktree ${String(plan.worktreePath)} and preserve all branches. Force discards uncommitted and ignored local files.${plan.detachedHeadMayBecomeUnreachable ? " Detached HEAD commits may become unreachable; create a branch first if needed." : ""}\n`
				: `Would remove local worktree ${String(plan.worktreePath)} and ${keepBranch ? "preserve" : "delete"} session-owned branches: ${branches}.\n`,
		);
		return;
	}
	runPhase(report, "cleanup", () =>
		withOperationLock(root, "finish", () => {
			// Only this explicit-slug entrypoint may retire an unrecorded slot.
			// Bulk cleanup continues to use recorded metadata exclusively.
			if (force && !sessionRecordExists(root, slug)) {
				if (expected) throw new CliError("Forced unrecorded cleanup does not accept a recorded-session receipt.");
				return forceFinishUnrecorded(root, invocationRoot, slug, yes);
			}
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

// Same-user cwd evidence supplements managed leases. It does not claim to
// discover editors with cwd elsewhere, detached jobs or remote owners.
function processDirectories(): { pid: number; path: string }[] {
	if (!process.getuid) throw new CliError("Process cwd evidence is unavailable on this platform.");
	const result = run("lsof", ["-n", "-P", "-a", "-d", "cwd", "-u", String(process.getuid()), "-F0pn"], process.cwd());
	if (result.status !== 0 || result.stderr) throw new CliError("Cannot establish process cwd evidence; check lsof availability and permissions.");
	const directories: { pid: number; path: string }[] = [];
	let pid: number | undefined;
	for (const raw of result.stdout.split("\0")) {
		const field = raw.replace(/^\n/, "");
		if (/^p\d+$/.test(field)) pid = Number(field.slice(1));
		else if (field.startsWith("n") && pid) directories.push({ pid, path: field.slice(1) });
	}
	if (!directories.length) throw new CliError("Process cwd evidence was empty or unrecognized.");
	return directories;
}

function operationIsLive(pid: number): boolean {
	try { process.kill(pid, 0); return true; }
	catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

function latestObservedWork(metadata: SessionMetadata, branches: string[]): { lastWorkAt: string; sources: string[] } {
	const timestamps = [Date.parse(metadata.createdAt), Date.parse(metadata.lastWorkAt ?? metadata.createdAt)];
	const sources = ["creation", ...(metadata.lastWorkAt ? ["managed-work"] : []), "checkout-and-owned-branch-reflogs", "working-file-mtimes"];
	// %ct is the commit timestamp, NOT the time of a checkout/reset. %gD with
	// --date=unix supplies the actual reflog event time, including old commits.
	for (const revision of ["HEAD", ...branches]) {
		const entries = git(metadata.worktreePath, ["reflog", "show", "--date=unix", "--format=%gD", revision]);
		for (const entry of entries ? entries.split("\n") : []) {
			const match = entry.match(/@\{(\d+)\}$/);
			if (!match) throw new CliError("Unrecognized reflog activity evidence.");
			timestamps.push(Number(match[1]) * 1000);
		}
	}
	const files = git(metadata.worktreePath, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
	for (const file of files.split("\0").filter(Boolean)) timestamps.push(lstatSync(join(metadata.worktreePath, file)).mtimeMs);
	if (timestamps.some((timestamp) => !Number.isFinite(timestamp))) throw new CliError("Invalid activity timestamps.");
	return { lastWorkAt: new Date(timestamps.reduce((latest, timestamp) => Math.max(latest, timestamp))).toISOString(), sources };
}

export function previewInactiveFinish(
	root: string,
	invocationRoot: string,
	options: { inactiveFor: string; inactiveMs: number; exclusions: string[]; json: boolean },
): void {
	const config = loadConfig(root);
	const now = Date.now();
	let directories: { pid: number; path: string }[] = [];
	let processProblem: string | undefined;
	try { directories = processDirectories(); }
	catch (error) { processProblem = String(error); }
	const discovered = discoverManagedWorktrees(root, config);
	const slugs = [...new Set([...metadataSlugs(root), ...discovered.keys(), ...options.exclusions])].sort();
	const resources = slugs.map((slug) => {
		const base = { slug, keepBranch: true, allBranchesPreserved: true };
		if (options.exclusions.includes(slug)) return { ...base, reason: "excluded" };
		try {
			const metadata = readMetadata(root, slug);
			assertConfiguredWorktreePath(root, config, metadata);
			const target = { ...base, worktreePath: metadata.worktreePath };
			if (metadata.worktreePath === invocationRoot) return { ...target, reason: "invoking-worktree" };
			const exact = inspectExactResource(root, metadata.worktreePath);
			if (exact.resourceState !== "present") return { ...target, reason: "unresolved-resource", evidence: exact.evidence, problem: exact.problem };
			const status = exact.sessions[0];
			if (!status?.clean) return { ...target, reason: "dirty" };
			for (const operation of metadata.activeOperations ?? []) {
				if (operation.hostname !== hostname()) return { ...target, reason: "uncertain-operation", problem: "Activity owner is on another host." };
				if (operationIsLive(operation.pid)) return { ...target, reason: "live-operation", pid: operation.pid };
				return { ...target, reason: "uncertain-operation", problem: "An interrupted managed operation has no confirmed completion. Inspect its saved lease; polling does not clear it." };
			}
			if (processProblem) return { ...target, reason: "unknown-process-evidence", problem: processProblem };
			const live = directories.filter((entry) => entry.path === metadata.worktreePath || entry.path.startsWith(`${metadata.worktreePath}/`));
			if (live.length) return { ...target, reason: "live-cwd", pids: live.map((entry) => entry.pid) };
			const stat = lstatSync(metadata.worktreePath);
			if (process.getuid && stat.uid !== process.getuid()) return { ...target, reason: "other-owner" };
			const ignored = git(metadata.worktreePath, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"]);
			if (ignored) return { ...target, reason: "ignored-local-data", problem: "Ignored local files require review; age does not authorize discarding them." };
			const activity = latestObservedWork(metadata, status.ownedBranches);
			const reason = Date.parse(activity.lastWorkAt) > now - options.inactiveMs ? "recent-activity" : "eligible";
			return { ...target, reason, activity };
		} catch (error) { return { ...base, reason: "unresolved-evidence", problem: String(error) }; }
	});
	writeCommandResult({
		version: 1, command: "batch finish", dryRun: true,
		inactiveFor: options.inactiveFor, observedAt: new Date(now).toISOString(),
		cutoff: new Date(now - options.inactiveMs).toISOString(),
		keepBranch: true, remoteAssetsModified: false, exclusions: options.exclusions,
		resources,
		limitations: [
			"Activity is observed, not proof of disposability. Exclude retained or otherwise active work explicitly.",
			"Managed launch/resume/run record start and completion; interrupted leases refuse eligibility.",
			"Unmanaged evidence covers checkout/owned-branch reflogs and current non-ignored file mtimes, not a complete history.",
			"Process evidence covers same-user cwd in this worktree, not editors elsewhere, other users or remote processes.",
			"Restored timestamps and expired reflogs can hide older activity; ignored local data is refused.",
		],
	}, options.json, `Inactive-session preview: ${resources.filter((resource) => resource.reason === "eligible").length} eligible; no resources changed.\n${resources.map((resource) => `  ${resource.slug}: ${resource.reason}`).join("\n")}\n`);
}

function confirmBulkFinish(mode: "all" | "gone", count: number, yes: boolean) {
	if (yes || count === 0) return;
	if (!process.stdin.isTTY) {
		throw new CliError(
			`Confirmation required. Re-run: agent-session finish --${mode} --yes`,
		);
	}
	if (!confirm(`Finish ${count} local session(s)? [y/N]`)) {
		throw new CliError("Finish cancelled.");
	}
}

export function finishBulk(
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
				for (const remote of new Set(records.flatMap(sessionRemotes))) {
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
