/**
 * Devenv Workflow — pi extension
 *
 * Makes pi fluent in devenv: declarative dev environment management.
 *
 * What this extension provides:
 *   • Auto-detects devenv projects (devenv.nix / devenv.yaml / .envrc)
 *   • Injects devenv expertise into the system prompt
 *   • Registers custom tools: devenv_search, devenv_validate, devenv_read_config
 *   • Registers commands: /devenv-diagnose, /devenv-init, /devenv-add
 *   • Monitors tool calls for anti-patterns (imperative installs, bare commands)
 *
 * Place in ~/.pi/agent/extensions/ (global) or .pi/extensions/ (per project).
 *
 * For the companion skill (knowledge base), see ../skills/devenv-project/SKILL.md
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { existsSync } from "fs";
import { readFile, access } from "fs/promises";
import { join, resolve, basename, dirname } from "path";
import { Type } from "typebox";

// ─── Helpers ────────────────────────────────────────────────

/** Check if a path exists (sync, for startup checks). */
function pathExists(p: string): boolean {
	try {
		return existsSync(p);
	} catch {
		return false;
	}
}

/** Find the project root by looking for devenv markers from cwd upward. */
function findDevenvRoot(cwd: string): string | null {
	let dir = resolve(cwd);
	for (let i = 0; i < 20; i++) {
		if (
			pathExists(join(dir, "devenv.nix")) ||
			pathExists(join(dir, "devenv.yaml"))
		) {
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

/** Quick check if a directory is a devenv project. */
function isDevenvProject(dir: string): boolean {
	return (
		pathExists(join(dir, "devenv.nix")) ||
		pathExists(join(dir, "devenv.yaml")) ||
		pathExists(join(dir, ".envrc"))
	);
}

/** Check if a bash command is an imperative install that should go in devenv.nix. */
const IMPERATIVE_INSTALL_PATTERNS = [
	/^pip\s+install\b/,
	/^npm\s+install\s+-g\b/,
	/^cargo\s+install\b/,
	/^brew\s+install\b/,
	/^apt\s+install\b/,
	/^apt-get\s+install\b/,
	/^gem\s+install\b/,
	/^go\s+install\b/,
];

/** Check if a command looks like a project command that should run inside `devenv shell`. */
const PROJECT_COMMAND_PATTERNS = [
	/^npm\s+(run|test|build|dev|start|lint|check)\b/,
	/^npx\b/,
	/^tsx\b/,
	/^vitest\b/,
	/^vite\b/,
	/^python\s+-m\b/,
	/^alembic\b/,
	/^django-admin\b/,
	/^manage\.py\b/,
	/^cargo\s+(build|test|run|check)\b/,
	/^go\s+(build|test|run)\b/,
	/^rails\b/,
	/^rake\b/,
	/^mix\s+(test|run|compile)\b/,
	/^sbt\b/,
	/^mvn\b/,
	/^gradle\b/,
	/^poetry\b/,
	/^pnpm\s+(run|test|build|dev|start)\b/,
	/^yarn\s+(run|test|build|dev|start)\b/,
	/^bun\s+(run|test|build|dev|start)\b/,
	/^direnv\s+allow\b/,
];

function isImperativeInstall(cmd: string): boolean {
	return IMPERATIVE_INSTALL_PATTERNS.some((p) => p.test(cmd.trim()));
}

function isProjectCommand(cmd: string): boolean {
	return PROJECT_COMMAND_PATTERNS.some((p) => p.test(cmd.trim()));
}

// ─── Extension ──────────────────────────────────────────────

export default function devenvExtension(pi: ExtensionAPI) {
	let devenvRoot: string | null = null;
	let isActive = false; // true when inside a devenv project

	// ─── Status helpers ────────────────────────────────────────

	function updateStatus(ctx?: ExtensionContext) {
		if (!ctx) return;
		if (isActive) {
			ctx.ui.setStatus("devenv", `devenv @ ${basename(devenvRoot ?? "")}`);
		} else {
			ctx.ui.setStatus("devenv", undefined);
		}
	}

	// ─── Session start: detect devenv project ──────────────────

	pi.on("session_start", async (_event, ctx) => {
		devenvRoot = findDevenvRoot(ctx.cwd);
		isActive = devenvRoot !== null && isDevenvProject(devenvRoot);
		updateStatus(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		devenvRoot = findDevenvRoot(ctx.cwd);
		isActive = devenvRoot !== null && isDevenvProject(devenvRoot);
		updateStatus(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus("devenv", undefined);
	});

	// ─── System prompt: inject devenv expertise ────────────────

	pi.on("before_agent_start", async (event) => {
		if (!isActive) return;

		const devenvExpertise = `
## Devenv Environment

This project uses [devenv](https://devenv.sh) for its development environment.
devenv.nix is the source of truth for tooling, services, and developer workflow.

### Core rules
- **Declarative over imperative** — never use \`pip install\`, \`npm install -g\`, \`cargo install\`, etc.
  Add packages to \`devenv.nix\` instead (\`packages\`, language module, or service).
- **Inside the shell** — run project commands via \`devenv shell -- <cmd>\`, not bare.
  Core utilities (ls, cat, git status, mkdir, rm) are fine outside.
- **Language modules** — prefer \`languages.<name>.enable = true\` over raw packages.
- **Search before guessing** — use \`devenv search <query>\` or the \`devenv_search\` tool.
- **Validate** — after editing devenv.nix, use \`devenv_validate\` or \`nix-instantiate --parse devenv.nix\`.

### Key commands
| Action | Command |
|--------|---------|
| Enter environment | \`devenv shell\` (interactive) |
| Run inside env | \`devenv shell -- <cmd>\` (agent-safe) |
| Run tests | \`devenv test\` |
| Run a task | \`devenv tasks run <ns:name>\` |
| Search | \`devenv search <query>\` |
| Update inputs | \`devenv update\` |
| Build output | \`devenv build\` |

### Anti-patterns to redirect
- \`pip install\` → add to \`languages.python.venv\` or \`packages\`
- \`npm install -g\` → add to \`packages\` or \`languages.javascript.npm\`
- Project commands outside devenv shell → wrap with \`devenv shell --\`
- \`devenv up\` from agent → never call interactively, use \`devenv shell -- ./scripts/<check>.sh\`

### Configuration files
| File | Role |
|------|------|
| \`devenv.nix\` | Main declarative config (Nix module) |
| \`devenv.yaml\` | Inputs, imports, process manager |
| \`.envrc\` | direnv integration |
| \`devenv.lock\` | Pinned inputs for reproducibility |
| \`devenv.local.nix\` | Local overrides (not committed) |

For detailed reference, load the \`devenv-project\` skill.
`;

		return {
			systemPrompt: `${event.systemPrompt}\n${devenvExpertise}`,
		};
	});

	// ─── Tool monitoring: catch anti-patterns ──────────────────

	pi.on("tool_call", async (event, ctx) => {
		if (!isActive) return;
		if (event.toolName !== "bash") return;

		const cmd = (event.input as { command?: string }).command ?? "";

		if (isImperativeInstall(cmd)) {
			return {
				block: true,
				reason:
					"This project uses devenv — add packages to devenv.nix instead of imperative installs. " +
					"Use the `devenv_search` tool to find the right option, then edit `devenv.nix`.\n\n" +
					"Examples:\n" +
					"  • `packages = [ pkgs.<name> ];` for CLI tools\n" +
					"  • `languages.python.enable = true;` for language runtimes\n" +
					"  • `services.postgres.enable = true;` for services",
			};
		}

		if (isProjectCommand(cmd)) {
			// Don't block, but modify the command to run inside devenv shell
			// unless it already is
			if (!cmd.startsWith("devenv shell --") && !cmd.startsWith("devenv ")) {
				(event.input as { command: string }).command = `devenv shell -- ${cmd}`;
			}
		}
	});

	// ─── Custom tools ──────────────────────────────────────────

	// Tool: devenv_search — search packages/options via `devenv search`
	pi.registerTool({
		name: "devenv_search",
		label: "Devenv Search",
		description:
			"Search devenv packages and configuration options. " +
			"Use this instead of guessing option names. " +
			"Wraps `devenv search <query>`. Only available in devenv projects.",
		promptSnippet: "Search devenv packages and options",
		promptGuidelines: [
			"Use devenv_search before adding packages or options to devenv.nix — don't guess option paths.",
			"Query language names, package names, or option paths to verify they exist.",
		],
		parameters: Type.Object({
			query: Type.String({
				description:
					"Search query — e.g. 'python', 'postgres', 'redis', 'typescript-language-server'",
			}),
			scope: Type.Optional(
				Type.Union(
					[
						Type.Literal("packages", { description: "Search nixpkgs packages" }),
						Type.Literal("options", { description: "Search devenv configuration options" }),
					],
					{ description: "Search scope: 'packages' or 'options'. Default: both." },
				),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const { query, scope } = params;
			const args = scope ? [scope, query] : [query];
			try {
				const result = await pi.exec("devenv", ["search", ...args], {
					signal,
					timeout: 30_000,
				});
				return {
					content: [
						{
							type: "text",
							text:
								result.stdout.trim() ||
								`No results for "${query}"${scope ? ` in ${scope}` : ""}. You can also try \`devenv search ${query}\` directly.`,
						},
					],
					details: { query, scope: scope ?? "all" },
				};
			} catch (err: any) {
				return {
					content: [
						{
							type: "text",
							text: `devenv search failed: ${err.message}\n\nThis may mean \`devenv\` is not installed in the host environment. Install it or use nix-shell -p devenv to search.`,
						},
					],
					isError: true,
				};
			}
		},
	});

	// Tool: devenv_validate — validate devenv.nix syntax and evaluation
	pi.registerTool({
		name: "devenv_validate",
		label: "Devenv Validate",
		description:
			"Validate the devenv.nix configuration. Runs syntax check and (if available) evaluation check. " +
			"Always use this after editing devenv.nix. Only available in devenv projects.",
		promptSnippet: "Validate devenv.nix configuration",
		promptGuidelines: [
			"Use devenv_validate after every edit to devenv.nix before proceeding.",
			"If validation fails, fix the issue before continuing.",
		],
		parameters: Type.Object({
			full: Type.Optional(
				Type.Boolean({
					description:
						"If true, also runs `devenv shell -- true` for a full evaluation check. Default: false (syntax check only).",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!devenvRoot) {
				return {
					content: [{ type: "text", text: "No devenv project detected in working directory." }],
				};
			}

			const results: string[] = [];

			// Step 1: syntax check
			const syntaxResult = await pi.exec(
				"nix-instantiate",
				["--parse", join(devenvRoot, "devenv.nix")],
				{ signal, timeout: 15_000 },
			);

			if (syntaxResult.code !== 0) {
				return {
					content: [
						{
							type: "text",
							text: `❌ Syntax error in devenv.nix:\n${syntaxResult.stderr.trim()}`,
						},
					],
					isError: true,
				};
			}
			results.push("✓ devenv.nix syntax is valid");

			// Step 2: full evaluation check (optional)
			if (params.full) {
				const evalResult = await pi.exec("devenv", ["shell", "--", "true"], {
					signal,
					timeout: 120_000,
					cwd: devenvRoot,
				});

				if (evalResult.code !== 0) {
					return {
						content: [
							{
								type: "text",
								text: `❌ devenv evaluation failed:\n${evalResult.stderr.trim()}\n\nFix the issue and validate again. If the error mentions \`dynamic_store.rs\` or Nix daemon sockets, it may be a sandbox artifact — try running \`devenv shell -- true\` on the host directly.`,
							},
						],
						isError: true,
					};
				}
				results.push("✓ devenv shell evaluates successfully");
			}

			return {
				content: [{ type: "text", text: results.join("\n") }],
				details: { syntax: true, full: params.full ?? false },
			};
		},
	});

	// Tool: devenv_read_config — read and summarize devenv config
	pi.registerTool({
		name: "devenv_read_config",
		label: "Devenv Read Config",
		description:
			"Read and summarize the current devenv configuration files. " +
			"Use this to understand what languages, services, processes, tasks, and packages are configured.",
		promptSnippet: "Read and summarize devenv configuration",
		parameters: Type.Object({
			files: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"Specific files to read. Default: ['devenv.nix', 'devenv.yaml', '.envrc']. " +
						"Also accepts 'devenv.local.nix' and 'devenv.lock'.",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!devenvRoot) {
				return {
					content: [{ type: "text", text: "No devenv project detected." }],
				};
			}

			const filesToRead = params.files ?? ["devenv.nix", "devenv.yaml", ".envrc"];
			const contents: string[] = [];

			for (const file of filesToRead) {
				const filePath = join(devenvRoot, file);
				try {
					await access(filePath);
					const content = await readFile(filePath, "utf-8");
					contents.push(`## ${file}\n\n\`\`\`\n${content}\n\`\`\``);
				} catch {
					contents.push(`## ${file}\n\n*(not found)*`);
				}
			}

			return {
				content: [{ type: "text", text: contents.join("\n\n") }],
				details: { root: devenvRoot },
			};
		},
	});

	// ─── Commands ──────────────────────────────────────────────

	/**
	 * /devenv-diagnose — Systematic troubleshooting for devenv issues.
	 *
	 * Follows the diagnostic ladder from the command spec:
	 *   1. Syntax check (nix-instantiate --parse)
	 *   2. Function args check
	 *   3. Language/package availability
	 *   4. Service configuration
	 *   5. Input/lock freshness
	 *   6. Sandbox detection
	 *   7. direnv state
	 */
	pi.registerCommand("devenv-diagnose", {
		description: "Diagnose and fix devenv environment issues",
		handler: async (args, ctx) => {
			if (!isActive) {
				ctx.ui.notify("Not a devenv project — no devenv.nix or devenv.yaml found", "warning");
				return;
			}

			const symptom = args.trim();

			// Show what we're checking
			ctx.ui.setWidget("devenv-diagnose", [
				"🔍 Running devenv diagnostic ladder...",
				symptom ? `  Symptom: ${symptom}` : "  No specific symptom — running full check",
			]);

			const results: string[] = [];
			let foundIssue = false;

			// 1. Syntax check
			results.push("### 1️⃣ Syntax check");
			const syntaxResult = await pi.exec(
				"nix-instantiate",
				["--parse", join(devenvRoot!, "devenv.nix")],
				{ timeout: 15_000 },
			);
			if (syntaxResult.code === 0) {
				results.push("  ✓ devenv.nix parses successfully");
			} else {
				results.push(`  ❌ Syntax error:\n  \`\`\`\n  ${syntaxResult.stderr.trim()}\n  \`\`\``);
				foundIssue = true;
			}

			// 2. Check function args
			if (!foundIssue) {
				results.push("\n### 2️⃣ Function args check");
				try {
					const content = await readFile(join(devenvRoot!, "devenv.nix"), "utf-8");
					if (content.includes("inputs")) {
						results.push("  ✓ `inputs` is referenced in devenv.nix");
					} else {
						results.push("  ⚠️  `inputs` not found in devenv.nix — may break flakes evaluation");
					}
					if (content.startsWith("{")) {
						results.push("  ✓ Function header looks correct");
					}
				} catch {
					results.push("  ⚠️  Could not read devenv.nix");
				}
			}

			// 3. Check devenv CLI availability
			results.push("\n### 3️⃣ devenv CLI availability");
			const cliResult = await pi.exec("devenv", ["--version"], { timeout: 5_000 });
			if (cliResult.code === 0) {
				results.push(`  ✓ devenv ${cliResult.stdout.trim()} is available`);
			} else {
				results.push("  ❌ `devenv` command not found. Install it or use `nix-shell -p devenv`");
				foundIssue = true;
			}

			// 4. Evaluation check
			if (!foundIssue) {
				results.push("\n### 4️⃣ Evaluation check");
				const evalResult = await pi.exec("devenv", ["shell", "--", "true"], {
					timeout: 120_000,
					cwd: devenvRoot!,
				});
				if (evalResult.code === 0) {
					results.push("  ✓ devenv shell evaluates successfully");
				} else {
					const err = evalResult.stderr;
					if (err.includes("dynamic_store.rs") || err.includes("daemon")) {
						results.push(
							"  ⚠️  Sandbox artifact detected (dynamic_store.rs or daemon socket error)\n" +
								"  → This is likely a sandbox issue, not a config bug.\n" +
								"  → Run `devenv shell -- true` on the host to verify.",
						);
					} else {
						results.push(`  ❌ Evaluation failed:\n  \`\`\`\n  ${err.trim()}\n  \`\`\``);
						foundIssue = true;
					}
				}
			}

			// 5. Check direnv state (if .envrc exists)
			if (pathExists(join(devenvRoot!, ".envrc"))) {
				results.push("\n### 5️⃣ direnv state");
				const direnvResult = await pi.exec("direnv", ["status"], {
					timeout: 5_000,
					cwd: devenvRoot!,
				});
				if (direnvResult.code === 0) {
					const status = direnvResult.stdout;
					if (status.includes("blocked")) {
						results.push("  ⚠️  direnv is blocked — run `direnv allow`");
					} else {
						results.push("  ✓ direnv is active");
					}
				} else {
					results.push("  ⚠️  Could not check direnv status (direnv may not be installed)");
				}
			}

			// Final summary
			if (foundIssue) {
				results.push(
					"\n---\n**Issues found.** Fix the errors above and re-run `/devenv-diagnose` to verify.",
				);
			} else {
				results.push("\n---\n**✅ All checks passed.** The devenv environment looks healthy.");
			}

			ctx.ui.setWidget("devenv-diagnose", undefined);
			ctx.ui.notify(results.join("\n"), foundIssue ? "warning" : "success");
		},
	});

	/**
	 * /devenv-init — Scaffold a new devenv environment.
	 */
	pi.registerCommand("devenv-init", {
		description: "Scaffold devenv.nix, devenv.yaml, and .envrc from project intent",
		handler: async (args, ctx) => {
			if (isActive) {
				const overwrite = await ctx.ui.confirm(
					"devenv files exist",
					"devenv configuration already exists in this project. Overwrite?",
				);
				if (!overwrite) return;
			}

			const description = args.trim() || "a web application";
			const msg = `I need to scaffold a devenv environment for this project.

The project description is: "${description}"

Please:
1. Read the project structure for clues (package.json, Cargo.toml, pyproject.toml, etc.)
2. Determine languages, services, processes, tasks, and packages needed
3. Create devenv.yaml, devenv.nix, and .envrc
4. Validate with devenv_validate
5. Report what was created and suggest next steps

Remember:
- Include \`inputs\` in function args for flakes compatibility
- Prefer language modules over raw packages
- Keep it minimal — easier to add than to remove
- Use devenv_search to verify option names
- Add an \`enterTest\` that covers at minimum: lint + typecheck`;
			pi.sendUserMessage(msg);
		},
	});

	/**
	 * /devenv-add — Add a language, service, process, task, or tool to devenv.nix.
	 */
	pi.registerCommand("devenv-add", {
		description: "Add a language, service, process, task, or tool to devenv.nix",
		handler: async (args, ctx) => {
			if (!isActive) {
				ctx.ui.notify("Not a devenv project. Use /devenv-init first.", "warning");
				return;
			}

			if (!args.trim()) {
				ctx.ui.notify(
					"Usage: /devenv-add <what to add>\n" +
						"Examples:\n" +
						"  /devenv-add postgres\n" +
						"  /devenv-add python 3.12\n" +
						"  /devenv-add redis\n" +
						"  /devenv-add eslint hook",
					"info",
				);
				return;
			}

			const msg = `I need to add "${args.trim()}" to the devenv configuration.

Please:
1. Read the existing devenv.nix to understand what's already configured
2. Use devenv_search to find the correct option names
3. Edit devenv.nix to add the new capability
4. Validate with devenv_validate
5. Report what was added and any manual steps needed

Remember:
- Preserve existing configuration — don't reorder or delete anything
- One addition at a time
- Use \`after = [...]\` for dependency ordering on processes
- Prefer language modules over raw packages`;
			pi.sendUserMessage(msg);
		},
	});

	// ─── Init-time notification ────────────────────────────────

	// Notify on startup if we're in a devenv project
	pi.on("session_start", async (_event, ctx) => {
		if (isActive) {
			ctx.ui.notify(
				`🔧 devenv project detected at ${devenvRoot!}. ` +
					`Use /devenv-diagnose, /devenv-add, or /devenv-init. ` +
					`Tools: devenv_search, devenv_validate, devenv_read_config.`,
				"info",
			);
		}
	});
}
