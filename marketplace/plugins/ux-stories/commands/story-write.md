---
description: Write a user story with persona, goal, wireframe references, and acceptance criteria
argument-hint: [persona/feature description]
allowed-tools: [Read, Glob, Grep, Bash, Write, Edit]
---

# Write User Story

Guides the user through writing a complete user story with wireframes and acceptance criteria.

## Instructions

### Step 1: Identify the domain

1. Read `spec/domains.yaml` to find the relevant domain.
2. If the domain has a UX subdomain (e.g., wallet/onboarding), use it.
3. If no domain tree exists: "Run `/domain-tree:init` first to establish the domain structure."

### Step 2: Identify the persona

1. Check if `spec/personas.md` exists. If yes, read it.
2. Ask: "Who is this for?" Present existing personas or help define a new one.
3. If a new persona is needed, add it to `spec/personas.md`.

### Step 3: Write the story

Guide the user through:

1. **As a [persona]** — Who is doing this?
2. **I want to [goal]** — What are they trying to achieve?
3. **So that [outcome]** — Why does this matter?
4. **Context** — What's the user's situation? What have they done before?
5. **Acceptance criteria** — What observable behaviors mean "done"?
6. **Out of scope** — What does this story explicitly NOT cover?

### Step 4: Plan wireframes

For each acceptance criterion:

1. Identify the screen states needed to validate it.
2. List the wireframes that need to exist:
   - "AC-1 needs a `welcome.svg` showing the value proposition"
   - "AC-3 needs both `vault-empty.svg` and `vault-populated.svg`"
3. Check if matching wireframes already exist in `design/wireframes/` or `spec/`.
4. If they exist, reference them. If not, note them as TODO.

### Step 5: Save

1. Create the story directory: `spec/{domain}/stories/{story-name}/`
2. Write `story.md` using the template from `references/story-format.md`.
3. Create `wireframes/` directory.
4. If existing wireframes can be reused, symlink or copy them.
5. Tell the user: "Story written. Next: create wireframes for [list], then run `/ux-stories:scenarios` to generate BDD scenarios."

## Rules

- Every story must have at least one persona
- Every story must have measurable acceptance criteria (not "should feel smooth")
- Every acceptance criterion must map to at least one wireframe state
- Stories must reference a domain from the domain tree
- Do NOT write implementation details in the story — it's about WHAT the user experiences, not HOW it's built
