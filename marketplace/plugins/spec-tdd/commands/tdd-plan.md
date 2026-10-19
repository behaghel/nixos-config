---
description: Create an iterative vertical-slice TDD plan from a spec
argument-hint: [spec-path-or-feature-name]
allowed-tools: [Read, Glob, Grep, Bash]
---

# Plan TDD Iterations

Creates an iterative vertical-slice plan from an existing spec.

## Instructions

When this command is invoked:

### Step 1: Locate the spec

Use the `tdd-planner` skill as the canonical workflow.

1. If the user provided a path, read that file.
2. If the user provided a feature name, search `spec/` for a matching file.
3. If no spec exists, tell the user: "No spec found. Use `/spec-driven:collect-spec` to create one first, or provide a spec path."

### Step 2: Extract acceptance criteria

1. Read the spec and identify all acceptance criteria (or behavioral requirements).
2. List them for the user: "I found [N] criteria. Here's what we're implementing..."
3. Identify dependencies between criteria — which ones build on others?

### Step 3: Design vertical slices

1. Order criteria into iterations, starting with the **smallest viable end-to-end happy path**.
2. Apply the vertical-slice rule: every iteration MUST deliver one small, experientially meaningful user improvement end-to-end, not just callable plumbing.
   - For services: request → handler → logic → observable response
   - For mobile: UI action → network → data → screen update
   - **Reject** internal-layer-only iterations without a user-experienced benefit; reliability fixes can qualify without adding a UI
3. Group related criteria when they naturally belong together (e.g., a validation and its error message).
4. For each iteration, define:
   - Slice goal (one sentence)
   - User interaction path (how a human exercises it)
   - Acceptance test (setup, user actions, observable success; agree before coding, perform afterward for formal acceptance)
   - Tests to write first (concrete names)
   - Expected red signal (what failure looks like)
   - Minimal green target (least code to pass)
   - Feedback checkpoint (what to show, what to ask)

### Step 4: Present and approve

1. Present the plan using the iteration table format from `references/templates.md`.
2. Explain the ordering rationale: why this sequence?
3. Ask: "Does this plan look right? Should any iterations be reordered, split, or merged?"
4. **Do NOT proceed until the user explicitly approves.**

### Step 5: Save the plan

1. Keep the plan and agreed acceptance tests in the conversation or issue/PR discussion by default.
2. Save a file only in a user-agreed temporary, non-normative delivery location—not alongside specifications or in product documentation.

## Rules

- Every iteration must pass the vertical-slice test — reject pure backend or pure frontend work
- Start with the simplest possible e2e happy path
- Do not plan more than 7 iterations — if you need more, the spec scope is probably too large
- Do not include refactoring-only iterations — refactoring happens within each iteration's green→refactor step
- Keep iteration 1 small but useful to the user, not merely easy to implement
- Approval of the plan is not acceptance of its slices; perform the agreed acceptance test and obtain user acceptance before starting the next slice
