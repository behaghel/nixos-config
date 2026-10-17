import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { commonGitDirectory, git, primaryRoot, repositoryRoot } from "./git.ts";
import { loadConfig, metadataPath, metadataSlugs, readMetadata, assertConfiguredWorktreePath, readOperationLock, resolveSessionTarget, resolveWorktreeRoot, sessionDirectory, validateSlug } from "./sessions.ts";
import { run, writeCommandResult } from "./runtime.ts";
import { sessionCommand } from "./arguments.ts";
import type { AgentSessionConfig, SessionMetadata } from "./types.ts";

interface Check {
	id: string;
	status: "ok" | "info" | "warning" | "error";
	message: string;
	slug?: string;
	path?: string;
	code?: string;
}

function localPath(path: string): boolean {
	return path !== "" && path !== "." && !isAbsolute(path) && !path.split("/").includes("..");
}

function present(path: string): boolean {
	try { lstatSync(path); return true; } catch (error) {
		if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
		throw error;
	}
}

// Only filesystem metadata and local Git topology are inspected. In particular,
// do not reuse status inspection: git status can refresh the index or invoke a
// configured fsmonitor. Never include raw config/metadata errors in diagnostics.
export function doctor(target?: string, json = false): number {
	const checks: Check[] = [];
	const add = (id: string, status: Check["status"], message: string, session?: string, path?: string, code?: string) =>
		checks.push({ id, status, message, ...(session ? { slug: session } : {}), ...(path ? { path } : {}), ...(code ? { code } : {}) });
	let slug = target;
	let unresolved = false;
	if (target === ".") {
		try { slug = resolveSessionTarget(target); } catch {
			unresolved = true;
			slug = undefined;
			add("current-target", "error", "Current-session binding cannot be trusted. Use repository-wide doctor or an explicit slug to inspect it; no target was guessed.");
		}
	}
	let config: AgentSessionConfig | undefined;
	try {
		const value = loadConfig("");
		resolveWorktreeRoot(process.cwd(), value.worktree_root);
		if (value.agent_command.length === 0) throw new Error("Missing agent command");
		if (value.local_links.some((path) => !localPath(path))) throw new Error("Invalid link path");
		config = value;
		add("configuration", "ok", "Module configuration and project-local paths are valid.");
	} catch {
		add("configuration", "error", "Module configuration is missing or invalid. Enter the project shell and check agentSession settings; configuration values are not printed.");
	}
	for (const [id, variable, paths] of [
		["shell-artifacts", "AGENT_SESSION_SHELL_ROOT", ["init.sh", "init.fish"]],
		["completion-artifacts", "AGENT_SESSION_COMPLETION_ROOT", ["bash-completion/completions/agent-session", "bash-completion/completions/as", "zsh/site-functions/_agent_session", "fish/vendor_completions.d/agent-session.fish", "fish/vendor_completions.d/as.fish"]],
	] as const) {
		const root = process.env[variable];
		if (!root) {
			add(id, "warning", `Integration location is not exported (${variable}). Re-enter the project shell.`);
			continue;
		}
		try {
			if (!paths.every((path) => statSync(join(root, path)).isFile())) throw new Error("Missing artifact");
			add(id, "ok", "Expected integration files are installed.");
		} catch {
			add(id, "error", "Integration files are missing or inaccessible. Re-enter the project shell or rebuild its pinned module.");
		}
	}
	add("shell-parent", "info", "Installed files do not prove parent-shell integration. Run type as in the parent shell and confirm it is a function before using as <slug> cd.");

	let root: string | undefined;
	try {
		root = primaryRoot(repositoryRoot());
		add("repository", "ok", "Current Git worktree and primary checkout are accessible.");
	} catch {
		add("repository", "error", "Cannot identify a primary checkout. Run doctor inside a Git worktree.");
	}
	if (root) {
		try {
			const lock = join(commonGitDirectory(root), "agent-session", "operation.lock");
			if (!present(lock)) add("lock", "ok", "No lifecycle operation lock is present.");
			else {
				const owner = readOperationLock(root);
				const pid = owner && Number.isSafeInteger(owner.pid) && owner.pid > 0 ? owner.pid : undefined;
				add("lock", "warning", pid
					? `A lifecycle lock records pid ${pid}. Verify the owning process manually; PID liveness and ownership are not established.`
					: "A lifecycle lock has no readable valid owner. Inspect it manually; doctor never removes locks.");
			}
		} catch {
			add("lock", "warning", "Cannot inspect the lifecycle lock. Check local Git-directory permissions manually.");
		}
	}
	if (root && config && !unresolved) {
		const primary = root;
		const settings = config;
		const ignored = run("git", ["check-ignore", "--quiet", "--no-index", "--", `${settings.worktree_root}/.agent-session-probe`], primary);
		add("worktree-root", ignored.status === 0 ? "ok" : "error", ignored.status === 0
			? "Configured worktree root is ignored by Git."
			: "Cannot confirm the worktree root is ignored. Check the primary checkout's .gitignore.");
		try {
			const configured = resolveWorktreeRoot(primary, settings.worktree_root);
			const canonical = existsSync(configured) ? realpathSync(configured) : configured;
			const candidates = new Set(metadataSlugs(primary));
			// Include registered slots even after a branch rename erased the agent/
			// naming clue. This is diagnostic evidence, never authority to repair.
			const registered = new Map<string, string | undefined>();
			for (const record of git(primary, ["worktree", "list", "--porcelain"]).split(/\n\n+/)) {
				const lines = record.split("\n");
				const path = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
				if (!path) continue;
				const actual = existsSync(path) ? realpathSync(path) : resolve(path);
				if (dirname(actual) !== canonical) continue;
				const candidate = basename(actual);
				candidates.add(candidate);
				registered.set(candidate, lines.find((line) => line.startsWith("branch refs/heads/"))?.slice("branch refs/heads/".length));
			}
			for (const candidate of slug ? [slug] : [...candidates].sort()) {
				try { validateSlug(candidate); } catch {
					add("binding", "error", "A metadata filename or managed worktree slot has an invalid slug. Inspect local state manually.");
					continue;
				}
				const problem = (code: string, message: string) => add("binding", "error", message, candidate, undefined, code);
				if (!present(metadataPath(primary, candidate))) {
					if (registered.get(candidate) === `agent/${candidate}`) {
						problem("metadata-missing", `Session record is missing. After verifying ownership, restore it with: ${sessionCommand(candidate, "repair")}. This writes metadata without removing work or branches.`);
					} else if (registered.has(candidate)) {
						problem("metadata-missing-renamed", "Session record is missing and the registered worktree is on a renamed or detached branch; repair cannot recover this combination. Keep it intact. If retiring it, review its work and remove the worktree with native Git without --force; local branches are preserved.");
					} else problem("session-unknown", "No session record or registered managed slot was found. Check the explicit slug; no recovery target was identified.");
					continue;
				}
				let metadata: SessionMetadata;
				try { metadata = readMetadata(primary, candidate); } catch {
					problem("metadata-invalid", "Session record is unreadable, malformed or unsafe. Inspect or restore the record manually; do not overwrite it with repair or delete its worktree based on this record.");
					continue;
				}
				try { assertConfiguredWorktreePath(primary, settings, metadata); } catch {
					problem("metadata-path-mismatch", "Recorded worktree location does not match the configured slot. Verify whether configuration or location changed; do not delete or repair by guessing.");
					continue;
				}
				if (!existsSync(metadata.worktreePath)) {
					problem("worktree-missing", "Recorded worktree directory is missing. Check whether it was moved; preserve remaining local branches before considering stale-record cleanup.");
					continue;
				}
				let worktree: string;
				try {
					worktree = sessionDirectory(primary, candidate);
					add("binding", "ok", "Recorded location and Git registration agree.", candidate);
				} catch {
					problem("git-binding-invalid", "Worktree exists but Git registration, root or repository membership does not agree. Inspect Git worktree registration before attempting repair or cleanup.");
					continue;
				}
				for (const path of settings.local_links) {
					const source = join(primary, path);
					const target = join(worktree, path);
					if (!present(source)) {
						add("local-link", "ok", "Optional local source is absent; no link is required.", candidate, path);
						continue;
					}
					try {
						if (!lstatSync(target).isSymbolicLink() || realpathSync(target) !== realpathSync(source)) throw new Error("Invalid link");
						add("local-link", "ok", "Local link points to the configured source; contents were not read.", candidate, path);
					} catch {
						add("local-link", "error", "Local link is missing, conflicting or dangling. Inspect it manually; preserve existing files.", candidate, path);
					}
				}
			}
			if (!slug && candidates.size === 0) add("sessions", "ok", "No recorded sessions or registered managed worktree slots were found.");
		} catch {
			add("sessions", "error", "Cannot enumerate local session bindings. Check Git-directory and configured subtree permissions.");
		}
	} else {
		add("sessions", "info", "Binding and local-link checks require a valid repository, module configuration and any explicitly requested current target.");
	}
	const ok = !checks.some((check) => check.status === "error");
	const result = { version: 1, command: "doctor", ok, ...(slug ? { slug } : {}), checks };
	const text = `Doctor: ${ok ? "no errors" : "errors found"}\n` + checks.map((check) =>
		`${check.status.toUpperCase()} ${check.id}${check.slug ? ` [${check.slug}]` : ""}${check.path ? ` (${check.path})` : ""}: ${check.message}\n`,
	).join("");
	writeCommandResult(result, json, text);
	return ok ? 0 : 1;
}
