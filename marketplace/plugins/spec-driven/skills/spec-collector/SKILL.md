---
name: Spec Collector
description: "Collect information and write development specs. Use when creating a spec, writing requirements, defining acceptance criteria, planning a feature, starting a new task, or when the user says 'spec this', 'define requirements', 'what should the spec look like', or 'help me think through this feature'."
---

# Spec-Driven Development

## Core Shift

The spec is the source of truth. Code is its artifact. The human checkpoint happens here — at the spec — not at the PR.

A spec is a **verifiable contract**: it captures decisions, defines what "done" looks like, sets boundaries on what the implementor can touch, and maps every criterion to a concrete verification method. If the spec is right, the code review becomes optional.

## When to Collect a Spec

- Before writing any code for a new feature, fix, or refactor
- When an AI agent will implement the work
- When multiple people need to agree on what "done" means
- When the blast radius of a change is unclear

## The Collection Process

Spec collection is a 6-phase conversation that moves from fuzzy intent to verifiable contract. Each phase builds on the previous. The agent reads the codebase between phases to ask informed questions.

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

## Spec Output Format

Every collected spec follows this structure:

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

## What Belongs in a Spec

1. **Problem statement** — why this exists, not what it does
2. **Decisions with rationale** — the choices that aren't self-evident, with WHY
3. **Acceptance criteria** — observable, testable outcomes (Given/When/Then)
4. **Invariants** — what must never break
5. **Scope boundaries** — what the implementor may and may not touch
6. **Verification plan** — how to prove each criterion is met
7. **Reference links** — point to docs, don't restate them

## What Does NOT Belong

1. **Implementation details** — state WHAT, not HOW
2. **Knowledge the implementor can look up** — link, don't explain
3. **Vague criteria** — "should be fast" is not a criterion
4. **Unbounded scope** — if everything is in scope, nothing is safe
5. **Unverifiable claims** — if you can't test it, it's not a criterion

## Litmus Tests

Before including any line:

- **"Does this resolve an ambiguity?"** → If no ambiguity exists, cut it.
- **"Would removing this cause the wrong thing to be built?"** → If no, cut it.
- **"Is this a decision or an implementation detail?"** → If detail, cut it.
- **"Can the implementor find this in the linked reference?"** → If yes, link instead.

Before finalizing:

- **"Does every acceptance criterion have a verification method?"** → If not, add one.
- **"Could an AI agent implement from this spec alone?"** → If not, what's missing?
- **"Is the scope explicit enough to prevent unintended changes?"** → If not, tighten it.
