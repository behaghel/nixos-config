import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import extension from "../pi/extension.ts";

function load() {
  const commands = new Map(), messages = [];
  extension({
    registerCommand(name, definition) {
      assert.ok(!commands.has(name), `duplicate command: ${name}`);
      commands.set(name, definition);
    },
    sendUserMessage(content, options) { messages.push({ content, options }); },
  });
  return { commands, messages };
}

test("registers only the four requested reflection commands without starting work", async () => {
  const { commands, messages } = load();
  assert.deepEqual([...commands.keys()].sort(), ["reflect:all", "reflect:arch", "reflect:efficiency", "reflect:quality"]);
  assert.equal(messages.length, 0);
  for (const [name, dimensions] of [
    ["reflect:all", "efficiency, quality, and architecture"],
    ["reflect:arch", "architecture"],
    ["reflect:efficiency", "efficiency"],
    ["reflect:quality", "quality"],
  ]) {
    assert.ok(commands.get(name).description);
    await commands.get(name).handler("", { cwd: "/another/project", isIdle: () => true });
    const { content, options } = messages.at(-1);
    assert.ok(content.includes(`Requested dimensions: ${dimensions}.`));
    assert.ok(content.includes("current project"));
    assert.ok(content.includes("Do not assert a defect without evidence"));
    assert.ok(content.includes("Selection for drafting alone is not creation approval"));
    assert.ok(content.includes("Never publish raw session content"));
    assert.ok(!content.includes(".agents/skills/session-reflection/SKILL.md"));
    assert.deepEqual(options, { deliverAs: "followUp" });
  }
  assert.equal(messages.length, 4);
});

test("preserves optional user focus and queues rather than interrupting active work", async () => {
  const { commands, messages } = load();
  await commands.get("reflect:quality").handler("Focus on the recent test changes", { isIdle: () => false });
  assert.ok(messages[0].content.includes("Focus on the recent test changes"));
  assert.deepEqual(messages[0].options, { deliverAs: "followUp" });
});

test("loads the bundled skill from an unrelated working directory", () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-reflection-"));
  try {
    const script = `import extension from ${JSON.stringify(new URL("../pi/extension.ts", import.meta.url).href)};
const commands = new Map();
extension({registerCommand(name, definition) { commands.set(name, definition); }, sendUserMessage(content) { console.log(content); }});
await commands.get('reflect:all').handler('', {cwd: process.cwd()});`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes("Requested dimensions: efficiency, quality, and architecture."));
    assert.ok(result.stdout.includes("obtaining explicit approval"));
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("the native package declares and ships its extension and portable skill", () => {
  const root = new URL("../", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  assert.ok(manifest.keywords.includes("pi-package"));
  assert.deepEqual(manifest.pi.extensions, ["./pi/extension.ts"]);
  assert.deepEqual(manifest.pi.skills, ["./skills"]);
  for (const file of ["pi/extension.ts", "skills/session-reflection/SKILL.md", "README.md"]) assert.ok(existsSync(new URL(file, root)));
  assert.ok(!manifest.dependencies?.["@earendil-works/pi-coding-agent"]);
});
