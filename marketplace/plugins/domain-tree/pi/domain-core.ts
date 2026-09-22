import { join, relative, resolve } from "path";
import { LineCounter, parseDocument } from "yaml";

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
	_project?: { name?: string; description?: string };
	_systemSpecs?: string[];
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

export type ManifestDiagnostic = {
	path: string;
	message: string;
	line?: number;
	column?: number;
};

export type DomainManifestResult = {
	domains: Domains | null;
	diagnostics: ManifestDiagnostic[];
};

export class DomainManifestError extends Error {
	readonly diagnostics: ManifestDiagnostic[];

	constructor(diagnostics: ManifestDiagnostic[]) {
		super(diagnostics.map((diagnostic) =>
			`${diagnostic.path}: ${diagnostic.message}`,
		).join("\n"));
		this.name = "DomainManifestError";
		this.diagnostics = diagnostics;
	}
}

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

const TOP_LEVEL_FIELDS = new Set([
	"project",
	"domains",
	"context-map",
	"system-specs",
]);
const PROJECT_FIELDS = new Set(["name", "description"]);
const GROUP_FIELDS = new Set(["kind", "description", "domains"]);
const DOMAIN_FIELDS = new Set([
	"description",
	"type",
	"status",
	"owners",
	"language",
	"code",
	"spec",
	"subdomains",
]);
const CONTEXT_FIELDS = new Set([
	"provider",
	"consumers",
	"pattern",
	"contract",
]);
const DOMAIN_TYPES = new Set([
	"core",
	"supporting",
	"generic",
	"shared-kernel",
]);
const DOMAIN_STATUSES = new Set(["active", "deprecated", "planned"]);
const LANGUAGE_FIELDS = new Set(["term", "meaning"]);

function reportUnknownFields(
	value: Record<string, unknown>,
	allowed: Set<string>,
	path: string,
	diagnostics: ManifestDiagnostic[],
) {
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			diagnostics.push({
				path: `${path}.${key}`,
				message: `Unsupported field \`${key}\`.`,
			});
		}
	}
}

function validateString(
	value: unknown,
	path: string,
	diagnostics: ManifestDiagnostic[],
) {
	if (value !== undefined && typeof value !== "string") {
		diagnostics.push({ path, message: "Expected a string." });
	}
}

function validateStringList(
	value: unknown,
	path: string,
	diagnostics: ManifestDiagnostic[],
) {
	if (
		value !== undefined &&
		(!Array.isArray(value) || value.some((item) => typeof item !== "string"))
	) {
		diagnostics.push({ path, message: "Expected a list of strings." });
	}
}

function validateDomainEntries(
	value: unknown,
	path: string,
	diagnostics: ManifestDiagnostic[],
	allowGroups: boolean,
) {
	if (!isRecord(value)) {
		diagnostics.push({ path, message: "Expected a mapping of named domains." });
		return;
	}
	for (const [name, rawEntry] of Object.entries(value)) {
		const entryPath = `${path}.${name}`;
		if (!isRecord(rawEntry)) {
			diagnostics.push({ entryPath, message: "Expected a domain mapping." });
			continue;
		}

		if (rawEntry.kind === "group") {
			if (!allowGroups) {
				diagnostics.push({
					path: `${entryPath}.kind`,
					message: "Groups belong under a group's `domains`, not a domain's `subdomains`.",
				});
			}
			reportUnknownFields(rawEntry, GROUP_FIELDS, entryPath, diagnostics);
			validateString(rawEntry.description, `${entryPath}.description`, diagnostics);
			validateDomainEntries(
				rawEntry.domains,
				`${entryPath}.domains`,
				diagnostics,
				true,
			);
			continue;
		}

		reportUnknownFields(rawEntry, DOMAIN_FIELDS, entryPath, diagnostics);
		validateString(rawEntry.description, `${entryPath}.description`, diagnostics);
		if (rawEntry.type !== undefined && !DOMAIN_TYPES.has(String(rawEntry.type))) {
			diagnostics.push({
				path: `${entryPath}.type`,
				message: "Expected `core`, `supporting`, `generic`, or `shared-kernel`.",
			});
		}
		if (
			rawEntry.status !== undefined &&
			!DOMAIN_STATUSES.has(String(rawEntry.status))
		) {
			diagnostics.push({
				path: `${entryPath}.status`,
				message: "Expected `active`, `deprecated`, or `planned`.",
			});
		}
		validateStringList(rawEntry.owners, `${entryPath}.owners`, diagnostics);
		if (rawEntry.language !== undefined && !Array.isArray(rawEntry.language)) {
			diagnostics.push({
				path: `${entryPath}.language`,
				message: "Expected a list of ubiquitous-language entries.",
			});
		} else if (Array.isArray(rawEntry.language)) {
			for (const [index, languageEntry] of rawEntry.language.entries()) {
				const languagePath = `${entryPath}.language[${index}]`;
				if (!isRecord(languageEntry)) {
					diagnostics.push({
						path: languagePath,
						message: "Expected a `term` and `meaning` mapping.",
					});
					continue;
				}
				reportUnknownFields(
					languageEntry,
					LANGUAGE_FIELDS,
					languagePath,
					diagnostics,
				);
				if (!(typeof languageEntry.term === "string" && languageEntry.term.length > 0)) {
					diagnostics.push({
						path: `${languagePath}.term`,
						message: "Declare a term.",
					});
				}
				if (!(typeof languageEntry.meaning === "string" && languageEntry.meaning.length > 0)) {
					diagnostics.push({
						path: `${languagePath}.meaning`,
						message: "Declare the term's meaning.",
					});
				}
			}
		}
		validateStringList(rawEntry.code, `${entryPath}.code`, diagnostics);
		validateString(rawEntry.spec, `${entryPath}.spec`, diagnostics);
		const hasCode = Array.isArray(rawEntry.code) && rawEntry.code.length > 0;
		const hasSpec = typeof rawEntry.spec === "string" && rawEntry.spec.length > 0;
		if (!hasCode && !hasSpec) {
			diagnostics.push({
				path: entryPath,
				message: "Declare `kind: group`, or provide a domain specification anchor with `code` or `spec`.",
			});
		}
		if (rawEntry.subdomains !== undefined) {
			validateDomainEntries(
				rawEntry.subdomains,
				`${entryPath}.subdomains`,
				diagnostics,
				false,
			);
		}
	}
}

function diagnosticPathParts(path: string): Array<string | number> {
	const normalized = path.startsWith("domains.yaml.")
		? path.slice("domains.yaml.".length)
		: path;
	const parts: Array<string | number> = [];
	for (const match of normalized.matchAll(/([^.\[\]]+)|\[(\d+)\]/g)) {
		parts.push(match[2] === undefined ? match[1] : Number(match[2]));
	}
	return parts;
}

function locateDiagnostics(
	diagnostics: ManifestDiagnostic[],
	document: ReturnType<typeof parseDocument>,
	lineCounter: LineCounter,
): ManifestDiagnostic[] {
	return diagnostics.map((diagnostic) => {
		if (diagnostic.line && diagnostic.column) return diagnostic;
		const parts = diagnosticPathParts(diagnostic.path);
		while (parts.length > 0) {
			const node = document.getIn(parts, true) as { range?: [number, number, number] } | undefined;
			if (node?.range) {
				const position = lineCounter.linePos(node.range[0]);
				return {
					...diagnostic,
					line: position.line,
					column: position.col,
				};
			}
			parts.pop();
		}
		return diagnostic;
	});
}

function validateContextMap(
	value: unknown,
	domainPaths: Set<string>,
	diagnostics: ManifestDiagnostic[],
) {
	if (value === undefined) return;
	if (!Array.isArray(value)) {
		diagnostics.push({ path: "context-map", message: "Expected a list." });
		return;
	}
	for (const [index, rawEntry] of value.entries()) {
		const entryPath = `context-map[${index}]`;
		if (!isRecord(rawEntry)) {
			diagnostics.push({ path: entryPath, message: "Expected a relationship mapping." });
			continue;
		}
		reportUnknownFields(rawEntry, CONTEXT_FIELDS, entryPath, diagnostics);
		validateString(rawEntry.provider, `${entryPath}.provider`, diagnostics);
		validateStringList(rawEntry.consumers, `${entryPath}.consumers`, diagnostics);
		validateString(rawEntry.pattern, `${entryPath}.pattern`, diagnostics);
		validateString(rawEntry.contract, `${entryPath}.contract`, diagnostics);

		if (!(typeof rawEntry.provider === "string" && rawEntry.provider.length > 0)) {
			diagnostics.push({
				path: `${entryPath}.provider`,
				message: "Declare a provider domain.",
			});
		} else if (!domainPaths.has(rawEntry.provider)) {
			diagnostics.push({
				path: `${entryPath}.provider`,
				message: `Context provider \`${rawEntry.provider}\` is not declared as a domain.`,
			});
		}
		if (!Array.isArray(rawEntry.consumers) || rawEntry.consumers.length === 0) {
			diagnostics.push({
				path: `${entryPath}.consumers`,
				message: "Declare at least one consumer.",
			});
		}
		if (Array.isArray(rawEntry.consumers)) {
			for (const [consumerIndex, consumer] of rawEntry.consumers.entries()) {
				if (typeof consumer === "string" && !domainPaths.has(consumer)) {
					diagnostics.push({
						path: `${entryPath}.consumers[${consumerIndex}]`,
						message: `Context consumer \`${consumer}\` is not declared as a domain.`,
					});
				}
			}
		}
		if (!(typeof rawEntry.pattern === "string" && rawEntry.pattern.length > 0)) {
			diagnostics.push({
				path: `${entryPath}.pattern`,
				message: "Declare an integration pattern.",
			});
		} else if (!CONTEXT_PATTERNS.has(rawEntry.pattern)) {
			diagnostics.push({
				path: `${entryPath}.pattern`,
				message: `Context relationship uses unsupported pattern \`${rawEntry.pattern}\`.`,
			});
		}
		if (!(typeof rawEntry.contract === "string" && rawEntry.contract.length > 0)) {
			diagnostics.push({
				path: `${entryPath}.contract`,
				message: "Declare a canonical contract path.",
			});
		}
	}
}

export function parseDomainManifest(content: string): DomainManifestResult {
	const lineCounter = new LineCounter();
	const document = parseDocument(content, { lineCounter, prettyErrors: false });
	if (document.errors.length > 0) {
		return {
			domains: null,
			diagnostics: document.errors.map((error) => {
				const position = lineCounter.linePos(error.pos[0]);
				return {
					path: "domains.yaml",
					message: error.message,
					line: position.line,
					column: position.col,
				};
			}),
		};
	}

	const manifest = document.toJS();
	const diagnostics: ManifestDiagnostic[] = [];
	if (!isRecord(manifest)) {
		return {
			domains: null,
			diagnostics: [{ path: "domains.yaml", message: "Expected a YAML mapping." }],
		};
	}

	reportUnknownFields(manifest, TOP_LEVEL_FIELDS, "domains.yaml", diagnostics);
	if (manifest.project !== undefined) {
		if (!isRecord(manifest.project)) {
			diagnostics.push({ path: "project", message: "Expected a mapping." });
		} else {
			reportUnknownFields(manifest.project, PROJECT_FIELDS, "project", diagnostics);
			validateString(manifest.project.name, "project.name", diagnostics);
			validateString(
				manifest.project.description,
				"project.description",
				diagnostics,
			);
		}
	}
	validateDomainEntries(manifest.domains, "domains", diagnostics, true);
	validateStringList(manifest["system-specs"], "system-specs", diagnostics);
	if (Array.isArray(manifest["system-specs"])) {
		for (const [index, systemSpecPath] of manifest["system-specs"].entries()) {
			if (
				typeof systemSpecPath === "string" &&
				(systemSpecPath.startsWith("/") ||
					systemSpecPath.startsWith("\\") ||
					/^[A-Za-z]:[\\/]/.test(systemSpecPath) ||
					systemSpecPath.split(/[\\/]/).includes(".."))
			) {
				diagnostics.push({
					path: `system-specs[${index}]`,
					message: "System-spec paths must stay within the project root.",
				});
			}
		}
	}
	if (
		Array.isArray(manifest["system-specs"]) &&
		manifest["system-specs"].length > 0 &&
		!(isRecord(manifest.project) && typeof manifest.project.name === "string" && manifest.project.name.length > 0)
	) {
		diagnostics.push({
			path: "project.name",
			message: "A project name is required when `system-specs` are declared.",
		});
	}

	const domains = parseDomainEntries(manifest.domains) as Domains;
	if (isRecord(manifest.project)) {
		domains._project = {
			name: typeof manifest.project.name === "string" ? manifest.project.name : undefined,
			description: typeof manifest.project.description === "string"
				? manifest.project.description
				: undefined,
		};
	}
	if (Array.isArray(manifest["system-specs"])) {
		domains._systemSpecs = stringArray(manifest["system-specs"]) || [];
	}
	const domainPaths = new Set(
		flattenDomains(domains).map((node) => node.path.join("/")),
	);
	validateContextMap(manifest["context-map"], domainPaths, diagnostics);

	const rawContextMap = Array.isArray(manifest["context-map"])
		? manifest["context-map"]
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

	const locatedDiagnostics = locateDiagnostics(
		diagnostics,
		document,
		lineCounter,
	);
	return {
		domains: locatedDiagnostics.length === 0 ? domains : null,
		diagnostics: locatedDiagnostics,
	};
}

export function parseDomainsYaml(content: string): Domains {
	const result = parseDomainManifest(content);
	if (!result.domains) throw new DomainManifestError(result.diagnostics);
	return result.domains;
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
const SYSTEM_FRONTMATTER_KEYS = new Set(["system", "status"]);
const FORBIDDEN_NORMATIVE_SECTIONS = new Set([
	"roadmap",
	"rollout",
	"progress",
	"migration plan",
	"implementation plan",
	"delivery status",
	"verification plan",
	"milestones",
	"deadlines",
	"assignees",
]);

function parseFrontmatter(content: string): {
	metadata: Map<string, string>;
	body: string;
} | null {
	const match = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
	if (!match) return null;
	const metadata = new Map<string, string>();
	for (const line of match[1].split("\n")) {
		const field = line.match(/^([a-z][a-z-]*):\s*(.*)$/);
		if (field) metadata.set(field[1], field[2].trim());
	}
	return { metadata, body: content.slice(match[0].length) };
}

function validateTimelessNormativeBody(body: string): string[] {
	const issues: string[] = [];
	for (const line of body.split("\n")) {
		const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/)?.[1]?.trim();
		if (heading && FORBIDDEN_NORMATIVE_SECTIONS.has(heading.toLowerCase())) {
			issues.push(
				`Normative specifications must not contain a \`${heading}\` section.`,
			);
		}
	}
	return issues;
}

function validateNormativeStatus(
	metadata: Map<string, string>,
	label: string,
): string[] {
	const status = metadata.get("status");
	if (!status) return [`${label} frontmatter must declare \`status\`.`];
	if (!["draft", "approved", "stale"].includes(status)) {
		return [
			`${label} frontmatter \`status\` must be \`draft\`, \`approved\`, or \`stale\`.`,
		];
	}
	return [];
}

export function validateNormativeSpecContent(
	content: string,
	expectedDomain: string,
	isReadme: boolean,
): string[] {
	const parsed = parseFrontmatter(content);
	if (!parsed) {
		return isReadme
			? ["README.md must declare normative frontmatter with `domain` and `status`."]
			: [];
	}

	const { metadata, body } = parsed;
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
	issues.push(...validateNormativeStatus(metadata, "Normative"));
	if (metadata.has("aliases") && !metadata.has("term")) {
		issues.push("Normative frontmatter `aliases` requires a canonical `term`.");
	}
	issues.push(...validateTimelessNormativeBody(body));
	return issues;
}

export function validateSystemSpecContent(
	content: string,
	expectedSystem: string,
): string[] {
	const parsed = parseFrontmatter(content);
	if (!parsed) {
		return ["System specifications must declare `system` and `status` frontmatter."];
	}
	const { metadata, body } = parsed;
	const issues: string[] = [];
	for (const key of metadata.keys()) {
		if (!SYSTEM_FRONTMATTER_KEYS.has(key)) {
			issues.push(`Unsupported system-spec frontmatter key \`${key}\`.`);
		}
	}
	if (metadata.get("system") !== expectedSystem) {
		issues.push(`System frontmatter must identify \`${expectedSystem}\`.`);
	}
	issues.push(...validateNormativeStatus(metadata, "System"));
	if (!/\b(?:MUST(?: NOT)?|SHOULD(?: NOT)?|MAY)\b/.test(body)) {
		issues.push(
			"System specifications must contain at least one RFC 2119 requirement keyword.",
		);
	}
	issues.push(...validateTimelessNormativeBody(body));
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
