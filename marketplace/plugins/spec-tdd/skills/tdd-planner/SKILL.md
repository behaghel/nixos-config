---
name: TDD Planner
description: |
  Plan and execute iterative vertical-slice TDD from specs. Use when the user wants to plan implementation of a spec, break work into iterations, create a test plan, start TDD on a feature, or implement a spec with red-green-refactor discipline. Also use when spec-driven collection is complete and the next step is implementation planning.
---

# Iterative Vertical-Slice TDD

Plan implementation from specs, then execute strict red-green-refactor iterations with human feedback at every checkpoint.

Load `references/templates.md` when drafting iteration plans or reviewing test value.

## When to activate

- A spec exists (from `spec-driven` plugin or manual) and the user wants to implement it
- The user says "plan the implementation", "break this into slices", "let's TDD this"
- After spec collection/verification, the natural next step is execution planning

## Workflow

### Phase 1: Plan vertical slices from spec

1. Read the spec (from `spec/`, a linked doc, or inline).
2. Identify acceptance criteria — these drive the iterations.
3. Propose an ordered iteration plan:
   - Start with the **smallest viable end-to-end slice** (happy path through the full stack).
   - Each subsequent iteration adds one dimension of complexity.
   - Final iterations cover edge cases, error handling, and hardening.
4. For each iteration, define:
   - **Slice goal** — one sentence describing the user-visible behavior
   - **User interaction path** — how a human exercises this (API call, UI flow, CLI command)
   - **Tests to write first** — concrete test names/descriptions
   - **Expected red signal** — what failure looks like before implementation
   - **Minimal green target** — the least code needed to pass
   - **Feedback checkpoint** — what to show the user and what to ask

#### The vertical-slice rule

Every iteration MUST be **user-interactive and end-to-end**. This means:
- For service work: request shape → handler → service logic → observable API response
- For mobile work: UI trigger → networking → data flow → screen update (emulator-verified)
- For full-stack: frontend action → API call → backend processing → visible result

**Reject** iterations that deliver only backend or only frontend work. If a slice can't be exercised by a human, it's not a valid slice.

5. **Pause for explicit plan approval.** Do NOT proceed to implementation until the user approves.

### Phase 2: Execute one iteration at a time

For each approved iteration:

1. **Red** — Write tests first.
   - Use the repository's idiomatic test location (e.g., `*_test.go` for Go, colocated tests for Kotlin/Swift).
   - Run the tests. Confirm they fail with the expected signal.
   - If tests pass unexpectedly, stop and investigate — the behavior already exists or the test is wrong.

2. **Green** — Implement the minimum code to pass.
   - Only write code that makes the failing tests pass.
   - Do not implement behavior for future iterations.
   - Do not refactor yet.

3. **Refactor** — Clean up only after green.
   - Preserve behavior (all tests still pass).
   - Extract duplication, improve names, simplify conditionals.
   - Run the full relevant test suite, not just the iteration's tests.

4. **Feedback checkpoint** — Present the increment to the user.
   - Show what was built and how to exercise it.
   - Collect feedback before planning the next iteration.
   - If feedback changes the plan, update the iteration table.

5. **Spec sync** — If implementation discoveries reveal spec gaps:
   - Update `spec/` before proceeding.
   - Flag the change to the user: "I found [X] wasn't covered in the spec. I've added it."

### Phase 3: Continuous test hygiene

Throughout execution, evaluate tests for ongoing value:

- **Prune** tests that rarely fail but need frequent edits to track superficial changes.
- **Replace** brittle tests (tied to implementation details) with behavior-focused tests (tied to spec requirements).
- **Challenge** tests that break during focused work without a clear behavioral link.
- **Keep** at least one strong test path per critical requirement or bug class.
- Maintain explicit linkage between spec statements and tests.

## Guardrails

- Do NOT start implementation before the iteration plan is approved.
- Do NOT write broad test suites up front — grow coverage iteration by iteration.
- Do NOT implement beyond what the current iteration's failing tests require.
- Do NOT call an iteration complete unless a human can exercise the behavior end-to-end.
- Do NOT skip the red step — if tests don't fail first, the iteration has no signal.
- Do NOT keep tests that add maintenance cost without decision-making value.
- Do NOT move to the next iteration until the current one is green and feedback is collected.

## Completion checklist

- [ ] Every planned iteration executed red → green → refactor.
- [ ] Every iteration delivered a user-interactive end-to-end increment.
- [ ] `spec/` reflects final agreed behavior (updated if discoveries were made).
- [ ] Human feedback collected after each iteration.
- [ ] High-value tests remain; brittle low-signal tests pruned or refactored.
- [ ] Full relevant test suite passes.
