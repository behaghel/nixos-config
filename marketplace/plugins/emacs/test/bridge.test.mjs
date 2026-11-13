import assert from "node:assert/strict";
import { test } from "node:test";
import { createEmacsBridge } from "../pi/client.ts";
import { registerEmacsTools } from "../pi/tools.ts";

const wire = (payload) => JSON.stringify(Buffer.from(JSON.stringify(payload), "utf8").toString("base64")) + "\n";
const success = { code: 0, killed: false, truncated: false,
  stdout: wire({ ok: true, value: "3", truncated: false }), stderr: "" };
const schema = new Proxy({}, { get: () => (...args) => ({ args }) });

function fixture(result = success, entries = [], sessionId = "session-a") {
  const calls = [];
  const tools = new Map();
  const commands = new Map();
  const handlers = new Map();
  const pi = {
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (name, definition) => commands.set(name, definition),
    appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
    exec: async (...args) => { calls.push(args); return result; },
    registerTool: (definition) => tools.set(definition.name, definition),
  };
  registerEmacsTools(pi, schema);
  const context = (select, hasUI = true) => ({ ...ctx(select, hasUI),
    sessionManager: { getSessionId: () => sessionId, getEntries: () => entries } });
  return { calls, tools, commands, handlers, entries, context,
    bridge: createEmacsBridge(pi.exec) };
}

const ctx = (select, hasUI = true) => ({ hasUI, cwd: "/tmp",
  ui: { select, notify() {}, setStatus() {} } });

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
    undefined, undefined, ctx(async () => "Deny"));
  assert.equal(result.details.status, "not-executed");
  assert.equal(calls.length, 0);
});

test("approval is per call and displays the exact target and expression", async () => {
  const { calls, tools } = fixture();
  let confirmations = 0;
  const context = ctx(async (title, options) => {
    confirmations++;
    assert(title.includes("scratch"));
    assert(title.includes("test-server"));
    assert(title.includes("(+ 1 2)"));
    assert.deepEqual(options, ["Deny", "Allow once", "Allow for this session"]);
    return "Allow once";
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
    controller.signal, undefined, ctx(async () => { controller.abort(); return "Allow for this session"; }));
  assert.equal(result.details.status, "not-executed");
  assert.equal(calls.length, 0);
});

test("session allowance applies to different Elisp and survives resume/reload", async () => {
  const first = fixture();
  const context = first.context(async () => "Allow for this session");
  const statuses = [];
  context.ui.setStatus = (...args) => statuses.push(args);
  const evaluate = (f, expression, c) => f.tools.get("emacs_eval")
    .execute("id", { expression }, undefined, undefined, c);
  assert.equal((await evaluate(first, "(+ 1 2)", context)).details.status, "ok");
  assert.equal(first.entries.length, 1);
  assert(statuses.some(([, text]) => text?.includes("never")));
  for (const reason of ["resume", "reload", "startup"]) {
    const resumed = fixture(success, first.entries);
    const c = resumed.context(() => { throw new Error("Unexpected prompt"); });
    await resumed.handlers.get("session_start")({ reason }, c);
    assert.equal((await evaluate(resumed, "(setq other t)", c)).details.status, "ok");
  }
});

test("emacs-ask reports, changes and persistently revokes the session setting", async () => {
  const f = fixture();
  const c = f.context(async () => "Deny");
  const notices = [];
  c.ui.notify = (message) => notices.push(message);
  const command = f.commands.get("emacs-ask");
  await command.handler("", c);
  assert.match(notices.at(-1), /always/);
  assert.equal(f.entries.length, 0);
  await command.handler("never", c);
  assert.match(notices.at(-1), /never/);
  await command.handler("invalid", c);
  assert.equal(f.entries.length, 1);
  await command.handler("always", c);
  const resumed = fixture(success, f.entries);
  const rc = resumed.context(async () => "Deny");
  await resumed.handlers.get("session_start")({ reason: "resume" }, rc);
  const result = await resumed.tools.get("emacs_eval").execute("id",
    { expression: "(+ 1 2)" }, undefined, undefined, rc);
  assert.equal(result.details.status, "not-executed");
  assert.equal(resumed.calls.length, 0);
});

test("new and forked sessions never inherit allowance, even after resuming the fork", async () => {
  const parent = fixture();
  await parent.commands.get("emacs-ask").handler("never", parent.context());
  for (const reason of ["new", "fork", "resume", "startup"]) {
    const child = fixture(success, [...parent.entries], "session-child");
    const c = child.context(async () => "Deny");
    await child.handlers.get("session_start")({ reason }, c);
    const result = await child.tools.get("emacs_eval").execute("id",
      { expression: "(+ 1 2)" }, undefined, undefined, c);
    assert.equal(result.details.status, "not-executed");
    assert.equal(child.calls.length, 0);
  }
});

test("dismissed, interrupted or cancelled approval cannot grant session allowance", async () => {
  for (const choice of [undefined, "Deny", "unexpected", "throw", "abort"]) {
    const f = fixture();
    const controller = new AbortController();
    const c = f.context(async () => {
      if (choice === "throw") throw new Error("UI interrupted");
      if (choice === "abort") { controller.abort(); return "Allow for this session"; }
      return choice;
    });
    const result = await f.tools.get("emacs_eval").execute("id",
      { expression: "(+ 1 2)" }, controller.signal, undefined, c);
    assert.equal(result.details.status, "not-executed");
    assert.equal(f.entries.length, 0);
    assert.equal(f.calls.length, 0);
  }
});

test("session allowance still respects no-UI and pre-aborted calls", async () => {
  const f = fixture();
  await f.commands.get("emacs-ask").handler("never", f.context());
  const controller = new AbortController(); controller.abort();
  for (const [c, signal] of [[f.context(undefined, false), undefined],
    [f.context(), controller.signal]]) {
    const result = await f.tools.get("emacs_eval").execute("id",
      { expression: "(+ 1 2)" }, signal, undefined, c);
    assert.equal(result.details.status, "not-executed");
  }
  assert.equal(f.calls.length, 0);
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
