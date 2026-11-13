import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createEmacsBridge, notExecuted } from "./client.ts";
import type { Result } from "./client.ts";

function output(result: Result) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    details: result, isError: result.status !== "ok" };
}

function display(text: string): string {
  // Never interpret terminal controls in an approval dialog.
  return text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export function registerEmacsTools(pi: ExtensionAPI, Type: typeof import("typebox").Type) {
  const bridge = createEmacsBridge((command, args, options) => pi.exec(command, args, options));
  const entryType = "emacs-ask";
  let ask: "always" | "never" = "always";
  const showStatus = (ctx: ExtensionContext) => {
    if (ctx.hasUI) ctx.ui.setStatus(entryType, ask === "never" ? "Emacs ask: never" : undefined);
  };
  const setAsk = (value: typeof ask, ctx: ExtensionContext) => {
    // Bind approval to this session: forks can copy entries, but not this ID.
    pi.appendEntry(entryType, { sessionId: ctx.sessionManager.getSessionId(), ask: value });
    ask = value;
    showStatus(ctx);
  };
  pi.on("session_start", (_event, ctx) => {
    ask = "always";
    // This preference is session-wide, not conversation-branch-relative: tree
    // navigation must not resurrect an allowance revoked on another branch.
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type !== "custom" || entry.customType !== entryType) continue;
      const data = entry.data as { sessionId?: string; ask?: unknown } | undefined;
      if (data?.sessionId === ctx.sessionManager.getSessionId()) {
        ask = data.ask === "never" ? "never" : "always";
      }
    }
    showStatus(ctx);
  });
  pi.registerCommand("emacs-ask", {
    description: "Show or set Emacs evaluation approval: always|never (this session, including resume). Never allows any Elisp with full Emacs privileges.",
    getArgumentCompletions: (prefix) => ["always", "never"]
      .filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      const value = args.trim();
      if (value && value !== "always" && value !== "never") {
        ctx.ui.notify("Usage: /emacs-ask [always|never]", "error");
        return;
      }
      if (value) setAsk(value, ctx);
      ctx.ui.notify(`Emacs ask: ${ask}. ${ask === "never"
        ? "Any Elisp is allowed in this session, including after resume. Full Emacs privileges; use /emacs-ask always to revoke."
        : "Each evaluation requires approval."}`, ask === "never" ? "warning" : "info");
    },
  });
  const common = {
    socket: Type.Optional(Type.String({ minLength: 1, description: "Existing local server socket name/path." })),
    buffer: Type.Optional(Type.String({ minLength: 1, description: "Existing target buffer; defaults to the selected window's buffer." })),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 30000, description: "Client wait deadline, not a server-side cancellation guarantee." })),
  };
  pi.registerTool({
    name: "emacs_status",
    label: "Emacs status",
    description: "Inspect predefined metadata in an existing Emacs server. No buffer contents, variable values, credentials or server startup. Output is bounded.",
    promptSnippet: "Inspect metadata in an already running local Emacs server",
    promptGuidelines: ["Use emacs_status before selecting a target for live Emacs work; it reads metadata, not document contents."],
    parameters: Type.Object(common),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    executionMode: "sequential",
    async execute(_id, params, signal) {
      return output(await bridge.status(params, signal));
    },
  });
  pi.registerTool({
    name: "emacs_eval",
    label: "Evaluate in Emacs",
    description: "Evaluate one Elisp expression in an existing Emacs server after human confirmation unless the user enabled session-wide approval. Results enter Pi history. Prints at most 4096 characters; client output is capped at 64 KiB. No auto-start or retry; timeout/abort may leave evaluation running.",
    promptSnippet: "Evaluate explicitly approved Elisp or selectively reload definitions in a live Emacs session",
    promptGuidelines: [
      "emacs_eval asks approval unless the user enabled session-wide approval. Never enable approval yourself, claim read-only exemption, or bypass denial through bash.",
      "Never use emacs_eval to return credentials, environment dumps, full backend/authentication records, or other secrets.",
      "Use emacs_eval for narrowly targeted, tested changes; do not reload init.el or unrelated modules. Persist accepted fixes in tracked source.",
      "Never automatically retry emacs_eval after cancellation, timeout, truncation, or unknown execution status. Prior effects are not rolled back.",
    ],
    parameters: Type.Object({ ...common,
      expression: Type.String({ minLength: 1, maxLength: 8192, description: "One expression; wrap multiple forms in progn. Return only explicitly selected, nonsensitive data." }),
      preserveContext: Type.Optional(Type.Boolean({ description: "Default true: best-effort window/buffer-point restoration, not rollback." })),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    executionMode: "sequential",
    async execute(_id, params, signal, _update, ctx) {
      if (signal?.aborted) return output(notExecuted("Cancelled before approval."));
      if (!ctx.hasUI) return output(notExecuted("Elisp requires an interactive confirmation UI; no execution occurred."));
      if (ask === "never") return output(await bridge.evaluate(params, signal));
      const body = display(`Server: ${params.socket ?? "default local socket"}\nBuffer: ${params.buffer ?? "selected window's buffer"}\nPreserve context: ${params.preserveContext !== false}\n\n${params.expression}\n\nElisp has full Emacs privileges. Results enter Pi history. Context preservation is not rollback; client cancellation does not stop server-side evaluation.`);
      let choice: string | undefined;
      try {
        choice = await ctx.ui.select(`Allow this Emacs evaluation?\n\n${body}\n\n“Allow for this session” permits ANY Elisp, including after resume. Revoke with /emacs-ask always.`,
          ["Deny", "Allow once", "Allow for this session"], { signal });
      } catch {
        return output(notExecuted("Approval was interrupted; no execution occurred."));
      }
      if (signal?.aborted || (choice !== "Allow once" && choice !== "Allow for this session")) {
        return output(notExecuted("Not approved; no execution occurred."));
      }
      if (choice === "Allow for this session") setAsk("never", ctx);
      return output(await bridge.evaluate(params, signal));
    },
  });
}
