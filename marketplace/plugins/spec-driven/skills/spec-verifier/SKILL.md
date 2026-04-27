---
name: spec-verifier
description: "Audit development specs for completeness and quality. Use when validating a spec, checking requirements, reviewing acceptance criteria, or when the user says 'is this spec complete', 'validate my spec', 'review the requirements', 'check this spec', or 'is this ready for implementation'."
---

# Spec Verification

## Purpose

Verify that a spec is complete enough for an AI agent to implement correctly without human code review. This is the upstream quality gate — catching gaps here prevents wrong implementations downstream.

## Verification Dimensions

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

When reviewing a spec, work through each dimension and produce a report:

```
## Spec Verification Report

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
