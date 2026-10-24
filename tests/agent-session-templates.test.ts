import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, copyFileSync, existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const templates = readdirSync("templates").filter((name) =>
  existsSync(join("templates", name, "devenv.nix")),
);
// Same explicit deployment-template exception as tests/marketplace.nix.
const marketplaceTemplates = templates.filter((name) => name !== "mele-vite-app");
const generatedOutputs = [
  ".claude/settings.json",
  ".claude/commands/probe.md",
  ".opencode/skills/probe/SKILL.md",
  ".opencode/agents/probe.md",
  ".mcp.json",
  "opencode.jsonc",
];

function checkGeneratedOutputIgnores(root: string) {
  const git = (args: string[]) => spawnSync("git", [
    "-c", "core.excludesFile=/dev/null", ...args,
  ], { cwd: root, encoding: "utf8" });
  for (const path of generatedOutputs) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), "generated fixture\n");
    expect(git(["check-ignore", "--quiet", path]).status).toBe(0);
  }
  const status = git(["status", "--short", "--untracked-files=all", "--", ...generatedOutputs]);
  expect(status.status).toBe(0);
  expect(status.stdout).toBe("");
  for (const source of [
    ".agents/skills/project/SKILL.md", ".pi/settings.json", ".pi/mcp.json",
    "devenv.nix", "src/opencode.jsonc", "src/.mcp.json",
    "src/.claude/settings.json", ".pi/skills/project/SKILL.md",
  ]) {
    expect(git(["check-ignore", "--quiet", source]).status).toBe(1);
  }
}

describe("default-on agent sessions in project templates", () => {
  for (const name of ["scala-basic", "guile-hall"]) {
    test(`${name} preserves worktree and generated-output ignores after project generation`, () => {
      const root = mkdtempSync(join(tmpdir(), "agent-session-bootstrap-"));
      try {
        const bin = join(root, "bin");
        mkdirSync(bin);
        copyFileSync(join("templates", name, ".gitignore"), join(root, ".gitignore"));
        // Nix store inputs are read-only; a freshly generated project is not.
        chmodSync(join(root, ".gitignore"), 0o644);
        spawnSync("git", ["init", root]);
        // Stub language scaffolding, not the template's copy/ignore behavior.
        const generator = `#!/usr/bin/env bash
if [[ "$1" == new || "$1" == init ]]; then
  mkdir -p generated
  printf '*.generated\\n' > generated/.gitignore
  touch generated/build.sbt generated/hall.scm
  printf '#!/usr/bin/env bash\\nexit 0\\n' > generated/configure
  chmod +x generated/configure
  mv generated "${name === "scala-basic" ? "scala-basic" : "guile-hall-project"}"
fi
`;
        for (const command of ["sbt", "hall"]) {
          writeFileSync(join(bin, command), generator, { mode: 0o755 });
        }
        for (const command of ["autoreconf", "make"]) {
          writeFileSync(join(bin, command), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
        }
        const expression = `(import ${resolve("templates", name, "devenv.nix")} { pkgs = {}; lib = {}; config.env.GREETING = ""; inputs = {}; }).enterShell`;
        const evaluated = spawnSync("nix-instantiate", ["--eval", "--strict", "--json", "--expr", expression], { encoding: "utf8" });
        expect(evaluated.status).toBe(0);
        const script = JSON.parse(evaluated.stdout);
        const bootstrap = spawnSync("bash", ["-e", "-c", script], {
          cwd: root,
          env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GREETING: "" },
        });
        expect(bootstrap.status).toBe(0);
        expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain("*.generated");
        expect(spawnSync("git", ["check-ignore", "--quiet", ".worktrees/probe"], { cwd: root }).status).toBe(0);
        checkGeneratedOutputIgnores(root);
        const ignores = readFileSync(join(root, ".gitignore"), "utf8");
        const repeated = spawnSync("bash", ["-e", "-c", script], {
          cwd: root,
          env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GREETING: "" },
        });
        expect(repeated.status).toBe(0);
        expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(ignores);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  for (const name of marketplaceTemplates) {
    test(`${name} keeps generated agent outputs out of Git without hiding sources`, () => {
      const root = mkdtempSync(join(tmpdir(), "marketplace-template-ignore-"));
      try {
        copyFileSync(join("templates", name, ".gitignore"), join(root, ".gitignore"));
        expect(spawnSync("git", ["init", root]).status).toBe(0);
        checkGeneratedOutputIgnores(root);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  for (const name of templates) {
    test(`${name} imports the shared module and ignores managed worktrees`, () => {
      const directory = join("templates", name);
      const yaml = readFileSync(join(directory, "devenv.yaml"), "utf8");
      const nix = readFileSync(join(directory, "devenv.nix"), "utf8");
      const input = name === "mele-vite-app" ? "nixos-config" : "agent-marketplace";
      expect(yaml).toContain(`- ${input}/modules/flake/agent-session`);
      expect(nix).toContain("agentSession.enable = true;");
      const parsed = spawnSync("nix-instantiate", ["--parse", join(directory, "devenv.nix")]);
      expect(parsed.status).toBe(0);

      const root = mkdtempSync(join(tmpdir(), "agent-session-template-"));
      try {
        copyFileSync(join(directory, ".gitignore"), join(root, ".gitignore"));
        expect(spawnSync("git", ["init", root]).status).toBe(0);
        const ignored = spawnSync("git", ["check-ignore", "--quiet", ".worktrees/probe"], { cwd: root });
        expect(ignored.status).toBe(0);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
