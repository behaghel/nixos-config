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
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { dirname, join, resolve } from "path";
import { Type } from "typebox";
import {
	buildSpecCollectionPrompt,
	buildSpecVerificationPrompt,
	classifySpecContent,
	selectSpecMode,
} from "./spec-modes.ts";

function findDomainManifestRoot(start: string): string | null {
	let current = resolve(start);
	while (true) {
		if (existsSync(join(current, "domains.yaml"))) return current;
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

async function loadDomainCore() {
	return import("../../domain-tree/pi/domain-core.ts");
}

async function domainManifestState(start: string): Promise<{
	root: string | null;
	valid: boolean;
	error?: string;
}> {
	const root = findDomainManifestRoot(start);
	if (!root) return { root: null, valid: false };
	try {
		const { parseDomainManifest } = await loadDomainCore();
		const result = parseDomainManifest(
			await readFile(join(root, "domains.yaml"), "utf-8"),
		);
		if (result.domains) return { root, valid: true };
		return {
			root,
			valid: false,
			error: "domains.yaml is invalid:\n" + result.diagnostics
				.map((diagnostic) => `- ${diagnostic.path}: ${diagnostic.message}`)
				.join("\n"),
		};
	} catch (error) {
		return {
			root,
			valid: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export default function specDrivenExtension(pi: ExtensionAPI) {
	const specExpertise = `
## Spec-Driven Development

This project supports three specification modes when a domain manifest is present:

1. **Domain specification (default)** — durable, present-tense domain truth at the narrowest semantic owner.
2. **Iteration specification** — temporary, non-normative delivery scope, acceptance criteria, and verification.
3. **System specification** — durable RFC 2119 requirements that subsidiarity cannot assign to one domain.

Without \`domains.yaml\`, collect the conventional six-phase development specification. Never put iteration concerns into normative domain or system corpora.

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
		description: "Collect a domain, iteration, or system specification",
		handler: async (args, ctx) => {
			const manifest = await domainManifestState(ctx.cwd);
			if (manifest.root && !manifest.valid) {
				ctx.ui.notify(manifest.error || "domains.yaml is invalid.", "error");
				return;
			}
			const selection = selectSpecMode(args, manifest.valid);
			if (selection.error) {
				ctx.ui.notify(selection.error, "error");
				return;
			}
			ctx.ui.notify(`Starting ${selection.mode} specification collection.`, "info");
			pi.sendUserMessage(
				buildSpecCollectionPrompt(selection) +
				"\n\nUse the spec-collector skill for detailed guidance.",
			);
		},
	});

	pi.registerCommand("spec-verify", {
		description: "Verify a spec for completeness and quality",
		handler: async (args, ctx) => {
			const specPath = args.trim();
			if (!specPath) {
				ctx.ui.notify("Usage: /spec-verify <path-to-spec.md>", "info");
				return;
			}
			const manifest = await domainManifestState(ctx.cwd);
			if (manifest.root && !manifest.valid) {
				ctx.ui.notify(manifest.error || "domains.yaml is invalid.", "error");
				return;
			}
			let content: string;
			try {
				content = await readFile(resolve(ctx.cwd, specPath), "utf-8");
			} catch (error) {
				ctx.ui.notify(
					`Cannot read ${specPath}: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
				return;
			}
			const mode = classifySpecContent(content, manifest.valid);
			pi.sendUserMessage(
				buildSpecVerificationPrompt(mode, specPath) +
				" Use the spec-verifier skill for the full checklist.",
			);
		},
	});

	// Optional: tool to check if a spec exists for a given domain
	pi.registerTool({
		name: "check_spec_coverage",
		label: "Check Spec Coverage",
		description: "Check if a valid normative spec exists for a given domain or file path",
		promptSnippet: "Check if a spec exists for a domain",
		parameters: Type.Object({
			path: Type.String({
				description: "File path or domain name to check spec coverage for",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { readdir, stat } = await import("fs/promises");
			const cwd = process.cwd();
			const domainRoot = findDomainManifestRoot(cwd);

			try {
				if (!domainRoot) throw new Error("No domain manifest");
				const {
					entryForResolution,
					flattenDomains,
					parseDomainManifest,
					resolveDomainForFilePath,
					specDirForEntry,
					specLabelForEntry,
					validateNormativeSpecContent,
				} = await loadDomainCore();
				const content = await readFile(join(domainRoot, "domains.yaml"), "utf-8");
				const manifest = parseDomainManifest(content);
				if (!manifest.domains) {
					return {
						content: [{
							type: "text",
							text: "`domains.yaml` is invalid. Spec coverage is unavailable until these issues are fixed:\n\n" +
								manifest.diagnostics.map((diagnostic) =>
									`- \`${diagnostic.path}\`: ${diagnostic.message}`,
								).join("\n"),
						}],
						details: { valid: false, diagnostics: manifest.diagnostics },
					};
				}
				const domains = manifest.domains;
				const requested = params.path.replace(/\s*>\s*/g, " > ");
				const directNode = flattenDomains(domains).find((node) =>
					node.path.join(" > ") === requested || node.path[node.path.length - 1] === requested
				);
				const resolved = directNode
					? { domain: directNode.path[0], subdomain: directNode.path.length > 1 ? directNode.path.slice(1).join(" > ") : null, type: directNode.type }
					: resolveDomainForFilePath(params.path, domainRoot, domains);
				const entry = resolved ? entryForResolution(domains, resolved) : null;
				const rootSpecDir = entry ? specDirForEntry(domainRoot, entry) : null;
				const specLabel = entry ? specLabelForEntry(entry) : null;

				if (rootSpecDir && specLabel && resolved) {
					const files = await readdir(rootSpecDir);
					const expectedDomain = [
						resolved.domain,
						...(resolved.subdomain ? resolved.subdomain.split(" > ") : []),
					].join("/");
					const normativeFiles: string[] = [];
					const invalidFiles: string[] = [];
					for (const file of files.filter((name: string) => name.endsWith(".md"))) {
						const specContent = await readFile(join(rootSpecDir, file), "utf-8");
						const isReadme = file === "README.md";
						if (!isReadme && !specContent.startsWith("---\n")) continue;
						const validationIssues = validateNormativeSpecContent(
							specContent,
							expectedDomain,
							isReadme,
						);
						if (validationIssues.length === 0) normativeFiles.push(file);
						else invalidFiles.push(`${file}: ${validationIssues.join(" ")}`);
					}
					if (normativeFiles.length > 0 && normativeFiles.includes("README.md")) {
						return {
							content: [{
								type: "text",
								text: `**${params.path}** has ${normativeFiles.length} normative spec file(s):\n` +
									normativeFiles.map((file: string) => `  - \`${specLabel}${file}\``).join("\n") +
									(invalidFiles.length > 0 ? `\nInvalid normative files:\n${invalidFiles.map((issue) => `  - ${issue}`).join("\n")}` : ""),
							}],
							details: { path: params.path, files: normativeFiles.length, specDir: specLabel, invalidFiles },
						};
					}
					return {
						content: [{ type: "text", text: `**${params.path}** has no valid normative README.md at \`${specLabel}\`.` }],
						details: { path: params.path, files: normativeFiles.length, specDir: specLabel, invalidFiles },
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
			} catch (error) {
				if (domainRoot) {
					return {
						content: [{
							type: "text",
							text: "Domain-aware spec coverage is unavailable: " +
								(error instanceof Error ? error.message : String(error)),
						}],
						details: { path: params.path, found: false },
					};
				}
				// Fall through to legacy spec/ layout below when no domain manifest exists.
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
