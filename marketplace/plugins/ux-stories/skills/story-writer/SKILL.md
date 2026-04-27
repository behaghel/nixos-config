---
name: story-writer
description: |
  User-story-driven UX development. Use when the user describes a UX change, a new screen, a user-facing feature, or any work that affects what users see or interact with. Also use when the user says "user story", "wireframe", "screen", "BDD", "scenario", "as a user", or references a persona. Ensures all UX work starts from a user story, is specced with SVG wireframes, validated with BDD scenarios, and delivered through BDD+TDD orchestration.
---

# Story Writer

Ensures all UX work is anchored in user stories, specced visually with SVG wireframes, and validated with BDD scenarios before implementation.

Load `references/story-format.md` when writing or reviewing user stories.
Load `references/wireframe-conventions.md` when creating or evaluating wireframes.
Load `references/gherkin-conventions.md` when writing BDD scenarios.
Load `references/bdd-tdd-nesting.md` when planning or executing delivery.

## When to activate

- User describes a UX change or new screen
- User references a persona, user flow, or interaction
- Code change would affect what users see or interact with
- Before any modification to UI code, screens, or components
- After spec-driven collection when the domain is a UX domain

## Core principles

1. **No UX code without a story.** Every screen change traces back to a user story.
2. **Wireframes are the visual spec.** SVG wireframes are the source of truth for what the user sees. Not mockups, not descriptions — precise, versioned SVGs.
3. **BDD scenarios are the behavioral spec.** Given/When/Then scenarios written from the user's perspective define what "done" means.
4. **BDD wraps TDD.** BDD scenarios are the outer test layer. TDD iterations happen inside to make each scenario pass.

## Workflow

### 1. Write the story as a .feature file

Every UX change starts with a `.feature` file — the single story artifact:

1. Identify the **persona** — who is this for?
2. Define the **goal** — what do they want to achieve?
3. State the **outcome** — what value does this deliver?
4. Write these as the Gherkin `Feature:` header (As a / I want / So that)
5. Add **context** and **out of scope** as freeform text under the header
6. Write **scenarios** — they ARE the acceptance criteria
7. Tag each scenario with `@wireframe:` references to wireframes in `design/wireframes/`
8. Reference the **domain** via `@domain:` tag

Save as `spec/{domain}/stories/{story-name}/scenarios.feature`.

**There is no separate `story.md`.** The `.feature` file captures everything.

### 2. Create SVG wireframes

For each screen state in the story:

1. Identify every distinct visual state (empty, loading, populated, error, success).
2. Create an SVG wireframe for each state.
3. Use the project's wireframe conventions (see `references/wireframe-conventions.md`).
4. Save in `design/wireframes/` (single source of truth — never copy into story directories).
5. Reference from scenarios via `@wireframe:` tags.

Wireframes are NOT sketches. They are precise, coordinate-level specs that implementation must match element-by-element.

### 3. Ensure scenario quality

Before proceeding to delivery, verify:

1. Every acceptance criterion has at least one scenario
2. Every scenario has at least one `@wireframe:` tag
3. Data variants use `Scenario Outline` — never duplicate scenarios that differ only in data
4. No "Visual match" boilerplate scenarios — wireframe validation is via tags
5. No cross-story duplication — shared behaviors belong to one story only

See `references/gherkin-conventions.md` for format, conventions, and DRY principles.

### 4. Deliver with BDD+TDD

Use `/ux-stories:deliver` to orchestrate the full delivery cycle. For each BDD scenario:

1. **BDD Red** — Write the Gherkin step definitions as a test. Run it. It fails.
2. **TDD inner loop** — Red/green/refactor to build the code that satisfies the scenario.
3. **BDD Green** — The scenario passes. The user-facing behavior works.
4. **Visual verification** — Screenshot vs wireframe (found via `@wireframe:` tag). Platform-agnostic.
5. **Feedback checkpoint** — Demo the increment to the user.

See `references/bdd-tdd-nesting.md` for the full nesting model.

### 5. Story completion

A story is done when:
- [ ] All BDD scenarios pass
- [ ] All wireframe states match screenshots (visual verification via `@wireframe:` tags)
- [ ] Scenarios updated if implementation revealed new behaviors
- [ ] User has approved the final increment
- [ ] `@status:done` tag added to the Feature

## Integration with other plugins

| Plugin | How ux-stories interacts |
|--------|------------------------|
| `domain-tree` | Stories live in `spec/{domain}/stories/`. Domain type determines rigor. |
| `spec-driven` | Story + wireframes become input to spec collection. For UX domains, the wireframe IS the spec. |
| `spec-tdd` | BDD scenarios replace spec-tdd's iteration model for UX work. ux-stories owns the orchestration. |

## Guardrails

- Do NOT modify UI code without a user story context.
- Do NOT create wireframes without a story (wireframes answer "what does the user see?" — the story provides "why?").
- Do NOT write BDD scenarios without wireframes (scenarios validate what the wireframe specifies).
- Do NOT skip BDD Red — if the scenario passes before implementation, either the feature exists or the test is wrong.
- Do NOT treat wireframes as aspirational — they are the contract. Implementation must match.
