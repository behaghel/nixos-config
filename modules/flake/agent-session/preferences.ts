import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { CliError } from "./runtime.ts";
import type { ColorMode } from "./types.ts";

export interface PersonalPreferences {
	color?: ColorMode;
	branches?: "preserve" | "delete";
}

/** Personal defaults only; never consult project policy or supply consent. */
function readPreferences(scope: "all" | "branches" = "all"): PersonalPreferences {
	const xdg = process.env.XDG_CONFIG_HOME;
	const directory = xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".config");
	const path = join(directory, "agent-session", "config.json");
	let contents: string;
	try { contents = readFileSync(path, "utf8"); }
	catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") return {};
		// Filesystem errors contain no file contents; retain their original text.
		throw new CliError(`Cannot read personal preferences ${JSON.stringify(path)}.\n${String(error)}`, 64);
	}
	let value: unknown;
	try { value = JSON.parse(contents); }
	catch { throw new CliError(`Invalid JSON in personal preferences ${JSON.stringify(path)}.`, 64); }
	if (value === null || typeof value !== "object" || Array.isArray(value) ||
		Object.keys(value).some((key) => !["color", "branches"].includes(key)) ||
		(scope !== "branches" && "color" in value && (typeof value.color !== "string" || !["auto", "always", "never"].includes(value.color))) ||
		("branches" in value && (typeof value.branches !== "string" || !["preserve", "delete"].includes(value.branches)))) {
		throw new CliError(`Invalid personal preferences ${JSON.stringify(path)}: expected optional color auto|always|never and branches preserve|delete; other settings are unsupported.`, 64);
	}
	return value as PersonalPreferences;
}

export function personalColor(explicit: ColorMode | undefined, json: boolean): ColorMode {
	if (explicit !== undefined) return explicit;
	// JSON never depends on colour preferences; scope previews are separate.
	if (json) return "auto";
	const preferences = readPreferences();
	// Only an explicit --color=always overrides NO_COLOR, not an ambient file.
	return process.env.NO_COLOR ? "never" : preferences.color ?? "auto";
}

export function personalBranches(): "preserve" | "delete" {
	return readPreferences("branches").branches ?? "preserve";
}
