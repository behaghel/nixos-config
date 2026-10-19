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

Every iteration must deliver one small, **user-experienced improvement end-to-end**:

- For services: request → handler → logic → observable response
- For mobile: UI trigger → network → data → screen update
- For full-stack: frontend action → API → backend → visible result

Internal plumbing alone is not a slice. Reliability and recovery improvements qualify through the user path they improve; no new UI is required. Agree an acceptance test (setup, user actions, observable success) before coding; perform it afterward and obtain formal user acceptance before the next slice. Green automated tests are not acceptance.

Keep actual slice plans, acceptance procedures and results in the conversation, issue/PR discussion or an explicitly agreed temporary delivery record—not in specifications or product documentation.

## Workflow

### 1. Plan (`/spec-tdd:plan`)

Reads a spec and produces an ordered iteration table. Each iteration defines:
- Slice goal — what user-visible behavior it delivers
- Tests to write first — concrete, named tests
- Expected red signal — what failure looks like
- Minimal green target — least code to pass
- Acceptance test — the agreed user path and observable definition of success

The plan requires explicit approval before implementation begins.

### 2. Iterate (`/spec-tdd:iterate`)

Executes one red-green-refactor cycle:

1. **Red** — Write tests, run them, confirm failure
2. **Green** — Implement the minimum to pass
3. **Refactor** — Clean up while preserving behavior
4. **Acceptance** — Perform the agreed test, obtain the user's acceptance or report it pending
5. **Spec sync** — Agree requirement changes; update only durable behavior, not delivery records
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
- No next iteration before the agreed acceptance test is performed and the user accepts the current slice
- No keeping tests that cost more than they catch
