import assert from "node:assert/strict";
import { test } from "node:test";
import { registerSessionActivity } from "../pi/session-activity.ts";

function harness({ active = true, hasUI = true, exec } = {}) {
  const handlers = new Map();
  const calls = [], warnings = [];
  const pi = {
    on(event, handler) { handlers.set(event, handler); },
    async exec(...args) {
      calls.push(args);
      return exec ? exec(...args) : { code: 0, stdout: "", stderr: "" };
    },
  };
  const ctx = { cwd: "/project/.worktrees/task", hasUI,
    ui: { notify: (...args) => warnings.push(args) } };
  registerSessionActivity(pi, () => active);
  const emit = async (name, event = {}) => handlers.get(name)?.(event, ctx);
  return { handlers, calls, warnings, ctx, emit };
}

test("records session entry and user/assistant messages while Pi stays open", async () => {
  const h = harness();
  await h.emit("session_start", { reason: "startup" });
  await h.emit("message_end", { message: { role: "user", content: "Pick this up" } });
  await h.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "On it" }] } });
  assert.equal(h.calls.length, 3);
  for (const [command, args, options] of h.calls) {
    assert.equal(command, "agent-session");
    assert.deepEqual(args, [".", "activity", "touch"]);
    assert.equal(options.cwd, h.ctx.cwd);
    assert(options.timeout > 0 && options.timeout <= 5000);
  }
  assert.equal(h.handlers.has("session_shutdown"), false);
});

test("does not record tool results, tool-only or thinking-only assistant messages, or idle events", async () => {
  const h = harness();
  for (const message of [
    { role: "toolResult", content: [{ type: "text", text: "done" }] },
    { role: "assistant", content: [{ type: "toolCall", name: "bash" }] },
    { role: "assistant", content: [{ type: "thinking", thinking: "working" }] },
    { role: "assistant", content: [{ type: "text", text: "  " }] },
    { role: "custom", content: "extension notice" },
  ]) await h.emit("message_end", { message });
  for (const name of ["message_update", "tool_call", "tool_result", "agent_end", "agent_settled", "session_shutdown"]) {
    await h.emit(name, { message: { role: "assistant", content: [{ type: "text", text: "stream" }] } });
  }
  assert.equal(h.calls.length, 0);
});

test("records visible assistant text alongside tool calls, and image-only user messages", async () => {
  const h = harness();
  await h.emit("message_end", { message: { role: "assistant", content: [
    { type: "text", text: "Checking that now" }, { type: "toolCall", name: "read" },
  ] } });
  await h.emit("message_end", { message: { role: "user", content: [{ type: "image", data: "not-recorded" }] } });
  assert.equal(h.calls.length, 2);
  assert(!JSON.stringify(h.calls).includes("not-recorded"));
  assert(!JSON.stringify(h.calls).includes("Checking that now"));
});

test("session replacement uses its current cwd rather than a cached session target", async () => {
  const h = harness();
  await h.emit("session_start", { reason: "resume" });
  h.ctx.cwd = "/other/.worktrees/new-task";
  await h.emit("session_start", { reason: "fork" });
  assert.equal(h.calls[0][2].cwd, "/project/.worktrees/task");
  assert.equal(h.calls[1][2].cwd, h.ctx.cwd);
});

test("does nothing outside a detected devenv project", async () => {
  const h = harness({ active: false });
  await h.emit("session_start");
  await h.emit("message_end", { message: { role: "user", content: "hello" } });
  assert.equal(h.calls.length, 0);
});

test("unmanaged contexts are quiet, while unsupported capabilities warn once without interrupting Pi", async () => {
  const h = harness({ exec: async () => ({ code: 1, stderr: "The primary checkout has no current managed session; use an explicit slug." }) });
  await h.emit("session_start");
  assert.equal(h.warnings.length, 0);
  const old = harness({ exec: async () => ({ code: 64, stderr: "Use: agent-session <slug> activity reconcile" }) });
  await old.emit("session_start");
  await old.emit("message_end", { message: { role: "user", content: "hello" } });
  assert.equal(old.warnings.length, 1);
  assert.match(old.warnings[0][0], /activity touch/);
});

test("a transient write failure does not disable later activity recording", async () => {
  let attempts = 0;
  const h = harness({ exec: async () => {
    if (++attempts === 1) throw new Error("fixture process failure");
    return { code: 0, stdout: "", stderr: "" };
  } });
  await h.emit("session_start");
  await h.emit("message_end", { message: { role: "user", content: "try again" } });
  assert.equal(h.calls.length, 2);
  assert.equal(h.warnings.length, 1);
});
