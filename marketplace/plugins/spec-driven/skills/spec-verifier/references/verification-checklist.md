# Verification Checklist

Detailed checklist for auditing spec completeness. Work through each section in order.

## Problem Statement

- [ ] States WHY this work exists, not just WHAT it does
- [ ] Identifies who is affected
- [ ] Is falsifiable — you could prove the problem does NOT exist
- [ ] Does not prescribe a solution (that's what the rest of the spec is for)

## Context

- [ ] Relevant existing code is identified (files, modules, patterns)
- [ ] Interaction points with other systems are mapped
- [ ] Existing tests that serve as implicit specs are referenced
- [ ] The agent could navigate to the right files from this section alone

## Decisions

For each decision:

- [ ] The decision is an actual choice (not the only reasonable option)
- [ ] Rationale explains WHY, not just WHAT
- [ ] Alternatives were considered (at least implicitly)
- [ ] No two decisions contradict each other

Missing decision signals:

- The spec says "implement X" but there are multiple valid approaches → decision needed
- The spec makes an implicit assumption about technology/pattern → make it explicit
- The spec references an external system without specifying integration approach → decision needed

## Acceptance Criteria

For each criterion:

- [ ] Uses Given/When/Then or equivalent observable format
- [ ] Describes ONE behavior (not compound with unrelated "AND" outcomes)
- [ ] Could be copy-pasted into a test description
- [ ] Uses concrete values, not vague qualifiers ("400 status" not "an error")
- [ ] Covers at least: happy path, one error case, one edge case

Coverage gaps to probe:

- What happens with empty/null/missing input?
- What happens when an external dependency is down?
- What happens with concurrent/duplicate requests?
- What happens at boundary values (0, max, negative)?
- What happens if the user has insufficient permissions?

## Invariants

- [ ] Existing test suites that must continue passing are named
- [ ] Public API contracts are protected (response shapes, status codes)
- [ ] Performance baselines are stated if relevant
- [ ] Security invariants are explicit (no new exposed endpoints, no credential changes)
- [ ] Dependency rules are stated (no new deps, or which new deps are approved)

## Scope

- [ ] "May modify" lists specific paths, not broad directories
- [ ] "Must not modify" explicitly protects sensitive areas
- [ ] Scope is narrow enough for a single implementation pass
- [ ] If scope seems broad, consider splitting into multiple specs
- [ ] New files are described with expected location

Scope smell test: If the scope section says "the whole [module]", it's probably too broad.

## Verification Plan

For each criterion:

- [ ] A specific verification method is assigned (unit test, integration test, etc.)
- [ ] The method is concrete enough to implement ("test that 401 is returned" not "verify auth works")
- [ ] Whether it's automated is stated
- [ ] The test can be written from the criterion alone (no additional spec needed)

Coverage check:

- [ ] No acceptance criterion is left unverified
- [ ] No "manual check" is used where an automated test is feasible
- [ ] Verification methods are achievable within the stated scope

## Final Assessment

Answer these three questions:

1. **"Could an AI agent implement this spec correctly without asking follow-up questions?"**
   → If no, what's missing?

2. **"Would I be confident in the result without reading the generated code?"**
   → If no, which criteria or invariants need strengthening?

3. **"If two different agents implemented this spec independently, would they produce functionally equivalent results?"**
   → If no, which decisions are underspecified?

If all three answers are "yes," the spec is ready.
