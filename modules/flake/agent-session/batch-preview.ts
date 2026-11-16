import { stripVTControlCharacters } from "node:util";
import { formatActivityTime } from "./runtime.ts";
import type { Candidate } from "./batch.ts";
import type { ColorMode } from "./types.ts";

export interface PreviewEntry {
	slug: string;
	label: string;
	activity: number;
}

const reasons: Record<string, string> = {
	excluded: "Excluded", "invoking-worktree": "Current worktree", "unresolved-resource": "Worktree needs inspection",
	dirty: "Uncommitted changes", "uncertain-operation": "Operation state needs review", "live-operation": "Recorded process present",
	"unknown-process-evidence": "Cannot verify processes", "live-cwd": "Process using worktree", "other-owner": "Different worktree owner",
	"ignored-local-data": "Ignored data needs review", "unknown-activity": "Activity incomplete", "recent-activity": "Recent activity",
	"worktree-locked": "Worktree locked", submodules: "Submodules need review", "unresolved-evidence": "Inspection incomplete",
};

// Metadata, branch names and paths are data, not terminal instructions. Keep
// their printable content while preventing embedded controls from moving the UI.
function safe(text: string): string {
	return stripVTControlCharacters(text).replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
}

function wrap(text: string, width: number): string[] {
	const lines: string[] = [];
	let line = "";
	for (const word of safe(text).split(" ")) {
		if (line && [...line + " " + word].length > width) { lines.push(line); line = ""; }
		let remaining = [...word];
		while (remaining.length > width) {
			if (line) { lines.push(line); line = ""; }
			lines.push(remaining.splice(0, width).join(""));
		}
		if (remaining.length) line += (line ? " " : "") + remaining.join("");
	}
	if (line || !lines.length) lines.push(line);
	return lines;
}

/** Owns only the batch preview's human display; never selection or approval. */
export class BatchPreview {
	private readonly completed = new Map<string, Candidate>();
	private checking?: string;
	private frame: string[] = [];
	private frameWidth = 0;
	private phase = "Checking processes";
	readonly live = Boolean(process.stdout.isTTY && process.env.TERM !== "dumb");
	private readonly colour: boolean;
	private entries: PreviewEntry[];
	private ready = true;
	private readonly verbose: boolean;
	private readonly inactiveFor: string;
	private readonly now: number;

	constructor(entries: PreviewEntry[], inactiveFor: string, now: number, color: ColorMode = "auto", verbose = false) {
		this.entries = entries;
		this.verbose = verbose;
		this.inactiveFor = inactiveFor;
		this.now = now;
		this.colour = color === "always" || (color === "auto" && this.live && !process.env.NO_COLOR);
	}

	private style(text: string, code: number): string {
		return this.colour ? `\x1b[${code}m${text}\x1b[0m` : text;
	}

	private rows(): string[][] {
		return this.entries.map((entry) => {
			const candidate = this.completed.get(entry.slug);
			const selected = Boolean(candidate?.snapshot);
			const extra = (candidate?.blockers.length ?? 0) - 1;
			return [safe(entry.label), formatActivityTime(entry.activity, this.now),
				candidate ? selected ? "Would remove" : "Would preserve" : this.checking === entry.slug ? "Checking" : "Waiting",
				candidate ? selected ? "Inactive; checks passed" : (reasons[candidate.reason] ?? candidate.reason) + (extra > 0 ? ` (+${extra})` : "") : ""];
		});
	}

	private details(): string[] {
		const lines: string[] = [];
		for (const entry of this.entries) {
			const candidate = this.completed.get(entry.slug);
			if (!candidate) continue;
			const problems = candidate.blockers.flatMap((blocker) => {
				if (["excluded", "recent-activity"].includes(blocker.reason)) return [];
				if (blocker.problem) return [blocker.problem];
				if (blocker.reason === "dirty") return ["Uncommitted changes: " + (candidate.git?.changes?.map((change) => change.path).join(", ") || "working tree is dirty") + ". Commit or save this work before cleanup."];
				if (blocker.reason === "invoking-worktree") return ["Current worktree; run cleanup from another checkout."];
				if (blocker.reason === "live-cwd") return [`Processes using worktree: ${candidate.processEvidence?.pids.join(", ")}. Leave or stop that work before cleanup.`];
				return [`${reasons[blocker.reason] ?? blocker.reason}. Inspect with as ${entry.slug} doctor.`];
			});
			if (problems.length) lines.push("", `${entry.slug}:`, ...problems.map((problem) => `  ${problem}`));
		}
		return lines;
	}

	private render(final: boolean): string[] {
		// Leave the last column unused: writing there may wrap before the newline.
		const width = process.stdout.isTTY ? Math.max(1, (process.stdout.columns || 80) - 1) : Infinity;
		const rows = this.rows();
		const nameWidth = Math.max(7, ...rows.map((row) => [...row[0]].length));
		const widths = [nameWidth, 11, 14];
		const reasonWidth = width - widths.reduce((sum, value) => sum + value, 0) - 6;
		const lines = [this.style(`Preview · inactive ≥${this.inactiveFor} · branches preserved`, 1), ""];
		if (!this.ready) return lines.concat(this.phase).flatMap((line) =>
			!Number.isFinite(width) || [...stripVTControlCharacters(line)].length <= width ? [line] : wrap(stripVTControlCharacters(line), width));
		const paintRow = (row: string[], header = false) => {
			const stateCode = row[2] === "Would remove" ? 32 : row[2] === "Would preserve" ? 33 : 2;
			if (reasonWidth >= 20) {
				const cells = row.map((value, index) => {
					const limit = index === 3 ? reasonWidth : widths[index];
					const shortened = [...value].length > limit ? [...value].slice(0, limit - 1).join("") + "…" : value;
					const padded = index === 3 ? shortened : shortened + " ".repeat(Math.max(0, limit - [...shortened].length));
					return header ? this.style(padded, 1) : index === 2 ? this.style(padded, stateCode) : padded;
				});
				lines.push(cells.join("  "));
			} else if (!header) {
				// Reserve the same space for a pending and completed entry so later
				// session identities do not jump when a reason first appears.
				const stateLines = wrap(`  ${row[2]} · ${row[1]}`, width);
				const reasonLines = wrap(`  ${row[3]}`, width);
				const stateHeight = wrap("  Would preserve · 2000-01-01", width).length;
				const reasonHeight = Math.max(...Object.values(reasons).map((reason) => wrap(`  ${reason} (+99)`, width).length));
				lines.push(this.style(row[0], 1), ...stateLines,
					...Array(Math.max(0, stateHeight - stateLines.length)).fill(""), ...reasonLines,
					...Array(Math.max(0, reasonHeight - reasonLines.length)).fill(""), "");
			}
		};
		paintRow(["SESSION", "LAST ACTIVE", "PLAN", "REASON"], true);
		for (const row of rows) paintRow(row);
		const selected = [...this.completed.values()].filter((candidate) => candidate.snapshot).length;
		if (final) {
			lines.push("", `${selected} eligible for removal · ${this.entries.length - selected} kept · Nothing changed`);
			if (this.verbose) lines.push(...this.details());
		} else lines.push("", `${this.phase} · ${this.completed.size}/${this.entries.length} inspected`);
		return lines.flatMap((line) => {
			if (!Number.isFinite(width) || [...stripVTControlCharacters(line)].length <= width) return [line];
			// Overflow uses plain wrapped text; colour never justifies truncating data.
			return wrap(stripVTControlCharacters(line), width);
		});
	}

	private clear(): void {
		if (!this.frame.length) return;
		// Terminal reflow makes the old height unknowable after a resize. Start
		// a fresh block rather than risk erasing unrelated scrollback.
		if (this.frameWidth === process.stdout.columns) {
			process.stdout.write(`\r\x1b[${this.frame.length}A` + "\x1b[2K\n".repeat(this.frame.length) + `\x1b[${this.frame.length}A\r`);
		}
		this.frame = [];
	}

	private update(): void {
		if (!this.live) return;
		this.clear();
		const lines = this.render(false);
		// Do not address lines that have scrolled outside the terminal viewport.
		const height = Math.max(3, (process.stdout.rows || 24) - 2);
		const width = Math.max(1, (process.stdout.columns || 80) - 1);
		const status = wrap(`${this.phase} · ${this.completed.size}/${this.entries.length} inspected`, width).slice(0, height - 1);
		const footer = [...wrap("More in final summary", width), ...status].slice(0, height);
		this.frame = lines.length <= height ? lines : [...lines.slice(0, height - footer.length), ...footer];
		this.frameWidth = process.stdout.columns;
		process.stdout.write(this.frame.join("\n") + "\n");
	}

	discover(): void { this.ready = false; this.phase = "Discovering sessions"; this.update(); }
	sessions(entries: PreviewEntry[]): void { this.entries = entries; this.ready = true; this.phase = "Checking processes"; this.update(); }
	start(): void { this.update(); }
	checkingSession(slug: string): void { this.checking = slug; this.phase = `Checking ${safe(slug)}`; this.update(); }
	complete(candidate: Candidate): void { this.completed.set(candidate.slug, candidate); this.checking = undefined; this.phase = `Checked ${safe(candidate.slug)}`; this.update(); }
	finish(): string { this.clear(); return this.render(true).join("\n") + "\n"; }
	abort(): void {
		if (!this.live) return;
		this.clear();
		process.stdout.write(this.render(false).join("\n") + "\nInspection failed · Nothing changed\n");
	}
}
