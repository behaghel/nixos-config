export type SpecMode = "domain" | "iteration" | "system" | "standalone";

export type SpecModeSelection = {
	mode: SpecMode;
	topic: string;
	error?: string;
};

export function selectSpecMode(
	args: string,
	hasDomainManifest: boolean,
): SpecModeSelection {
	const modeMatch = args.match(/(?:^|\s)--mode(?:=|\s+)(domain|iteration|system)(?=\s|$)/);
	const requestedMode = modeMatch?.[1] as Exclude<SpecMode, "standalone"> | undefined;
	if (/\s*--mode(?:=|\s+)/.test(args) && !requestedMode) {
		return {
			mode: hasDomainManifest ? "domain" : "standalone",
			topic: args.trim(),
			error: "`--mode` must be `domain`, `iteration`, or `system`.",
		};
	}
	const topic = modeMatch
		? `${args.slice(0, modeMatch.index)} ${args.slice((modeMatch.index || 0) + modeMatch[0].length)}`.trim()
		: args.trim();

	if (!hasDomainManifest) {
		if (requestedMode === "domain" || requestedMode === "system") {
			return {
				mode: "standalone",
				topic,
				error: `Spec mode \`${requestedMode}\` requires a valid \`domains.yaml\`.`,
			};
		}
		return { mode: "standalone", topic };
	}

	return { mode: requestedMode || "domain", topic };
}

export function classifySpecContent(
	content: string,
	hasDomainManifest: boolean,
): SpecMode {
	const frontmatter = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1] || "";
	if (hasDomainManifest && /^system:\s*.+$/m.test(frontmatter)) return "system";
	if (hasDomainManifest && /^domain:\s*.+$/m.test(frontmatter)) return "domain";
	return hasDomainManifest ? "iteration" : "standalone";
}

export function buildSpecCollectionPrompt(selection: SpecModeSelection): string {
	const topic = selection.topic ? `\n\nRequested subject: ${selection.topic}` : "";
	if (selection.error) return selection.error;

	if (selection.mode === "domain") {
		return `Collect a domain specification. Domain specifications are the default normative artifact.

Resolve the narrowest owning domain from domains.yaml before writing. Capture only durable, present-tense responsibilities, boundaries, ubiquitous language, behavior, invariants, and semantic contracts. Define each concept once at its canonical owner and use relative Markdown links elsewhere.

Do not include problem history, project scope, implementation decisions, task acceptance criteria, sequencing, rollout, migration, progress, deadlines, legacy comparisons, temporary workarounds, or verification plans. Update the existing normative corpus with domain/status frontmatter rather than creating a parallel definition.${topic}`;
	}

	if (selection.mode === "system") {
		return `Collect a system specification only after confirming that subsidiarity cannot assign the requirement to one domain.

Write durable RFC 2119 requirements using MUST, MUST NOT, SHOULD, SHOULD NOT, or MAY under a path declared by system-specs. Use system/status frontmatter matching project.name. Link to domain-owned terms and contracts; system specs cannot own ubiquitous language.

Do not include project management, rollout, migration, progress, legacy comparisons, temporary workarounds, or iteration verification plans.${topic}`;
	}

	if (selection.mode === "iteration") {
		return `Collect a temporary, non-normative iteration specification through the six phases: Problem, Context, Decisions, Acceptance Criteria, Scope and Invariants, and Verification.

Do not add domain or system frontmatter. Do not write the artifact into a domain spec directory or declared system-spec path. Keep it conversational unless the user explicitly chooses a non-normative project location, and delete it when it is no longer operationally useful.${topic}`;
	}

	return `Collect a development specification through the six phases: Problem, Context, Decisions, Acceptance Criteria, Scope and Invariants, and Verification. Produce a verifiable implementation contract.${topic}`;
}

export function buildSpecVerificationPrompt(
	mode: SpecMode,
	path: string,
): string {
	if (mode === "domain") {
		return `Verify the domain specification at ${path}. Check durable present-tense domain truth, narrow semantic ownership, DRY canonical definitions, relative wiki links, valid domain/status frontmatter, and the absence of project-management, legacy, transitional, or temporary delivery concerns.`;
	}
	if (mode === "system") {
		return `Verify the system specification at ${path}. Confirm the requirement is irreducible to one domain, uses valid system/status frontmatter and RFC 2119 language, links to domain-owned terms, and contains no project-management, legacy, transitional, or temporary delivery concerns.`;
	}
	return `Verify the ${mode === "iteration" ? "iteration" : "development"} specification at ${path} for a clear problem, explicit decisions, testable acceptance criteria, scope and invariants, and complete verification coverage. Confirm it is non-normative when a domain manifest exists.`;
}
