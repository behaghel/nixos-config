// Resource/document contracts, not proof of an agent following instructions.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.argv[2] ?? fileURLToPath(new URL("../", import.meta.url)));
const plugin = join(root, "marketplace/plugins/devenv-workflow");
const manifest = JSON.parse(readFileSync(join(plugin, "package.json"), "utf8"));
const resources = manifest.pi.skills.flatMap((path) => {
  const directory = resolve(plugin, path);
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(directory, entry.name, "SKILL.md"))
    .filter(existsSync);
});
const skillPath = join(plugin, "skills/agent-session/SKILL.md");
assert(resources.includes(skillPath), "native package must discover agent-session");
const skill = readFileSync(skillPath, "utf8");
const frontmatter = skill.match(/^---\n([\s\S]+?)\n---\n/);
assert(frontmatter, "skill has frontmatter");
assert.match(frontmatter[1], /^name: agent-session$/m);
const description = frontmatter[1].match(/^description: (.+)$/m)?.[1];
assert(description && description.length <= 1024, "portable discovery description");
assert.match(description, /configured/);
assert.match(description, /explicitly asks/);
assert.doesNotMatch(frontmatter[1], /disable-model-invocation: true/);

for (const action of ["adopt", "upgrade", "repair", "retire"]) {
  assert.match(skill, new RegExp(`\\| ${action} \\| Explicit approval`), `${action} approval boundary`);
}
assert.match(skill, /as <task-slug> create --json/);
assert.match(skill, /as <task-slug> run/);
assert.match(skill, /system assembler/i);
assert.match(skill, /installed version/i);
assert.match(skill, /repository.*delivery policy/i);

// Bundled references must survive installing this plugin without the full repo.
for (const document of [skillPath, join(dirname(skillPath), "references/adoption.md")]) {
  const content = readFileSync(document, "utf8");
  for (const [, target] of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    if (/^(https?:|#)/.test(target)) continue;
    const path = resolve(dirname(document), target.split("#")[0]);
    assert(!relative(plugin, path).startsWith(".."), `reference escapes package: ${target}`);
    assert(existsSync(path), `missing bundled reference: ${target}`);
  }
}
const adoption = readFileSync(join(dirname(skillPath), "references/adoption.md"), "utf8");
const modulePath = adoption.match(/^\s+- nixos-config\/(modules\/flake\/agent-session)$/m)?.[1];
assert(modulePath && existsSync(join(root, modulePath, "devenv.nix")), "adoption imports the real module");
assert.match(adoption, /agentSession\.enable = true;/);
assert.match(adoption, /flake: false/);
assert.match(adoption, /pi install -l/);

const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
const policy = agents.match(/## Coding-agent sessions[^\n]*\n([\s\S]*?)(?=\n## )/)?.[1];
assert(policy, "repository retains a session policy");
assert(policy.split("\n").filter((line) => line.trim()).length <= 10, "policy is a pointer, not a copied manual");
assert.match(policy, /managed worktrees are required/i);
const pointer = policy.match(/\[[^\]]+\]\(([^)]+SKILL\.md)\)/)?.[1];
assert.equal(resolve(root, pointer ?? ""), skillPath, "policy resolves to bundled skill");
assert.doesNotMatch(policy, /as <task-slug> (create|run|finish|doctor)/);
const delivery = agents.split("## Commit & Pull Request Guidelines")[1]?.split("## ")[0];
assert(delivery, "repository retains its own delivery policy");
assert.match(delivery, /signing intact/);
assert.match(delivery, /Push the task branch/);
assert.match(delivery, /never merge/i);
console.log("agent-session skill contracts passed: discovery, permissions, portable references, adoption and repository policy");
