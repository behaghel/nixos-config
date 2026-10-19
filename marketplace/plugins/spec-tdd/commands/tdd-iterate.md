---
description: Execute one red-green-refactor TDD iteration from an approved plan
argument-hint: [iteration-number or "next"]
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write]
---

# Execute TDD Iteration

Runs one red-green-refactor cycle from an approved iteration plan.

## Instructions

When this command is invoked:

### Step 1: Load context

0. Use the `tdd-planner` skill as the canonical workflow. This command is a thin execution wrapper; if this file and the skill differ, follow the skill.
1. Find the iteration plan in the conversation, issue/PR discussion or user-agreed temporary delivery location; do not create plans in specifications or product documentation.
2. Identify which iteration to execute:
   - If the user specified a number, use that.
   - If the user said "next", find the first iteration not yet marked complete.
3. Read the iteration's user-visible contribution, agreed acceptance test, tests to write, expected red signal and minimal green target. Agree missing acceptance setup, actions or observable success before coding.
4. Confirm with the user: "Starting iteration [N]: [goal]. Ready?"

### Step 2: Red — write tests first

1. Write the tests defined in the iteration plan.
   - Use the repository's idiomatic test location:
     - Go: `*_test.go` colocated with the package
     - Kotlin/Android: `src/test/` or `src/androidTest/`
     - TypeScript: colocated `*.test.ts` or `__tests__/`
   - If unsure, check existing test files for the convention.
2. Run the tests.
3. **Verify failure.**
   - If tests fail with the expected signal: proceed to green.
   - If tests pass unexpectedly: STOP. Tell the user: "These tests pass already — the behavior exists or the tests are wrong. Let's investigate before writing code."
   - If tests fail with an unexpected error (compilation, import, etc.): fix the test setup, not the production code.

### Step 3: Green — minimal implementation

1. Write the minimum code to make the failing tests pass.
2. Run the iteration's tests.
3. **Verify they pass.**
   - If they pass: proceed to refactor.
   - If they fail: iterate on the implementation (not the tests) until green.
4. Check for over-implementation:
   - Did you add code that no current test exercises? Remove it.
   - Did you handle cases from future iterations? Remove that handling.

### Step 4: Refactor — clean up while green

1. Look for opportunities:
   - Extract duplicated code
   - Improve names and readability
   - Simplify conditionals
   - Remove dead code
2. After each refactoring change, run the full relevant test suite (not just the iteration's tests).
3. If any test breaks during refactoring, undo the last change — refactoring must preserve behavior.

### Step 5: Feedback checkpoint

1. Tell the user what was built and how to exercise it:
   - Provide a concrete command, API call, or UI action.
   - Show the expected output.
2. If this is a mobile iteration, install on emulator and demonstrate.
3. Perform the agreed acceptance test with the user; disclose actual results, simulations and any unperformed checks. Ask for formal acceptance, not just general feedback.
4. Record the user's decision in the delivery discussion. If the test cannot be performed or acceptance has not been given, report **implemented; awaiting acceptance** and do not start the next slice.

### Step 6: Spec sync

1. If implementation revealed spec gaps (behaviors not covered, edge cases discovered):
   - Agree requirement or material scope changes with the user before implementing them.
   - Update the owning spec only for agreed durable behavior, never for slice descriptions, acceptance procedures, results or progress.
2. If feedback changes the plan:
   - Update the iteration plan.
   - Note what shifted and why.

### Step 7: Test hygiene

1. Review tests written in this iteration:
   - Are they testing behavior (what) or implementation (how)?
   - Will they break if the implementation changes but behavior stays the same?
2. Check if any existing tests were made redundant by the new ones.
3. If you find low-value tests, flag them to the user with a recommendation (keep/refactor/prune).

### Step 8: Surface implementation and acceptance status

1. Log the iteration using the execution log template from `references/templates.md`.
2. Mark the slice complete only after its agreed acceptance test has been performed and the user has accepted it. Otherwise keep acceptance pending, even when automated tests pass.
3. Present a succinct plan status summary in the final response. Prefer a compact checklist:
   - `[x] Iteration 1 — [done slice goal]`
   - `[x] Iteration N — [current slice goal completed]`
   - `[ ] Iteration N+1 — [next planned slice goal]`
   - `[ ] Iteration ... — [remaining slice goals]`
4. Explicitly state where we are in the plan:
   - **Done:** what capability is now green and refactored.
   - **Current position:** which acceptance criteria or user path is now covered.
   - **Left:** the next unresolved risks/behaviors from the plan.
5. Recommend the next iteration:
   - If the original plan still looks right, say so and name the next iteration to run.
   - If this iteration revealed a useful refinement, worthwhile detour, or reordered risk, recommend the adjustment and explain why in one sentence.
6. Report the agreed acceptance test and its execution:
   - What to run or click.
   - What data/setup is needed.
   - What observable result confirms acceptance.
   - What actually ran, coverage limits and the user's acceptance decision (or pending status).
7. Ask the user for feedback and permission to proceed: "Does this behave as expected? Shall we continue with [recommended next iteration]?"

## Rules

- NEVER skip the red step — if tests don't fail first, the iteration is not TDD
- NEVER implement code that no failing test demands
- NEVER refactor while tests are red
- NEVER move to the next iteration before the agreed acceptance test is performed and the user accepts the current slice
- If scope grows materially or the acceptance checkpoint recedes, agree a smaller slice or revised scope rather than silently accumulating repairs
- If you discover the spec is wrong, agree the requirement change before updating its durable behavior or implementing the change
