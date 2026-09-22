---
name: spec-verifier
description: "Audit domain, system, iteration, and standalone development specs against their corpus-specific quality rules. Use when validating a spec, checking requirements, reviewing acceptance criteria, or when the user asks whether a spec is complete or ready."
---

# Spec Verification

## Purpose

Verify a specification against the rules of its corpus. Catching gaps here prevents both incorrect implementation and pollution of durable domain knowledge.

## Classify before verifying

When `domains.yaml` exists:

- `domain` frontmatter → **domain specification**.
- `system` frontmatter → **system specification**.
- Neither → **iteration specification**.

Without a manifest, use conventional development-spec verification.

### Domain specification checks

- Belongs to the narrowest capable domain and matches its fully qualified name.
- States durable, present-tense responsibilities, boundaries, language, behavior, invariants, or semantic contracts.
- Defines concepts once and links to canonical owners with relative Markdown links.
- Contains no project scope, implementation sequencing, delivery criteria, rollout, migration, progress, deadlines, legacy comparisons, temporary workarounds, or verification plans.
- Uses only allowed normative frontmatter.

### System specification checks

- The requirement cannot be assigned to one domain by subsidiarity.
- `system` matches `project.name`; status is valid.
- Requirements use RFC 2119 language.
- Domain-owned terms and contracts are linked rather than redefined.
- Contains no project-management, legacy, transitional, or temporary delivery concerns.

## Iteration and standalone verification dimensions

### 1. Completeness

Does the spec have all required sections?

| Section | Required? | Purpose |
|---------|-----------|---------|
| Problem | Yes | Why this work exists |
| Decisions | If any were made | Architectural choices with rationale |
| Acceptance Criteria | Yes | What "done" looks like |
| Invariants | Yes | What must not break |
| Scope | Yes | What can be touched |
| Verification Plan | Yes | How to prove each criterion |
| References | If external docs exist | Links to relevant specs/docs |

### 2. Criteria Quality

Every acceptance criterion must pass these checks:

- **Observable:** Describes an externally visible behavior, not an internal state
- **Testable:** Can be verified with a concrete test or check
- **Independent:** Testable in isolation from other criteria
- **Unambiguous:** One reasonable interpretation, not multiple

Red flags:

- "Should be fast/clean/good" → Vague, not testable
- "Handle errors gracefully" → Which errors? What's "graceful"?
- Criteria that prescribe implementation ("use Redis", "add a class") → Should be behavioral

### 3. Scope Clarity

- Are modified files/modules explicitly listed?
- Are exclusions stated?
- Could the implementor accidentally break something not covered by invariants?
- Is the scope narrow enough for a single implementation pass?

### 4. Decision Completeness

- Are all non-obvious architectural choices documented?
- Does each decision include rationale (not just the choice)?
- Are there implicit decisions that should be explicit?
- Do any decisions contradict each other?

### 5. Verification Coverage

- Does every acceptance criterion have a verification method?
- Are verification methods concrete (not "check that it works")?
- Is the verification achievable with the stated scope?

→ Full checklist with specific questions: `references/verification-checklist.md`

## Output Format

State the detected mode first, then report only dimensions appropriate to that mode:

```
## Spec Verification Report

### Mode: [DOMAIN | SYSTEM | ITERATION | STANDALONE]
### Verdict: [READY | NEEDS WORK | INCOMPLETE]

### Completeness: [section gaps]
### Criteria Quality: [issues per criterion]
### Scope Clarity: [scope issues]
### Decision Coverage: [missing decisions]
### Verification Coverage: [unmapped criteria]

### Strengths: [what's well done]
### Required Changes: [must fix before implementation]
### Suggestions: [optional improvements]
```

Trigger verification automatically after collecting a spec, or when a user shares a spec for review.
