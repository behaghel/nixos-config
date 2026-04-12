# Gherkin Conventions for UX Stories

BDD scenarios are written in Gherkin and live alongside their user story. They validate the story's acceptance criteria from the user's perspective.

## File location

```
spec/{domain}/stories/{story-name}/scenarios.feature
```

## Structure

```gherkin
Feature: First Launch Onboarding
  As a first-time user
  I want to understand what Cachet does and verify my identity
  So that I receive my first credential and can start building trust

  # Story: spec/wallet/onboarding/stories/first-launch/story.md

  Background:
    Given I am a first-time user
    And the app is freshly installed

  # Wireframe: wireframes/welcome.svg
  Scenario: User sees the value proposition
    When I launch the app
    Then I see the onboarding screen with "Don't take their word for it"
    And I see a brand shield illustration
    And I can swipe to the next screen

  # Wireframe: wireframes/id-scan.svg
  Scenario: User initiates identity verification
    Given I have completed the onboarding screens
    When I tap "Get Started"
    Then I see the identity verification camera view
    And instructions for scanning my ID

  # Wireframe: wireframes/id-success.svg
  Scenario: User receives first credential after verification
    Given I have completed identity verification successfully
    When the verification result arrives
    Then I see a success screen with my new Identity cachet
    And the cachet shows a green "Verified" status

  # Wireframe: wireframes/vault-empty.svg → wireframes/vault-populated.svg
  Scenario: User lands in vault with first credential
    Given I have received my first credential
    When I dismiss the success screen
    Then I see My Cachets with one credential card
    And the card shows my Identity cachet with emerald accent
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

### Wireframe references

Link each scenario to its wireframe with a comment:

```gherkin
# Wireframe: wireframes/vault-revoked.svg
Scenario: Revoked credential visual treatment
```

For scenarios that transition between screens, reference both:

```gherkin
# Wireframe: wireframes/vault-populated.svg → wireframes/detail-revoked.svg
Scenario: Opening a revoked credential
```

### Scenario outlines for data variants

When the same flow applies with different data:

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

## Tags for organization

```gherkin
@story:first-launch @domain:wallet/onboarding @priority:must
Feature: First Launch Onboarding

@happy-path
Scenario: User completes onboarding flow

@edge-case @scenario:revoked
Scenario: User with revoked credential sees warning
```

Standard tags:
- `@story:{name}` — links to user story
- `@domain:{path}` — links to domain in tree
- `@priority:{must|should|could}` — from story priority
- `@happy-path`, `@error`, `@edge-case` — scenario category
- `@scenario:{demo-scenario}` — links to demo scenario for testing
