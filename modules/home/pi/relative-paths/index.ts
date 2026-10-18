import { execFileSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Marked } from "@earendil-works/pi-tui";
import { findProjectRoot, linkifyMarkdown } from "./core.ts";

export default function (pi: ExtensionAPI) {
  if (typeof pi.registerMarkdownTransformer !== "function") {
    pi.on("session_start", (_event, ctx) => {
      if (ctx.hasUI) ctx.ui.notify("Relative file links require an updated Pi with Markdown transformers.", "warning");
    });
    return;
  }

  const marked = new Marked();
  let root: string | undefined;
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    let workonRoot: string | undefined;
    if (process.env.TMUX && process.env.TMUX_PANE) {
      try {
        workonRoot = execFileSync("tmux", ["show-options", "-wqv", "-t", process.env.TMUX_PANE, "@workon_dir"], {
          encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000,
        }).trim();
      } catch { /* Non-workon windows simply use Git or Pi's cwd. */ }
    }
    root = findProjectRoot(ctx.cwd, workonRoot);
  });

  pi.registerMarkdownTransformer((markdown, context) => {
    if (!root || context.messageType !== "assistant") return markdown;
    return linkifyMarkdown(markdown, root, marked);
  });
}
