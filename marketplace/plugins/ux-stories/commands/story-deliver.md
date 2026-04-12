---
description: Deliver a user story through BDD+TDD orchestration — outer BDD scenarios wrapping inner TDD iterations
argument-hint: [story-path or "next"]
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write]
---

# Deliver User Story

Orchestrates the full delivery of a user story: BDD scenarios as the outer test layer, TDD as the inner implementation loop, visual verification against wireframes.

## Instructions

### Step 1: Load context

1. Find the story — check `spec/**/stories/*/story.md` or use the provided path.
2. Read the story, wireframes, and `scenarios.feature`.
3. If scenarios don't exist: "Run `/ux-stories:scenarios` first to generate BDD scenarios."
4. Verify all wireframes referenced in scenarios exist.
5. Order scenarios from simplest to most complex (happy path first, edge cases last).
6. Present the delivery plan: "This story has [N] scenarios. I'll deliver them in this order: [list]."
7. **Pause for approval.** Do NOT proceed until the user confirms.

### Step 2: For each BDD scenario (in order)

#### 2a. BDD Red — Write the executable scenario

1. Write step definitions that exercise the UI:
   - Use the project's test framework (Compose testing, Espresso, Playwright, etc.)
   - Step definitions translate Gherkin to test assertions
   - Keep step definitions thin — they're glue between user language and test code
2. If the project has demo scenarios, configure the test to use the right demo data.
3. Run the BDD scenario.
4. **Verify it fails.**
   - Expected failure: the feature doesn't exist yet. Proceed.
   - Unexpected pass: STOP. The feature already exists or the test is wrong. Investigate.
   - Compilation/setup error: fix the test setup, not the production code.

#### 2b. TDD inner loop — Build the code

The BDD scenario tells you WHAT needs to work. Now use TDD to build it.

1. Identify the first piece of code needed (a composable, a mapper, a navigation route).
2. **TDD Red** — Write a unit/integration test for that piece. Run it. It fails.
3. **TDD Green** — Implement the minimum code to pass.
4. **TDD Refactor** — Clean up while tests stay green.
5. Repeat for the next piece until enough code exists to satisfy the BDD scenario.

During the inner loop:
- Do NOT add code for future scenarios
- Do NOT skip the red step for any TDD test
- Do NOT refactor while any test is red
- Follow the project's test conventions (Go: `*_test.go`, Kotlin: `*Test.kt`, etc.)

#### 2c. BDD Green — Validate the user experience

1. Run the BDD scenario again.
2. **It should now pass.**
3. If it fails: the gap is integration between components. Write a focused test for the integration point, fix it, re-run.

#### 2d. Visual verification

1. Launch the app/screen in the state this scenario tests.
2. Take a screenshot (use `android-ux-review` skill or equivalent tooling).
3. Compare against the wireframe SVG referenced in the scenario.
4. Check the wireframe review checklist:
   - [ ] Layout order matches
   - [ ] Correct components used
   - [ ] Text content matches (including domain vocabulary)
   - [ ] Colors and states match
   - [ ] Interactive elements work
5. If discrepancies: fix before continuing.

#### 2e. Feedback checkpoint

1. Show the user what was built:
   - "Scenario [N] of [total]: [scenario name]"
   - "Here's the screenshot. Here's the wireframe it matches."
   - "To exercise it: [concrete instruction — adb command, tap sequence, etc.]"
2. Collect feedback.
3. If feedback changes the story:
   - Update `story.md` and/or `scenarios.feature`
   - Note the change: "Updated AC-3 based on feedback: [what changed]"

### Step 3: Story completion

After all scenarios pass:

1. Run the full BDD scenario suite for this story.
2. Run the full project test suite (unit + integration + BDD).
3. Final visual review: compare all wireframe states against screenshots.
4. Update the story status to `done` in `story.md`.
5. Report:

```
Story Delivery Complete: [story name]
─────────────────────────────────────
Scenarios: [N] passed
Visual:    [N] wireframes verified
Tests:     [unit count] unit + [integration count] integration + [BDD count] BDD
Status:    done

Delivered behaviors:
- [AC-1]: [summary]
- [AC-2]: [summary]
...
```

## Rules

- NEVER skip BDD Red — if the scenario passes before implementation, investigate
- NEVER implement without a failing BDD scenario above and a failing TDD test below
- NEVER move to the next scenario without visual verification
- NEVER move to the next scenario without user feedback
- NEVER modify wireframes to match implementation — fix implementation to match wireframes
- If wireframes are wrong, update them FIRST (with user agreement), then fix implementation
