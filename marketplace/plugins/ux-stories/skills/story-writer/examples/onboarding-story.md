# Example: First Launch Onboarding Story

## Directory structure

```
spec/wallet/onboarding/stories/first-launch/
└── scenarios.feature           ← the single story artifact
```

Wireframes live in `design/wireframes/` (referenced by `@wireframe:` tags, NOT copied here).

## scenarios.feature

```gherkin
@story:first-launch @domain:wallet/onboarding @priority:must @status:ready
Feature: First Launch Onboarding
  As a first-time user
  I want to understand what Cachet does and be guided to my first credential
  So that I can demand proof from others on my terms

  Context:
    The user has just installed the app from the Play Store. They may have
    heard of Cachet but don't know how it works. They have no credentials
    and no familiarity with trust verification.

    The onboarding must do three things:
    1. Communicate the value proposition ("demand proof, don't take their word for it")
    2. Make the first action obvious (identity verification)
    3. Deliver a reward quickly (first cachet in the vault)

  Out of scope:
    - Identity verification flow (separate story: identity-verification)
    - Returning user experience (separate story: returning-launch)
    - Skipping onboarding (not supported — every first-time user sees it)

  Notes:
    - Brand guideline: use "demand proof from others" framing, not "prove yourself"
    - Pronounce "cachet" (ka-SHAY) — consider pronunciation hint on first mention

  Background:
    Given I am a first-time user
    And the app is freshly installed

  # AC-1: User sees 4 onboarding screens explaining the value proposition
  @wireframe:holder-01-onboarding-1.svg @happy-path
  Scenario: User sees the welcome screen
    When I launch the app
    Then I see "Don't take their word for it"
    And I see a brand shield illustration
    And I see a step indicator showing 1 of 4

  # AC-3: User can swipe between screens and see progress
  @wireframe:holder-01-onboarding-1.svg @wireframe:holder-02-onboarding-2.svg
  Scenario: User can swipe between onboarding screens
    Given I am on the welcome screen
    When I swipe left
    Then I see the second onboarding screen
    And the step indicator shows 2 of 4
    When I swipe left
    Then the step indicator shows 3 of 4

  # AC-2: Each screen has a brand shield illustration and a single clear message
  Scenario Outline: Onboarding screen <n> content
    Given I am on onboarding screen <n>
    Then the screen conveys "<message>"

    Examples:
      | n | message                                |
      | 1 | demand proof from others on your terms |
      | 2 | prove yourself without over-sharing    |
      | 3 | your trust, your rules                 |
      | 4 | get started                            |

  # AC-4: Final onboarding screen has a clear "Get Started" CTA
  @wireframe:holder-04-onboarding-4.svg
  Scenario: Final screen has Get Started call to action
    Given I am on the fourth onboarding screen
    Then I see a "Get Started" button
    And the step indicator shows 4 of 4

  # AC-5: After completing onboarding, user lands in the vault
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
    And the step indicator still shows 1 of 4
```

## Why this example works

1. **One file, one artifact** — no separate story.md to drift from scenarios
2. **Feature header IS the story** — persona, goal, context, out of scope, notes all in freeform text
3. **Wireframes referenced by tag** — `@wireframe:holder-01-onboarding-1.svg` points to `design/wireframes/`, not copied
4. **No Visual Match boilerplate** — wireframe validation is via tags, not duplicate scenarios
5. **Scenario Outline for variants** — screens 1-4 content tested with one outline, not four scenarios
6. **Scenarios are user-centric** — "I see", "I swipe", "I tap" (not "the composable renders")
7. **Coverage maps to ACs** — each AC has at least one scenario (with `# AC-N:` comments)
8. **Edge case is included** — backward swipe at boundary
9. **Out of scope is explicit** — prevents scope creep into identity verification
10. **DRY** — no duplicate scenarios, no redundant information
