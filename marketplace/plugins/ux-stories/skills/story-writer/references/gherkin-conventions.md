# Gherkin Conventions for UX Stories

The `.feature` file is the **single story artifact**. It captures persona, goal, context, acceptance criteria (as scenarios), and wireframe references (as tags). There is no separate `story.md`.

## File location

```
spec/{domain}/stories/{story-name}/scenarios.feature
```

## Structure

```gherkin
@story:first-launch @domain:wallet/onboarding @priority:must
Feature: First Launch Onboarding
  As a first-time user
  I want to understand what Cachet does and be guided to my first credential
  So that I can demand proof from others on my terms

  Context:
    The user just installed the app. No credentials, no familiarity
    with trust verification.

  Out of scope:
    - Identity verification flow (separate story)
    - Returning user experience (separate story)

  Background:
    Given I am a first-time user
    And the app is freshly installed

  # AC-1: User sees 4 onboarding screens explaining the value proposition
  @wireframe:holder-01-onboarding-1.svg
  @happy-path
  Scenario: User sees the welcome screen
    When I launch the app
    Then I see "Don't take their word for it"
    And I see a brand shield illustration
    And I see a step indicator showing 1 of 4

  # AC-3: User can swipe between screens and see progress
  @wireframe:holder-01-onboarding-1.svg @wireframe:holder-02-onboarding-2.svg
  Scenario: User swipes between onboarding screens
    Given I am on the welcome screen
    When I swipe left
    Then I see the second onboarding screen
    And the step indicator shows 2 of 4

  # AC-1: Each screen has distinct content
  Scenario Outline: Onboarding screen <n> content
    Given I am on onboarding screen <n>
    Then the screen conveys "<message>"

    Examples:
      | n | message                                |
      | 1 | demand proof from others on your terms |
      | 2 | prove yourself without over-sharing    |
      | 3 | your trust, your rules                 |
      | 4 | get started                            |

  # AC-5: After onboarding user sees the vault
  @wireframe:holder-05-empty-vault.svg
  Scenario: After onboarding user sees the vault
    Given I have completed the onboarding screens
    When I tap "Get Started"
    Then I see My Cachets
    And I see guidance for getting my first cachet
```

## Writing conventions

### Personas as Given

Always establish the persona in `Background` or the first `Given`:

```gherkin
Background:
  Given I am a returning holder with 3 active credentials
```

### Screen states as Then

Describe what the user SEES, not what the code does:

```gherkin
# Good — user perspective
Then I see a "Revoked" status chip in red on the Identity card

# Bad — implementation detail
Then the TrustStatusChip composable renders with TrustRevoked color
```

### Navigation as When

User actions that change the screen:

```gherkin
When I tap the Identity cachet card
When I swipe left to the Activity tab
When I scan a QR code from the verifier
When I scroll down to see more credentials
```

### Wireframe references via tags

Link each scenario to its wireframe(s) via `@wireframe:` tags. Wireframe paths are relative to `design/wireframes/` — the single source of truth. **Never copy SVG files into story directories.**

```gherkin
@wireframe:cachet-01-detail-revoked.svg
Scenario: Revoked credential shows revocation banner
```

For scenarios that transition between screens, use multiple tags:

```gherkin
@wireframe:holder-04-vault-my-trust.svg @wireframe:cachet-01-detail.svg
Scenario: Opening a credential from the vault
```

**Do NOT write separate "Visual match" scenarios.** The `@wireframe:` tag IS the visual contract. The test runner and visual verification tooling (step 2d of `/ux-stories:deliver`) use these tags to find the reference wireframe for screenshot comparison. This is platform-agnostic — works for Android, iOS, and web.

### Scenario outlines for data variants (MANDATORY)

When the same flow applies with different data, you MUST use `Scenario Outline` — never duplicate scenarios:

```gherkin
Scenario Outline: Cachet card shows correct accent color
  Given I have a <type> credential
  When I open My Cachets
  Then I see a cachet card with <color> accent

  Examples:
    | type      | color   |
    | identity  | emerald |
    | childcare | pink    |
    | age       | coral   |
    | seller    | gold    |
```

## What Gherkin scenarios should cover

For each story, scenarios must cover:

1. **Happy path** — The primary flow described in the story
2. **Empty states** — What the user sees before any data exists
3. **Error states** — What happens when things go wrong (network, invalid data)
4. **Edge cases** — Boundary values, unusual but valid inputs
5. **Transitions** — How the user gets from one screen to another
6. **Visual states** — Each wireframe variant (revoked, expired, hardware-backed)

## What Gherkin scenarios should NOT cover

1. **API contracts** — That's the domain spec's job
2. **Internal state management** — Test observable behavior, not implementation
3. **Performance** — BDD is about correctness, not speed
4. **Platform specifics** — Write scenarios for the user experience, not the framework

## Scenario naming

Use descriptive names that read as user behaviors:

```gherkin
# Good
Scenario: User sees revoked credential with disabled share button
Scenario: Verifier scans QR and receives trust result

# Bad
Scenario: Test revoked state
Scenario: QR flow
```

## Connecting to acceptance criteria

Each scenario should trace to an acceptance criterion in the story:

```gherkin
# AC-1: User sees the value proposition
Scenario: User sees the value proposition
  ...

# AC-2: User can initiate identity verification
Scenario: User initiates identity verification
  ...
```

If a scenario doesn't map to an AC, either the AC is missing or the scenario is unnecessary.

## Tags

Tags serve as the metadata layer — they replace what would otherwise be frontmatter in a separate story.md file.

```gherkin
@story:first-launch @domain:wallet/onboarding @priority:must
Feature: First Launch Onboarding

@happy-path @wireframe:holder-01-onboarding-1.svg
Scenario: User sees the welcome screen

@edge-case @scenario:revoked @wireframe:cachet-01-detail-revoked.svg
Scenario: User with revoked credential sees warning
```

### Standard tags

**Feature-level (required):**
- `@story:{name}` — story identifier
- `@domain:{path}` — domain from spec/domains.yaml
- `@priority:{must|should|could}` — story priority

**Feature-level (lifecycle):**
- `@status:{draft|ready|in-progress|done}` — story status (replaces story.md status field)

**Scenario-level:**
- `@wireframe:{filename.svg}` — links to wireframe in `design/wireframes/` (**required on every scenario**)
- `@happy-path`, `@error`, `@edge-case` — scenario category
- `@scenario:{demo-scenario}` — links to demo scenario for test data

## DRY principles

The BDD suite must never repeat itself. These rules prevent duplication:

1. **One behavior, one scenario.** If two scenarios test the same interaction, keep only one.
2. **Scenario Outline for data variants.** Multiple scenarios differing only in data values → one Outline with Examples table.
3. **No "Visual match" boilerplate.** Wireframe validation is handled by `@wireframe:` tags — never write scenarios like "Then the screen matches wireframe X".
4. **Shared behaviors belong to one story.** Tab switching, navigation chrome, app launch — these belong in one story. Other stories assume them as Background, not re-test them.
5. **Background for shared setup.** If 3+ scenarios share the same Given steps, extract to Background.
6. **Cross-story dedup.** Before writing a scenario, check if another story already covers the same behavior. If so, don't duplicate — reference it.
