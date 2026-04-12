---
description: Generate BDD scenarios in Gherkin from a user story and its wireframes
argument-hint: [story-path]
allowed-tools: [Read, Glob, Grep, Bash, Write, Edit]
---

# Generate BDD Scenarios

Reads a user story and its wireframes, then generates Gherkin scenarios that validate the story's acceptance criteria.

## Instructions

### Step 1: Load the story

1. Read the `story.md` from the provided path (or search `spec/**/stories/*/story.md`).
2. Extract: persona, goal, acceptance criteria, wireframe references.
3. If wireframes are missing: "This story references wireframes that don't exist yet: [list]. Create them before generating scenarios."

### Step 2: Read the wireframes

1. For each referenced wireframe SVG, read it.
2. Extract from comments and structure:
   - Screen name and state
   - Key UI elements (text, buttons, indicators)
   - Visual states (colors, enabled/disabled)
3. Build a mental model of what the user sees at each step.

### Step 3: Generate scenarios

For each acceptance criterion:

1. Write a Gherkin scenario that validates it from the user's perspective.
2. Reference the wireframe(s) with a comment.
3. Follow `references/gherkin-conventions.md`:
   - Persona as `Given`
   - User actions as `When`
   - Observable screen state as `Then`
4. Cover:
   - **Happy path** for the criterion
   - **Error/edge cases** if the wireframe shows them
   - **Transitions** between screen states

### Step 4: Add scenario outlines for variants

If the wireframes show data-driven variants (different cachet types, different statuses):

```gherkin
Scenario Outline: Cachet shows correct visual treatment by status
  Given I have a credential with <status> status
  When I open the credential detail
  Then I see a <color> status chip reading "<label>"

  Examples:
    | status  | color | label    |
    | active  | green | Verified |
    | revoked | red   | Revoked  |
    | expired | amber | Expired  |
```

### Step 5: Map scenarios to demo scenarios

If the project has demo scenarios (e.g., Cachet's DemoScenario system):

1. For each BDD scenario, identify which demo scenario provides the right test data.
2. Tag with `@scenario:{demo-scenario-name}`:

```gherkin
@scenario:revoked
Scenario: Revoked credential shows disabled share button
  ...
```

### Step 6: Review and save

1. Present all generated scenarios.
2. Ask: "Do these scenarios cover your acceptance criteria? Anything missing?"
3. Check coverage:
   - Every AC has at least one scenario
   - Every wireframe is referenced by at least one scenario
   - Happy path, error, and edge cases are covered
4. Save as `spec/{domain}/stories/{story-name}/scenarios.feature`.
5. Tell the user: "Scenarios ready. Run `/ux-stories:deliver` to start BDD+TDD delivery."

## Rules

- Scenarios describe what the USER sees, not what the CODE does
- Every scenario must reference a wireframe
- Every acceptance criterion must have at least one scenario
- Use the project's ubiquitous language (domain terms from domains.yaml)
- Keep scenarios independent — each should be runnable in isolation
- Do NOT include step definitions here — those are written during delivery
