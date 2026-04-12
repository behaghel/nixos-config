# spec-tdd

Iterative vertical-slice TDD — plan implementation from specs, execute red-green-refactor iterations, and maintain test hygiene.

## Relationship to spec-driven

This plugin is **complementary** to [spec-driven](../spec-driven/). They cover different parts of the development lifecycle:

| Phase | Plugin | What it does |
|-------|--------|-------------|
| Upstream | `spec-driven` | Collect, verify, and challenge specs |
| Downstream | `spec-tdd` | Plan iterations, execute TDD, maintain test hygiene |

Install either or both. They work together naturally:

```
/spec-driven:collect-spec → spec-challenger → /spec-tdd:plan → /spec-tdd:iterate (repeat)
```

## What's included

| Component | Type | Description |
|-----------|------|-------------|
| TDD Planner | Skill | Auto-triggers when a spec needs implementation planning |
| `/spec-tdd:plan` | Command | Create an iterative vertical-slice plan from a spec |
| `/spec-tdd:iterate` | Command | Execute one red-green-refactor iteration |
| `tdd-coach` | Agent | Proactive discipline enforcer during implementation |

## The vertical-slice rule

Every iteration must be **user-interactive and end-to-end**:

- For services: request → handler → logic → observable response
- For mobile: UI trigger → network → data → screen update
- For full-stack: frontend action → API → backend → visible result

Backend-only or frontend-only iterations are rejected. If a human can't exercise it, it's not a valid slice.

## Workflow

### 1. Plan (`/spec-tdd:plan`)

Reads a spec and produces an ordered iteration table. Each iteration defines:
- Slice goal — what user-visible behavior it delivers
- Tests to write first — concrete, named tests
- Expected red signal — what failure looks like
- Minimal green target — least code to pass
- Feedback checkpoint — what to show the user

The plan requires explicit approval before implementation begins.

### 2. Iterate (`/spec-tdd:iterate`)

Executes one red-green-refactor cycle:

1. **Red** — Write tests, run them, confirm failure
2. **Green** — Implement the minimum to pass
3. **Refactor** — Clean up while preserving behavior
4. **Feedback** — Demonstrate to the user, collect input
5. **Spec sync** — Update spec if discoveries were made
6. **Test hygiene** — Prune brittle tests, keep valuable ones

### 3. Coach (`tdd-coach` agent)

Watches for violations during implementation:
- Skipped red step (tests not run before code)
- Over-implementation (code ahead of current iteration)
- Skipped feedback checkpoint
- Scope creep (work outside iteration boundaries)

## Guardrails

- No implementation before the iteration plan is approved
- No code before failing tests
- No code beyond what failing tests demand
- No next iteration without user feedback
- No keeping tests that cost more than they catch
