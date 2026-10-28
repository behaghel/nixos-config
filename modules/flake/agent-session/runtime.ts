import { spawnSync } from "node:child_process";
import type { ProgressReporter } from "./types.ts";

export class CliError extends Error {
	readonly exitCode: number;

	constructor(message: string, exitCode = 1) {
		super(message);
		this.exitCode = exitCode;
	}
}

// Node makes terminal stdin nonblocking, so synchronous readSync can fail with
// EAGAIN. Let a child of the same runtime read asynchronously while the parent
// waits synchronously, keeping the existing operation lock held throughout.
// Callers enforce TTY input; EOF or a failed prompt never supplies consent.
export function confirm(question: string): boolean {
	const reader = `
process.stderr.write(process.argv[1] + ' ');
let input = '', answered = false;
const answer = (accepted) => {
  if (answered) return;
  answered = true;
  process.stdout.write(accepted ? 'yes' : 'no');
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
	const result = spawnSync(process.execPath, ["--input-type=module", "-e", reader, question], {
		stdio: ["inherit", "pipe", "inherit"], encoding: "utf8",
	});
	return result.status === 0 && result.stdout === "yes";
}

export function progressReporter(command: string, json: boolean): ProgressReporter {
	let transient = false, lastMetadataUpdate: number | undefined;
	const flush = () => {
		if (transient) process.stderr.write("\r\x1b[2K");
		transient = false;
	};
	const report: ProgressReporter = (phase, status, detail) => {
		if (json) {
			process.stderr.write(
				`${JSON.stringify({ version: 1, type: "progress", command, phase, status, ...(detail ? { detail } : {}) })}\n`,
			);
			return;
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
	stdio: "pipe" | "inherit" = "pipe",
	environment: NodeJS.ProcessEnv = process.env,
): { status: number; stdout: string; stderr: string; errorCode?: string } {
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		stdio,
		env: environment,
	});
	return {
		status: result.status ?? 1,
		errorCode: (result.error as NodeJS.ErrnoException | undefined)?.code,
		stdout: typeof result.stdout === "string" ? result.stdout.trim() : "",
		stderr: typeof result.stderr === "string" ? result.stderr.trim() : "",
	};
}
