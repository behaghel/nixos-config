---
name: spec-collector
description: "Collect domain-first specifications, irreducible system requirements, or temporary iteration specs without mixing their concerns. Use when creating a spec, defining requirements or acceptance criteria, planning a feature, or asking what a spec should contain."
---

# Spec-Driven Development

## Core Shift

The spec is the source of truth. Code is its artifact. The human checkpoint happens here — at the spec — not at the PR.

When `domains.yaml` exists, default to the owning **domain specification**. Use an iteration spec only for temporary delivery concerns, or a system spec for durable RFC 2119 requirements that subsidiarity cannot assign to one domain.

| Mode | Purpose | Normative | Lifetime |
|------|---------|-----------|----------|
| Domain | Durable behavior, language, boundaries, invariants, contracts | Yes | Long-lived |
| Iteration | Problem, delivery decisions, acceptance criteria, scope, verification | No | Temporary |
| System | Irreducible project-wide RFC 2119 requirements | Yes | Long-lived |
| Standalone development | Conventional implementation contract when no domain manifest exists | Project-defined | Task lifetime |

Never put iteration concerns into domain or system corpora.

## When to Collect a Spec

- Before writing any code for a new feature, fix, or refactor
- When an AI agent will implement the work
- When multiple people need to agree on what "done" means
- When the blast radius of a change is unclear

## Choose the mode

1. Look for `domains.yaml` from the current directory upward.
2. With a manifest, choose the narrowest owning domain by default.
3. Use system mode only after proving no domain can own the durable requirement.
4. Use iteration mode for temporary implementation scope and acceptance/verification planning.
5. If the user explicitly requests a mode, honor `domain`, `iteration`, or `system`; otherwise retain the domain default.

## Iteration and standalone collection

Iteration and standalone collection use a 6-phase conversation that moves from fuzzy intent to verifiable contract. Each phase builds on the previous. The agent reads the codebase between phases to ask informed questions.

| Phase | What | Who drives |
|-------|------|------------|
| 1. Problem | Why does this need to exist? | Human |
| 2. Context | What code, patterns, and systems are relevant? | Agent (reads codebase) |
| 3. Decisions | What architectural choices need to be made? | Collaborative |
| 4. Criteria | What does "done" look like? | Human (agent assists) |
| 5. Boundaries | What can be touched? What must not break? | Collaborative |
| 6. Verification | How do we prove each criterion is met? | Agent proposes, human approves |

→ Full framework with phase details and question banks: `references/collection-framework.md`
→ Patterns for writing testable acceptance criteria: `references/criteria-patterns.md`

## Iteration and standalone output format

Temporary iteration and conventional standalone development specs follow this structure:

```
# Spec: [Name]

## Problem
[Why this needs to exist. What's broken or missing. One paragraph.]

## Context
[Relevant existing code, patterns, services. Discovered during collection.]

## Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|
| [What was decided] | [The choice] | [Why this over alternatives] |

## Acceptance Criteria
- [ ] AC-1: Given [context], when [action], then [observable outcome]
- [ ] AC-2: ...

## Invariants
[Things that must not break. Existing tests, API contracts, schemas.]

## Scope
**May modify:** [explicit file/module list]
**Must not modify:** [explicit exclusions]

## Verification Plan
| Criterion | Method | Automated? |
|-----------|--------|------------|
| AC-1 | [Concrete test or check] | Yes/No |

## References
[Links to specs, docs, related code]
```

## Domain specification output

Update the owning domain's `README.md` or a cohesive sibling page with `domain` and `status` frontmatter. Include only durable, present-tense responsibilities, boundaries, ubiquitous language, behavior, invariants, and semantic contracts. Define each concept once at its canonical owner and use relative Markdown links elsewhere.

Do not include problem history, task scope, implementation decisions, delivery acceptance criteria, sequencing, rollout, migration, progress, deadlines, legacy comparisons, temporary workarounds, or verification plans.

## System specification output

Write under a path declared by `system-specs`, with `system` and `status` frontmatter. Express durable requirements using `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, or `MAY`. Link to domain-owned language and contracts; system specs cannot define terms or aliases. Apply the same timelessness exclusions as domain specs.

## What belongs in an iteration or standalone development spec

1. **Problem statement** — why this exists, not what it does
2. **Decisions with rationale** — the choices that aren't self-evident, with WHY
3. **Acceptance criteria** — observable, testable outcomes (Given/When/Then)
4. **Invariants** — what must never break
5. **Scope boundaries** — what the implementor may and may not touch
6. **Verification plan** — how to prove each criterion is met
7. **Reference links** — point to docs, don't restate them

Iteration specs remain conversational unless the user explicitly chooses a non-normative project location. Never place them in a domain spec directory or declared system-spec path. Delete them when no longer operationally useful.

## What Does NOT Belong in an iteration spec

1. **Implementation details** — state WHAT, not HOW
2. **Knowledge the implementor can look up** — link, don't explain
3. **Vague criteria** — "should be fast" is not a criterion
4. **Unbounded scope** — if everything is in scope, nothing is safe
5. **Unverifiable claims** — if you can't test it, it's not a criterion

## Litmus Tests

Before including any line:

- **"Is this durable domain truth, an irreducible system requirement, or temporary iteration context?"** → Put it in exactly one corpus.
- **"Can a narrower domain own this?"** → Prefer subsidiarity over a system spec.
- **"Does this resolve an ambiguity?"** → If no ambiguity exists, cut it.
- **"Would removing this cause the wrong thing to be built?"** → If no, cut it.
- **"Is this a decision or an implementation detail?"** → If detail, cut it.
- **"Can the implementor find this in the linked reference?"** → If yes, link instead.

Before finalizing:

- **"Does every acceptance criterion have a verification method?"** → If not, add one.
- **"Could an AI agent implement from this spec alone?"** → If not, what's missing?
- **"Is the scope explicit enough to prevent unintended changes?"** → If not, tighten it.
