import { displayText, formatLines, formatStateTable, styleText } from "./runtime.ts";
import type { PresentationOptions } from "./types.ts";
import { cleanupDiagnostic } from "./batch-output.ts";

/** Human proposals only: no receipts, selection authority or backend mutation. */
export interface CleanupProposal {
	slug: string;
	remove: boolean;
	action?: "Would delete";
	reason: string;
	details: string[];
}

export class CleanupPreview {
	private readonly entries: string[];
	private readonly options: PresentationOptions;
	private readonly title: string;
	private readonly notes: string[];
	private readonly results = new Map<string, CleanupProposal>();
	private current?: string;
	private frame: string[] = [];
	private columns = 0;
	private rows = 0;
	readonly live: boolean;

	constructor(entries: string[], options: PresentationOptions, title: string, notes: string[] = []) {
		this.entries = entries; this.options = options; this.title = title; this.notes = notes;
		this.live = Boolean(process.stdout.isTTY && process.env.TERM !== "dumb" && !options.verbose);
	}

	private state(slug: string): string {
		const result = this.results.get(slug);
		return result ? result.remove ? result.action ?? "Would remove" : "Would preserve" : this.current === slug ? "Checking" : "Waiting";
	}

	private render(final: boolean): string {
		const width = process.stdout.isTTY ? Math.max(1, (process.stdout.columns || 80) - 1) : Infinity;
		const nameWidth = Math.max(7, ...this.entries.map((slug) => [...displayText(slug)].length));
		const table = nameWidth + 14 + 36 + 4 <= width;
		let text = formatLines([styleText(`Preview · ${this.title}`, 1, this.options.color), ...this.notes, ""]);
		if (!this.entries.length) text += formatLines(["No recorded resources"]);
		else if (table) text += formatStateTable(["SESSION", "PLAN", "REASON"], this.entries.map((slug) => [
			displayText(slug).padEnd(nameWidth), this.state(slug).padEnd(14), this.results.get(slug)?.reason ?? "",
		]), this.options, (row, column) => column === 1 ? this.results.has(this.entries[row]) ? this.results.get(this.entries[row])!.remove ? 32 : 33 : 2 : undefined);
		else {
			// Fixed state/reason slots keep later identities still while checking.
			const stateHeight = Math.max(...["Waiting", "Checking", "Would remove", "Would preserve"].map((state) => formatLines([`  ${state}`], width).trimEnd().split("\n").length));
			const reasonHeight = Math.max(1, Math.ceil(38 / Math.max(1, width - 2)));
			for (const slug of this.entries) {
				const state = formatLines([`  ${this.state(slug)}`], width).trimEnd().split("\n");
				const reason = formatLines([`  ${this.results.get(slug)?.reason ?? ""}`], width).trimEnd().split("\n");
				text += formatLines([styleText(displayText(slug), 1, this.options.color), ...state, ...Array(Math.max(0, stateHeight - state.length)).fill(""),
					...reason, ...Array(Math.max(0, reasonHeight - reason.length)).fill(""), ""], width);
			}
		}
		const removed = [...this.results.values()].filter((result) => result.remove).length;
		text += formatLines(["", final ? `${removed} proposed removal${removed === 1 ? "" : "s"} · ${this.entries.length - removed} preserved · Nothing changed` : `${this.results.size}/${this.entries.length} inspected`]);
		if (final && this.options.verbose) {
			for (const slug of this.entries) {
				const result = this.results.get(slug);
				if (result?.details.length) text += formatLines(["", `${displayText(slug)}:`, ...result.details.map((detail) => `  ${displayText(cleanupDiagnostic(detail))}`)]);
			}
		}
		return text;
	}

	private clear(): void {
		if (this.frame.length && this.columns === process.stdout.columns && this.rows === process.stdout.rows)
			process.stdout.write(`\r\x1b[${this.frame.length}A` + "\x1b[2K\n".repeat(this.frame.length) + `\x1b[${this.frame.length}A\r`);
		this.frame = [];
	}

	private update(): void {
		if (!this.live) return;
		this.clear();
		const height = Math.max(1, (process.stdout.rows || 24) - 2);
		let lines = this.render(false).trimEnd().split("\n");
		if (lines.length > height) lines = formatLines([this.current ? this.state(this.current) : "Inspecting", this.current ? displayText(this.current) : this.title,
			`${this.results.size}/${this.entries.length} inspected`, "Full proposal follows"]).trimEnd().split("\n");
		this.frame = lines.slice(0, height); this.columns = process.stdout.columns; this.rows = process.stdout.rows;
		process.stdout.write(this.frame.join("\n") + "\n");
	}

	start(): void { this.update(); }
	checking(slug: string): void { this.current = slug; this.update(); }
	complete(result: CleanupProposal): void { this.results.set(result.slug, result); this.update(); }
	finish(): string { this.clear(); return this.render(true); }
	abort(): void { this.clear(); process.stdout.write(formatLines(["Inspection failed · Nothing changed"])); }
}
