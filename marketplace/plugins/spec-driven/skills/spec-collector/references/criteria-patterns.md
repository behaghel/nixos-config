# Acceptance Criteria Patterns

Patterns for writing acceptance criteria that are observable, testable, and unambiguous.

## The Given/When/Then Pattern

The primary pattern for behavioral criteria:

```
Given [a precondition or context],
when [an action or event occurs],
then [an observable outcome].
```

Each part is independently verifiable. "Given" sets up the test fixture. "When" is the action under test. "Then" is the assertion.

## Pattern Catalog

### 1. Happy Path

The expected behavior when everything works correctly.

```
Given a user with valid credentials,
when they submit the login form,
then they receive a session token and are redirected to the dashboard.
```

### 2. Input Validation

What happens with invalid, missing, or edge-case input.

```
Given a registration form,
when the email field contains "not-an-email",
then the form displays "Invalid email format" and does not submit.
```

```
Given the search API,
when the query parameter is empty,
then return 400 with error code INVALID_QUERY.
```

### 3. Error & Failure

Behavior when dependencies fail or errors occur.

```
Given the payment service is unavailable,
when a user attempts checkout,
then display "Payment temporarily unavailable, please try again"
and retry up to 3 times with exponential backoff before failing.
```

### 4. State Transition

When behavior depends on current state.

```
Given an order in "pending" status,
when payment is confirmed,
then the order transitions to "confirmed" and a confirmation email is sent.
```

```
Given an order in "shipped" status,
when payment is confirmed,
then no state change occurs (idempotent).
```

### 5. Performance & Scale

Measurable, not subjective.

| Vague (don't write this) | Concrete (write this) |
|--------------------------|----------------------|
| "Should be fast" | "p99 response time < 200ms for 1000 concurrent users" |
| "Should handle load" | "Process 500 events/second with < 1% error rate" |
| "Should be responsive" | "First contentful paint < 1.5s on 3G connection" |

### 6. Security

Concrete security behaviors, not aspirational statements.

```
Given an expired JWT,
when any authenticated endpoint is called,
then return 401 and the token is not refreshed automatically.
```

```
Given a user with "viewer" role,
when they attempt to call DELETE /api/resources/:id,
then return 403 regardless of resource ownership.
```

### 7. Data Integrity

What must be true about data before and after operations.

```
Given a money transfer between accounts,
when the transfer completes (success or failure),
then the sum of all account balances equals the pre-transfer sum.
```

### 8. Backward Compatibility

When existing behavior must be preserved.

```
Given clients using API v1 response format,
when v2 is deployed,
then v1 responses are unchanged (verified by existing v1 contract tests).
```

## Anti-Patterns

### Vague criteria

| Vague | What to do |
|-------|------------|
| "User experience should be good" | Not a criterion — remove or decompose into measurable behaviors |
| "Handle errors gracefully" | Specify WHICH errors and WHAT "graceful" means for each |
| "Should be secure" | Specify exact auth checks, input validation, and access control rules |
| "Code should be clean" | Not an acceptance criterion — handle via linting and conventions |

### Implementation-prescriptive criteria

| Prescriptive (don't write this) | Behavioral (write this) |
|---------------------------------|------------------------|
| "Use Redis for caching" | "Repeated identical requests within 60s return cached results" |
| "Add a try-catch around the API call" | "When the external API returns 5xx, retry 3 times then return a user-friendly error" |
| "Create a UserService class" | Not a criterion — this is implementation, not behavior |

### Compound criteria

Split these — each criterion should be independently testable.

**Bad:** "Given a user, when they log in, then they get a token AND their last-login timestamp updates AND they receive a welcome notification"

**Good:** Three separate criteria, each testable in isolation.

## Calibrating Criteria Count

There's no magic number, but calibrate:

- **Simple bug fix:** 1–3 criteria (the fix + edge cases)
- **New endpoint/feature:** 5–10 criteria (happy path, errors, validation, edge cases)
- **System-level change:** 10–20 criteria (interaction points, migration, backward compat)

If you have 30+ criteria, the scope is probably too large — split into multiple specs.
