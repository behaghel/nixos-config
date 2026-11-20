---
name: session-reflection
description: Reflect on a coding session's efficiency, code quality, and architecture, then offer to draft GitHub issues for selected actionable findings. Use at the user's request, especially after long project sessions.
---

# Session reflection

Reflect on **this coding-agent session in the current project**, not on unrelated sessions or production conversations. The invoking command selects efficiency, quality, architecture, or all three. A natural-language request can also select any combination.

## Gather evidence

- Use the available session context, including compaction summaries, as leads. Compaction can omit detail; do not imply you recall an event you cannot substantiate. If evidence is missing, say so. Never expose a raw transcript.
- Inspect relevant files, diffs, tests, specifications, and Git history as needed to validate observations. Do not crawl the whole repository just to fill a category. Distinguish what this session actually showed from a broader hypothesis that needs investigation.
- Follow project instructions and domain boundaries when investigating or proposing changes. A reflection is not permission to change code, specs, or GitHub state.

## Analyze selected dimensions

- **Efficiency:** What repeated friction, discovery, or project-specific knowledge would make a future session faster? Prefer a concrete home for reusable learning (project instructions, skill, test, spec, tooling), not a vague reminder to be more careful.
- **Quality:** Identify specific observed code smells or test gaps, their impact, and a bounded improvement. Do not assert a defect without evidence.
- **Architecture:** Step back from the work: which boilerplate is excessive, which abstraction is missing or premature, what is overengineered, and what single constraint *if relaxed* might simplify the design? State the cost and risks of relaxing that constraint; do not suggest weakening safety, privacy, or authority boundaries simply for convenience.

Present a concise set of distinct findings under only the requested headings. For each finding include its evidence (prefer file paths and relevant behavior), expected benefit, and uncertainty or trade-off. Rank by likely value; say "none supported by this session" for a requested dimension with no grounded finding. Avoid repeating work already completed in this session or inventing suggestions to satisfy a quota.

## Promote selected findings

End by offering the user a choice of which numbered findings to turn into GitHub issue drafts. Some findings belong in an instruction, skill, evaluation, test, or spec instead of an issue; say so. Do not create an issue solely because the reflection exists.

For selected issue candidates:
1. Check the authorized repository and search existing open issues for duplicates if GitHub access is available. If unavailable, explicitly say the check could not be performed; do not claim uniqueness.
2. Draft one bounded, independently actionable issue per distinct problem with title, evidence-safe problem statement, expected outcome, and verifiable acceptance criteria. For speculative architectural ideas, propose an investigation with a decision criterion rather than promising a refactor.
3. Show the **exact** proposed title and body and ask for explicit approval to create each issue. Selection for drafting alone is not creation approval. Incorporate revisions and re-present the final draft if it changes materially.
4. Only after approval, create issues in the explicitly authorized repository using available GitHub tooling under project rules. Never add `engineer` or other queue labels unless separately requested and authorized. Return issue links or report why creation failed; never claim an issue exists without confirmation.

Never publish raw session content, private context, personal information, secrets, machine-local paths, or unverified allegations. Do not change repository files as a side effect of reflection unless the user separately requests implementation.
