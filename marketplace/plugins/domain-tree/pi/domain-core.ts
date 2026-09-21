import { join, relative, resolve } from "path";

type DomainEntry = {
	name: string;
	type?: string;
	code?: string[];
	spec?: string;
	subdomains?: Record<string, DomainEntry>;
};

export type Domains = Record<string, DomainEntry> & { _contextMap?: string };

export type DomainNode = {
	path: string[];
	entry: DomainEntry;
	type: string;
};

export type DomainResolution = {
	domain: string;
	subdomain: string | null;
	type: string;
};

function normalizeDomainDir(pathValue: string): string {
	return pathValue.replace(/\/+$|^\.\//g, "");
}

export function specLabelForEntry(entry: DomainEntry): string | null {
	if (entry.spec) return normalizeDomainDir(entry.spec).replace(/\/+$/, "") + "/";
	const codePaths = entry.code || [];
	if (codePaths.length === 0) return null;
	return `${normalizeDomainDir(codePaths[0])}/`;
}

export function specDirForEntry(root: string, entry: DomainEntry): string | null {
	const label = specLabelForEntry(entry);
	return label ? join(root, label) : null;
}

function unquote(value: string): string {
	return value.trim().replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1");
}

function splitInlineList(value: string): string[] {
	return value.split(",").map(unquote).filter(Boolean);
}

function indentation(line: string): number {
	return line.match(/^ */)?.[0].length ?? 0;
}

function pathMatches(relPath: string, manifestPath: string): boolean {
	const norm = normalizeDomainDir(manifestPath);
	if (norm.endsWith("/*")) {
		const globPrefix = norm.replace(/\/\*$/, "");
		return relPath === globPrefix || relPath.startsWith(globPrefix + "/");
	}
	return relPath === norm || relPath.startsWith(norm + "/");
}

function matchLength(manifestPath: string): number {
	return normalizeDomainDir(manifestPath).replace(/\/\*$/, "").length;
}

function toResolution(node: DomainNode): DomainResolution {
	return {
		domain: node.path[0],
		subdomain: node.path.length > 1 ? node.path.slice(1).join(" > ") : null,
		type: node.type,
	};
}

export function parseDomainsYaml(content: string): Domains {
	const domains: Domains = {};
	const lines = content.split("\n");
	let inDomains = false;
	let inContextMap = false;
	let collectingCodeFor: DomainEntry | null = null;

	const stack: Array<
		| { kind: "domains"; indent: number; entries: Record<string, DomainEntry>; inheritedType?: string; path: string[] }
		| { kind: "subdomains"; indent: number; entries: Record<string, DomainEntry>; inheritedType?: string; path: string[] }
		| { kind: "domain"; indent: number; entry: DomainEntry; inheritedType?: string; path: string[] }
	> = [];

	const nearestDomain = (indent: number) => {
		for (let i = stack.length - 1; i >= 0; i--) {
			const frame = stack[i];
			if (frame.kind === "domain" && frame.indent < indent) return frame;
		}
		return null;
	};

	const nearestContainer = (indent: number) => {
		for (let i = stack.length - 1; i >= 0; i--) {
			const frame = stack[i];
			if ((frame.kind === "domains" || frame.kind === "subdomains") && frame.indent < indent) return frame;
		}
		return null;
	};

	for (const line of lines) {
		const trimmed = line.trim();
		const indent = indentation(line);
		if (trimmed === "domains:") {
			inDomains = true;
			inContextMap = false;
			collectingCodeFor = null;
			stack.length = 0;
			stack.push({ kind: "domains", indent: 0, entries: domains, path: [] });
			continue;
		}
		if (trimmed === "context-map:") {
			inDomains = false;
			inContextMap = true;
			collectingCodeFor = null;
			stack.length = 0;
			continue;
		}
		if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("project:")) continue;

		if (inDomains) {
			if (!trimmed.startsWith("- ")) {
				while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
					stack.pop();
				}
				collectingCodeFor = null;
			}

			const keyOnlyMatch = trimmed.match(/^(\w[\w-]*):$/);
			if (keyOnlyMatch) {
				if (trimmed === "code:") {
					const domainFrame = nearestDomain(indent + 1);
					if (domainFrame) {
						domainFrame.entry.code = [];
						collectingCodeFor = domainFrame.entry;
					}
					continue;
				}

				if (trimmed === "subdomains:") {
					const parent = nearestDomain(indent);
					if (parent) {
						parent.entry.subdomains = parent.entry.subdomains || {};
						stack.push({
							kind: "subdomains",
							indent,
							entries: parent.entry.subdomains,
							inheritedType: parent.entry.type || parent.inheritedType,
							path: parent.path,
						});
					}
					continue;
				}

				if (["language", "owners"].includes(keyOnlyMatch[1])) continue;

				const container = nearestContainer(indent);
				if (container) {
					const name = keyOnlyMatch[1];
					const entry: DomainEntry = { name };
					container.entries[name] = entry;
					stack.push({
						kind: "domain",
						indent,
						entry,
						inheritedType: container.inheritedType,
						path: [...container.path, name],
					});
					continue;
				}
			}

			const domainFrame = nearestDomain(indent + 1);
			if (!domainFrame) continue;

			const typeMatch = trimmed.match(/^type:\s*(core|supporting|generic|shared-kernel)/);
			if (typeMatch) {
				domainFrame.entry.type = typeMatch[1];
				continue;
			}

			const specMatch = trimmed.match(/^spec:\s*(.+)$/);
			if (specMatch) {
				domainFrame.entry.spec = unquote(specMatch[1]);
				continue;
			}

			const codeInlineMatch = trimmed.match(/^code:\s*\[(.*)\]/);
			if (codeInlineMatch) {
				domainFrame.entry.code = splitInlineList(codeInlineMatch[1]);
				continue;
			}

			const codePathMatch = trimmed.match(/^-\s+(.+)$/);
			if (codePathMatch && collectingCodeFor) {
				collectingCodeFor.code = [...(collectingCodeFor.code || []), unquote(codePathMatch[1])];
				continue;
			}
		}

		if (inContextMap) {
			// Context map is displayed as raw manifest text by the extension.
		}
	}

	const contextMapMatch = content.match(/context-map:\s*\n((?:\s+.*\n?)*)/);
	if (contextMapMatch) domains._contextMap = contextMapMatch[1];
	return domains;
}

export function flattenDomains(domains: Domains): DomainNode[] {
	const nodes: DomainNode[] = [];
	const walk = (entries: Record<string, DomainEntry>, parentPath: string[], inheritedType = "supporting") => {
		for (const [name, entry] of Object.entries(entries)) {
			if (name.startsWith("_")) continue;
			const type = entry.type || inheritedType;
			const path = [...parentPath, name];
			nodes.push({ path, entry, type });
			if (entry.subdomains) walk(entry.subdomains, path, type);
		}
	};
	walk(domains, []);
	return nodes;
}

export function entryForPath(domains: Domains, path: string[]): DomainEntry | null {
	let entry: DomainEntry | undefined = domains[path[0]];
	for (const part of path.slice(1)) {
		entry = entry?.subdomains?.[part];
	}
	return entry || null;
}

export function entryForResolution(domains: Domains, resolved: DomainResolution): DomainEntry | null {
	return entryForPath(domains, [resolved.domain, ...(resolved.subdomain ? resolved.subdomain.split(" > ") : [])]);
}

export function resolveDomainForFilePath(filePath: string, root: string, domains: Domains): DomainResolution | null {
	const absPath = resolve(root, filePath);
	const relPath = relative(root, absPath);
	const candidates: Array<{ node: DomainNode; length: number; kind: "code" | "spec" }> = [];

	for (const node of flattenDomains(domains)) {
		for (const cp of node.entry.code || []) {
			if (pathMatches(relPath, cp)) candidates.push({ node, length: matchLength(cp), kind: "code" });
		}
		if (node.entry.spec && pathMatches(relPath, node.entry.spec)) {
			candidates.push({ node, length: matchLength(node.entry.spec), kind: "spec" });
		}
	}
	if (candidates.length === 0) return null;

	candidates.sort((a, b) => {
		if (b.length !== a.length) return b.length - a.length;
		if (a.kind !== b.kind) return a.kind === "spec" ? -1 : 1;
		const aHasExplicitSpec = Boolean(a.node.entry.spec);
		const bHasExplicitSpec = Boolean(b.node.entry.spec);
		if (aHasExplicitSpec !== bHasExplicitSpec) return aHasExplicitSpec ? 1 : -1;
		return b.node.path.length - a.node.path.length;
	});

	return toResolution(candidates[0].node);
}

export function findAmbiguousCodeMappings(domains: Domains): string[] {
	const byPath = new Map<string, DomainNode[]>();
	for (const node of flattenDomains(domains)) {
		for (const cp of node.entry.code || []) {
			const key = normalizeDomainDir(cp);
			byPath.set(key, [...(byPath.get(key) || []), node]);
		}
	}
	const issues: string[] = [];
	for (const [cp, nodes] of byPath.entries()) {
		if (nodes.length <= 1) continue;
		const labels = nodes.map((n) => n.path.join(" > ")).join(", ");
		issues.push(`Code path \`${cp}/\` is declared by multiple domains: ${labels}. Use more-specific code paths or explicit spec paths to disambiguate specs.`);
	}
	return issues;
}
