# User Story Format

Every UX change starts from a user story. The story is the "why" — it connects a human need to the work being done.

## Story file structure

Stories live at `spec/{domain}/stories/{story-name}/story.md`:

```
spec/wallet/onboarding/stories/first-launch/
├── story.md                    ← the story itself
├── wireframes/
│   ├── welcome.svg             ← screen: welcome state
│   ├── id-scan.svg             ← screen: scanning ID
│   ├── id-success.svg          ← screen: ID verified
│   └── vault-empty.svg         ← screen: empty vault after onboarding
├── scenarios.feature           ← BDD scenarios
└── spec.md                     ← collected spec (optional, from spec-driven)
```

## Story template

```markdown
---
domain: wallet/onboarding
story: first-launch
personas: [first-time-user]
status: draft | ready | in-progress | done
priority: must | should | could
wireframes:
  - wireframes/welcome.svg
  - wireframes/id-scan.svg
  - wireframes/id-success.svg
  - wireframes/vault-empty.svg
created: 2026-04-12
---

# First Launch

## Story

As a **first-time user**,
I want to **understand what Cachet does and verify my identity**,
so that **I receive my first credential and can start building trust**.

## Context

<!-- What's the situation? What has the user done before reaching this point? -->
The user has just installed the app. They have no credentials and no familiarity
with the verification concept.

## Acceptance Criteria

- [ ] AC-1: User sees the value proposition (onboarding screens) before any action is required
- [ ] AC-2: User can initiate identity verification from the onboarding flow
- [ ] AC-3: After successful verification, user lands in an empty vault with their first credential
- [ ] AC-4: User understands what a "cachet" is by the end of onboarding

## Screen States

| State | Wireframe | Description |
|-------|-----------|-------------|
| Welcome | `wireframes/welcome.svg` | Value prop: "Don't take their word for it" |
| ID Scan | `wireframes/id-scan.svg` | Camera view for ID verification |
| Success | `wireframes/id-success.svg` | Credential received confirmation |
| Empty Vault | `wireframes/vault-empty.svg` | Home screen with first credential |

## Out of Scope

<!-- What this story explicitly does NOT cover -->
- Returning user experience (separate story)
- Error handling for failed ID verification (separate story)
- Multiple credential types (separate story)

## Notes

<!-- Design rationale, open questions, decisions made -->
```

## Persona catalog

Maintain a `spec/personas.md` file at the project root listing all personas:

```markdown
# Personas

## first-time-user
New to Cachet. No credentials. Unfamiliar with trust verification concepts.
Primary goal: understand the value and get their first credential.

## returning-holder
Has credentials. Uses the app regularly to share trust.
Primary goal: quickly verify or share credentials.

## verifier
Business user who needs to verify someone's credentials.
Primary goal: get a trustworthy answer fast.

## revoked-holder
Had credentials but one or more were revoked.
Primary goal: understand what happened and what to do next.
```

## Story sizing

| Size | Wireframes | BDD Scenarios | Example |
|------|-----------|---------------|---------|
| Small | 1-2 states | 1-3 scenarios | Add a status chip to an existing screen |
| Medium | 3-5 states | 3-7 scenarios | New screen with navigation |
| Large | 5+ states | 7+ scenarios | Multi-screen flow (onboarding, verification) |

If a story has more than 10 wireframes, it's too large — split it.

## Story lifecycle

```
draft → ready → in-progress → done
```

- **draft** — Story written, wireframes in progress or missing
- **ready** — Story + wireframes + BDD scenarios complete, approved for delivery
- **in-progress** — Being delivered via BDD+TDD
- **done** — All scenarios pass, visual verification matches, user approved
