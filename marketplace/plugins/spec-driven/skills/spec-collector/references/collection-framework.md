# Collection Framework

The 6-phase framework for collecting spec information. Each phase produces specific outputs that feed into the final spec.

## Phase 1: Problem Space

**Goal:** Understand why this work needs to exist.

**Questions to ask:**

- What problem are we solving?
- Who is affected? (users, other teams, systems)
- What happens if we don't solve this?
- What are the hard constraints? (deadline, backward compatibility, regulatory, performance)
- Is there an existing issue, ticket, or discussion that captures context?

**Output:** Problem section of the spec.

**Red flags:**

- "I want to refactor X" → Ask what problem the refactoring solves
- "We need feature Y" → Ask what user need Y addresses
- Solution-first framing → Redirect to problem-first

## Phase 2: Context Discovery

**Goal:** Map the relevant codebase, patterns, and systems.

**The agent reads the codebase to surface:**

- Files and modules that will likely need changes
- Existing patterns and conventions in the affected area
- Related tests that act as implicit specifications
- APIs, services, or systems this change interacts with
- Recent changes to the same area (potential conflicts)

**Questions to confirm with the human:**

- "I see the codebase uses [pattern X] for similar functionality. Should we follow this?"
- "There are existing tests in [path]. Should these continue to pass as-is?"
- "This area interacts with [service/API]. Any known constraints?"

**Output:** Context section of the spec. Seeds for the Scope and Invariants sections.

**Key principle:** The agent does the legwork of reading code. The human validates the agent's understanding.

## Phase 3: Decision Points

**Goal:** Surface and resolve architectural decisions.

For each decision point, present:

1. What needs to be decided
2. The options with trade-offs
3. What the codebase conventions suggest
4. Ask for a ruling

**Common decision categories:**

- Data model: How to structure/store data
- API design: Endpoint shape, versioning, auth
- State management: Where state lives, how it flows
- Error handling: Failure modes, retry strategy, degraded behavior
- Integration: How to connect with existing systems
- Migration: How to get from current state to desired state

**Output:** Decisions table in the spec.

**Distinguish decisions from assumptions:**

- Decision: "Use JWT because we need stateless auth across services" → Document it
- Assumption: "The database can handle the load" → Challenge it or make it an invariant

## Phase 4: Acceptance Criteria

**Goal:** Define what "done" looks like in observable, testable terms.

This is where humans add the most value. The agent assists by suggesting criteria based on context, but the human authors and owns them.

**Rules for good criteria:**

- Each criterion describes ONE observable behavior
- Use Given/When/Then format for behavioral criteria
- Use measurable thresholds for quality criteria (not "fast" but "p99 < 200ms")
- Cover the happy path AND meaningful edge cases
- Cover error/failure behavior explicitly

→ See `criteria-patterns.md` for concrete patterns and examples.

**The agent should prompt for:**

- "What should happen when [common edge case]?"
- "What's the expected behavior if [dependency] is unavailable?"
- "Are there rate limits, size limits, or timeout requirements?"
- "What error messages should the user see?"

**Output:** Acceptance Criteria section of the spec.

## Phase 5: Boundaries & Invariants

**Goal:** Define what the implementor can touch and what must not break.

### Scope

Explicit file/module boundaries. The narrower, the safer.

- **May modify:** List specific files, directories, or modules
- **Must not modify:** List explicit exclusions (database schemas, public APIs, CI config)
- **New files:** Describe what new files are expected and where they belong

If the scope is broad, break it into phases with tighter scopes per phase.

### Invariants

Non-negotiable rules that hold regardless of implementation approach:

- **Existing tests:** All tests in [paths] continue to pass
- **API contracts:** No changes to public response shapes
- **Performance:** No regression beyond [threshold]
- **Security:** No new surface area (hardcoded secrets, exposed endpoints)
- **Dependencies:** No new runtime dependencies without approval

### Organization-wide invariants

Define these once in your project/org config, not per-spec:

- No hardcoded credentials, API keys, or tokens
- No changes to CI/CD pipeline without explicit approval
- Lock files must be committed when dependencies change

**Output:** Scope and Invariants sections of the spec.

## Phase 6: Verification Plan

**Goal:** Map every acceptance criterion to a concrete verification method.

For each criterion, define:

1. **Method:** Unit test, integration test, type check, linter rule, contract test, or manual check
2. **Automated?** Whether it can run without human intervention
3. **Location:** Where the test/check will live

**Verification types:**

| Type | When to use |
|------|-------------|
| Unit test | Isolated behavior of a single function/module |
| Integration test | Behavior across system boundaries |
| Type check | Structural correctness (TypeScript strict, mypy) |
| Contract test | API response shapes, schema validation |
| Linter rule | Convention enforcement |
| Manual check | Visual/UX verification (minimize these) |

**Key principle:** Verification criteria come from the spec, not from the implementation. If the agent writes both the code and the tests, the tests must trace back to human-authored acceptance criteria.

**Output:** Verification Plan table in the spec.

## After Collection

Once all 6 phases are complete:

1. Assemble the full spec in the output format
2. Read through for internal consistency (criteria match decisions, scope matches context)
3. Trigger spec verification (the `spec-verifier` skill)
4. Present to the human for final approval

The spec is ready when the human can answer: "If an AI agent implements exactly this spec, will I be confident in the result without reading the code?"
