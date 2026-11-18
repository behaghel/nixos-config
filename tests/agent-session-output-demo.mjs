// Manual acceptance fixture: never creates or retires a real project session.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [mode = "create", ...flags] = process.argv.slice(2);
const branchFlags = ["tree-preview", "tree-preview-blocked", "bulk-preview", "preview", "finish", "preferences", "branches", "tree-review", "tree-review-failure", "history", "history-failure", "bulk", "bulk-failure", "bulk-review", "bulk-review-failure"].includes(mode) ? ["--keep-branch", "--delete-branches"] : [];
if (!["tree-preview", "tree-preview-blocked", "bulk-preview", "create", "start", "failure", "busy", "preview", "finish", "partial", "preferences", "branches", "batch", "batch-failure", "tree", "tree-failure", "tree-review", "tree-review-failure", "history", "history-failure", "bulk", "bulk-failure", "bulk-review", "bulk-review-failure"].includes(mode) || flags.some((flag) => !["--verbose", "--color=auto", "--color=always", "--color=never", ...branchFlags, ...(["bulk-preview", "bulk", "bulk-failure", "bulk-review", "bulk-review-failure"].includes(mode) ? ["--force"] : [])].includes(flag))) {
  throw new Error("Use: node tests/agent-session-output-demo.mjs [create|start|failure|busy|preview|bulk-preview|tree-preview|tree-preview-blocked|finish|partial|preferences|branches|batch|batch-failure|tree|tree-failure|tree-review|tree-review-failure|history|history-failure|bulk|bulk-failure|bulk-review|bulk-review-failure] [--verbose] [--color=auto|always|never]; cleanup demos also accept explicit branch flags");
}
const root = mkdtempSync(join(tmpdir(), "as-output-demo-"));
const checkout = join(root, "checkout");
const remote = join(root, "remote.git");
const env = { ...process.env, PI_SESSION_FILE: "", PI_SESSION_ID: "", XDG_CONFIG_HOME: join(root, "personal-config") };
let worker;
function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || "Fixture Git command failed");
  return result.stdout.trim();
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
    prepare_command: ["tree-preview", "tree-preview-blocked", "bulk-preview", "busy", "preview", "finish", "partial", "preferences", "branches", "batch", "batch-failure", "tree", "tree-failure", "tree-review", "tree-review-failure", "history", "history-failure", "bulk", "bulk-failure", "bulk-review", "bulk-review-failure"].includes(mode) ? [] : [process.execPath, "-e", `console.log('Demo preparation stdout'); console.error('Demo preparation stderr'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200); ${mode === "failure" ? "process.exit(7);" : ""}`],
  }));
  const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../modules/flake/agent-session/cli.ts");
  const options = { cwd: checkout, env: { ...env, AGENT_SESSION_CONFIG: config } };
  if (["tree-preview", "tree-preview-blocked", "bulk-preview", "busy", "preview", "finish", "partial", "preferences", "branches", "batch", "batch-failure", "tree", "tree-failure", "tree-review", "tree-review-failure", "history", "history-failure", "bulk", "bulk-failure", "bulk-review", "bulk-review-failure"].includes(mode)) {
    const prepared = spawnSync(process.execPath, [cli, "demo", "create", "--json"], { ...options, encoding: "utf8" });
    if (prepared.status !== 0) throw new Error(prepared.stderr || "Cannot prepare demo fixture");
    const worktree = JSON.parse(prepared.stdout).session.worktreePath;
    if (mode === "preferences" || mode === "branches") {
      const personal = join(root, "personal-config");
      mkdirSync(join(personal, "agent-session"), { recursive: true });
      writeFileSync(join(personal, "agent-session", "config.json"), JSON.stringify(mode === "branches" ? { branches: "delete" } : { color: "always" }));
      options.env = { ...options.env, XDG_CONFIG_HOME: personal };
      process.stdout.write(mode === "branches" ? "Temporary personal preference: branches=delete. Eligible deletion still requires your approval.\n\n" : "Temporary personal preference: color=always. Flags and NO_COLOR still apply.\n\n");
    }
    if (["bulk-preview", "bulk", "bulk-failure", "bulk-review", "bulk-review-failure"].includes(mode)) {
      const preview = mode === "bulk-preview";
      const interactive = mode.startsWith("bulk-review");
      const forced = flags.includes("--force");
      const targets = new Map([["demo", worktree]]);
      for (const slug of ["second", "dirty"]) {
        const created = spawnSync(process.execPath, [cli, slug, "create", "--json"], { ...options, encoding: "utf8" });
        if (created.status !== 0) throw new Error(created.stderr || "Cannot prepare bulk fixture");
        targets.set(slug, JSON.parse(created.stdout).session.worktreePath);
      }
      writeFileSync(join(targets.get("dirty"), "unfinished.txt"), "Retain this local fixture work\n");
      const failed = mode.endsWith("failure");
      const bin = join(checkout, ".git", "demo-bin"); mkdirSync(bin);
      const executable = spawnSync("sh", ["-c", "command -v git"], { env, encoding: "utf8" }).stdout.trim();
      const fail = failed ? `target="$3"; if [ "$3" = --force ]; then target="$4"; fi; if [ "$target" = ${JSON.stringify(worktree)} ]; then rm "$target/README.md"; printf 'Demo bulk stdout evidence\\n'; printf 'Demo bulk native removal failed\\n' >&2; exit 1; fi\n` : "";
      writeFileSync(join(bin, "git"), `#!/bin/sh\nif [ "$1" = worktree ] && [ "$2" = remove ]; then ${JSON.stringify(process.execPath)} -e 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 900)'; ${fail}fi\nexec ${JSON.stringify(executable)} "$@"\n`, { mode: 0o755 });
      const disposition = flags.some((flag) => ["--keep-branch", "--delete-branches"].includes(flag)) ? [] : ["--keep-branch"];
      process.stdout.write(preview ? "Previewing disposable repository-wide proposals. No approval, fetch or cleanup is performed. Dirty work is preserved unless force is explicitly previewed.\n\n" : interactive ? "Review this disposable repository-wide plan. Blocked targets remain unapproved; legacy bulk still exits 0 for per-target failures after Yes.\n\n" : "Applying the existing explicit --yes bulk protocol to disposable resources. Dirty work is refused unless force is explicit. Legacy bulk exits 0 even for refused/uncertain targets; inspect the outcome table.\n\n");
      const result = spawnSync(process.execPath, [cli, "finish", "--all", ...(preview ? ["--dry-run"] : !interactive ? ["--yes"] : []), ...disposition, ...flags], { ...options, env: { ...options.env, PATH: `${bin}:${env.PATH}` }, stdio: "inherit" });
      if (result.error) throw result.error;
      const cancelled = interactive && result.status === 1 && [...targets.values()].every((target) => existsSync(target));
      if (preview) {
        if (result.status !== 0 || [...targets.values()].some((target) => !existsSync(target))) throw new Error("Preview changed disposable resources");
      } else if (!cancelled && (result.status !== 0 || existsSync(worktree) !== failed || existsSync(targets.get("second")) || existsSync(targets.get("dirty")) !== !forced)) throw new Error("Unexpected disposable bulk outcome");
      const keep = disposition.length > 0 || flags.includes("--keep-branch");
      for (const [slug, target] of targets) if (git(checkout, "branch", "--list", `agent/${slug}`).includes(`agent/${slug}`) !== (keep || existsSync(target))) throw new Error("Unexpected disposable bulk branch disposition");
      process.exitCode = result.status;
    } else if (mode === "history" || mode === "history-failure") {
      git(worktree, "switch", "-c", "demo/one"); git(worktree, "switch", "-c", "demo/two");
      mkdirSync(join(worktree, ".cache"));
      writeFileSync(join(worktree, ".cache", "tasks.sqlite"), "Disposable task database\n");
      const created = spawnSync(process.execPath, [cli, "retained", "create", "--json"], { ...options, encoding: "utf8" });
      if (created.status !== 0) throw new Error(created.stderr || "Cannot prepare retained fixture");
      const retained = JSON.parse(created.stdout).session;
      const bin = join(checkout, ".git", "demo-bin"); mkdirSync(bin);
      const executable = spawnSync("sh", ["-c", "command -v git"], { env, encoding: "utf8" }).stdout.trim();
      const failed = mode === "history-failure";
      const fail = failed ? 'rm "$4/README.md"; printf "Demo history stdout evidence\\n"; printf "Demo history native removal failed\\n" >&2; exit 1;' : "";
      writeFileSync(join(bin, "git"), `#!/bin/sh\nif [ "$1" = worktree ] && [ "$2" = remove ]; then ${JSON.stringify(process.execPath)} -e 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 900)'; ${fail}fi\nexec ${JSON.stringify(executable)} "$@"\n`, { mode: 0o755 });
      process.stdout.write("Review the disposable worktree and historical local refs below. Checkout history is not ownership; the retained worktree is outside this selection.\n\n");
      const result = spawnSync(process.execPath, [cli, "demo", "finish", "--branches", ...flags], { ...options, env: { ...options.env, PATH: `${bin}:${env.PATH}` }, stdio: "inherit" });
      if (result.error) throw result.error;
      if (result.status !== (failed ? 1 : 0) || existsSync(worktree) !== failed || !existsSync(retained.worktreePath)) throw new Error("Unexpected historical fixture outcome");
      const preserve = failed || !flags.includes("--delete-branches") || flags.includes("--keep-branch");
      for (const name of ["agent/demo", "demo/one", "demo/two"]) if (git(checkout, "branch", "--list", name).includes(name) !== preserve) throw new Error("Unexpected historical ref disposition");
      if (!git(checkout, "branch", "--list", "agent/retained").includes("agent/retained")) throw new Error("Unrelated fixture ref changed");
      process.exitCode = result.status ?? 1;
    } else if (mode === "tree-preview" || mode === "tree-preview-blocked") {
      const create = (cwd, slug) => {
        const result = spawnSync(process.execPath, [cli, slug, "create", "--json"], { ...options, cwd, encoding: "utf8" });
        if (result.status !== 0) throw new Error(result.stderr || "Cannot prepare recursive preview fixture");
        return JSON.parse(result.stdout).session;
      };
      const child = create(worktree, "child"), grandchild = create(child.worktreePath, "grandchild"), retained = create(checkout, "retained");
      mkdirSync(join(child.worktreePath, ".cache")); writeFileSync(join(child.worktreePath, ".cache", "tasks.sqlite"), "Retain disposable artifact\n");
      if (mode === "tree-preview-blocked") writeFileSync(join(grandchild.worktreePath, "unfinished.txt"), "Retain local fixture work\n");
      const records = ["demo", "child", "grandchild", "retained"].map((slug) => {
        const path = join(checkout, ".git", "agent-session", "sessions", `${slug}.json`);
        return [path, readFileSync(path, "utf8")];
      });
      const refs = git(checkout, "for-each-ref", "--format=%(refname):%(objectname)");
      const bin = join(checkout, ".git", "demo-bin"); mkdirSync(bin);
      const executable = spawnSync("sh", ["-c", "command -v git"], { env, encoding: "utf8" }).stdout.trim();
      writeFileSync(join(bin, "git"), `#!/bin/sh\nif [ "$1" = status ]; then ${JSON.stringify(process.execPath)} -e 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)'; fi\nexec ${JSON.stringify(executable)} "$@"\n`, { mode: 0o755 });
      process.stdout.write("Read-only disposable tree preview, descendants first. No approval, fetch or cleanup. Retained is outside the selection; a blocked descendant preserves the whole tree proposal.\n\n");
      const result = spawnSync(process.execPath, [cli, "demo", "finish", "--all", "--dry-run", ...flags], { ...options, env: { ...options.env, PATH: `${bin}:${env.PATH}` }, stdio: "inherit" });
      if (result.error) throw result.error;
      if (result.status !== 0 || [worktree, child.worktreePath, grandchild.worktreePath, retained.worktreePath].some((path) => !existsSync(path))) throw new Error("Recursive preview changed disposable resources");
      if (git(checkout, "for-each-ref", "--format=%(refname):%(objectname)") !== refs || records.some(([path, content]) => readFileSync(path, "utf8") !== content)) throw new Error("Recursive preview changed refs or metadata");
      if (readFileSync(join(child.worktreePath, ".cache", "tasks.sqlite"), "utf8") !== "Retain disposable artifact\n") throw new Error("Recursive preview changed artifact data");
      process.exitCode = result.status;
    } else if (["tree", "tree-failure", "tree-review", "tree-review-failure"].includes(mode)) {
      const interactive = mode.startsWith("tree-review");
      const create = (cwd, slug) => {
        const result = spawnSync(process.execPath, [cli, slug, "create", "--json"], { ...options, cwd, encoding: "utf8" });
        if (result.status !== 0) throw new Error(result.stderr || "Cannot prepare tree fixture");
        return JSON.parse(result.stdout).session;
      };
      const child = create(worktree, "child"), grandchild = create(child.worktreePath, "grandchild"), retained = create(checkout, "retained");
      if (interactive) {
        mkdirSync(join(grandchild.worktreePath, ".cache"));
        writeFileSync(join(grandchild.worktreePath, ".cache", "tasks.sqlite"), "Disposable task database\n");
      }
      const common = ["demo", "finish", "--all", ...(!interactive ? ["--keep-branch"] : [])];
      const preview = spawnSync(process.execPath, [cli, ...common, "--dry-run", "--json"], { ...options, encoding: "utf8" });
      if (preview.status !== 0) throw new Error(preview.stderr || "Cannot approve tree fixture");
      const approved = JSON.parse(preview.stdout);
      if (!approved.executionSupported || approved.resources.length !== 3) throw new Error("Expected one executable three-resource fixture tree");
      const bin = join(checkout, ".git", "demo-bin"); mkdirSync(bin);
      const executable = spawnSync("sh", ["-c", "command -v git"], { env, encoding: "utf8" }).stdout.trim();
      const fail = mode.endsWith("failure") ? `if [ "$4" = ${JSON.stringify(child.worktreePath)} ]; then rm "$4/README.md"; printf 'Demo native removal stdout\\n'; printf 'Demo native removal failed after a partial effect\\n' >&2; exit 1; fi\n` : "";
      writeFileSync(join(bin, "git"), `#!/bin/sh\nif [ "$1" = worktree ] && [ "$2" = remove ]; then ${JSON.stringify(process.execPath)} -e 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 900)'; ${fail}fi\nexec ${JSON.stringify(executable)} "$@"\n`, { mode: 0o755 });
      process.stdout.write(interactive ? "Review the disposable tree and its branch disposition below. The unrelated retained worktree is outside the selection.\n\n" : "Applying an approved disposable tree, descendants first. The unrelated retained worktree and all branches stay preserved.\n\n");
      const result = spawnSync(process.execPath, [cli, ...common, ...(!interactive ? ["--expected", approved.receipt, "--yes"] : []), ...flags], { ...options, env: { ...options.env, PATH: `${bin}:${env.PATH}` }, stdio: "inherit" });
      if (result.error) throw result.error;
      const failed = mode.endsWith("failure");
      if (result.status !== (failed ? 1 : 0) || existsSync(grandchild.worktreePath) || existsSync(child.worktreePath) !== failed || existsSync(worktree) !== failed || !existsSync(retained.worktreePath)) throw new Error("Unexpected disposable tree outcome");
      for (const slug of ["demo", "child", "grandchild", "retained"]) {
        const preserved = slug === "retained" || failed || !interactive || !flags.includes("--delete-branches") || flags.includes("--keep-branch");
        if (git(checkout, "branch", "--list", `agent/${slug}`).includes(`agent/${slug}`) !== preserved) throw new Error("Unexpected disposable branch disposition");
      }
      process.exitCode = result.status ?? 1;
    } else if (mode === "batch" || mode === "batch-failure") {
      for (const slug of ["other", "retained"]) {
        const created = spawnSync(process.execPath, [cli, slug, "create", "--json"], { ...options, encoding: "utf8" });
        if (created.status !== 0) throw new Error(created.stderr || "Cannot prepare batch fixture");
      }
      const old = new Date("2000-01-01T00:00:00Z");
      for (const slug of ["demo", "other", "retained"]) {
        const path = join(checkout, ".git", "agent-session", "sessions", `${slug}.json`);
        const metadata = JSON.parse(readFileSync(path, "utf8"));
        metadata.createdAt = old.toISOString(); metadata.lastWorkAt = old.toISOString();
        writeFileSync(path, JSON.stringify(metadata));
        const target = metadata.worktreePath;
        for (const log of [git(target, "rev-parse", "--git-path", "logs/HEAD"), join(checkout, ".git", "logs", "refs", "heads", "agent", slug)]) {
          writeFileSync(log, readFileSync(log, "utf8").replace(/ \d+ [+-]\d{4}(?=\t|\n|$)/g, " 946684800 +0000"));
        }
        for (const file of git(target, "ls-files").split("\n")) utimesSync(join(target, file), old, old);
      }
      const common = ["batch", "finish", "--inactive-for", "7d", "--exclude", "retained"];
      const preview = spawnSync(process.execPath, [cli, ...common, "--dry-run", "--json"], { ...options, encoding: "utf8" });
      if (preview.status !== 0) throw new Error(preview.stderr || "Cannot approve batch fixture");
      const approved = JSON.parse(preview.stdout);
      const eligible = approved.resources.filter((resource) => resource.reason === "eligible").length;
      if (eligible !== 2) throw new Error(`Expected two eligible disposable targets, received ${eligible}`);
      if (mode === "batch-failure") writeFileSync(join(checkout, ".worktrees", "other", "README.md"), "New local work after approval\n");
      const bin = join(checkout, ".git", "demo-bin"); mkdirSync(bin);
      const executable = spawnSync("sh", ["-c", "command -v git"], { env, encoding: "utf8" }).stdout.trim();
      writeFileSync(join(bin, "git"), `#!/bin/sh\nif [ "$1" = worktree ] && [ "$2" = remove ]; then ${JSON.stringify(process.execPath)} -e 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 900)'; fi\nexec ${JSON.stringify(executable)} "$@"\n`, { mode: 0o755 });
      process.stdout.write("Applying the existing receipt/--yes protocol to two disposable targets; retained is excluded. All branches stay preserved.\n\n");
      const result = spawnSync(process.execPath, [cli, ...common, "--expected", approved.receipt, "--yes", ...flags], { ...options, env: { ...options.env, PATH: `${bin}:${env.PATH}` }, stdio: "inherit" });
      if (result.error) throw result.error;
      if (result.status !== (mode === "batch-failure" ? 1 : 0) || existsSync(worktree) || !existsSync(join(checkout, ".worktrees", "retained"))) throw new Error("Unexpected disposable batch outcome");
      for (const slug of ["demo", "other", "retained"]) if (!git(checkout, "branch", "--list", `agent/${slug}`).includes(`agent/${slug}`)) throw new Error("Disposable branch was not preserved");
      process.exitCode = result.status ?? 1;
    } else if (mode === "busy") {
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
      const result = spawnSync(process.execPath, [cli, "demo", "finish", ...(mode === "partial" ? ["--delete-branches"] : []), ...(["preview", "preferences"].includes(mode) ? ["--dry-run"] : []), ...flags], { ...options, stdio: "inherit" });
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
