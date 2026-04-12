---
description: Interactive spec collection — walks through the 6-phase framework to produce a verifiable spec from a feature idea
argument-hint: [feature-description]
allowed-tools: [Read, Glob, Grep, Bash]
---

# Collect Spec

Walks through the 6-phase collection framework to produce a complete, verifiable spec.

## Instructions

When this command is invoked:

### Phase 1: Problem Space

1. If the user provided a feature description as argument, use it as starting point
2. Ask clarifying questions:
   - "What problem does this solve?"
   - "Who is affected?"
   - "What are the hard constraints (deadline, backward compatibility, regulatory)?"
3. Draft the Problem section
4. Confirm with the user before proceeding

### Phase 2: Context Discovery

1. Based on the problem description, search the codebase:
   - Find files and modules related to the described feature area
   - Identify existing patterns and conventions
   - Find existing tests that act as implicit specs
   - Map interaction points with other systems
2. Present findings to the user:
   - "I found [relevant files/patterns]. Here's what the codebase tells me..."
   - "Should we follow the existing [pattern X]?"
   - "These tests in [path] seem related — should they continue passing as-is?"
3. Draft the Context section

### Phase 3: Decision Points

1. Based on context, identify architectural decisions that need a ruling:
   - Where the codebase doesn't have a clear convention
   - Where multiple valid approaches exist
   - Where the user's description is ambiguous
2. For each decision, present:
   - What needs deciding
   - Options with trade-offs
   - What the codebase suggests
3. Record each ruling with rationale in the Decisions table

### Phase 4: Acceptance Criteria

1. Propose initial criteria based on the problem and decisions:
   - Happy path behavior
   - Error/failure cases
   - Edge cases discovered during context analysis
2. Use Given/When/Then format
3. Ask the user to review, add, modify, or remove criteria
4. Probe for gaps:
   - "What should happen when [edge case]?"
   - "What if [dependency] is unavailable?"
   - "Are there rate limits or size constraints?"
   - "What error messages should the user see?"

### Phase 5: Boundaries & Invariants

1. Propose scope based on context discovery:
   - **May modify:** files identified in Phase 2
   - **Must not modify:** sensitive areas (schemas, public APIs, CI)
2. Propose invariants:
   - Existing test suites that must pass
   - API contracts that must hold
   - Performance baselines
3. Ask user to confirm or tighten

### Phase 6: Verification Plan

1. For each acceptance criterion, propose a verification method:
   - Unit test, integration test, contract test, manual check
   - State whether it's automated
2. Ask user to confirm the plan

### Assembly

1. Combine all sections into the spec output format (defined in the `spec-collector` skill)
2. Read through for internal consistency:
   - Do criteria match the decisions?
   - Does scope cover everything the criteria require?
   - Do invariants protect everything outside scope?
3. Present the complete spec
4. Ask: "Is this spec ready, or would you like to change anything?"

## Rules

- Do NOT skip phases — each phase surfaces information the next phase needs
- Do NOT fill in criteria the user should author — propose, then ask for confirmation
- Do NOT assume decisions — surface them, present options, ask for rulings
- Keep the conversation moving — if a phase has no open questions, summarize and advance
- Present the final spec in a single code block for easy copying
