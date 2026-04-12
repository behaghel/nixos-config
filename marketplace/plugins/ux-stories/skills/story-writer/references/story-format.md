# User Story Format

Every UX change starts from a user story. The `.feature` file IS the story — it captures persona, goal, acceptance criteria (as scenarios), wireframe references (as tags), and context. There is no separate `story.md`.

## Story file structure

Stories live at `spec/{domain}/stories/{story-name}/scenarios.feature`:

```
spec/wallet/onboarding/stories/first-launch/
└── scenarios.feature           ← the story: persona, goal, scenarios, wireframe tags
```

Wireframes live in `design/wireframes/` (single source of truth) and are referenced by `@wireframe:` tags — never copied into story directories.

## Feature file template

```gherkin
@story:first-launch @domain:wallet/onboarding @priority:must @status:draft
Feature: First Launch Onboarding
  As a first-time user
  I want to understand what Cachet does and be guided to my first credential
  So that I can demand proof from others on my terms

  Context:
    The user has just installed the app. They have no credentials and no
    familiarity with the verification concept. The onboarding must
    communicate the value proposition and make the first action obvious.

  Out of scope:
    - Identity verification flow (separate story: identity-verification)
    - Returning user experience (separate story: returning-launch)
    - Skipping onboarding (not supported)

  References:
    - docs/SPEC_REVOKED_CACHET_UX.md (if relevant)

  Background:
    Given I am a first-time user
    And the app is freshly installed

  # AC-1: User sees the value proposition before any action is required
  @wireframe:holder-01-onboarding-1.svg @happy-path
  Scenario: User sees the welcome screen
    When I launch the app
    Then I see "Don't take their word for it"
    And I see a brand shield illustration
    And I see a step indicator showing 1 of 4

  # AC-2: Each onboarding screen has a clear message
  Scenario Outline: Onboarding screen <n> content
    Given I am on onboarding screen <n>
    Then the screen conveys "<message>"

    Examples:
      | n | message                                |
      | 1 | demand proof from others on your terms |
      | 2 | prove yourself without over-sharing    |
      | 3 | your trust, your rules                 |
      | 4 | get started                            |

  # AC-5: After onboarding, user lands in the vault
  @wireframe:holder-05-empty-vault.svg
  Scenario: After onboarding user sees the vault
    Given I have completed the onboarding screens
    When I tap "Get Started"
    Then I see My Cachets
    And I see guidance for getting my first cachet

  @edge-case
  Scenario: User cannot swipe backward past the first screen
    Given I am on the welcome screen
    When I swipe right
    Then I still see the welcome screen
```

## What goes WHERE

| Information | Where it lives | NOT here |
|-------------|---------------|----------|
| Persona + goal | Feature header (`As a... I want... So that...`) | ~~story.md~~ |
| Context / situation | Freeform text under Feature header | ~~story.md~~ |
| Out of scope | Freeform text under Feature header | ~~story.md~~ |
| Acceptance criteria | Scenarios (with `# AC-N:` comments) | ~~story.md~~ |
| Wireframe references | `@wireframe:` tags on scenarios | ~~story.md wireframes list~~ |
| Story metadata | Feature-level tags (`@story:`, `@domain:`, `@priority:`, `@status:`) | ~~story.md YAML frontmatter~~ |
| Demo scenario mapping | `@scenario:` tags on scenarios | ~~story.md~~ |
| External references | Freeform text under Feature header | ~~story.md~~ |
| Visual spec | `design/wireframes/*.svg` (referenced by tag) | ~~copied into story dir~~ |

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
```

## Story sizing

| Size | Wireframes | BDD Scenarios | Example |
|------|-----------|---------------|---------|
| Small | 1-2 states | 1-3 scenarios | Add a status chip to an existing screen |
| Medium | 3-5 states | 3-7 scenarios | New screen with navigation |
| Large | 5+ states | 7+ scenarios | Multi-screen flow (onboarding, verification) |

If a story has more than 10 wireframe references, it's too large — split it.

## Story lifecycle

Tracked via the `@status:` tag on the Feature:

```
@status:draft → @status:ready → @status:in-progress → @status:done
```

- **draft** — Feature file written, wireframes in progress or missing
- **ready** — Feature file + wireframes complete, approved for delivery
- **in-progress** — Being delivered via BDD+TDD
- **done** — All scenarios pass, visual verification matches, user approved
