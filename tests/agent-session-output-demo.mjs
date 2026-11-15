// Manual acceptance fixture: never creates or retires a real project session.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [mode = "create", ...flags] = process.argv.slice(2);
if (!["create", "start", "failure"].includes(mode) || flags.some((flag) => !["--verbose", "--color=auto", "--color=always", "--color=never"].includes(flag))) {
  throw new Error("Use: node tests/agent-session-output-demo.mjs [create|start|failure] [--verbose] [--color=auto|always|never]");
}
const root = mkdtempSync(join(tmpdir(), "as-output-demo-"));
const checkout = join(root, "checkout");
const remote = join(root, "remote.git");
const env = { ...process.env, PI_SESSION_FILE: "", PI_SESSION_ID: "" };
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
  writeFileSync(join(checkout, ".gitignore"), ".worktrees/\n");
  git(checkout, "add", ".");
  // This unsigned commit belongs only to the disposable fixture repository.
  git(checkout, "-c", "commit.gpgsign=false", "commit", "-m", "Initialize demo fixture");
  git(checkout, "remote", "add", "origin", remote);
  git(checkout, "push", "-u", "origin", "master");
  git(remote, "symbolic-ref", "HEAD", "refs/heads/master");
  const config = join(checkout, ".git", "demo-config.json");
  writeFileSync(config, JSON.stringify({
    version: 1, worktree_root: ".worktrees", local_links: [], disposable_paths: [], generated_links: {},
    agent_command: [process.execPath, "-e", "console.log('Agent stdout remains visible'); console.error('Agent stderr remains visible');"],
    prepare_command: [process.execPath, "-e", `console.log('Demo preparation stdout'); console.error('Demo preparation stderr'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200); ${mode === "failure" ? "process.exit(7);" : ""}`],
  }));
  const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../modules/flake/agent-session/cli.ts");
  const result = spawnSync(process.execPath, [cli, "demo", mode === "start" ? "start" : "create", ...flags], {
    cwd: checkout, env: { ...env, AGENT_SESSION_CONFIG: config }, stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
