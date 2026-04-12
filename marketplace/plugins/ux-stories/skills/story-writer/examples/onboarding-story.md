# Example: First Launch Onboarding Story

## Directory structure

```
spec/wallet/onboarding/stories/first-launch/
├── story.md
├── wireframes/
│   ├── welcome.svg
│   ├── swipe-2.svg
│   ├── swipe-3.svg
│   ├── get-started.svg
│   └── vault-first-credential.svg
└── scenarios.feature
```

## story.md

```markdown
---
domain: wallet/onboarding
story: first-launch
personas: [first-time-user]
status: ready
priority: must
wireframes:
  - wireframes/welcome.svg
  - wireframes/swipe-2.svg
  - wireframes/swipe-3.svg
  - wireframes/get-started.svg
  - wireframes/vault-first-credential.svg
created: 2026-04-12
---

# First Launch

## Story

As a **first-time user**,
I want to **understand what Cachet does and be guided through getting my first credential**,
so that **I can demand proof from others on my terms**.

## Context

The user has just installed the app from the Play Store. They may have heard
of Cachet but don't know how it works. They have no credentials and no
familiarity with trust verification.

The onboarding must do three things:
1. Communicate the value proposition ("demand proof, don't take their word for it")
2. Make the first action obvious (identity verification)
3. Deliver a reward quickly (first cachet in the vault)

## Acceptance Criteria

- [ ] AC-1: User sees 4 onboarding screens explaining the value proposition before any action is required
- [ ] AC-2: Each onboarding screen has a brand shield illustration and a single clear message
- [ ] AC-3: User can swipe between onboarding screens and see progress (step indicator)
- [ ] AC-4: Final onboarding screen has a clear "Get Started" call to action
- [ ] AC-5: After completing onboarding, user lands in the vault with guidance on getting their first cachet

## Screen States

| State | Wireframe | Description |
|-------|-----------|-------------|
| Welcome | `wireframes/welcome.svg` | "Don't take their word for it" — demand trust |
| Screen 2 | `wireframes/swipe-2.svg` | Second value prop screen |
| Screen 3 | `wireframes/swipe-3.svg` | Third value prop screen |
| Get Started | `wireframes/get-started.svg` | CTA: "Get Started" |
| First Credential | `wireframes/vault-first-credential.svg` | Empty vault with prompt |

## Out of Scope

- Identity verification flow (separate story: `identity-verification`)
- Returning user experience (separate story: `returning-launch`)
- Skipping onboarding (not supported — every first-time user sees it)

## Notes

- Brand guideline: use "demand proof from others" framing, not "prove yourself"
- Pronounce "cachet" (ka-SHAY) — consider pronunciation hint on first mention
```

## scenarios.feature

```gherkin
@story:first-launch @domain:wallet/onboarding @priority:must
Feature: First Launch Onboarding
  As a first-time user
  I want to understand what Cachet does and be guided to my first credential
  So that I can demand proof from others on my terms

  Background:
    Given I am a first-time user
    And the app is freshly installed

  # Wireframe: wireframes/welcome.svg
  @happy-path
  Scenario: User sees the welcome screen
    When I launch the app
    Then I see "Don't take their word for it"
    And I see a brand shield illustration
    And I see a step indicator showing 1 of 4

  # Wireframe: wireframes/welcome.svg → wireframes/swipe-2.svg
  Scenario: User can swipe between onboarding screens
    Given I am on the welcome screen
    When I swipe left
    Then I see the second onboarding screen
    And the step indicator shows 2 of 4
    When I swipe left
    Then the step indicator shows 3 of 4

  # Wireframe: wireframes/get-started.svg
  Scenario: Final screen has Get Started call to action
    Given I am on the fourth onboarding screen
    Then I see a "Get Started" button
    And the step indicator shows 4 of 4

  # Wireframe: wireframes/vault-first-credential.svg
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

1. **Story anchors the work** — persona, goal, and outcome are clear
2. **Wireframes are referenced in every scenario** — visual contract is explicit
3. **Scenarios are user-centric** — "I see", "I swipe", "I tap" (not "the composable renders")
4. **Coverage maps to ACs** — each AC has at least one scenario
5. **Edge case is included** — backward swipe at boundary
6. **Out of scope is explicit** — prevents scope creep into identity verification
