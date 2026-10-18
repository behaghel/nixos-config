import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { Marked } from "marked";
import { findProjectRoot, linkifyMarkdown } from "./core.ts";

const fixture = realpathSync(mkdtempSync(join(tmpdir(), "pi-relative-paths-")));
after(() => rmSync(fixture, { recursive: true, force: true }));
const root = join(fixture, "project");
mkdirSync(join(root, "docs"), { recursive: true });
writeFileSync(join(root, "docs", "example.md"), "# Example\n");
writeFileSync(join(root, "docs", "a b(#é).md"), "# Encoded\n");
const fileURL = pathToFileURL(join(root, "docs", "example.md")).href;
const marked = new Marked();
const transform = (text: string) => linkifyMarkdown(text, root, marked);
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();

test("inline code becomes a file link without changing its visible path", () => {
  assert.equal(transform("Read `docs/example.md`."), `Read [\`docs/example.md\`](<${fileURL}>).`);
});

test("relative Markdown links resolve from the root, including titles", () => {
  assert.equal(transform('[Guide](docs/example.md "Read me")'), `[Guide](<${fileURL}> "Read me")`);
  assert.equal(transform("[`docs/example.md`](./docs/example.md)"), `[\`docs/example.md\`](<${fileURL}>)`);
});

test("reference links are clickable without changing their definition", () => {
  assert.equal(transform("[Guide][guide]\n\n[guide]: docs/example.md\n"),
    `[Guide](<${fileURL}>)\n\n[guide]: docs/example.md\n`);
});

test("file URLs encode spaces, Unicode, parentheses and hashes", () => {
  const uri = pathToFileURL(join(root, "docs", "a b(#é).md")).href;
  assert.equal(transform("`docs/a b(#é).md`"), `[\`docs/a b(#é).md\`](<${uri}>)`);
});

test("links retain fragments and absolute file references still work", () => {
  assert.equal(transform("[Guide](docs/example.md#section)"), `[Guide](<${fileURL}#section>)`);
  const absolute = join(root, "docs", "example.md");
  assert.equal(transform(`\`${absolute}\``), `[\`${absolute}\`](<${fileURL}>)`);
});

test("fenced and indented code, HTML, images and web links stay unchanged", () => {
  const text = [
    "```md", "`docs/example.md`", "[Guide](docs/example.md)", "```", "",
    "    `docs/example.md`", "", "<pre>`docs/example.md`</pre>", "",
    "![Image](docs/example.md)", "[Web](https://example.org/docs/example.md)",
    "[Anchor](#section)", "[File](file:///tmp/already.md)",
  ].join("\n");
  assert.equal(transform(text), text);
});

test("missing files, directories and incomplete streaming code stay unchanged", () => {
  const text = "`docs/missing.md` `docs` [Missing](missing.md) `docs/example.md";
  assert.equal(transform(text), text);
});

test("only the intended occurrences change, not identical text in code blocks", () => {
  const block = "```\n`docs/example.md`\n```\n\n";
  assert.equal(transform(`${block}\`docs/example.md\` and \`docs/example.md\``),
    `${block}[\`docs/example.md\`](<${fileURL}>) and [\`docs/example.md\`](<${fileURL}>)`);
});

test("file references work in headings, emphasis, lists, quotes and tables", () => {
  for (const [before, after] of [
    ["## `docs/example.md`", `## [\`docs/example.md\`](<${fileURL}>)`],
    ["**`docs/example.md`**", `**[\`docs/example.md\`](<${fileURL}>)**`],
    ["- `docs/example.md`\n", `- [\`docs/example.md\`](<${fileURL}>)\n`],
    ["> `docs/example.md`\n", `> [\`docs/example.md\`](<${fileURL}>)\n`],
    ["| File |\n| --- |\n| `docs/example.md` |\n", `| File |\n| --- |\n| [\`docs/example.md\`](<${fileURL}>) |\n`],
  ]) assert.equal(transform(before), after);
});

test("multiline quotes preserve code blocks and link subsequent mentions", () => {
  const text = "> Text\n> `docs/example.md`\n>\n> ```\n> `docs/example.md`\n> ```\n>\n> `docs/example.md`\n";
  const expected = `> Text\n> [\`docs/example.md\`](<${fileURL}>)\n>\n> \`\`\`\n> \`docs/example.md\`\n> \`\`\`\n>\n> [\`docs/example.md\`](<${fileURL}>)\n`;
  assert.equal(transform(text), expected);
});

test("multiline list items link inline mentions but preserve nested code blocks", () => {
  const text = "- Text\n  `docs/example.md`\n\n  ```\n  `docs/example.md`\n  ```\n";
  const expected = `- Text\n  [\`docs/example.md\`](<${fileURL}>)\n\n  \`\`\`\n  \`docs/example.md\`\n  \`\`\`\n`;
  assert.equal(transform(text), expected);
});

test("transformation is idempotent", () => {
  const once = transform("`docs/example.md` and [Guide](docs/example.md)");
  assert.equal(transform(once), once);
});

test("Git root wins over pane cwd and a stale workon root", () => {
  git("init", "-q", root);
  assert.equal(findProjectRoot(join(root, "docs"), fixture), root);
});

test("each Git worktree is its own project root", () => {
  git("-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.org",
    "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "Fixture");
  const worktree = join(fixture, "worktree");
  git("-C", root, "worktree", "add", "-q", "-b", "fixture-worktree", worktree);
  mkdirSync(join(worktree, "subdir"));
  assert.equal(findProjectRoot(join(worktree, "subdir"), root), worktree);
});

test("non-Git projects use workon root, then Pi's starting directory", () => {
  assert.equal(findProjectRoot(fixture, root), root);
  assert.equal(findProjectRoot(fixture), fixture);
});

test("the Pi hook changes assistant rendering only, not stored messages", async () => {
  // Pi supplies Marked through pi-tui; use the same parser in the sandbox.
  const hook = registerHooks({
    resolve(specifier, context, next) {
      return next(specifier === "@earendil-works/pi-tui" ? "marked" : specifier, context);
    },
  });
  let install;
  try { install = (await import("./index.ts")).default; }
  finally { hook.deregister(); }
  const handlers = new Map();
  let transformer;
  install({
    on: (event, handler) => handlers.set(event, handler),
    registerMarkdownTransformer: handler => { transformer = handler; },
  });
  const markdown = "`docs/example.md`";
  assert.equal(transformer(markdown, { messageType: "assistant" }), markdown);
  handlers.get("session_start")({}, { mode: "tui", cwd: join(root, "docs") });
  assert.equal(transformer(markdown, { messageType: "assistant" }), `[\`docs/example.md\`](<${fileURL}>)`);
  assert.equal(transformer(markdown, { messageType: "user" }), markdown);
  assert.equal(transformer(markdown, { messageType: "assistant-thinking" }), markdown);
  // No message_end/context hooks rewrite the conversation or its history.
  assert.deepEqual([...handlers.keys()], ["session_start"]);
});
