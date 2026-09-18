# ux-stories

User-story-driven graphical UX development — write stories, spec screens with SVG wireframes, validate with BDD scenarios, and deliver with BDD+TDD orchestration.

## Scope

This plugin is exclusively for graphical, screen-based interfaces such as web, mobile, and desktop UI.

Do not use it for CLI, API, CI/CD, repository automation, reports, chat/email output, or non-graphical developer tooling. Specify those surfaces with `spec-driven` command/output or request/response examples and deliver them with `spec-tdd` executable tests. Gherkin is optional for non-graphical behavior; SVG wireframes are not appropriate.

## Philosophy

Every pixel on screen traces back to a user story. Every graphical user story is specced with wireframes. Every wireframe is validated by BDD scenarios. Every scenario is delivered through BDD+TDD.

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
| `spec-driven` | How to write specs | Story + wireframes inform graphical UX specs; it directly owns non-graphical interface specs. |
| `spec-tdd` | How to build code | ux-stories owns BDD+TDD for graphical UX; spec-tdd owns non-graphical delivery. |
| `ux-stories` | The graphical UX flow | Story → wireframes → BDD scenarios → BDD+TDD delivery → visual verification |

**ux-stories owns orchestration only for graphical UX work.** A surface being user-facing does not make it graphical UX.

## What's included

| Component | Type | Description |
|-----------|------|-------------|
| Story Writer | Skill | Auto-triggers for graphical UX work — ensures stories, wireframes, and scenarios exist |
| `/ux-stories:write` | Command | Write a user story with persona, goal, wireframe refs |
| `/ux-stories:scenarios` | Command | Generate Gherkin BDD scenarios from story + wireframes |
| `/ux-stories:deliver` | Command | Full BDD+TDD delivery cycle with visual verification |
| `story-guardian` | Agent | Proactive guard — no UX code without a story, no drift from wireframes |

## The delivery cycle

### 1. Write (`/ux-stories:write`)

Define the user story: persona, goal, acceptance criteria. Each AC maps to wireframe states.

### 2. Wireframe

Create SVG wireframes for each screen state. Hand-coded, precise, versioned. These are the visual contract.
Shared UI parts live in `design/wireframes/components.svg` so screen SVGs compose canonical components instead of redrawing them.

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
├── components.svg              ← canonical SVG component library
├── welcome.svg                 ← wireframes live here (single source of truth)
├── populated.svg               ← referenced by @wireframe: tags in .feature files
└── error.svg                   ← never copied into story directories
```

The `.feature` file IS the story. There is no separate `story.md`. Wireframes live in `design/wireframes/` and are referenced by `@wireframe:` tags — never copied into story directories.

`components.svg` follows a lightweight atomic structure: atoms form molecules, molecules form organisms, organisms form templates, and pages instantiate templates with story-specific content and state. Do not over-abstract: promote a shape or group only when it is a named, repeated UI concept.

## Wireframes as contracts

SVG wireframes are not mockups or sketches. They specify:
- Element positions (x, y, width, height)
- Component types (shield, chip, button, card)
- Text content and typography
- Colors and visual states
- Interactive elements and navigation

Implementation must match element-by-element. If there's a mismatch, fix the implementation — not the wireframe. If the wireframe is genuinely wrong, update it intentionally with user agreement first.

Screen-state SVGs should mostly compose components from `components.svg` with `<use href="#...">`. They may set position, representative text, and state annotations, but repeated controls, cards, headers, navigation, and page layouts belong in the component library.

## BDD + TDD nesting

BDD and TDD are complementary layers:

| Layer | Tests | Catches |
|-------|-------|---------|
| **BDD** (outer) | User sees X, user taps Y, user gets Z | Integration gaps, visual mismatches, flow continuity, vocabulary drift |
| **TDD** (inner) | Unit behavior, edge cases, internal invariants | Logic errors, boundary values, concurrency, data consistency |

Both must pass. Neither is sufficient alone. BDD is the "done" signal for the user. TDD is the "done" signal for the code.
