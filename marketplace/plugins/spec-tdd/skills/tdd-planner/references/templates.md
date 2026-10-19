# Templates

Use these lightweight templates in the conversation, issue/PR discussion, or an explicitly agreed temporary delivery record. Do not save slice plans or acceptance records in specifications or product documentation.

## Iterative Vertical-Slice Plan

```markdown
# Iteration Plan: [Feature Name]

**Source spec:** [path or link to spec]
**Vertical-slice rule:** each iteration delivers one small, user-experienced improvement end-to-end; internal plumbing alone is not a slice.

| # | User-visible contribution | Interaction path | Acceptance test (setup → actions → observable success) | Tests / expected red | Minimal green target |
|---|---------------------------|------------------|-------------------------------------------------------|----------------------|----------------------|
| 1 | Smallest useful outcome | [How the user exercises it] | [Agree before coding; perform for formal acceptance afterward] | [Test names and failure signal] | [Least implementation needed] |
| 2 | Next useful improvement | ... | ... | ... | ... |

**Current slice:** [N]. **Acceptance status:** [pending / accepted / rejected].
Future rows are provisional; accept the current slice before starting the next.
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
- Relevant regression checks: [result]

### Acceptance
- Agreed test: [setup, user actions, observable success]
- Performed: [actual result, or pending with blocker; disclose simulations]
- User decision: [accepted / rejected / pending; do not infer from green tests]
- Plan changes: [any agreed iteration plan updates]

### Durable behavior
- Spec changes: [none | agreed enduring behavior only; no slice/acceptance records]
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
**Agreement:** [User decision on changed requirements or material scope]
**Change:** [Agreed durable behavior to update in the owning spec]
**Impact on plan:** [None | Iterations [X-Y] adjusted; keep this record outside the spec]
```
