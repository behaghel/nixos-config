/**
 * Domain Tree — pi extension
 *
 * Makes pi fluent in domain-driven codebase structure: DDD-informed domain
 * trees with 1:1 spec/code mirroring, subdomain classification, context
 * mapping, and shared kernel management.
 *
 * What this extension provides:
 *   • Auto-detects domain-tree projects (spec/domains.yaml)
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
import { join, resolve, basename, dirname, relative } from "path";
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

/** Find the project root by looking for spec/domains.yaml from cwd upward. */
function findDomainRoot(cwd: string): string | null {
	let dir = resolve(cwd);
	for (let i = 0; i < 20; i++) {
		if (pathExists(join(dir, "spec", "domains.yaml"))) {
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
	return pathExists(join(dir, "spec", "domains.yaml"));
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
		const content = await readFile(join(root, "spec", "domains.yaml"), "utf-8");
		// Simple YAML-like parse for the domains section (no full YAML parser dependency)
		// We extract enough structure to use in enforcement
		const domains: Record<string, any> = {};
		const lines = content.split("\n");
		let currentDomain: string | null = null;
		let currentSubdomain: string | null = null;
		let inDomains = false;
		let inContextMap = false;

		for (const line of lines) {
			const trimmed = line.trim();

			if (trimmed === "domains:") {
				inDomains = true;
				inContextMap = false;
				continue;
			}
			if (trimmed === "context-map:") {
				inDomains = false;
				inContextMap = true;
				continue;
			}
			if (trimmed.startsWith("project:") || trimmed === "") {
				continue;
			}

			if (inDomains) {
				// Top-level domain key
				const topMatch = trimmed.match(/^(\w[\w-]*):$/);
				if (topMatch && line.startsWith("  ") && !line.startsWith("    ")) {
					currentDomain = topMatch[1];
					currentSubdomain = null;
					domains[currentDomain] = { name: currentDomain, type: "supporting" };
					continue;
				}
				// Subdomain key
				const subMatch = trimmed.match(/^(\w[\w-]*):$/);
				if (subMatch && line.startsWith("    ") && currentDomain) {
					currentSubdomain = subMatch[1];
					if (!domains[currentDomain].subdomains) {
						domains[currentDomain].subdomains = {};
					}
					domains[currentDomain].subdomains[currentSubdomain] = { name: currentSubdomain };
					continue;
				}
				// type field
				const typeMatch = trimmed.match(/^type:\s*(core|supporting|generic|shared-kernel)/);
				if (typeMatch) {
					if (currentSubdomain && domains[currentDomain]?.subdomains?.[currentSubdomain]) {
						domains[currentDomain].subdomains[currentSubdomain].type = typeMatch[1];
					} else if (currentDomain && domains[currentDomain]) {
						domains[currentDomain].type = typeMatch[1];
					}
				}
				// code field
				const codeMatch = trimmed.match(/^code:\s*\[(.+)\]/);
				if (codeMatch && currentDomain) {
					const paths = codeMatch[1].split(",").map((p: string) => p.trim().replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1"));
					if (currentSubdomain && domains[currentDomain]?.subdomains?.[currentSubdomain]) {
						domains[currentDomain].subdomains[currentSubdomain].code = paths;
					} else {
						domains[currentDomain].code = paths;
					}
				}
				// code-paths field (multiline)
				const codePathMatch = trimmed.match(/^-\s+(.+)$/);
				if (codePathMatch && currentDomain && !trimmed.startsWith("#")) {
					// Collect code paths - this is approximate for multiline arrays
					const val = codePathMatch[1].replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1");
					if (currentSubdomain && domains[currentDomain]?.subdomains?.[currentSubdomain]) {
						if (!domains[currentDomain].subdomains[currentSubdomain].code) {
							domains[currentDomain].subdomains[currentSubdomain].code = [];
						}
						if (typeof domains[currentDomain].subdomains[currentSubdomain].code !== "string" && !domains[currentDomain].subdomains[currentSubdomain].code.startsWith) {
							domains[currentDomain].subdomains[currentSubdomain].code.push(val);
						}
					} else if (currentDomain && domains[currentDomain]) {
						if (!domains[currentDomain].code) {
							domains[currentDomain].code = [];
						}
						if (Array.isArray(domains[currentDomain].code)) {
							domains[currentDomain].code.push(val);
						}
					}
				}
			}

			if (inContextMap) {
				// Collect context map entries (from/to/pattern)
				const fromMatch = trimmed.match(/^from:\s*(\S+)/);
				const toMatch = trimmed.match(/^to:\s*(\S+)/);
				const patternMatch = trimmed.match(/^pattern:\s*(\S+)/);
				if (fromMatch || toMatch || patternMatch) {
					// Simple tracking - just note that relationships exist
				}
			}
		}

		// Also extract context-map roughly
		const contextMapMatch = content.match(/context-map:\s*\n((?:\s+.*\n)*)/);
		if (contextMapMatch) {
			domains._contextMap = contextMapMatch[1];
		}

		return domains;
	} catch {
		return null;
	}
}

/** Determine which domain a file path belongs to from the domain manifest. */
async function resolveDomainForFile(filePath: string, root: string, domains: Record<string, any>): Promise<{ domain: string; subdomain: string | null; type: string } | null> {
	const absPath = resolve(root, filePath);
	const relPath = relative(root, absPath);

	for (const [domainName, domain] of Object.entries(domains)) {
		if (domainName.startsWith("_")) continue;

		// Check subdomains first
		if (domain.subdomains) {
			for (const [subName, subdomain] of Object.entries(domain.subdomains) as [string, any][]) {
				const codePaths = subdomain.code || [];
				for (const cp of codePaths) {
					const cpNorm = cp.replace(/\/+$/, "");
					if (relPath === cpNorm || relPath.startsWith(cpNorm + "/") || relPath.startsWith(cpNorm.replace(/\/\*$/, ""))) {
						return { domain: domainName, subdomain: subName, type: subdomain.type || domain.type || "supporting" };
					}
				}
			}
		}

		// Check domain-level code paths
		const codePaths = domain.code || [];
		for (const cp of codePaths) {
			const cpNorm = cp.replace(/\/+$/, "");
			if (relPath === cpNorm || relPath.startsWith(cpNorm + "/")) {
				return { domain: domainName, subdomain: null, type: domain.type || "supporting" };
			}
		}
	}

	return null;
}

/** Check if a spec exists for a given domain. */
async function specExistsForDomain(root: string, domainName: string, subdomain: string | null): Promise<boolean> {
	const specDir = subdomain
		? join(root, "spec", domainName, subdomain)
		: join(root, "spec", domainName);
	try {
		await access(specDir);
		// Check if there are .md files in the directory
		const { readdir } = await import("fs/promises");
		const files = await readdir(specDir);
		return files.some((f: string) => f.endsWith(".md"));
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

This project uses a domain-driven codebase structure defined in \`spec/domains.yaml\`.
The domain tree encodes three things:

1. **Where things live** — the 1:1 namespace mirror between \`spec/\` and code
2. **How much rigor each domain deserves** — core vs supporting vs generic classification
3. **How domains communicate** — the context map declaring integration patterns

### Core rules
- **1:1 mirroring** — \`spec/\` directory structure MUST mirror domain tree. Code SHOULD mirror the tree too.
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
| \`spec/domains.yaml\` | Domain tree manifest (source of truth) |
| \`spec/<domain>/**/*.md\` | Domain specs |
| \`doc/ARCHITECTURE.md\` | Architecture coordination index |

For detailed reference, load the \`domain-navigator\` skill.
`;

		return {
			systemPrompt: `${event.systemPrompt}\n${domainExpertise}`,
		};
	});

	// ─── Tool monitoring: spec-on-touch & cross-domain enforcement ──

	pi.on("tool_call", async (event, ctx) => {
		if (!isActive || !domainRoot || !domainsCache) return;

		if (event.toolName === "write" || event.toolName === "edit") {
			const input = event.input as { path?: string; command?: string };
			const targetPath = input?.path || "";

			// Try to resolve which domain this touches
			const resolved = await resolveDomainForFile(targetPath, domainRoot, domainsCache);
			if (!resolved) return; // not in any domain

			// Check spec-on-touch for core domains
			const domainType = resolved.type;
			if (domainType === "core" || domainType === "shared-kernel") {
				const hasSpec = await specExistsForDomain(domainRoot, resolved.domain, resolved.subdomain);
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
								`Check the context map in \`spec/domains.yaml\` for which domains depend on this.`,
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
			"Resolve which domain and subdomain own a given file path, based on spec/domains.yaml. " +
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
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			if (!domainRoot || !domainsCache) {
				return {
					content: [
						{
							type: "text",
							text: "No domain tree found. Run `/domain-tree:init` to create one, or check that `spec/domains.yaml` exists.",
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
							text: `**${params.path}** is not covered by any domain in \`spec/domains.yaml\`. ` +
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

			const specDir = resolved.subdomain
				? `spec/${resolved.domain}/${resolved.subdomain}/`
				: `spec/${resolved.domain}/`;

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
			"Validate that the domain tree in spec/domains.yaml matches the actual codebase. " +
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
			results.push("");

			// Step 1: Check declared paths exist
			results.push("### 📁 Mappings: manifest → codebase");
			for (const [domainName, domain] of Object.entries(domainsCache)) {
				if (domainName.startsWith("_")) continue;

				const checkPaths = async (paths: string[], label: string) => {
					for (const cp of paths || []) {
						const cpNorm = cp.replace(/\/+$/, "");
						const fullPath = join(domainRoot!, cpNorm);
						try {
							await stat(fullPath);
							passed++;
						} catch {
							results.push(`  ⚠ Domain **${domainName}**${label} declares \`${cp}\` but it doesn't exist`);
							issues++;
						}
					}
				};

				await checkPaths(domain.code || [], "");
				// Check spec dir
				const specDir = join(domainRoot, "spec", domainName);
				try {
					await stat(specDir);
					passed++;
				} catch {
					results.push(`  ⚠ Domain **${domainName}** has no spec directory at \`spec/${domainName}/\``);
					issues++;
				}

				// Check subdomains
				if (domain.subdomains) {
					for (const [subName, sub] of Object.entries(domain.subdomains) as [string, any][]) {
						await checkPaths(sub.code || [], ` > ${subName}`);
						const subSpecDir = join(domainRoot, "spec", domainName, subName);
						try {
							await stat(subSpecDir);
							passed++;
						} catch {
							results.push(`  ⚠ Domain **${domainName} > ${subName}** has no spec directory`);
							issues++;
						}
					}
				}
			}

			if (issues === 0 && passed > 0) {
				results.push("  ✅ All declared paths exist");
			}

			// Step 2: Classification consistency
			results.push("");
			results.push("### 🏷️ Classification check");
			for (const [domainName, domain] of Object.entries(domainsCache)) {
				if (domainName.startsWith("_")) continue;
				if (!domain.type) {
					results.push(`  ⚠ Domain **${domainName}** has no type field`);
					issues++;
				} else {
					passed++;
				}
			}
			if (issues === 0) {
				results.push("  ✅ All domains have a type");
			}

			// Step 3: Context map (if detailed)
			if (params.detailed && domainsCache._contextMap) {
				results.push("");
				results.push("### 🔗 Context map");
				results.push("  ℹ Context map entries declared. Run `/domain-tree:check` locally for full validation.");
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
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
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
			rows.push(`*Generated from \`spec/domains.yaml\` at ${basename(domainRoot)}*`);
			rows.push("");
			rows.push(`| Domain | Type | Specs | Status |`);
			rows.push(`|--------|------|-------|--------|`);

			for (const [domainName, domain] of Object.entries(domainsCache)) {
				if (domainName.startsWith("_")) continue;

				const type = domain.type || "supporting";
				const emoji = typeEmoji[type] || "🟡";
				const typeLabel = `${emoji} ${type}`;

				// Count spec files
				let specCount = 0;
				let specStatus = "❌ none";

				if (domain.subdomains) {
					// Check subdomains
					const subRows: string[] = [];
					for (const [subName, sub] of Object.entries(domain.subdomains) as [string, any][]) {
						const subSpecDir = join(domainRoot, "spec", domainName, subName);
						try {
							const files = await readdir(subSpecDir);
							const mdFiles = files.filter((f: string) => f.endsWith(".md"));
							const subSpecCount = mdFiles.length;
							specCount += subSpecCount;
							const subStatus = subSpecCount > 0 ? `✅ ${subSpecCount}` : "❌ none";
							subRows.push(`| ${domainName} > ${subName} | | ${subStatus} | |`);
						} catch {
							subRows.push(`| ${domainName} > ${subName} | | ❌ none | |`);
						}
					}
					specStatus = specCount > 1 ? `✅ ${specCount}` : specCount === 1 ? "✅ 1" : "❌ none";
					rows.push(`| **${domainName}** | ${typeLabel} | ${specStatus} | |`);
					rows.push(...subRows);
				} else {
					const specDir = join(domainRoot, "spec", domainName);
					try {
						const files = await readdir(specDir);
						const mdFiles = files.filter((f: string) => f.endsWith(".md"));
						specCount = mdFiles.length;
						specStatus = specCount > 0 ? `✅ ${specCount}` : "❌ none";
					} catch {
						specStatus = "❌ none";
					}
					rows.push(`| **${domainName}** | ${typeLabel} | ${specStatus} | |`);
				}
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
			if (isActive) {
				const overwrite = await ctx.ui.confirm(
					"Domain tree exists",
					"spec/domains.yaml already exists. Overwrite?",
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
4. Create spec/domains.yaml with the approved tree
5. Create empty spec/ directories for each domain
6. Report the coverage with a summary table

Remember:
- Every domain must have at least one code path
- Prefer fewer domains (5-10) — split later when pain emerges
- Use the domain-navigator skill conventions for index.md structure
- Do NOT duplicate domains.yaml info in index.md files`;
			pi.sendUserMessage(msg);
		},
	});

	/**
	 * /domain-tree:check — Structural health check.
	 */
	pi.registerCommand("domain-tree:check", {
		description: "Validate domain tree structure against codebase",
		handler: async (args, ctx) => {
			if (!isActive) {
				ctx.ui.notify("No domain tree found. Use /domain-tree:init first.", "warning");
				return;
			}

			const detailed = args.includes("--detailed") || args.includes("-d");

			const msg = `I need to validate the domain tree against the codebase.

Please:
1. Read spec/domains.yaml
2. For each domain, verify declared code paths exist
3. Check for orphaned production code (not covered by any domain)
4. Check classification consistency (every domain has a type)
5. Check index.md quality (no duplication of domains.yaml info)
${detailed ? "6. Check context map health (verify via paths exist, shared-kernel consumers)" : ""}

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
			if (!isActive) {
				ctx.ui.notify("No domain tree found. Use /domain-tree:init first.", "warning");
				return;
			}

			const msg = `I need to visualize the domain tree coverage.

Please:
1. Read spec/domains.yaml
2. For each domain, check the spec directory and count spec files
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
