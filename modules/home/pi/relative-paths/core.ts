import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Marked, Token } from "@earendil-works/pi-tui";

export function findProjectRoot(cwd: string, workonRoot?: string): string {
  try {
    return execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000,
    }).trim();
  } catch {
    return workonRoot || cwd;
  }
}

// Use Pi's own Markdown lexer, so code blocks, images and existing links are
// not mistaken for inline path mentions. Only the rendered Markdown changes.
export function linkifyMarkdown(markdown: string, root: string, marked: Marked): string {
  function fileURL(path: string, isLink: boolean): string | undefined {
    if (!path || /[\x00-\x1f\x7f]/.test(path) || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(path)) return;
    let fragment = "";
    if (isLink) {
      const hash = path.indexOf("#");
      if (hash >= 0) {
        fragment = path.slice(hash);
        path = path.slice(0, hash);
      }
      try { path = decodeURIComponent(path); } catch { return; }
    }
    const absolute = path.startsWith("~/")
      ? resolve(homedir(), path.slice(2)) : resolve(root, path);
    try {
      if (!statSync(absolute).isFile()) return;
      return pathToFileURL(absolute).href + fragment;
    } catch {
      return;
    }
  }

  function children(token: Token): Token[] {
    if (token.type === "list") return token.items;
    if (token.type === "table") return [...token.header, ...token.rows.flat()].flatMap(cell => cell.tokens);
    return "tokens" in token ? token.tokens ?? [] : [];
  }

  function rewriteToken(token: Token): string {
    if (token.type === "blockquote") {
      // The lexer removes quote prefixes from child tokens. Strip one level
      // before descending, then restore every original prefix verbatim.
      const lines = token.raw.split("\n");
      const prefixes = lines.map(line => /^( {0,3}> ?)/.exec(line)?.[0] ?? "");
      const unquoted = lines.map((line, i) => line.slice(prefixes[i].length)).join("\n");
      const rewritten = rewrite(unquoted, token.tokens).split("\n");
      if (rewritten.length !== lines.length) return token.raw;
      return rewritten.map((line, i) => prefixes[i] + line).join("\n");
    }
    if (token.type === "codespan") {
      const url = fileURL(token.text, false);
      return url ? `[${token.raw}](<${url}>)` : token.raw;
    }
    if (token.type === "link") {
      const url = fileURL(token.href, true);
      const title = token.title ? ` "${token.title.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : "";
      return url ? `[${token.text}](<${url}>${title})` : token.raw;
    }
    if (["code", "html", "image", "def"].includes(token.type)) return token.raw;
    return rewrite(token.raw, children(token));
  }

  function rewrite(source: string, tokens: Token[]): string {
    let result = "";
    let cursor = 0;
    for (const token of tokens) {
      // Keep original whitespace and punctuation. If a container's raw text
      // cannot be located verbatim (e.g. a multiline quote), descend to its
      // inline tokens instead, within this container only.
      const start = source.indexOf(token.raw, cursor);
      if (start < 0) {
        const rest = rewrite(source.slice(cursor), children(token));
        result += rest;
        return result;
      }
      result += source.slice(cursor, start) + rewriteToken(token);
      cursor = start + token.raw.length;
    }
    return result + source.slice(cursor);
  }

  return rewrite(markdown, marked.lexer(markdown));
}
