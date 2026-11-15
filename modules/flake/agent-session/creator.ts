import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { CreatorConversation } from "./types.ts";

// Read only the bounded JSONL header, not any conversation entries. Nonblocking
// open plus a regular-file check prevents a bad locator from hanging on a FIFO.
function piHeader(path: string): { id: string; cwd: string } | undefined {
	let fd: number | undefined;
	try {
		fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
		if (!fstatSync(fd).isFile()) return undefined;
		const byte = Buffer.alloc(1), bytes: number[] = [];
		while (bytes.length < 16_384) {
			if (readSync(fd, byte, 0, 1, null) === 0 || byte[0] === 10) {
				const value = JSON.parse(Buffer.from(bytes).toString("utf8"));
				return value?.type === "session" && typeof value.id === "string" &&
					typeof value.cwd === "string" && isAbsolute(value.cwd)
					? { id: value.id, cwd: value.cwd } : undefined;
			}
			bytes.push(byte[0]);
		}
	} catch {
		// Unavailable or invalid context cannot establish a creator association.
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
	return undefined;
}

export function creatorConversationMatches(creator: CreatorConversation, worktree: string): boolean {
	try {
		const header = piHeader(creator.sessionFile);
		return header?.id === creator.piSessionId && realpathSync(header.cwd) === realpathSync(worktree);
	} catch {
		return false;
	}
}

// Resource ancestry still comes from the verified native worktree. Environment
// values only identify Pi context and must agree with its actual header/cwd.
export function captureCreatorConversation(
	parentSessionId: string | null,
	worktree: string,
	environment: NodeJS.ProcessEnv = process.env,
): CreatorConversation | undefined {
	const sessionFile = environment.PI_SESSION_FILE, piSessionId = environment.PI_SESSION_ID;
	if (!parentSessionId || !sessionFile || !isAbsolute(sessionFile) || !piSessionId) return undefined;
	const creator = { parentSessionId, piSessionId, sessionFile };
	if (!creatorConversationMatches(creator, worktree)) return undefined;
	return { ...creator, sessionFile: realpathSync(sessionFile) };
}
