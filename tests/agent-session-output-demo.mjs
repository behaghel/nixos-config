// Manual acceptance fixture: never creates or retires a real project session.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [mode = "create", ...flags] = process.argv.slice(2);
if (!["create", "start", "failure", "busy", "preview", "finish", "partial", "preferences"].includes(mode) || flags.some((flag) => !["--verbose", "--color=auto", "--color=always", "--color=never"].includes(flag))) {
  throw new Error("Use: node tests/agent-session-output-demo.mjs [create|start|failure|busy|preview|finish|partial|preferences] [--verbose] [--color=auto|always|never]");
}
const root = mkdtempSync(join(tmpdir(), "as-output-demo-"));
const checkout = join(root, "checkout");
const remote = join(root, "remote.git");
const env = { ...process.env, PI_SESSION_FILE: "", PI_SESSION_ID: "" };
let worker;
function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || "Fixture Git command failed");
}
try {
  process.stdout.write("Disposable local demo; its resources are removed on exit.\n\n");
  git(root, "init", "--bare", remote);
  git(root, "init", "-b", "master", checkout);
  git(checkout, "config", "user.name", "Agent Session Demo");
  git(checkout, "config", "user.email", "demo@example.invalid");
  writeFileSync(join(checkout, "README.md"), "# Disposable output demo\n");
  writeFileSync(join(checkout, ".gitignore"), ".worktrees/\n.cache/\n");
  git(checkout, "add", ".");
  // This unsigned commit belongs only to the disposable fixture repository.
  git(checkout, "-c", "commit.gpgsign=false", "commit", "-m", "Initialize demo fixture");
  git(checkout, "remote", "add", "origin", remote);
  git(checkout, "push", "-u", "origin", "master");
  git(remote, "symbolic-ref", "HEAD", "refs/heads/master");
  const config = join(checkout, ".git", "demo-config.json");
  writeFileSync(config, JSON.stringify({
    version: 1, worktree_root: ".worktrees", local_links: [], disposable_paths: [".cache"], generated_links: {},
    agent_command: [process.execPath, "-e", "console.log('Agent stdout remains visible'); console.error('Agent stderr remains visible');"],
    prepare_command: ["busy", "preview", "finish", "partial", "preferences"].includes(mode) ? [] : [process.execPath, "-e", `console.log('Demo preparation stdout'); console.error('Demo preparation stderr'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200); ${mode === "failure" ? "process.exit(7);" : ""}`],
  }));
  const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../modules/flake/agent-session/cli.ts");
  const options = { cwd: checkout, env: { ...env, AGENT_SESSION_CONFIG: config } };
  if (["busy", "preview", "finish", "partial", "preferences"].includes(mode)) {
    const prepared = spawnSync(process.execPath, [cli, "demo", "create", "--json"], { ...options, encoding: "utf8" });
    if (prepared.status !== 0) throw new Error(prepared.stderr || "Cannot prepare demo fixture");
    const worktree = JSON.parse(prepared.stdout).session.worktreePath;
    if (mode === "preferences") {
      const personal = join(root, "personal-config");
      mkdirSync(join(personal, "agent-session"), { recursive: true });
      writeFileSync(join(personal, "agent-session", "config.json"), JSON.stringify({ color: "always" }));
      options.env = { ...options.env, XDG_CONFIG_HOME: personal };
      process.stdout.write("Temporary personal preference: color=always. Flags and NO_COLOR still apply.\n\n");
    }
    if (mode === "busy") {
      const nested = join(worktree, "nested"); mkdirSync(nested);
      worker = spawn(process.execPath, ["-e", "console.log('ready'); setInterval(() => {}, 1000)"], { cwd: nested, stdio: ["ignore", "pipe", "ignore"] });
      await new Promise((resolve, reject) => { worker.once("error", reject); worker.stdout.once("data", resolve); worker.once("exit", () => reject(new Error("Demo worker stopped before readiness"))); });
      process.stdout.write("A disposable worker is active inside the clean worktree. Cleanup must refuse.\n\n");
      const result = spawnSync(process.execPath, [cli, "demo", "finish", "--keep-branch", "--yes", ...flags], { ...options, stdio: "inherit" });
      if (result.error) throw result.error;
      if (result.status !== 1 || !existsSync(worktree)) throw new Error("Expected cleanup refusal with the demo worktree retained");
      process.exitCode = result.status;
    } else {
      mkdirSync(join(worktree, ".cache"));
      writeFileSync(join(worktree, ".cache", "tasks.sqlite"), "Disposable fixture database contents\n");
      if (!["preview", "preferences"].includes(mode)) {
        const bin = join(checkout, ".git", "demo-bin"); mkdirSync(bin);
        const executable = spawnSync("sh", ["-c", "command -v git"], { env, encoding: "utf8" }).stdout.trim();
        // Slow only this fixture's native cleanup so intermediate rows are visible.
        writeFileSync(join(bin, "git"), `#!/bin/sh\ncase "$1:$2" in worktree:remove|branch:-D) ${JSON.stringify(process.execPath)} -e 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 900)' ;; esac\n${mode === "partial" ? 'if [ "$1" = branch ] && [ "$2" = -D ]; then printf "Demo native branch deletion failed\\n" >&2; exit 1; fi\n' : ""}exec ${JSON.stringify(executable)} "$@"\n`, { mode: 0o755 });
        options.env = { ...options.env, PATH: `${bin}:${env.PATH}` };
      }
      if (mode === "partial") process.stdout.write("Approve to demonstrate an injected branch-deletion failure after native worktree removal.\n\n");
      const result = spawnSync(process.execPath, [cli, "demo", "finish", ...(mode === "partial" ? [] : ["--keep-branch"]), ...(["preview", "preferences"].includes(mode) ? ["--dry-run"] : []), ...flags], { ...options, stdio: "inherit" });
      if (result.error) throw result.error;
      process.exitCode = result.status ?? 1;
    }
  } else {
    const result = spawnSync(process.execPath, [cli, "demo", mode === "start" ? "start" : "create", ...flags], { ...options, stdio: "inherit" });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  }
} finally {
  if (worker && worker.exitCode === null && worker.signalCode === null) {
    const closed = new Promise((resolve) => worker.once("close", resolve));
    worker.kill(); await closed;
  }
  rmSync(root, { recursive: true, force: true });
}
