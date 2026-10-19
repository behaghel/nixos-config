---
name: tdd-planner
description: |
  Plan and execute iterative vertical-slice TDD from specs. Use when the user wants to plan implementation of a spec, break work into iterations, create a test plan, start TDD on a feature, or implement a spec with red-green-refactor discipline. Also use when spec-driven collection is complete and the next step is implementation planning.
---

# Iterative Vertical-Slice TDD

Plan implementation from specs, then execute strict red-green-refactor iterations with human feedback at every checkpoint.

Load `references/templates.md` when drafting iteration plans or reviewing test value.

Keep slice plans, acceptance procedures, results and progress in the conversation, issue/PR discussion, or a user-agreed temporary non-normative delivery record—not in specifications or product documentation. Link durable requirements rather than copying delivery details into their pages.

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
   - **Acceptance test** — setup, user actions and observable success, agreed before coding and performed afterward for formal user acceptance; automated checks support but do not replace it
   - **Tests to write first** — concrete test names/descriptions
   - **Expected red signal** — what failure looks like before implementation
   - **Minimal green target** — the least code needed to pass
   - **Feedback checkpoint** — what to show the user and what to ask

#### The vertical-slice rule

Every iteration MUST deliver one small, **experientially meaningful, end-to-end** improvement for the customer or user (including an operator or developer). A callable endpoint is not enough if it only exposes internal plumbing. Reliability and recovery fixes qualify through the user path they improve; no new UI or feature is required. This means:
- For service work: request shape → handler → service logic → observable API response
- For mobile work: UI trigger → networking → data flow → screen update (emulator-verified)
- For full-stack: frontend action → API call → backend processing → visible result

**Reject** iterations that deliver only an internal layer or technical checkpoint without an exercisable user benefit. Keep necessary technical substeps within the slice. If its scope grows materially or its acceptance checkpoint recedes, stop to agree a smaller slice or revised scope; do not silently accumulate repairs or weaken safety guarantees.

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
   - Surface succinct plan status with a checklist: done/current/left.
   - Recommend the next iteration, either confirming the plan or proposing a learned refinement/detour.
   - Perform the agreed acceptance test with the user and record the observed result and their acceptance decision. Report unavailable setup or unperformed acceptance as pending, not success.
   - Green tests establish implementation progress, not formal acceptance. Wait for user acceptance before starting the next iteration.
   - If feedback changes the plan, update the iteration table.

5. **Spec sync** — If implementation discoveries reveal spec gaps:
   - Resolve requirement or material scope changes with the user before implementing them.
   - Update the owning specification only for agreed durable behavior; keep slice changes and acceptance records in the delivery discussion. Use the existing ADR convention for material design decisions.

### End-of-slice checkpoint format

At the end of an implementation checkpoint, distinguish **implemented; awaiting acceptance** from **accepted**. Mark an iteration complete only after the agreed test has been performed and the user has accepted it. The final response MUST include:

1. **Plan status** — a compact checklist showing what is done, where we are, and what remains:
   - `[x] Iteration 1 — [done slice goal]`
   - `[x] Iteration N — [current slice goal completed]`
   - `[ ] Iteration N+1 — [next planned slice goal]`
   - `[ ] Iteration ... — [remaining slice goals]`
2. **Where we are** — three concise bullets:
   - **Done:** the capability now green and refactored.
   - **Current position:** the acceptance criteria or user path now covered.
   - **Left:** the next unresolved risks/behaviors.
3. **Recommended next iteration**:
   - Confirm the original plan if it still looks right, naming the next iteration.
   - Or recommend a refinement/detour/reordering learned from the current slice, with a one-sentence rationale.
4. **Agreed acceptance test and result**:
   - What to run or click.
   - What data/setup is needed.
   - What observable result confirms acceptance.
   - What was actually exercised, any simulation or coverage limits, and whether formal user acceptance is accepted, rejected or pending.
5. **Acceptance request** — ask for formal acceptance and whether to proceed with the recommended next iteration; do not infer acceptance from a passing suite.

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
- Do NOT move to the next iteration until the current one is green, its agreed acceptance test has been performed, and the user has accepted it.

## Completion checklist

- [ ] Every planned iteration executed red → green → refactor.
- [ ] Every iteration delivered a user-interactive end-to-end increment.
- [ ] Owning specs reflect agreed durable behavior, without slice plans or acceptance records.
- [ ] Agreed acceptance test performed and formal user acceptance recorded for each iteration.
- [ ] High-value tests remain; brittle low-signal tests pruned or refactored.
- [ ] Full relevant test suite passes.
