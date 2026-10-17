declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const beforeAll: (fn: () => void) => void;
declare const afterAll: (fn: () => void) => void;
declare const beforeEach: (fn: () => void) => void;
declare const afterEach: (fn: () => void) => void;
declare const expect: (value: unknown) => {
	toBe: (expected: unknown) => void;
	toContain: (expected: string) => void;
};

declare const process: {
	env: Record<string, string | undefined>;
	execPath: string;
	pid: number;
};

import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cliScript = resolve("modules/flake/agent-session/cli.ts");

function git(cwd: string, ...args: string[]): string {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		env: process.env,
	});
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
	}
	return result.stdout.trim();
}

function createRepositoryFixture(prefix = "agent-session-"): {
	root: string;
	remote: string;
	seed: string;
	checkout: string;
	worktrees: string;
} {
	const root = mkdtempSync(join(tmpdir(), prefix));
	const remote = join(root, "remote.git");
	const seed = join(root, "seed");
	const checkout = join(root, "checkout");
	const worktrees = join(checkout, ".worktrees");

	git(root, "init", "--bare", remote);
	git(root, "init", seed);
	git(seed, "config", "user.name", "Agent Session Test");
	git(seed, "config", "user.email", "agent-session@example.invalid");
	writeFileSync(join(seed, "README.md"), "# Fixture\n");
	writeFileSync(join(seed, ".gitignore"), ".worktrees/\n");
	git(seed, "add", "README.md", ".gitignore");
	git(seed, "-c", "commit.gpgsign=false", "commit", "-m", "Initial fixture");
	git(seed, "branch", "-M", "master");
	git(seed, "remote", "add", "origin", remote);
	git(seed, "push", "-u", "origin", "master");
	git(remote, "symbolic-ref", "HEAD", "refs/heads/master");
	git(root, "clone", remote, checkout);

	return { root, remote, seed, checkout, worktrees };
}

function tomlString(value: string): string {
	return JSON.stringify(value);
}

function runtimeConfigPath(cwd: string): string {
	const commonDirectory = git(cwd, "rev-parse", "--git-common-dir");
	const absoluteCommonDirectory = commonDirectory.startsWith("/")
		? commonDirectory
		: resolve(cwd, commonDirectory);
	return join(realpathSync(absoluteCommonDirectory), "agent-session-test.json");
}

function writeConfig(
	checkout: string,
	agent: string,
	prepareCommand: string[] = [],
	worktreeRoot = ".worktrees",
): void {
	writeFileSync(
		runtimeConfigPath(checkout),
		`${JSON.stringify({
			version: 1,
			worktree_root: worktreeRoot,
			agent_command: [agent],
			prepare_command: prepareCommand,
			local_links: [],
		})}\n`,
	);
}

function runCli(cwd: string, args: string[], env: Record<string, string> = {}) {
	// Diagnostics and completion generation also work outside a Git checkout.
	const inRepository = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
		cwd,
		stdio: "ignore",
	}).status === 0;
	const configPath = inRepository ? runtimeConfigPath(cwd) : undefined;
	return spawnSync("node", [cliScript, ...args], {
		cwd,
		encoding: "utf8",
		env: {
			...process.env,
			...(configPath && existsSync(configPath) ? { AGENT_SESSION_CONFIG: configPath } : {}),
			...env,
		},
	});
}

function installedShellIntegration(shell: string): string {
	const root = process.env.AGENT_SESSION_SHELL_ROOT;
	if (!root) throw new Error("Run shell integration tests through devenv.");
	return join(root, shell === "fish" ? "init.fish" : "init.sh");
}

function installFixtureCLI(fixture: ReturnType<typeof createRepositoryFixture>): string {
	const bin = join(fixture.root, "bin");
	mkdirSync(bin);
	writeFileSync(join(bin, "agent-session"), `#!/usr/bin/env bash\nexec node ${tomlString(cliScript)} "$@"\n`);
	chmodSync(join(bin, "agent-session"), 0o755);
	writeFileSync(join(bin, "as"), `#!/usr/bin/env bash\nexec agent-session "$@"\n`);
	chmodSync(join(bin, "as"), 0o755);
	return bin;
}

function createFakeAgent(root: string, logPath: string): string {
	const fakeAgent = join(root, "fake-agent");
	writeFileSync(
		fakeAgent,
		`#!/usr/bin/env bash\nprintf '%s\\n' "$PWD" >> ${tomlString(logPath)}\nprintf '%s\\n' "$*" >> ${tomlString(`${logPath}.args`)}\n`,
	);
	chmodSync(fakeAgent, 0o755);
	return fakeAgent;
}

function startManagedSession(
	fixture: ReturnType<typeof createRepositoryFixture>,
	slug = "git-hygiene",
): { worktree: string; agentLog: string } {
	const agentLog = join(fixture.root, "agent-cwd");
	const fakeAgent = createFakeAgent(fixture.root, agentLog);
	writeConfig(fixture.checkout, fakeAgent);
	const result = runCli(fixture.checkout, [slug, "start"]);
	if (result.status !== 0) {
		throw new Error(`agent-session start failed: ${result.stderr}`);
	}
	return {
		worktree: join(realpathSync(fixture.worktrees), slug),
		agentLog,
	};
}

function commitSessionWork(worktree: string): void {
	git(worktree, "config", "user.name", "Agent Session Test");
	git(worktree, "config", "user.email", "agent-session@example.invalid");
	writeFileSync(join(worktree, "finished.txt"), "finished\n");
	git(worktree, "add", "finished.txt");
	git(
		worktree,
		"-c",
		"commit.gpgsign=false",
		"commit",
		"-m",
		"Finish session work",
	);
}

function sessionMetadataPath(checkout: string, slug: string): string {
	return join(checkout, ".git", "agent-session", "sessions", `${slug}.json`);
}

function advanceRemoteDefault(
	fixture: ReturnType<typeof createRepositoryFixture>,
): string {
	git(fixture.seed, "pull", "--rebase", "origin", "master");
	writeFileSync(join(fixture.seed, "LATEST.md"), `${Date.now()}\n`);
	git(fixture.seed, "add", "LATEST.md");
	git(
		fixture.seed,
		"-c",
		"commit.gpgsign=false",
		"commit",
		"-m",
		"Advance remote default",
	);
	git(fixture.seed, "push", "origin", "master");
	return git(fixture.seed, "rev-parse", "HEAD");
}

function mergeSessionAndDeleteRemoteBranch(
	fixture: ReturnType<typeof createRepositoryFixture>,
	slug = "git-hygiene",
): void {
	git(fixture.seed, "fetch", "origin", `agent/${slug}`);
	git(
		fixture.seed,
		"-c",
		"commit.gpgsign=false",
		"merge",
		"--no-ff",
		`origin/agent/${slug}`,
		"-m",
		"Merge session",
	);
	git(fixture.seed, "push", "origin", "master");
	git(fixture.seed, "push", "origin", "--delete", `agent/${slug}`);
}

describe("subject-first invocation", () => {
	it("creates and inspects a named session while retaining repository-wide commands", () => {
		const fixture = createRepositoryFixture();
		try {
			const created = runCli(fixture.checkout, ["new-task", "create"]);
			expect(created.status).toBe(0);
			const inspected = runCli(fixture.checkout, ["new-task", "status", "--json"]);
			expect(inspected.status).toBe(0);
			expect(JSON.parse(inspected.stdout).sessions[0].slug).toBe("new-task");
			expect(runCli(fixture.checkout, ["status", "--json"]).status).toBe(0);
			expect(runCli(fixture.checkout, ["finish", "--all", "--dry-run", "--json"]).status).toBe(0);
			expect(runCli(fixture.checkout, ["completion", "bash"]).status).toBe(0);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("rejects legacy argument order before creating, deleting or executing anything", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			for (const args of [
				["create", "should-not-exist"],
				["start", "should-not-exist"],
				["launch", "git-hygiene"],
				["resume", "git-hygiene"],
				["repair", "git-hygiene"],
				["status", "git-hygiene"],
				["status", "--json", "git-hygiene"],
				["finish", "git-hygiene", "--keep-branch", "--yes"],
				["run", "git-hygiene", "touch", "unexpected"],
				["cd", "git-hygiene"],
				["--", "create"],
			]) {
				expect(runCli(fixture.checkout, args).status).toBe(64);
				expect(existsSync(worktree)).toBe(true);
			}
			expect(existsSync(join(fixture.worktrees, "should-not-exist"))).toBe(false);
			expect(existsSync(join(worktree, "unexpected"))).toBe(false);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("never interprets a flag-like target as a global selector", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			for (const args of [
				["--all", "finish", "--yes"],
				["--gone", "finish", "--yes"],
				["--json", "status"],
				["--", "--all", "finish", "--yes"],
			]) {
				expect(runCli(fixture.checkout, args).status).toBe(64);
				expect(existsSync(worktree)).toBe(true);
			}
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("requires an explicit escape for slugs that collide with command words", () => {
		const fixture = createRepositoryFixture();
		try {
			for (const slug of ["status", "finish", "create", "run", "completion"]) {
				expect(runCli(fixture.checkout, ["--", slug, "create"]).status).toBe(0);
				const result = runCli(fixture.checkout, ["--", slug, "status", "--json"]);
				expect(result.status).toBe(0);
				expect(JSON.parse(result.stdout).sessions[0].slug).toBe(slug);
				expect(runCli(fixture.checkout, [slug, "cd"]).status).toBe(64);
			}
			const targets = runCli(fixture.checkout, ["__complete", "targets"]);
			expect(targets.stdout).toContain("status\n");
			expect(targets.stdout.split("\n").includes("create")).toBe(false);
			const escaped = runCli(fixture.checkout, ["__complete", "sessions"]);
			expect(escaped.stdout).toContain("create\n");
			git(fixture.checkout, "worktree", "remove", join(fixture.worktrees, "status"));
			const orphaned = runCli(fixture.checkout, ["--", "status", "status", "--json"]);
			expect(orphaned.status).toBe(0);
			expect(JSON.parse(orphaned.stdout).sessions[0].problem).toContain("agent-session -- status finish --force");
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});
});

describe("agent-session create and start", () => {
	it("creates, inspects and receipt-finishes sessions through the installed package outside the source checkout", () => {
		const fixture = createRepositoryFixture();
		try {
			const installed = (command: string, args: string[]) => spawnSync(command, args, {
				cwd: fixture.checkout,
				encoding: "utf8",
			});
			const created = installed("as", ["installed-package", "create", "--json"]);
			expect(created.status).toBe(0);
			const creationReceipt = JSON.parse(created.stdout);
			expect(creationReceipt.version).toBe(1);
			expect(creationReceipt.dryRun).toBe(false);
			const worktree = join(realpathSync(fixture.worktrees), "installed-package");
			expect(creationReceipt.session.worktreePath).toBe(worktree);
			const status = installed("as", ["installed-package", "status", "--json"]);
			expect(status.status).toBe(0);
			const catalog = JSON.parse(status.stdout);
			expect(catalog.sessions.length).toBe(1);
			expect(catalog.sessions[0].worktreePath).toBe(worktree);
			const path = installed("agent-session", ["installed-package", "cd"]);
			expect(path.status).toBe(0);
			expect(path.stdout).toBe(`${worktree}\n`);
			const candidates = installed("as", ["__complete", "finish"]);
			expect(candidates.status).toBe(0);
			expect(candidates.stdout).toBe("installed-package\n");
			const preview = installed("as", ["installed-package", "finish", "--keep-branch", "--dry-run", "--json"]);
			expect(preview.status).toBe(0);
			const receipt = JSON.parse(preview.stdout).plan.receipt;
			expect(receipt.length).toBe(64);
			const finished = installed("as", ["installed-package", "finish", "--keep-branch", "--yes", "--expected", receipt]);
			expect(finished.status).toBe(0);
			expect(existsSync(worktree)).toBe(false);
			expect(git(fixture.checkout, "branch", "--list", "agent/installed-package")).toBe("agent/installed-package");
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("is packaged and configured by the shared devenv module", () => {
		expect(existsSync(cliScript)).toBe(true);
		const module = readFileSync("modules/flake/agent-session/devenv.nix", "utf8");
		const devenv = readFileSync("devenv.nix", "utf8");

		expect(module).toContain("options.agentSession");
		expect(module).toContain('default = ".worktrees"');
		expect(module).toContain('default = [ "pi" ]');
		expect(module.includes("verifyCommand")).toBe(false);
		expect(module.includes("verify_command")).toBe(false);
		expect(module).toContain("packages = [ agentSessionPackage ]");
		expect(module).toContain("pkgs.nodejs_24");
		expect(module.includes("pkgs.bun")).toBe(false);
		expect(module).toContain("share/bash-completion/completions/agent-session");
		expect(module).toContain("share/zsh/site-functions/_agent_session");
		expect(module).toContain(
			"share/fish/vendor_completions.d/agent-session.fish",
		);
		expect(module).toContain("nix-support/setup-hook");
		expect(module).toContain('"$out/bin/as"');
		expect(module).toContain("bash-completion/completions/as");
		expect(module).toContain("fish/vendor_completions.d/as.fish");
		// FPATH exported by direnv replaces a running Zsh's existing fpath.
		expect(module.includes("addToSearchPath FPATH")).toBe(false);
		expect(module).toContain("env.AGENT_SESSION_COMPLETION_ROOT");
		expect(module).toContain("env.AGENT_SESSION_CONFIG = runtimeConfig;");
		expect(module).toContain("env.DIRENV_ZSH_COMPLETION_DIRS");
		expect(devenv).toContain("./modules/flake/agent-session/devenv.nix");
		expect(devenv).toContain("agentSession = {");
		expect(devenv).toContain("enable = true;");
		expect(existsSync(".agent-session.toml")).toBe(false);
		expect(existsSync("scripts/agent-session")).toBe(false);

	});

	it("starts from the fetched remote default tip and launches the configured agent", () => {
		const fixture = createRepositoryFixture();
		try {
			const agentCwd = join(fixture.root, "agent-cwd");
			const fakeAgent = createFakeAgent(fixture.root, agentCwd);
			writeConfig(fixture.checkout, fakeAgent);
			const localHeadBefore = git(fixture.checkout, "rev-parse", "HEAD");
			git(
				fixture.checkout,
				"symbolic-ref",
				"refs/remotes/origin/HEAD",
				"refs/remotes/origin/stale-local-default",
			);
			const latestRemoteHead = advanceRemoteDefault(fixture);

			const result = runCli(fixture.checkout, ["git-hygiene", "start"]);
			const worktree = join(realpathSync(fixture.worktrees), "git-hygiene");

			expect(result.status).toBe(0);
			expect(result.stderr).toContain("[agent-session] STARTED remote-sync");
			expect(result.stderr).toContain(
				"[agent-session] COMPLETED metadata-record",
			);
			expect(result.stderr).toContain("Agent worktree ready");
			expect(readFileSync(agentCwd, "utf8").trim()).toBe(worktree);
			expect(git(worktree, "branch", "--show-current")).toBe(
				"agent/git-hygiene",
			);
			expect(git(worktree, "rev-parse", "HEAD")).toBe(latestRemoteHead);
			expect(git(fixture.checkout, "rev-parse", "HEAD")).toBe(localHeadBefore);
			expect(git(fixture.checkout, "branch", "--show-current")).toBe("master");
			expect(
				existsSync(
					join(
						fixture.checkout,
						".git",
						"agent-session",
						"sessions",
						"git-hygiene.json",
					),
				),
			).toBe(true);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("creates a prepared session without launching an agent", () => {
		const fixture = createRepositoryFixture();
		try {
			const agentCwd = join(fixture.root, "agent-cwd");
			const fakeAgent = createFakeAgent(fixture.root, agentCwd);
			writeConfig(fixture.checkout, fakeAgent);

			const result = runCli(fixture.checkout, ["agent-friendly", "create"]);

			expect(result.status).toBe(0);
			const worktree = join(realpathSync(fixture.worktrees), "agent-friendly");
			expect(result.stderr).toContain("Agent worktree ready");
			expect(result.stdout).toContain(
				"Session created without launching the configured agent",
			);
			expect(existsSync(agentCwd)).toBe(false);
			expect(existsSync(worktree)).toBe(true);
			expect(git(worktree, "branch", "--show-current")).toBe(
				"agent/agent-friendly",
			);
			expect(
				existsSync(sessionMetadataPath(fixture.checkout, "agent-friendly")),
			).toBe(true);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("returns one persisted creation receipt with JSON progress despite subprocess output", () => {
		const fixture = createRepositoryFixture();
		try {
			const launched = join(fixture.root, "agent-launched");
			const prepared = join(fixture.root, "prepared");
			writeConfig(fixture.checkout, createFakeAgent(fixture.root, launched), [
				"bash", "-c", `printf 'preparation stdout\\n'; printf 'preparation stderr\\n' >&2; printf '%s' "$PWD" > ${tomlString(prepared)}`,
			]);
			const result = runCli(fixture.checkout, ["json-created", "create", "--json"]);
			expect(result.status).toBe(0);
			const payload = JSON.parse(result.stdout);
			expect(payload.version).toBe(1);
			expect(payload.command).toBe("create");
			expect(payload.dryRun).toBe(false);
			expect(payload.session.slug).toBe("json-created");
			expect(payload.session.branch).toBe("agent/json-created");
			expect(payload.session.worktreePath).toBe(join(realpathSync(fixture.worktrees), "json-created"));
			expect(JSON.stringify(payload.session)).toBe(JSON.stringify(JSON.parse(readFileSync(sessionMetadataPath(fixture.checkout, "json-created"), "utf8"))));
			expect(result.stdout.trim().split("\n").length).toBe(1);
			expect(readFileSync(prepared, "utf8")).toBe(payload.session.worktreePath);
			expect(existsSync(launched)).toBe(false);
			const events = result.stderr.trim().split("\n").map((line) => JSON.parse(line));
			expect(events.every((event) => event.version === 1 && event.type === "progress" && event.command === "create")).toBe(true);
			expect(events.filter((event) => event.status === "completed").map((event) => event.phase).join(",")).toBe("remote-sync,worktree-create,worktree-prepare,metadata-record");
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("emits no creation receipt and rolls back a failed JSON preparation", () => {
		const fixture = createRepositoryFixture();
		try {
			writeConfig(fixture.checkout, "true", ["bash", "-c", "printf 'failed preparation stdout\\n'; printf 'failed preparation stderr\\n' >&2; exit 7"]);
			const result = runCli(fixture.checkout, ["json-failed", "create", "--json"]);
			expect(result.status).toBe(1);
			expect(result.stdout).toBe("");
			expect(result.stderr).toContain("failed preparation stderr");
			const events = result.stderr.split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line));
			expect(events.some((event) => event.phase === "worktree-prepare" && event.status === "failed")).toBe(true);
			expect(events.some((event) => event.phase === "metadata-record")).toBe(false);
			expect(existsSync(join(fixture.worktrees, "json-failed"))).toBe(false);
			expect(existsSync(sessionMetadataPath(fixture.checkout, "json-failed"))).toBe(false);
			expect(git(fixture.checkout, "branch", "--list", "agent/json-failed")).toBe("");
			expect(git(fixture.checkout, "worktree", "list", "--porcelain").includes("json-failed")).toBe(false);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("retains captured Git failure diagnostics without emitting a JSON creation receipt", () => {
		const fixture = createRepositoryFixture();
		try {
			writeConfig(fixture.checkout, "true");
			git(fixture.checkout, "remote", "set-url", "origin", join(fixture.root, "missing-remote.git"));
			const result = runCli(fixture.checkout, ["json-fetch-failed", "create", "--json"]);
			expect(result.status).toBe(1);
			expect(result.stdout).toBe("");
			const events = result.stderr.split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line));
			const failed = events.find((event) => event.phase === "remote-sync" && event.status === "failed");
			expect(failed?.detail.includes("missing-remote.git")).toBe(true);
			expect(existsSync(sessionMetadataPath(fixture.checkout, "json-fetch-failed"))).toBe(false);
			expect(git(fixture.checkout, "branch", "--list", "agent/json-fetch-failed")).toBe("");
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("flushes large status JSON completely through source and installed entrypoints", () => {
		const fixture = createRepositoryFixture();
		try {
			writeConfig(fixture.checkout, "true");
			const directory = join(fixture.checkout, ".git", "agent-session", "sessions");
			mkdirSync(directory, { recursive: true });
			for (let index = 0; index < 48; index++) {
				const slug = `large-session-${String(index).padStart(2, "0")}`;
				writeFileSync(join(directory, `${slug}.json`), JSON.stringify({
					version: 1, slug, branch: `agent/${slug}`, worktreePath: join(fixture.worktrees, slug),
					remote: "origin", defaultBranch: "master", createdAt: "2026-01-01T00:00:00.000Z", conversation: null,
					preexistingBranches: Array.from({ length: 128 }, (_, branch) => `feat/topic-${branch}-${"a".repeat(32)}`),
				}));
			}
			// Pause the reader until output arrives, then delay draining the pipe.
			// This makes truncation deterministic instead of relying on scheduling.
			const slowReader = `
import { spawn } from 'node:child_process';
const [entry, ...args] = process.argv.slice(1);
const child = spawn(entry, args, { stdio: ['ignore', 'pipe', 'pipe'] });
const chunks = [];
child.stdout.once('readable', () => setTimeout(() => {
  child.stdout.on('data', (chunk) => chunks.push(chunk));
  child.stdout.resume();
}, 100));
child.stderr.on('data', (chunk) => process.stderr.write(chunk));
child.on('error', (error) => { process.stderr.write(String(error)); process.exitCode = 1; });
child.on('close', (code) => { process.stdout.write(Buffer.concat(chunks)); process.exitCode = code ?? 1; });
`;
			const results = [["node", cliScript], ["as"]].map((entry) =>
				spawnSync("node", ["--input-type=module", "-e", slowReader, ...entry, "status", "--json"], {
					cwd: fixture.checkout,
					encoding: "utf8",
					env: { ...process.env, AGENT_SESSION_CONFIG: runtimeConfigPath(fixture.checkout) },
				}),
			);
			for (const result of results) {
				expect(result.status).toBe(0);
				expect(result.stdout.length > 128 * 1024).toBe(true);
				expect(result.stdout.endsWith("\n")).toBe(true);
				const payload = JSON.parse(result.stdout);
				expect(payload.version).toBe(1);
				expect(payload.sessions.length).toBe(48);
				expect(payload.sessions.at(-1).slug).toBe("large-session-47");
				expect(payload.sessions.at(-1).preexistingBranches.length).toBe(128);
			}
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("previews creation with machine-readable progress and no mutation", () => {
		const fixture = createRepositoryFixture();
		try {
			const fakeAgent = createFakeAgent(
				fixture.root,
				join(fixture.root, "agent-cwd"),
			);
			writeConfig(fixture.checkout, fakeAgent, ["prepare-session"]);
			advanceRemoteDefault(fixture);
			const trackedDefaultBefore = git(
				fixture.checkout,
				"rev-parse",
				"refs/remotes/origin/master",
			);

			const result = runCli(fixture.checkout, [
				"preview",
				"create",
				"--dry-run",
				"--json",
			]);

			expect(result.status).toBe(0);
			const payload = JSON.parse(result.stdout) as {
				version: number;
				command: string;
				dryRun: boolean;
				plan: {
					branch: string;
					remote: string;
					defaultBranch: string;
					agentLaunch: boolean;
				};
			};
			expect(payload.version).toBe(1);
			expect(payload.command).toBe("create");
			expect(payload.dryRun).toBe(true);
			expect(payload.plan.branch).toBe("agent/preview");
			expect(payload.plan.remote).toBe("origin");
			expect(payload.plan.defaultBranch).toBe("master");
			expect(payload.plan.agentLaunch).toBe(false);
			const events = result.stderr
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as { type: string; status: string });
			expect(events[0]?.type).toBe("progress");
			expect(events[0]?.status).toBe("started");
			expect(events.at(-1)?.status).toBe("completed");
			expect(existsSync(join(fixture.worktrees, "preview"))).toBe(false);
			expect(existsSync(sessionMetadataPath(fixture.checkout, "preview"))).toBe(
				false,
			);
			expect(
				git(fixture.checkout, "rev-parse", "refs/remotes/origin/master"),
			).toBe(trackedDefaultBefore);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("creates a sibling session when invoked from a managed worktree", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree: callerWorktree } = startManagedSession(
				fixture,
				"caller",
			);

			const result = runCli(callerWorktree, ["sibling", "start", "--no-agent"]);

			expect(result.status).toBe(0);
			expect(result.stdout).toContain(
				"Session created without launching the configured agent",
			);
			expect(existsSync(join(realpathSync(fixture.worktrees), "sibling"))).toBe(
				true,
			);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("rejects a missing module-generated runtime configuration", () => {
		const fixture = createRepositoryFixture();
		try {
			const result = runCli(fixture.checkout, ["git-hygiene", "start"], {
				AGENT_SESSION_CONFIG: "",
			});
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("devenv module configuration");
			expect(
				git(fixture.checkout, "branch", "--list", "agent/git-hygiene"),
			).toBe("");
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("does not expose imperative initialization", () => {
		const fixture = createRepositoryFixture();
		try {
			const result = runCli(fixture.checkout, ["init"]);
			expect(result.status).toBe(64);
			expect(result.stderr.includes("agent-session init")).toBe(false);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("rejects invalid task slugs before changing Git state", () => {
		const fixture = createRepositoryFixture();
		try {
			mkdirSync(fixture.worktrees, { recursive: true });
			const result = runCli(fixture.checkout, ["Git Hygiene", "start"]);
			expect(result.status).toBe(64);
			expect(result.stderr).toContain(
				"Use lowercase letters, numbers, dots, or dashes",
			);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("rejects absolute and traversing worktree roots", () => {
		const fixture = createRepositoryFixture();
		try {
			const fakeAgent = createFakeAgent(
				fixture.root,
				join(fixture.root, "agent-cwd"),
			);
			for (const worktreeRoot of [
				join(fixture.root, "outside"),
				"../outside",
			]) {
				writeConfig(fixture.checkout, fakeAgent, [], worktreeRoot);
				const result = runCli(fixture.checkout, ["unsafe-root", "start"]);
				expect(result.status).toBe(1);
				expect(result.stderr).toContain("project-local relative subtree");
			}
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("rejects a project-local worktree root that is not Git-ignored", () => {
		const fixture = createRepositoryFixture();
		try {
			writeFileSync(join(fixture.checkout, ".gitignore"), "*.log\n");
			git(fixture.checkout, "add", ".gitignore");
			git(
				fixture.checkout,
				"-c",
				"commit.gpgsign=false",
				"-c",
				"user.name=Agent Session Test",
				"-c",
				"user.email=agent-session@example.invalid",
				"commit",
				"-m",
				"Stop ignoring worktrees",
			);
			const fakeAgent = createFakeAgent(
				fixture.root,
				join(fixture.root, "agent-cwd"),
			);
			writeConfig(fixture.checkout, fakeAgent);

			const result = runCli(fixture.checkout, ["not-ignored", "start"]);

			expect(result.status).toBe(1);
			expect(result.stderr).toContain("must be Git-ignored");
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});
});

describe("agent-session cd and run", () => {
	it("resolves an existing worktree offline from any checkout without requiring clean work", () => {
		const fixture = createRepositoryFixture("agent session ");
		try {
			const { worktree, agentLog } = startManagedSession(fixture);
			writeFileSync(join(fixture.checkout, "unfinished"), "primary work");
			writeFileSync(join(worktree, "unfinished"), "session work");
			git(fixture.checkout, "remote", "set-url", "origin", join(fixture.root, "offline"));
			for (const cwd of [fixture.checkout, worktree]) {
				const result = runCli(cwd, ["git-hygiene", "cd"]);
				expect(result.status).toBe(0);
				expect(result.stdout).toBe(`${worktree}\n`);
				expect(result.stderr).toBe("");
			}
			expect(readFileSync(agentLog, "utf8").trim().split("\n").length).toBe(1);
			expect(readFileSync(join(worktree, "unfinished"), "utf8")).toBe("session work");
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("refuses missing, orphaned, unregistered, and redirected sessions", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			expect(runCli(fixture.checkout, ["unknown", "cd"]).status).toBe(1);
			expect(runCli(fixture.checkout, ["../escape", "cd"]).status).toBe(64);
			const metadataFile = sessionMetadataPath(fixture.checkout, "git-hygiene");
			const original = readFileSync(metadataFile, "utf8");
			writeFileSync(metadataFile, JSON.stringify({ ...JSON.parse(original), worktreePath: fixture.seed }));
			expect(runCli(fixture.checkout, ["git-hygiene", "cd"]).status).toBe(1);
			writeFileSync(metadataFile, original);
			// A nested directory is not the registered worktree, even in the same repository.
			const child = join(worktree, "child");
			mkdirSync(child);
			writeFileSync(metadataFile, JSON.stringify({ ...JSON.parse(original), worktreePath: child }));
			expect(runCli(fixture.checkout, ["git-hygiene", "cd"]).status).toBe(1);
			writeFileSync(metadataFile, original);
			git(fixture.checkout, "worktree", "remove", "--force", worktree);
			expect(runCli(fixture.checkout, ["git-hygiene", "cd"]).status).toBe(1);
			mkdirSync(worktree);
			expect(runCli(fixture.checkout, ["git-hygiene", "cd"]).status).toBe(1);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("runs one command through quiet devenv with exact arguments, output and exit status", () => {
		const fixture = createRepositoryFixture("agent session ");
		try {
			const { worktree } = startManagedSession(fixture);
			writeFileSync(join(fixture.checkout, "unfinished"), "primary work");
			writeFileSync(join(worktree, "unfinished"), "session work");
			git(fixture.checkout, "remote", "set-url", "origin", join(fixture.root, "offline"));
			const bin = join(fixture.root, "bin");
			mkdirSync(bin);
			writeFileSync(join(bin, "devenv"), `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.DEVENV_LOG, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));
const result = spawnSync(process.argv[5], process.argv.slice(6), { stdio: 'inherit' });
process.exit(result.status ?? 1);
`);
			chmodSync(join(bin, "devenv"), 0o755);
			const log = join(fixture.root, "devenv.json");
			const command = ["node", "-e", "process.stdout.write(JSON.stringify(process.argv.slice(1))); process.stderr.write('command stderr\\n'); process.exit(23)", "", "two words", "$(not-evaluated)", "; not evaluated"];
			const result = runCli(worktree, ["git-hygiene", "run", ...command], {
				PATH: `${bin}:${process.env.PATH}`,
				DEVENV_LOG: log,
			});
			expect(result.status).toBe(23);
			expect(result.stdout).toBe(JSON.stringify(command.slice(3)));
			expect(result.stderr).toBe("command stderr\n");
			const invoked = JSON.parse(readFileSync(log, "utf8"));
			expect(invoked.cwd).toBe(worktree);
			expect(JSON.stringify(invoked.args)).toBe(JSON.stringify(["-q", "shell", "--", ...command]));
			expect(readFileSync(join(worktree, "unfinished"), "utf8")).toBe("session work");
			const invalid = runCli(fixture.checkout, ["unknown", "run", ...command]);
			expect(invalid.status).toBe(1);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("diagnoses missing parent-shell integration instead of pretending the executable can cd", () => {
		const result = spawnSync("as", ["example", "cd"], { encoding: "utf8" });
		expect(result.status).toBe(64);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("shell integration");
	});

	it("requires an explicit slug and a command for run", () => {
		for (const args of [["cd"], ["task", "cd", "extra"], ["run"], ["task", "run"]]) {
			expect(runCli(resolve("."), args).status).toBe(64);
		}
	});

	for (const shell of ["bash", "zsh", "fish"]) {
		it(`changes the current ${shell} directory and preserves it on errors`, () => {
			const fixture = createRepositoryFixture("agent session ");
			try {
				const { worktree } = startManagedSession(fixture);
				const bin = installFixtureCLI(fixture);
				const integration = installedShellIntegration(shell);
				const script = shell === "fish" ? `
source "$INTEGRATION"
as git-hygiene cd; or exit 11
test "$PWD" = "$EXPECTED"; or exit 12
as unknown cd 2>/dev/null; and exit 13
test "$PWD" = "$EXPECTED"; or exit 14
as __complete cd | string match -q git-hygiene; or exit 15
` : `
source "$INTEGRATION"
as git-hygiene cd || exit 11
[ "$PWD" = "$EXPECTED" ] || exit 12
if as unknown cd 2>/dev/null; then exit 13; fi
[ "$PWD" = "$EXPECTED" ] || exit 14
[ "$(as __complete cd)" = git-hygiene ] || exit 15
`;
				const result = spawnSync(shell, [shell === "fish" ? "--no-config" : shell === "bash" ? "--noprofile" : "-f", "-c", script], {
					cwd: fixture.checkout,
					encoding: "utf8",
					env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, INTEGRATION: integration, EXPECTED: worktree, AGENT_SESSION_CONFIG: runtimeConfigPath(fixture.checkout) },
				});
				expect(result.status).toBe(0);
				expect(result.stdout).toBe("");
			} finally {
				rmSync(fixture.root, { recursive: true, force: true });
			}
		});
	}

	for (const shell of ["bash", "zsh", "fish"]) {
		it(`navigates to an escaped command-word slug in ${shell}`, () => {
			const fixture = createRepositoryFixture();
			try {
				writeConfig(fixture.checkout, "true");
				expect(runCli(fixture.checkout, ["--", "status", "create"]).status).toBe(0);
				const expected = join(realpathSync(fixture.worktrees), "status");
				const bin = installFixtureCLI(fixture);
				const script = shell === "fish"
					? 'source "$INTEGRATION"; as -- status cd; or exit; printf "%s\\n" "$PWD"'
					: 'source "$INTEGRATION"; as -- status cd || exit; printf "%s\\n" "$PWD"';
				const result = spawnSync(shell, [shell === "fish" ? "--no-config" : shell === "bash" ? "--noprofile" : "-f", "-c", script], {
					cwd: fixture.checkout,
					encoding: "utf8",
					env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, INTEGRATION: installedShellIntegration(shell), AGENT_SESSION_CONFIG: runtimeConfigPath(fixture.checkout) },
				});
				expect(result.status).toBe(0);
				expect(result.stdout).toBe(`${expected}\n`);
			} finally {
				rmSync(fixture.root, { recursive: true, force: true });
			}
		});

		it(`preserves the executable as outside enabled projects in ${shell}`, () => {
			const root = mkdtempSync(join(tmpdir(), "agent-shell-fallback-"));
			try {
				writeFileSync(join(root, "as"), '#!/usr/bin/env bash\nprintf "%s\\n" "$*"\n');
				chmodSync(join(root, "as"), 0o755);
				const integration = installedShellIntegration(shell);
				const result = spawnSync(shell, [shell === "fish" ? "--no-config" : shell === "bash" ? "--noprofile" : "-f", "-c", 'source "$INTEGRATION"; as cd input.s'], {
					encoding: "utf8",
					env: { ...process.env, PATH: `${root}:${process.env.PATH}`, INTEGRATION: integration, AGENT_SESSION_CONFIG: "" },
				});
				expect(result.status).toBe(0);
				expect(result.stdout).toBe("cd input.s\n");
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});
	}

	for (const shell of ["bash", "fish"]) {
		it(`completes session slugs then command names in ${shell}`, () => {
			const fixture = createRepositoryFixture();
			try {
				startManagedSession(fixture);
				const bin = installFixtureCLI(fixture);
				expect(runCli(fixture.checkout, ["--", "status", "create"]).status).toBe(0);
				writeFileSync(join(bin, "git-completion-test"), "#!/usr/bin/env bash\nexit 0\n");
				chmodSync(join(bin, "git-completion-test"), 0o755);
				const completion = runCli(fixture.checkout, ["completion", shell]);
				expect(completion.status).toBe(0);
				const path = join(fixture.root, "completion");
				writeFileSync(path, completion.stdout.replaceAll("-c agent-session ", "-c as "));
				const script = shell === "fish" ? `
source "$COMPLETION"
complete -C 'as git-' | string replace -r '^' 'slug:'
complete -C 'as git-hygiene r' | string replace -r '^' 'action:'
complete -C 'as git-hygiene run git-' | string replace -r '^' 'command:'
complete -C 'as -- sta' | string replace -r '^' 'escaped:'
complete -C 'as -- status run git-' | string replace -r '^' 'escaped-command:'
complete -c git-completion-test -l marker-flag
complete -C 'as -- status run git-completion-test --marker' | string replace -r '^' 'escaped-option:'
` : `
source "$COMPLETION"
COMP_WORDS=(as git-); COMP_CWORD=1; _agent_session
printf 'slug:%s\\n' "\${COMPREPLY[@]}"
COMP_WORDS=(as git-hygiene r); COMP_CWORD=2; _agent_session
printf 'action:%s\\n' "\${COMPREPLY[@]}"
COMP_WORDS=(as git-hygiene run git-); COMP_CWORD=3; _agent_session
printf 'command:%s\\n' "\${COMPREPLY[@]}"
COMP_WORDS=(as -- sta); COMP_CWORD=2; _agent_session
printf 'escaped:%s\\n' "\${COMPREPLY[@]}"
COMP_WORDS=(as -- status run git-); COMP_CWORD=4; _agent_session
printf 'escaped-command:%s\\n' "\${COMPREPLY[@]}"
`;
				const result = spawnSync(shell, [shell === "fish" ? "--no-config" : "--noprofile", "-c", script], {
					cwd: fixture.checkout,
					encoding: "utf8",
					env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, COMPLETION: path, AGENT_SESSION_CONFIG: runtimeConfigPath(fixture.checkout) },
				});
				expect(result.status).toBe(0);
				expect(result.stdout).toContain("slug:git-hygiene");
				expect(result.stdout).toContain("action:run");
				expect(result.stdout).toContain("command:git-completion-test");
				expect(result.stdout.includes("command:git-hygiene")).toBe(false);
				expect(result.stdout).toContain("escaped:status");
				expect(result.stdout).toContain("escaped-command:git-completion-test");
				if (shell === "fish") expect(result.stdout).toContain("escaped-option:--marker-flag");
			} finally {
				rmSync(fixture.root, { recursive: true, force: true });
			}
		});
	}

	it("delegates Zsh run-command completion with the command's own words and cursor", () => {
		const root = mkdtempSync(join(tmpdir(), "agent-completion-"));
		try {
			writeFileSync(join(root, "_agent_session"), runCli(resolve("."), ["completion", "zsh"]).stdout);
			const result = spawnSync("zsh", ["-f", "-c", `
fpath=("$COMPLETION" $fpath)
autoload -Uz compinit
compinit -D -i
_normal() { print -r -- "$CURRENT:\${(j:|:)words}"; }
words=(as git-hygiene run git-completion-test --arg)
CURRENT=5
_agent_session
words=(as -- status run git-completion-test --arg)
CURRENT=6
_agent_session
`], { encoding: "utf8", env: { ...process.env, COMPLETION: root } });
			expect(result.status).toBe(0);
			expect(result.stdout).toBe("2:git-completion-test|--arg\n2:git-completion-test|--arg\n");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("offers session slugs for cd and run", () => {
		const fixture = createRepositoryFixture();
		try {
			startManagedSession(fixture);
			for (const command of ["run", "cd"]) {
				expect(runCli(fixture.checkout, ["__complete", command]).stdout).toBe("git-hygiene\n");
			}
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});
});

describe("agent-session status, launch, and resume", () => {
	it("reports managed state as human text and stable JSON without fetching by default", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			writeFileSync(join(worktree, "unfinished.txt"), "unfinished\n");
			advanceRemoteDefault(fixture);
			const trackedDefaultBefore = git(
				fixture.checkout,
				"rev-parse",
				"refs/remotes/origin/master",
			);

			const initial = runCli(worktree, ["status", "--json"]);
			expect(initial.status).toBe(0);
			const initialPayload = JSON.parse(initial.stdout) as {
				sessions: Array<{
					slug: string;
					branch: string;
					clean: boolean;
					fresh: boolean;
					publication: string;
				}>;
			};
			expect(initialPayload.sessions.length).toBe(1);
			expect(initialPayload.sessions[0]?.slug).toBe("git-hygiene");
			expect(initialPayload.sessions[0]?.branch).toBe("agent/git-hygiene");
			expect(initialPayload.sessions[0]?.clean).toBe(false);
			expect(initialPayload.sessions[0]?.fresh).toBe(true);
			expect(initialPayload.sessions[0]?.publication).toBe("unpublished");
			expect(
				git(fixture.checkout, "rev-parse", "refs/remotes/origin/master"),
			).toBe(trackedDefaultBefore);

			const refreshed = runCli(worktree, ["status", "--refresh", "--json"]);
			expect(refreshed.status).toBe(0);
			const refreshedPayload = JSON.parse(refreshed.stdout) as {
				sessions: Array<{ fresh: boolean }>;
			};
			expect(refreshedPayload.sessions[0]?.fresh).toBe(false);

			const human = runCli(worktree, ["git-hygiene", "status"]);
			expect(human.status).toBe(0);
			expect(human.stdout).toContain("git-hygiene");
			expect(human.stdout).toContain("DIRTY");
			expect(human.stdout).toContain("STALE");
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("reconciles orphaned metadata and unrecorded managed worktrees", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			git(fixture.checkout, "worktree", "remove", "--force", worktree);

			const human = runCli(fixture.checkout, ["git-hygiene", "status"]);
			expect(human.status).toBe(0);
			expect(human.stdout).toContain(
				"git-hygiene  agent/git-hygiene  ORPHANED",
			);
			expect(human.stderr).toContain("Managed worktree is missing");
			expect(human.stderr).toContain(
				"agent-session git-hygiene finish --force",
			);

			const json = runCli(fixture.checkout, [
				"git-hygiene",
				"status",
				"--json",
			]);
			expect(json.status).toBe(0);
			const payload = JSON.parse(json.stdout) as {
				sessions: Array<{ state: string; problem?: string }>;
			};
			expect(payload.sessions[0]?.state).toBe("orphaned");
			expect(payload.sessions[0]?.problem).toContain(
				"Managed worktree is missing",
			);

			const { worktree: unrecordedWorktree } = startManagedSession(
				fixture,
				"unrecorded",
			);
			rmSync(sessionMetadataPath(fixture.checkout, "unrecorded"));
			const unrecorded = runCli(unrecordedWorktree, [
				"unrecorded",
				"status",
				"--json",
			]);
			expect(unrecorded.status).toBe(0);
			const unrecordedPayload = JSON.parse(unrecorded.stdout) as {
				sessions: Array<{
					state: string;
					worktreePath: string;
					problem?: string;
				}>;
			};
			expect(unrecordedPayload.sessions[0]?.state).toBe("unrecorded");
			expect(unrecordedPayload.sessions[0]?.worktreePath).toBe(
				unrecordedWorktree,
			);
			expect(unrecordedPayload.sessions[0]?.problem).toContain(
				"Session metadata is missing",
			);

			const repaired = runCli(unrecordedWorktree, ["unrecorded", "repair"]);
			expect(repaired.status).toBe(0);
			expect(repaired.stdout).toContain("Session metadata repaired");
			const repairedStatus = runCli(fixture.checkout, [
				"unrecorded",
				"status",
				"--json",
			]);
			const repairedPayload = JSON.parse(repairedStatus.stdout) as {
				sessions: Array<{ state: string }>;
			};
			expect(repairedPayload.sessions[0]?.state).toBe("ready");
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("diagnoses an unrelated current branch with expected and owned branches", () => {
		const fixture = createRepositoryFixture();
		try {
			git(fixture.checkout, "branch", "feat/pre-existing");
			const { worktree } = startManagedSession(fixture);
			git(worktree, "switch", "feat/pre-existing");

			const result = runCli(fixture.checkout, ["git-hygiene", "status"]);

			expect(result.status).toBe(0);
			expect(result.stdout).toContain("CONFLICT");
			expect(result.stderr).toContain(
				"Saved initial branch: agent/git-hygiene",
			);
			expect(result.stderr).toContain("Current branch: feat/pre-existing");
			expect(result.stderr).toContain(
				"Session-owned branches: agent/git-hygiene",
			);

			const json = runCli(fixture.checkout, [
				"git-hygiene",
				"status",
				"--json",
			]);
			const payload = JSON.parse(json.stdout) as {
				sessions: Array<{
					initialBranch: string;
					currentBranch: string;
					ownedBranches: string[];
				}>;
			};
			expect(payload.sessions[0]?.initialBranch).toBe("agent/git-hygiene");
			expect(payload.sessions[0]?.currentBranch).toBe("feat/pre-existing");
			expect(payload.sessions[0]?.ownedBranches.join(",")).toBe(
				"agent/git-hygiene",
			);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("launches a dirty stale worktree without rewriting its work", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree, agentLog } = startManagedSession(fixture);
			writeFileSync(join(worktree, "unfinished.txt"), "keep me\n");
			advanceRemoteDefault(fixture);

			const result = runCli(worktree, ["git-hygiene", "launch"]);

			expect(result.status).toBe(0);
			expect(result.stderr).toContain("Launching agent/git-hygiene");
			expect(result.stderr).toContain("dirty");
			expect(result.stderr).toContain("latest origin/master");
			expect(readFileSync(join(worktree, "unfinished.txt"), "utf8")).toBe(
				"keep me\n",
			);
			expect(readFileSync(agentLog, "utf8").trim().split("\n").length).toBe(2);

			const resumed = runCli(worktree, ["git-hygiene", "resume"]);
			expect(resumed.status).toBe(0);
			expect(readFileSync(agentLog, "utf8").trim().split("\n").length).toBe(3);
			expect(readFileSync(`${agentLog}.args`, "utf8")).toBe("\n\n--continue\n");
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});
});

describe("agent-session finish", () => {
	it("refuses a stale finish preview receipt under the operation lock", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			const preview = runCli(fixture.checkout, [
				"git-hygiene",
				"finish",
				"--keep-branch",
				"--dry-run",
				"--json",
			]);
			expect(preview.status).toBe(0);
			const receipt = JSON.parse(preview.stdout).plan.receipt;
			expect(typeof receipt).toBe("string");
			const path = sessionMetadataPath(fixture.checkout, "git-hygiene");
			const metadata = JSON.parse(readFileSync(path, "utf8"));
			writeFileSync(
				path,
				JSON.stringify({ ...metadata, createdAt: "2099-01-01T00:00:00.000Z" }),
			);
			const result = runCli(fixture.checkout, [
				"git-hygiene",
				"finish",
				"--keep-branch",
				"--yes",
				"--expected",
				receipt,
			]);
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("Finish target changed");
			expect(existsSync(worktree)).toBe(true);
			expect(existsSync(path)).toBe(true);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});
	it("rejects malformed, forced or bulk guarded finish requests before cleanup", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			for (const args of [
				["git-hygiene", "--keep-branch", "--expected"],
				["git-hygiene", "--keep-branch", "--expected", "invalid"],
				["git-hygiene", "--expected", "a".repeat(64)],
				[
					"git-hygiene",
					"--keep-branch",
					"--force",
					"--expected",
					"a".repeat(64),
				],
				["--all", "--keep-branch", "--expected", "a".repeat(64)],
			]) {
				const invocation = args[0]?.startsWith("--")
					? ["finish", ...args, "--yes"]
					: [args[0] ?? "", "finish", ...args.slice(1), "--yes"];
				const result = runCli(fixture.checkout, invocation);
				expect(result.status).toBe(64);
				expect(existsSync(worktree)).toBe(true);
			}
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("rejects dirty session work without deleting anything", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			writeFileSync(join(worktree, "unfinished.txt"), "unfinished\n");

			const result = runCli(fixture.checkout, [
				"git-hygiene",
				"finish",
				"--yes",
			]);

			expect(result.status).toBe(1);
			expect(result.stderr).toContain("Working tree is not clean");
			expect(existsSync(worktree)).toBe(true);
			expect(
				existsSync(sessionMetadataPath(fixture.checkout, "git-hygiene")),
			).toBe(true);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("refuses to remove the worktree containing the invoking shell", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);

			const result = runCli(worktree, [
				"git-hygiene",
				"finish",
				"--force",
				"--yes",
			]);

			expect(result.status).toBe(1);
			expect(result.stderr).toContain(
				"Cannot remove the worktree containing the current shell",
			);
			expect(existsSync(worktree)).toBe(true);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("force-finishes dirty unpublished work only after confirmation", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			writeFileSync(join(worktree, "discard-me.txt"), "unfinished\n");

			const unconfirmed = runCli(fixture.checkout, [
				"git-hygiene",
				"finish",
				"--force",
			]);
			expect(unconfirmed.status).toBe(1);
			expect(unconfirmed.stderr).toContain("Confirmation required");
			expect(existsSync(worktree)).toBe(true);

			const forced = runCli(fixture.checkout, [
				"git-hygiene",
				"finish",
				"--force",
				"--yes",
			]);
			expect(forced.status).toBe(0);
			expect(forced.stdout).toContain("Session force-finished locally");
			expect(existsSync(worktree)).toBe(false);
			expect(
				existsSync(sessionMetadataPath(fixture.checkout, "git-hygiene")),
			).toBe(false);
			expect(
				git(fixture.checkout, "branch", "--list", "agent/git-hygiene"),
			).toBe("");
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("force-finishes an exactly targeted missing worktree registration", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			const { worktree: survivor } = startManagedSession(fixture, "survivor");
			rmSync(worktree, { recursive: true, force: true });
			rmSync(survivor, { recursive: true, force: true });

			const forced = runCli(fixture.checkout, [
				"git-hygiene",
				"finish",
				"--force",
				"--yes",
			]);

			expect(forced.status).toBe(0);
			expect(forced.stdout).toContain("Session force-finished locally");
			expect(
				existsSync(sessionMetadataPath(fixture.checkout, "git-hygiene")),
			).toBe(false);
			expect(
				git(fixture.checkout, "branch", "--list", "agent/git-hygiene"),
			).toBe("");
			expect(
				git(fixture.checkout, "worktree", "list", "--porcelain"),
			).toContain(survivor);
			expect(
				existsSync(sessionMetadataPath(fixture.checkout, "survivor")),
			).toBe(true);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("previews cleanup without fetching or removing local assets", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			advanceRemoteDefault(fixture);
			const trackedDefaultBefore = git(
				fixture.checkout,
				"rev-parse",
				"refs/remotes/origin/master",
			);

			const result = runCli(fixture.checkout, [
				"git-hygiene",
				"finish",
				"--dry-run",
				"--json",
			]);

			expect(result.status).toBe(0);
			const payload = JSON.parse(result.stdout) as {
				command: string;
				dryRun: boolean;
				plan: { slug: string; worktreePath: string; force: boolean };
			};
			expect(payload.command).toBe("finish");
			expect(payload.dryRun).toBe(true);
			expect(payload.plan.slug).toBe("git-hygiene");
			expect(payload.plan.worktreePath).toBe(worktree);
			expect(payload.plan.force).toBe(false);
			expect(result.stderr).toContain('"type":"progress"');
			expect(existsSync(worktree)).toBe(true);
			expect(
				existsSync(sessionMetadataPath(fixture.checkout, "git-hygiene")),
			).toBe(true);
			expect(
				git(fixture.checkout, "rev-parse", "refs/remotes/origin/master"),
			).toBe(trackedDefaultBefore);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("rejects unpublished work", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			commitSessionWork(worktree);

			const unpublished = runCli(fixture.checkout, [
				"git-hygiene",
				"finish",
				"--yes",
			]);
			expect(unpublished.status).toBe(1);
			expect(unpublished.stderr).toContain("Branch has no upstream");
			expect(existsSync(worktree)).toBe(true);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("removes a worktree while preserving its unpublished local branch", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			commitSessionWork(worktree);

			const result = runCli(fixture.checkout, [
				"git-hygiene",
				"finish",
				"--keep-branch",
				"--yes",
			]);

			expect(result.status).toBe(0);
			expect(result.stdout).toContain("Local branch preserved");
			expect(existsSync(worktree)).toBe(false);
			expect(
				git(fixture.checkout, "branch", "--list", "agent/git-hygiene"),
			).toContain("agent/git-hygiene");
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	describe("bulk cleanup", () => {
		let fixture: ReturnType<typeof createRepositoryFixture>;
		let first: string;
		let second: string;
		let dirty: string;
		// Fixture provisioning and cleanup commands each retain the default bound.
		beforeEach(() => {
			fixture = createRepositoryFixture();
		});
		beforeEach(() => {
			first = startManagedSession(fixture, "first").worktree;
		});
		beforeEach(() => {
			second = startManagedSession(fixture, "second").worktree;
		});
		beforeEach(() => {
			dirty = startManagedSession(fixture, "dirty").worktree;
			writeFileSync(join(dirty, "unfinished.txt"), "keep\n");
		});
		afterEach(() => {
			rmSync(fixture.root, { recursive: true, force: true });
		});

		it("previews bulk cleanup and protects the invoking worktree without mutation", () => {
			const preview = runCli(fixture.checkout, [
				"finish",
				"--all",
				"--dry-run",
				"--json",
			]);
			expect(preview.status).toBe(0);
			expect(
				(JSON.parse(preview.stdout) as { plans: unknown[] }).plans.length,
			).toBe(3);
			expect(existsSync(first)).toBe(true);
			expect(existsSync(second)).toBe(true);
			expect(existsSync(dirty)).toBe(true);

			const protectedPreview = runCli(first, ["finish", "--all", "--dry-run"]);
			expect(protectedPreview.status).toBe(0);
			expect(protectedPreview.stderr).toContain("SKIPPED inspect-finish:first");
			expect(protectedPreview.stderr.includes("FAILED")).toBe(false);
			expect(protectedPreview.stdout).toContain(
				"Cannot remove the worktree containing the current shell",
			);
		});

		it("finishes all safe sessions while skipping dirty work", () => {
			const result = runCli(fixture.checkout, ["finish", "--all", "--yes"]);

			expect(result.status).toBe(0);
			expect(result.stdout).toContain("Finished 2 session(s); skipped 1");
			expect(result.stderr).toContain("dirty: Working tree is not clean");
			expect(existsSync(first)).toBe(false);
			expect(existsSync(second)).toBe(false);
			expect(existsSync(dirty)).toBe(true);

			const forced = runCli(fixture.checkout, [
				"finish",
				"--all",
				"--force",
				"--yes",
			]);
			expect(forced.status).toBe(0);
			expect(forced.stdout).toContain("Finished 1 session(s); skipped 0");
			expect(existsSync(dirty)).toBe(false);
		});
	});

	it("finishes a merged session after its remote branch is deleted", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			commitSessionWork(worktree);
			git(worktree, "push", "-u", "origin", "HEAD");
			mergeSessionAndDeleteRemoteBranch(fixture);

			const result = runCli(fixture.checkout, [
				"git-hygiene",
				"finish",
				"--yes",
			]);

			expect(result.status).toBe(0);
			expect(result.stdout).toContain("Merged into: origin/master");
			expect(existsSync(worktree)).toBe(false);
			expect(
				existsSync(sessionMetadataPath(fixture.checkout, "git-hygiene")),
			).toBe(false);
			expect(
				git(fixture.checkout, "branch", "--list", "agent/git-hygiene"),
			).toBe("");
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	describe("gone-upstream cleanup", () => {
		let fixture: ReturnType<typeof createRepositoryFixture>;
		let worktree: string;
		let active: string;
		beforeAll(() => {
			fixture = createRepositoryFixture();
		});
		beforeAll(() => {
			worktree = startManagedSession(fixture).worktree;
			commitSessionWork(worktree);
			git(worktree, "push", "-u", "origin", "HEAD");
		});
		beforeAll(() => {
			active = startManagedSession(fixture, "active").worktree;
			commitSessionWork(active);
			git(active, "push", "-u", "origin", "HEAD");
		});
		beforeAll(() => {
			mergeSessionAndDeleteRemoteBranch(fixture);
		});
		afterAll(() => {
			rmSync(fixture.root, { recursive: true, force: true });
		});

		it("finishes all sessions whose upstream branches are gone", () => {
			const result = runCli(fixture.checkout, ["finish", "--gone", "--yes"]);

			expect(result.status).toBe(0);
			expect(result.stdout).toContain("Finished 1 session(s); skipped 0");
			expect(existsSync(worktree)).toBe(false);
			expect(existsSync(active)).toBe(true);
		});
	});

	it("finishes a pushed branch without requiring the latest default", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			commitSessionWork(worktree);
			git(worktree, "push", "-u", "origin", "HEAD");
			advanceRemoteDefault(fixture);

			const result = runCli(fixture.checkout, [
				"git-hygiene",
				"finish",
				"--yes",
			]);

			expect(result.status).toBe(0);
			expect(result.stdout).toContain(
				"Remote branch preserved: origin/agent/git-hygiene",
			);
			expect(existsSync(worktree)).toBe(false);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("removes every published branch created in the managed worktree", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			commitSessionWork(worktree);
			git(worktree, "branch", "-m", "feat/first-slice");
			git(worktree, "push", "-u", "origin", "HEAD");

			git(worktree, "switch", "-c", "fix/second-slice", "origin/master");
			commitSessionWork(worktree);
			git(worktree, "push", "-u", "origin", "HEAD");

			const preview = runCli(fixture.checkout, [
				"git-hygiene",
				"finish",
				"--dry-run",
				"--json",
			]);
			expect(preview.status).toBe(0);
			const previewPayload = JSON.parse(preview.stdout) as {
				plan: { currentBranch: string; ownedBranches: string[] };
			};
			expect(previewPayload.plan.currentBranch).toBe("fix/second-slice");
			expect(previewPayload.plan.ownedBranches.join(",")).toBe(
				"feat/first-slice,fix/second-slice",
			);

			const result = runCli(fixture.checkout, [
				"git-hygiene",
				"finish",
				"--yes",
			]);

			expect(result.status).toBe(0);
			expect(result.stdout).toContain("Session finished locally");
			expect(result.stdout).toContain("2 local branches deleted");
			expect(existsSync(worktree)).toBe(false);
			expect(
				git(fixture.checkout, "branch", "--list", "feat/first-slice"),
			).toBe("");
			expect(
				git(fixture.checkout, "branch", "--list", "fix/second-slice"),
			).toBe("");
			expect(
				git(
					fixture.checkout,
					"branch",
					"--remotes",
					"--list",
					"origin/feat/first-slice",
				),
			).toContain("origin/feat/first-slice");
			expect(
				git(
					fixture.checkout,
					"branch",
					"--remotes",
					"--list",
					"origin/fix/second-slice",
				),
			).toContain("origin/fix/second-slice");
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	describe("pre-existing branch ownership", () => {
		let fixture: ReturnType<typeof createRepositoryFixture>;
		beforeAll(() => {
			fixture = createRepositoryFixture();
		});
		beforeAll(() => {
			git(fixture.checkout, "branch", "feat/pre-existing");
			const { worktree } = startManagedSession(fixture);
			commitSessionWork(worktree);
			git(worktree, "push", "-u", "origin", "HEAD");
			git(worktree, "switch", "feat/pre-existing");
			git(worktree, "switch", "agent/git-hygiene");
		});
		afterAll(() => {
			rmSync(fixture.root, { recursive: true, force: true });
		});

		it("preserves a pre-existing branch that was only checked out in the worktree", () => {
			const result = runCli(fixture.checkout, [
				"git-hygiene",
				"finish",
				"--yes",
			]);

			expect(result.status).toBe(0);
			expect(
				git(fixture.checkout, "branch", "--list", "agent/git-hygiene"),
			).toBe("");
			expect(
				git(fixture.checkout, "branch", "--list", "feat/pre-existing"),
			).toContain("feat/pre-existing");
		});
	});

	describe("unpublished branch ownership", () => {
		let fixture: ReturnType<typeof createRepositoryFixture>;
		let worktree: string;
		beforeAll(() => {
			fixture = createRepositoryFixture();
		});
		beforeAll(() => {
			worktree = startManagedSession(fixture).worktree;
			commitSessionWork(worktree);
			git(worktree, "push", "-u", "origin", "HEAD");
			git(worktree, "switch", "-c", "fix/unpublished", "origin/master");
			commitSessionWork(worktree);
		});
		afterAll(() => {
			rmSync(fixture.root, { recursive: true, force: true });
		});

		it("rejects cleanup when any session-created branch has unpublished work", () => {
			const result = runCli(fixture.checkout, [
				"git-hygiene",
				"finish",
				"--yes",
			]);

			expect(result.status).toBe(1);
			expect(result.stderr).toContain("fix/unpublished");
			expect(result.stderr).toContain("has unpushed commits");
			expect(existsSync(worktree)).toBe(true);
			expect(
				git(fixture.checkout, "branch", "--list", "agent/git-hygiene"),
			).toContain("agent/git-hygiene");
			expect(
				git(fixture.checkout, "branch", "--list", "fix/unpublished"),
			).toContain("fix/unpublished");
		});
	});

	describe("forced branch ownership cleanup", () => {
		let fixture: ReturnType<typeof createRepositoryFixture>;
		let worktree: string;
		beforeAll(() => {
			fixture = createRepositoryFixture();
		});
		beforeAll(() => {
			worktree = startManagedSession(fixture).worktree;
			commitSessionWork(worktree);
			git(worktree, "branch", "-m", "feat/unpublished-first");
			git(worktree, "switch", "-c", "fix/unpublished-second", "origin/master");
			commitSessionWork(worktree);
		});
		afterAll(() => {
			rmSync(fixture.root, { recursive: true, force: true });
		});

		it("force-removes every session-created branch with unpublished work", () => {
			const result = runCli(fixture.checkout, [
				"git-hygiene",
				"finish",
				"--force",
				"--yes",
			]);

			expect(result.status).toBe(0);
			expect(result.stdout).toContain("2 local branches deleted");
			expect(existsSync(worktree)).toBe(false);
			expect(
				git(fixture.checkout, "branch", "--list", "feat/unpublished-first"),
			).toBe("");
			expect(
				git(fixture.checkout, "branch", "--list", "fix/unpublished-second"),
			).toBe("");
		});
	});

	it("keep-branch preserves every session-created branch", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			git(worktree, "branch", "-m", "feat/preserved-first");
			git(worktree, "switch", "-c", "fix/preserved-second", "origin/master");

			const result = runCli(fixture.checkout, [
				"git-hygiene",
				"finish",
				"--keep-branch",
				"--yes",
			]);

			expect(result.status).toBe(0);
			expect(result.stdout).toContain(
				"Local branches preserved: feat/preserved-first, fix/preserved-second",
			);
			expect(existsSync(worktree)).toBe(false);
			expect(
				git(fixture.checkout, "branch", "--list", "feat/preserved-first"),
			).toContain("feat/preserved-first");
			expect(
				git(fixture.checkout, "branch", "--list", "fix/preserved-second"),
			).toContain("fix/preserved-second");
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("removes only local assets for handoff-ready work", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			commitSessionWork(worktree);
			git(worktree, "push", "-u", "origin", "HEAD");

			const unconfirmed = runCli(fixture.checkout, ["git-hygiene", "finish"]);
			expect(unconfirmed.status).toBe(1);
			expect(unconfirmed.stderr).toContain("Confirmation required");
			expect(existsSync(worktree)).toBe(true);

			const result = runCli(fixture.checkout, [
				"git-hygiene",
				"finish",
				"--yes",
			]);

			expect(result.status).toBe(0);
			expect(result.stdout).toContain("Session finished locally");
			expect(existsSync(worktree)).toBe(false);
			expect(
				existsSync(sessionMetadataPath(fixture.checkout, "git-hygiene")),
			).toBe(false);
			expect(
				git(fixture.checkout, "branch", "--list", "agent/git-hygiene"),
			).toBe("");
			expect(
				git(
					fixture.checkout,
					"branch",
					"--remotes",
					"--list",
					"origin/agent/git-hygiene",
				),
			).toContain("origin/agent/git-hygiene");
			expect(existsSync(resolve("scripts/agent-finish"))).toBe(false);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});
});

describe("agent-session diagnostics and completions", () => {
	it("suggests corrections for unknown commands and options", () => {
		const unknownCommand = runCli(resolve("."), ["example", "finnish"]);
		expect(unknownCommand.status).toBe(64);
		expect(unknownCommand.stderr).toContain(
			"Unknown command 'finnish'. Did you mean 'finish'?",
		);

		const unknownOption = runCli(resolve("."), [
			"example",
			"finish",
			"--froce",
		]);
		expect(unknownOption.status).toBe(64);
		expect(unknownOption.stderr).toContain(
			"Unknown option '--froce' for 'finish'. Did you mean '--force'?",
		);
	});

	it("explains missing and conflicting finish selectors", () => {
		const missingSlug = runCli(resolve("."), ["create"]);
		expect(missingSlug.status).toBe(64);
		expect(missingSlug.stderr).toContain("Missing <task-slug> for 'create'.");

		const conflicting = runCli(resolve("."), ["example", "finish", "--all"]);
		expect(conflicting.status).toBe(64);
		expect(conflicting.stderr).toContain(
			"Choose exactly one finish selector: <task-slug>, --all, or --gone.",
		);
	});

	it("completes a Zsh command on the first Tab invocation", () => {
		const completion = runCli(resolve("."), ["completion", "zsh"]);
		expect(completion.status).toBe(0);
		const completionDirectory = mkdtempSync(
			join(tmpdir(), "agent-session-zsh-completion-"),
		);
		try {
			writeFileSync(
				join(completionDirectory, "_agent_session"),
				completion.stdout,
			);
			const invocation = spawnSync(
				"zsh",
				[
					"-f",
					"-c",
					`fpath=("$COMPLETION_DIR" $fpath)
autoload -Uz compinit
compinit -D -i
_describe() { print -r -- "$1"; }
words=(agent-session "")
CURRENT=2
"\${_comps[agent-session]}"`,
				],
				{
					encoding: "utf8",
					env: { ...process.env, COMPLETION_DIR: completionDirectory },
				},
			);

			expect(invocation.status).toBe(0);
			expect(invocation.stdout).toBe("session or command\n");
		} finally {
			rmSync(completionDirectory, { recursive: true, force: true });
		}
	});

	it("exposes as as the same CLI with shell completions", () => {
		const alias = spawnSync("as", ["completion", "zsh"], {
			encoding: "utf8",
		});
		expect(alias.status).toBe(0);
		expect(alias.stdout).toContain("#compdef agent-session as");
		const direct = spawnSync("agent-session", [], { encoding: "utf8" });
		const short = spawnSync("as", [], { encoding: "utf8" });
		expect(short.status).toBe(direct.status);
		expect(short.stdout).toBe(direct.stdout);
		const candidates = spawnSync("as", ["__complete", "finish"], {
			encoding: "utf8",
		});
		expect(candidates.status).toBe(0);
		const zsh = spawnSync(
			"zsh",
			[
				"-f",
				"-c",
				`fpath=("$AGENT_SESSION_COMPLETION_ROOT/zsh/site-functions" $fpath)
	autoload -Uz compinit
	compinit -D -i
	[[ \${_comps[as]} == _agent_session && \${_comps[agent-session]} == _agent_session ]]`,
			],
			{
				encoding: "utf8",
			},
		);
		expect(zsh.status).toBe(0);
	});

	it("loads installed Bash and Fish completions for both command names", () => {
		const bash = spawnSync("bash", ["--noprofile", "--norc", "-c", `
source "$AGENT_SESSION_COMPLETION_ROOT/bash-completion/completions/as"
complete -p agent-session as
COMP_WORDS=(as stat); COMP_CWORD=1; _agent_session
[[ " \${COMPREPLY[*]} " == *" status "* ]]
`], { encoding: "utf8" });
		expect(bash.status).toBe(0);
		const fish = spawnSync("fish", ["--no-config", "-c", `
source "$AGENT_SESSION_COMPLETION_ROOT/fish/vendor_completions.d/agent-session.fish"
source "$AGENT_SESSION_COMPLETION_ROOT/fish/vendor_completions.d/as.fish"
complete -C 'as stat'
complete -C 'agent-session stat'
`], { encoding: "utf8" });
		expect(fish.status).toBe(0);
		expect(fish.stdout).toContain("status");
	});

	it("generates Bash, Zsh, and Fish completion scripts", () => {
		const bash = runCli(resolve("."), ["completion", "bash"]);
		expect(bash.status).toBe(0);
		expect(bash.stdout).toContain(
			"complete -F _agent_session agent-session as",
		);

		const zsh = runCli(resolve("."), ["completion", "zsh"]);
		expect(zsh.status).toBe(0);
		expect(zsh.stdout).toContain("#compdef agent-session as");

		const fish = runCli(resolve("."), ["completion", "fish"]);
		expect(fish.status).toBe(0);
		expect(fish.stdout).toContain("complete -c agent-session");

		const fixture = createRepositoryFixture();
		try {
			startManagedSession(fixture);
			const candidates = runCli(fixture.checkout, ["__complete", "finish"]);
			expect(candidates.status).toBe(0);
			expect(candidates.stdout).toContain("git-hygiene");
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});
});

describe("agent-session hardening", () => {
	it("rejects a dirty primary checkout before creating Git state", () => {
		const fixture = createRepositoryFixture();
		try {
			const fakeAgent = createFakeAgent(
				fixture.root,
				join(fixture.root, "agent-cwd"),
			);
			writeConfig(fixture.checkout, fakeAgent);
			writeFileSync(join(fixture.checkout, "user-work.txt"), "do not touch\n");

			const result = runCli(fixture.checkout, ["dirty-primary", "start"]);

			expect(result.status).toBe(1);
			expect(result.stderr).toContain("Primary checkout must be clean");
			expect(
				git(fixture.checkout, "branch", "--list", "agent/dirty-primary"),
			).toBe("");
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("rolls back assets when worktree preparation fails", () => {
		const fixture = createRepositoryFixture();
		try {
			const fakeAgent = createFakeAgent(
				fixture.root,
				join(fixture.root, "agent-cwd"),
			);
			writeConfig(fixture.checkout, fakeAgent, ["false"]);

			const result = runCli(fixture.checkout, ["setup-failure", "start"]);
			const worktree = join(fixture.worktrees, "setup-failure");

			expect(result.status).toBe(1);
			expect(result.stderr).toContain("Worktree preparation failed");
			expect(existsSync(worktree)).toBe(false);
			expect(
				git(fixture.checkout, "branch", "--list", "agent/setup-failure"),
			).toBe("");
			expect(
				existsSync(sessionMetadataPath(fixture.checkout, "setup-failure")),
			).toBe(false);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("keeps a managed session when the configured agent fails to launch", () => {
		const fixture = createRepositoryFixture();
		try {
			const failingAgent = join(fixture.root, "failing-agent");
			writeFileSync(failingAgent, "#!/usr/bin/env bash\nexit 23\n");
			chmodSync(failingAgent, 0o755);
			writeConfig(fixture.checkout, failingAgent);

			const started = runCli(fixture.checkout, ["agent-failure", "start"]);
			expect(started.status).toBe(23);
			expect(started.stderr).toContain("remains available to resume");
			expect(
				existsSync(sessionMetadataPath(fixture.checkout, "agent-failure")),
			).toBe(true);

			const status = runCli(fixture.checkout, [
				"agent-failure",
				"status",
				"--json",
			]);
			expect(status.status).toBe(0);
			expect(status.stdout).toContain('"slug":"agent-failure"');
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("refuses unmanaged branch collisions", () => {
		const fixture = createRepositoryFixture();
		try {
			const fakeAgent = createFakeAgent(
				fixture.root,
				join(fixture.root, "agent-cwd"),
			);
			writeConfig(fixture.checkout, fakeAgent);
			git(fixture.checkout, "branch", "agent/collision");

			const result = runCli(fixture.checkout, ["collision", "start"]);

			expect(result.status).toBe(1);
			expect(result.stderr).toContain("Refusing to modify unmanaged assets");
			expect(existsSync(join(fixture.worktrees, "collision"))).toBe(false);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("reports unsafe metadata as broken and refuses cleanup", () => {
		const fixture = createRepositoryFixture();
		try {
			startManagedSession(fixture);
			const metadataPath = sessionMetadataPath(fixture.checkout, "git-hygiene");
			const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as {
				branch: string;
				worktreePath: string;
			};
			metadata.branch = "master";
			metadata.worktreePath = realpathSync(fixture.checkout);
			writeFileSync(metadataPath, `${JSON.stringify(metadata)}\n`);

			const status = runCli(fixture.checkout, ["status", "--json"]);
			expect(status.status).toBe(0);
			expect(status.stdout).toContain('"state":"broken"');

			const finish = runCli(fixture.checkout, [
				"git-hygiene",
				"finish",
				"--yes",
			]);
			expect(finish.status).toBe(1);
			expect(finish.stderr).toContain("Unsafe session metadata");

			const forced = runCli(fixture.checkout, [
				"git-hygiene",
				"finish",
				"--force",
				"--yes",
			]);
			expect(forced.status).toBe(1);
			expect(forced.stderr).toContain("Unsafe session metadata");
			expect(existsSync(fixture.checkout)).toBe(true);
			expect(git(fixture.checkout, "branch", "--show-current")).toBe("master");
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("reports an active lifecycle operation and blocks a competing start", () => {
		const fixture = createRepositoryFixture();
		try {
			const fakeAgent = createFakeAgent(
				fixture.root,
				join(fixture.root, "agent-cwd"),
			);
			writeConfig(fixture.checkout, fakeAgent);
			const lockDirectory = join(
				fixture.checkout,
				".git",
				"agent-session",
				"operation.lock",
			);
			mkdirSync(lockDirectory, { recursive: true });
			writeFileSync(
				join(lockDirectory, "owner.json"),
				`${JSON.stringify({ pid: process.pid, command: "resume", createdAt: new Date().toISOString() })}\n`,
			);

			const status = runCli(fixture.checkout, ["status", "--json"]);
			expect(status.status).toBe(0);
			expect(status.stdout).toContain('"command":"resume"');

			const started = runCli(fixture.checkout, ["collision", "start"]);
			expect(started.status).toBe(1);
			expect(started.stderr).toContain(
				"Another agent-session operation is active",
			);
			expect(git(fixture.checkout, "branch", "--list", "agent/collision")).toBe(
				"",
			);

			writeFileSync(
				join(lockDirectory, "owner.json"),
				`${JSON.stringify({ pid: 2_147_483_647, command: "stale", createdAt: new Date(0).toISOString() })}\n`,
			);
			const recovered = runCli(fixture.checkout, ["recovered", "start"]);
			expect(recovered.status).toBe(0);
			expect(existsSync(lockDirectory)).toBe(false);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});
});
