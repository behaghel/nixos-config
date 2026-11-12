import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { captureProcesses, rootKey } from "./batch.ts";
import { assertPrimaryCheckout, git } from "./git.ts";
import { inspectActiveOperation, metadataPath, readMetadata, readMetadataInventory, sessionDirectory, withOperationLock, writeMetadata } from "./sessions.ts";
import { CliError, confirm, writeCommandResult } from "./runtime.ts";

function identity(path: string): string[] {
	const stat = lstatSync(path, { bigint: true });
	return [stat.dev.toString(), stat.ino.toString()];
}

function inspectReconciliation(root: string, slug: string) {
	assertPrimaryCheckout(root);
	const metadata = readMetadata(root, slug);
	const path = metadataPath(root, slug);
	const recordStat = lstatSync(path);
	if (!recordStat.isFile() || recordStat.isSymbolicLink()) throw new CliError("Reconciliation requires a regular session record; no metadata changed.");
	const raw = readFileSync(path, "utf8");
	if (JSON.stringify(metadata) !== JSON.stringify(JSON.parse(raw))) throw new CliError("Session metadata changed during inspection; review again.");
	const worktree = sessionDirectory(root, slug);
	if (worktree !== metadata.worktreePath || readMetadataInventory(root).filter((record) => record.worktreePath === worktree).length !== 1) throw new CliError("Session binding is changed or ambiguous; no metadata changed.");
	if (!process.getuid || recordStat.uid !== process.getuid() || lstatSync(worktree).uid !== process.getuid()) throw new CliError("Cannot establish same-user ownership of the record and worktree; no metadata changed.");
	const gitDirectory = realpathSync(git(worktree, ["rev-parse", "--absolute-git-dir"]));
	const fingerprint = createHash("sha256").update(JSON.stringify([
		rootKey(root), raw, identity(path), identity(worktree), gitDirectory, identity(gitDirectory),
	])).digest("hex");
	const active = metadata.activeOperations ?? [];
	const processes = active.length ? captureProcesses() : undefined;
	const pids = processes?.entries.filter((entry) => entry.path === worktree || entry.path.startsWith(`${worktree}/`)).map((entry) => entry.pid) ?? [];
	// Probe the recorded owners after the cwd scan, close to the eventual write.
	const operations = active.map((operation) => ({ ...operation, ...inspectActiveOperation(operation) }));
	const blockers = operations.filter((operation) => operation.state !== "interrupted").map((operation) =>
		`Operation ${operation.id} (pid ${operation.pid}, ${operation.hostname}): ${operation.state}${operation.problem ? ` (${operation.problem})` : ""}`);
	if (processes?.problem) blockers.push(processes.problem);
	if (pids.length) blockers.push(`Processes still have cwd in this worktree: ${pids.join(", ")}. Leave/stop that work before reconciliation.`);
	return { metadata, fingerprint, operations, blockers,
		executionSupported: operations.length > 0 && blockers.length === 0,
		processEvidence: processes ? { observedAt: processes.observedAt, complete: !processes.problem, pids, ...(processes.problem ? { problem: processes.problem } : {}) } : null,
	};
}

function describe(plan: ReturnType<typeof inspectReconciliation>): string {
	return `Activity reconciliation for ${plan.metadata.slug}\n  worktree: ${plan.metadata.worktreePath}\n${plan.operations.map((operation) =>
		`  ${operation.id}: pid ${operation.pid}, host ${operation.hostname}, started ${operation.startedAt}: ${operation.state}\n`).join("")}${plan.blockers.map((blocker) => `  blocked: ${blocker}\n`).join("")}` +
		"Only the listed activity records will be acknowledged as interrupted, not completed. Original records are retained in acknowledgement history; lastWorkAt is unchanged.\n" +
		"PID/cwd observations do not establish that detached jobs or side effects completed. A live PID may be reused and remains blocked. No worktree or branch will be removed; cleanup still requires its own safety checks and approval.\n";
}

export function reconcileActivity(root: string, slug: string, dryRun: boolean, json: boolean): number {
	const plan = inspectReconciliation(root, slug);
	if (dryRun) {
		writeCommandResult({ version: 1, command: "activity reconcile", dryRun: true, slug,
			worktreePath: plan.metadata.worktreePath, operations: plan.operations, blockers: plan.blockers,
			processEvidence: plan.processEvidence, executionSupported: plan.executionSupported,
			acknowledgementOnly: true, resourcesRemoved: false }, json, `${describe(plan)}No metadata changed.\n`);
		return 0;
	}
	if (!plan.operations.length) {
		process.stdout.write(`No unsettled activity records for ${slug}; no metadata changed.\n`);
		return 0;
	}
	if (!process.stdin.isTTY) throw new CliError("Activity reconciliation requires terminal confirmation. Inspect first with activity reconcile --dry-run --json; --yes and --force are not supported.");
	process.stderr.write(describe(plan));
	if (!plan.executionSupported) throw new CliError("Activity reconciliation blocked; no metadata changed.");
	if (!confirm("Acknowledge these operations as interrupted, not completed? [y/N]")) throw new CliError("Reconciliation cancelled; no metadata changed.");
	return withOperationLock(root, "activity reconciliation", () => {
		const current = inspectReconciliation(root, slug);
		if (!current.executionSupported || current.fingerprint !== plan.fingerprint) throw new CliError(`Activity evidence or session scope changed; inspect again. No metadata changed.${current.blockers.length ? ` ${current.blockers.join("; ")}` : ""}`);
		const acknowledgedAt = new Date().toISOString();
		writeMetadata(root, { ...current.metadata, activeOperations: [], acknowledgedInterruptions: [
			...(current.metadata.acknowledgedInterruptions ?? []),
			...(current.metadata.activeOperations ?? []).map((operation) => ({ ...operation, outcome: "interrupted" as const, acknowledgedAt })),
		] });
		process.stdout.write(`Acknowledged ${current.operations.length} interrupted operation(s) for ${slug}. Original evidence retained, no successful completion recorded. No worktrees or branches removed.\n`);
		return 0;
	});
}
