import { join, relative, resolve } from "path";
import { parse } from "yaml";

export type DomainEntry = {
	name: string;
	description?: string;
	type?: string;
	status?: string;
	code?: string[];
	spec?: string;
	subdomains?: Record<string, DomainEntry>;
};

export type DomainGroup = {
	name: string;
	kind: "group";
	description?: string;
	domains: Record<string, DomainTreeEntry>;
};

export type DomainTreeEntry = DomainEntry | DomainGroup;

export type ContextMapEntry = {
	provider: string;
	consumers: string[];
	pattern: string;
	contract?: string;
};

export type Domains = Record<string, DomainTreeEntry> & {
	_contextMap?: string;
	_contextEntries?: ContextMapEntry[];
};

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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.filter((item): item is string => typeof item === "string");
}

function parseDomainEntries(value: unknown): Record<string, DomainTreeEntry> {
	if (!isRecord(value)) return {};
	const entries: Record<string, DomainTreeEntry> = {};
	for (const [name, rawEntry] of Object.entries(value)) {
		if (!isRecord(rawEntry)) continue;
		if (rawEntry.kind === "group") {
			entries[name] = {
				name,
				kind: "group",
				description: typeof rawEntry.description === "string"
					? rawEntry.description
					: undefined,
				domains: parseDomainEntries(rawEntry.domains),
			};
			continue;
		}

		entries[name] = {
			name,
			description: typeof rawEntry.description === "string"
				? rawEntry.description
				: undefined,
			type: typeof rawEntry.type === "string" ? rawEntry.type : undefined,
			status: typeof rawEntry.status === "string" ? rawEntry.status : undefined,
			code: stringArray(rawEntry.code),
			spec: typeof rawEntry.spec === "string" ? rawEntry.spec : undefined,
			subdomains: parseDomainEntries(rawEntry.subdomains) as Record<string, DomainEntry>,
		};
	}
	return entries;
}

function isDomainGroup(entry: DomainTreeEntry): entry is DomainGroup {
	return "kind" in entry && entry.kind === "group";
}

export function parseDomainsYaml(content: string): Domains {
	const manifest = parse(content);
	const root = isRecord(manifest) ? manifest : {};
	const domains = parseDomainEntries(root.domains) as Domains;
	const rawContextMap = Array.isArray(root["context-map"])
		? root["context-map"]
		: [];
	const contextEntries: ContextMapEntry[] = [];
	for (const rawEntry of rawContextMap) {
		if (!isRecord(rawEntry)) continue;
		contextEntries.push({
			provider: typeof rawEntry.provider === "string" ? rawEntry.provider : "",
			consumers: stringArray(rawEntry.consumers) || [],
			pattern: typeof rawEntry.pattern === "string" ? rawEntry.pattern : "",
			contract: typeof rawEntry.contract === "string" ? rawEntry.contract : undefined,
		});
	}

	const contextMapMatch = content.match(/context-map:\s*\n((?:\s+.*\n?)*)/);
	if (contextMapMatch) domains._contextMap = contextMapMatch[1];
	if (contextEntries.length > 0) domains._contextEntries = contextEntries;
	return domains;
}

export function flattenDomains(domains: Domains): DomainNode[] {
	const nodes: DomainNode[] = [];
	const walk = (
		entries: Record<string, DomainTreeEntry>,
		parentPath: string[],
		inheritedType = "supporting",
	) => {
		for (const [name, entry] of Object.entries(entries)) {
			if (name.startsWith("_")) continue;
			const path = [...parentPath, name];
			if (isDomainGroup(entry)) {
				walk(entry.domains, path, inheritedType);
				continue;
			}
			const type = entry.type || inheritedType;
			nodes.push({ path, entry, type });
			if (entry.subdomains) walk(entry.subdomains, path, type);
		}
	};
	walk(domains, []);
	return nodes;
}

export function entryForPath(domains: Domains, path: string[]): DomainEntry | null {
	let entry: DomainTreeEntry | undefined = domains[path[0]];
	for (const part of path.slice(1)) {
		entry = entry && isDomainGroup(entry)
			? entry.domains[part]
			: entry?.subdomains?.[part];
	}
	return entry && !isDomainGroup(entry) ? entry : null;
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

function isAncestorPath(ancestor: string[], descendant: string[]): boolean {
	return (
		ancestor.length < descendant.length &&
		ancestor.every((part, index) => descendant[index] === part)
	);
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
		const conflicting = new Set<DomainNode>();
		for (let left = 0; left < nodes.length; left++) {
			for (let right = left + 1; right < nodes.length; right++) {
				const leftNode = nodes[left];
				const rightNode = nodes[right];
				if (
					!isAncestorPath(leftNode.path, rightNode.path) &&
					!isAncestorPath(rightNode.path, leftNode.path)
				) {
					conflicting.add(leftNode);
					conflicting.add(rightNode);
				}
			}
		}
		if (conflicting.size === 0) continue;
		const labels = [...conflicting]
			.map((node) => node.path.join(" > "))
			.join(", ");
		issues.push(
			`Code path \`${cp}/\` is declared by unrelated domains: ${labels}. Use distinct code paths or explicit spec paths to establish one semantic owner.`,
		);
	}
	return issues;
}

const CONTEXT_PATTERNS = new Set([
	"shared-kernel",
	"customer-supplier",
	"conformist",
	"anti-corruption-layer",
	"open-host-service",
	"published-language",
	"partnership",
	"separate-ways",
]);

const NORMATIVE_FRONTMATTER_KEYS = new Set([
	"domain",
	"status",
	"term",
	"aliases",
]);

export function validateNormativeSpecContent(
	content: string,
	expectedDomain: string,
	isReadme: boolean,
): string[] {
	const match = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
	if (!match) {
		return isReadme
			? ["README.md must declare normative frontmatter with `domain` and `status`."]
			: [];
	}

	const metadata = new Map<string, string>();
	for (const line of match[1].split("\n")) {
		const field = line.match(/^([a-z][a-z-]*):\s*(.*)$/);
		if (field) metadata.set(field[1], field[2].trim());
	}

	const issues: string[] = [];
	for (const key of metadata.keys()) {
		if (!NORMATIVE_FRONTMATTER_KEYS.has(key)) {
			issues.push(`Unsupported normative frontmatter key \`${key}\`.`);
		}
	}
	if (metadata.get("domain") !== expectedDomain) {
		issues.push(
			`Normative frontmatter domain must be \`${expectedDomain}\`.`,
		);
	}
	const status = metadata.get("status");
	if (!status) {
		issues.push("Normative frontmatter must declare `status`.");
	} else if (!["draft", "approved", "stale"].includes(status)) {
		issues.push(
			"Normative frontmatter `status` must be `draft`, `approved`, or `stale`.",
		);
	}
	if (metadata.has("aliases") && !metadata.has("term")) {
		issues.push("Normative frontmatter `aliases` requires a canonical `term`.");
	}
	return issues;
}

export function findContextMapIssues(domains: Domains): string[] {
	const domainPaths = new Set(
		flattenDomains(domains).map((node) => node.path.join("/")),
	);
	const issues: string[] = [];
	for (const entry of domains._contextEntries || []) {
		if (!domainPaths.has(entry.provider)) {
			issues.push(
				`Context provider \`${entry.provider}\` is not declared in the domain tree.`,
			);
		}
		if (entry.consumers.length === 0) {
			issues.push(
				`Context relationship \`${entry.provider}\` has no consumers.`,
			);
		}
		for (const consumer of entry.consumers) {
			if (!domainPaths.has(consumer)) {
				issues.push(
					`Context consumer \`${consumer}\` is not declared in the domain tree.`,
				);
			}
		}
		if (!CONTEXT_PATTERNS.has(entry.pattern)) {
			issues.push(
				`Context relationship \`${entry.provider}\` uses unsupported pattern \`${entry.pattern}\`.`,
			);
		}
		if (!entry.contract) {
			issues.push(
				`Context relationship \`${entry.provider}\` has no canonical contract path.`,
			);
		}
	}
	return issues;
}
