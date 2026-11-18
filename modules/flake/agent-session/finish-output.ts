import { spawnSync } from "node:child_process";
import { fstatSync } from "node:fs";
import { confirm, formatLines, formatStateTable, styleText } from "./runtime.ts";
import { ignoredDataProblem, type IgnoredDataInspection } from "./artifacts.ts";
import type { PresentationOptions } from "./types.ts";
import type { Outcome } from "./batch.ts";
import { writeCleanupDiagnostics } from "./batch-output.ts";

export interface CleanupScope {
	slug: string;
	worktreePath: string;
	metadataPath?: string;
	currentBranch?: string | null;
	ownedBranches: string[];
	keepBranch: boolean;
	force?: boolean;
	unrecorded?: boolean;
	head?: string;
	ignoredData?: IgnoredDataInspection;
}

interface Asset {
	slug?: string;
	id: string;
	kind: string;
	detail: string;
	preserve: boolean;
	state: string;
}

/** Human presentation only. Native cleanup, validation and consent stay outside. */
export class FinishOutput {
	private scope?: CleanupScope;
	private assets: Asset[] = [];
	private frame: string[] = [];
	private frameWidth = 0;
	private frameRows = 0;
	private current?: Asset;
	private tree = false;
	private reviewNotes: string[] = [];
	private review?: { height: number; columns: number; rows: number };
	private reusingReview = false;
	private finished = false;
	private failed = false;
	private summary = "";
	started = false;
	private readonly options: PresentationOptions;

	constructor(options: PresentationOptions) { this.options = options; }

	private setScope(scope: CleanupScope): void {
		this.scope = scope;
		this.assets = this.scopeAssets(scope);
	}

	private scopeAssets(scope: CleanupScope): Asset[] {
		const assets: Asset[] = [{ id: "worktree", kind: "Worktree", detail: scope.worktreePath, preserve: false, state: "Pending" }];
		for (const branch of scope.ownedBranches) assets.push({ id: `branch:${branch}`, kind: "Branch", detail: branch, preserve: scope.keepBranch, state: "Pending" });
		if (scope.unrecorded) assets.push({ id: "all-branches", kind: "Branches", detail: "All local branches; no ownership inferred", preserve: true, state: "Pending" });
		else if (scope.currentBranch && !scope.ownedBranches.includes(scope.currentBranch)) assets.push({ id: "borrowed", kind: "Borrowed branch", detail: scope.currentBranch, preserve: true, state: "Pending" });
		for (const path of scope.ignoredData?.approvedArtifacts ?? []) {
			const tree = scope.ignoredData?.policyRoots.find((root) => root.path === path)?.tree ?? scope.ignoredData?.ignoredPaths.find((entry) => entry.path === path);
			const note = tree?.type === "directory" ? `; entire subtree, ${tree.size.entries} entries, including logs and task databases` : tree?.type === "symlink" ? "; link only, target preserved" : "";
			assets.push({ id: `artifact:${path}`, kind: "Artifact", detail: path + note, preserve: false, state: "Pending" });
		}
		if (!scope.unrecorded && scope.metadataPath) assets.push({ id: "record", kind: "Session record", detail: scope.metadataPath, preserve: false, state: "Pending" });
		return assets;
	}

	private render(plan: boolean, preview = false, blocked?: string): string {
		const scope = this.scope!;
		const title = plan ? `${preview ? "Preview" : "Cleanup plan"} · ${scope.slug}` : `${this.failed ? "Cleanup incomplete" : this.finished ? "Finished" : "Cleaning up"} · ${scope.slug}`;
		const rows = this.assets.map((asset) => [...(this.tree ? [asset.slug!] : []), asset.kind,
			(plan ? asset.preserve ? "Would preserve" : blocked ? "Blocked" : asset.id.startsWith("branch:") ? "Would delete" : "Would remove" : asset.state).padEnd(14), asset.detail]);
		const colour = (index: number) => {
			const asset = this.assets[index];
			return plan ? asset.preserve ? 2 : blocked ? 31 : 33
				: ["Removed", "Deleted"].includes(asset.state) ? 32 : asset.state === "Preserved" ? 2 : ["Uncertain", "Refused"].includes(asset.state) ? 31 : 36;
		};
		let text = formatLines([styleText(title, this.failed || blocked ? 31 : this.finished ? 32 : 1, this.options.color), ""]);
		text += formatStateTable([...(this.tree ? ["SESSION"] : []), "ASSET", "ACTION", "DETAIL"], rows, this.options, (row, column) => column === (this.tree ? 2 : 1) ? colour(row) : undefined, { table: !process.stdout.isTTY || (process.stdout.columns || 80) >= (this.tree ? 80 : 24) });
		if (plan) {
			const notes = ["", ...(scope.force ? [`Force discards uncommitted and ignored local files.${scope.unrecorded ? "" : " Deleting branches can also discard unpublished commits."}`] : []),
				...(!this.tree && scope.head ? [`HEAD: ${scope.head}`] : []), ...(scope.unrecorded ? ["Force will preserve all branches; no ownership metadata is inferred."] : []),
				...(scope.unrecorded && !scope.currentBranch ? ["Detached HEAD commits may become unreachable; create a branch first if needed."] : []),
				...this.reviewNotes, "Link targets and remote assets are preserved.", ...(blocked ? [`Cleanup blocked: ${blocked}`] : []),
				...(preview ? ["Nothing changed"] : [])];
			text += formatLines(notes);
		} else if (this.finished || this.failed) text += formatLines(["", this.summary]);
		return text;
	}

	preview(plan: Record<string, unknown>): string {
		const ignoredData = plan.ignoredData as IgnoredDataInspection | undefined;
		this.setScope({ slug: String(plan.slug ?? "unrecorded"), worktreePath: String(plan.worktreePath),
			metadataPath: String(plan.metadataPath), currentBranch: plan.currentBranch as string | null,
			ownedBranches: (plan.ownedBranches as string[]) ?? [], keepBranch: plan.allBranchesPreserved === true || plan.keepBranch === true,
			force: plan.force === true, unrecorded: plan.allBranchesPreserved === true, head: plan.head as string | undefined, ignoredData });
		const blocked = plan.force ? undefined : ignoredData?.safe === false ? ignoredDataProblem(ignoredData)
			: plan.clean !== true || !["ready", "stale"].includes(String(plan.state)) ? `state=${String(plan.state)}, clean=${String(plan.clean)}` : undefined;
		return this.render(true, true, blocked);
	}

	plan(scope: CleanupScope): void {
		this.setScope(scope);
		this.writePlan();
	}

	private writePlan(): void {
		const text = this.render(true);
		this.review = { height: text.split("\n").length - 1, columns: process.stdout.columns || 80, rows: process.stdout.rows || 24 };
		process.stdout.write(text);
	}

	planTree(slug: string, scopes: CleanupScope[], branches: { slug: string; name: string; preserve: boolean; detail: string }[]): void {
		this.scope = { ...scopes[0]!, slug };
		this.assets = scopes.flatMap((scope) => this.scopeAssets(scope).map((asset) => ({ ...asset, slug: scope.slug })));
		this.tree = true;
		for (const asset of this.assets) {
			if (!asset.id.startsWith("branch:") && asset.id !== "borrowed") continue;
			const branch = branches.find((branch) => branch.slug === asset.slug && branch.name === asset.detail);
			if (branch) { asset.preserve = branch.preserve; asset.detail = branch.detail; }
		}
		this.writePlan();
	}

	/** Reviewed local refs are not projected as owned branches. */
	planHistory(scope: Omit<CleanupScope, "ownedBranches" | "currentBranch" | "keepBranch">, branches: { name: string; preserve: boolean; detail: string }[], warning: string): void {
		this.scope = { ...scope, ownedBranches: [], keepBranch: true };
		this.assets = this.scopeAssets(this.scope).map((asset) => ({ ...asset, slug: scope.slug }));
		this.assets.splice(1, 0, ...branches.map((branch) => ({ slug: scope.slug, id: `branch:${branch.name}`, kind: "Reviewed branch", detail: branch.detail, preserve: branch.preserve, state: "Pending" })));
		this.tree = true; this.reviewNotes = [warning, "Other worktrees are outside this selection."];
		this.writePlan();
	}

	treeResource(outcome: Outcome, redraw = true): void {
		for (const asset of this.assets) {
			if (asset.slug !== outcome.slug || asset.id.startsWith("branch:") || asset.id === "borrowed") continue;
			asset.state = outcome.outcome === "finished" ? "Removed" : outcome.outcome === "absent" ? "Absent" : outcome.outcome === "uncertain" ? "Uncertain" : "Not attempted";
		}
		this.current = undefined; if (redraw) this.update();
	}

	finishTree(outcomes: Outcome[], branches: { name: string; outcome: "deleted" | "refused"; problem?: string }[]): string {
		for (const outcome of outcomes) this.treeResource(outcome, false);
		for (const asset of this.assets) {
			if (!asset.id.startsWith("branch:") && asset.id !== "borrowed") continue;
			const branch = branches.find((branch) => asset.id === `branch:${branch.name}`);
			asset.state = branch?.outcome === "deleted" ? "Deleted" : branch && !branch.problem?.startsWith("Earlier branch deletion failed;") ? "Refused" : "Preserved";
		}
		this.failed = outcomes.some((outcome) => !["finished", "absent"].includes(outcome.outcome)) || branches.some((branch) => branch.outcome === "refused");
		this.finished = !this.failed; this.summary = this.counts();
		this.clear();
		writeCleanupDiagnostics([...outcomes, ...branches.filter((branch) => branch.problem && !branch.problem.startsWith("Earlier branch deletion failed;")).map((branch): Outcome => ({ slug: branch.name, worktreePath: "", outcome: "refused", reason: "branch-deletion-refused", problem: branch.problem }))], this.options);
		return this.render(false);
	}

	/** Observe terminal layout, never change its settings or infer consent. */
	private terminal(): { columns: number; rows: number } | undefined {
		if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stderr.isTTY || process.env.TERM === "dumb" || this.options.verbose) return;
		try {
			const devices = [0, 1, 2].map((fd) => { const stat = fstatSync(fd); return `${stat.dev}:${stat.ino}:${stat.rdev}`; });
			if (!devices.every((device) => device === devices[0])) return;
			const options = { stdio: ["inherit", "pipe", "pipe"] as ["inherit", "pipe", "pipe"], encoding: "utf8" as const, timeout: 1000 };
			const modes = spawnSync("stty", ["-a"], options);
			if (modes.status !== 0 || !["echo", "icanon", "opost", "onlcr"].every((mode) => new RegExp(`(?:^|[\\s;])${mode}(?=$|[\\s;])`).test(modes.stdout))) return;
			const size = spawnSync("stty", ["size"], options);
			if (size.status !== 0 || !/^\d+\s+\d+\s*$/.test(size.stdout)) return;
			const [rows, columns] = size.stdout.trim().split(/\s+/).map(Number);
			return rows > 0 && columns > 0 ? { rows, columns } : undefined;
		} catch { return; }
	}

	confirm(force = false): boolean {
		const question = force ? "Discard these assets? [y/N]" : "Remove these assets? [y/N]";
		const before = this.terminal();
		const accepted = confirm(question, (simpleEcho) => {
			const after = this.terminal(), review = this.review;
			if (!simpleEcho || !before || !after || !review || before.columns !== after.columns || before.rows !== after.rows || review.columns !== after.columns || review.rows !== after.rows || review.height + 2 >= after.rows || question.length + 4 >= after.columns) return;
			this.frame = Array(review.height + 1).fill("");
			this.frameWidth = process.stdout.columns;
			this.frameRows = process.stdout.rows;
			this.reusingReview = true;
		});
		if (!this.reusingReview) process.stderr.write("\n");
		return accepted;
	}

	begin(): void {
		if (this.reusingReview) {
			const terminal = this.terminal();
			if (!terminal || terminal.columns !== this.review?.columns || terminal.rows !== this.review?.rows) this.frame = [];
			this.reusingReview = false;
		}
		this.started = true;
		for (const asset of this.assets) if (asset.preserve) asset.state = "Preserved";
		this.update();
	}

	starting(id: string, state: string, slug?: string): void {
		const asset = this.assets.find((entry) => entry.id === id && (!slug || entry.slug === slug));
		this.current = asset;
		if (asset) asset.state = state;
		this.update();
	}

	removedWorktree(): void {
		for (const asset of this.assets) if (asset.id === "worktree" || asset.id.startsWith("artifact:")) asset.state = "Removed";
		this.current = undefined;
		this.update();
	}

	completed(id: string, state: string, slug?: string): void {
		const asset = this.assets.find((entry) => entry.id === id && (!slug || entry.slug === slug));
		if (asset) asset.state = state;
		this.current = undefined;
		this.update();
	}

	private counts(): string {
		const count = (test: (asset: Asset) => boolean) => this.assets.filter(test).length;
		const branch = (state: string) => count((asset) => (asset.id.startsWith("branch:") || asset.id === "borrowed") && asset.state === state);
		if (this.tree) {
			const total = (id: string, state: string, noun: string) => { const value = count((asset) => (id === "artifact:" ? asset.id.startsWith(id) : asset.id === id) && asset.state === state); return value ? `${value} ${noun}${value === 1 ? "" : "s"} ${state.toLowerCase()}` : ""; };
			return [total("worktree", "Removed", "worktree") || "0 worktrees removed", total("worktree", "Absent", "worktree"), `${branch("Preserved")} branch${branch("Preserved") === 1 ? "" : "es"} preserved`,
				...(branch("Deleted") ? [`${branch("Deleted")} branch${branch("Deleted") === 1 ? "" : "es"} deleted`] : []), total("artifact:", "Removed", "artifact"), total("record", "Removed", "record"),
				...(count((asset) => asset.state === "Refused") ? [`${count((asset) => asset.state === "Refused")} branch deletion${count((asset) => asset.state === "Refused") === 1 ? "" : "s"} refused`] : []),
				...(count((asset) => asset.state === "Uncertain") ? [`${count((asset) => asset.state === "Uncertain")} uncertain`] : []),
				...(count((asset) => asset.state === "Not attempted") ? [`${count((asset) => asset.state === "Not attempted")} not attempted`] : [])].filter(Boolean).join(" · ");
		}
		const worktree = this.assets.find((asset) => asset.id === "worktree")?.state;
		return [worktree === "Removed" ? "1 worktree removed" : worktree === "Unregistered" ? "1 registration removed" : worktree === "Absent" ? "worktree already absent" : "",
			...(this.scope?.unrecorded ? ["all branches preserved", "no session record changed"] : []),
			...(branch("Preserved") ? [`${branch("Preserved")} branch${branch("Preserved") === 1 ? "" : "es"} preserved`] : []),
			...(branch("Deleted") ? [`${branch("Deleted")} branch${branch("Deleted") === 1 ? "" : "es"} deleted`] : []),
			...(count((asset) => asset.id.startsWith("artifact:") && asset.state === "Removed") ? [`${count((asset) => asset.id.startsWith("artifact:") && asset.state === "Removed")} artifact${count((asset) => asset.id.startsWith("artifact:") && asset.state === "Removed") === 1 ? "" : "s"} removed`] : []),
			...(this.assets.some((asset) => asset.id === "record" && asset.state === "Removed") ? ["1 record removed"] : []),
			...(count((asset) => asset.state === "Uncertain") ? [`${count((asset) => asset.state === "Uncertain")} uncertain`] : [])].filter(Boolean).join(" · ");
	}

	finish(summary: string): void {
		this.finished = true;
		this.summary = `${this.scope?.unrecorded ? "Unrecorded worktree removed locally" : this.scope?.force ? "Session force-finished locally" : "Session finished locally"} · ${this.counts()}`;
		if (this.options.verbose) this.summary += `\n${summary}`;
		this.clear(); process.stdout.write(this.render(false));
	}

	abort(): void {
		if (!this.started) return;
		this.failed = true;
		for (const asset of this.assets) {
			if (asset === this.current || (this.current?.id === "worktree" && asset.slug === this.current.slug && asset.id.startsWith("artifact:"))) asset.state = "Uncertain";
			else if (asset.state === "Pending") asset.state = "Not attempted";
		}
		this.summary = `${this.counts()}\nCleanup could not be fully confirmed; inspect remaining resources before retrying.`;
		this.clear(); process.stdout.write(this.render(false));
	}

	private clear(): void {
		// A resize invalidates the old cursor position; leave that frame alone.
		if (this.frame.length && this.frameWidth === process.stdout.columns && this.frameRows === process.stdout.rows) process.stdout.write(`\r\x1b[${this.frame.length}A` + "\x1b[2K\n".repeat(this.frame.length) + `\x1b[${this.frame.length}A\r`);
		this.frame = [];
	}

	private update(): void {
		if (!process.stdout.isTTY || process.env.TERM === "dumb" || this.options.verbose) return;
		this.clear();
		if ((process.stdout.columns || 80) < 24) {
			const asset = this.current ?? this.assets[0];
			this.frame = [[...`${asset.state} · ${asset.kind}`].slice(0, Math.max(1, (process.stdout.columns || 80) - 1)).join("")];
			this.frameWidth = process.stdout.columns;
			this.frameRows = process.stdout.rows;
			process.stdout.write(this.frame[0] + "\n");
			return;
		}
		let lines = this.render(false).trimEnd().split("\n");
		const height = Math.max(3, (process.stdout.rows || 24) - 2);
		if (lines.length > height) {
			const size = Math.max(1, Math.floor((height - 5) / 2));
			const start = Math.max(0, Math.min(this.assets.findIndex((asset) => asset === this.current), this.assets.length - size));
			const visible = this.assets.slice(start, start + size);
			const text = formatLines([`Cleaning up · ${this.scope!.slug}`, ""]) + formatStateTable([...(this.tree ? ["SESSION"] : []), "ASSET", "ACTION"], visible.map((asset) => [...(this.tree ? [asset.slug!] : []), asset.kind, asset.state]), this.options, undefined, { table: true });
			lines = text.trimEnd().split("\n");
			if (lines.length < height && visible.length < this.assets.length) lines.push(...formatLines([`${this.assets.length - visible.length} more; full result follows`]).trimEnd().split("\n"));
		}
		this.frame = lines.slice(0, height);
		this.frameWidth = process.stdout.columns;
		this.frameRows = process.stdout.rows;
		process.stdout.write(this.frame.join("\n") + "\n");
	}
}
