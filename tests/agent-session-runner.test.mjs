import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { runShards, shardPatterns } from "./agent-session-runner.mjs";

function fakeProcesses(outcomes = {}) {
  const launches = [];
  let active = 0;
  let peak = 0;
  function spawn(command, args, options) {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const index = launches.length;
    launches.push({ command, args, options });
    peak = Math.max(peak, ++active);
    setTimeout(() => {
      child.stdout.end(`test output ${index}\n`);
      child.stderr.end(`test diagnostic ${index}\n`);
      --active;
      if (outcomes[index] === "error") {
        child.emit("error", new Error("unable to launch bun"));
        child.emit("close", null, null);
      } else {
        child.emit("close", outcomes[index] ?? 0, null);
      }
    }, 10);
    return child;
  }
  return { spawn, launches, get peak() { return peak; } };
}

function outputBuffer() {
  let text = "";
  return { write(chunk) { text += chunk; }, get text() { return text; } };
}

test("patterns select each existing suite and future suites exactly once", () => {
  const names = ["a newly added suite", "receipt-bound recursive finish extra"];
  for (const file of ["agent-session.test.ts", "agent-session-templates.test.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    names.push(...Array.from(source.matchAll(/^describe\("([^"]+)"/gm), (match) => match[1]));
  }
  assert(names.length > 30);
  for (const name of names) {
    for (const fullName of [name, `${name} nested suite an example test`]) {
      assert.equal(shardPatterns.filter((pattern) => new RegExp(pattern).test(fullName)).length, 1, fullName);
    }
  }
  assert.equal(shardPatterns.length, 4);
  assert.equal(new Set(names.map((name) => shardPatterns.findIndex((pattern) => new RegExp(pattern).test(name)))).size, 4);
});

test("Bun executes every current and newly added suite exactly once", async () => {
  const names = ["a newly added suite"];
  for (const file of ["agent-session.test.ts", "agent-session-templates.test.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    names.push(...Array.from(source.matchAll(/^describe\("([^"]+)"/gm), (match) => match[1]));
  }
  const directory = mkdtempSync(join(tmpdir(), "agent-session-runner-test-"));
  try {
    mkdirSync(join(directory, "tests"));
    const tests = names.map((name) => `describe(${JSON.stringify(name)}, () => {
      test("example", () => console.log("executed-suite=" + ${JSON.stringify(name)}));
    });`).join("\n");
    writeFileSync(join(directory, "tests/agent-session.test.ts"), `import {describe, test} from "bun:test";\n${tests}\n`);
    writeFileSync(join(directory, "tests/agent-session-templates.test.ts"), "");
    const output = outputBuffer();
    const spawnProcess = (command, args, options) => spawn(command, args, { ...options, cwd: directory });
    assert.equal(await runShards({ spawnProcess, output }), 0, output.text);
    const executed = Array.from(output.text.matchAll(/executed-suite=([^\n]+)/g), (match) => match[1]);
    assert.deepEqual(executed.sort(), names.sort());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runs all shards with bounded concurrency and isolated writable state", async () => {
  const processes = fakeProcesses();
  const output = outputBuffer();
  const env = { PATH: "/fixture/bin", AGENT_SESSION_CONFIG: "/fixture/config" };
  assert.equal(await runShards({ jobs: 2, spawnProcess: processes.spawn, output, env }), 0);
  assert.equal(processes.peak, 2);
  assert(output.text.includes("Agent-session shards passed in"));
  assert.equal(processes.launches.length, 4);
  assert.equal(new Set(processes.launches.map(({ options }) => options.env.HOME)).size, 4);
  assert.equal(new Set(processes.launches.map(({ options }) => options.env.TMPDIR)).size, 4);
  for (const [index, { command, args, options }] of processes.launches.entries()) {
    assert.equal(command, "bun");
    assert.deepEqual(args.slice(0, 4), ["test", "./tests/agent-session.test.ts", "./tests/agent-session-templates.test.ts", "--timeout"]);
    assert.equal(args[4], "90000");
    assert.equal(args.at(-1), shardPatterns[index]);
    assert.equal(options.env.AGENT_SESSION_CONFIG, env.AGENT_SESSION_CONFIG);
    assert.equal(options.env.PATH, env.PATH);
    assert(output.text.includes(`[agent-session ${index + 1}/4] test output ${index}`));
    assert(output.text.includes(`[agent-session ${index + 1}/4] test diagnostic ${index}`));
  }
  assert.deepEqual(env, { PATH: "/fixture/bin", AGENT_SESSION_CONFIG: "/fixture/config" });
});

for (const failure of [1, "error"]) {
  test(`fails the aggregate on shard ${failure} but waits for every shard`, async () => {
    const processes = fakeProcesses({ 0: failure });
    const output = outputBuffer();
    assert.equal(await runShards({ jobs: 2, spawnProcess: processes.spawn, output }), 1);
    assert.equal(processes.launches.length, 4);
    assert(output.text.includes("test diagnostic 3"));
    assert(output.text.includes("Agent-session shards failed in"));
    if (failure === "error") assert(output.text.includes("unable to launch bun"));
  });
}

test("supports sequential execution and rejects invalid concurrency", async () => {
  const processes = fakeProcesses();
  assert.equal(await runShards({ jobs: 1, spawnProcess: processes.spawn, output: outputBuffer() }), 0);
  assert.equal(processes.peak, 1);
  for (const jobs of [0, -1, 1.5, 5, NaN]) {
    await assert.rejects(() => runShards({ jobs, spawnProcess: processes.spawn }), /jobs/);
  }
});
