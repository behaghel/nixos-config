---
description: Add BDD scenarios to an existing .feature story, or review/improve scenarios for coverage and DRYness
argument-hint: [story-path]
allowed-tools: [Read, Glob, Grep, Bash, Write, Edit]
---

# Generate BDD Scenarios

Reads a `.feature` story file and its referenced wireframes, then adds or improves Gherkin scenarios that validate the story's acceptance criteria.

## Key principle: no duplication

Every scenario must test a unique behavior. If the same flow applies with different data, use `Scenario Outline` — never write N copies that differ only in parameters. Never write "visual match" boilerplate scenarios — wireframe validation is handled by `@wireframe:` tags and the test runner, not by separate scenarios.

## Instructions

### Step 1: Load the story

1. Read the `scenarios.feature` from the provided path (or search `spec/**/stories/*/scenarios.feature`).
2. Extract from the Feature header: persona, goal, context, out of scope.
3. Extract from existing scenarios: which ACs are already covered.
4. Collect all `@wireframe:` tags to identify referenced wireframes.
5. If wireframes don't exist at the referenced paths: "These wireframes are referenced but don't exist yet: [list]. Create them before finalizing scenarios."

### Step 2: Read the wireframes

1. For each wireframe referenced via `@wireframe:` tags, read the SVG from `design/wireframes/`.
2. Extract from comments and structure:
   - Screen name and state
   - Key UI elements (text, buttons, indicators)
   - Visual states (colors, enabled/disabled)
3. Build a mental model of what the user sees at each step.

### Step 3: Generate or improve scenarios

For each acceptance criterion not yet covered:

1. Write a Gherkin scenario that validates it from the user's perspective.
2. Add `@wireframe:` tags linking to the wireframes this scenario validates.
3. Follow `references/gherkin-conventions.md`:
   - Persona as `Given`
   - User actions as `When`
   - Observable screen state as `Then`
4. Cover:
   - **Happy path** for the criterion
   - **Error/edge cases** if the wireframe shows them
   - **Transitions** between screen states

### Step 4: Use Scenario Outlines for variants

**This is mandatory.** If you see (or are about to write) multiple scenarios that differ only in data values, collapse them into a single `Scenario Outline`:

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

Common candidates for outlines:
- Different credential types with different visual treatments
- Different demo scenarios (happy, revoked, expired, seller-only)
- Navigation from different entry points to the same screen
- Onboarding screens 1-N with different content

### Step 5: Map scenarios to demo scenarios

If the project has demo scenarios (e.g., DemoScenario system):

1. For each BDD scenario, identify which demo scenario provides the right test data.
2. Tag with `@scenario:{demo-scenario-name}`:

```gherkin
@scenario:revoked @wireframe:cachet-01-detail-revoked.svg
Scenario: Revoked credential shows revocation banner
  ...
```

### Step 6: Review and save

1. Present all scenarios.
2. Run a DRY check:
   - Are any two scenarios testing the same behavior with different data? → Collapse to Outline.
   - Are any steps duplicated across files? → Extract to shared Background or shared step.
   - Are there any "Visual match" boilerplate scenarios? → Delete them; wireframe validation is via `@wireframe:` tags.
3. Check coverage:
   - Every AC has at least one scenario
   - Every wireframe is referenced by at least one `@wireframe:` tag
   - Happy path, error, and edge cases are covered
4. Save the updated `scenarios.feature`.
5. Tell the user: "Scenarios ready. Run `/ux-stories:deliver` to start BDD+TDD delivery."

## Rules

- Scenarios describe what the USER sees, not what the CODE does
- Every scenario must have at least one `@wireframe:` tag
- Every acceptance criterion must have at least one scenario
- Use `Scenario Outline` for data variants — NEVER duplicate scenarios that differ only in data
- Do NOT write "Visual match" scenarios — wireframe validation is handled by `@wireframe:` tags and the test runner
- Do NOT duplicate scenarios that exist in other stories (e.g., tab switching belongs in one story only)
- Use the project's ubiquitous language (domain terms from domains.yaml)
- Keep scenarios independent — each should be runnable in isolation
- Do NOT include step definitions here — those are written during delivery
