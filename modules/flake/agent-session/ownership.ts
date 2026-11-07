import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { git, assertPrimaryCheckout } from "./git.ts";
import { rootKey } from "./batch.ts";
import { inspectExactResource, snapshotExactResources, sharedBranchClaims } from "./inspection.ts";
import { branchCreationMessage, metadataPath, withOperationLock, writeMetadata } from "./sessions.ts";
import { CliError, writeCommandResult } from "./runtime.ts";
import type { BranchOwnership, OwnershipOptions } from "./types.ts";

interface MappingPlan {
	slug: string;
	worktreePath: string;
	currentBranch: string;
	parentSlug: string | null;
	sessionId: string;
	parentSessionId: string | null;
	branch: BranchOwnership | null;
	fingerprint: string;
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
function identity(path: string): string[] {
	const stat = lstatSync(path, { bigint: true });
	return [stat.dev.toString(), stat.ino.toString()];
}

function inspectMapping(root: string, options: OwnershipOptions, seed?: MappingPlan, reviewMarkerWritten = false) {
	assertPrimaryCheckout(root);
	const context = snapshotExactResources(root);
	if (context.problem) throw new CliError(context.problem);
	const metadata = context.recordsBySlug.get(options.slug);
	if (!metadata) throw new CliError(`No managed session: ${options.slug}`);
	if (metadata.version === 3) throw new CliError("Session is already mapped; ownership mapping is not a transfer command.");
	if (metadata.activeOperations?.length) throw new CliError("Managed activity is recorded; stop or review it before mapping ownership.");
	const shared = sharedBranchClaims([...context.recordsBySlug.values()]).filter((branch) => branch.claims.some((claim) => claim.slug === metadata.slug));
	if (shared.length) throw new CliError(`Shared branch claims: ${shared.map((branch) => `${branch.name} (${branch.claims.map((claim) => claim.slug).join(", ")})`).join("; ")}; no ownership mapping performed.`);
	const exact = inspectExactResource(root, metadata.worktreePath, context);
	if (exact.resourceState !== "present") throw new CliError(exact.problem ?? "Legacy checkout identity is unresolved; no mapping performed.");
	const status = exact.sessions[0]!;
	if (status.currentBranch !== metadata.branch) throw new CliError("The saved initial branch is not checked out; renamed or unclaimed branches require separate review.");
	const sessionId = metadata.sessionId ?? seed?.sessionId ?? randomUUID();
	if (!validId(sessionId)) throw new CliError("Invalid proposed session identity.");
	const ids = new Map<string, typeof metadata>();
	for (const record of context.recordsBySlug.values()) {
		if (!record.sessionId) continue;
		if (ids.has(record.sessionId)) throw new CliError("Duplicate session identities; mapping is unresolved.");
		ids.set(record.sessionId, record);
	}
	if (ids.has(sessionId) && ids.get(sessionId)!.slug !== metadata.slug) throw new CliError("Proposed session identity already belongs to another session.");
	let parentSessionId: string | null = null;
	const ancestry: string[] = [];
	if (options.parent !== null) {
		if (options.parent === options.slug) throw new CliError("Ownership cycle: a session cannot parent itself.");
		const parent = context.recordsBySlug.get(options.parent);
		if (!parent || parent.version !== 3) throw new CliError("Parent must be an explicitly mapped session; map the parent first.");
		if (inspectExactResource(root, parent.worktreePath, context).resourceState !== "present") throw new CliError("Parent checkout identity is unresolved.");
		parentSessionId = parent.sessionId!;
		let current = parent;
		const seen = new Set<string>();
		while (current.sessionId) {
			if (current.sessionId === sessionId || seen.has(current.sessionId)) throw new CliError("Ownership cycle; no mapping performed.");
			seen.add(current.sessionId);
			ancestry.push(readFileSync(metadataPath(root, current.slug), "utf8"));
			if (current.parentSessionId === null) break;
			const ancestor = ids.get(current.parentSessionId!);
			if (!ancestor) throw new CliError("Parent ancestry is unresolved; no mapping performed.");
			current = ancestor;
		}
	}
	if (metadata.parentSessionId !== undefined && metadata.parentSessionId !== parentSessionId) throw new CliError("Recorded ancestry differs; mapping cannot transfer an existing owner.");
	const head = git(metadata.worktreePath, ["rev-parse", "--verify", `refs/heads/${metadata.branch}`]);
	const branch = metadata.initialBranchOwned === false ? null : {
		name: metadata.branch, id: seed?.branch?.id ?? randomUUID(), creationCommit: head,
	};
	if (branch && !validId(branch.id)) throw new CliError("Invalid proposed branch identity.");
	const gitDirectory = realpathSync(git(metadata.worktreePath, ["rev-parse", "--absolute-git-dir"]));
	let reflog = git(metadata.worktreePath, ["reflog", "show", "--date=unix", "--format=%gD%x09%H%x09%gs", `refs/heads/${metadata.branch}`]);
	if (reviewMarkerWritten && branch) {
		const suffix = `\t${branch.creationCommit}\t${branchCreationMessage(sessionId, branch.id)}`;
		const lines = reflog.split("\n"), retained = lines.filter((line) => !line.endsWith(suffix));
		if (lines.length - retained.length !== 1) throw new CliError("Could not verify the unique review marker; metadata is unchanged.");
		reflog = retained.join("\n");
	}
	const fields = { slug: metadata.slug, worktreePath: metadata.worktreePath, currentBranch: metadata.branch,
		parentSlug: options.parent, sessionId, parentSessionId, branch };
	const fingerprint = hash(JSON.stringify([fields, rootKey(root), readFileSync(metadataPath(root, metadata.slug), "utf8"),
		identity(metadata.worktreePath), gitDirectory, identity(gitDirectory), head,
		reflog, ancestry]));
	return { plan: { ...fields, fingerprint } satisfies MappingPlan, metadata };
}

function encode(plan: MappingPlan): string {
	const body = Buffer.from(JSON.stringify({ version: 1, plan })).toString("base64url");
	return `ownership-v1.${body}.${hash(body)}`;
}

function decode(options: OwnershipOptions): MappingPlan {
	try {
		const [prefix, body = "", checksum] = options.expected!.split(".");
		if (prefix !== "ownership-v1" || body.length > 2_000_000 || hash(body) !== checksum) throw new Error("Invalid encoding.");
		const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
		if (value.version !== 1 || value.plan?.slug !== options.slug || value.plan.parentSlug !== options.parent ||
			!validId(value.plan.sessionId) || !/^[a-f0-9]{64}$/.test(value.plan.fingerprint)) throw new Error("Mapping selection differs.");
		return value.plan;
	} catch (error) { throw new CliError(`Invalid ownership receipt; obtain a fresh preview. ${String(error)}`, 64); }
}

export function mapOwnership(root: string, options: OwnershipOptions): void {
	if (options.dryRun) {
		const { plan } = inspectMapping(root, options);
		writeCommandResult({ version: 1, command: "ownership", dryRun: true, plan, receipt: encode(plan),
			resourcesRemoved: false, refsModified: false, reflogWillBeModified: plan.branch !== null }, options.json,
			`Would map ${plan.slug} at ${plan.worktreePath} to session ${plan.sessionId}.\nParent: ${plan.parentSlug ?? "explicit root"} (${plan.parentSessionId ?? "none"}).\nInitial branch: ${plan.currentBranch} (${plan.branch ? "retain recorded ownership; append review marker to its reflog" : "borrowed; preserved, not owned"}).\nNo resources changed.\nReceipt: ${encode(plan)}\n`);
		return;
	}
	const approved = decode(options);
	withOperationLock(root, "ownership mapping", () => {
		const { plan, metadata } = inspectMapping(root, options, approved);
		if (JSON.stringify(plan) !== JSON.stringify(approved)) throw new CliError("Ownership evidence changed; obtain a fresh reviewed preview. No mapping performed.");
		if (plan.branch) {
			// Explicit review binds the saved initial branch's current incarnation.
			// reflog write adds evidence without moving the ref or touching files.
			git(metadata.worktreePath, ["reflog", "write", `refs/heads/${plan.branch.name}`, plan.branch.creationCommit,
				plan.branch.creationCommit, branchCreationMessage(plan.sessionId, plan.branch.id)]);
			if (git(metadata.worktreePath, ["rev-parse", "--verify", `refs/heads/${plan.branch.name}`]) !== plan.branch.creationCommit) {
				throw new CliError("Branch changed during mapping; metadata is unchanged. Obtain a fresh preview.");
			}
		}
		const final = inspectMapping(root, options, approved, plan.branch !== null);
		if (JSON.stringify(final.plan) !== JSON.stringify(approved)) throw new CliError("Ownership evidence changed during mapping; obtain a fresh review. Any appended marker alone grants no mapping.");
		try {
			writeMetadata(root, { ...metadata, version: 3, sessionId: plan.sessionId, parentSessionId: plan.parentSessionId,
				initialBranchOwned: plan.branch !== null, branches: plan.branch ? [plan.branch] : [] });
		} catch (error) {
			throw new CliError(`Ownership metadata update could not be confirmed; inspect status before retrying. A review marker alone grants no mapping. ${String(error)}`);
		}
		writeCommandResult({ version: 1, command: "ownership", dryRun: false, plan, resourcesRemoved: false,
			refsModified: false, reflogModified: plan.branch !== null }, options.json,
			`Mapped legacy session ${plan.slug}; parent: ${plan.parentSlug ?? "explicit root"}. Worktrees, files, commits and branch refs preserved. No retirement authorized.\n`);
	});
}
