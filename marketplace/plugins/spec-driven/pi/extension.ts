/**
 * Spec-Driven — pi extension
 *
 * Makes pi fluent in spec-driven development: collect requirements, define
 * acceptance criteria, and produce verifiable specs before code is written.
 *
 * What this extension provides:
 *   • Injects spec-driven expertise into the system prompt
 *   • Registers commands: /spec-collect, /spec-verify
 *   • Registers skills: spec-collector, spec-verifier
 *
 * For the companion skills, see ../skills/spec-collector/SKILL.md
 * and ../skills/spec-verifier/SKILL.md
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import {
	entryForResolution,
	flattenDomains,
	parseDomainsYaml,
	resolveDomainForFilePath,
	specDirForEntry,
	specLabelForEntry,
} from "../../domain-tree/pi/domain-core.ts";

export default function specDrivenExtension(pi: ExtensionAPI) {
	const specExpertise = `
## Spec-Driven Development

This project supports spec-driven development. Before writing code, collect a spec:

1. **Problem** — Why does this exist?
2. **Context** — What code and patterns are relevant?
3. **Decisions** — What architectural choices?
4. **Criteria** — What does "done" look like?
5. **Scope** — What can be touched?
6. **Verification** — How to prove each criterion?

A spec is a verifiable contract. If the spec is right, code review becomes optional.

**Key commands:** /spec-collect, /spec-verify
**Skills:** spec-collector, spec-verifier
`;

	pi.on("before_agent_start", async (event) => {
		return {
			systemPrompt: `${event.systemPrompt}\n${specExpertise}`,
		};
	});

	// Register commands
	pi.registerCommand("spec-collect", {
		description: "Collect a development spec through structured conversation",
		handler: async (_args, ctx) => {
			ctx.ui.notify("Starting spec collection. I'll guide you through the 6 phases.", "info");
			pi.sendUserMessage(
				"Let's collect a spec. Follow the spec-driven collection process: " +
				"Phase 1 (Problem), Phase 2 (Context - read the codebase), " +
				"Phase 3 (Decisions), Phase 4 (Criteria), Phase 5 (Scope), Phase 6 (Verification). " +
				"Use the spec-collector skill for detailed guidance."
			);
		},
	});

	pi.registerCommand("spec-verify", {
		description: "Verify a spec for completeness and quality",
		handler: async (args, ctx) => {
			if (!args.trim()) {
				ctx.ui.notify("Usage: /spec-verify <path-to-spec.md>", "info");
				return;
			}
			pi.sendUserMessage(
				`Verify the spec at ${args.trim()} for completeness and quality. ` +
				"Check all 7 required sections, criteria quality, scope precision, and verification plan coverage. " +
				"Use the spec-verifier skill for the full checklist."
			);
		},
	});

	// Optional: tool to check if a spec exists for a given domain
	pi.registerTool({
		name: "check_spec_coverage",
		label: "Check Spec Coverage",
		description: "Check if a spec exists and is up-to-date for a given domain or file path",
		promptSnippet: "Check if a spec exists for a domain",
		parameters: Type.Object({
			path: Type.String({
				description: "File path or domain name to check spec coverage for",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { readFile, readdir, stat } = await import("fs/promises");
			const { join } = await import("path");
			const cwd = process.cwd();

			try {
				const content = await readFile(join(cwd, "domains.yaml"), "utf-8");
				const domains = parseDomainsYaml(content);
				const requested = params.path.replace(/\s*>\s*/g, " > ");
				const directNode = flattenDomains(domains).find((node) =>
					node.path.join(" > ") === requested || node.path[node.path.length - 1] === requested
				);
				const resolved = directNode
					? { domain: directNode.path[0], subdomain: directNode.path.length > 1 ? directNode.path.slice(1).join(" > ") : null, type: directNode.type }
					: resolveDomainForFilePath(params.path, cwd, domains);
				const entry = resolved ? entryForResolution(domains, resolved) : null;
				const rootSpecDir = entry ? specDirForEntry(cwd, entry) : null;
				const specLabel = entry ? specLabelForEntry(entry) : null;

				if (rootSpecDir && specLabel) {
					const files = await readdir(rootSpecDir);
					const mdFiles = files.filter((f: string) => f.endsWith(".md"));
					if (mdFiles.length > 0) {
						return {
							content: [{
								type: "text",
								text: `**${params.path}** has ${mdFiles.length} spec file(s):\n` +
									mdFiles.map((f: string) => `  - \`${specLabel}${f}\``).join("\n"),
							}],
							details: { path: params.path, files: mdFiles.length, specDir: specLabel },
						};
					}
					return {
						content: [{ type: "text", text: `**${params.path}** spec directory exists at \`${specLabel}\` but contains no markdown files.` }],
						details: { path: params.path, files: 0, specDir: specLabel },
					};
				}

				return {
					content: [{
						type: "text",
						text: `No spec found for **${params.path}**. Available domains:\n` +
							flattenDomains(domains).map((node) => `  - \`${node.path.join(" > ")}\``).join("\n"),
					}],
					details: { path: params.path, found: false },
				};
			} catch {
				// Fall through to legacy spec/ layout below.
			}

			// Check if spec/domains.yaml exists first
			const specDir = join(cwd, "spec");
			try {
				await stat(specDir);
			} catch {
				return {
					content: [{ type: "text", text: "No `spec/` directory found in this project." }],
				};
			}

			const targetDir = join(specDir, params.path);
			try {
				const files = await readdir(targetDir);
				const mdFiles = files.filter((f: string) => f.endsWith(".md"));
				if (mdFiles.length > 0) {
					return {
						content: [
							{
								type: "text",
								text: `**${params.path}** has ${mdFiles.length} spec file(s):\n` +
									mdFiles.map((f: string) => `  - \`spec/${params.path}/${f}\``).join("\n"),
							},
						],
						details: { path: params.path, files: mdFiles.length },
					};
				}
				return {
					content: [
						{
							type: "text",
							text: `**${params.path}** spec directory exists but contains no markdown files.`,
						},
					],
					details: { path: params.path, files: 0 },
				};
			} catch {
				// Try to find closest spec
				const entries = await readdir(specDir);
				const domains = entries.filter((e: string) => {
					try { return stat(join(specDir, e)).then(s => s.isDirectory()); } catch { return false; }
				});

				return {
					content: [
						{
							type: "text",
							text: `No spec found for **${params.path}**. Available domains:\n` +
								domains.map((d: string) => `  - \`spec/${d}/\``).join("\n"),
						},
					],
					details: { path: params.path, found: false },
				};
			}
		},
	});
}
