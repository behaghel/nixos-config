/**
 * Domain Tree — pi extension
 *
 * Makes pi fluent in domain-driven codebase structure: DDD-informed domain
 * trees with 1:1 spec/code mirroring, subdomain classification, context
 * mapping, and shared kernel management.
 *
 * What this extension provides:
 *   • Auto-detects domain-tree projects (domains.yaml)
 *   • Injects domain-navigator expertise into the system prompt
 *   • Registers custom tools: domain_tree_resolve, domain_tree_check, domain_tree_map
 *   • Registers commands: /domain-tree:init, /domain-tree:check, /domain-tree:map
 *   • Monitors tool calls for spec-on-touch enforcement and cross-domain violations
 *
 * Place in ~/.pi/agent/extensions/ (global) or .pi/extensions/ (per project).
 *
 * For the companion skill (knowledge base), see ../skills/domain-navigator/SKILL.md
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync } from "fs";
import { readFile, access } from "fs/promises";
import { join, resolve, basename, dirname } from "path";
import { Type } from "typebox";
import {
	entryForResolution,
	findAmbiguousCodeMappings,
	findContextMapIssues,
	flattenDomains,
	parseDomainsYaml,
	resolveDomainForFilePath,
	specDirForEntry,
	specLabelForEntry,
	validateNormativeSpecContent,
} from "./domain-core.ts";

// ─── Helpers ────────────────────────────────────────────────

/** Check if a path exists (sync, for startup checks). */
function pathExists(p: string): boolean {
	try {
		return existsSync(p);
	} catch {
		return false;
	}
}

const DOMAIN_MANIFEST = "domains.yaml";
const LEGACY_DOMAIN_MANIFEST = join("spec", "domains.yaml");

/** Find the project root by looking for domains.yaml from cwd upward. */
function findDomainRoot(cwd: string): string | null {
	let dir = resolve(cwd);
	for (let i = 0; i < 20; i++) {
		if (pathExists(join(dir, DOMAIN_MANIFEST)) || pathExists(join(dir, LEGACY_DOMAIN_MANIFEST))) {
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

/** Quick check if a directory is a domain-tree project. */
function isDomainTreeProject(dir: string): boolean {
	return pathExists(join(dir, DOMAIN_MANIFEST)) || pathExists(join(dir, LEGACY_DOMAIN_MANIFEST));
}

function manifestRelPath(root: string): string {
	return pathExists(join(root, DOMAIN_MANIFEST)) ? DOMAIN_MANIFEST : LEGACY_DOMAIN_MANIFEST;
}

function isLegacyManifest(root: string): boolean {
	return !pathExists(join(root, DOMAIN_MANIFEST)) && pathExists(join(root, LEGACY_DOMAIN_MANIFEST));
}

/** Strip YAML frontmatter (--- ... ---) from markdown content. */
function stripFrontmatter(content: string): string {
	const lines = content.split("\n");
	let firstDash = -1;
	let secondDash = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim() === "---") {
			if (firstDash === -1) {
				firstDash = i;
			} else {
				secondDash = i;
				break;
			}
		}
	}
	if (firstDash !== -1 && secondDash !== -1) {
		return lines.slice(secondDash + 1).join("\n").trim();
	}
	return content;
}

/** Try to parse domains.yaml and return domains object. */
async function tryLoadDomains(root: string): Promise<Record<string, any> | null> {
	try {
		const content = await readFile(join(root, manifestRelPath(root)), "utf-8");
		return parseDomainsYaml(content);
	} catch {
		return null;
	}
}

/** Determine which domain a file path belongs to from the domain manifest. */
async function resolveDomainForFile(filePath: string, root: string, domains: Record<string, any>): Promise<{ domain: string; subdomain: string | null; type: string } | null> {
	return resolveDomainForFilePath(filePath, root, domains);
}

/** Check if a spec exists for a given domain. */
async function specExistsForDomain(root: string, domains: Record<string, any>, domainName: string, subdomain: string | null): Promise<boolean> {
	const entry = entryForResolution(domains, { domain: domainName, subdomain, type: "supporting" });
	const specDir = entry ? specDirForEntry(root, entry) : null;
	if (!specDir) return false;
	try {
		await access(specDir);
		const readme = await readFile(join(specDir, "README.md"), "utf-8");
		const expectedDomain = [
			domainName,
			...(subdomain ? subdomain.split(" > ") : []),
		].join("/");
		return validateNormativeSpecContent(readme, expectedDomain, true).length === 0;
	} catch {
		return false;
	}
}

/** Get domain type for a given domain name from the parsed manifest. */
function getDomainType(domains: Record<string, any>, domainName: string): string {
	return domains[domainName]?.type || "supporting";
}

// List of command patterns that look like project commands
const PROJECT_COMMAND_PATTERNS = [
	/^npm\s+(run|test|build|dev|start|lint|check)\b/,
	/^npx\b/,
	/^tsx\b/,
	/^vitest\b/,
	/^vite\b/,
	/^python\s+-m\b/,
	/^alembic\b/,
	/^django-admin\b/,
	/^cargo\s+(build|test|run|check)\b/,
	/^go\s+(build|test|run)\b/,
	/^direnv\s+allow\b/,
];

// ─── Extension ──────────────────────────────────────────────

export default function domainTreeExtension(pi: ExtensionAPI) {
	let domainRoot: string | null = null;
	let isActive = false;
	let domainsCache: Record<string, any> | null = null;

	// ─── Status helpers ────────────────────────────────────────

	function updateStatus(ctx?: { ui: { setStatus: (key: string, val?: string) => void } }) {
		if (!ctx) return;
		if (isActive && domainRoot) {
			ctx.ui.setStatus("domain-tree", `🌳 ${basename(domainRoot)}`);
		} else {
			ctx.ui.setStatus("domain-tree", undefined);
		}
	}

	/** Refresh the domain cache. */
	async function refreshDomainCache() {
		if (domainRoot) {
			domainsCache = await tryLoadDomains(domainRoot);
		} else {
			domainsCache = null;
		}
	}

	/** Lazily rediscover the domain root for tools/commands after init in the same session. */
	async function ensureDomainRoot(ctx?: any) {
		if (!domainRoot && ctx?.cwd) {
			domainRoot = findDomainRoot(ctx.cwd);
			isActive = domainRoot !== null && isDomainTreeProject(domainRoot);
		}
		if (domainRoot) {
			await refreshDomainCache();
		}
		if (ctx?.ui) updateStatus(ctx);
		return domainRoot !== null && domainsCache !== null;
	}

	// ─── Session start: detect domain-tree project ─────────────

	pi.on("session_start", async (_event, ctx) => {
		domainRoot = findDomainRoot(ctx.cwd);
		isActive = domainRoot !== null && isDomainTreeProject(domainRoot);
		if (isActive) {
			await refreshDomainCache();
		}
		updateStatus(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		domainRoot = findDomainRoot(ctx.cwd);
		isActive = domainRoot !== null && isDomainTreeProject(domainRoot);
		if (isActive) {
			await refreshDomainCache();
		}
		updateStatus(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus("domain-tree", undefined);
	});

	// ─── System prompt: inject domain-navigator expertise ──────

	pi.on("before_agent_start", async (event) => {
		if (!isActive) return;

		const domainExpertise = `
## Domain Tree Environment

This project uses a domain-driven codebase structure defined in \`domains.yaml\`.
The domain tree encodes three things:

1. **Where things live** — domain specs are colocated with the code they govern
2. **How much rigor each domain deserves** — core vs supporting vs generic classification
3. **How domains communicate** — the context map declaring integration patterns

### Core rules
- **Structural groups** — entries with \`kind: group\` organize nested \`domains\` but own no code, specs, classification, or context contracts.
- **Colocated specs** — domain specs live next to code. The first \`code\` path is the default spec directory; \`README.md\` is the required main domain spec.
- **Normative corpus** — \`README.md\` and sibling Markdown with \`domain\`/\`status\` frontmatter are normative. Plans, prompts, guides, and history without that frontmatter are not specs.
- **Subsidiarity** — the most-specific matching child path owns a file. Parent/child overlap is valid; unrelated domains may not claim the same path.
- **Spec-on-touch** — The first time you modify a domain, write its spec. Rigor scales with classification:
  - **core**: spec required before any code change (hard block)
  - **shared-kernel**: spec required, all consumers notified (hard block)
  - **supporting**: warning when missing (soft)
  - **generic**: only when integration boundary changes
- **Cross-domain awareness** — Always consult the context map when work spans domains.
  Use the declared integration pattern (shared-kernel, customer-supplier, ACL, conformist, etc.) to guide implementation.
- **Classify before coding** — Domain type (core/supporting/generic/shared-kernel) determines spec and test rigor.

### Key tools
| Action | Tool |
|--------|------|
| Resolve which domain owns a file | \`domain_tree_resolve\` |
| Validate domain tree structure | \`domain_tree_check\` |
| Show domain coverage dashboard | \`domain_tree_map\` |

### Key commands
| Action | Command |
|--------|---------|
| Bootstrap domain tree | \`/domain-tree:init\` |
| Health check | \`/domain-tree:check\` |
| Coverage dashboard | \`/domain-tree:map\` |

### Configuration files
| File | Role |
|------|------|
| \`domains.yaml\` | Domain tree manifest (source of truth) |
| \`<domain code path>/README.md\` | Main domain specification |
| \`<domain code path>/*.md\` with normative frontmatter | Cohesive behavior and term specifications |

For detailed reference, load the \`domain-navigator\` skill.
`;

		return {
			systemPrompt: `${event.systemPrompt}\n${domainExpertise}`,
		};
	});

	// ─── Tool monitoring: spec-on-touch & cross-domain enforcement ──

	pi.on("tool_call", async (event, ctx) => {
		const hasDomainTree = await ensureDomainRoot(ctx);
		if (!hasDomainTree || !domainRoot || !domainsCache) return;

		if (event.toolName === "write" || event.toolName === "edit") {
			const input = event.input as { path?: string; command?: string };
			const targetPath = input?.path || "";

			// Try to resolve which domain this touches
			const resolved = await resolveDomainForFile(targetPath, domainRoot, domainsCache);
			if (!resolved) return; // not in any domain

			// Check spec-on-touch for core domains
			const domainType = resolved.type;
			if (domainType === "core" || domainType === "shared-kernel") {
				const hasSpec = await specExistsForDomain(domainRoot, domainsCache, resolved.domain, resolved.subdomain);
				if (!hasSpec) {
					const domainLabel = resolved.subdomain
						? `${resolved.domain} > ${resolved.subdomain}`
						: resolved.domain;

					if (domainType === "core") {
						return {
							block: true,
							reason:
								`⚠️ **Domain boundary violation: ${domainLabel}** (type: **core**)\n\n` +
								`This is a **core** domain — it is the competitive advantage of the project. ` +
								`No spec exists for this domain yet. **Spec required before any code change.**\n\n` +
								`Use \`/domain-tree:init\` to scaffold the domain tree, or run \`/domain-tree:check\` to see the current state.`,
						};
					}

					if (domainType === "shared-kernel") {
						return {
							block: true,
							reason:
								`⚠️ **Domain boundary violation: ${domainLabel}** (type: **shared-kernel**)\n\n` +
								`This is **shared kernel** — changes affect ALL consuming domains. ` +
								`No spec exists yet. **Spec required and all consumers must be notified.**\n\n` +
								`Check the context map in \`domains.yaml\` for which domains depend on this.`,
						};
					}
				}
			}
		}
	});

	// ─── Custom tools ──────────────────────────────────────────

	// Tool: domain_tree_resolve — resolve which domain owns a given file path
	pi.registerTool({
		name: "domain_tree_resolve",
		label: "Domain Tree Resolve",
		description:
			"Resolve which domain and subdomain own a given file path, based on domains.yaml. " +
			"Returns the domain name, subdomain (if any), and domain type (core/supporting/generic/shared-kernel). " +
			"Use this before creating new files to ensure they land in the correct domain namespace.",
		promptSnippet: "Resolve domain ownership for a file path",
		promptGuidelines: [
			"Before creating new files, use domain_tree_resolve to check which domain owns the target path.",
			"Use domain_tree_resolve when the user asks 'where does X live?' or 'what domain owns Y?'.",
		],
		parameters: Type.Object({
			path: Type.String({
				description: "File path to resolve (relative to project root)",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			await ensureDomainRoot(ctx);
			if (!domainRoot || !domainsCache) {
				return {
					content: [
						{
							type: "text",
							text: "No domain tree found. Run `/domain-tree:init` to create one, or check that `domains.yaml` exists.",
						},
					],
				};
			}

			const resolved = await resolveDomainForFile(params.path, domainRoot, domainsCache);
			if (!resolved) {
				return {
					content: [
						{
							type: "text",
							text: `**${params.path}** is not covered by any domain in \`domains.yaml\`. ` +
								"Should we add it to an existing domain or create a new one?",
						},
					],
					details: { covered: false, path: params.path },
				};
			}

			const domainLabel = resolved.subdomain
				? `${resolved.domain} > ${resolved.subdomain}`
				: resolved.domain;

			const typeEmoji: Record<string, string> = {
				core: "🔴",
				supporting: "🟡",
				generic: "🟢",
				"shared-kernel": "🔵",
			};

			const specEntry = entryForResolution(domainsCache, resolved);
			const specDir = specEntry ? specLabelForEntry(specEntry) || "(no spec path; add a code path or spec override)" : "(unknown)";

			return {
				content: [
					{
						type: "text",
						text: `📍 **${params.path}** is in the **${domainLabel}** namespace\n` +
							`   Type: ${typeEmoji[resolved.type] || "🟡"} **${resolved.type}**\n` +
							`   Spec at: \`${specDir}\``,
					},
				],
				details: {
					covered: true,
					domain: resolved.domain,
					subdomain: resolved.subdomain,
					type: resolved.type,
				},
			};
		},
	});

	// Tool: domain_tree_check — validate domain tree structure vs codebase
	pi.registerTool({
		name: "domain_tree_check",
		label: "Domain Tree Check",
		description:
			"Validate that the domain tree in domains.yaml matches the actual codebase. " +
			"Reports broken mappings, orphaned code, missing spec directories, code-paths quality issues, " +
			"context map health, and classification consistency. Use this for periodic structural health checks.",
		promptSnippet: "Validate domain tree structure against codebase",
		promptGuidelines: [
			"Use domain_tree_check periodically to verify the domain tree matches the actual codebase.",
			"Run domain_tree_check before major refactors to understand current domain boundaries.",
		],
		parameters: Type.Object({
			detailed: Type.Optional(
				Type.Boolean({
					description: "If true, also check context map health and code-paths quality (slower). Default: false.",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			await ensureDomainRoot(ctx);
			if (!domainRoot || !domainsCache) {
				return {
					content: [{ type: "text", text: "No domain tree found. Run `/domain-tree:init` to create one." }],
				};
			}

			const { readdir, stat } = await import("fs/promises");
			const results: string[] = [];
			let issues = 0;
			let passed = 0;

			results.push("## Domain Tree Health Check");
			results.push(`*Manifest: \`${manifestRelPath(domainRoot)}\`*`);
			results.push("");

			if (isLegacyManifest(domainRoot)) {
				results.push("### 🔁 Migration needed");
				results.push("This project still uses the legacy `spec/domains.yaml` layout.");
				results.push("Move `spec/domains.yaml` to `domains.yaml`, then move each domain's markdown files next to the code it governs.");
				results.push("Use `README.md` as the main domain spec instead of `index.md`.");
				results.push("");
				results.push("Suggested migration:");
				results.push("1. `mv spec/domains.yaml domains.yaml`");
				results.push("2. For each domain, choose the first `code:` directory (for example `src/payments/`) as the spec directory.");
				results.push("3. Move `spec/<domain>/index.md` to `<code path>/README.md`; move other `*.md` files into the same colocated directory.");
				results.push("4. Update any explicit `spec:` fields in `domains.yaml` to the new colocated path, or remove them to infer from `code:`.");
				results.push("5. Delete the old `spec/` tree once empty.");
				results.push("");
			}

			// Step 1: Check declared paths exist
			results.push("### 📁 Mappings: manifest → codebase");
			const nodes = flattenDomains(domainsCache);
			for (const node of nodes) {
				const label = node.path.join(" > ");
				for (const cp of node.entry.code || []) {
					const cpNorm = cp.replace(/\/+$/, "");
					const fullPath = join(domainRoot!, cpNorm);
					try {
						await stat(fullPath);
						passed++;
					} catch {
						results.push(`  ⚠ Domain **${label}** declares \`${cp}\` but it doesn't exist`);
						issues++;
					}
				}

				const specDir = specDirForEntry(domainRoot, node.entry);
				const specLabel = specLabelForEntry(node.entry);
				if (specDir && specLabel) {
					try {
						await stat(specDir);
						passed++;
					} catch {
						results.push(`  ⚠ Domain **${label}** has no spec directory at \`${specLabel}\``);
						issues++;
					}
				}
			}

			if (issues === 0 && passed > 0) {
				results.push("  ✅ All declared paths exist");
			}

			results.push("");
			results.push("### 📚 Normative documentation");
			let documentationIssues = 0;
			for (const node of nodes) {
				const specDir = specDirForEntry(domainRoot, node.entry);
				if (!specDir) continue;
				let files: string[];
				try {
					files = await readdir(specDir);
				} catch {
					continue;
				}
				const markdownFiles = files.filter((file: string) => file.endsWith(".md"));
				if (!markdownFiles.includes("README.md")) markdownFiles.unshift("README.md");
				for (const file of markdownFiles) {
					let content = "";
					try {
						content = await readFile(join(specDir, file), "utf-8");
					} catch {
						// Missing README.md is reported by the validator below.
					}
					for (const issue of validateNormativeSpecContent(
						content,
						node.path.join("/"),
						file === "README.md",
					)) {
						results.push(`  ⚠ **${node.path.join(" > ")}** \`${file}\`: ${issue}`);
						issues++;
						documentationIssues++;
					}
				}
			}
			if (documentationIssues === 0) {
				results.push("  ✅ README.md and normative frontmatter are consistent");
			}

			// Step 2: Classification consistency
			results.push("");
			results.push("### 🏷️ Classification check");
			for (const node of nodes) {
				const label = node.path.join(" > ");
				if (!node.entry.type && node.path.length === 1) {
					results.push(`  ⚠ Domain **${label}** has no type field`);
					issues++;
				} else {
					passed++;
				}
			}
			if (issues === 0) {
				results.push("  ✅ All domains have a type");
			}

			// Step 3: Detailed checks
			if (params.detailed) {
				const ambiguousMappings = findAmbiguousCodeMappings(domainsCache);
				if (ambiguousMappings.length > 0) {
					results.push("");
					results.push("### 🧭 Mapping ambiguity");
					for (const issue of ambiguousMappings) {
						results.push(`  ⚠ ${issue}`);
						issues++;
					}
				}

				if (domainsCache._contextMap) {
					results.push("");
					results.push("### 🔗 Context map");
					const contextIssues = findContextMapIssues(domainsCache);
					let contextSectionIssues = contextIssues.length;
					for (const issue of contextIssues) {
						results.push(`  ⚠ ${issue}`);
						issues++;
					}
					for (const relationship of domainsCache._contextEntries || []) {
						if (!relationship.contract) continue;
						try {
							await stat(join(domainRoot!, relationship.contract));
							passed++;
						} catch {
							results.push(
								`  ⚠ Context contract \`${relationship.contract}\` for **${relationship.provider}** does not exist.`,
							);
							issues++;
							contextSectionIssues++;
						}
					}
					if (contextSectionIssues === 0 && (domainsCache._contextEntries || []).length > 0) {
						results.push("  ✅ Providers, consumers, patterns, and contracts are valid");
					} else if ((domainsCache._contextEntries || []).length === 0) {
						results.push(
							"  ⚠ Context map uses a legacy shape; declare `provider`, `consumers`, `pattern`, and `contract`.",
						);
						issues++;
					}
				}
			}

			// Summary
			results.push("");
			if (issues === 0) {
				results.push("**✅ All checks passed.** The domain tree looks healthy.");
			} else {
				results.push(`**⚠ ${issues} issue(s) found.** Review the items above and fix as needed.`);
			}

			return {
				content: [{ type: "text", text: results.join("\n") }],
				details: { issues, passed, root: domainRoot },
			};
		},
	});

	// Tool: domain_tree_map — show domain coverage dashboard
	pi.registerTool({
		name: "domain_tree_map",
		label: "Domain Tree Map",
		description:
			"Show the current state of the domain tree — what's specced, what's tested, and what's stale. " +
			"Displays a coverage dashboard with domain types and context map visualization.",
		promptSnippet: "Show domain tree coverage dashboard",
		promptGuidelines: [
			"Use domain_tree_map to get a quick overview of domain coverage before starting work.",
			"Check the map to understand which domains are core (most rigorous) vs generic (least).",
		],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			await ensureDomainRoot(ctx);
			if (!domainRoot || !domainsCache) {
				return {
					content: [{ type: "text", text: "No domain tree found. Run `/domain-tree:init` to create one." }],
				};
			}

			const { readdir } = await import("fs/promises");
			const typeEmoji: Record<string, string> = {
				core: "🔴",
				supporting: "🟡",
				generic: "🟢",
				"shared-kernel": "🔵",
			};

			const rows: string[] = [];
			rows.push("## Domain Tree");
			rows.push(`*Generated from \`${manifestRelPath(domainRoot)}\` at ${basename(domainRoot)}*`);
			rows.push("");
			rows.push(`| Domain | Type | Specs | Status |`);
			rows.push(`|--------|------|-------|--------|`);

			for (const node of flattenDomains(domainsCache)) {
				const type = node.type || "supporting";
				const emoji = typeEmoji[type] || "🟡";
				const typeLabel = `${emoji} ${type}`;
				const label = node.path.length === 1 ? `**${node.path[0]}**` : node.path.join(" > ");

				let specStatus = "❌ none";
				const specDir = specDirForEntry(domainRoot, node.entry);
				try {
					const files = specDir ? await readdir(specDir) : [];
					const mdFiles = files.filter((file: string) => file.endsWith(".md"));
					let normativeCount = 0;
					for (const file of mdFiles) {
						const content = await readFile(join(specDir!, file), "utf-8");
						const isReadme = file === "README.md";
						if (!isReadme && !content.startsWith("---\n")) continue;
						if (
							validateNormativeSpecContent(
								content,
								node.path.join("/"),
								isReadme,
							).length === 0
						) {
							normativeCount++;
						}
					}
					specStatus = normativeCount > 0 ? `✅ ${normativeCount}` : "❌ none";
				} catch {
					specStatus = "❌ none";
				}

				rows.push(`| ${label} | ${typeLabel} | ${specStatus} | |`);
			}

			// Context map section
			if (domainsCache._contextMap) {
				rows.push("");
				rows.push("### 🔗 Context Map");
				rows.push("```");
				rows.push(domainsCache._contextMap.trim());
				rows.push("```");
			}

			// Legend
			rows.push("");
			rows.push("**Legend:** 🔴 core  🟡 supporting  🟢 generic  🔵 shared-kernel");

			return {
				content: [{ type: "text", text: rows.join("\n") }],
				details: { root: domainRoot },
			};
		},
	});

	// ─── Commands ──────────────────────────────────────────────

	/**
	 * /domain-tree:init — Bootstrap the domain tree.
	 */
	pi.registerCommand("domain-tree:init", {
		description: "Bootstrap domain tree from existing codebase analysis",
		handler: async (_args, ctx) => {
			await ensureDomainRoot(ctx);
			if (isActive) {
				const overwrite = await ctx.ui.confirm(
					"Domain tree exists",
					"A domain manifest already exists. Overwrite?",
				);
				if (!overwrite) return;
			}

			ctx.ui.notify(
				"Let's analyze the codebase and propose a domain tree. " +
				"I'll scan the project structure and check existing documentation.",
				"info",
			);

			// Scan project and propose domain tree
			const msg = `I need to bootstrap a domain tree for this project.

Please:
1. Read the project structure — top-level directories, build files, module definitions
2. Read existing architecture docs and README files
3. Propose a domain tree with DDD subdomain classification (core/supporting/generic/shared-kernel)
4. Create domains.yaml with the approved tree
5. Create README.md domain specs next to each domain's code
6. Report the coverage with a summary table

Remember:
- Every domain must have at least one code path
- Prefer fewer domains (5-10) — split later when pain emerges
- Use the domain-navigator skill conventions for README.md structure
- Do NOT duplicate domains.yaml info in README.md files`;
			pi.sendUserMessage(msg);
		},
	});

	/**
	 * /domain-tree:check — Structural health check.
	 */
	pi.registerCommand("domain-tree:check", {
		description: "Validate domain tree structure against codebase",
		handler: async (args, ctx) => {
			await ensureDomainRoot(ctx);
			if (!isActive) {
				ctx.ui.notify("No domain tree found. Use /domain-tree:init first.", "warning");
				return;
			}

			const detailed = args.includes("--detailed") || args.includes("-d");

			const msg = `I need to validate the domain tree against the codebase.

Please:
1. Read domains.yaml
2. For each domain, verify declared code paths exist
3. Check for orphaned production code (not covered by any domain)
4. Check classification consistency (every classified domain has a type)
5. Check normative documentation integrity (README.md plus frontmatter-marked sibling specs)
${detailed ? "6. Check semantic context-map health (providers, consumers, patterns, and canonical contracts)" : ""}

Use domain_tree_check to help with the validation.

Report a summary with pass/fail and actionable recommendations.`;
			pi.sendUserMessage(msg);
		},
	});

	/**
	 * /domain-tree:map — Coverage dashboard.
	 */
	pi.registerCommand("domain-tree:map", {
		description: "Show domain tree with spec and test coverage",
		handler: async (_args, ctx) => {
			await ensureDomainRoot(ctx);
			if (!isActive) {
				ctx.ui.notify("No domain tree found. Use /domain-tree:init first.", "warning");
				return;
			}

			const msg = `I need to visualize the domain tree coverage.

Please:
1. Read domains.yaml
2. For each domain, check the colocated spec directory and count markdown spec files
3. Present a markdown table with:
   - Domain name (bold for parent, indented for subdomains)
   - Type with emoji (🔴 core, 🟡 supporting, 🟢 generic, 🔵 shared-kernel)
   - Spec count or ❌ none
4. Show the context map
5. Add recommendations weighted by domain importance

Use domain_tree_map to help generate the report.`;
			pi.sendUserMessage(msg);
		},
	});

	// ─── Init-time notification ────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		if (isActive && domainRoot) {
			ctx.ui.notify(
				`🌳 Domain-driven project detected at ${domainRoot}. ` +
				`Tools: domain_tree_resolve, domain_tree_check, domain_tree_map. ` +
				`Commands: /domain-tree:init, /domain-tree:check, /domain-tree:map. ` +
				`Skill: domain-navigator.`,
				"info",
			);
		}
	});
}
