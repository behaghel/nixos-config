import { stripVTControlCharacters } from "node:util";
import { displayText, formatLines, formatStateTable, styleText } from "./runtime.ts";
import type { Outcome, Target } from "./batch.ts";
import type { PresentationOptions } from "./types.ts";

const reasons: Record<string, string> = {
	"confirmed-removal": "Local assets removed", "reconciled-removal": "Removal reconciled",
	"confirmed-absence": "Confirmed absent", "changed-since-preview": "Changed since approval",
	"native-removal-unconfirmed": "Native removal not confirmed", "operation-guard": "Operation guard refused cleanup",
	"inspection-or-cleanup-failed": "Cleanup could not be confirmed", "residual-evidence-changed": "Residual evidence changed",
	"branch-evidence-changed": "Branch evidence changed", dirty: "Uncommitted changes",
	"tree-preflight": "Tree preflight refused cleanup", "revalidation-failed": "Revalidation failed",
	"cleanup-not-confirmed": "Cleanup could not be confirmed", "earlier-target-not-finished": "Earlier target not finished",
	excluded: "Excluded", "invoking-worktree": "Current worktree", "unresolved-resource": "Binding needs inspection",
	"uncertain-operation": "Operation needs review", "live-operation": "Managed work active",
	"unknown-process-evidence": "Cannot verify processes", "live-cwd": "Process using worktree",
	"other-owner": "Different owner", "ignored-local-data": "Ignored data needs review",
	"unknown-activity": "Activity incomplete", "recent-activity": "Recent activity",
	"worktree-locked": "Worktree locked", submodules: "Submodules need review", "unresolved-evidence": "Inspection incomplete",
};
const states: Record<Outcome["outcome"], string> = { finished: "Removed", absent: "Already absent", refused: "Refused", uncertain: "Uncertain" };
const outcomeState = (outcome: Outcome) => outcome.reason === "earlier-target-not-finished" ? "Not attempted" : states[outcome.outcome];
const pendingReasons = ["Not processed", "Revalidating approved scope", "Native worktree removal"];
const reason = (value: string) => reasons[value] ?? displayText(value.replace(/-/g, " "));

// Keep native wording except terminal instructions and credential values. The
// original backend evidence and JSON envelope are not changed by presentation.
function diagnostic(text: string): string {
	return stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, " ")
		.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1[redacted]@")
		.replace(/(Authorization:\s*(?:Bearer|Basic)\s+)[^\s]+/gi, "$1[redacted]");
}

export function writeCleanupDiagnostics(outcomes: Outcome[], options: PresentationOptions): void {
	const evidence = new Map<string, Outcome[]>();
	for (const outcome of outcomes) {
		if (!outcome.problem || outcome.problem === outcome.reason) continue;
		const affected = evidence.get(outcome.problem);
		if (affected) affected.push(outcome); else evidence.set(outcome.problem, [outcome]);
	}
	for (const [problem, affected] of evidence) {
		const label = affected.length === 1 ? displayText(affected[0].slug) : `${affected.length} resources`;
		const state = [...new Set(affected.map(outcomeState))].join(" / ");
		process.stderr.write(`${styleText(`${label}: ${state}`, 31, options.color, process.stderr.isTTY)}\n${diagnostic(problem)}\n`);
	}
}

/** Displays already-approved targets; never selects, approves or removes them. */
export class BatchOutput {
	private readonly outcomes = new Map<string, Outcome>();
	private current?: string;
	private phase: "Checking" | "Removing" = "Checking";
	private frame: string[] = [];
	private columns = 0;
	private terminalRows = 0;
	private readonly nameWidth: number;
	readonly live: boolean;
	private readonly targets: readonly Target[];
	private readonly options: PresentationOptions;
	private readonly heading: string;

	constructor(targets: readonly Target[], options: PresentationOptions, heading = "Batch cleanup") {
		this.targets = targets; this.options = options; this.heading = heading;
		this.nameWidth = Math.max(7, ...targets.map((target) => [...displayText(target.slug)].length));
		this.live = Boolean(process.stdout.isTTY && process.env.TERM !== "dumb" && !options.verbose);
	}

	private row(target: Target): string[] {
		const outcome = this.outcomes.get(target.slug);
		return [displayText(target.slug), outcome ? outcomeState(outcome) : this.current === target.slug ? this.phase : "Waiting",
			outcome ? reason(outcome.reason) : this.current !== target.slug ? pendingReasons[0] : this.phase === "Checking" ? pendingReasons[1] : pendingReasons[2]];
	}

	private code(target: Target): number {
		const outcome = this.outcomes.get(target.slug);
		return outcome?.reason === "earlier-target-not-finished" ? 2 : outcome?.outcome === "finished" ? 32 : outcome?.outcome === "absent" ? 2
			: outcome?.outcome === "refused" || outcome?.outcome === "uncertain" ? 31 : 36;
	}

	private counts(): string {
		const pending = [...this.outcomes.values()].filter((entry) => entry.reason === "earlier-target-not-finished").length;
		const count = (outcome: Outcome["outcome"]) => [...this.outcomes.values()].filter((entry) => entry.outcome === outcome && entry.reason !== "earlier-target-not-finished").length;
		return `${count("finished")} removed · ${count("absent")} already absent · ${count("refused")} refused · ${count("uncertain")} uncertain${pending ? ` · ${pending} not attempted` : ""} · branches preserved`;
	}

	private render(final: boolean, targets: readonly Target[] = this.targets): string {
		const width = process.stdout.isTTY ? Math.max(1, (process.stdout.columns || 80) - 1) : Infinity;
		const complete = this.targets.every((target) => ["finished", "absent"].includes(this.outcomes.get(target.slug)?.outcome ?? ""));
		const title = final ? `${this.heading} ${complete ? "complete" : "incomplete"}` : `${this.heading} · branches preserved`;
		let text = formatLines([styleText(title, final && !complete ? 31 : final ? 32 : 1, this.options.color), ""]);
		if (!this.targets.length) text += formatLines(["No approved resources"]);
		else if (this.nameWidth + 14 + 32 + 4 <= width) {
			text += formatStateTable(["SESSION", "STATE", "REASON"], targets.map((target) => {
				const row = this.row(target); return [row[0].padEnd(this.nameWidth), row[1].padEnd(14), row[2].padEnd(32)];
			}), this.options, (row, column) => column === 1 ? this.code(targets[row]) : undefined);
		} else {
			const stateHeight = Math.max(...[...Object.values(states), "Not attempted", "Waiting", "Checking", "Removing"].map((state) => formatLines([`  ${state}`], width).trimEnd().split("\n").length));
			const reasonHeight = Math.max(...[...Object.values(reasons), ...pendingReasons].map((value) => formatLines([`  ${value}`], width).trimEnd().split("\n").length));
			for (const target of targets) {
				const [name, state, explanation] = this.row(target);
				const stateLines = formatLines([`  ${state}`], width).trimEnd().split("\n"), reasonLines = formatLines([`  ${explanation}`], width).trimEnd().split("\n");
				text += formatLines([styleText(name, 1, this.options.color), ...stateLines.map((line) => styleText(line, this.code(target), this.options.color)),
					...Array(Math.max(0, stateHeight - stateLines.length)).fill(""), ...reasonLines, ...Array(Math.max(0, reasonHeight - reasonLines.length)).fill(""), ""], width);
			}
		}
		return text + formatLines(["", final ? this.counts() : `${this.outcomes.size}/${this.targets.length} processed`]);
	}

	private clear(): void {
		// Never address a frame whose terminal geometry has changed.
		if (this.frame.length && this.columns === process.stdout.columns && this.terminalRows === process.stdout.rows)
			process.stdout.write(`\r\x1b[${this.frame.length}A` + "\x1b[2K\n".repeat(this.frame.length) + `\x1b[${this.frame.length}A\r`);
		this.frame = [];
	}

	private update(): void {
		if (!this.live) return;
		this.clear();
		const height = Math.max(1, (process.stdout.rows || 24) - 2);
		let lines = this.render(false).trimEnd().split("\n");
		if (lines.length > height) {
			const index = Math.max(0, this.targets.findIndex((target) => target.slug === this.current));
			const target = this.targets[index];
			// A compact window follows the active target; the complete final table
			// retains every result and full identity, including offscreen entries.
			lines = target ? formatLines([this.row(target)[1], this.row(target)[0], this.row(target)[2], `${this.outcomes.size}/${this.targets.length} processed`, "Full result follows"]).trimEnd().split("\n") : lines;
		}
		this.frame = lines.slice(0, height);
		this.columns = process.stdout.columns; this.terminalRows = process.stdout.rows;
		process.stdout.write(this.frame.join("\n") + "\n");
	}

	start(): void { this.update(); }
	checking(slug: string): void { this.current = slug; this.phase = "Checking"; this.update(); }
	removing(slug: string): void { this.current = slug; this.phase = "Removing"; this.update(); }
	complete(outcome: Outcome): void { this.outcomes.set(outcome.slug, outcome); this.update(); }

	finish(outcomes: Outcome[]): string {
		for (const outcome of outcomes) this.outcomes.set(outcome.slug, outcome);
		this.clear();
		writeCleanupDiagnostics(outcomes, this.options);
		let text = this.render(true);
		if (this.options.verbose) {
			for (const outcome of outcomes) {
				const changes = outcome.inspection?.git?.changes?.map((change) => `  ${displayText(change.status)} ${displayText(change.path)}`) ?? [];
				const blockers = outcome.inspection?.blockers.map((blocker) => `  ${diagnostic(blocker.problem ?? reason(blocker.reason))}`) ?? [];
				text += formatLines(["", `${displayText(outcome.slug)}: ${displayText(outcome.worktreePath)}`, ...changes, ...blockers]);
			}
		}
		return text;
	}
}
