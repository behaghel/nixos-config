import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn, execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEmacsBridge } from "../pi/client.ts";

let root, server, bridge, lastWire;
const lisp = (value) => JSON.stringify(value);

before(async () => {
  root = await mkdtemp(join(tmpdir(), "pe-"));
  const env = { ...process.env, HOME: root, XDG_CACHE_HOME: root, XDG_CONFIG_HOME: root };
  let diagnostic = "";
  server = spawn("emacs", ["--batch", "-Q", "--eval", `(progn
    (message "PI-EMACS-TEST: process started")
    (setq user-emacs-directory ${lisp(root)} server-name "p"
          server-socket-dir ${lisp(root)} server-auth-dir ${lisp(root)} server-use-tcp nil)
    (require 'server) (message "PI-EMACS-TEST: server library loaded")
    (server-start) (message "PI-EMACS-TEST: socket started")
    (write-region "ready" nil ${lisp(join(root, "ready"))} nil 'silent)
    (while t (accept-process-output nil 0.05)))`], { env, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      clearInterval(poll);
      reject(new Error(`Fixture server startup timed out: ${diagnostic}`));
    }, 30000);
    const poll = setInterval(() => {
      access(join(root, "ready")).then(() => {
        clearTimeout(timer); clearInterval(poll); resolve();
      }, () => {});
    }, 25);
    server.stderr.on("data", (chunk) => { diagnostic = (diagnostic + chunk).slice(-2048); });
    server.on("error", (error) => { clearTimeout(timer); clearInterval(poll); reject(error); });
    server.on("exit", (code) => { clearTimeout(timer); clearInterval(poll); reject(new Error(`Fixture server exited ${code}: ${diagnostic}`)); });
  });
  bridge = createEmacsBridge((command, args, options) => new Promise((resolve) => {
    execFile(command, args, { env, timeout: options.timeout, maxBuffer: options.maxBuffer,
      signal: options.signal }, (error, stdout, stderr) => {
      lastWire = { stdout, stderr };
      resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
        killed: Boolean(error?.killed), truncated: error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        stdout, stderr });
    });
  }));
});

after(async () => {
  if (server && server.exitCode === null) {
    await new Promise((resolve) => {
      const timer = setTimeout(() => { server.kill("SIGKILL"); resolve(); }, 2000);
      server.once("exit", () => { clearTimeout(timer); resolve(); });
      server.kill("SIGTERM");
    });
  }
  if (root) await rm(root, { recursive: true, force: true });
});

const evaluate = (expression, options = {}) => bridge.evaluate({ socket: join(root, "p"), expression, ...options });
const inspect = (options = {}) => bridge.status({ socket: join(root, "p"), ...options });

test("real Emacs framing returns arithmetic and Unicode without shell quoting", async () => {
  assert.deepEqual(await evaluate("(+ 1 2)"), { status: "ok", mayHaveEffects: true,
    value: "3", truncated: false });
  const result = await evaluate('(list "Bépo 😀" "two\\nlines")');
  assert.equal(result.status, "ok", JSON.stringify(lastWire));
  assert(result.value.includes("Bépo 😀"));
  assert(result.value.includes("two\\nlines"));
});

test("real status exposes only metadata", async () => {
  const result = await inspect();
  assert.equal(result.status, "ok");
  assert.equal(typeof result.metadata.pid, "number");
  assert.equal(typeof result.metadata.version, "string");
  assert.equal(typeof result.metadata.buffer, "string");
  assert(!("value" in result));
  assert(!("contents" in result.metadata));
});

test("selected window and both source/target points survive a live mutation", async () => {
  assert.equal((await evaluate(`(progn
    (switch-to-buffer (get-buffer-create "pi-test-A"))
    (erase-buffer) (insert "abcdef") (goto-char 3)
    (with-current-buffer (get-buffer-create "pi-test-B")
      (erase-buffer) (insert "12345") (goto-char 4)) t)`, { preserveContext: false })).status, "ok");
  const result = await evaluate(`(progn (goto-char 1)
    (switch-to-buffer "pi-test-A") (goto-char 6) (setq pi-test-mutated t))`, { buffer: "pi-test-B" });
  assert.equal(result.status, "ok");
  assert.equal((await inspect()).metadata.buffer, "pi-test-A");
  assert.equal((await inspect()).metadata.point, 3);
  assert.equal((await inspect({ buffer: "pi-test-B" })).metadata.point, 4);
  assert.equal((await evaluate("pi-test-mutated")).value, "t");
});

test("selectively reload one definition without evaluating unrelated source forms", async () => {
  const source = join(root, "fixture.el");
  await writeFile(source, '(defun pi-test-reloaded () "fresh")\n(setq pi-test-unrelated-loaded t)\n');
  await evaluate('(defun pi-test-reloaded () "old")');
  const result = await evaluate(`(progn
    (with-temp-buffer (insert-file-contents ${lisp(source)}) (goto-char (point-min))
      (condition-case nil
        (while t (let ((form (read (current-buffer))))
          (when (and (eq (car-safe form) 'defun) (eq (cadr form) 'pi-test-reloaded))
            (eval form t)))) (end-of-file nil)))
    (list (pi-test-reloaded) (boundp 'pi-test-unrelated-loaded)))`);
  assert.equal(result.status, "ok");
  assert.equal(result.value, '("fresh" nil)');
  assert.equal((await inspect()).metadata.point, 3);
});

test("errors preserve prior effects but do not disclose arbitrary error data", async () => {
  const result = await evaluate('(progn (setq pi-test-effect "kept") (error "do-not-leak"))');
  assert.equal(result.status, "error");
  assert.equal(result.errorKind, "error");
  assert.equal(result.mayHaveEffects, true);
  assert(!JSON.stringify(result).includes("do-not-leak"));
  assert.equal((await evaluate("pi-test-effect")).value, '"kept"');
});

test("multiple top-level forms are rejected before the first form runs", async () => {
  const result = await evaluate("(setq pi-test-multiple t) (+ 1 2)");
  assert.equal(result.status, "error");
  assert.equal((await evaluate("(boundp 'pi-test-multiple)")).value, "nil");
});

test("oversized results are bounded without writing a full-output file", async () => {
  const result = await evaluate("(make-string 6000 ?x)");
  assert.equal(result.status, "ok");
  assert.equal(result.truncated, true);
  assert.equal(result.value.length, 4096);
});

test("missing buffers are not created and absent servers do not start Emacs", async () => {
  assert.equal((await inspect({ buffer: "pi-test-absent" })).status, "error");
  assert.equal((await evaluate('(get-buffer "pi-test-absent")')).value, "nil");
  const pid = (await inspect()).metadata.pid;
  const missing = await bridge.status({ socket: join(root, "missing"), timeoutMs: 500 });
  assert.equal(missing.status, "unknown");
  assert.equal(missing.mayHaveEffects, false);
  assert.equal((await inspect()).metadata.pid, pid);
});
