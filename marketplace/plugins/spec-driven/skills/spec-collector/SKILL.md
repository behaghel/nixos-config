---
name: spec-collector
description: "Collect and revalidate requirements separately from design choices and delivery plans. Use when creating a spec, planning work, touching an area with unclear inherited requirements, or when implementation experience or user feedback challenges a spec."
---

# Spec-Driven Development

## Core Shift

The spec records agreed product requirements. Agree what to build before implementation; formally accept the working slice afterward. Specification approval is not product acceptance.

When `domains.yaml` exists, default to the owning **domain specification**. Use an iteration spec only for temporary delivery concerns, or a system spec for durable RFC 2119 requirements that subsidiarity cannot assign to one domain.

| Mode | Purpose | Normative | Lifetime |
|------|---------|-----------|----------|
| Domain | Durable behavior, language, boundaries, invariants, contracts | Yes | Long-lived |
| Iteration | Problem, delivery decisions, acceptance criteria, scope, verification | No | Temporary |
| System | Irreducible project-wide RFC 2119 requirements | Yes | Long-lived |
| Standalone development | Conventional implementation contract when no domain manifest exists | Project-defined | Task lifetime |

Never put iteration concerns into domain or system corpora.

## Simplicity first; evolve through decisions

Start from the smallest credible design that delivers the outcome using existing capabilities. Ask what concrete failure, domain contract, or authority boundary justifies each proposed workflow stage, state, adapter, queue, approval, or restriction. Existing machinery is evidence to investigate, not a requirement to preserve. Do not turn hypothetical risks, implementation convenience, or testability into unstated human requirements. Keep necessary safety and authorization guarantees while challenging the mechanism that currently provides them.

During collection, distinguish the human's requested outcomes and constraints from architectural choices the implementation introduced. Present the simple baseline first; add complexity only when a specific counterexample or measured need shows why the baseline is insufficient and why a simpler alternative cannot satisfy it. Document material *subsequent* decisions that amend or complexify that baseline in an Architecture Decision Record (ADR): context/evidence, the earlier baseline, the change and rejected simpler alternatives, consequences, and the conditions for revisiting or removing it. Link the ADR from the relevant spec instead of embedding decision history in normative domain/system pages. Use an existing project ADR convention; if none exists, agree on a location rather than inventing a framework. Routine edits do not need ADRs.

## From requirements to an acceptable slice

Before handing work to TDD planning, identify the smallest end-to-end contribution the customer or user can experience, and agree its acceptance test: setup, user actions, and observable success. A short scenario or command/output example is sufficient; UX includes CLI, API and operational workflows, not only graphical screens. A technical checkpoint alone is not a slice; a reliability fix qualifies through the user experience it improves. Agree the current slice without requiring detailed acceptance plans for every later increment.

Keep slice descriptions, acceptance procedures, results and progress in the conversation, issue/PR discussion, or an explicitly agreed temporary non-normative delivery record. Do not put them in durable specifications or product documentation. Specs describe the agreed enduring behavior; ADRs explain material design choices, not slice execution history. TDD planning carries the agreed acceptance test forward, and its later execution and the user's acceptance remain distinct from automated test success.

## Requirements, design choices, and delivery plans

| Kind | Question | Example | Home |
|------|----------|---------|------|
| Requirement | What outcome or constraint must hold, and why? | Two workers cannot implement the same issue concurrently. | Owning domain spec; system spec only when no domain can own it |
| Design choice | How does the implementation meet that requirement? | Use an atomic database claim. | Code; an ADR when a significant choice needs explanation |
| Delivery plan | How do we deliver this change? | Replace the reservation workflow in two steps. | Issue or temporary iteration spec |

A real technical contract can be a requirement: a consumer may depend on a protocol, schema, or exact identity guarantee. Do not remove it merely because it is technical. Ask who depends on it and what would break if it changed. Conversely, an existing implementation, passing test, or normative “must” does not establish that the human requested that mechanism.

## Revalidate requirements as you go

When collecting a spec or changing an area, read the relevant requirements and compare them with the current request and what implementation has taught us. Use ordinary engineering language. Distinguish supported requirements from inherited design choices and unresolved assumptions; investigate available code and discussions before asking the user. Missing historical rationale is a question, not evidence that a guarantee is unnecessary.

Backfill only what affects the work at hand. Do not require a repository-wide audit, new tracking document, or fixed interview schedule. Revisit requirements when implementation exposes a contradiction, repeated workarounds, unused behavior, or complexity whose purpose is unclear—not only during the first implementation.

Start a short `grill-me` session when an inherited requirement forces substantial complexity, evidence challenges its need, current user intent conflicts with it, or removing machinery could remove an important guarantee. Read the skill when available; otherwise follow its method: ask one question at a time, explain the consequence, and recommend an answer with reasons. Answer codebase questions through investigation, not by asking the user. Stop interviewing when the material uncertainty is resolved; routine edits need no interview.

For example: “The spec requires an announcement and ten-minute wait. I found no reason beyond the existing workflow. I recommend removing both while preserving duplicate-work protection. Do you need a chance to intervene before work starts?”

Do not treat silence as approval or rewrite uncertain intent as an agreed requirement. State the open assumption and pause work that depends on it; independent work can continue. After agreement, update the owning spec in present-tense plain language, retain the discussion/approval in the issue or existing project discussion, and link significant design decisions to ADRs. A clarified requirement does not automatically need an ADR. Keep tests for the agreed behavior; replace or remove tests that encode only a rejected mechanism. Do not add interview history or “unconfirmed requirement” metadata to the normative corpus.

## When to Collect a Spec

- Before writing any code for a new feature, fix, or refactor
- When an AI agent will implement the work
- When multiple people need to agree on what "done" means
- When the blast radius of a change is unclear
- When current user intent or implementation evidence calls an inherited requirement into question

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
| 3. Decisions | What must depart from the simplest credible design, and why? | Collaborative |
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
| [What was decided] | [The simplest justified choice] | [Why this; evidence for any added complexity] |

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
2. **Decisions with rationale** — the simplest viable choices and evidence for any additional machinery; link later material amendments to ADRs
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
- **"What fails with the simpler design?"** → If no concrete case or authority boundary fails, do not add the machinery.
- **"Was this constraint requested by the human, or inherited from code?"** → Do not promote inherited implementation into normative requirements without agreement.
- **"Would removing this cause the wrong thing to be built?"** → If no, cut it.
- **"Is this a decision or an implementation detail?"** → If detail, cut it.
- **"Can the implementor find this in the linked reference?"** → If yes, link instead.

Before finalizing:

- **"Does every acceptance criterion have a verification method?"** → If not, add one.
- **"Can an implementor distinguish agreed requirements, design choices, and open assumptions?"** → If not, clarify; do not invent more requirements.
- **"Could an AI agent implement from this spec and its linked contracts?"** → If not, what's missing?
- **"Is the scope explicit enough to prevent unintended changes?"** → If not, tighten it.
