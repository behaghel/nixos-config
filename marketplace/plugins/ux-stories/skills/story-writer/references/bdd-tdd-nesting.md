# BDD + TDD Nesting Model

BDD and TDD are complementary test layers. BDD validates the user's experience. TDD builds the code. They nest — BDD is the outer shell, TDD is the inner loop.

## The nesting

```
Story (why does this matter?)
  └── BDD Scenario (what does the user experience?)
        └── TDD Iteration (how do we build it?)
              ├── Red: unit/integration test fails
              ├── Green: minimal code to pass
              └── Refactor: clean up
```

## Delivery cycle for one story

### 1. Order BDD scenarios by complexity

Start with the simplest happy-path scenario. Each subsequent scenario adds one dimension:

```
Scenario 1: User sees the welcome screen                  ← simplest possible
Scenario 2: User swipes through onboarding screens        ← adds navigation
Scenario 3: User initiates identity verification           ← adds interaction
Scenario 4: User receives credential after verification    ← adds async flow
Scenario 5: User sees error when verification fails        ← adds error state
```

### 2. For each BDD scenario

#### BDD Red

1. Write the Gherkin scenario (if not already written during story phase).
2. Write step definitions that exercise the UI:
   - For Android: Compose test rules + semantic matchers, or Espresso
   - For web: Playwright or Cypress
   - For API-only: HTTP client assertions
3. Run the scenario. **It must fail.** The feature doesn't exist yet.
4. If it passes: STOP. Either the feature already exists (check) or the test is wrong (fix).

#### TDD inner loop

The BDD scenario tells you WHAT needs to work. TDD tells you HOW to build it.

1. Identify the first piece of code needed to make the BDD scenario pass.
2. Write a unit or integration test for that piece. Run it. Red.
3. Implement the minimum code. Run it. Green.
4. Refactor. All tests still green.
5. Repeat for the next piece until the BDD scenario has enough code behind it.

#### BDD Green

1. Run the BDD scenario again. **It should now pass.**
2. If it fails: the TDD tests pass but the user experience is broken. This is the gap BDD catches — integration between components that unit tests miss.
3. Fix the integration issue (might need another TDD mini-cycle).

#### Visual verification

1. Take a screenshot of the implemented screen.
2. Compare against the wireframe SVG for this scenario.
3. Check the wireframe review checklist (layout, components, text, colors, states).
4. If discrepancies exist: fix before moving to the next scenario.

#### Feedback checkpoint

1. Demo the scenario to the user.
2. Show: "Here's what was built. Here's how to exercise it. Here's the wireframe it matches."
3. Collect feedback. If feedback changes the story, update before continuing.

### 3. Repeat for each scenario

Move to the next BDD scenario only after:
- [x] Current scenario passes
- [x] Visual verification matches wireframe
- [x] User feedback collected
- [x] Spec updated if discoveries were made

## What BDD catches that TDD doesn't

| Gap | Example | Why TDD misses it |
|-----|---------|-------------------|
| Integration between components | Screen renders but navigation doesn't work | Unit tests mock the navigator |
| Visual correctness | Logic works but wrong colors/layout | Unit tests don't see pixels |
| User flow continuity | Each screen works but transition is broken | Unit tests are screen-local |
| Vocabulary consistency | Code says "credential" but spec says "cachet" | Unit tests match code, not spec |
| Empty/error states | Happy path works but empty state is blank | TDD often starts with happy path data |

## What TDD catches that BDD doesn't

| Gap | Example | Why BDD misses it |
|-----|---------|-------------------|
| Edge cases in business logic | Negative amount, null input, overflow | BDD tests user flows, not exhaustive inputs |
| Internal invariants | Data consistency after partial failure | BDD sees the surface, not internal state |
| Performance regressions | O(n²) algorithm in a mapper | BDD checks correctness, not speed |
| Concurrency bugs | Race condition in state management | BDD runs sequentially |

## The two layers are complementary

```
BDD: "Does the user see the right thing and can they do what the story promises?"
TDD: "Does each piece of code work correctly in isolation and together?"
```

Both must pass. Neither is sufficient alone.

## When to write which

| Timing | Write | Purpose |
|--------|-------|---------|
| Story phase | BDD scenarios (Gherkin) | Define "done" from user perspective |
| Delivery phase (before code) | BDD step definitions | Make scenarios executable |
| Delivery phase (inner loop) | TDD tests | Build the code that satisfies the scenario |
| After each scenario passes | Visual verification | Confirm wireframe match |

## Practical guidance

### Keep BDD scenarios high-level

BDD scenarios should read like a user describing what they do. If a scenario mentions a class name, a method, or a database table, it's too low-level — push that detail into TDD.

### Keep TDD tests focused

TDD tests should test one unit of behavior. If a test requires launching the full app, navigating through screens, and checking pixels, it's too high-level — push that up into BDD.

### The handoff point

The BDD step definition is where the two layers meet. It translates user language ("I see a green Verified chip") into test code (`onNodeWithText("Verified").assertExists()`). Keep step definitions thin — they're glue, not logic.
