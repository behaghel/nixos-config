declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void, timeout?: number) => void;
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

import { spawn, spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	lstatSync,
	readdirSync,
	readlinkSync,
	symlinkSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
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
	localLinks: string[] = [],
	disposablePaths: string[] = [],
	generatedLinks: Record<string, string> = {},
): void {
	writeFileSync(
		runtimeConfigPath(checkout),
		`${JSON.stringify({
			version: 1,
			worktree_root: worktreeRoot,
			agent_command: [agent],
			prepare_command: prepareCommand,
			local_links: localLinks,
			disposable_paths: disposablePaths,
			generated_links: generatedLinks,
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

describe("cheap inventory and exact resource inspection", () => {
	it("lists metadata and inspects only the requested checkout", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture, "selected");
			expect(runCli(fixture.checkout, ["unrelated", "create"]).status).toBe(0);
			const bin = join(fixture.root, "guard-bin");
			mkdirSync(bin);
			const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
			const calls = join(fixture.root, "git-calls");
			writeFileSync(join(bin, "git"), `#!/bin/sh\nprintf '%s %s\\n' "$PWD" "$*" >> ${tomlString(calls)}\ncase "$PWD" in */unrelated) echo 'unrelated inspection blocked' >&2; exit 97;; esac\nexec ${tomlString(realGit)} "$@"\n`);
			chmodSync(join(bin, "git"), 0o755);
			const env = { PATH: `${bin}:${process.env.PATH}` };
			const inventory = runCli(fixture.checkout, ["list", "--json"], env);
			expect(inventory.status).toBe(0);
			expect(JSON.parse(inventory.stdout).sessions.length).toBe(2);
			expect(readFileSync(calls, "utf8").includes("status --porcelain")).toBe(false);
			const exact = runCli(fixture.checkout, ["status", "--worktree", worktree, "--json"], env);
			expect(exact.status).toBe(0);
			const result = JSON.parse(exact.stdout);
			expect(result.resourceState).toBe("present");
			expect(result.sessions.length).toBe(1);
			expect(result.sessions[0].slug).toBe("selected");
			expect(readFileSync(calls, "utf8").includes(`${fixture.worktrees}/unrelated `)).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("distinguishes stale registration and metadata from confirmed absence without repair", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture, "missing");
			const metadata = sessionMetadataPath(fixture.checkout, "missing");
			const saved = readFileSync(metadata, "utf8");
			writeFileSync(metadata, "{malformed");
			const malformed = runCli(fixture.checkout, ["status", "--worktree", worktree, "--json"]);
			expect(malformed.status).toBe(0);
			expect(JSON.parse(malformed.stdout).resourceState).toBe("unknown");
			const inventory = runCli(fixture.checkout, ["list", "--json"]);
			expect(inventory.status).toBe(1);
			expect(inventory.stdout).toBe("");
			writeFileSync(metadata, saved);
			rmSync(worktree, { recursive: true });
			const inspect = () => runCli(fixture.checkout, ["status", "--worktree", worktree, "--json"]);
			const stale = inspect();
			expect(stale.status).toBe(0);
			expect(JSON.parse(stale.stdout).resourceState).toBe("inconsistent");
			expect(JSON.parse(stale.stdout).evidence.registered).toBe(true);
			expect(readFileSync(metadata, "utf8")).toBe(saved);
			git(fixture.checkout, "worktree", "prune");
			expect(JSON.parse(inspect().stdout).resourceState).toBe("inconsistent");
			rmSync(metadata);
			const absent = inspect();
			expect(absent.status).toBe(0);
			expect(JSON.parse(absent.stdout).resourceState).toBe("absent");
			expect(git(fixture.checkout, "branch", "--list", "agent/missing")).toContain("agent/missing");
			symlinkSync(join(fixture.root, "nonexistent"), metadata);
			expect(JSON.parse(inspect().stdout).resourceState).toBe("unknown");
			expect(lstatSync(metadata).isSymbolicLink()).toBe(true);
			rmSync(metadata);
			symlinkSync(join(fixture.root, "nonexistent"), worktree);
			expect(JSON.parse(inspect().stdout).resourceState).toBe("unknown");
			expect(lstatSync(worktree).isSymbolicLink()).toBe(true);
			const outside = runCli(fixture.checkout, ["status", "--worktree", fixture.seed, "--json"]);
			expect(JSON.parse(outside.stdout).resourceState).toBe("unknown");
			for (const args of [
				["status", "--worktree"],
				["status", "--worktree", worktree, "--refresh"],
				["missing", "status", "--worktree", worktree],
				["list", "--refresh"],
			]) expect(runCli(fixture.checkout, args).status).toBe(64);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});
});

function backdateSession(fixture: ReturnType<typeof createRepositoryFixture>, slug: string): void {
	const old = new Date("2000-01-01T00:00:00Z");
	const path = sessionMetadataPath(fixture.checkout, slug);
	const metadata = JSON.parse(readFileSync(path, "utf8"));
	metadata.createdAt = old.toISOString();
	metadata.lastWorkAt = old.toISOString();
	writeFileSync(path, JSON.stringify(metadata));
	const worktree = join(realpathSync(fixture.worktrees), slug);
	for (const log of [git(worktree, "rev-parse", "--git-path", "logs/HEAD"), join(fixture.checkout, ".git", "logs", "refs", "heads", "agent", slug)]) {
		writeFileSync(log, readFileSync(log, "utf8").replace(/ \d+ [+-]\d{4}(?=\t|\n|$)/g, " 946684800 +0000"));
	}
	for (const file of git(worktree, "ls-files").split("\n")) utimesSync(join(worktree, file), old, old);
}

function createLocalLinkFixture() {
	const fixture = createRepositoryFixture("agent-local-link-");
	const links = [".envrc.local", ".workon-assistant", "devenv.local.nix", "devenv.local.yaml"];
	writeFileSync(join(fixture.seed, ".gitignore"), `.worktrees/\n.cache/\n.nested\n.pre-commit-config.yaml\n${links.join("\n")}\n`);
	git(fixture.seed, "add", ".gitignore");
	git(fixture.seed, "-c", "commit.gpgsign=false", "commit", "-m", "Ignore local settings");
	git(fixture.seed, "push", "origin", "master");
	git(fixture.checkout, "pull", "--ff-only");
	for (const link of links) writeFileSync(join(fixture.checkout, link), `preserve ${link}\n`);
	const agent = createFakeAgent(fixture.root, join(fixture.root, "agent-log"));
	writeConfig(fixture.checkout, agent, [], ".worktrees", links);
	return { ...fixture, links, agent };
}

function createDevenvDefaultsFixture() {
	const fixture = createLocalLinkFixture();
	const defaults = JSON.parse(readFileSync(process.env.AGENT_SESSION_CONFIG!, "utf8"));
	const hookTarget = defaults.generated_links?.[".pre-commit-config.yaml"] ?? process.env.GENERATED_HOOK_TEST_TARGET ?? readlinkSync(resolve(".pre-commit-config.yaml"));
	writeFileSync(join(fixture.seed, ".gitignore"), readFileSync(join(fixture.seed, ".gitignore"), "utf8") + "\n.devenv/\n.pi/npm/\n");
	git(fixture.seed, "add", ".gitignore");
	git(fixture.seed, "-c", "commit.gpgsign=false", "commit", "-m", "Ignore generated integration state");
	git(fixture.seed, "push", "origin", "master"); git(fixture.checkout, "pull", "--ff-only");
	writeConfig(fixture.checkout, fixture.agent, [], ".worktrees", fixture.links, defaults.disposable_paths, defaults.generated_links);
	return { ...fixture, defaults, hookTarget };
}

function prepareDefaultArtifacts(fixture: ReturnType<typeof createDevenvDefaultsFixture>, slug: string) {
	const created = runCli(fixture.checkout, [slug, "create"]);
	if (created.status !== 0) throw new Error(created.stderr);
	backdateSession(fixture, slug);
	const worktree = join(fixture.worktrees, slug);
	mkdirSync(join(worktree, ".devenv"));
	writeFileSync(join(worktree, ".devenv", "tasks.sqlite"), "task database approved as scratch state\n");
	writeFileSync(join(worktree, ".devenv", "diagnostics.log"), "default whole-subtree authority\n");
	symlinkSync(fixture.hookTarget, join(worktree, ".pre-commit-config.yaml"));
	return worktree;
}

describe("devenv retirement defaults", () => {
	it("retires default scratch state and the verified generated hook through both guarded paths", () => {
		const fixture = createDevenvDefaultsFixture();
		try {
			expect(fixture.defaults.disposable_paths.includes(".devenv")).toBe(true);
			expect(fixture.defaults.generated_links[".pre-commit-config.yaml"]).toBe(fixture.hookTarget);
			const targetBefore = lstatSync(fixture.hookTarget).ino;
			for (const slug of ["default-single", "default-batch"]) prepareDefaultArtifacts(fixture, slug);
			const single = JSON.parse(runCli(fixture.checkout, ["default-single", "finish", "--keep-branch", "--dry-run", "--json"]).stdout).plan;
			expect(single.ignoredData.safe).toBe(true);
			expect(single.ignoredData.generatedLinks[0].state).toBe("verified");
			expect(single.ignoredData.approvedArtifacts.includes(".devenv")).toBe(true);
			expect(single.ignoredData.ignoredPaths.find((entry: { path: string }) => entry.path === ".pre-commit-config.yaml").classification).toBe("generated-link");
			const args = ["batch", "finish", "--inactive-for", "7d", "--exclude", "default-single"];
			const batch = JSON.parse(runCli(fixture.checkout, [...args, "--dry-run", "--json"]).stdout);
			expect(batch.resources.find((resource: { slug: string }) => resource.slug === "default-batch").reason).toBe("eligible");
			expect(runCli(fixture.checkout, ["default-single", "finish", "--keep-branch", "--expected", single.receipt, "--yes"]).status).toBe(0);
			expect(runCli(fixture.checkout, [...args, "--expected", batch.receipt, "--yes", "--json"]).status).toBe(0);
			for (const slug of ["default-single", "default-batch"]) {
				expect(existsSync(join(fixture.worktrees, slug))).toBe(false);
				expect(git(fixture.checkout, "branch", "--list", `agent/${slug}`)).toContain(`agent/${slug}`);
			}
			expect(lstatSync(fixture.hookTarget).ino).toBe(targetBefore);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	}, 120000);

	for (const replacement of ["regular-file", "unrelated-store-link"]) {
		it(`refuses a ${replacement} hook replacement even in a fresh preview`, () => {
			const fixture = createDevenvDefaultsFixture();
			try {
				const worktree = prepareDefaultArtifacts(fixture, "replacement");
				const args = ["replacement", "finish", "--keep-branch"];
				const inspect = () => JSON.parse(runCli(fixture.checkout, [...args, "--dry-run", "--json"]).stdout).plan;
				const initial = inspect(); expect(initial.ignoredData.safe).toBe(true);
				const hook = join(worktree, ".pre-commit-config.yaml"); rmSync(hook);
				if (replacement === "regular-file") writeFileSync(hook, "retain handwritten hook configuration\n");
				else symlinkSync("/nix/store/00000000000000000000000000000000-unrelated-config", hook);
				const changed = inspect();
				expect(changed.ignoredData.safe).toBe(false);
				expect(changed.ignoredData.generatedLinks[0].state).toBe("mismatch");
				expect(runCli(fixture.checkout, [...args, "--expected", initial.receipt, "--yes"]).status).toBe(1);
				const batch = JSON.parse(runCli(fixture.checkout, ["batch", "finish", "--inactive-for", "7d", "--dry-run", "--json"]).stdout);
				expect(batch.resources[0].reason).toBe("ignored-local-data");
				if (replacement === "regular-file") expect(readFileSync(hook, "utf8")).toBe("retain handwritten hook configuration\n");
				else expect(readlinkSync(hook)).toContain("unrelated-config");
			} finally { rmSync(fixture.root, { recursive: true, force: true }); }
		}, 60000);
	}

	it("leaves Pi installation state outside the defaults", () => {
		const fixture = createDevenvDefaultsFixture();
		try {
			const worktree = prepareDefaultArtifacts(fixture, "pi-retained");
			const args = ["pi-retained", "finish", "--keep-branch"];
			const initial = JSON.parse(runCli(fixture.checkout, [...args, "--dry-run", "--json"]).stdout).plan;
			expect(initial.ignoredData.safe).toBe(true);
			mkdirSync(join(worktree, ".pi", "npm"), { recursive: true });
			const data = join(worktree, ".pi", "npm", "package.json"); writeFileSync(data, "retain project-specific packages\n");
			const changed = JSON.parse(runCli(fixture.checkout, [...args, "--dry-run", "--json"]).stdout).plan;
			expect(changed.ignoredData.safe).toBe(false);
			expect(changed.ignoredData.unapprovedPaths.some((path: string) => path === ".pi" || path.startsWith(".pi/"))).toBe(true);
			expect(runCli(fixture.checkout, [...args, "--expected", initial.receipt, "--yes"]).status).toBe(1);
			expect(readFileSync(data, "utf8")).toBe("retain project-specific packages\n");
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("honours explicit retention of both default scopes", () => {
		const fixture = createDevenvDefaultsFixture();
		try {
			const worktree = prepareDefaultArtifacts(fixture, "retain-defaults");
			const args = ["retain-defaults", "finish", "--keep-branch"];
			const initial = JSON.parse(runCli(fixture.checkout, [...args, "--dry-run", "--json"]).stdout).plan;
			expect(initial.ignoredData.safe).toBe(true);
			writeConfig(fixture.checkout, fixture.agent, [], ".worktrees", fixture.links, [], {});
			const retained = JSON.parse(runCli(fixture.checkout, [...args, "--dry-run", "--json"]).stdout).plan;
			expect(retained.ignoredData.safe).toBe(false);
			expect(retained.ignoredData.unapprovedPaths.includes(".devenv")).toBe(true);
			expect(retained.ignoredData.unapprovedPaths.includes(".pre-commit-config.yaml")).toBe(true);
			expect(runCli(fixture.checkout, [...args, "--expected", initial.receipt, "--yes"]).status).toBe(1);
			expect(existsSync(join(worktree, ".devenv", "diagnostics.log"))).toBe(true);
			expect(readlinkSync(join(worktree, ".pre-commit-config.yaml"))).toBe(fixture.hookTarget);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("rejects malformed generated-link declarations before creating resources", () => {
		const fixture = createDevenvDefaultsFixture();
		try {
			const path = runtimeConfigPath(fixture.checkout), original = JSON.parse(readFileSync(path, "utf8"));
			for (const generated of [null, [], "not-a-map", { ".git": fixture.hookTarget }, { ".pre-commit-config.yaml": "relative-target" }, { "../escape": fixture.hookTarget }]) {
				writeFileSync(path, JSON.stringify({ ...original, generated_links: generated }));
				expect(runCli(fixture.checkout, ["invalid-generated", "create"]).status === 0).toBe(false);
			}
			expect(existsSync(join(fixture.worktrees, "invalid-generated"))).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	for (const mode of ["single", "batch"]) {
		it(`binds the generated hook target into ${mode} approval`, () => {
			const fixture = createDevenvDefaultsFixture();
			try {
				const worktree = prepareDefaultArtifacts(fixture, "new-generator");
				const args = mode === "single" ? ["new-generator", "finish", "--keep-branch"] : ["batch", "finish", "--inactive-for", "7d"];
				const inspect = () => JSON.parse(runCli(fixture.checkout, [...args, "--dry-run", "--json"]).stdout);
				const before = inspect(), receipt = mode === "single" ? before.plan.receipt : before.receipt;
				expect((mode === "single" ? before.plan : before.resources[0]).ignoredData.safe).toBe(true);
				const target = "/nix/store/00000000000000000000000000000000-new-project-hook-config";
				writeConfig(fixture.checkout, fixture.agent, [], ".worktrees", fixture.links, fixture.defaults.disposable_paths, { ".pre-commit-config.yaml": target });
				const hook = join(worktree, ".pre-commit-config.yaml"); rmSync(hook); symlinkSync(target, hook);
				const after = inspect(); expect((mode === "single" ? after.plan : after.resources[0]).ignoredData.safe).toBe(true);
				expect(runCli(fixture.checkout, [...args, "--expected", receipt, "--yes", ...(mode === "batch" ? ["--json"] : [])]).status === 0).toBe(false);
				expect(readlinkSync(hook)).toBe(target);
			} finally { rmSync(fixture.root, { recursive: true, force: true }); }
		}, 60000);

		it(`invalidates ${mode} approval when default scratch metadata changes`, () => {
			const fixture = createDevenvDefaultsFixture();
			try {
				const worktree = prepareDefaultArtifacts(fixture, "changed-default");
				const args = mode === "single" ? ["changed-default", "finish", "--keep-branch"] : ["batch", "finish", "--inactive-for", "7d"];
				const result = JSON.parse(runCli(fixture.checkout, [...args, "--dry-run", "--json"]).stdout);
				const inspection = mode === "single" ? result.plan.ignoredData : result.resources[0].ignoredData;
				expect(inspection.safe).toBe(true);
				const receipt = mode === "single" ? result.plan.receipt : result.receipt;
				const database = join(worktree, ".devenv", "tasks.sqlite"), before = lstatSync(database).mtime;
				writeFileSync(database, "changed while retaining the old mtime\n"); utimesSync(database, before, before);
				expect(runCli(fixture.checkout, [...args, "--expected", receipt, "--yes", ...(mode === "batch" ? ["--json"] : [])]).status).toBe(1);
				expect(readFileSync(database, "utf8")).toBe("changed while retaining the old mtime\n");
			} finally { rmSync(fixture.root, { recursive: true, force: true }); }
		}, 60000);
	}
});

describe("verified local-link retirement", () => {
	it("retires clean linked worktrees through both guarded paths without touching targets", () => {
		const fixture = createLocalLinkFixture();
		try {
			for (const slug of ["single", "batched"]) {
				expect(runCli(fixture.checkout, [slug, "create"]).status).toBe(0);
				backdateSession(fixture, slug);
			}
			const single = runCli(fixture.checkout, ["single", "finish", "--keep-branch", "--dry-run", "--json"]);
			expect(single.status).toBe(0);
			const plan = JSON.parse(single.stdout).plan;
			expect(plan.ignoredData.safe).toBe(true);
			expect(plan.ignoredData.configuredLinks.length).toBe(4);
			const batchArgs = ["batch", "finish", "--inactive-for", "7d", "--exclude", "single"];
			const preview = runCli(fixture.checkout, [...batchArgs, "--dry-run", "--json"]);
			expect(preview.status).toBe(0);
			const batch = JSON.parse(preview.stdout);
			expect(batch.resources.find((r: { slug: string }) => r.slug === "batched").reason).toBe("eligible");
			// Changing primary settings is not changing the workspace link. Targets
			// are neither followed for the receipt nor removed during retirement.
			for (const link of fixture.links) writeFileSync(join(fixture.checkout, link), `retain latest ${link}\n`);
			expect(runCli(fixture.checkout, ["single", "finish", "--keep-branch", "--expected", plan.receipt, "--yes"]).status).toBe(0);
			expect(runCli(fixture.checkout, [...batchArgs, "--expected", batch.receipt, "--yes", "--json"]).status).toBe(0);
			for (const slug of ["single", "batched"]) {
				expect(existsSync(join(fixture.worktrees, slug))).toBe(false);
				expect(git(fixture.checkout, "branch", "--list", `agent/${slug}`)).toContain(`agent/${slug}`);
			}
			for (const link of fixture.links) expect(readFileSync(join(fixture.checkout, link), "utf8")).toBe(`retain latest ${link}\n`);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	}, 60000);

	for (const mode of ["single", "batch"]) {
		it(`invalidates ${mode} receipts for changed links, including restored destinations`, () => {
			const fixture = createLocalLinkFixture();
			try {
				expect(runCli(fixture.checkout, ["changed", "create"]).status).toBe(0);
				backdateSession(fixture, "changed");
				const command = mode === "single" ? ["changed", "finish", "--keep-branch"] : ["batch", "finish", "--inactive-for", "7d"];
				const preview = JSON.parse(runCli(fixture.checkout, [...command, "--dry-run", "--json"]).stdout);
				if (mode === "batch") expect(preview.resources[0].reason).toBe("eligible");
				const receipt = mode === "single" ? preview.plan.receipt : preview.receipt;
				const apply = () => runCli(fixture.checkout, [...command, "--expected", receipt, "--yes", ...(mode === "batch" ? ["--json"] : [])]);
				const link = join(fixture.worktrees, "changed", fixture.links[0]!);
				const expected = readlinkSync(link);
				const foreign = join(fixture.root, "foreign-settings");
				writeFileSync(foreign, "do not touch\n");
				rmSync(link); symlinkSync(foreign, link);
				expect(apply().status).toBe(1);
				expect(readlinkSync(link)).toBe(foreign);
				rmSync(link); symlinkSync(expected, link);
				expect(apply().status).toBe(1);
				expect(existsSync(join(fixture.worktrees, "changed"))).toBe(true);
				expect(readFileSync(foreign, "utf8")).toBe("do not touch\n");
				for (const name of fixture.links) expect(readFileSync(join(fixture.checkout, name), "utf8")).toBe(`preserve ${name}\n`);
			} finally { rmSync(fixture.root, { recursive: true, force: true }); }
		}, 60000);

		it(`refuses ignored data appearing after a ${mode} preview`, () => {
			const fixture = createLocalLinkFixture();
			try {
				expect(runCli(fixture.checkout, ["new-data", "create"]).status).toBe(0);
				backdateSession(fixture, "new-data");
				const command = mode === "single" ? ["new-data", "finish", "--keep-branch"] : ["batch", "finish", "--inactive-for", "7d"];
				const preview = JSON.parse(runCli(fixture.checkout, [...command, "--dry-run", "--json"]).stdout);
				if (mode === "batch") expect(preview.resources[0].reason).toBe("eligible");
				const receipt = mode === "single" ? preview.plan.receipt : preview.receipt;
				const cache = join(fixture.worktrees, "new-data", ".cache"); mkdirSync(cache);
				writeFileSync(join(cache, "runtime.sqlite"), "preserve new evidence\n");
				expect(runCli(fixture.checkout, [...command, "--expected", receipt, "--yes", ...(mode === "batch" ? ["--json"] : [])]).status).toBe(1);
				expect(readFileSync(join(cache, "runtime.sqlite"), "utf8")).toBe("preserve new evidence\n");
			} finally { rmSync(fixture.root, { recursive: true, force: true }); }
		}, 60000);
	}

	it("refuses unapproved ignored data in both non-forced paths, including direct single finish", () => {
		const fixture = createLocalLinkFixture();
		try {
			expect(runCli(fixture.checkout, ["unknown", "create"]).status).toBe(0);
			backdateSession(fixture, "unknown");
			const cache = join(fixture.worktrees, "unknown", ".cache"); mkdirSync(cache);
			writeFileSync(join(cache, "evidence.sqlite"), "retain runtime evidence\n");
			const preview = JSON.parse(runCli(fixture.checkout, ["unknown", "finish", "--keep-branch", "--dry-run", "--json"]).stdout);
			expect(preview.plan.ignoredData.safe).toBe(false);
			expect(runCli(fixture.checkout, ["unknown", "finish", "--keep-branch", "--yes"]).status).toBe(1);
			const batch = JSON.parse(runCli(fixture.checkout, ["batch", "finish", "--inactive-for", "7d", "--dry-run", "--json"]).stdout);
			expect(batch.resources[0].reason).toBe("ignored-local-data");
			expect(readFileSync(join(cache, "evidence.sqlite"), "utf8")).toBe("retain runtime evidence\n");
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	}, 60000);

	it("handles ignored containers of nested known links without following directory targets", () => {
		const fixture = createLocalLinkFixture();
		try {
			const target = join(fixture.checkout, ".nested", "settings"); mkdirSync(target, { recursive: true });
			writeFileSync(join(target, "important"), "primary directory target\n");
			writeConfig(fixture.checkout, fixture.agent, [], ".worktrees", [...fixture.links, ".nested/settings"]);
			for (const slug of ["nested-single", "nested-batch"]) {
				expect(runCli(fixture.checkout, [slug, "create"]).status).toBe(0);
				backdateSession(fixture, slug);
			}
			const plan = JSON.parse(runCli(fixture.checkout, ["nested-single", "finish", "--keep-branch", "--dry-run", "--json"]).stdout).plan;
			expect(plan.ignoredData.safe).toBe(true);
			expect(plan.ignoredData.configuredLinks.length).toBe(5);
			expect(runCli(fixture.checkout, ["nested-single", "finish", "--keep-branch", "--expected", plan.receipt, "--yes"]).status).toBe(0);
			const common = ["batch", "finish", "--inactive-for", "7d"];
			const preview = JSON.parse(runCli(fixture.checkout, [...common, "--dry-run", "--json"]).stdout);
			expect(preview.resources[0].reason).toBe("eligible");
			expect(runCli(fixture.checkout, [...common, "--expected", preview.receipt, "--yes", "--json"]).status).toBe(0);
			expect(readFileSync(join(target, "important"), "utf8")).toBe("primary directory target\n");
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	}, 60000);

	it("refuses ordinary-file replacements and unconfigured symlinks instead of trusting names", () => {
		const fixture = createLocalLinkFixture();
		try {
			expect(runCli(fixture.checkout, ["unsafe", "create"]).status).toBe(0);
			const worktree = join(fixture.worktrees, "unsafe");
			const path = join(worktree, fixture.links[0]!);
			rmSync(path); writeFileSync(path, "authored replacement\n");
			const inspect = () => JSON.parse(runCli(fixture.checkout, ["unsafe", "finish", "--keep-branch", "--dry-run", "--json"]).stdout).plan;
			expect(inspect().ignoredData.configuredLinks.find((link: { path: string }) => link.path === fixture.links[0]).state).toBe("mismatch");
			expect(runCli(fixture.checkout, ["unsafe", "finish", "--keep-branch", "--yes"]).status).toBe(1);
			expect(readFileSync(path, "utf8")).toBe("authored replacement\n");
			rmSync(path); symlinkSync(join(realpathSync(fixture.checkout), fixture.links[0]!), path);
			const extra = join(worktree, ".pre-commit-config.yaml"); symlinkSync("/nix/store/unapproved-hook", extra);
			expect(inspect().ignoredData.unapprovedPaths.includes(".pre-commit-config.yaml")).toBe(true);
			expect(runCli(fixture.checkout, ["unsafe", "finish", "--keep-branch", "--yes"]).status).toBe(1);
			expect(readlinkSync(extra)).toBe("/nix/store/unapproved-hook");
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("keeps optional missing links non-blocking and binds their later appearance", () => {
		const fixture = createLocalLinkFixture();
		try {
			const name = fixture.links[3]!;
			const primary = join(realpathSync(fixture.checkout), name); rmSync(primary);
			expect(runCli(fixture.checkout, ["optional", "create"]).status).toBe(0);
			const args = ["optional", "finish", "--keep-branch"];
			const inspect = () => JSON.parse(runCli(fixture.checkout, [...args, "--dry-run", "--json"]).stdout).plan;
			const before = inspect();
			expect(before.ignoredData.safe).toBe(true);
			expect(before.ignoredData.configuredLinks.find((link: { path: string }) => link.path === name).state).toBe("missing");
			symlinkSync(primary, join(fixture.worktrees, "optional", name));
			expect(runCli(fixture.checkout, [...args, "--expected", before.receipt, "--yes"]).status).toBe(1);
			const after = inspect();
			expect(after.ignoredData.safe).toBe(true);
			expect(after.ignoredData.configuredLinks.find((link: { path: string }) => link.path === name).state).toBe("verified");
			expect(runCli(fixture.checkout, [...args, "--expected", after.receipt, "--yes"]).status).toBe(0);
			expect(existsSync(primary)).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("rechecks local-link evidence after interactive confirmation", () => {
		const fixture = createLocalLinkFixture();
		try {
			expect(runCli(fixture.checkout, ["waiting", "create"]).status).toBe(0);
			const args = ["waiting", "finish", "--keep-branch"];
			const plan = JSON.parse(runCli(fixture.checkout, [...args, "--dry-run", "--json"]).stdout).plan;
			const link = join(fixture.worktrees, "waiting", fixture.links[0]!);
			const foreign = join(fixture.root, "foreign"); writeFileSync(foreign, "keep foreign data\n");
			const driver = `
import errno, json, os, pty, select, subprocess, sys, time
master, slave = pty.openpty()
child = subprocess.Popen(json.loads(sys.argv[1]), stdin=slave, stdout=slave, stderr=slave)
os.close(slave)
output = b''
changed = False
try:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.05)[0]:
            try:
                chunk = os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not chunk:
                break
            output += chunk
            if b'[y/N]' in output and not changed:
                os.unlink(sys.argv[2])
                os.symlink(sys.argv[3], sys.argv[2])
                os.write(master, b'yes\\n')
                changed = True
        elif child.poll() is not None:
            break
    else:
        raise TimeoutError('confirmation did not complete')
    print(json.dumps({'status': child.wait(timeout=5), 'changed': changed, 'output': output.decode(errors='replace')}))
finally:
    if child.poll() is None:
        child.kill()
        child.wait()
    os.close(master)
`;
			const result = spawnSync("python3", ["-c", driver, JSON.stringify(["node", cliScript, ...args, "--expected", plan.receipt]), link, foreign], {
				cwd: fixture.checkout, encoding: "utf8", env: { ...process.env, AGENT_SESSION_CONFIG: runtimeConfigPath(fixture.checkout) },
			});
			expect(result.status).toBe(0);
			const terminal = JSON.parse(result.stdout);
			expect(terminal.changed).toBe(true);
			expect(terminal.status).toBe(1);
			expect(readlinkSync(link)).toBe(foreign);
			expect(readFileSync(foreign, "utf8")).toBe("keep foreign data\n");
			expect(git(fixture.checkout, "branch", "--list", "agent/waiting")).toContain("agent/waiting");
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	}, 60000);

	it("refuses symlink ancestors of configured paths and leaves external resources untouched", () => {
		const fixture = createLocalLinkFixture();
		try {
			mkdirSync(join(fixture.checkout, ".nested"));
			writeFileSync(join(fixture.checkout, ".nested", "settings"), "primary nested settings\n");
			writeConfig(fixture.checkout, fixture.agent, [], ".worktrees", [...fixture.links, ".nested/settings"]);
			expect(runCli(fixture.checkout, ["ancestor", "create"]).status).toBe(0);
			backdateSession(fixture, "ancestor");
			const worktree = join(fixture.worktrees, "ancestor");
			const external = join(fixture.root, "external"); mkdirSync(external);
			symlinkSync(join(realpathSync(fixture.checkout), ".nested", "settings"), join(external, "settings"));
			rmSync(join(worktree, ".nested"), { recursive: true }); symlinkSync(external, join(worktree, ".nested"));
			const plan = JSON.parse(runCli(fixture.checkout, ["ancestor", "finish", "--keep-branch", "--dry-run", "--json"]).stdout).plan;
			expect(plan.ignoredData.configuredLinks.find((link: { path: string }) => link.path === ".nested/settings").state).toBe("unsafe");
			expect(runCli(fixture.checkout, ["ancestor", "finish", "--keep-branch", "--yes"]).status).toBe(1);
			const batch = JSON.parse(runCli(fixture.checkout, ["batch", "finish", "--inactive-for", "7d", "--dry-run", "--json"]).stdout);
			expect(batch.resources[0].reason).toBe("ignored-local-data");
			expect(lstatSync(join(external, "settings")).isSymbolicLink()).toBe(true);
			expect(readFileSync(join(fixture.checkout, ".nested", "settings"), "utf8")).toBe("primary nested settings\n");
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	}, 60000);
});

function runFixtureOnTerminal(fixture: ReturnType<typeof createRepositoryFixture>, command: string[], answer: string, mutation = "") {
	const driver = `
import errno, json, os, pty, select, subprocess, sys, time
master, slave = pty.openpty()
child = subprocess.Popen(json.loads(sys.argv[1]), stdin=slave, stdout=slave, stderr=slave)
os.close(slave)
output, answered = b'', False
try:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.05)[0]:
            try:
                chunk = os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not chunk:
                break
            output += chunk
            if b'[y/N]' in output and not answered:
                worktree, mutation = sys.argv[3], sys.argv[4]
                if mutation == 'artifact':
                    with open(os.path.join(worktree, '.cache', 'tasks.sqlite'), 'w') as data:
                        data.write('new data during confirmation')
                elif mutation == 'unapproved':
                    with open(os.path.join(worktree, '.pre-commit-config.yaml'), 'w') as data:
                        data.write('retain unapproved data')
                elif mutation == 'head':
                    with open(os.path.join(worktree, 'README.md'), 'a') as data:
                        data.write('concurrent work\\n')
                    subprocess.run(['git', '-C', worktree, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-am', 'Concurrent work'], check=True, stdout=subprocess.DEVNULL)
                elif mutation == 'policy':
                    with open(os.environ['AGENT_SESSION_CONFIG']) as data:
                        record = json.load(data)
                    record['disposable_paths'].append('.unused')
                    with open(os.environ['AGENT_SESSION_CONFIG'], 'w') as data:
                        json.dump(record, data)
                elif mutation == 'metadata':
                    with open(sys.argv[5]) as data:
                        record = json.load(data)
                    record['lastWorkAt'] = '2026-10-28T00:00:00Z'
                    with open(sys.argv[5], 'w') as data:
                        json.dump(record, data)
                os.write(master, b'\\x04' if sys.argv[2] == 'EOF' else sys.argv[2].encode())
                answered = True
        elif child.poll() is not None:
            break
    else:
        raise TimeoutError('finish prompt did not complete')
    print(json.dumps({'status': child.wait(timeout=5), 'answered': answered, 'output': output.decode(errors='replace')}))
finally:
    if child.poll() is None:
        child.kill()
        child.wait()
    os.close(master)
`;
	const result = spawnSync("python3", ["-c", driver, JSON.stringify(command), answer,
		join(fixture.worktrees, "human"), mutation, sessionMetadataPath(fixture.checkout, "human")], {
		cwd: fixture.checkout, encoding: "utf8", env: { ...process.env, AGENT_SESSION_CONFIG: runtimeConfigPath(fixture.checkout) },
	});
	if (result.status !== 0) throw new Error(result.stderr);
	return JSON.parse(result.stdout);
}

function finishOnTerminal(fixture: ReturnType<typeof createRepositoryFixture>, args: string[], answer: string, mutation = "") {
	return runFixtureOnTerminal(fixture, ["node", cliScript, ...args], answer, mutation);
}

function createHumanFinishFixture() {
	const fixture = createLocalLinkFixture();
	writeConfig(fixture.checkout, fixture.agent, [], ".worktrees", fixture.links, [".cache"]);
	if (runCli(fixture.checkout, ["human", "create"]).status !== 0) throw new Error("Could not create human finish fixture");
	const worktree = join(fixture.worktrees, "human"); mkdirSync(join(worktree, ".cache"));
	writeFileSync(join(worktree, ".cache", "tasks.sqlite"), "approved whole subtree\n");
	return { ...fixture, worktree };
}

describe("human finish workflow", () => {
	it("prints a text receipt and a complete replay command without changing the JSON receipt", () => {
		const fixture = createHumanFinishFixture();
		try {
			const args = ["human", "finish", "--keep-branch", "--dry-run"];
			const plan = JSON.parse(runCli(fixture.checkout, [...args, "--json"]).stdout).plan;
			const text = runCli(fixture.checkout, args);
			expect(text.status).toBe(0);
			expect(text.stdout).toContain(`Receipt: ${plan.receipt}`);
			expect(text.stdout).toContain(`as human finish --keep-branch --expected ${plan.receipt} --yes`);
			expect(text.stdout).toContain(".cache");
			expect(existsSync(fixture.worktree)).toBe(true);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	for (const blockedBy of ["dirty", "unapproved"]) {
		it(`does not offer receipt/apply commands for a ${blockedBy} text preview`, () => {
			const fixture = createHumanFinishFixture();
			try {
				writeFileSync(join(fixture.worktree, blockedBy === "dirty" ? "README.md" : ".pre-commit-config.yaml"), "keep local work\n");
				const preview = runCli(fixture.checkout, ["human", "finish", "--keep-branch", "--dry-run"]);
				expect(preview.status).toBe(0);
				expect(preview.stdout).toContain("blocked");
				expect(preview.stdout.includes("Receipt:")).toBe(false);
				expect(preview.stdout.includes("Apply:")).toBe(false);
				expect(existsSync(fixture.worktree)).toBe(true);
			} finally { rmSync(fixture.root, { recursive: true, force: true }); }
		});
	}

	for (const keepBranch of [true, false]) {
		it(`finishes from one terminal confirmation, keeping branch disposition ${keepBranch ? "preserved" : "deleted"}`, () => {
			const fixture = createHumanFinishFixture();
			try {
				const result = finishOnTerminal(fixture, ["human", "finish", ...(keepBranch ? ["--keep-branch"] : [])], "yes\n");
				expect(result.answered).toBe(true);
				if (result.status !== 0) throw new Error(result.output);
				expect(result.status).toBe(0);
				expect(result.output).toContain(".cache");
				expect(result.output).toContain("databases"); // Explain whole-subtree disposal.
				expect(result.output).toContain(keepBranch ? "preserved" : "delete");
				expect(result.output.includes("--expected")).toBe(false);
				expect(existsSync(fixture.worktree)).toBe(false);
				expect(Boolean(git(fixture.checkout, "branch", "--list", "agent/human"))).toBe(keepBranch);
				for (const link of fixture.links) expect(readFileSync(join(fixture.checkout, link), "utf8")).toBe(`preserve ${link}\n`);
			} finally { rmSync(fixture.root, { recursive: true, force: true }); }
		});
	}

	for (const answer of ["no\n", "EOF"]) {
		it(`retains approved artifacts when the terminal answer is ${JSON.stringify(answer)}`, () => {
			const fixture = createHumanFinishFixture();
			try {
				const result = finishOnTerminal(fixture, ["human", "finish", "--keep-branch"], answer);
				expect(result.answered).toBe(true);
				expect(result.status).toBe(1);
				expect(readFileSync(join(fixture.worktree, ".cache", "tasks.sqlite"), "utf8")).toBe("approved whole subtree\n");
				expect(git(fixture.checkout, "branch", "--list", "agent/human")).toContain("agent/human");
			} finally { rmSync(fixture.root, { recursive: true, force: true }); }
		});
	}

	for (const mutation of ["artifact", "unapproved", "head", "metadata", "policy"]) {
		it(`refuses ${mutation} changes made while the confirmation waits`, () => {
			const fixture = createHumanFinishFixture();
			try {
				const result = finishOnTerminal(fixture, ["human", "finish"], "yes\n", mutation);
				expect(result.answered).toBe(true);
				expect(result.status).toBe(1);
				expect(existsSync(fixture.worktree)).toBe(true);
				expect(git(fixture.checkout, "branch", "--list", "agent/human")).toContain("agent/human");
				if (mutation === "artifact") expect(readFileSync(join(fixture.worktree, ".cache", "tasks.sqlite"), "utf8")).toBe("new data during confirmation");
				if (mutation === "unapproved") expect(readFileSync(join(fixture.worktree, ".pre-commit-config.yaml"), "utf8")).toBe("retain unapproved data");
				if (mutation === "head") expect(git(fixture.worktree, "log", "-1", "--format=%s")).toBe("Concurrent work");
			} finally { rmSync(fixture.root, { recursive: true, force: true }); }
		});
	}

	it("still requires explicit artifact receipts for --yes, even on a terminal", () => {
		const fixture = createHumanFinishFixture();
		try {
			const result = finishOnTerminal(fixture, ["human", "finish", "--keep-branch", "--yes"], "yes\n");
			expect(result.answered).toBe(false);
			expect(result.status).toBe(1);
			expect(result.output).toContain("receipt");
			expect(existsSync(fixture.worktree)).toBe(true);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("coalesces human metadata progress but retains every JSON progress event", () => {
		const reporter = resolve("modules/flake/agent-session/runtime.ts");
		const script = `import { progressReporter } from ${tomlString(reporter)};
const report = progressReporter("finish", process.argv[1] === "json");
report("inspect-finish", "started");
for (let i = 1; i <= 100; i++) report("inspect-metadata-chunk:human", "completed", "node_modules: " + (i * 2048) + " metadata entries scanned so far");
report("inspect-finish", "completed");`;
		const text = spawnSync("node", ["--input-type=module", "-e", script, "text"], { encoding: "utf8", env: process.env });
		const json = spawnSync("node", ["--input-type=module", "-e", script, "json"], { encoding: "utf8", env: process.env });
		expect(text.status).toBe(0);
		expect(text.stderr.trim().split("\n").length <= 5).toBe(true);
		expect(text.stderr).toContain("node_modules");
		expect(json.status).toBe(0);
		expect(json.stderr.trim().split("\n").length).toBe(102);
		expect(JSON.parse(json.stderr.trim().split("\n")[100]!).detail).toContain("204800");
		const fixture = createRepositoryFixture();
		try {
			const terminal = runFixtureOnTerminal(fixture, ["node", "--input-type=module", "-e", script, "text"], "");
			expect(terminal.status).toBe(0);
			expect(terminal.output).toContain("\r\x1b[2K");
			expect(terminal.output.split("\n").length <= 5).toBe(true);
			expect(terminal.output.includes("COMPLETED inspect-metadata-chunk")).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});
});

describe("receipt-bound artifact disposal", () => {
	it("disposes explicitly approved subtrees/files/links through both guarded paths, never targets", () => {
		const fixture = createLocalLinkFixture();
		try {
			writeConfig(fixture.checkout, fixture.agent, [], ".worktrees", fixture.links, [".cache", ".pre-commit-config.yaml"]);
			const outside = join(fixture.root, "retained-target"); mkdirSync(outside);
			writeFileSync(join(outside, "database"), "retain\n");
			for (const slug of ["single", "batched"]) {
				expect(runCli(fixture.checkout, [slug, "create"]).status).toBe(0); backdateSession(fixture, slug);
				const worktree = join(fixture.worktrees, slug), cache = join(worktree, ".cache");
				mkdirSync(join(cache, "deep"), { recursive: true });
				writeFileSync(join(cache, "deep", "tasks.sqlite"), "valuable unless explicitly approved\n");
				writeFileSync(join(cache, "diagnostics.log"), "approved whole subtree\n");
				symlinkSync(outside, join(cache, "external"));
				if (slug === "single") writeFileSync(join(worktree, ".pre-commit-config.yaml"), "approved generated file\n");
				else symlinkSync(join(outside, "database"), join(worktree, ".pre-commit-config.yaml"));
			}
			const singleArgs = ["single", "finish", "--keep-branch"];
			const plan = JSON.parse(runCli(fixture.checkout, [...singleArgs, "--dry-run", "--json"]).stdout).plan;
			expect(plan.ignoredData.safe).toBe(true);
			expect(plan.ignoredData.approvedArtifacts.includes(".cache")).toBe(true);
			expect(plan.artifactDisposalRequiresReceipt).toBe(true);
			expect(typeof plan.ignoredData.policyRoots.find((root: { path: string }) => root.path === ".cache").tree.fingerprint).toBe("string");
			expect(runCli(fixture.checkout, [...singleArgs, "--yes"]).status).toBe(1);
			// Legacy bulk has no receipt contract: it must not silently dispose artifacts.
			const bulk = runCli(fixture.checkout, ["finish", "--all", "--keep-branch", "--yes"]);
			expect(bulk.stderr).toContain("preview receipt");
			expect(existsSync(join(fixture.worktrees, "single", ".cache", "diagnostics.log"))).toBe(true);
			const batchArgs = ["batch", "finish", "--inactive-for", "7d", "--exclude", "single"];
			const batch = JSON.parse(runCli(fixture.checkout, [...batchArgs, "--dry-run", "--json"]).stdout);
			expect(batch.resources.find((resource: { slug: string }) => resource.slug === "batched").reason).toBe("eligible");
			writeFileSync(join(outside, "database"), "retain latest\n");
			expect(runCli(fixture.checkout, [...singleArgs, "--expected", plan.receipt, "--yes"]).status).toBe(0);
			expect(runCli(fixture.checkout, [...batchArgs, "--expected", batch.receipt, "--yes", "--json"]).status).toBe(0);
			for (const slug of ["single", "batched"]) {
				expect(existsSync(join(fixture.worktrees, slug))).toBe(false);
				expect(git(fixture.checkout, "branch", "--list", `agent/${slug}`)).toContain(`agent/${slug}`);
			}
			expect(readFileSync(join(outside, "database"), "utf8")).toBe("retain latest\n");
			for (const path of fixture.links) expect(readFileSync(join(fixture.checkout, path), "utf8")).toBe(`preserve ${path}\n`);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	}, 120000);

	for (const mode of ["single", "batch"]) {
		it(`invalidates ${mode} receipts for deep metadata changes and restored content/mtime`, () => {
			const fixture = createLocalLinkFixture();
			try {
				writeConfig(fixture.checkout, fixture.agent, [], ".worktrees", fixture.links, [".cache"]);
				expect(runCli(fixture.checkout, ["changed", "create"]).status).toBe(0); backdateSession(fixture, "changed");
				const cache = join(fixture.worktrees, "changed", ".cache"); mkdirSync(join(cache, "deep"), { recursive: true });
				const file = join(cache, "deep", "database"); writeFileSync(file, "AAAA");
				const args = mode === "single" ? ["changed", "finish", "--keep-branch"] : ["batch", "finish", "--inactive-for", "7d"];
				const preview = () => { const result = JSON.parse(runCli(fixture.checkout, [...args, "--dry-run", "--json"]).stdout); return mode === "single" ? result.plan : result; };
				const apply = (receipt: string) => runCli(fixture.checkout, [...args, "--expected", receipt, "--yes", ...(mode === "batch" ? ["--json"] : [])]);
				const before = preview(), timestamp = lstatSync(file).mtime;
				writeFileSync(file, "BBBB"); utimesSync(file, timestamp, timestamp);
				expect(apply(before.receipt).status).toBe(1);
				writeFileSync(file, "AAAA"); utimesSync(file, timestamp, timestamp);
				expect(apply(before.receipt).status).toBe(1);
				const added = join(cache, "deep", "new-data");
				const next = preview(); writeFileSync(added, "retained until fresh approval");
				expect(apply(next.receipt).status).toBe(1);
				expect(readFileSync(added, "utf8")).toBe("retained until fresh approval");
				const removed = preview(); rmSync(added);
				expect(apply(removed.receipt).status).toBe(1);
				expect(existsSync(file)).toBe(true);
				expect(apply(preview().receipt).status).toBe(0);
				expect(git(fixture.checkout, "branch", "--list", "agent/changed")).toContain("agent/changed");
			} finally { rmSync(fixture.root, { recursive: true, force: true }); }
		}, 120000);

		it(`binds ${mode} policy changes and retains ignored data outside exact approved paths`, () => {
			const fixture = createLocalLinkFixture();
			try {
				const configure = (paths: string[]) => writeConfig(fixture.checkout, fixture.agent, [], ".worktrees", fixture.links, paths);
				configure([".cache"]);
				expect(runCli(fixture.checkout, ["policy", "create"]).status).toBe(0); backdateSession(fixture, "policy");
				const worktree = join(fixture.worktrees, "policy"); mkdirSync(join(worktree, ".cache"));
				writeFileSync(join(worktree, ".cache", "data"), "approved only with current receipt\n");
				const args = mode === "single" ? ["policy", "finish", "--keep-branch"] : ["batch", "finish", "--inactive-for", "7d"];
				const preview = () => { const result = JSON.parse(runCli(fixture.checkout, [...args, "--dry-run", "--json"]).stdout); return mode === "single" ? result.plan : result; };
				const apply = (receipt: string) => runCli(fixture.checkout, [...args, "--expected", receipt, "--yes", ...(mode === "batch" ? ["--json"] : [])]);
				const first = preview();
				expect((mode === "single" ? first.ignoredData : first.resources[0].ignoredData).safe).toBe(true);
				configure([".cache", ".unused"]);
				expect(apply(first.receipt).status === 0).toBe(false);
				configure([".cache"]); const second = preview();
				writeFileSync(join(worktree, ".pre-commit-config.yaml"), "unapproved local data\n");
				expect(apply(second.receipt).status).toBe(1);
				expect(readFileSync(join(worktree, ".pre-commit-config.yaml"), "utf8")).toBe("unapproved local data\n");
				const blocked = preview(), inspection = mode === "single" ? blocked.ignoredData : blocked.resources[0].ignoredData;
				expect(inspection.safe).toBe(false);
				expect(inspection.unapprovedPaths.includes(".pre-commit-config.yaml")).toBe(true);
			} finally { rmSync(fixture.root, { recursive: true, force: true }); }
		}, 120000);
	}

	it("expands only structural parents of exact nested policy roots and refuses unsafe ancestors", () => {
		const fixture = createLocalLinkFixture();
		try {
			writeConfig(fixture.checkout, fixture.agent, [], ".worktrees", fixture.links, [".nested/generated"]);
			expect(runCli(fixture.checkout, ["nested", "create"]).status).toBe(0);
			const worktree = join(fixture.worktrees, "nested"), nested = join(worktree, ".nested");
			mkdirSync(join(nested, "generated"), { recursive: true }); writeFileSync(join(nested, "generated", "data"), "approved");
			const preview = () => JSON.parse(runCli(fixture.checkout, ["nested", "finish", "--keep-branch", "--dry-run", "--json"]).stdout).plan;
			expect(preview().ignoredData.safe).toBe(true);
			writeFileSync(join(nested, "other-data"), "retain");
			expect(preview().ignoredData.safe).toBe(false);
			rmSync(nested, { recursive: true });
			const outside = join(fixture.root, "outside-policy"); mkdirSync(join(outside, "generated"), { recursive: true });
			writeFileSync(join(outside, "generated", "data"), "never follow"); symlinkSync(outside, nested);
			expect(preview().ignoredData.safe).toBe(false);
			expect(runCli(fixture.checkout, ["nested", "finish", "--keep-branch", "--yes"]).status).toBe(1);
			expect(readFileSync(join(outside, "generated", "data"), "utf8")).toBe("never follow");
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	}, 60000);

	it("does not let a directory policy override configured-link replacement protection", () => {
		const fixture = createLocalLinkFixture();
		try {
			const target = join(fixture.checkout, ".nested", "settings"); mkdirSync(target, { recursive: true });
			writeFileSync(join(target, "important"), "primary data\n");
			writeConfig(fixture.checkout, fixture.agent, [], ".worktrees", [...fixture.links, ".nested/settings"], [".nested"]);
			expect(runCli(fixture.checkout, ["protected", "create"]).status).toBe(0); backdateSession(fixture, "protected");
			const replacement = join(fixture.worktrees, "protected", ".nested", "settings");
			rmSync(replacement); writeFileSync(replacement, "keep replacement\n");
			const single = JSON.parse(runCli(fixture.checkout, ["protected", "finish", "--keep-branch", "--dry-run", "--json"]).stdout).plan;
			expect(single.ignoredData.safe).toBe(false);
			const batch = JSON.parse(runCli(fixture.checkout, ["batch", "finish", "--inactive-for", "7d", "--dry-run", "--json"]).stdout);
			expect(batch.resources[0].reason).toBe("ignored-local-data");
			expect(runCli(fixture.checkout, ["protected", "finish", "--keep-branch", "--expected", single.receipt, "--yes"]).status).toBe(1);
			expect(readFileSync(replacement, "utf8")).toBe("keep replacement\n");
			expect(readFileSync(join(target, "important"), "utf8")).toBe("primary data\n");
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	}, 60000);

	it("rejects broad/traversing/Git-metadata policy paths and malformed configuration", () => {
		const fixture = createLocalLinkFixture();
		try {
			for (const paths of [[""], ["."], [".."], ["/tmp"], ["foo/../bar"], ["foo//bar"], [".git"], ["foo/.git"], ["node_modules/*"]]) {
				writeConfig(fixture.checkout, fixture.agent, [], ".worktrees", fixture.links, paths);
				expect(runCli(fixture.checkout, ["invalid-policy", "create"]).status === 0).toBe(false);
			}
			const path = runtimeConfigPath(fixture.checkout), config = JSON.parse(readFileSync(path, "utf8"));
			config.disposable_paths = null; writeFileSync(path, JSON.stringify(config));
			expect(runCli(fixture.checkout, ["invalid-policy", "create"]).status === 0).toBe(false);
			expect(existsSync(join(fixture.worktrees, "invalid-policy"))).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});
});

describe("batch inspection evidence and scaling", () => {
	it("reports activity, ignored sizes and simultaneous dirty/identity/live/lock blockers", () => {
		const fixture = createLocalLinkFixture();
		try {
			expect(runCli(fixture.checkout, ["inspect-me", "create"]).status).toBe(0);
			const worktree = join(realpathSync(fixture.worktrees), "inspect-me");
			git(worktree, "checkout", "--detach", "HEAD");
			backdateSession(fixture, "inspect-me");
			writeFileSync(join(worktree, "README.md"), "changed recently\n");
			const cache = join(worktree, ".cache"); mkdirSync(cache);
			writeFileSync(join(cache, "runtime.sqlite"), "preserve evidence\n");
			const outside = join(fixture.root, "outside"); mkdirSync(outside);
			writeFileSync(join(outside, "large-target"), "x".repeat(2 * 1024 * 1024));
			symlinkSync(outside, join(cache, "outside-link"));
			const path = sessionMetadataPath(fixture.checkout, "inspect-me");
			const metadata = JSON.parse(readFileSync(path, "utf8"));
			metadata.activeOperations = [{ id: "live", pid: process.pid, hostname: hostname(), startedAt: metadata.createdAt }];
			writeFileSync(path, JSON.stringify(metadata));
			git(fixture.checkout, "worktree", "lock", worktree);
			const before = readFileSync(path, "utf8");
			const result = runCli(fixture.checkout, ["batch", "finish", "--inactive-for", "14d", "--dry-run", "--json"]);
			expect(result.status).toBe(0);
			const resource = JSON.parse(result.stdout).resources[0];
			const blockers = resource.blockers.map((blocker: { reason: string }) => blocker.reason);
			for (const reason of ["unresolved-resource", "dirty", "live-operation", "ignored-local-data", "recent-activity", "worktree-locked"]) expect(blockers.includes(reason)).toBe(true);
			expect(resource.git.clean).toBe(false);
			expect(resource.git.currentBranch).toBe(null);
			expect(resource.git.changes.find((change: { path: string }) => change.path === "README.md").status).toBe(" M");
			expect(resource.activity.complete).toBe(true);
			expect(resource.activity.inactive).toBe(false);
			expect(resource.activity.limitingEvidence).toBe("file:README.md");
			expect(resource.activity.observations.some((item: { source: string }) => item.source === "reflog:HEAD")).toBe(true);
			const ignored = resource.ignoredData.ignoredPaths.find((entry: { path: string }) => entry.path === ".cache");
			expect(ignored.type).toBe("directory");
			expect(ignored.classification).toBe("unapproved");
			expect(ignored.size.scope).toBe("tree-no-follow");
			expect(ignored.size.complete).toBe(true);
			expect(ignored.size.entries >= 3).toBe(true);
			expect(Number(ignored.size.apparentBytes) < 1024 * 1024).toBe(true);
			expect(typeof ignored.size.allocatedBytes).toBe("string");
			expect(readFileSync(path, "utf8")).toBe(before);
			expect(readFileSync(join(cache, "runtime.sqlite"), "utf8")).toBe("preserve evidence\n");
			expect(existsSync(join(outside, "large-target"))).toBe(true);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	}, 60000);

	it("keeps incomplete activity/process evidence explicit while reporting other blockers", () => {
		const fixture = createLocalLinkFixture();
		try {
			expect(runCli(fixture.checkout, ["partial", "create"]).status).toBe(0);
			backdateSession(fixture, "partial");
			const worktree = join(fixture.worktrees, "partial");
			const bin = join(fixture.root, "partial-bin"); mkdirSync(bin);
			const lsof = join(bin, "lsof");
			writeFileSync(lsof, "#!/bin/sh\nprintf 'p123\\000fcwd\\000n/\\000\\np234\\000fcwd\\000'\n", { mode: 0o755 });
			const env = { PATH: `${bin}:${process.env.PATH}` };
			const inspect = () => {
				const result = runCli(fixture.checkout, ["batch", "finish", "--inactive-for", "7d", "--dry-run", "--json"], env);
				expect(result.status).toBe(0);
				return JSON.parse(result.stdout).resources[0];
			};
			const incomplete = inspect();
			expect(incomplete.reason).toBe("unknown-process-evidence");
			expect(incomplete.inspectionComplete).toBe(false);
			expect(typeof incomplete.processEvidence.problem).toBe("string");
			writeFileSync(lsof, "#!/bin/sh\nexit 1\n");
			rmSync(join(worktree, "README.md"));
			const cache = join(worktree, ".cache"); mkdirSync(cache);
			writeFileSync(join(cache, "evidence.sqlite"), "retain\n");
			const partial = inspect();
			const reasons = partial.blockers.map((blocker: { reason: string }) => blocker.reason);
			for (const reason of ["dirty", "unknown-process-evidence", "unknown-activity", "ignored-local-data"]) expect(reasons.includes(reason)).toBe(true);
			expect(partial.activity.complete).toBe(false);
			expect(partial.activity.inactive).toBe(null);
			expect(partial.activity.lastWorkAt).toBe("2000-01-01T00:00:00.000Z");
			expect(partial.ignoredData.ignoredPaths.find((entry: { path: string }) => entry.path === ".cache").size.complete).toBe(true);
			expect(readFileSync(join(cache, "evidence.sqlite"), "utf8")).toBe("retain\n");
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	}, 60000);

	it("does not cross filesystem-device ancestors even for configured links", () => {
		const fixture = createRepositoryFixture();
		try {
			startManagedSession(fixture, "boundary");
			const worktree = realpathSync(join(fixture.worktrees, "boundary"));
			const root = realpathSync(fixture.checkout);
			const foreign = join(worktree, ".foreign"); mkdirSync(foreign);
			symlinkSync(join(root, ".foreign", "local"), join(foreign, "local"));
			writeFileSync(join(worktree, ".gitignore"), readFileSync(join(worktree, ".gitignore"), "utf8") + "\n.foreign/\n");
			const script = join(fixture.root, "device-boundary.mjs");
			writeFileSync(script, `import { mock } from "bun:test";
import * as native from "node:fs";
const fs = { ...native }, foreign = ${tomlString(foreign)};
let descendants = 0, directories = 0;
mock.module("node:fs", () => ({ ...fs,
 lstatSync(path, options) {
  const stat = fs.lstatSync(path, options);
  if (String(path).startsWith(foreign + "/")) descendants++;
  return String(path) === foreign || String(path).startsWith(foreign + "/")
   ? Object.create(stat, { dev: { value: stat.dev + (typeof stat.dev === "bigint" ? 1n : 1) } }) : stat;
 },
 readdirSync(path, options) { if (String(path) === foreign) directories++; return fs.readdirSync(path, options); }
}));
const { inspectIgnoredData } = await import(${tomlString(resolve("modules/flake/agent-session/artifacts.ts"))});
const result = inspectIgnoredData(${tomlString(root)}, ${tomlString(worktree)}, [".foreign/local"]);
const policy = inspectIgnoredData(${tomlString(root)}, ${tomlString(worktree)}, [], [".foreign"]);
console.log(JSON.stringify({ result, policy, descendants, directories }));
`);
			const observed = spawnSync("bun", [script], { encoding: "utf8", env: process.env });
			if (observed.status !== 0) throw new Error(observed.stderr);
			expect(observed.status).toBe(0);
			const { result, policy, descendants, directories } = JSON.parse(observed.stdout);
			expect(policy.safe).toBe(false);
			expect(policy.complete).toBe(false);
			expect(policy.policyRoots[0].tree.size.complete).toBe(false);
			expect(result.safe).toBe(false);
			expect(result.complete).toBe(false);
			expect(result.configuredLinks[0].state).toBe("unsafe");
			expect(result.configuredLinks[0].problem?.toLowerCase().includes("filesystem")).toBe(true);
			expect(descendants).toBe(0);
			expect(directories).toBe(0);
			expect(existsSync(join(foreign, "local"))).toBe(false); // Missing target is intentionally not followed.
			expect(readlinkSync(join(foreign, "local"))).toBe(join(root, ".foreign", "local"));
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	}, 60000);

	it("streams metadata-scan progress and labels allocation as footprint, not reclaimable bytes", () => {
		const fixture = createLocalLinkFixture();
		try {
			expect(runCli(fixture.checkout, ["sized", "create"]).status).toBe(0);
			backdateSession(fixture, "sized");
			const cache = join(fixture.worktrees, "sized", ".cache"); mkdirSync(cache);
			for (let index = 0; index < 2050; index++) writeFileSync(join(cache, `artifact-${index}`), "");
			const result = runCli(fixture.checkout, ["batch", "finish", "--inactive-for", "7d", "--dry-run", "--json"]);
			expect(result.status).toBe(0);
			const resource = JSON.parse(result.stdout).resources[0];
			expect(resource.activity.inactive).toBe(true);
			expect(resource.reason).toBe("ignored-local-data");
			const size = resource.ignoredData.ignoredPaths.find((entry: { path: string }) => entry.path === ".cache").size;
			expect(size.entries).toBe(2051);
			expect(size.accounting).toBe("unique-inodes-within-path");
			expect(size.reclaimableBytes).toBe(undefined);
			const events = result.stderr.trim().split("\n").map((line) => JSON.parse(line));
			expect(events.filter((event) => event.phase === "inspect-metadata-chunk:sized" && event.detail.startsWith(".cache:")).length >= 2).toBe(true);
			expect(existsSync(join(cache, "artifact-2049"))).toBe(true);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	}, 60000);

	it("reports incomplete ignored-path observation instead of omitting a disappearing artifact", () => {
		const fixture = createLocalLinkFixture();
		try {
			expect(runCli(fixture.checkout, ["vanishing", "create"]).status).toBe(0);
			backdateSession(fixture, "vanishing");
			const cache = join(realpathSync(fixture.worktrees), "vanishing", ".cache"); mkdirSync(cache);
			writeFileSync(join(cache, "retained-data"), "untouched\n");
			const moved = join(fixture.root, "moved-cache");
			const bin = join(fixture.root, "race-bin"); mkdirSync(bin);
			const executable = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
			writeFileSync(join(bin, "git"), `#!/bin/sh\ncase "$*" in *'ls-files --others --ignored'*) ${tomlString(executable)} "$@" || exit; if [ -d ${tomlString(cache)} ]; then mv ${tomlString(cache)} ${tomlString(moved)}; fi; exit 0;; esac\nexec ${tomlString(executable)} "$@"\n`, { mode: 0o755 });
			const result = runCli(fixture.checkout, ["batch", "finish", "--inactive-for", "7d", "--dry-run", "--json"], { PATH: `${bin}:${process.env.PATH}` });
			expect(result.status).toBe(0);
			const resource = JSON.parse(result.stdout).resources[0];
			expect(resource.inspectionComplete).toBe(false);
			expect(resource.ignoredData.complete).toBe(false);
			expect(resource.ignoredData.unapprovedPaths.includes(".cache")).toBe(true);
			expect(resource.blockers.some((blocker: { reason: string }) => blocker.reason === "ignored-local-data")).toBe(true);
			expect(resource.activity.complete).toBe(true);
			expect(readFileSync(join(moved, "retained-data"), "utf8")).toBe("untouched\n");
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	}, 60000);

	it("snapshots the shared namespace/catalogue once instead of rescanning it for every candidate", () => {
		const fixture = createRepositoryFixture();
		try {
			startManagedSession(fixture, "first");
			expect(runCli(fixture.checkout, ["second", "create"]).status).toBe(0);
			const bin = join(fixture.root, "namespace-bin"); mkdirSync(bin);
			const executable = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
			const log = join(fixture.root, "namespace-calls");
			writeFileSync(join(bin, "git"), `#!/bin/sh\nif [ "$PWD" = ${tomlString(realpathSync(fixture.checkout))} ]; then\n case "$1 $2" in 'worktree list'|'rev-parse --git-common-dir') printf '%s\\n' "$*" >> ${tomlString(log)};; esac\nfi\nexec ${tomlString(executable)} "$@"\n`, { mode: 0o755 });
			const env = { PATH: `${bin}:${process.env.PATH}` };
			const measure = () => {
				writeFileSync(log, "");
				const result = runCli(fixture.checkout, ["batch", "finish", "--inactive-for", "7d", "--dry-run", "--json"], env);
				expect(result.status).toBe(0);
				return readFileSync(log, "utf8").trim().split("\n").length;
			};
			for (const slug of ["first", "second"]) backdateSession(fixture, slug);
			const small = measure();
			for (const slug of ["third", "fourth", "fifth"]) {
				expect(runCli(fixture.checkout, [slug, "create"]).status).toBe(0);
				backdateSession(fixture, slug);
			}
			expect(measure()).toBe(small);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	}, 60000);

	it("snapshots processes once for preview and freshly per selected apply target, with progress", () => {
		const fixture = createRepositoryFixture();
		try {
			startManagedSession(fixture, "one");
			expect(runCli(fixture.checkout, ["two", "create"]).status).toBe(0);
			for (const slug of ["one", "two"]) backdateSession(fixture, slug);
			const bin = join(fixture.root, "process-bin"); mkdirSync(bin);
			const calls = join(fixture.root, "process-calls");
			const lsof = join(bin, "lsof");
			const script = (cwd: string) => `#!/bin/sh\nprintf 'scan\\n' >> ${tomlString(calls)}\nprintf 'p%s\\000fcwd\\000n%s\\000\\n' "$$" ${tomlString(cwd)}\n`;
			writeFileSync(lsof, script("/"), { mode: 0o755 });
			const env = { PATH: `${bin}:${process.env.PATH}` };
			const common = ["batch", "finish", "--inactive-for", "7d"];
			const preview = runCli(fixture.checkout, [...common, "--dry-run", "--json"], env);
			expect(preview.status).toBe(0);
			expect(readFileSync(calls, "utf8").trim().split("\n").length).toBe(1);
			const result = JSON.parse(preview.stdout);
			expect(result.resources[0].processEvidence.observedAt).toBe(result.resources[1].processEvidence.observedAt);
			const events = preview.stderr.trim().split("\n").map((line) => JSON.parse(line));
			for (const slug of ["one", "two"]) {
				expect(events.some((event) => event.phase === `inspect:${slug}` && event.status === "started")).toBe(true);
				expect(events.some((event) => event.phase === `inspect:${slug}` && event.status === "completed")).toBe(true);
			}
			writeFileSync(lsof, script(join(realpathSync(fixture.worktrees), "one")));
			const apply = runCli(fixture.checkout, [...common, "--expected", result.receipt, "--yes", "--json"], env);
			expect(apply.status).toBe(1);
			expect(readFileSync(calls, "utf8").trim().split("\n").length).toBe(3);
			const outcomes = JSON.parse(apply.stdout).resources;
			expect(outcomes.find((r: { slug: string }) => r.slug === "one").reason).toBe("live-cwd");
			expect(outcomes.find((r: { slug: string }) => r.slug === "two").outcome).toBe("finished");
			expect(existsSync(join(fixture.worktrees, "one"))).toBe(true);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	}, 60000);
});

describe("inactive-session batch preview", () => {
	it("previews eligible, recent, dirty, live and excluded sessions without mutation", () => {
		const fixture = createRepositoryFixture();
		try {
			startManagedSession(fixture, "eligible");
			for (const slug of ["recent", "dirty", "live", "retained"]) {
				expect(runCli(fixture.checkout, [slug, "create"]).status).toBe(0);
			}
			for (const slug of ["eligible", "dirty", "live", "retained"]) backdateSession(fixture, slug);
			const livePath = sessionMetadataPath(fixture.checkout, "live");
			const liveMetadata = JSON.parse(readFileSync(livePath, "utf8"));
			liveMetadata.activeOperations = [{ id: "test-live", pid: process.pid, hostname: hostname(), startedAt: liveMetadata.createdAt }];
			writeFileSync(livePath, JSON.stringify(liveMetadata));
			writeFileSync(join(fixture.worktrees, "dirty", "WIP"), "keep me\n");
			const before = readFileSync(sessionMetadataPath(fixture.checkout, "eligible"), "utf8");
			const indexPath = git(join(fixture.worktrees, "eligible"), "rev-parse", "--git-path", "index");
			const indexBefore = readFileSync(indexPath).toString("hex");
			const args = ["batch", "finish", "--inactive-for", "7d", "--exclude", "retained", "--keep-branch", "--dry-run", "--json"];
			const preview = runCli(fixture.checkout, args);
			expect(preview.status).toBe(0);
			const result = JSON.parse(preview.stdout);
			expect(result.keepBranch).toBe(true);
			const outcomes = Object.fromEntries(result.resources.map((resource: { slug: string; reason: string }) => [resource.slug, resource.reason]));
			expect(outcomes.eligible).toBe("eligible");
			expect(outcomes.recent).toBe("recent-activity");
			expect(outcomes.dirty).toBe("dirty");
			expect(outcomes.live).toBe("live-operation");
			expect(outcomes.retained).toBe("excluded");
			expect(runCli(fixture.checkout, ["eligible", "status", "--json"]).status).toBe(0);
			expect(runCli(fixture.checkout, ["list", "--json"]).status).toBe(0);
			const polled = runCli(fixture.checkout, args);
			expect(polled.status).toBe(0);
			expect(JSON.parse(polled.stdout).resources.find((resource: { slug: string }) => resource.slug === "eligible").reason).toBe("eligible");
			expect(readFileSync(sessionMetadataPath(fixture.checkout, "eligible"), "utf8")).toBe(before);
			expect(readFileSync(indexPath).toString("hex")).toBe(indexBefore);
			for (const slug of ["eligible", "recent", "dirty", "live", "retained"]) {
				expect(existsSync(join(fixture.worktrees, slug))).toBe(true);
				expect(git(fixture.checkout, "branch", "--list", `agent/${slug}`)).toContain(`agent/${slug}`);
			}
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	}, 60000);

	it("observes unmanaged file and checkout activity and refuses ignored or uncertain evidence", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture, "external");
			backdateSession(fixture, "external");
			const args = ["batch", "finish", "--inactive-for", "7d", "--dry-run", "--json"];
			const reason = (env: Record<string, string> = {}) => {
				const result = runCli(fixture.checkout, args, env);
				expect(result.status).toBe(0);
				return JSON.parse(result.stdout).resources[0].reason;
			};
			expect(reason()).toBe("eligible");
			const now = new Date();
			utimesSync(join(worktree, "README.md"), now, now);
			expect(reason()).toBe("recent-activity");
			backdateSession(fixture, "external");
			git(worktree, "checkout", "--detach", "HEAD");
			git(worktree, "checkout", "agent/external");
			expect(reason()).toBe("recent-activity");
			mkdirSync(join(worktree, ".worktrees"));
			writeFileSync(join(worktree, ".worktrees", "ignored-notes"), "retain\n");
			expect(reason()).toBe("ignored-local-data");
			rmSync(join(worktree, ".worktrees"), { recursive: true });
			const path = sessionMetadataPath(fixture.checkout, "external");
			const metadata = JSON.parse(readFileSync(path, "utf8"));
			metadata.activeOperations = [{ id: "interrupted", pid: 2147483647, hostname: hostname(), startedAt: metadata.createdAt }];
			writeFileSync(path, JSON.stringify(metadata));
			const saved = readFileSync(path, "utf8");
			expect(reason()).toBe("uncertain-operation");
			expect(readFileSync(path, "utf8")).toBe(saved);
			metadata.activeOperations = [];
			writeFileSync(path, JSON.stringify(metadata));
			const bin = join(fixture.root, "no-lsof");
			mkdirSync(bin);
			writeFileSync(join(bin, "lsof"), "#!/bin/sh\nexit 1\n");
			chmodSync(join(bin, "lsof"), 0o755);
			expect(reason({ PATH: `${bin}:${process.env.PATH}` })).toBe("unknown-process-evidence");
			for (const tail of [[], ["--inactive-for", "0d"], ["--inactive-for", "7d", "--force"], ["--inactive-for", "7d"]]) {
				expect(runCli(fixture.checkout, ["batch", "finish", ...tail]).status).toBe(64);
			}
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	}, 60000);

	it("refuses a real unmanaged process with cwd in the selected worktree", () => {
		const fixture = createRepositoryFixture();
		let child: ReturnType<typeof spawn> | undefined;
		try {
			const { worktree } = startManagedSession(fixture, "occupied");
			backdateSession(fixture, "occupied");
			child = spawn("node", ["-e", "setInterval(() => {}, 1000)"], { cwd: worktree, stdio: "ignore" });
			const result = runCli(fixture.checkout, ["batch", "finish", "--inactive-for", "7d", "--dry-run", "--json"]);
			expect(result.status).toBe(0);
			expect(JSON.parse(result.stdout).resources[0].reason).toBe("live-cwd");
		} finally {
			child?.kill();
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("tracks meaningful managed work without treating status as activity", () => {
		const fixture = createRepositoryFixture();
		try {
			startManagedSession(fixture, "working");
			const path = sessionMetadataPath(fixture.checkout, "working");
			const metadata = JSON.parse(readFileSync(path, "utf8"));
			expect(Number.isFinite(Date.parse(metadata.lastWorkAt))).toBe(true);
			expect(metadata.activeOperations.length).toBe(0);
			const before = readFileSync(path, "utf8");
			expect(runCli(fixture.checkout, ["working", "status", "--json"]).status).toBe(0);
			expect(readFileSync(path, "utf8")).toBe(before);
			metadata.lastWorkAt = "2000-01-01T00:00:00Z";
			writeFileSync(path, JSON.stringify(metadata));
			expect(runCli(fixture.checkout, ["working", "launch"]).status).toBe(0);
			const after = JSON.parse(readFileSync(path, "utf8"));
			expect(Date.parse(after.lastWorkAt) > Date.parse(metadata.lastWorkAt)).toBe(true);
			expect(after.activeOperations.length).toBe(0);
			const bin = join(fixture.root, "fake-devenv");
			mkdirSync(bin);
			const observed = join(fixture.root, "activity-during-run");
			writeFileSync(join(bin, "devenv"), `#!/bin/sh\nnode -e 'const fs = require("node:fs"); const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); fs.writeFileSync(process.argv[2], String(m.activeOperations.length));' ${tomlString(path)} ${tomlString(observed)}\nexit 7\n`);
			chmodSync(join(bin, "devenv"), 0o755);
			const failed = runCli(fixture.checkout, ["working", "run", "any-command"], { PATH: `${bin}:${process.env.PATH}` });
			expect(failed.status).toBe(7);
			expect(readFileSync(observed, "utf8")).toBe("1");
			expect(JSON.parse(readFileSync(path, "utf8")).activeOperations.length).toBe(0);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});
});

describe("guarded inactive batch finish", () => {
	it("finishes only unchanged preview candidates, preserves branches and replays confirmed absence", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree: donePath } = startManagedSession(fixture, "done");
			commitSessionWork(donePath);
			const doneHead = git(donePath, "rev-parse", "HEAD");
			for (const slug of ["changed", "late", "dirty", "live", "retained"]) expect(runCli(fixture.checkout, [slug, "create"]).status).toBe(0);
			for (const slug of ["done", "changed", "dirty", "live", "retained"]) backdateSession(fixture, slug);
			writeFileSync(join(fixture.worktrees, "dirty", "WIP"), "keep\n");
			const livePath = sessionMetadataPath(fixture.checkout, "live");
			const live = JSON.parse(readFileSync(livePath, "utf8"));
			live.activeOperations = [{ id: "live", pid: process.pid, hostname: hostname(), startedAt: live.createdAt }];
			writeFileSync(livePath, JSON.stringify(live));
			const common = ["batch", "finish", "--inactive-for", "7d", "--exclude", "retained"];
			const preview = runCli(fixture.checkout, [...common, "--dry-run", "--json"]);
			expect(preview.status).toBe(0);
			const receipt = JSON.parse(preview.stdout).receipt;
			expect(typeof receipt).toBe("string");
			writeFileSync(join(fixture.worktrees, "changed", "new-work"), "preserve\n");
			backdateSession(fixture, "late");
			const bin = join(fixture.root, "guard-bin");
			mkdirSync(bin);
			const executable = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
			const removals = join(fixture.root, "removals");
			const unrelated = join(fixture.root, "unrelated-inspected");
			writeFileSync(join(bin, "git"), `#!/bin/sh\ncase "$PWD" in */late) printf blocked > ${tomlString(unrelated)}; exit 97;; esac\nif [ "$1 $2" = "worktree remove" ]; then printf '%s\\n' "$*" >> ${tomlString(removals)}; fi\nexec ${tomlString(executable)} "$@"\n`, { mode: 0o755 });
			const env = { PATH: `${bin}:${process.env.PATH}` };
			const args = [...common, "--expected", receipt, "--yes", "--json"];
			for (const invalid of [
				[...common, "--expected", receipt, "--json"],
				[...common, "--expected", `${receipt}x`, "--yes", "--json"],
				["batch", "finish", "--inactive-for", "8d", "--exclude", "retained", "--expected", receipt, "--yes", "--json"],
				["batch", "finish", "--inactive-for", "7d", "--expected", receipt, "--yes", "--json"],
			]) expect(runCli(fixture.checkout, invalid, env).status).toBe(64);
			const foreign = createRepositoryFixture();
			try {
				writeConfig(foreign.checkout, "/unused");
				expect(runCli(foreign.checkout, args).status).toBe(64);
			} finally { rmSync(foreign.root, { recursive: true, force: true }); }
			const apply = runCli(fixture.checkout, args, env);
			expect(apply.status).toBe(1);
			const result = JSON.parse(apply.stdout);
			expect(result.partial).toBe(true);
			expect(result.resources.length).toBe(2);
			const outcomes = Object.fromEntries(result.resources.map((resource: { slug: string; outcome: string }) => [resource.slug, resource.outcome]));
			expect(outcomes.done).toBe("finished");
			expect(outcomes.changed).toBe("refused");
			expect(existsSync(join(fixture.worktrees, "done"))).toBe(false);
			expect(git(fixture.checkout, "rev-parse", "agent/done")).toBe(doneHead);
			expect(readFileSync(join(fixture.worktrees, "changed", "new-work"), "utf8")).toBe("preserve\n");
			for (const slug of ["changed", "late", "dirty", "live", "retained"]) expect(existsSync(join(fixture.worktrees, slug))).toBe(true);
			for (const slug of ["done", "changed", "late", "dirty", "live", "retained"]) expect(git(fixture.checkout, "branch", "--list", `agent/${slug}`)).toContain(`agent/${slug}`);
			const replay = runCli(fixture.checkout, args, env);
			expect(replay.status).toBe(1);
			expect(JSON.parse(replay.stdout).resources.find((resource: { slug: string }) => resource.slug === "done").outcome).toBe("absent");
			expect(readFileSync(removals, "utf8").trim().split("\n").length).toBe(1);
			expect(existsSync(unrelated)).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	}, 120000);

	it("reconciles a process killed after native removal without repeating that effect", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture, "interrupted");
			backdateSession(fixture, "interrupted");
			const common = ["batch", "finish", "--inactive-for", "7d"];
			const receipt = JSON.parse(runCli(fixture.checkout, [...common, "--dry-run", "--json"]).stdout).receipt;
			const bin = join(fixture.root, "crash-bin"); mkdirSync(bin);
			const executable = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
			const removals = join(fixture.root, "removals");
			writeFileSync(join(bin, "git"), `#!/bin/sh\nif [ "$1 $2" = "worktree remove" ]; then printf attempted >> ${tomlString(removals)}; ${tomlString(executable)} "$@" || exit; kill -KILL "$PPID"; exit 0; fi\nexec ${tomlString(executable)} "$@"\n`, { mode: 0o755 });
			const env = { PATH: `${bin}:${process.env.PATH}` };
			const args = [...common, "--expected", receipt, "--yes", "--json"];
			const interrupted = runCli(fixture.checkout, args, env);
			expect(interrupted.signal).toBe("SIGKILL");
			expect(existsSync(worktree)).toBe(false);
			const recordPath = sessionMetadataPath(fixture.checkout, "interrupted");
			expect(existsSync(recordPath)).toBe(true);
			const saved = readFileSync(recordPath, "utf8");
			writeFileSync(recordPath, `${saved} `);
			const changed = runCli(fixture.checkout, args, env);
			expect(changed.status).toBe(1);
			expect(JSON.parse(changed.stdout).resources[0].outcome).toBe("refused");
			expect(readFileSync(recordPath, "utf8")).toBe(`${saved} `);
			writeFileSync(recordPath, saved);
			const replay = runCli(fixture.checkout, args, env);
			expect(replay.status).toBe(0);
			expect(JSON.parse(replay.stdout).resources[0].outcome).toBe("finished");
			expect(JSON.parse(replay.stdout).resources[0].reason).toBe("reconciled-removal");
			expect(readFileSync(removals, "utf8")).toBe("attempted");
			expect(git(fixture.checkout, "branch", "--list", "agent/interrupted")).toContain("agent/interrupted");
			expect(JSON.parse(runCli(fixture.checkout, args, env).stdout).resources[0].outcome).toBe("absent");
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	}, 60000);

	it("refuses uncertain partial removal and fresh native locks without force or pruning", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture, "uncertain");
			backdateSession(fixture, "uncertain");
			const common = ["batch", "finish", "--inactive-for", "7d"];
			const receipt = JSON.parse(runCli(fixture.checkout, [...common, "--dry-run", "--json"]).stdout).receipt;
			const args = [...common, "--expected", receipt, "--yes", "--json"];
			git(fixture.checkout, "worktree", "lock", worktree);
			const locked = runCli(fixture.checkout, args);
			expect(locked.status).toBe(1);
			expect(JSON.parse(locked.stdout).resources[0].reason).toBe("worktree-locked");
			git(fixture.checkout, "worktree", "unlock", worktree);
			const bin = join(fixture.root, "fail-bin"); mkdirSync(bin);
			const executable = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
			const removals = join(fixture.root, "removals");
			writeFileSync(join(bin, "git"), `#!/bin/sh\nif [ "$1 $2" = "worktree remove" ]; then printf attempted >> ${tomlString(removals)}; echo 'native failure' >&2; exit 1; fi\nexec ${tomlString(executable)} "$@"\n`, { mode: 0o755 });
			const env = { PATH: `${bin}:${process.env.PATH}` };
			const failure = runCli(fixture.checkout, args, env);
			expect(failure.status).toBe(1);
			expect(JSON.parse(failure.stdout).resources[0].outcome).toBe("uncertain");
			rmSync(worktree, { recursive: true });
			const replay = runCli(fixture.checkout, args, env);
			expect(replay.status).toBe(1);
			expect(JSON.parse(replay.stdout).resources[0].outcome).toBe("refused");
			expect(readFileSync(removals, "utf8")).toBe("attempted");
			expect(git(fixture.checkout, "worktree", "list", "--porcelain")).toContain(worktree);
			expect(existsSync(sessionMetadataPath(fixture.checkout, "uncertain"))).toBe(true);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	}, 60000);

	it("rechecks new live activity and ignored data rather than trusting eligibility alone", () => {
		const fixture = createRepositoryFixture();
		try {
			startManagedSession(fixture, "live-after-preview");
			expect(runCli(fixture.checkout, ["ignored-after-preview", "create"]).status).toBe(0);
			for (const slug of ["live-after-preview", "ignored-after-preview"]) backdateSession(fixture, slug);
			const common = ["batch", "finish", "--inactive-for", "7d"];
			const receipt = JSON.parse(runCli(fixture.checkout, [...common, "--dry-run", "--json"]).stdout).receipt;
			const path = sessionMetadataPath(fixture.checkout, "live-after-preview");
			const metadata = JSON.parse(readFileSync(path, "utf8"));
			metadata.activeOperations = [{ id: "new-live", pid: process.pid, hostname: hostname(), startedAt: new Date().toISOString() }];
			writeFileSync(path, JSON.stringify(metadata));
			const ignored = join(fixture.worktrees, "ignored-after-preview", ".worktrees");
			mkdirSync(ignored); writeFileSync(join(ignored, "notes"), "retain\n");
			const result = runCli(fixture.checkout, [...common, "--expected", receipt, "--yes", "--json"]);
			expect(result.status).toBe(1);
			const reasons = Object.fromEntries(JSON.parse(result.stdout).resources.map((resource: { slug: string; reason: string }) => [resource.slug, resource.reason]));
			expect(reasons["live-after-preview"]).toBe("live-operation");
			expect(reasons["ignored-after-preview"]).toBe("ignored-local-data");
			for (const slug of ["live-after-preview", "ignored-after-preview"]) expect(existsSync(join(fixture.worktrees, slug))).toBe(true);
			expect(existsSync(join(fixture.checkout, ".git", "agent-session", "retirements"))).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	}, 60000);

	it("does not infer unique ownership or absence from a directory-name convention", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture, "selected");
			const aliasPath = sessionMetadataPath(fixture.checkout, "alias");
			const metadata = JSON.parse(readFileSync(sessionMetadataPath(fixture.checkout, "selected"), "utf8"));
			writeFileSync(aliasPath, JSON.stringify({ ...metadata, slug: "alias", branch: "agent/alias" }));
			const inspect = () => JSON.parse(runCli(fixture.checkout, ["status", "--worktree", worktree, "--json"]).stdout);
			expect(inspect().resourceState).toBe("inconsistent");
			git(fixture.checkout, "worktree", "remove", worktree);
			rmSync(sessionMetadataPath(fixture.checkout, "selected"));
			expect(inspect().resourceState).toBe("inconsistent");
			rmSync(aliasPath);
			writeFileSync(aliasPath, "{malformed");
			expect(inspect().resourceState).toBe("unknown");
			rmSync(aliasPath);
			expect(inspect().resourceState).toBe("absent");
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});
});

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

function createPullRequestFixture() {
	const fixture = createRepositoryFixture("agent-session-pr-");
	const branch = "review/auth";
	git(fixture.seed, "checkout", "-b", branch);
	commitSessionWork(fixture.seed);
	const head = git(fixture.seed, "rev-parse", "HEAD");
	git(fixture.seed, "push", "origin", branch, "HEAD:refs/pull/123/head");
	const repositoryUrl = "https://github.com/fixture/repo.git";
	// A GitHub identity with entirely local transport; no network or credentials.
	git(fixture.checkout, "config", `url.${fixture.remote}.insteadOf`, repositoryUrl);
	git(fixture.checkout, "remote", "set-url", "origin", repositoryUrl);
	git(fixture.checkout, "config", "push.default", "simple");
	const bin = installFixtureCLI(fixture);
	const ghLog = join(fixture.root, "gh-calls");
	const responsePath = join(fixture.root, "pr.json");
	const response = {
		number: 123, url: "https://github.com/fixture/repo/pull/123",
		state: "OPEN", isDraft: false, baseRefName: "master",
		headRefName: branch, headRefOid: head, isCrossRepository: false,
		headRepository: { name: "repo" }, headRepositoryOwner: { login: "fixture" },
	};
	writeFileSync(responsePath, JSON.stringify(response));
	writeFileSync(join(bin, "gh"), `#!/usr/bin/env node
import fs from 'node:fs';
fs.appendFileSync(${JSON.stringify(ghLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.env.FAKE_GH_FAILURE) { console.error(process.env.FAKE_GH_MESSAGE ?? 'gh: authentication required; run gh auth login'); process.exit(Number(process.env.FAKE_GH_EXIT ?? 1)); }
process.stdout.write(fs.readFileSync(${JSON.stringify(responsePath)}, 'utf8'));
`);
	chmodSync(join(bin, "gh"), 0o755);
	const agentLog = join(fixture.root, "agent-cwd");
	const prepareLog = join(fixture.root, "prepared");
	const agent = createFakeAgent(fixture.root, agentLog);
	writeConfig(fixture.checkout, agent, ["sh", "-c", `printf prepared > ${tomlString(prepareLog)}`]);
	const environment = { PATH: `${bin}:${process.env.PATH ?? ""}` };
	return { ...fixture, branch, head, response, responsePath, ghLog, agentLog, prepareLog, environment };
}

describe("metadata-only inventory", () => {
	it("lists bindings without inspecting unrelated checkouts, then inspects only the named target", () => {
		const fixture = createRepositoryFixture("agent-inventory-");
		try {
			const { worktree } = startManagedSession(fixture, "target");
			expect(runCli(fixture.checkout, ["unrelated", "create"]).status).toBe(0);
			git(worktree, "switch", "-c", "renamed-target");
			const metadataDirectory = join(fixture.checkout, ".git/agent-session/sessions");
			const before = readFileSync(join(metadataDirectory, "target.json"), "utf8");
			const registrations = git(fixture.checkout, "worktree", "list", "--porcelain");
			const bin = join(fixture.root, "guard-bin");
			mkdirSync(bin);
			const executable = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
			const marker = join(fixture.root, "unrelated-inspected");
			writeFileSync(join(bin, "git"), `#!/bin/sh\nif [ "$PWD" = ${tomlString(join(realpathSync(fixture.worktrees), "unrelated"))} ]; then printf blocked > ${tomlString(marker)}; exit 91; fi\nexec ${tomlString(executable)} "$@"\n`, { mode: 0o755 });
			const environment = { PATH: `${bin}:${process.env.PATH}` };
			const result = runCli(fixture.checkout, ["list", "--json"], environment);
			expect(result.status).toBe(0);
			const inventory = JSON.parse(result.stdout);
			expect(inventory.version).toBe(1);
			expect(inventory.command).toBe("list");
			expect(inventory.sessions.length).toBe(2);
			const target = inventory.sessions.find((s: { slug: string }) => s.slug === "target");
			expect(target.slug).toBe("target");
			expect(target.branch).toBe("agent/target");
			expect(target.worktreePath).toBe(worktree);
			expect(Object.keys(target).sort().join(",")).toBe("branch,slug,worktreePath");
			const selected = runCli(fixture.checkout, [target.slug, "status", "--json"], environment);
			expect(selected.status).toBe(0);
			expect(JSON.parse(selected.stdout).sessions[0].branch).toBe("renamed-target");
			expect(existsSync(marker)).toBe(false);
			expect(readFileSync(join(metadataDirectory, "target.json"), "utf8")).toBe(before);
			expect(git(fixture.checkout, "worktree", "list", "--porcelain")).toBe(registrations);
			expect(runCli(fixture.checkout, ["list"], environment).stdout).toContain("target");
			expect(runCli(fixture.checkout, ["list", "--refresh"], environment).status).toBe(64);
			expect(runCli(fixture.checkout, ["target", "list"], environment).status).toBe(64);
			expect(runCli(fixture.checkout, ["__complete", "targets"]).stdout).toContain("list");
			expect(runCli(fixture.checkout, ["__complete", "options:global-list"]).stdout).toContain("--json");
			const preview = runCli(fixture.checkout, [target.slug, "finish", "--keep-branch", "--dry-run", "--json"], environment);
			expect(preview.status).toBe(0);
			const receipt = JSON.parse(preview.stdout).plan.receipt;
			const finished = runCli(fixture.checkout, [target.slug, "finish", "--keep-branch", "--expected", receipt, "--yes"], environment);
			expect(finished.status).toBe(0);
			expect(existsSync(worktree)).toBe(false);
			expect(git(fixture.checkout, "branch", "--list", "renamed-target")).toContain("renamed-target");
			expect(existsSync(join(fixture.worktrees, "unrelated"))).toBe(true);
			expect(existsSync(marker)).toBe(false);
			const remaining = JSON.parse(runCli(fixture.checkout, ["list", "--json"], environment).stdout);
			expect(remaining.sessions.length).toBe(1);
			expect(remaining.sessions[0].slug).toBe("unrelated");
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("does not rediscover the Git namespace for every inventory record", () => {
		const fixture = createRepositoryFixture("agent-inventory-scale-");
		try {
			writeConfig(fixture.checkout, "/unused");
			const store = join(fixture.checkout, ".git/agent-session/sessions"), bin = join(fixture.root, "bin"), log = join(fixture.root, "git-calls");
			mkdirSync(store, { recursive: true }); mkdirSync(bin);
			const executable = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
			writeFileSync(join(bin, "git"), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${tomlString(log)}\nexec ${tomlString(executable)} "$@"\n`, { mode: 0o755 });
			const populate = (count: number) => {
				for (let index = 0; index < count; index++) {
					const slug = `inventory-${index}`;
					writeFileSync(join(store, `${slug}.json`), JSON.stringify({ version: 1, slug, branch: `agent/${slug}`, worktreePath: join(fixture.worktrees, slug), remote: "origin", defaultBranch: "master", createdAt: "2026-10-26T00:00:00Z", conversation: null }));
				}
			};
			const measure = (count: number) => {
				populate(count); writeFileSync(log, "");
				const result = runCli(fixture.checkout, ["list", "--json"], { PATH: `${bin}:${process.env.PATH}` });
				expect(result.status).toBe(0);
				expect(JSON.parse(result.stdout).sessions.length).toBe(count);
				return readFileSync(log, "utf8").trim().split("\n").length;
			};
			const small = measure(2), large = measure(50);
			expect(large).toBe(small);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("does not misreport invalid or dangling metadata as an empty complete inventory", () => {
		const fixture = createRepositoryFixture("agent-inventory-invalid-");
		try {
			writeConfig(fixture.checkout, "/unused");
			expect(runCli(fixture.checkout, ["list", "--json"]).status).toBe(0);
			const store = join(fixture.checkout, ".git/agent-session/sessions");
			mkdirSync(store, { recursive: true });
			writeFileSync(join(store, "broken.json"), "{invalid");
			const broken = runCli(fixture.checkout, ["list", "--json"]);
			expect(broken.status).toBe(1);
			expect(broken.stdout).toBe("");
			rmSync(store, { recursive: true });
			symlinkSync(join(fixture.root, "missing-store"), store);
			const dangling = runCli(fixture.checkout, ["list", "--json"]);
			expect(dangling.status).toBe(1);
			expect(dangling.stdout).toBe("");
			expect(lstatSync(store).isSymbolicLink()).toBe(true);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});
});

describe("PR review session creation", () => {
	it("creates the exact PR source head with push tracking, metadata and a clean receipt (AC-1, AC-4)", () => {
		const fixture = createPullRequestFixture();
		try {
			const result = runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--trust-pr", "--json"], fixture.environment);
			expect(result.status).toBe(0);
			const receipt = JSON.parse(result.stdout);
			expect(receipt.command).toBe("create");
			expect(receipt.dryRun).toBe(false);
			expect(receipt.session.branch).toBe(fixture.branch);
			expect(receipt.session.pr.number).toBe(123);
			expect(receipt.session.pr.url).toBe(fixture.response.url);
			expect(receipt.session.pr.baseBranch).toBe("master");
			expect(receipt.session.pr.headCommit).toBe(fixture.head);
			expect(receipt.session.pr.trustedHeadCommit).toBe(fixture.head);
			const worktree = receipt.session.worktreePath;
			expect(git(worktree, "rev-parse", "HEAD")).toBe(fixture.head);
			expect(git(worktree, "branch", "--show-current")).toBe(fixture.branch);
			expect(git(worktree, "rev-parse", "--abbrev-ref", "@{upstream}")).toBe(`origin/${fixture.branch}`);
			expect(git(worktree, "config", `branch.${fixture.branch}.pushRemote`)).toBe("origin");
			expect(existsSync(fixture.agentLog)).toBe(false);
			expect(readFileSync(fixture.prepareLog, "utf8")).toBe("prepared");
			const status = runCli(worktree, [".", "status", "--json"], fixture.environment);
			expect(status.status).toBe(0);
			expect(JSON.parse(status.stdout).sessions[0].publication).toBe("published");
			const ghCalls = readFileSync(fixture.ghLog, "utf8").trim().split("\n").map((line) => JSON.parse(line));
			expect(ghCalls.length).toBe(1);
			expect(ghCalls[0].slice(0, 5).join(" ")).toBe("pr view 123 --repo https://github.com/fixture/repo");
			expect(git(fixture.remote, "rev-parse", `refs/heads/${fixture.branch}`)).toBe(fixture.head);
			for (const line of result.stderr.trim().split("\n")) expect(JSON.parse(line).type).toBe("progress");
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	for (const [answer, slotAppears] of [["yes\n", false], ["no\n", false], ["\n", false], ["EOF", false], ["yes\n", true]] as const) {
		it(`requires commit-specific terminal consent before PR execution: ${JSON.stringify(answer)}, slotAppears=${slotAppears} (AC-11)`, () => {
			const fixture = createPullRequestFixture();
			try {
				const driver = `
import errno, json, os, pty, select, subprocess, sys, time
master, slave = pty.openpty()
child = subprocess.Popen(json.loads(sys.argv[1]), stdin=slave, stderr=slave, stdout=subprocess.PIPE)
os.close(slave)
output = b''
answered = False
safe_before_consent = False
lock_held = False
try:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.05)[0]:
            try:
                chunk = os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not chunk:
                break
            output += chunk
            if b'[y/N]' in output and not answered:
                with open(sys.argv[3]) as owner:
                    lock_held = json.load(owner).get('pid') == child.pid
                safe_before_consent = not any(os.path.exists(path) for path in sys.argv[4:8])
                if sys.argv[8] == 'true':
                    os.mkdir(sys.argv[6])
                os.write(master, b'\\x04' if sys.argv[2] == 'EOF' else sys.argv[2].encode())
                answered = True
        elif child.poll() is not None:
            break
    else:
        raise TimeoutError('PR trust confirmation did not complete')
    stdout, _ = child.communicate(timeout=5)
    print(json.dumps({'status': child.returncode, 'output': output.decode(errors='replace'),
                      'stdout': stdout.decode(), 'answered': answered,
                      'safeBeforeConsent': safe_before_consent, 'lockHeld': lock_held}))
finally:
    if child.poll() is None:
        child.kill()
        child.wait()
    os.close(master)
`;
				const worktree = join(fixture.worktrees, "review-auth");
				const metadata = sessionMetadataPath(fixture.checkout, "review-auth");
				const result = spawnSync("python3", ["-c", driver,
					JSON.stringify(["node", cliScript, "review-auth", "create", "--pr", "123", "--json"]), answer,
					join(fixture.checkout, ".git", "agent-session", "operation.lock", "owner.json"),
					fixture.prepareLog, fixture.agentLog, worktree, metadata, String(slotAppears),
				], { cwd: fixture.checkout, encoding: "utf8", env: { ...process.env, ...fixture.environment, AGENT_SESSION_CONFIG: runtimeConfigPath(fixture.checkout) } });
				expect(result.status).toBe(0);
				const terminal = JSON.parse(result.stdout);
				expect(terminal.answered).toBe(true);
				expect(terminal.safeBeforeConsent).toBe(true);
				expect(terminal.lockHeld).toBe(true);
				expect(terminal.output).toContain(fixture.response.url);
				expect(terminal.output).toContain(fixture.head);
				const accepted = answer === "yes\n" && !slotAppears;
				expect(terminal.status).toBe(accepted ? 0 : 1);
				expect(existsSync(fixture.prepareLog)).toBe(accepted);
				expect(existsSync(worktree)).toBe(accepted || slotAppears);
				expect(existsSync(metadata)).toBe(accepted);
				expect(existsSync(fixture.agentLog)).toBe(false);
				if (accepted) {
					expect(JSON.parse(terminal.stdout).session.pr.trustedHeadCommit).toBe(fixture.head);
					expect(git(worktree, "rev-parse", "HEAD")).toBe(fixture.head);
				} else {
					expect(terminal.stdout).toBe("");
					expect(terminal.output).toContain(slotAppears ? "changed" : "cancelled");
					expect(git(fixture.checkout, "branch", "--list", fixture.branch)).toBe("");
				}
			} finally { rmSync(fixture.root, { recursive: true, force: true }); }
		});
	}

	it("previews an unresolved PR offline without trust, GitHub, remote queries, or mutations (AC-15)", () => {
		const fixture = createPullRequestFixture();
		try {
			const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8", env: process.env }).stdout.trim();
			const gitLog = join(fixture.root, "network-attempts");
			const bin = join(fixture.root, "bin");
			writeFileSync(join(bin, "git"), `#!/usr/bin/env bash
for arg in "$@"; do
  case "$arg" in fetch|ls-remote|push) printf '%s\\n' "$*" >> ${tomlString(gitLog)}; exit 91 ;; esac
done
exec ${tomlString(realGit)} "$@"
`);
			chmodSync(join(bin, "git"), 0o755);
			const before = {
				index: readFileSync(join(fixture.checkout, ".git", "index")).toString("hex"),
				config: readFileSync(join(fixture.checkout, ".git", "config"), "utf8"),
			};
			const newer = new Date(Date.now() + 5000);
			utimesSync(join(fixture.checkout, "README.md"), newer, newer);
			// This unrelated branch must not collide with an unresolved PR branch.
			git(fixture.checkout, "branch", "agent/review-auth");
			const refs = git(fixture.checkout, "show-ref");
			for (const flags of [["--json"], ["--json", "--trust-pr"], []]) {
				const result = runCli(fixture.checkout, ["review-auth", "create", "--pr", "987", "--dry-run", ...flags], { ...fixture.environment, FAKE_GH_FAILURE: "1" });
				expect(result.status).toBe(0);
				if (flags.includes("--json")) {
					const preview = JSON.parse(result.stdout);
					expect(preview.dryRun).toBe(true);
					expect(preview.plan.pr.number).toBe(987);
					expect(preview.plan.pr.resolved).toBe(false);
					expect(preview.plan.pr.url).toBe(null);
					expect(preview.plan.pr.headCommit).toBe(null);
					expect(preview.plan.branch).toBe(null);
					expect(preview.plan.base).toBe(null);
					expect(preview.plan.agentLaunch).toBe(false);
				} else {
					expect(result.stdout).toContain("987");
					expect(result.stdout).toContain("unresolved");
				}
			}
			expect(existsSync(fixture.ghLog)).toBe(false);
			expect(existsSync(gitLog)).toBe(false);
			expect(existsSync(fixture.prepareLog)).toBe(false);
			expect(existsSync(fixture.worktrees)).toBe(false);
			expect(existsSync(join(fixture.checkout, ".git", "agent-session"))).toBe(false);
			expect(git(fixture.checkout, "show-ref")).toBe(refs);
			expect(readFileSync(join(fixture.checkout, ".git", "index")).toString("hex")).toBe(before.index);
			expect(readFileSync(join(fixture.checkout, ".git", "config"), "utf8")).toBe(before.config);
			git(fixture.checkout, "symbolic-ref", "--delete", "refs/remotes/origin/HEAD");
			const uncached = runCli(fixture.checkout, ["review-auth", "create", "--pr", "987", "--dry-run", "--json"], fixture.environment);
			expect(uncached.status).toBe(1);
			expect(uncached.stderr).toContain("No cached default branch");
			expect(existsSync(gitLog)).toBe(false);
			expect(existsSync(fixture.ghLog)).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	for (const flags of [[], ["-c"]]) {
		it(`accepts a draft PR without changing its readiness: ${flags.length ? "independent" : "review"} (AC-12)`, () => {
			const fixture = createPullRequestFixture();
			try {
				const draft = JSON.stringify({ ...fixture.response, isDraft: true });
				writeFileSync(fixture.responsePath, draft);
				const args = ["draft-check", "create", "--pr", "123", ...flags, "--trust-pr"];
				const created = runCli(fixture.checkout, [...args, "--json"], fixture.environment);
				expect(created.status).toBe(0);
				const metadata = JSON.parse(created.stdout).session;
				expect(metadata.pr.isDraft).toBe(true);
				expect(metadata.pr.state).toBe("OPEN");
				expect(git(metadata.worktreePath, "rev-parse", "HEAD")).toBe(fixture.head);
				expect(runCli(fixture.checkout, args, fixture.environment).stdout).toContain("DRAFT");
				expect(readFileSync(fixture.responsePath, "utf8")).toBe(draft);
				const calls = readFileSync(fixture.ghLog, "utf8").trim().split("\n").map((line) => JSON.parse(line));
				expect(calls.length).toBe(1);
				expect(calls[0].slice(0, 2).join(" ")).toBe("pr view");
				expect(existsSync(fixture.agentLog)).toBe(false);
			} finally { rmSync(fixture.root, { recursive: true, force: true }); }
		});
	}

	it("cleans up its own published local branch without deleting the remote PR branch", () => {
		const fixture = createPullRequestFixture();
		try {
			expect(runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--trust-pr"], fixture.environment).status).toBe(0);
			const finished = runCli(fixture.checkout, ["review-auth", "finish", "--yes"], fixture.environment);
			expect(finished.status).toBe(0);
			expect(existsSync(join(fixture.worktrees, "review-auth"))).toBe(false);
			expect(existsSync(sessionMetadataPath(fixture.checkout, "review-auth"))).toBe(false);
			expect(git(fixture.checkout, "branch", "--list", fixture.branch)).toBe("");
			expect(git(fixture.remote, "rev-parse", `refs/heads/${fixture.branch}`)).toBe(fixture.head);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("refuses normal cleanup of unpushed review fixes", () => {
		const fixture = createPullRequestFixture();
		try {
			expect(runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--trust-pr"], fixture.environment).status).toBe(0);
			const worktree = join(fixture.worktrees, "review-auth");
			writeFileSync(join(worktree, "fix.txt"), "review fix\n");
			git(worktree, "add", "fix.txt");
			git(worktree, "-c", "user.name=Review", "-c", "user.email=review@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "Review fix");
			const finished = runCli(fixture.checkout, ["review-auth", "finish", "--yes"], fixture.environment);
			expect(finished.status).toBe(1);
			expect(finished.stderr).toContain("unpushed commits");
			expect(existsSync(worktree)).toBe(true);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("rolls back only newly created session assets when PR preparation fails (AC-19)", () => {
		const fixture = createPullRequestFixture();
		try {
			writeConfig(fixture.checkout, "unused-agent", ["sh", "-c", "echo PR-prepare-failed >&2; exit 7"]);
			git(fixture.checkout, "branch", "keep-me");
			const result = runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--trust-pr", "--json"], fixture.environment);
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("PR-prepare-failed");
			expect(result.stdout).toBe("");
			expect(existsSync(join(fixture.worktrees, "review-auth"))).toBe(false);
			expect(existsSync(sessionMetadataPath(fixture.checkout, "review-auth"))).toBe(false);
			expect(git(fixture.checkout, "branch", "--list", fixture.branch)).toBe("");
			expect(git(fixture.checkout, "rev-parse", "keep-me")).toBe(git(fixture.checkout, "rev-parse", "master"));
			expect(git(fixture.remote, "rev-parse", `refs/heads/${fixture.branch}`)).toBe(fixture.head);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("preserves a dangling session record instead of overwriting it during PR creation", () => {
		const fixture = createPullRequestFixture();
		try {
			const state = sessionMetadataPath(fixture.checkout, "review-auth");
			mkdirSync(join(fixture.checkout, ".git", "agent-session", "sessions"), { recursive: true });
			const missing = join(fixture.root, "missing-session-record");
			symlinkSync(missing, state);
			const result = runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--trust-pr"], fixture.environment);
			expect(result.status).toBe(1);
			expect(readlinkSync(state)).toBe(missing);
			expect(existsSync(fixture.prepareLog)).toBe(false);
			expect(existsSync(join(fixture.worktrees, "review-auth"))).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("does not execute PR code without explicit trust", () => {
		const fixture = createPullRequestFixture();
		try {
			const result = runCli(fixture.checkout, ["review-auth", "create", "--pr", "123"], fixture.environment);
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("--trust-pr");
			expect(existsSync(fixture.prepareLog)).toBe(false);
			expect(existsSync(fixture.agentLog)).toBe(false);
			expect(existsSync(sessionMetadataPath(fixture.checkout, "review-auth"))).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("refuses preexisting local branches that differ from the resolved PR head", () => {
		const fixture = createPullRequestFixture();
		try {
			git(fixture.checkout, "branch", fixture.branch);
			const before = git(fixture.checkout, "rev-parse", fixture.branch);
			const result = runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--trust-pr"], fixture.environment);
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("preexisting local branch");
			expect(git(fixture.checkout, "rev-parse", fixture.branch)).toBe(before);
			expect(existsSync(fixture.prepareLog)).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("identifies a PR branch already checked out elsewhere without moving it (AC-9)", () => {
		const fixture = createPullRequestFixture();
		try {
			const other = join(fixture.root, "other-review");
			git(fixture.checkout, "worktree", "add", "-b", fixture.branch, other);
			const before = git(other, "rev-parse", "HEAD");
			const result = runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--trust-pr"], fixture.environment);
			expect(result.status).toBe(1);
			expect(result.stderr).toContain(other);
			expect(git(other, "rev-parse", "HEAD")).toBe(before);
			expect(existsSync(fixture.prepareLog)).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("reports GitHub authentication failure without allocation or execution (AC-20)", () => {
		const fixture = createPullRequestFixture();
		try {
			const result = runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--trust-pr", "--json"], { ...fixture.environment, FAKE_GH_FAILURE: "1" });
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("gh auth login");
			expect(result.stdout).toBe("");
			expect(existsSync(join(fixture.worktrees, "review-auth"))).toBe(false);
			expect(existsSync(fixture.prepareLog)).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("rejects a changed PR head between resolution and fetch before preparation", () => {
		const fixture = createPullRequestFixture();
		try {
			writeFileSync(fixture.responsePath, JSON.stringify({ ...fixture.response, headRefOid: git(fixture.checkout, "rev-parse", "master") }));
			const result = runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--trust-pr"], fixture.environment);
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("PR head changed");
			expect(existsSync(fixture.prepareLog)).toBe(false);
			expect(existsSync(sessionMetadataPath(fixture.checkout, "review-auth"))).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

});

function createForkPullRequestFixture() {
	const fixture = createPullRequestFixture();
	const fork = join(fixture.root, "fork.git");
	git(fixture.root, "clone", "--bare", fixture.remote, fork);
	const forkUrl = "https://github.com/contributor/repo.git";
	git(fixture.checkout, "config", `url.${fork}.insteadOf`, forkUrl);
	// Only the fork owns the source branch; the base retains the PR ref.
	git(fixture.remote, "update-ref", "-d", `refs/heads/${fixture.branch}`);
	writeFileSync(fixture.responsePath, JSON.stringify({ ...fixture.response,
		isCrossRepository: true, headRepositoryOwner: { login: "contributor" } }));
	const reject = join(fork, "hooks", "pre-receive");
	writeFileSync(reject, "#!/usr/bin/env bash\necho 'fork push denied' >&2\nexit 1\n");
	chmodSync(reject, 0o755);
	return { ...fixture, fork, forkUrl };
}

describe("PR URLs and fork sources", () => {
	it("resolves number and URL to the same canonical PR identity (AC-2)", () => {
		const fixture = createPullRequestFixture();
		try {
			const numbered = runCli(fixture.checkout, ["number-review", "create", "--pr", "123", "--trust-pr", "--json"], fixture.environment);
			expect(numbered.status).toBe(0);
			expect(runCli(fixture.checkout, ["number-review", "finish", "--yes"], fixture.environment).status).toBe(0);
			const byUrl = runCli(fixture.checkout, ["url-review", "create", "--pr", "https://github.com/FIXTURE/REPO/pull/123", "--trust-pr", "--json"], fixture.environment);
			expect(byUrl.status).toBe(0);
			expect(JSON.stringify(JSON.parse(byUrl.stdout).session.pr)).toBe(JSON.stringify(JSON.parse(numbered.stdout).session.pr));
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("rejects foreign-target URLs without GitHub lookup or session allocation (AC-13)", () => {
		const fixture = createPullRequestFixture();
		try {
			for (const flags of [["--trust-pr"], ["--dry-run"]]) {
				const result = runCli(fixture.checkout, ["foreign", "create", "--pr", "https://github.com/other/repo/pull/123", ...flags], fixture.environment);
				expect(result.status).toBe(1);
				expect(result.stderr).toContain("different repository");
			}
			expect(existsSync(fixture.ghLog)).toBe(false);
			expect(existsSync(fixture.worktrees)).toBe(false);
			expect(existsSync(fixture.prepareLog)).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("checks out a read-only fork and targets plain git push at its source, never the base (AC-3, AC-4)", () => {
		const fixture = createForkPullRequestFixture();
		try {
			const baseRefs = git(fixture.remote, "show-ref");
			const result = runCli(fixture.checkout, ["review-auth", "create", "--pr", fixture.response.url, "--trust-pr", "--json"], fixture.environment);
			expect(result.status).toBe(0);
			const metadata = JSON.parse(result.stdout).session;
			expect(metadata.pr.sourceRepository).toBe("contributor/repo");
			const source = metadata.pr.sourceRemote;
			expect(git(fixture.checkout, "config", `remote.${source}.url`)).toBe(fixture.forkUrl);
			expect(git(metadata.worktreePath, "rev-parse", "HEAD")).toBe(fixture.head);
			expect(git(metadata.worktreePath, "rev-parse", "--abbrev-ref", "@{push}")).toBe(`${source}/${fixture.branch}`);
			expect(git(metadata.worktreePath, "config", `branch.${fixture.branch}.pushRemote`)).toBe(source);
			writeFileSync(join(metadata.worktreePath, "fix.txt"), "review fix\n");
			git(metadata.worktreePath, "add", "fix.txt");
			git(metadata.worktreePath, "-c", "user.name=Review", "-c", "user.email=review@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "Review fix");
			const pushed = spawnSync("git", ["push"], { cwd: metadata.worktreePath, encoding: "utf8", env: process.env });
			expect(pushed.status).toBe(1);
			expect(pushed.stderr).toContain("fork push denied");
			expect(git(fixture.fork, "rev-parse", `refs/heads/${fixture.branch}`)).toBe(fixture.head);
			expect(git(fixture.remote, "show-ref")).toBe(baseRefs);
			expect(existsSync(fixture.agentLog)).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("refreshes fork publication and cleans only local session assets", () => {
		const fixture = createForkPullRequestFixture();
		try {
			const result = runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--trust-pr", "--json"], fixture.environment);
			expect(result.status).toBe(0);
			const metadata = JSON.parse(result.stdout).session;
			writeFileSync(join(fixture.seed, "next.txt"), "next\n");
			git(fixture.seed, "add", "next.txt");
			git(fixture.seed, "-c", "commit.gpgsign=false", "commit", "-m", "Advance fork");
			git(fixture.fork, "fetch", fixture.seed, fixture.branch);
			git(fixture.fork, "update-ref", `refs/heads/${fixture.branch}`, "FETCH_HEAD");
			const stale = runCli(fixture.checkout, ["review-auth", "status", "--json"], fixture.environment);
			expect(JSON.parse(stale.stdout).sessions[0].publication).toBe("published");
			const refreshed = runCli(fixture.checkout, ["review-auth", "status", "--refresh", "--json"], fixture.environment);
			expect(refreshed.status).toBe(0);
			expect(JSON.parse(refreshed.stdout).sessions[0].publication).toBe("behind");
			expect(runCli(fixture.checkout, ["review-auth", "finish", "--yes"], fixture.environment).status).toBe(0);
			expect(existsSync(metadata.worktreePath)).toBe(false);
			expect(git(fixture.fork, "rev-parse", `refs/heads/${fixture.branch}`)).toBe(git(fixture.seed, "rev-parse", "HEAD"));
			expect(git(fixture.checkout, "remote")).toContain(metadata.pr.sourceRemote);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("rolls back a newly allocated fork remote when preparation fails", () => {
		const fixture = createForkPullRequestFixture();
		try {
			writeConfig(fixture.checkout, "unused", ["sh", "-c", "exit 7"]);
			const before = readFileSync(join(fixture.checkout, ".git", "config"), "utf8");
			const result = runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--trust-pr", "--json"], fixture.environment);
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("Configured command exited with status 7");
			expect(result.stdout).toBe("");
			expect(readFileSync(join(fixture.checkout, ".git", "config"), "utf8")).toBe(before);
			expect(git(fixture.checkout, "branch", "--list", fixture.branch)).toBe("");
			expect(existsSync(join(fixture.worktrees, "review-auth"))).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("preserves a matching preexisting fork remote during rollback", () => {
		const fixture = createForkPullRequestFixture();
		try {
			git(fixture.checkout, "remote", "add", "contributor", fixture.forkUrl);
			writeConfig(fixture.checkout, "unused", ["sh", "-c", "exit 7"]);
			const before = readFileSync(join(fixture.checkout, ".git", "config"), "utf8");
			const result = runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--trust-pr", "--json"], fixture.environment);
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("Configured command exited with status 7");
			expect(readFileSync(join(fixture.checkout, ".git", "config"), "utf8")).toBe(before);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("refuses a fork fetch mapping that would push review fixes to another branch", () => {
		const fixture = createForkPullRequestFixture();
		try {
			git(fixture.fork, "update-ref", "refs/heads/master", fixture.head);
			git(fixture.checkout, "remote", "add", "contributor", fixture.forkUrl);
			git(fixture.checkout, "config", "remote.contributor.fetch", `+refs/heads/master:refs/remotes/contributor/${fixture.branch}`);
			git(fixture.checkout, "config", "push.default", "upstream");
			const before = readFileSync(join(fixture.checkout, ".git", "config"), "utf8");
			const result = runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--trust-pr"], fixture.environment);
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("source tracking");
			expect(readFileSync(join(fixture.checkout, ".git", "config"), "utf8")).toBe(before);
			expect(existsSync(fixture.prepareLog)).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("preserves preexisting refs in a proposed fork remote namespace", () => {
		const fixture = createForkPullRequestFixture();
		try {
			const savedRef = "refs/remotes/as-pr-review-auth/private-work";
			git(fixture.checkout, "update-ref", savedRef, "HEAD");
			const before = git(fixture.checkout, "show-ref");
			const result = runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--trust-pr"], fixture.environment);
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("existing source remote");
			expect(git(fixture.checkout, "show-ref")).toBe(before);
			expect(git(fixture.checkout, "remote")).toBe("origin");
			expect(existsSync(fixture.prepareLog)).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("refuses conflicting fork remote configuration instead of repointing it", () => {
		const fixture = createForkPullRequestFixture();
		try {
			git(fixture.checkout, "remote", "add", "contributor", fixture.forkUrl);
			git(fixture.checkout, "config", "remote.contributor.pushurl", "https://github.com/fixture/repo.git");
			const before = readFileSync(join(fixture.checkout, ".git", "config"), "utf8");
			const result = runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--trust-pr"], fixture.environment);
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("conflicting push URL");
			expect(readFileSync(join(fixture.checkout, ".git", "config"), "utf8")).toBe(before);
			expect(existsSync(fixture.prepareLog)).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});
});

describe("independent work from a PR", () => {
	for (const flag of ["-c", "--create-branch"]) {
		it(`creates agent/<slug> with ${flag} while leaving an occupied PR branch untouched (AC-5)`, () => {
			const fixture = createPullRequestFixture();
			try {
				git(fixture.checkout, "fetch", "origin");
				const occupied = join(fixture.root, "existing-review");
				git(fixture.checkout, "worktree", "add", "--track", "-b", fixture.branch, occupied, `origin/${fixture.branch}`);
				writeFileSync(join(occupied, "local-review.txt"), "keep my review\n");
				const sourceConfig = readFileSync(join(fixture.checkout, ".git", "config"), "utf8");
				const result = runCli(fixture.checkout, ["followup", "create", "--pr", "123", flag, "--trust-pr", "--json"], fixture.environment);
				expect(result.status).toBe(0);
				const metadata = JSON.parse(result.stdout).session;
				expect(metadata.branch).toBe("agent/followup");
				expect(metadata.pr.mode).toBe("independent");
				expect(metadata.pr.headBranch).toBe(fixture.branch);
				expect(git(metadata.worktreePath, "rev-parse", "HEAD")).toBe(fixture.head);
				expect(git(metadata.worktreePath, "for-each-ref", "--format=%(upstream)", "refs/heads/agent/followup")).toBe("");
				expect(readFileSync(join(fixture.checkout, ".git", "config"), "utf8")).toBe(sourceConfig);
				expect(readFileSync(join(occupied, "local-review.txt"), "utf8")).toBe("keep my review\n");
				expect(git(occupied, "rev-parse", "HEAD")).toBe(fixture.head);
				const status = runCli(metadata.worktreePath, [".", "status", "--json"], fixture.environment);
				expect(status.status).toBe(0);
				expect(JSON.parse(status.stdout).sessions[0].publication).toBe("unpublished");
				expect(runCli(fixture.checkout, ["followup", "finish", "--yes"], fixture.environment).status).toBe(1);
				expect(existsSync(metadata.worktreePath)).toBe(true);
				expect(runCli(fixture.checkout, ["followup", "finish", "--keep-branch", "--yes"], fixture.environment).status).toBe(0);
				expect(git(fixture.checkout, "rev-parse", "agent/followup")).toBe(fixture.head);
				expect(readFileSync(join(occupied, "local-review.txt"), "utf8")).toBe("keep my review\n");
			} finally { rmSync(fixture.root, { recursive: true, force: true }); }
		});
	}

	it("starts independent fork work without fetching or configuring its source remote", () => {
		const fixture = createForkPullRequestFixture();
		try {
			rmSync(fixture.fork, { recursive: true, force: true });
			const before = readFileSync(join(fixture.checkout, ".git", "config"), "utf8");
			const result = runCli(fixture.checkout, ["followup", "create", "--pr", fixture.response.url, "-c", "--trust-pr", "--json"], fixture.environment);
			expect(result.status).toBe(0);
			const metadata = JSON.parse(result.stdout).session;
			expect(metadata.pr.mode).toBe("independent");
			expect(metadata.pr.sourceRepository).toBe("contributor/repo");
			expect(metadata.pr.sourceRemote).toBe(undefined);
			expect(git(fixture.checkout, "remote")).toBe("origin");
			expect(readFileSync(join(fixture.checkout, ".git", "config"), "utf8")).toBe(before);
			const refreshed = runCli(fixture.checkout, ["followup", "status", "--refresh", "--json"], fixture.environment);
			expect(refreshed.status).toBe(0);
			expect(JSON.parse(refreshed.stdout).sessions[0].publication).toBe("unpublished");
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("previews the requested independent branch offline while leaving the PR head unresolved", () => {
		const fixture = createPullRequestFixture();
		try {
			const result = runCli(fixture.checkout, ["followup", "create", "--pr", fixture.response.url, "-c", "--dry-run", "--json"], fixture.environment);
			expect(result.status).toBe(0);
			const plan = JSON.parse(result.stdout).plan;
			expect(plan.branch).toBe("agent/followup");
			expect(plan.pr.mode).toBe("independent");
			expect(plan.pr.resolved).toBe(false);
			expect(plan.pr.headCommit).toBe(null);
			expect(plan.base).toBe(null);
			expect(existsSync(fixture.ghLog)).toBe(false);
			expect(existsSync(fixture.worktrees)).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("requires PR selection and preserves existing follow-up branches and saved tracking", () => {
		const fixture = createPullRequestFixture();
		try {
			const missing = runCli(fixture.checkout, ["followup", "create", "-c"], fixture.environment);
			expect(missing.status).toBe(64);
			expect(missing.stderr).toContain("requires --pr");
			git(fixture.checkout, "config", "branch.agent/followup.merge", `refs/heads/${fixture.branch}`);
			const before = readFileSync(join(fixture.checkout, ".git", "config"), "utf8");
			const orphan = runCli(fixture.checkout, ["followup", "create", "--pr", "123", "-c", "--trust-pr"], fixture.environment);
			expect(orphan.status).toBe(1);
			expect(orphan.stderr).toContain("preexisting local branch configuration");
			git(fixture.checkout, "branch", "agent/followup");
			const existing = runCli(fixture.checkout, ["followup", "create", "--pr", "123", "--create-branch", "--trust-pr"], fixture.environment);
			expect(existing.status).toBe(1);
			expect(git(fixture.checkout, "rev-parse", "agent/followup")).toBe(git(fixture.checkout, "rev-parse", "master"));
			expect(readFileSync(join(fixture.checkout, ".git", "config"), "utf8")).toBe(before);
			expect(existsSync(fixture.prepareLog)).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});
});

function prepareBorrowedBranch(fixture: ReturnType<typeof createPullRequestFixture>): void {
	git(fixture.checkout, "fetch", "origin");
	git(fixture.checkout, "branch", "--track", fixture.branch, `origin/${fixture.branch}`);
	git(fixture.checkout, "config", `branch.${fixture.branch}.pushRemote`, "origin");
}

describe("PR launch, reuse and borrowed branches", () => {
	it("starts a PR agent normally and supports independent no-agent preparation (AC-6)", () => {
		const fixture = createPullRequestFixture();
		try {
			const started = runCli(fixture.checkout, ["review-auth", "start", "--pr", "123", "--trust-pr"], fixture.environment);
			expect(started.status).toBe(0);
			expect(readFileSync(fixture.agentLog, "utf8").trim()).toBe(realpathSync(join(fixture.worktrees, "review-auth")));
			expect(readFileSync(`${fixture.agentLog}.args`, "utf8")).toBe("\n");
			const prepared = runCli(fixture.checkout, ["followup", "start", "--pr", fixture.response.url, "--create-branch", "--trust-pr", "--no-agent"], fixture.environment);
			expect(prepared.status).toBe(0);
			expect(readFileSync(fixture.agentLog, "utf8").trim().split("\n").length).toBe(1);
			expect(git(join(fixture.worktrees, "followup"), "branch", "--show-current")).toBe("agent/followup");
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("reuses trusted dirty/local-ahead work offline without re-preparing or adopting a new PR head (AC-7)", () => {
		const fixture = createPullRequestFixture();
		try {
			writeConfig(fixture.checkout, createFakeAgent(fixture.root, fixture.agentLog), ["sh", "-c", `printf prepared >> ${tomlString(fixture.prepareLog)}`]);
			const created = runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--trust-pr", "--json"], fixture.environment);
			expect(created.status).toBe(0);
			const metadata = JSON.parse(created.stdout).session;
			writeFileSync(join(metadata.worktreePath, "fix.txt"), "fix\n");
			git(metadata.worktreePath, "add", "fix.txt");
			git(metadata.worktreePath, "-c", "user.name=Review", "-c", "user.email=review@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "Local fix");
			writeFileSync(join(metadata.worktreePath, "dirty.txt"), "unfinished\n");
			const head = git(metadata.worktreePath, "rev-parse", "HEAD");
			const before = readFileSync(sessionMetadataPath(fixture.checkout, "review-auth"), "utf8");
			writeFileSync(fixture.responsePath, JSON.stringify({ ...fixture.response, headRefOid: "f".repeat(40) }));
			rmSync(fixture.remote, { recursive: true, force: true });
			const env = { ...fixture.environment, FAKE_GH_FAILURE: "1" };
			const reused = runCli(fixture.checkout, ["review-auth", "create", "--pr", fixture.response.url, "--json"], env);
			expect(reused.status).toBe(0);
			expect(JSON.stringify(JSON.parse(reused.stdout).session)).toBe(JSON.stringify(metadata));
			expect(runCli(fixture.checkout, ["review-auth", "start", "--pr", "123"], env).status).toBe(0);
			expect(readFileSync(fixture.prepareLog, "utf8")).toBe("prepared");
			expect(readFileSync(fixture.agentLog, "utf8").trim()).toBe(metadata.worktreePath);
			expect(git(metadata.worktreePath, "rev-parse", "HEAD")).toBe(head);
			expect(readFileSync(join(metadata.worktreePath, "dirty.txt"), "utf8")).toBe("unfinished\n");
			const { lastWorkAt, activeOperations, ...identity } = JSON.parse(readFileSync(sessionMetadataPath(fixture.checkout, "review-auth"), "utf8"));
			expect(JSON.stringify(identity)).toBe(JSON.stringify(JSON.parse(before)));
			expect(Number.isFinite(Date.parse(lastWorkAt))).toBe(true);
			expect(activeOperations.length).toBe(0);
			expect(readFileSync(fixture.ghLog, "utf8").trim().split("\n").length).toBe(1);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("refuses an existing slug with a different PR, branch mode, or invalid binding (AC-8)", () => {
		const fixture = createPullRequestFixture();
		try {
			expect(runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--trust-pr"], fixture.environment).status).toBe(0);
			const record = sessionMetadataPath(fixture.checkout, "review-auth");
			const before = readFileSync(record, "utf8");
			for (const args of [["create", "--pr", "456"], ["start", "--pr", "123", "-c"]]) {
				const result = runCli(fixture.checkout, ["review-auth", ...args], fixture.environment);
				expect(result.status).toBe(1);
				expect(result.stderr).toContain("different PR or branch mode");
				expect(readFileSync(record, "utf8")).toBe(before);
			}
			rmSync(join(fixture.worktrees, "review-auth", ".git"));
			expect(runCli(fixture.checkout, ["review-auth", "start", "--pr", "123"], fixture.environment).status).toBe(1);
			expect(existsSync(fixture.agentLog)).toBe(false);
			expect(readFileSync(record, "utf8")).toBe(before);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	for (const mode of ["normal", "force", "orphaned-force", "renamed"]) {
		it(`borrows a matching tracked branch without owning or deleting it: ${mode} (AC-10, AC-18)`, () => {
			const fixture = createPullRequestFixture();
			try {
				prepareBorrowedBranch(fixture);
				const config = readFileSync(join(fixture.checkout, ".git", "config"), "utf8");
				const result = runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--trust-pr", "--json"], fixture.environment);
				expect(result.status).toBe(0);
				const metadata = JSON.parse(result.stdout).session;
				expect(metadata.initialBranchOwned).toBe(false);
				expect(metadata.version).toBe(2);
				expect(JSON.parse(result.stdout).version).toBe(1);
				expect(readFileSync(join(fixture.checkout, ".git", "config"), "utf8")).toBe(config);
				let branch = fixture.branch;
				if (mode === "renamed") { branch = "fix/renamed-borrowed"; git(metadata.worktreePath, "branch", "-m", branch); }
				const status = runCli(fixture.checkout, ["review-auth", "status", "--json"], fixture.environment);
				expect(status.status).toBe(0);
				expect(JSON.parse(status.stdout).sessions[0].ownedBranches.length).toBe(0);
				expect(JSON.parse(status.stdout).sessions[0].state).toBe("ready");
				if (mode === "orphaned-force") rmSync(metadata.worktreePath, { recursive: true, force: true });
				if (mode === "force") writeFileSync(join(metadata.worktreePath, "dirty.txt"), "discard checkout files only\n");
				const finished = runCli(fixture.checkout, ["review-auth", "finish", "--yes", ...(mode.includes("force") ? ["--force"] : [])], fixture.environment);
				expect(finished.status).toBe(0);
				expect(git(fixture.checkout, "rev-parse", branch)).toBe(fixture.head);
				expect(existsSync(sessionMetadataPath(fixture.checkout, "review-auth"))).toBe(false);
				if (mode !== "renamed") expect(readFileSync(join(fixture.checkout, ".git", "config"), "utf8")).toBe(config);
			} finally { rmSync(fixture.root, { recursive: true, force: true }); }
		});
	}

	it("requires ownership-aware v2 metadata even when a borrowed branch looks like a legacy managed branch", () => {
		const fixture = createPullRequestFixture();
		try {
			const branch = "agent/review-auth";
			git(fixture.remote, "update-ref", `refs/heads/${branch}`, fixture.head);
			writeFileSync(fixture.responsePath, JSON.stringify({ ...fixture.response, headRefName: branch }));
			git(fixture.checkout, "fetch", "origin");
			git(fixture.checkout, "branch", "--track", branch, `origin/${branch}`);
			git(fixture.checkout, "config", `branch.${branch}.pushRemote`, "origin");
			const created = runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--trust-pr", "--json"], fixture.environment);
			expect(created.status).toBe(0);
			const receipt = JSON.parse(created.stdout);
			expect(receipt.version).toBe(1);
			expect(receipt.session.version).toBe(2);
			expect(receipt.session.initialBranchOwned).toBe(false);
			const record = sessionMetadataPath(fixture.checkout, "review-auth");
			const before = readFileSync(record, "utf8");
			expect(runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--json"], fixture.environment).status).toBe(0);
			for (const corruption of ["downgrade", "missing-ownership"]) {
				const corrupt = { ...receipt.session };
				if (corruption === "downgrade") corrupt.version = 1;
				else delete corrupt.initialBranchOwned;
				writeFileSync(record, JSON.stringify(corrupt));
				const refused = runCli(fixture.checkout, ["review-auth", "finish", "--force", "--yes"], fixture.environment);
				expect(refused.status).toBe(1);
				expect(git(fixture.checkout, "rev-parse", branch)).toBe(fixture.head);
				expect(existsSync(receipt.session.worktreePath)).toBe(true);
			}
			writeFileSync(record, before);
			expect(runCli(fixture.checkout, ["review-auth", "finish", "--force", "--yes"], fixture.environment).status).toBe(0);
			expect(git(fixture.checkout, "rev-parse", branch)).toBe(fixture.head);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("borrows the configured fork upstream, honors its push override, and does not reconfigure aliases", () => {
		const fixture = createForkPullRequestFixture();
		try {
			git(fixture.checkout, "remote", "add", "z-source", fixture.forkUrl);
			git(fixture.checkout, "remote", "add", "a-alias", fixture.forkUrl);
			git(fixture.checkout, "fetch", "z-source");
			git(fixture.checkout, "branch", "--track", fixture.branch, `z-source/${fixture.branch}`);
			git(fixture.checkout, "config", "remote.pushDefault", "origin");
			const before = readFileSync(join(fixture.checkout, ".git", "config"), "utf8");
			const unsafe = runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--trust-pr"], fixture.environment);
			expect(unsafe.status).toBe(1);
			expect(unsafe.stderr).toContain("source repository");
			expect(readFileSync(join(fixture.checkout, ".git", "config"), "utf8")).toBe(before);
			git(fixture.checkout, "config", `branch.${fixture.branch}.pushRemote`, "z-source");
			const compatible = readFileSync(join(fixture.checkout, ".git", "config"), "utf8");
			const created = runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--trust-pr", "--json"], fixture.environment);
			expect(created.status).toBe(0);
			expect(JSON.parse(created.stdout).session.pr.sourceRemote).toBe("z-source");
			expect(JSON.parse(created.stdout).session.initialBranchOwned).toBe(false);
			expect(readFileSync(join(fixture.checkout, ".git", "config"), "utf8")).toBe(compatible);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("deletes only session-created follow-up branches when force-finishing borrowed work", () => {
		const fixture = createPullRequestFixture();
		try {
			prepareBorrowedBranch(fixture);
			const created = runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--trust-pr", "--json"], fixture.environment);
			expect(created.status).toBe(0);
			const worktree = JSON.parse(created.stdout).session.worktreePath;
			git(worktree, "checkout", "-b", "fix/session-owned");
			const status = runCli(fixture.checkout, ["review-auth", "status", "--json"], fixture.environment);
			expect(JSON.parse(status.stdout).sessions[0].ownedBranches.join(",")).toBe("fix/session-owned");
			expect(runCli(fixture.checkout, ["review-auth", "finish", "--force", "--yes"], fixture.environment).status).toBe(0);
			expect(git(fixture.checkout, "branch", "--list", "fix/session-owned")).toBe("");
			expect(git(fixture.checkout, "rev-parse", fixture.branch)).toBe(fixture.head);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("preserves a borrowed branch and configuration when preparation fails (AC-19)", () => {
		const fixture = createPullRequestFixture();
		try {
			prepareBorrowedBranch(fixture);
			writeConfig(fixture.checkout, "unused", ["sh", "-c", "exit 7"]);
			const before = readFileSync(join(fixture.checkout, ".git", "config"), "utf8");
			const result = runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--trust-pr", "--json"], fixture.environment);
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("Configured command exited with status 7");
			expect(git(fixture.checkout, "rev-parse", fixture.branch)).toBe(fixture.head);
			expect(readFileSync(join(fixture.checkout, ".git", "config"), "utf8")).toBe(before);
			expect(existsSync(join(fixture.worktrees, "review-auth"))).toBe(false);
			expect(result.stdout).toBe("");
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("refuses missing or conflicting borrowed-branch tracking without rewriting it", () => {
		const fixture = createPullRequestFixture();
		try {
			prepareBorrowedBranch(fixture);
			for (const merge of ["refs/heads/master", ""]) {
				if (merge) git(fixture.checkout, "config", `branch.${fixture.branch}.merge`, merge);
				else git(fixture.checkout, "config", "--unset", `branch.${fixture.branch}.merge`);
				const before = readFileSync(join(fixture.checkout, ".git", "config"), "utf8");
				const result = runCli(fixture.checkout, ["review-auth", "create", "--pr", "123", "--trust-pr"], fixture.environment);
				expect(result.status).toBe(1);
				expect(result.stderr).toContain("tracking");
				expect(readFileSync(join(fixture.checkout, ".git", "config"), "utf8")).toBe(before);
				expect(git(fixture.checkout, "rev-parse", fixture.branch)).toBe(fixture.head);
			}
			expect(existsSync(fixture.prepareLog)).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});
});

describe("historical PRs and release bases", () => {
	for (const state of ["CLOSED", "MERGED"]) {
		for (const flags of [[], ["-c"]]) {
			it(`reviews ${state} PRs with a fetchable head: ${flags.length ? "independent" : "review"} (AC-12)`, () => {
				const fixture = createPullRequestFixture();
				try {
					writeFileSync(fixture.responsePath, JSON.stringify({ ...fixture.response, state }));
					const refs = git(fixture.remote, "show-ref");
					const created = runCli(fixture.checkout, ["history", "create", "--pr", "123", ...flags, "--trust-pr", "--json"], fixture.environment);
					expect(created.status).toBe(0);
					const metadata = JSON.parse(created.stdout).session;
					expect(metadata.pr.state).toBe(state);
					expect(git(metadata.worktreePath, "rev-parse", "HEAD")).toBe(fixture.head);
					const status = runCli(fixture.checkout, ["history", "status"], fixture.environment);
					expect(status.stdout).toContain(fixture.response.url);
					expect(status.stdout).toContain(state);
					expect(git(fixture.remote, "show-ref")).toBe(refs);
				} finally { rmSync(fixture.root, { recursive: true, force: true }); }
			});
		}

		it(`reviews ${state} PRs whose source branch was deleted without recreating it`, () => {
			const fixture = createPullRequestFixture();
			try {
				if (state === "MERGED") git(fixture.remote, "update-ref", "refs/heads/master", fixture.head);
				git(fixture.remote, "update-ref", "-d", `refs/heads/${fixture.branch}`);
				writeFileSync(fixture.responsePath, JSON.stringify({ ...fixture.response, state }));
				const refs = git(fixture.remote, "show-ref");
				const created = runCli(fixture.checkout, ["history", "create", "--pr", "123", "--trust-pr", "--json"], fixture.environment);
				expect(created.status).toBe(0);
				const metadata = JSON.parse(created.stdout).session;
				expect(metadata.pr.sourceBranchMissing).toBe(true);
				expect(git(metadata.worktreePath, "rev-parse", "HEAD")).toBe(fixture.head);
				expect(git(metadata.worktreePath, "config", `branch.${fixture.branch}.merge`)).toBe(`refs/heads/${fixture.branch}`);
				expect(git(metadata.worktreePath, "for-each-ref", "--format=%(upstream:track)", `refs/heads/${fixture.branch}`)).toBe("[gone]");
				const finished = runCli(fixture.checkout, ["history", "finish", "--yes"], fixture.environment);
				expect(finished.status).toBe(state === "MERGED" ? 0 : 1);
				if (state === "CLOSED") expect(runCli(fixture.checkout, ["history", "finish", "--keep-branch", "--yes"], fixture.environment).status).toBe(0);
				expect(git(fixture.remote, "show-ref")).toBe(refs);
			} finally { rmSync(fixture.root, { recursive: true, force: true }); }
		});
	}

	it("preserves a borrowed historical branch after its upstream was deleted", () => {
		const fixture = createPullRequestFixture();
		try {
			prepareBorrowedBranch(fixture);
			git(fixture.remote, "update-ref", "-d", `refs/heads/${fixture.branch}`);
			writeFileSync(fixture.responsePath, JSON.stringify({ ...fixture.response, state: "CLOSED" }));
			const config = readFileSync(join(fixture.checkout, ".git", "config"), "utf8");
			const created = runCli(fixture.checkout, ["history", "create", "--pr", "123", "--trust-pr", "--json"], fixture.environment);
			expect(created.status).toBe(0);
			const metadata = JSON.parse(created.stdout).session;
			expect(metadata.version).toBe(2);
			expect(metadata.initialBranchOwned).toBe(false);
			expect(metadata.pr.sourceBranchMissing).toBe(true);
			expect(runCli(fixture.checkout, ["history", "finish", "--yes"], fixture.environment).status).toBe(0);
			expect(git(fixture.checkout, "rev-parse", fixture.branch)).toBe(fixture.head);
			expect(readFileSync(join(fixture.checkout, ".git", "config"), "utf8")).toBe(config);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("reviews a deleted fork branch even with an existing single-branch fetch configuration", () => {
		const fixture = createForkPullRequestFixture();
		try {
			git(fixture.fork, "update-ref", "-d", `refs/heads/${fixture.branch}`);
			git(fixture.checkout, "remote", "add", "-t", fixture.branch, "contributor", fixture.forkUrl);
			const response = JSON.parse(readFileSync(fixture.responsePath, "utf8"));
			writeFileSync(fixture.responsePath, JSON.stringify({ ...response, state: "MERGED" }));
			const before = readFileSync(join(fixture.checkout, ".git", "config"), "utf8");
			const created = runCli(fixture.checkout, ["history", "create", "--pr", "123", "--trust-pr", "--json"], fixture.environment);
			expect(created.status).toBe(0);
			expect(JSON.parse(created.stdout).session.pr.sourceBranchMissing).toBe(true);
			expect(JSON.parse(created.stdout).session.pr.sourceRemote).toBe("contributor");
			expect(runCli(fixture.checkout, ["history", "finish", "--keep-branch", "--yes"], fixture.environment).status).toBe(0);
			expect(readFileSync(join(fixture.checkout, ".git", "config"), "utf8")).toContain(before.trim());
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("does not mistake a failed source-branch query for a deleted branch", () => {
		const fixture = createPullRequestFixture();
		try {
			git(fixture.remote, "update-ref", "-d", `refs/heads/${fixture.branch}`);
			writeFileSync(fixture.responsePath, JSON.stringify({ ...fixture.response, state: "CLOSED" }));
			const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8", env: process.env }).stdout.trim();
			const shim = join(fixture.root, "bin", "git");
			writeFileSync(shim, `#!/usr/bin/env bash
if [ "$1" = ls-remote ] && [ "$2" = --exit-code ]; then echo 'permission denied' >&2; exit 128; fi
exec ${tomlString(realGit)} "$@"
`);
			chmodSync(shim, 0o755);
			const failed = runCli(fixture.checkout, ["history", "create", "--pr", "123", "--trust-pr", "--json"], fixture.environment);
			expect(failed.status).toBe(1);
			expect(failed.stderr).toContain("absence was not established");
			expect(failed.stdout).toBe("");
			expect(existsSync(fixture.prepareLog)).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("requires explicit independent mode when the historical source repository is no longer identifiable", () => {
		const fixture = createPullRequestFixture();
		try {
			writeFileSync(fixture.responsePath, JSON.stringify({ ...fixture.response, state: "CLOSED", isCrossRepository: true, headRepository: null, headRepositoryOwner: null }));
			const config = readFileSync(join(fixture.checkout, ".git", "config"), "utf8");
			const review = runCli(fixture.checkout, ["history", "create", "--pr", "123", "--trust-pr"], fixture.environment);
			expect(review.status).toBe(1);
			expect(review.stderr).toContain("-c");
			expect(existsSync(fixture.prepareLog)).toBe(false);
			const independent = runCli(fixture.checkout, ["history", "create", "--pr", "123", "-c", "--trust-pr", "--json"], fixture.environment);
			expect(independent.status).toBe(0);
			const metadata = JSON.parse(independent.stdout).session;
			expect(metadata.pr.sourceRepository).toBe(null);
			expect(metadata.pr.sourceRemote).toBe(undefined);
			expect(git(metadata.worktreePath, "rev-parse", "HEAD")).toBe(fixture.head);
			expect(readFileSync(join(fixture.checkout, ".git", "config"), "utf8")).toBe(config);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("fails clearly before execution when the retained PR ref cannot be fetched", () => {
		const fixture = createPullRequestFixture();
		try {
			writeFileSync(fixture.responsePath, JSON.stringify({ ...fixture.response, state: "CLOSED" }));
			git(fixture.remote, "update-ref", "-d", "refs/pull/123/head");
			const result = runCli(fixture.checkout, ["history", "create", "--pr", "123", "-c", "--trust-pr", "--json"], fixture.environment);
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("Could not fetch PR #123 head");
			expect(result.stdout).toBe("");
			expect(existsSync(fixture.prepareLog)).toBe(false);
			expect(existsSync(join(fixture.worktrees, "history"))).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	for (const flags of [[], ["-c"]]) {
		it(`checks freshness and cleanup against a release base, not master: ${flags.length ? "independent" : "review"} (AC-17)`, () => {
			const fixture = createPullRequestFixture();
			try {
				git(fixture.seed, "branch", "release/2.x", "master");
				git(fixture.seed, "push", "origin", "release/2.x");
				git(fixture.seed, "checkout", "master");
				advanceRemoteDefault(fixture);
				writeFileSync(fixture.responsePath, JSON.stringify({ ...fixture.response, baseRefName: "release/2.x" }));
				const created = runCli(fixture.checkout, ["release-review", "create", "--pr", "123", ...flags, "--trust-pr", "--json"], fixture.environment);
				expect(created.status).toBe(0);
				const metadata = JSON.parse(created.stdout).session;
				expect(metadata.defaultBranch).toBe("master");
				expect(metadata.pr.baseBranch).toBe("release/2.x");
				const fresh = runCli(fixture.checkout, ["release-review", "status", "--json"], fixture.environment);
				expect(JSON.parse(fresh.stdout).sessions[0].fresh).toBe(true);
				git(fixture.seed, "checkout", "release/2.x");
				writeFileSync(join(fixture.seed, "release.txt"), "advance release\n");
				git(fixture.seed, "add", "release.txt");
				git(fixture.seed, "-c", "commit.gpgsign=false", "commit", "-m", "Advance release");
				git(fixture.seed, "push", "origin", "release/2.x");
				const stale = runCli(fixture.checkout, ["release-review", "status", "--refresh", "--json"], fixture.environment);
				expect(JSON.parse(stale.stdout).sessions[0].fresh).toBe(false);
				const launched = runCli(fixture.checkout, ["release-review", "launch"], fixture.environment);
				expect(launched.status).toBe(0);
				expect(launched.stderr).toContain("latest origin/release/2.x");
				git(fixture.seed, "-c", "commit.gpgsign=false", "merge", "--no-ff", fixture.branch, "-m", "Merge into release");
				git(fixture.seed, "push", "origin", "release/2.x");
				git(fixture.remote, "update-ref", "-d", `refs/heads/${fixture.branch}`);
				expect(runCli(fixture.checkout, ["release-review", "finish", "--yes"], fixture.environment).status).toBe(0);
				expect(existsSync(metadata.worktreePath)).toBe(false);
			} finally { rmSync(fixture.root, { recursive: true, force: true }); }
		});
	}
});

describe("PR dependency diagnostics", () => {
	for (const [code, message, expected, loginHint] of [
		[1, "GraphQL: Could not resolve to a PullRequest with the number of 123.", "Could not resolve PR #123 in fixture/repo", false],
		[4, "credentials missing", "GitHub authentication required", true],
	] as const) {
		it(`distinguishes GitHub lookup/authentication failure: exit ${code} (AC-20)`, () => {
			const fixture = createPullRequestFixture();
			try {
				const result = runCli(fixture.checkout, ["diagnostic", "create", "--pr", "123", "--trust-pr", "--json"], {
					...fixture.environment, FAKE_GH_FAILURE: "1", FAKE_GH_EXIT: String(code), FAKE_GH_MESSAGE: message,
				});
				expect(result.status).toBe(1);
				expect(result.stderr).toContain(expected);
				expect(result.stderr.includes("gh auth login")).toBe(loginHint);
				expect(result.stdout).toBe("");
				expect(existsSync(fixture.prepareLog)).toBe(false);
				expect(existsSync(join(fixture.worktrees, "diagnostic"))).toBe(false);
			} finally { rmSync(fixture.root, { recursive: true, force: true }); }
		});
	}

	it("identifies a missing gh executable without pretending authentication failed", () => {
		const fixture = createPullRequestFixture();
		try {
			const bin = join(fixture.root, "without-gh");
			mkdirSync(bin);
			for (const command of ["node", "git"]) {
				const resolved = spawnSync("sh", ["-c", `command -v ${command}`], { encoding: "utf8", env: process.env }).stdout.trim();
				symlinkSync(resolved, join(bin, command));
			}
			const result = runCli(fixture.checkout, ["diagnostic", "create", "--pr", "123", "--trust-pr", "--json"], { PATH: bin });
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("GitHub CLI (gh) is not available");
			expect(result.stderr.includes("gh auth login")).toBe(false);
			expect(existsSync(fixture.prepareLog)).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});
});

for (const shell of ["bash", "zsh", "fish"]) {
	it(`completes PR flags offline, but not options in PR-value position: ${shell}`, () => {
		const fixture = createPullRequestFixture();
		try {
			const completion = runCli(fixture.checkout, ["completion", shell]);
			const path = join(fixture.root, shell === "zsh" ? "_agent_session" : "completion");
			writeFileSync(path, completion.stdout.replaceAll("-c agent-session ", "-c as "));
			const script = shell === "fish" ? `
set -g fish_complete_path "$FIXTURE_ROOT"
complete -c as -e
source "$COMPLETION"
complete -C 'as task create --' | string replace -r '^' 'create:'
complete -C 'as task start --' | string replace -r '^' 'start:'
complete -C 'as task create --pr --' | string replace -r '^' 'value:'
true
` : shell === "zsh" ? `
fpath=("$FIXTURE_ROOT" $fpath)
autoload -Uz compinit
compinit -D -i
_describe() { for candidate in "\${candidates[@]}"; do print -r -- "$label:$candidate"; done; }
_message() { :; }
label=create; words=(as task create --); CURRENT=4; _agent_session
label=start; words=(as task start --); CURRENT=4; _agent_session
label=value; words=(as task create --pr --); CURRENT=5; _agent_session
` : `
source "$COMPLETION"
COMP_WORDS=(as task create --); COMP_CWORD=3; _agent_session; printf 'create:%s\\n' "\${COMPREPLY[@]}"
COMP_WORDS=(as task start --); COMP_CWORD=3; _agent_session; printf 'start:%s\\n' "\${COMPREPLY[@]}"
COMP_WORDS=(as task create --pr --); COMP_CWORD=4; _agent_session; printf 'value:%s\\n' "\${COMPREPLY[@]}"
`;
			const result = spawnSync(shell, [shell === "fish" ? "--no-config" : shell === "zsh" ? "-f" : "--noprofile", "-c", script], {
				cwd: fixture.checkout, encoding: "utf8", env: { ...process.env, ...fixture.environment, COMPLETION: path, FIXTURE_ROOT: fixture.root },
			});
			expect(result.status).toBe(0);
			for (const action of ["create", "start"]) {
				for (const flag of ["--pr", "--trust-pr", "--create-branch"]) expect(result.stdout).toContain(`${action}:${flag}`);
			}
			expect(result.stdout.includes("value:--")).toBe(false);
			expect(existsSync(fixture.ghLog)).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});
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
			for (const slug of ["status", "doctor", "finish", "create", "run", "completion"]) {
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
			const installed = (command: string, args: string[], cwd = fixture.checkout) => spawnSync(command, args, {
				cwd,
				encoding: "utf8",
			});
			const created = installed("as", ["installed-package", "create", "--json"]);
			expect(created.status).toBe(0);
			const creationReceipt = JSON.parse(created.stdout);
			expect(creationReceipt.version).toBe(1);
			expect(creationReceipt.dryRun).toBe(false);
			const worktree = join(realpathSync(fixture.worktrees), "installed-package");
			expect(creationReceipt.session.worktreePath).toBe(worktree);
			const nested = join(worktree, "nested");
			mkdirSync(nested);
			const current = installed("as", [".", "status", "--json"], nested);
			expect(current.stderr).toBe("");
			expect(current.status).toBe(0);
			expect(JSON.parse(current.stdout).sessions[0].slug).toBe("installed-package");
			const diagnosis = installed("as", [".", "doctor", "--json"], nested);
			expect(diagnosis.status).toBe(0);
			expect(JSON.parse(diagnosis.stdout).slug).toBe("installed-package");
			expect(installed("as", ["doctor", "--json"]).status).toBe(0);
			expect(installed("as", ["doctor", "cd"]).stderr).toContain("Session commands use <task-slug> <command>");
			expect(installed("agent-session", [".", "cd"], nested).stdout).toBe(`${worktree}\n`);
			rmSync(nested, { recursive: true });
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

	it("adopts the local module with explicit Pi and ignored local configuration links", () => {
		const devenv = readFileSync("devenv.nix", "utf8");
		const ignore = readFileSync(".gitignore", "utf8").split("\n");
		expect(devenv).toMatch(/imports\s*=\s*\[[^\]]*\.\/modules\/flake\/agent-session\/devenv\.nix(?:\s|\])/);
		expect(devenv).toContain('agentCommand = [ "pi" ];');
		expect(devenv).toContain("localLinks = [");
		for (const name of [".envrc.local", "devenv.local.nix", "devenv.local.yaml", ".workon-assistant"]) {
			expect(devenv).toContain(`"${name}"`);
			expect(ignore.some((pattern) => pattern === name || pattern === `/${name}`)).toBe(true);
		}
		expect(ignore.includes("/.worktrees/")).toBe(true);
	});

	it("points future Pi sessions at the shared worktree skill without a custom extension", () => {
		const instructions = readFileSync("AGENTS.md", "utf8");
		expect(instructions).toContain("## Coding-agent sessions (Pi)");
		expect(instructions).toContain("marketplace/plugins/devenv-workflow/skills/agent-session/SKILL.md");
		expect(instructions).toContain("Managed worktrees are required");
		expect(instructions.includes("as <task-slug> create --json")).toBe(false);
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

describe("explicit unrecorded-worktree retirement", () => {
	it("previews and removes a dirty renamed worktree offline while preserving every ref", () => {
		const fixture = createRepositoryFixture("unrecorded session ");
		try {
			const { worktree } = startManagedSession(fixture);
			rmSync(sessionMetadataPath(fixture.checkout, "git-hygiene"));
			git(worktree, "branch", "-m", "fix/unrecorded-work");
			git(fixture.checkout, "branch", "unrelated-saved-branch");
			writeFileSync(join(worktree, "uncommitted"), "discard only after explicit force");
			writeFileSync(join(fixture.checkout, "primary-work"), "preserve primary");
			git(fixture.checkout, "remote", "set-url", "origin", join(fixture.root, "offline"));
			const refs = git(fixture.checkout, "for-each-ref", "--format=%(refname) %(objectname)");
			const preview = runCli(fixture.checkout, ["git-hygiene", "finish", "--force", "--dry-run", "--json"]);
			expect(preview.status).toBe(0);
			const plan = JSON.parse(preview.stdout).plan;
			expect(plan.state).toBe("unrecorded");
			expect(plan.worktreePath).toBe(worktree);
			expect(plan.currentBranch).toBe("fix/unrecorded-work");
			expect(plan.keepBranch).toBe(true);
			expect(plan.allBranchesPreserved).toBe(true);
			expect(plan.uncommittedWorkWillBeDiscarded).toBe(true);
			expect(plan.ownedBranches.length).toBe(0);
			expect(plan.clean).toBe(null);
			expect(readFileSync(join(worktree, "uncommitted"), "utf8")).toBe("discard only after explicit force");
			const human = runCli(fixture.checkout, ["git-hygiene", "finish", "--force", "--dry-run"]);
			expect(human.stdout).toContain("preserve all branches");
			const result = runCli(fixture.checkout, ["git-hygiene", "finish", "--force", "--yes"]);
			expect(result.status).toBe(0);
			expect(result.stderr).toContain("uncommitted and ignored local files");
			expect(existsSync(worktree)).toBe(false);
			expect(existsSync(sessionMetadataPath(fixture.checkout, "git-hygiene"))).toBe(false);
			expect(git(fixture.checkout, "for-each-ref", "--format=%(refname) %(objectname)")).toBe(refs);
			expect(readFileSync(join(fixture.checkout, "primary-work"), "utf8")).toBe("preserve primary");
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("reports detached HEAD risk without creating refs or claiming branch ownership", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			rmSync(sessionMetadataPath(fixture.checkout, "git-hygiene"));
			git(worktree, "checkout", "--detach", "HEAD");
			const refs = git(fixture.checkout, "for-each-ref", "--format=%(refname) %(objectname)");
			const preview = runCli(fixture.checkout, ["git-hygiene", "finish", "--force", "--dry-run", "--json"]);
			expect(preview.status).toBe(0);
			expect(JSON.parse(preview.stdout).plan.currentBranch).toBe(null);
			expect(JSON.parse(preview.stdout).plan.detachedHeadMayBecomeUnreachable).toBe(true);
			const result = runCli(fixture.checkout, ["git-hygiene", "finish", "--force", "--yes"]);
			expect(result.status).toBe(0);
			expect(result.stderr).toContain("detached HEAD commits may become unreachable");
			expect(git(fixture.checkout, "for-each-ref", "--format=%(refname) %(objectname)")).toBe(refs);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("requires explicit force and confirmation, never expands bulk cleanup, and guards the current shell", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			rmSync(sessionMetadataPath(fixture.checkout, "git-hygiene"));
			git(worktree, "branch", "-m", "fix/unrecorded-work");
			for (const flags of [["--yes"], ["--dry-run"], ["--force"]]) {
				expect(runCli(fixture.checkout, ["git-hygiene", "finish", ...flags]).status).toBe(1);
				expect(existsSync(worktree)).toBe(true);
			}
			for (const selector of ["--all", "--gone"]) {
				for (const flags of [["--dry-run", "--json"], ["--yes"]]) {
					expect(runCli(fixture.checkout, ["finish", selector, "--force", ...flags]).status).toBe(0);
					expect(existsSync(worktree)).toBe(true);
				}
			}
			const nested = join(worktree, "nested"); mkdirSync(nested);
			for (const flags of [["--yes"], ["--dry-run", "--json"]]) {
				const result = runCli(nested, ["git-hygiene", "finish", "--force", ...flags]);
				expect(result.status).toBe(1);
				expect(result.stderr).toContain("current shell");
				expect(existsSync(worktree)).toBe(true);
			}
			writeFileSync(join(fixture.checkout, ".gitignore"), "");
			const ignored = runCli(fixture.checkout, ["git-hygiene", "finish", "--force", "--yes"], {
				GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.excludesFile", GIT_CONFIG_VALUE_0: "/dev/null",
			});
			expect(ignored.status).toBe(1);
			expect(ignored.stderr).toContain("Git-ignored");
			expect(existsSync(worktree)).toBe(true);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("does not interpret malformed, mismatched, directory or dangling records as absent", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			const path = sessionMetadataPath(fixture.checkout, "git-hygiene");
			const original = JSON.parse(readFileSync(path, "utf8"));
			for (const contents of ["not JSON", "null", JSON.stringify({ ...original, worktreePath: fixture.seed })]) {
				writeFileSync(path, contents);
				expect(runCli(fixture.checkout, ["git-hygiene", "finish", "--force", "--yes"]).status).toBe(1);
				expect(existsSync(worktree)).toBe(true);
				expect(readFileSync(path, "utf8")).toBe(contents);
			}
			rmSync(path); symlinkSync(join(fixture.root, "missing-record"), path);
			for (const command of ["finish", "repair"]) {
				const flags = command === "finish" ? ["--force", "--yes"] : [];
				expect(runCli(fixture.checkout, ["git-hygiene", command, ...flags]).status).toBe(1);
				expect(lstatSync(path).isSymbolicLink()).toBe(true);
			}
			rmSync(path); mkdirSync(path);
			expect(runCli(fixture.checkout, ["git-hygiene", "finish", "--force", "--yes"]).status).toBe(1);
			rmSync(path, { recursive: true });
			rmSync(join(path, ".."), { recursive: true });
			writeFileSync(join(path, ".."), "invalid metadata directory");
			expect(runCli(fixture.checkout, ["git-hygiene", "finish", "--force", "--yes"]).status).toBe(1);
			rmSync(join(path, ".."));
			symlinkSync(join(fixture.root, "missing-store"), join(path, ".."));
			expect(runCli(fixture.checkout, ["git-hygiene", "finish", "--force", "--yes"]).status).toBe(1);
			expect(existsSync(worktree)).toBe(true);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("refuses absent, locked, unregistered, symlinked and foreign configured slots", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			rmSync(sessionMetadataPath(fixture.checkout, "git-hygiene"));
			git(fixture.checkout, "worktree", "lock", worktree);
			expect(runCli(fixture.checkout, ["git-hygiene", "finish", "--force", "--yes"]).status).toBe(1);
			git(fixture.checkout, "worktree", "unlock", worktree);
			const moved = join(fixture.root, "moved");
			git(fixture.checkout, "worktree", "move", worktree, moved);
			expect(runCli(fixture.checkout, ["git-hygiene", "finish", "--force", "--yes"]).status).toBe(1);
			symlinkSync(moved, worktree);
			expect(runCli(fixture.checkout, ["git-hygiene", "finish", "--force", "--yes"]).status).toBe(1);
			rmSync(worktree); mkdirSync(worktree);
			writeFileSync(join(worktree, "preserve"), "not registered");
			expect(runCli(fixture.checkout, ["git-hygiene", "finish", "--force", "--yes"]).status).toBe(1);
			expect(readFileSync(join(worktree, "preserve"), "utf8")).toBe("not registered");
			git(worktree, "init");
			expect(runCli(fixture.checkout, ["git-hygiene", "finish", "--force", "--yes"]).status).toBe(1);
			expect(existsSync(moved)).toBe(true);
			rmSync(worktree, { recursive: true });
			git(fixture.checkout, "worktree", "move", moved, worktree);
			writeFileSync(join(worktree, ".git"), `gitdir: ${join(fixture.seed, ".git")}\n`);
			expect(runCli(fixture.checkout, ["git-hygiene", "finish", "--force", "--yes"]).status).toBe(1);
			expect(existsSync(worktree)).toBe(true);
			expect(existsSync(fixture.seed)).toBe(true);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("makes repair and doctor suggest explicit preview and retirement without inventing metadata", () => {
		const fixture = createRepositoryFixture();
		try {
			writeConfig(fixture.checkout, "true");
			expect(runCli(fixture.checkout, ["--", "doctor", "create"]).status).toBe(0);
			const worktree = join(realpathSync(fixture.worktrees), "doctor");
			rmSync(sessionMetadataPath(fixture.checkout, "doctor"));
			git(worktree, "branch", "-m", "fix/renamed-doctor");
			git(fixture.checkout, "remote", "set-url", "origin", join(fixture.root, "offline"));
			const result = runCli(fixture.checkout, ["--", "doctor", "repair"]);
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("agent-session -- doctor finish --force --dry-run");
			expect(result.stderr).toContain("preserve all branches");
			const diagnosis = runCli(fixture.checkout, ["doctor", "--json"]);
			expect(diagnosis.stdout).toContain("agent-session -- doctor finish --force --dry-run");
			expect(existsSync(sessionMetadataPath(fixture.checkout, "doctor"))).toBe(false);
			expect(existsSync(worktree)).toBe(true);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});
});

describe("Node terminal confirmation", () => {
	for (const [mode, args] of [
		["normal", ["git-hygiene", "finish", "--keep-branch"]],
		["forced", ["git-hygiene", "finish", "--force", "--keep-branch"]],
		["unrecorded", ["git-hygiene", "finish", "--force"]],
		["unrecorded-rebound", ["git-hygiene", "finish", "--force"]],
		["unrecorded-branch-change", ["git-hygiene", "finish", "--force"]],
		["unrecorded-replaced", ["git-hygiene", "finish", "--force"]],
		["bulk", ["finish", "--all", "--keep-branch"]],
	] as const) {
		for (const answer of ["yes\n", "no\n", "\n", "EOF"]) {
			it(`handles ${JSON.stringify(answer)} for ${mode} cleanup on a real terminal`, () => {
				const fixture = createRepositoryFixture();
				try {
					const { worktree } = startManagedSession(fixture);
					const unrecorded = mode.startsWith("unrecorded");
					if (unrecorded) {
						rmSync(sessionMetadataPath(fixture.checkout, "git-hygiene"));
						git(worktree, "branch", "-m", "fix/unrecorded-terminal");
					}
					const driver = `
import errno, json, os, pty, select, shutil, subprocess, sys, time
master, slave = pty.openpty()
child = subprocess.Popen(json.loads(sys.argv[1]), stdin=slave, stdout=slave, stderr=slave)
os.close(slave)
output = b''
answered = False
lock_held = False
try:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.05)[0]:
            try:
                chunk = os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not chunk:
                break
            output += chunk
            if b'[y/N]' in output and not answered:
                with open(sys.argv[3]) as owner:
                    lock_held = json.load(owner).get('pid') == child.pid
                if len(sys.argv) > 4 and sys.argv[4]:
                    with open(sys.argv[4], 'w') as record:
                        record.write('{}')
                if len(sys.argv) > 6 and sys.argv[5] == 'unrecorded-branch-change':
                    subprocess.run(['git', '-C', sys.argv[6], 'branch', '-m', 'fix/changed-after-confirmation'], check=True)
                if len(sys.argv) > 6 and sys.argv[5] == 'unrecorded-replaced':
                    original = sys.argv[6]
                    os.rename(original, original + '.moved')
                    os.mkdir(original)
                    shutil.copyfile(original + '.moved/.git', original + '/.git')
                answer = b'\\x04' if sys.argv[2] == 'EOF' else sys.argv[2].encode()
                os.write(master, answer)
                answered = True
        elif child.poll() is not None:
            break
    else:
        raise TimeoutError('terminal confirmation did not complete')
    code = child.wait(timeout=5)
    print(json.dumps({'status': code, 'output': output.decode(errors='replace'), 'answered': answered, 'lockHeld': lock_held}))
finally:
    if child.poll() is None:
        child.kill()
        child.wait()
    os.close(master)
`;
					const entry = mode === "normal" ? ["as"] : ["node", cliScript];
					const result = spawnSync("python3", ["-c", driver, JSON.stringify([...entry, ...args]), answer, join(fixture.checkout, ".git", "agent-session", "operation.lock", "owner.json"), mode === "unrecorded-rebound" ? sessionMetadataPath(fixture.checkout, "git-hygiene") : "", mode, worktree], {
						cwd: fixture.checkout, encoding: "utf8",
						env: { ...process.env, AGENT_SESSION_CONFIG: runtimeConfigPath(fixture.checkout) },
					});
					expect(result.status).toBe(0);
					const terminal = JSON.parse(result.stdout);
					expect(terminal.answered).toBe(true);
					expect(terminal.lockHeld).toBe(true);
					expect(terminal.output.includes("ReferenceError")).toBe(false);
					const accepted = answer === "yes\n";
					const changed = ["unrecorded-rebound", "unrecorded-branch-change", "unrecorded-replaced"].includes(mode);
					const removed = accepted && !changed;
					if (removed && terminal.status !== 0) throw new Error(terminal.output);
					expect(terminal.status).toBe(removed ? 0 : 1);
					expect(existsSync(worktree)).toBe(!removed);
					expect(existsSync(sessionMetadataPath(fixture.checkout, "git-hygiene"))).toBe(mode === "unrecorded-rebound" || (!unrecorded && !removed));
					const branch = mode === "unrecorded-branch-change" ? "fix/changed-after-confirmation" : unrecorded ? "fix/unrecorded-terminal" : "agent/git-hygiene";
					if (accepted && changed) expect(terminal.output.toLowerCase()).toContain(mode === "unrecorded-rebound" ? "metadata exists" : "target changed");
					if (mode === "unrecorded-replaced") expect(existsSync(`${worktree}.moved`)).toBe(true);
					expect(git(fixture.checkout, "branch", "--list", "--format=%(refname:short)", branch)).toBe(branch);
					if (!accepted) expect(terminal.output).toContain(mode === "bulk" ? "Finish cancelled" : "Cleanup cancelled");
				} finally { rmSync(fixture.root, { recursive: true, force: true }); }
			});
		}
	}
});

describe("read-only doctor", () => {
	it("reports healthy bindings as one versioned JSON document and offers human diagnostics", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			git(worktree, "branch", "-m", "feat/renamed-doctor");
			const result = runCli(fixture.checkout, ["doctor", "--json"]);
			expect(result.status).toBe(0);
			expect(result.stderr).toBe("");
			const report = JSON.parse(result.stdout);
			expect(report.version).toBe(1);
			expect(report.command).toBe("doctor");
			expect(report.ok).toBe(true);
			expect(report.checks.some((check) => check.id === "binding" && check.slug === "git-hygiene" && check.status === "ok")).toBe(true);
			expect(report.checks.some((check) => check.id === "shell-parent" && check.status === "info")).toBe(true);
			const nested = join(worktree, "nested");
			mkdirSync(nested);
			const current = runCli(nested, [".", "doctor", "--json"]);
			expect(current.status).toBe(0);
			expect(JSON.parse(current.stdout).slug).toBe("git-hygiene");
			const human = runCli(fixture.checkout, ["doctor"]);
			expect(human.status).toBe(0);
			expect(human.stdout).toContain("Doctor: no errors");
			expect(human.stdout).toContain("git-hygiene");
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("diagnoses absent or invalid configuration and non-repository contexts without leaking values", () => {
		const fixture = createRepositoryFixture();
		try {
			const secret = "DO_NOT_PRINT_CONFIG_SECRET";
			for (const contents of ["", `{\"${secret}\":`, JSON.stringify({ version: 1, worktree_root: "../unsafe", agent_command: [secret], prepare_command: [], local_links: [] })]) {
				writeFileSync(runtimeConfigPath(fixture.checkout), contents);
				const result = runCli(fixture.checkout, ["doctor", "--json"]);
				expect(result.status).toBe(1);
				expect(JSON.parse(result.stdout).checks.some((check) => check.id === "configuration" && check.status === "error")).toBe(true);
				expect((result.stdout + result.stderr).includes(secret)).toBe(false);
			}
			const missing = runCli(fixture.checkout, ["doctor", "--json"], { AGENT_SESSION_CONFIG: join(fixture.root, "absent") });
			expect(missing.status).toBe(1);
			expect(JSON.parse(missing.stdout).ok).toBe(false);
			const outside = runCli(fixture.root, ["doctor", "--json"]);
			expect(outside.status).toBe(1);
			expect(JSON.parse(outside.stdout).checks.some((check) => check.id === "repository" && check.status === "error")).toBe(true);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("distinguishes recoverable missing records from renamed branches without guessing repair", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			const metadata = sessionMetadataPath(fixture.checkout, "git-hygiene");
			rmSync(metadata);
			const report = () => JSON.parse(runCli(fixture.checkout, ["doctor", "--json"]).stdout);
			let binding = report().checks.find((check) => check.id === "binding");
			expect(binding.code).toBe("metadata-missing");
			expect(binding.message).toContain("agent-session git-hygiene repair");
			expect(existsSync(metadata)).toBe(false);
			git(worktree, "branch", "-m", "fix/renamed-session");
			binding = report().checks.find((check) => check.id === "binding");
			expect(binding.code).toBe("metadata-missing-renamed");
			expect(binding.message).toContain("repair cannot recover");
			expect(binding.message).toContain("preserve all branches");
			expect(runCli(fixture.checkout, ["--", "doctor", "create"]).status).toBe(0);
			rmSync(sessionMetadataPath(fixture.checkout, "doctor"));
			const escaped = JSON.parse(runCli(fixture.checkout, ["--", "doctor", "doctor", "--json"]).stdout);
			expect(escaped.checks.find((check) => check.id === "binding").message).toContain("agent-session -- doctor repair");
			expect(existsSync(worktree)).toBe(true);
			expect(existsSync(metadata)).toBe(false);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("reports malformed, unsafe, missing and unrecorded bindings without repair and scopes named reports", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			const path = sessionMetadataPath(fixture.checkout, "git-hygiene");
			const original = readFileSync(path, "utf8");
			for (const contents of ["null", "TOKEN_SECRET", JSON.stringify({ ...JSON.parse(original), worktreePath: fixture.seed })]) {
				writeFileSync(path, contents);
				const result = runCli(fixture.checkout, ["git-hygiene", "doctor", "--json"]);
				expect(result.status).toBe(1);
				expect(JSON.parse(result.stdout).checks.some((check) => check.id === "binding" && check.status === "error")).toBe(true);
				const code = contents.startsWith("{") ? "metadata-path-mismatch" : "metadata-invalid";
				expect(JSON.parse(result.stdout).checks.some((check) => check.code === code)).toBe(true);
				expect(readFileSync(path, "utf8")).toBe(contents);
				const current = runCli(worktree, [".", "doctor", "--json"]);
				expect(current.status).toBe(1);
				expect(JSON.parse(current.stdout).ok).toBe(false);
				expect((current.stdout + current.stderr).includes("TOKEN_SECRET")).toBe(false);
			}
			writeFileSync(path, original);
			git(worktree, "branch", "-m", "feat/unrecorded-doctor");
			rmSync(path);
			const unrecorded = runCli(fixture.checkout, ["doctor", "--json"]);
			expect(unrecorded.status).toBe(1);
			expect(JSON.parse(unrecorded.stdout).checks.some((check) => check.slug === "git-hygiene" && check.status === "error")).toBe(true);
			expect(existsSync(path)).toBe(false);
			writeFileSync(path, original);
			const unknown = runCli(fixture.checkout, ["unknown", "doctor", "--json"]);
			expect(unknown.status).toBe(1);
			expect(JSON.parse(unknown.stdout).checks.some((check) => check.slug === "git-hygiene")).toBe(false);
			git(fixture.checkout, "worktree", "remove", "--force", worktree);
			const missing = JSON.parse(runCli(fixture.checkout, ["doctor", "--json"]).stdout);
			expect(missing.checks.some((check) => check.code === "worktree-missing")).toBe(true);
			mkdirSync(worktree);
			const unregistered = JSON.parse(runCli(fixture.checkout, ["doctor", "--json"]).stdout);
			expect(unregistered.checks.some((check) => check.code === "git-binding-invalid")).toBe(true);
			expect(readFileSync(path, "utf8")).toBe(original);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("checks link targets without reading secret contents or modifying missing and conflicting links", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			const configPath = runtimeConfigPath(fixture.checkout);
			const config = JSON.parse(readFileSync(configPath, "utf8"));
			config.local_links = [".private-local", ".optional-absent"];
			writeFileSync(configPath, JSON.stringify(config));
			const source = join(fixture.checkout, ".private-local");
			const target = join(worktree, ".private-local");
			writeFileSync(source, "DO_NOT_PRINT_LOCAL_SECRET");
			symlinkSync(source, target);
			expect(runCli(fixture.checkout, ["doctor", "--json"]).status).toBe(0);
			for (const conflict of ["absent", "file", "wrong-link"]) {
				rmSync(target, { force: true });
				if (conflict === "file") writeFileSync(target, "preserve user work");
				if (conflict === "wrong-link") symlinkSync(join(fixture.root, "missing"), target);
				const result = runCli(fixture.checkout, ["doctor", "--json"]);
				expect(result.status).toBe(1);
				expect(result.stdout.includes("DO_NOT_PRINT_LOCAL_SECRET")).toBe(false);
				expect(JSON.parse(result.stdout).checks.some((check) => check.id === "local-link" && check.status === "error")).toBe(true);
				if (conflict === "file") expect(readFileSync(target, "utf8")).toBe("preserve user work");
				if (conflict === "absent") expect(existsSync(target)).toBe(false);
			}
			config.local_links = ["../unsafe"];
			writeFileSync(configPath, JSON.stringify(config));
			expect(runCli(fixture.checkout, ["doctor", "--json"]).status).toBe(1);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("warns about existing and unreadable locks without acquiring, removing or claiming ownership", () => {
		const fixture = createRepositoryFixture();
		try {
			startManagedSession(fixture);
			const lock = join(fixture.checkout, ".git", "agent-session", "operation.lock");
			mkdirSync(lock);
			const owner = join(lock, "owner.json");
			for (const contents of [JSON.stringify({ pid: process.pid, command: "DO_NOT_PRINT_LOCK_SECRET", createdAt: new Date().toISOString() }), "broken owner"]) {
				writeFileSync(owner, contents);
				const result = runCli(fixture.checkout, ["doctor", "--json"]);
				expect(result.status).toBe(0);
				expect(JSON.parse(result.stdout).checks.some((check) => check.id === "lock" && check.status === "warning")).toBe(true);
				expect(result.stdout.includes("DO_NOT_PRINT_LOCK_SECRET")).toBe(false);
				expect(readFileSync(owner, "utf8")).toBe(contents);
			}
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("distinguishes shell artifacts from parent-shell state and keeps other checks when artifacts are missing", () => {
		const fixture = createRepositoryFixture();
		try {
			startManagedSession(fixture);
			const result = runCli(fixture.checkout, ["doctor", "--json"], { AGENT_SESSION_SHELL_ROOT: join(fixture.root, "missing"), AGENT_SESSION_COMPLETION_ROOT: "" });
			expect(result.status).toBe(1);
			const checks = JSON.parse(result.stdout).checks;
			expect(checks.some((check) => check.id === "shell-artifacts" && check.status === "error")).toBe(true);
			expect(checks.some((check) => check.id === "completion-artifacts" && check.status === "warning")).toBe(true);
			expect(checks.some((check) => check.id === "binding" && check.status === "ok")).toBe(true);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});

	it("uses only local read-only Git queries and leaves work, metadata, refs, index and locks byte-identical", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree, agentLog } = startManagedSession(fixture);
			writeFileSync(join(fixture.checkout, "dirty-primary"), "preserve primary");
			writeFileSync(join(worktree, "dirty-session"), "preserve session");
			git(fixture.checkout, "remote", "set-url", "origin", join(fixture.root, "offline"));
			const configPath = runtimeConfigPath(fixture.checkout);
			const config = JSON.parse(readFileSync(configPath, "utf8"));
			config.agent_command = ["DO_NOT_EXECUTE_AGENT_SECRET"];
			config.prepare_command = ["DO_NOT_EXECUTE_PREPARE_SECRET"];
			writeFileSync(configPath, JSON.stringify(config));
			const snapshot = (root: string): string => {
				const entries: string[] = [];
				const visit = (path: string) => {
					const stat = lstatSync(path);
					if (stat.isSymbolicLink()) entries.push(`${path}:${readlinkSync(path)}`);
					else if (stat.isDirectory()) { entries.push(`${path}/`); for (const name of readdirSync(path).sort()) visit(join(path, name)); }
					else entries.push(`${path}:${readFileSync(path).toString("base64")}`);
				};
				visit(root);
				return JSON.stringify(entries);
			};
			const before = snapshot(fixture.checkout);
			const realGit = spawnSync("bash", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
			const bin = join(fixture.root, "audit-bin");
			mkdirSync(bin);
			const log = join(fixture.root, "git-audit");
			writeFileSync(join(bin, "git"), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${tomlString(log)}\ncase "$1" in rev-parse) ;; worktree) [ "$2" = list ] || exit 99 ;; check-ignore) ;; *) exit 99 ;; esac\nexec ${tomlString(realGit)} "$@"\n`);
			chmodSync(join(bin, "git"), 0o755);
			const result = runCli(fixture.checkout, ["doctor", "--json"], { PATH: `${bin}:${process.env.PATH}` });
			expect(result.status).toBe(0);
			expect(JSON.parse(result.stdout).ok).toBe(true);
			expect(result.stdout.includes("DO_NOT_EXECUTE")).toBe(false);
			expect(readFileSync(log, "utf8").includes("check-ignore")).toBe(true);
			expect(snapshot(fixture.checkout) === before).toBe(true);
			expect(readFileSync(agentLog, "utf8").trim().split("\n").length).toBe(1);
			for (const option of ["--fix", "--repair", "--refresh"]) expect(runCli(fixture.checkout, ["doctor", option]).status).toBe(64);
		} finally { rmSync(fixture.root, { recursive: true, force: true }); }
	});
});

describe("explicit current-session targeting", () => {
	it("resolves roots and nested directories offline by verified path rather than the current branch name", () => {
		const fixture = createRepositoryFixture("agent current session ");
		try {
			const { worktree, agentLog } = startManagedSession(fixture);
			const original = readFileSync(sessionMetadataPath(fixture.checkout, "git-hygiene"), "utf8");
			git(worktree, "branch", "-m", "feat/renamed-current");
			const nested = join(worktree, "nested", "directory");
			mkdirSync(nested, { recursive: true });
			writeFileSync(join(fixture.checkout, "unfinished"), "primary work");
			writeFileSync(join(worktree, "unfinished"), "session work");
			git(fixture.checkout, "remote", "set-url", "origin", join(fixture.root, "offline"));
			for (const cwd of [worktree, nested]) {
				const status = runCli(cwd, [".", "status", "--json"]);
				expect(status.status).toBe(0);
				const session = JSON.parse(status.stdout).sessions[0];
				expect(session.slug).toBe("git-hygiene");
				expect(session.currentBranch).toBe("feat/renamed-current");
				const path = runCli(cwd, [".", "cd"]);
				expect(path.status).toBe(0);
				expect(path.stdout).toBe(`${worktree}\n`);
				expect(runCli(cwd, ["--", ".", "cd"]).stdout).toBe(`${worktree}\n`);
				expect(runCli(cwd, ["__complete", "targets"]).stdout.split("\n").includes(".")).toBe(true);
				const commands = runCli(cwd, ["__complete", "current-commands"]).stdout.split("\n");
				expect(commands.includes("run")).toBe(true);
				expect(commands.includes("create")).toBe(false);
				expect(commands.includes("start")).toBe(false);
				expect(commands.includes("repair")).toBe(false);
			}
			expect(readFileSync(sessionMetadataPath(fixture.checkout, "git-hygiene"), "utf8")).toBe(original);
			expect(readFileSync(agentLog, "utf8").trim().split("\n").length).toBe(1);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("rejects primary, unmanaged, same-basename and nested-repository contexts without falling back", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			const outside = join(fixture.root, "unmanaged");
			const sameName = join(fixture.root, "outside", "git-hygiene");
			git(fixture.checkout, "worktree", "add", "--detach", outside, "origin/master");
			git(fixture.checkout, "worktree", "add", "--detach", sameName, "origin/master");
			const nestedRepo = join(worktree, "nested-repository");
			git(worktree, "init", nestedRepo);
			for (const cwd of [fixture.checkout, outside, sameName, nestedRepo, fixture.root]) {
				for (const command of ["status", "cd"]) {
					const result = runCli(cwd, [".", command]);
					expect(result.status === 0).toBe(false);
					expect(result.stdout).toBe("");
				}
				expect(runCli(cwd, ["__complete", "targets"]).stdout.split("\n").includes(".")).toBe(false);
			}
			expect(existsSync(worktree)).toBe(true);
			expect(existsSync(sessionMetadataPath(fixture.checkout, "git-hygiene"))).toBe(true);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("requires a recorded valid binding and does not repair or execute on a guessed target", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			const path = sessionMetadataPath(fixture.checkout, "git-hygiene");
			const original = readFileSync(path, "utf8");
			rmSync(path);
			const unrecorded = runCli(worktree, [".", "status", "--json"]);
			expect(unrecorded.status).toBe(1);
			expect(unrecorded.stderr).toContain("no recorded managed session");
			expect(existsSync(path)).toBe(false);
			expect(runCli(worktree, ["__complete", "targets"]).stdout.split("\n").includes(".")).toBe(false);
			const bin = join(fixture.root, "bin");
			mkdirSync(bin);
			const executed = join(fixture.root, "unexpected-command");
			writeFileSync(join(bin, "devenv"), `#!/usr/bin/env bash\ntouch ${tomlString(executed)}\n`);
			chmodSync(join(bin, "devenv"), 0o755);
			for (const change of [{ worktreePath: fixture.seed }, { slug: "another-session" }]) {
				writeFileSync(path, JSON.stringify({ ...JSON.parse(original), ...change }));
				expect(runCli(worktree, [".", "run", "true"], { PATH: `${bin}:${process.env.PATH}` }).status).toBe(1);
				expect(existsSync(executed)).toBe(false);
			}
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("requires explicit slugs for creation, startup and metadata repair", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree, agentLog } = startManagedSession(fixture);
			const original = readFileSync(sessionMetadataPath(fixture.checkout, "git-hygiene"), "utf8");
			git(fixture.checkout, "remote", "set-url", "origin", join(fixture.root, "offline"));
			for (const command of ["create", "start", "repair"]) {
				const result = runCli(worktree, [".", command]);
				expect(result.status).toBe(64);
				expect(result.stderr).toContain("requires an explicit slug");
			}
			expect(readFileSync(sessionMetadataPath(fixture.checkout, "git-hygiene"), "utf8")).toBe(original);
			expect(readFileSync(agentLog, "utf8").trim().split("\n").length).toBe(1);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("preserves the invoking-worktree cleanup guard even for previews and forced finish", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree } = startManagedSession(fixture);
			const nested = join(worktree, "nested");
			mkdirSync(nested);
			for (const flags of [[], ["--dry-run", "--json"], ["--keep-branch", "--yes"], ["--force", "--yes"]]) {
				const result = runCli(nested, [".", "finish", ...flags]);
				expect(result.status).toBe(1);
				expect(result.stderr).toContain("Cannot remove the worktree containing the current shell");
				expect(existsSync(worktree)).toBe(true);
				expect(existsSync(sessionMetadataPath(fixture.checkout, "git-hygiene"))).toBe(true);
			}
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("uses the current binding for launch and resume without allocating another session", () => {
		const fixture = createRepositoryFixture();
		try {
			const { worktree, agentLog } = startManagedSession(fixture);
			const nested = join(worktree, "nested");
			mkdirSync(nested);
			expect(runCli(nested, [".", "launch"]).status).toBe(0);
			expect(runCli(nested, [".", "resume"]).status).toBe(0);
			expect(readFileSync(agentLog, "utf8")).toBe(`${worktree}\n${worktree}\n${worktree}\n`);
			expect(readFileSync(`${agentLog}.args`, "utf8")).toBe("\n\n--continue\n");
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	for (const shell of ["bash", "zsh", "fish"]) {
		it(`changes the current ${shell} directory from a nested current-session target`, () => {
			const fixture = createRepositoryFixture("agent current session ");
			try {
				const { worktree } = startManagedSession(fixture);
				const nested = join(worktree, "nested");
				mkdirSync(nested);
				const bin = installFixtureCLI(fixture);
				const script = shell === "fish"
					? 'source "$INTEGRATION"; as . cd; or exit; as -- . cd; or exit; printf "%s\\n" "$PWD"'
					: 'source "$INTEGRATION"; as . cd || exit; as -- . cd || exit; printf "%s\\n" "$PWD"';
				const result = spawnSync(shell, [shell === "fish" ? "--no-config" : shell === "bash" ? "--noprofile" : "-f", "-c", script], {
					cwd: nested,
					encoding: "utf8",
					env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, INTEGRATION: installedShellIntegration(shell), AGENT_SESSION_CONFIG: runtimeConfigPath(fixture.checkout) },
				});
				expect(result.status).toBe(0);
				expect(result.stdout).toBe(`${worktree}\n`);
			} finally {
				rmSync(fixture.root, { recursive: true, force: true });
			}
		});

		it(`offers only existing-session actions after the dot in ${shell}`, () => {
			const fixture = createRepositoryFixture();
			try {
				const { worktree } = startManagedSession(fixture);
				const bin = installFixtureCLI(fixture);
				const directory = join(fixture.root, "completions");
				mkdirSync(directory);
				const completion = runCli(worktree, ["completion", shell]);
				const path = join(directory, shell === "zsh" ? "_agent_session" : "completion");
				writeFileSync(path, completion.stdout.replaceAll("-c agent-session ", "-c as "));
				const script = shell === "fish" ? 'source "$COMPLETION"; complete -C "as . "'
					: shell === "bash" ? 'source "$COMPLETION"; COMP_WORDS=(as . ""); COMP_CWORD=2; _agent_session; printf "%s\\n" "${COMPREPLY[@]}"'
					: 'fpath=("$COMPLETION_DIR" $fpath); autoload -Uz compinit; compinit -D -i; _describe() { local name=$2; print -rl -- "${(@P)name}"; }; words=(as . ""); CURRENT=3; _agent_session';
				const result = spawnSync(shell, [shell === "fish" ? "--no-config" : shell === "bash" ? "--noprofile" : "-f", "-c", script], {
					cwd: worktree,
					encoding: "utf8",
					env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, COMPLETION: path, COMPLETION_DIR: directory, AGENT_SESSION_CONFIG: runtimeConfigPath(fixture.checkout) },
				});
				expect(result.status).toBe(0);
				expect(result.stdout).toContain("run");
				expect(result.stdout.includes("create")).toBe(false);
				expect(result.stdout.includes("start")).toBe(false);
				expect(result.stdout.includes("repair")).toBe(false);
			} finally {
				rmSync(fixture.root, { recursive: true, force: true });
			}
		});
	}
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
			const nested = join(worktree, "nested");
			mkdirSync(nested);
			const current = runCli(nested, [".", "run", ...command], {
				PATH: `${bin}:${process.env.PATH}`,
				DEVENV_LOG: log,
			});
			expect(current.status).toBe(23);
			expect(current.stdout).toBe(result.stdout);
			expect(current.stderr).toBe(result.stderr);
			const currentInvocation = JSON.parse(readFileSync(log, "utf8"));
			expect(currentInvocation.cwd).toBe(worktree);
			expect(JSON.stringify(currentInvocation.args)).toBe(JSON.stringify(invoked.args));
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
