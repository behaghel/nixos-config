import assert from "node:assert/strict";
import { test } from "node:test";
import { createEmacsBridge } from "../pi/client.ts";
import { registerEmacsTools } from "../pi/tools.ts";

const wire = (payload) => JSON.stringify(Buffer.from(JSON.stringify(payload), "utf8").toString("base64")) + "\n";
const success = { code: 0, killed: false, truncated: false,
  stdout: wire({ ok: true, value: "3", truncated: false }), stderr: "" };
const schema = new Proxy({}, { get: () => (...args) => ({ args }) });

function fixture(result = success) {
  const calls = [];
  const tools = new Map();
  const pi = {
    exec: async (...args) => { calls.push(args); return result; },
    registerTool: (definition) => tools.set(definition.name, definition),
  };
  registerEmacsTools(pi, schema);
  return { calls, tools, bridge: createEmacsBridge(pi.exec) };
}

const ctx = (confirm, hasUI = true) => ({ hasUI, cwd: "/tmp", ui: { confirm } });

test("metadata inspection does not ask approval or launch an alternate editor", async () => {
  const { calls, tools } = fixture({ ...success, stdout: wire({ ok: true,
    metadata: { version: "30.2", buffer: "notes.org" } }) });
  const result = await tools.get("emacs_status").execute("id", {}, undefined, undefined,
    ctx(() => { throw new Error("Unexpected approval"); }));
  assert.equal(result.details.status, "ok");
  assert.equal(result.details.metadata.buffer, "notes.org");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "emacsclient");
  assert(calls[0][1].includes("--alternate-editor=false"));
  assert(!calls[0][1].includes("--create-frame"));
  assert.equal(tools.get("emacs_status").annotations.readOnlyHint, true);
});

test("raw evaluation is denied without UI, including a claimed approval flag", async () => {
  const { calls, tools } = fixture();
  const result = await tools.get("emacs_eval").execute("id",
    { expression: "(setq example t)", approved: true }, undefined, undefined, ctx(() => true, false));
  assert.equal(result.details.status, "not-executed");
  assert.equal(result.isError, true);
  assert.equal(calls.length, 0);
});

test("denying confirmation invokes no client", async () => {
  const { calls, tools } = fixture();
  const result = await tools.get("emacs_eval").execute("id", { expression: "(+ 1 2)" },
    undefined, undefined, ctx(async () => false));
  assert.equal(result.details.status, "not-executed");
  assert.equal(calls.length, 0);
});

test("approval is per call and displays the exact target and expression", async () => {
  const { calls, tools } = fixture();
  let confirmations = 0;
  const context = ctx(async (_title, body) => {
    confirmations++;
    assert(body.includes("scratch"));
    assert(body.includes("test-server"));
    assert(body.includes("(+ 1 2)"));
    return true;
  });
  const tool = tools.get("emacs_eval");
  for (let i = 0; i < 2; i++) {
    const result = await tool.execute("id", { expression: "(+ 1 2)", buffer: "scratch",
      socket: "test-server" }, undefined, undefined, context);
    assert.equal(result.details.value, "3");
  }
  assert.equal(confirmations, 2);
  assert.equal(calls.length, 2);
  assert(calls[0][1].includes("--socket-name=test-server"));
  assert.equal(tool.executionMode, "sequential");
  assert.equal(tool.annotations.idempotentHint, false);
});

test("aborting approval never evaluates", async () => {
  const { calls, tools } = fixture();
  const controller = new AbortController();
  const result = await tools.get("emacs_eval").execute("id", { expression: "(+ 1 2)" },
    controller.signal, undefined, ctx(async () => { controller.abort(); return true; }));
  assert.equal(result.details.status, "not-executed");
  assert.equal(calls.length, 0);
});

test("transport timeout, cancellation and overflow are ambiguous and never retried", async () => {
  for (const result of [
    { ...success, code: 1, killed: true },
    { ...success, code: 1, killed: true, truncated: true },
    { ...success, stdout: "partial protocol" },
  ]) {
    const { bridge, calls } = fixture(result);
    const response = await bridge.evaluate({ expression: "(setq example t)" });
    assert.equal(response.status, "unknown");
    assert.equal(response.mayHaveEffects, true);
    assert.equal(calls.length, 1);
  }
});

test("a Lisp error is not rollback and reports no arbitrary error data", async () => {
  const { bridge } = fixture({ ...success, stdout: wire({ ok: false, errorKind: "error" }) });
  const result = await bridge.evaluate({ expression: '(progn (setq example t) (error "private"))' });
  assert.equal(result.status, "error");
  assert.equal(result.mayHaveEffects, true);
  assert(!JSON.stringify(result).includes("private"));
});

test("client capture, waiting and selected-context restoration are explicit", async () => {
  const { bridge, calls } = fixture();
  await bridge.evaluate({ expression: '(list "two words" "😀")', timeoutMs: 1200 });
  assert.equal(calls[0][2].timeout, 1200);
  assert(calls[0][2].maxBuffer <= 65536);
  assert(calls[0][1].at(-1).includes("save-window-excursion"));
  assert(calls[0][1].at(-1).includes("save-excursion"));
});

test("invalid arguments and pre-aborted calls do not invoke the client", async () => {
  const { bridge, calls } = fixture();
  for (const params of [{ expression: "" }, { expression: "x", timeoutMs: 0 },
    { expression: "x", socket: "a\0b" }]) {
    assert.equal((await bridge.evaluate(params)).status, "not-executed");
  }
  const controller = new AbortController(); controller.abort();
  assert.equal((await bridge.evaluate({ expression: "x" }, controller.signal)).status, "not-executed");
  assert.equal(calls.length, 0);
});

test("failed transport does not leak stderr into diagnostics", async () => {
  const { bridge } = fixture({ ...success, code: 1, stderr: "secret-backend-record", stdout: "" });
  const result = await bridge.status({});
  assert.equal(result.status, "unknown");
  assert(!JSON.stringify(result).includes("secret-backend-record"));
});
