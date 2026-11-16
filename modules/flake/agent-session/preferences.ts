import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { CliError } from "./runtime.ts";
import type { ColorMode } from "./types.ts";

/** Personal presentation only; never consult project config or supply consent. */
export function personalColor(explicit: ColorMode | undefined, json: boolean): ColorMode {
	if (explicit !== undefined) return explicit;
	// Machine output must not depend on a human presentation preference file.
	if (json) return "auto";
	const xdg = process.env.XDG_CONFIG_HOME;
	const directory = xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".config");
	const path = join(directory, "agent-session", "config.json");
	let contents: string;
	try { contents = readFileSync(path, "utf8"); }
	catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") return "auto";
		// Filesystem errors contain no file contents; retain their original text.
		throw new CliError(`Cannot read personal preferences ${JSON.stringify(path)}.\n${String(error)}`, 64);
	}
	let value: unknown;
	try { value = JSON.parse(contents); }
	catch { throw new CliError(`Invalid JSON in personal preferences ${JSON.stringify(path)}.`, 64); }
	if (value === null || typeof value !== "object" || Array.isArray(value) ||
		Object.keys(value).some((key) => key !== "color") ||
		("color" in value && (typeof value.color !== "string" || !["auto", "always", "never"].includes(value.color)))) {
		throw new CliError(`Invalid personal preferences ${JSON.stringify(path)}: expected an object with optional color auto|always|never; other settings are unsupported.`, 64);
	}
	// Only an explicit --color=always overrides NO_COLOR, not an ambient file.
	return process.env.NO_COLOR ? "never" : (value as { color?: ColorMode }).color ?? "auto";
}
