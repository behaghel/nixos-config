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

1. Find the iteration plan — check `spec/*.plan.md` or ask the user for the path.
2. Identify which iteration to execute:
   - If the user specified a number, use that.
   - If the user said "next", find the first iteration not yet marked complete.
3. Read the iteration's definition: slice goal, tests to write, expected red signal, minimal green target.
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
3. Ask: "Does this behave as expected? Any changes before we move on?"
4. Record the feedback.

### Step 6: Spec sync

1. If implementation revealed spec gaps (behaviors not covered, edge cases discovered):
   - Update the spec file.
   - Tell the user what changed and why.
2. If feedback changes the plan:
   - Update the iteration plan.
   - Note what shifted and why.

### Step 7: Test hygiene

1. Review tests written in this iteration:
   - Are they testing behavior (what) or implementation (how)?
   - Will they break if the implementation changes but behavior stays the same?
2. Check if any existing tests were made redundant by the new ones.
3. If you find low-value tests, flag them to the user with a recommendation (keep/refactor/prune).

### Step 8: Mark complete

1. Log the iteration using the execution log template from `references/templates.md`.
2. Tell the user: "Iteration [N] complete. [M] iterations remaining. Ready for the next one?"

## Rules

- NEVER skip the red step — if tests don't fail first, the iteration is not TDD
- NEVER implement code that no failing test demands
- NEVER refactor while tests are red
- NEVER move to the next iteration without user feedback
- If you discover the spec is wrong, update the spec BEFORE fixing the code
