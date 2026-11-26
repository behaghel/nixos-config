import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { captureProcesses, rootKey } from "./batch.ts";
import { assertPrimaryCheckout, git } from "./git.ts";
import { inspectActiveOperation, metadataPath, readMetadata, readMetadataInventory, sessionDirectory, withOperationLock, writeMetadata } from "./sessions.ts";
import { CliError, confirm, writeCommandResult, formatLines, formatStateTable, cleanupDiagnostic, resourceResult, type InspectionProgress } from "./runtime.ts";
import type { PresentationOptions } from "./types.ts";

// A local engagement signal, not an operation lease or cleanup acknowledgement.
export function touchActivity(root: string, slug: string): number {
	return withOperationLock(root, "activity-touch", () => {
		sessionDirectory(root, slug);
		const metadata = readMetadata(root, slug);
		writeMetadata(root, { ...metadata, lastWorkAt: new Date().toISOString() });
		return 0;
	});
}

function identity(path: string): string[] {
	const stat = lstatSync(path, { bigint: true });
	return [stat.dev.toString(), stat.ino.toString()];
}

export function inspectReconciliation(root: string, slug: string) {
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

function describe(plan: ReturnType<typeof inspectReconciliation>, options: PresentationOptions, applied = false): string {
	if (!plan.operations.length) return resourceResult(plan.metadata.slug, "Unchanged", "No unsettled activity records", options, applied ? [] : ["0 proposed acknowledgements · Nothing changed"]);
	return formatLines([`Activity reconciliation · ${plan.metadata.slug}`, `Worktree: ${plan.metadata.worktreePath}`,
		"Only the listed records are acknowledged as interrupted, not completed. Original evidence is retained; lastWorkAt is unchanged.",
		"PID/cwd observations do not prove side effects completed. No worktrees or branches removed; cleanup needs separate approval.",
		...plan.blockers.map((blocker) => `Blocked: ${cleanupDiagnostic(blocker)}`), ""].map(cleanupDiagnostic)) +
		formatStateTable(["OPERATION", "STATE", "EVIDENCE"], plan.operations.map((operation) => [operation.id,
			applied ? "Interrupted" : plan.executionSupported ? "Would acknowledge" : "Preserved",
			`pid ${operation.pid}; host ${operation.hostname}; started ${operation.startedAt}; observed ${operation.state}`]), options, (_row, column) => column === 1 ? applied ? 33 : plan.executionSupported ? 36 : 31 : undefined) +
		formatLines([applied ? `${plan.operations.length} interrupted operation(s) acknowledged · no successful completion recorded` : `${plan.executionSupported ? plan.operations.length : 0} proposed acknowledgements · Nothing changed`]);
}

export function reconcileActivity(root: string, slug: string, dryRun: boolean, json: boolean, options: PresentationOptions = {}, progress?: InspectionProgress): number {
	const plan = inspectReconciliation(root, slug);
	progress?.flush();
	if (dryRun) {
		writeCommandResult({ version: 1, command: "activity reconcile", dryRun: true, slug,
			worktreePath: plan.metadata.worktreePath, operations: plan.operations, blockers: plan.blockers,
			processEvidence: plan.processEvidence, executionSupported: plan.executionSupported,
			acknowledgementOnly: true, resourcesRemoved: false }, json, describe(plan, options));
		return 0;
	}
	if (!plan.operations.length) {
		process.stdout.write(resourceResult(slug, "Unchanged", `No unsettled activity records for ${slug}; no metadata changed.`, options));
		return 0;
	}
	if (!process.stdin.isTTY) throw new CliError("Activity reconciliation requires terminal confirmation. Inspect first with activity reconcile --dry-run --json; --yes and --force are not supported.");
	if (!plan.executionSupported) {
		process.stdout.write(describe(plan, options));
		throw new CliError("Activity reconciliation blocked; no metadata changed.");
	}
	return confirmReconciliation(root, slug, plan, options);
}

export function confirmReconciliation(root: string, slug: string, plan: ReturnType<typeof inspectReconciliation>, options: PresentationOptions): number {
	if (!process.stdin.isTTY || !plan.executionSupported) throw new CliError("Activity reconciliation requires eligible operations and terminal confirmation.");
	process.stdout.write(describe(plan, options));
	if (!confirm("Acknowledge these operations as interrupted, not completed? [y/N]")) throw new CliError("Reconciliation cancelled; no metadata changed.");
	return withOperationLock(root, "activity reconciliation", () => {
		const current = inspectReconciliation(root, slug);
		if (!current.executionSupported || current.fingerprint !== plan.fingerprint) throw new CliError(`Activity evidence or session scope changed; inspect again. No metadata changed.${current.blockers.length ? ` ${current.blockers.join("; ")}` : ""}`);
		const acknowledgedAt = new Date().toISOString();
		writeMetadata(root, { ...current.metadata, activeOperations: [], acknowledgedInterruptions: [
			...(current.metadata.acknowledgedInterruptions ?? []),
			...(current.metadata.activeOperations ?? []).map((operation) => ({ ...operation, outcome: "interrupted" as const, acknowledgedAt })),
		] });
		process.stdout.write(describe(current, options, true));
		return 0;
	});
}
