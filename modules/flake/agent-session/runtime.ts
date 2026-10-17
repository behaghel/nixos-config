import { spawnSync } from "node:child_process";
import type { ProgressReporter } from "./types.ts";

export class CliError extends Error {
	readonly exitCode: number;

	constructor(message: string, exitCode = 1) {
		super(message);
		this.exitCode = exitCode;
	}
}

export function progressReporter(command: string, json: boolean): ProgressReporter {
	return (phase, status, detail) => {
		if (json) {
			process.stderr.write(
				`${JSON.stringify({ version: 1, type: "progress", command, phase, status, ...(detail ? { detail } : {}) })}\n`,
			);
			return;
		}
		const suffix = detail ? `: ${detail}` : "";
		process.stderr.write(
			`[agent-session] ${status.toUpperCase()} ${phase}${suffix}\n`,
		);
	};
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
): { status: number; stdout: string; stderr: string } {
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		stdio,
		env: environment,
	});
	return {
		status: result.status ?? 1,
		stdout: typeof result.stdout === "string" ? result.stdout.trim() : "",
		stderr: typeof result.stderr === "string" ? result.stderr.trim() : "",
	};
}
