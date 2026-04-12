# Templates

Use these templates to keep TDD planning and execution structured and reviewable.

## Iterative Vertical-Slice Plan

```markdown
# Iteration Plan: [Feature Name]

**Source spec:** [path or link to spec]
**Vertical-slice rule:** each iteration must be user-interactive and end-to-end. Backend-only or frontend-only slices are invalid.

| # | Slice Goal | User Interaction Path | Tests to Write First | Expected Red Signal | Minimal Green Target | Feedback Checkpoint |
|---|-----------|----------------------|---------------------|--------------------|--------------------|-------------------|
| 1 | Simplest e2e happy path | [How a human exercises it] | [Test names/descriptions] | [What failure looks like] | [Minimum code to pass] | [What to show, what to ask] |
| 2 | Key validation/branch | ... | ... | ... | ... | ... |
| 3 | Error handling | ... | ... | ... | ... | ... |
| 4 | Edge cases | ... | ... | ... | ... | ... |
```

## Iteration Execution Log

Use this to track each iteration's progress:

```markdown
## Iteration [N]: [Slice Goal]

### Red
- Tests written: [list]
- Run result: FAIL ✓
- Failure signal: [what failed and why — matches expected?]

### Green
- Code written: [files modified]
- Run result: PASS ✓
- Minimal: [confirm no over-implementation]

### Refactor
- Changes: [what was cleaned up]
- Full suite: PASS ✓

### Feedback
- Demonstrated: [what was shown to user]
- User feedback: [what they said]
- Plan changes: [any iteration plan updates]

### Spec sync
- Spec changes: [none | what was updated and why]
```

## Test Value Review

Use when evaluating whether a test earns its keep:

```markdown
### Test: [test name or path]
- **Linked requirement:** [spec section or AC reference]
- **Failure frequency in real regressions:** high / medium / low
- **Maintenance churn:** high / medium / low
- **Breaks on:** behavior change / implementation detail?
- **Decision:** keep / refactor / prune
- **If pruning/refactoring, replacement coverage:** [what takes its place]
```

## Spec Update Template

When implementation discoveries require spec changes:

```markdown
## Spec Update: [What Changed]

**Discovered during:** Iteration [N]
**Trigger:** [What revealed the gap]
**Change:** [What was added/modified in spec/]
**Impact on plan:** [None | Iterations [X-Y] adjusted]
```
