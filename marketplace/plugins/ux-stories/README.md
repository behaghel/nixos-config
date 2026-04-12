# ux-stories

User-story-driven UX development — write stories, spec with SVG wireframes, validate with BDD scenarios, deliver with BDD+TDD orchestration.

## Philosophy

Every pixel on screen traces back to a user story. Every user story is specced with wireframes. Every wireframe is validated by BDD scenarios. Every scenario is delivered through BDD+TDD.

```
User Story (why does this matter?)
  → SVG Wireframe (what does the user see?)
    → BDD Scenario (what happens when they interact?)
      → TDD Iteration (how do we build it?)
```

Wireframes are contracts, not sketches. BDD validates the user's experience. TDD builds the code. The story is the thread that connects them all.

## Relationship to other plugins

This plugin orchestrates the full UX delivery cycle, integrating with the plugin stack:

| Plugin | Role | How ux-stories interacts |
|--------|------|------------------------|
| `domain-tree` | Where things live | Stories live in `spec/{domain}/stories/`. Domain classification drives rigor. |
| `spec-driven` | How to write specs | Story + wireframes are input to spec collection. For UX, wireframes ARE the spec. |
| `spec-tdd` | How to build code | ux-stories owns BDD+TDD orchestration for UX work, replacing spec-tdd's generic iterations. |
| `ux-stories` | The full UX flow | Story → wireframes → BDD scenarios → BDD+TDD delivery → visual verification |

**ux-stories owns the orchestration for UX work.** For non-UX work (backend, infrastructure), spec-tdd's generic TDD remains the right tool.

## What's included

| Component | Type | Description |
|-----------|------|-------------|
| Story Writer | Skill | Auto-triggers for UX work — ensures stories, wireframes, and scenarios exist |
| `/ux-stories:write` | Command | Write a user story with persona, goal, wireframe refs |
| `/ux-stories:scenarios` | Command | Generate Gherkin BDD scenarios from story + wireframes |
| `/ux-stories:deliver` | Command | Full BDD+TDD delivery cycle with visual verification |
| `story-guardian` | Agent | Proactive guard — no UX code without a story, no drift from wireframes |

## The delivery cycle

### 1. Write (`/ux-stories:write`)

Define the user story: persona, goal, acceptance criteria. Each AC maps to wireframe states.

### 2. Wireframe

Create SVG wireframes for each screen state. Hand-coded, precise, versioned. These are the visual contract.

### 3. Scenarios (`/ux-stories:scenarios`)

Generate Gherkin scenarios from the story + wireframes. Each scenario references a wireframe and validates an acceptance criterion.

### 4. Deliver (`/ux-stories:deliver`)

For each BDD scenario, in order of complexity:

1. **BDD Red** — Write step definitions. Run scenario. It fails.
2. **TDD inner loop** — Red/green/refactor to build the code.
3. **BDD Green** — Scenario passes. User experience works.
4. **Visual verification** — Screenshot matches wireframe SVG.
5. **Feedback** — Demo to user. Collect input.

### 5. Complete

All scenarios pass. All wireframes match. User approves. Story marked `done`.

## Artifact structure

```
spec/{domain}/stories/{story-name}/
└── scenarios.feature           ← the single story artifact (persona, goal, ACs, scenarios, wireframe tags)

design/wireframes/
├── welcome.svg                 ← wireframes live here (single source of truth)
├── populated.svg               ← referenced by @wireframe: tags in .feature files
└── error.svg                   ← never copied into story directories
```

The `.feature` file IS the story. There is no separate `story.md`. Wireframes live in `design/wireframes/` and are referenced by `@wireframe:` tags — never copied into story directories.

## Wireframes as contracts

SVG wireframes are not mockups or sketches. They specify:
- Element positions (x, y, width, height)
- Component types (shield, chip, button, card)
- Text content and typography
- Colors and visual states
- Interactive elements and navigation

Implementation must match element-by-element. If there's a mismatch, fix the implementation — not the wireframe. If the wireframe is genuinely wrong, update it intentionally with user agreement first.

## BDD + TDD nesting

BDD and TDD are complementary layers:

| Layer | Tests | Catches |
|-------|-------|---------|
| **BDD** (outer) | User sees X, user taps Y, user gets Z | Integration gaps, visual mismatches, flow continuity, vocabulary drift |
| **TDD** (inner) | Unit behavior, edge cases, internal invariants | Logic errors, boundary values, concurrency, data consistency |

Both must pass. Neither is sufficient alone. BDD is the "done" signal for the user. TDD is the "done" signal for the code.
