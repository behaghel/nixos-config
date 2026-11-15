import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

// Balance the expensive, independent top-level suites across processes. Keep
// each suite sequential: its hooks and deliberately racing operations stay
// together. Unlisted suites always run in shard zero, including future tests.
const groups = [
  [
    "verified local-link retirement", "agent-session finish",
    "PR review session creation", "explicit current-session targeting",
    "guarded inactive batch finish", "batch inspection evidence and scaling",
    "reviewed legacy ownership mapping", "explicit unrecorded-worktree retirement",
    "session-scoped recursive preview", "metadata-only inventory",
    "PR dependency diagnostics",
  ],
  [
    "receipt-bound recursive finish", "independent work from a PR",
    "agent-session diagnostics and completions", "cheap inventory and exact resource inspection",
  ],
  [
    "Node terminal confirmation", "receipt-bound artifact disposal",
    "historical PRs and release bases", "agent-session cd and run",
    "human finish workflow", "read-only doctor", "inactive-session batch preview",
    "explicit session branch ownership", "agent-session status, launch, and resume",
    "recent-first inventory table", "recursive scope completion guidance",
  ],
];
const escapeRegex = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const prefixes = groups.map((names) => `(?:${names.map(escapeRegex).join("|")})(?:\\s|$)`);
export const shardPatterns = [
  `^(?!(?:${prefixes.join("|")}))`,
  ...prefixes.map((prefix) => `^${prefix}`),
];

export async function runShards({ jobs = 4, spawnProcess = spawn, output = process.stdout, env = process.env } = {}) {
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 4) throw new Error("jobs must be an integer from 1 to 4");
  const startedAt = performance.now();
  let next = 0;
  let failed = false;
  output.write(`Agent-session: 4 shards, at most ${jobs} concurrent processes\n`);
  async function worker() {
    while (next < shardPatterns.length) {
      const index = next++;
      const prefix = `[agent-session ${index + 1}/4]`;
      const directory = mkdtempSync(join(tmpdir(), "agent-session-shard-"));
      const home = join(directory, "home");
      const temporary = join(directory, "tmp");
      mkdirSync(home);
      mkdirSync(temporary);
      try {
        const child = spawnProcess("bun", [
          "test", "./tests/agent-session.test.ts", "./tests/agent-session-templates.test.ts",
          "--timeout", "90000", "--test-name-pattern", shardPatterns[index],
        ], {
          env: { ...env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), TMPDIR: temporary },
          stdio: ["ignore", "pipe", "pipe"],
        });
        for (const stream of [child.stdout, child.stderr]) {
          createInterface({ input: stream }).on("line", (line) => output.write(`${prefix} ${line}\n`));
        }
        const status = await new Promise((resolve) => {
          child.on("error", (error) => output.write(`${prefix} ${error.message}\n`));
          child.on("close", (code) => resolve(code));
        });
        if (status !== 0) failed = true;
      } catch (error) {
        failed = true;
        output.write(`${prefix} ${error.message}\n`);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  }
  await Promise.all(Array.from({ length: jobs }, worker));
  output.write(`Agent-session shards ${failed ? "failed" : "passed"} in ${((performance.now() - startedAt) / 1000).toFixed(2)}s\n`);
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--jobs")) {
    throw new Error("Use: node tests/agent-session-runner.mjs [--jobs 1..4]");
  }
  const jobs = args.length ? Number(args[1]) : Math.min(4, Number(process.env.NIX_BUILD_CORES) || availableParallelism());
  process.exitCode = await runShards({ jobs });
}
