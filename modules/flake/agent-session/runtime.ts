import { spawnSync } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import type { ColorMode, PresentationOptions, ProgressReporter } from "./types.ts";

export class CliError extends Error {
	readonly exitCode: number;
	// Presentation metadata only; never embedded in the original diagnostic.
	color?: ColorMode;

	constructor(message: string, exitCode = 1) {
		super(message);
		this.exitCode = exitCode;
	}
}

// Node makes terminal stdin nonblocking, so synchronous readSync can fail with
// EAGAIN. Let a child of the same runtime read asynchronously while the parent
// waits synchronously, keeping the existing operation lock held throughout.
// Callers enforce TTY input; EOF or a failed prompt never supplies consent.
export function confirm(question: string, onAccepted?: (simpleEcho: boolean) => void): boolean {
	const reader = `
process.stderr.write(process.argv[1] + ' ');
let input = '', answered = false;
const answer = (accepted) => {
  if (answered) return;
  answered = true;
  const simple = /^(?:y|yes)\\n$/i.test(input);
  process.stdout.write(accepted ? process.argv[2] === 'observe' ? simple ? 'yes:simple' : 'yes:other' : 'yes' : 'no');
  process.stdin.pause();
};
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
  const newline = input.indexOf('\\n');
  if (newline >= 0) answer(['y', 'yes'].includes(input.slice(0, newline).trim().toLowerCase()));
});
process.stdin.on('end', () => answer(false));
process.stdin.on('error', () => answer(false));
`;
	const result = spawnSync(process.execPath, ["--input-type=module", "-e", reader, question, onAccepted ? "observe" : "legacy"], {
		stdio: ["inherit", "pipe", "inherit"], encoding: "utf8",
	});
	const accepted = result.status === 0 && (onAccepted ? ["yes:simple", "yes:other"].includes(result.stdout) : result.stdout === "yes");
	if (accepted) onAccepted?.(result.stdout === "yes:simple");
	return accepted;
}

export function formatActivityTime(timestamp: number, now: number): string {
	if (!Number.isFinite(timestamp)) return "unknown";
	const age = Math.max(0, now - timestamp);
	if (age < 60_000) return "just now";
	if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
	if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`;
	if (age < 7 * 86_400_000) return `${Math.floor(age / 86_400_000)}d ago`;
	const date = new Date(timestamp);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatTable(rows: string[][], shortenColumn?: number): string {
	if (!rows.length) return "";
	const width = (value: string) => [...value].length;
	const widths = rows[0].map((_, index) => Math.max(...rows.map((row) => width(row[index]))));
	if (shortenColumn !== undefined && process.stdout.isTTY && process.stdout.columns) {
		const otherWidth = widths.reduce((total, value, index) => total + (index === shortenColumn ? 0 : value), 0);
		const available = process.stdout.columns - otherWidth - 2 * (widths.length - 1);
		widths[shortenColumn] = Math.min(widths[shortenColumn], Math.max(1, width(rows[0][shortenColumn]), available));
	}
	return rows.map((row) => row.map((value, index) => {
		if (index === shortenColumn && width(value) > widths[index]) value = [...value].slice(0, widths[index] - 1).join("") + "…";
		return index === widths.length - 1 ? value : value + " ".repeat(widths[index] - width(value));
	}).join("  ") + "\n").join("");
}

export function progressReporter(command: string, json: boolean, compactInspection = false): ProgressReporter {
	let transient = false, lastMetadataUpdate: number | undefined;
	const flush = () => {
		if (transient) process.stderr.write("\r\x1b[2K");
		transient = false;
	};
	let announced = false;
	const inspection = (text: string) => {
		if (process.stderr.isTTY) {
			const width = Math.max(1, (process.stderr.columns || 80) - 1);
			process.stderr.write(`\r\x1b[2K${Array.from(text).slice(0, width).join("")}`);
			transient = true;
		} else if (!announced) {
			process.stderr.write("Inspecting worktrees...\n");
			announced = true;
		}
	};
	const report: ProgressReporter = (phase, status, detail) => {
		if (json) {
			process.stderr.write(
				`${JSON.stringify({ version: 1, type: "progress", command, phase, status, ...(detail ? { detail } : {}) })}\n`,
			);
			return;
		}
		if (compactInspection && status !== "failed") {
			if (phase === "preview-process-snapshot") {
				if (status === "started") inspection("Inspecting worktrees · checking processes");
				return;
			}
			if (phase.startsWith("inspect:")) {
				if (status === "started") inspection(`Inspecting ${detail ?? ""} · ${phase.slice("inspect:".length)}`);
				return;
			}
			if (phase.startsWith("inspect-metadata-chunk:")) return;
		}
		if (phase.startsWith("inspect-metadata-chunk:") && status === "completed") {
			const now = Date.now(), terminal = process.stderr.isTTY;
			if (lastMetadataUpdate !== undefined && now - lastMetadataUpdate < (terminal ? 100 : 1000)) return;
			lastMetadataUpdate = now;
			const text = `[agent-session] Scanning ${detail ?? phase}`;
			if (terminal) {
				const width = Math.max(1, (process.stderr.columns || 80) - 1);
				process.stderr.write(`\r\x1b[2K${Array.from(text).slice(0, width).join("")}`);
				transient = true;
			} else process.stderr.write(`${text}\n`);
			return;
		}
		flush();
		const suffix = detail ? `: ${detail}` : "";
		process.stderr.write(
			`[agent-session] ${status.toUpperCase()} ${phase}${suffix}\n`,
		);
	};
	report.flush = flush;
	return report;
}

export function styleText(text: string, code: number, color: ColorMode = "auto", terminal = process.stdout.isTTY): string {
	const enabled = color === "always" || (color === "auto" && terminal && process.env.TERM !== "dumb" && !process.env.NO_COLOR);
	return enabled ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export function displayText(text: string): string {
	return stripVTControlCharacters(text).replace(/[\x00-\x1f\x7f-\x9f]/g, (character) => `\\x${character.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

/** Wrap durable output without truncating names, paths or problem statements. */
export function formatLines(lines: string[], width = process.stdout.isTTY ? Math.max(1, (process.stdout.columns || 80) - 1) : Infinity): string {
	return lines.flatMap((line) => {
		const plain = stripVTControlCharacters(line);
		if ([...plain].length <= width) return [line];
		const indent = " ".repeat(Math.min(plain.match(/^ */)?.[0].length ?? 0, width - 1));
		const available = width - indent.length;
		const result: string[] = [];
		let current = "";
		for (const word of plain.trimStart().split(" ")) {
			if (current && [...`${current} ${word}`].length > available) { result.push(indent + current); current = ""; }
			const remaining = [...word];
			while (remaining.length > available) {
				if (current) { result.push(indent + current); current = ""; }
				result.push(indent + remaining.splice(0, available).join(""));
			}
			if (remaining.length) current += (current ? " " : "") + remaining.join("");
		}
		if (current) result.push(indent + current);
		return result;
	}).join("\n") + "\n";
}

export function formatStateTable(headers: string[], rows: string[][], options: PresentationOptions = {},
	cellColor?: (row: number, column: number) => number | undefined,
	layout: { table?: boolean; shortenColumns?: number[] } = {}): string {
	const data = rows.map((row) => row.map(displayText));
	const widths = headers.map((header, column) => Math.max(header.length, ...data.map((row) => [...row[column]].length)));
	const width = process.stdout.isTTY ? Math.max(1, (process.stdout.columns || 80) - 1) : Infinity;
	const colour = (text: string, code?: number) => code === undefined ? text : styleText(text, code, options.color);
	const needed = () => widths.reduce((sum, value) => sum + value, 0) + 2 * (headers.length - 1);
	if (needed() > width && !layout.table) {
		return formatLines(data.flatMap((row, rowIndex) => [
			colour(row[0], cellColor?.(rowIndex, 0) ?? 1),
			...row.slice(1).map((value, index) => `  ${headers[index + 1][0]}${headers[index + 1].slice(1).toLowerCase()}: ${colour(value, cellColor?.(rowIndex, index + 1))}`), "",
		]));
	}
	if (layout.table && needed() > width) {
		// Sacrifice secondary width first; identity and state cells wrap only
		// when even those columns cannot otherwise fit. No card fallback.
		for (const column of layout.shortenColumns ?? []) widths[column] = Math.max(headers[column].length, widths[column] - Math.max(0, needed() - width));
		while (needed() > width) {
			const room = widths.map((value, column) => value - headers[column].length);
			const maximum = Math.max(...room);
			if (maximum <= 0) break;
			widths[room.indexOf(maximum)]--;
		}
	}
	const line = (row: string[], rowIndex: number) => {
		const cells = row.map((value, column) => layout.shortenColumns?.includes(column) && [...value].length > widths[column]
			? [[...value].slice(0, widths[column] - 1).join("") + "…"]
			: formatLines([value], widths[column]).slice(0, -1).split("\n"));
		return Array.from({ length: Math.max(...cells.map((cell) => cell.length)) }, (_, part) => cells.map((cell, column) => {
			const value = cell[part] ?? "";
			const padded = column === headers.length - 1 ? value : value + " ".repeat(widths[column] - [...value].length);
			return colour(padded, rowIndex < 0 ? 1 : cellColor?.(rowIndex, column));
		}).join("  "));
	};
	return [...line(headers, -1), ...data.flatMap(line)].join("\n") + "\n";
}

export interface InspectionProgress {
	update: (label: string) => void;
	flush: () => void;
}

export function withInspection<T>(label: string, json: boolean, options: PresentationOptions,
	operation: (progress: InspectionProgress) => T): T {
	let transient = false, announced = false;
	const terminal = process.stdout.isTTY && process.stderr.isTTY && process.env.TERM !== "dumb";
	const progress: InspectionProgress = {
		update(text) {
			if (json) return;
			if (terminal) {
				const width = Math.max(1, (process.stderr.columns || 80) - 1);
				process.stderr.write(`\r\x1b[2K${styleText([...displayText(text)].slice(0, width).join(""), 36, options.color)}`);
				transient = true;
			} else if (!announced) { process.stderr.write(`${displayText(label)}...\n`); announced = true; }
		},
		flush() { if (transient) process.stderr.write("\r\x1b[2K"); transient = false; },
	};
	progress.update(label);
	try { return operation(progress); }
	catch (error) {
		if (json) throw error;
		const failure = error instanceof CliError ? error : new CliError(String(error));
		failure.color = options.color ?? "auto";
		throw failure;
	} finally { progress.flush(); }
}

/** Compact preparation only; callers retain the existing machine reporter. */
export function preparationReporter(command: string, slug: string, json: boolean, options: PresentationOptions): ProgressReporter {
	if (json) return progressReporter(command, true);
	if (options.verbose) return progressReporter(command, false);
	const terminal = process.stdout.isTTY && process.stderr.isTTY && process.env.TERM !== "dumb";
	const phases: Record<string, string> = {
		preparing: "Preparing session", "inspect-create": "Checking creation plan", "remote-sync": "Fetching remote",
		"pr-resolve": "Resolving pull request", "pr-fetch": "Fetching pull request", "pr-trust": "Awaiting trust approval",
		"pr-source": "Preparing source remote", "pr-track": "Configuring branch", "worktree-create": "Creating worktree",
		"worktree-prepare": "Preparing environment", "metadata-record": "Recording session", "session-reuse": "Checking existing session",
	};
	let transient = false, announced = false;
	const flush = () => {
		if (transient) process.stderr.write("\r\x1b[2K");
		transient = false;
	};
	const report: ProgressReporter = (phase, status) => {
		if (status === "failed") { flush(); return; }
		if (status !== "started") return;
		if (terminal) {
			const text = `${phases[phase] ?? "Preparing session"} · ${slug}`;
			const width = Math.max(1, (process.stderr.columns || 80) - 1);
			process.stderr.write(`\r\x1b[2K${styleText([...text].slice(0, width).join(""), 36, options.color)}`);
			transient = true;
		} else if (!announced) {
			process.stderr.write(`Preparing ${slug}...\n`);
			announced = true;
		}
	};
	report.flush = flush;
	return report;
}

export function withPreparation<T>(command: string, slug: string, json: boolean, options: PresentationOptions,
	operation: (report: ProgressReporter) => T): T {
	const report = preparationReporter(command, slug, json, options);
	if (!json) report("preparing", "started");
	try { return operation(report); }
	catch (error) {
		if (json) throw error;
		const failure = error instanceof CliError ? error : new CliError(String(error));
		failure.color = options.color ?? "auto";
		throw failure;
	} finally { report.flush?.(); }
}

export function runPhase<T>(
	report: ProgressReporter,
	phase: string,
	operation: () => T,
): T {
	report(phase, "started");
	try {
		const result = operation();
		report(phase, "completed");
		return result;
	} catch (error) {
		report(
			phase,
			"failed",
			error instanceof Error ? error.message : String(error),
		);
		throw error;
	}
}

export function writeCommandResult(value: unknown, json: boolean, text: string): void {
	process.stdout.write(json ? `${JSON.stringify(value)}\n` : text);
}

export function run(
	command: string,
	args: string[],
	cwd: string,
	stdio: "pipe" | "inherit" | "capture" = "pipe",
	environment: NodeJS.ProcessEnv = process.env,
): { status: number; stdout: string; stderr: string; errorCode?: string } {
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		stdio: stdio === "capture" ? ["inherit", "pipe", "pipe"] : stdio,
		env: environment,
	});
	return {
		status: result.status ?? 1,
		errorCode: (result.error as NodeJS.ErrnoException | undefined)?.code,
		stdout: typeof result.stdout === "string" ? result.stdout.trim() : "",
		stderr: typeof result.stderr === "string" ? result.stderr.trim() : "",
	};
}
