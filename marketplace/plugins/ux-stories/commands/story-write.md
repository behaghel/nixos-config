---
description: Write a user story as a .feature file with persona, goal, wireframe tags, and BDD scenarios
argument-hint: [persona/feature description]
allowed-tools: [Read, Glob, Grep, Bash, Write, Edit]
---

# Write User Story

Guides the user through writing a complete user story as a `.feature` file — the single artifact that captures persona, goal, acceptance criteria, wireframe references, and executable BDD scenarios.

## Key principle: one artifact per story

The `.feature` file IS the story. There is no separate `story.md`. Gherkin's `Feature:` header captures persona and goal. Tags capture metadata. Scenarios capture acceptance criteria. Wireframe tags link to visual specs. This eliminates redundancy and drift between narrative and executable specs.

## Instructions

### Step 1: Identify the domain

1. Read `spec/domains.yaml` to find the relevant domain.
2. If the domain has a UX subdomain (e.g., wallet/onboarding), use it.
3. If no domain tree exists: "Run `/domain-tree:init` first to establish the domain structure."

### Step 2: Identify the persona

1. Check if `spec/personas.md` exists. If yes, read it.
2. Ask: "Who is this for?" Present existing personas or help define a new one.
3. If a new persona is needed, add it to `spec/personas.md`.

### Step 3: Write the Feature header

The Gherkin `Feature:` block captures the story narrative:

```gherkin
@story:first-launch @domain:wallet/onboarding @priority:must
Feature: First Launch Onboarding
  As a first-time user
  I want to understand what Cachet does and be guided to my first credential
  So that I can demand proof from others on my terms

  Context:
    The user just installed the app. No credentials, no familiarity
    with trust verification. Onboarding must communicate the value
    proposition and deliver a reward quickly (first cachet).

  Out of scope:
    - Identity verification flow (separate story)
    - Returning user experience (separate story)
```

Guide the user through:

1. **As a [persona]** — Who is doing this?
2. **I want to [goal]** — What are they trying to achieve?
3. **So that [outcome]** — Why does this matter?
4. **Context** — What's the user's situation? (freeform text under Feature)
5. **Out of scope** — What this story explicitly does NOT cover

### Step 4: Plan wireframes and write scenarios

For each acceptance criterion:

1. Identify the screen states needed to validate it.
2. List the wireframes that need to exist:
   - "AC-1 needs a `welcome.svg` showing the value proposition"
   - "AC-3 needs both `vault-empty.svg` and `vault-populated.svg`"
3. Check if matching wireframes already exist in `design/wireframes/`.
4. Reference wireframes via `@wireframe:` tags on each scenario (see rules below).
5. Write scenarios immediately — they ARE the acceptance criteria.
6. Use `Scenario Outline` when the same flow applies with different data.

**Wireframe referencing:**

Wireframes are referenced by path relative to `design/wireframes/`, NOT copied into story directories. This ensures a single source of truth for visual specs.

```gherkin
@wireframe:holder-01-onboarding-1.svg
Scenario: User sees the welcome screen
  ...
```

For scenarios that transition between screens:
```gherkin
@wireframe:holder-01-onboarding-1.svg @wireframe:holder-02-onboarding-2.svg
Scenario: User swipes to second screen
  ...
```

### Step 5: Save

1. Create the story directory: `spec/{domain}/stories/{story-name}/`
2. Write `scenarios.feature` with the full story (Feature header + scenarios).
3. Tell the user: "Story written. Next: create wireframes for [list], then run `/ux-stories:deliver` to start BDD+TDD delivery."

**Do NOT create a `story.md` file.** The `.feature` file is the single story artifact.

**Do NOT copy wireframes into the story directory.** Reference them via `@wireframe:` tags. Wireframes live in `design/wireframes/` (single source of truth).

## Rules

- Every story must have at least one persona (in the Feature header)
- Every story must have measurable acceptance criteria expressed as scenarios
- Every scenario must have at least one `@wireframe:` tag linking to a visual spec
- Stories must reference a domain from the domain tree (via `@domain:` tag)
- Do NOT write implementation details — scenarios describe WHAT the user experiences, not HOW
- Do NOT create `story.md` — the `.feature` file IS the story
- Do NOT copy wireframe SVGs — reference them by path via tags
- Use `Scenario Outline` with `Examples` table when the same flow has data variants — never duplicate scenarios that differ only in data
