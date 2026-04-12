# spec-driven

Spec-driven development toolkit — move the human checkpoint upstream from code review to spec review. Inspired by https://www.latent.space/p/reviews-dead

## Philosophy

The spec is the source of truth. Code is its artifact. When an AI agent implements a well-collected spec, you don't need to review the code — you review the spec, and the verification plan proves correctness.

This plugin helps you collect the right information, structure it into a verifiable contract, and validate it before implementation begins.

## What's Included

### Skills

| Skill | Auto-triggers on |
|-------|-----------------|
| Spec Collector | Writing specs, defining requirements, planning features, starting new tasks |
| Spec Verifier | Validating specs, checking completeness, reviewing acceptance criteria |

### Commands

| Command | Description |
|---------|-------------|
| `/spec-driven:collect-spec` | Interactive 6-phase spec collection — walks you from idea to verifiable contract |

### Agents

| Agent | Description |
|-------|-------------|
| spec-challenger | Adversarial review — finds gaps, unstated assumptions, and untestable criteria |

## The Collection Process

The `collect-spec` command walks through 6 phases:

1. **Problem** — Why does this work need to exist?
2. **Context** — What code, patterns, and systems are relevant? (agent reads the codebase)
3. **Decisions** — What architectural choices need human input?
4. **Criteria** — What does "done" look like? (Given/When/Then)
5. **Boundaries** — What can be touched? What must not break?
6. **Verification** — How do we prove each criterion is met?

Each phase builds on the previous. The agent reads the codebase between phases to ask informed questions rather than relying on the human to provide all context.

## Output

A structured spec that serves as a verifiable contract:

- **Problem** — why the work exists
- **Context** — relevant codebase and systems
- **Decisions** — architectural choices with rationale
- **Acceptance Criteria** — observable, testable outcomes (Given/When/Then)
- **Invariants** — what must not break
- **Scope** — explicit file/module boundaries
- **Verification Plan** — how to prove each criterion

## Workflow

```
1. /spec-driven:collect-spec "add JWT refresh tokens"
2. Walk through the 6 phases interactively
3. Spec challenger finds gaps → refine
4. Spec verifier confirms completeness → approve
5. Hand the spec to an AI agent for implementation
6. Verification plan proves correctness — no code review needed
```

## Quick Start

```bash
# Install
/plugin install spec-driven

# Collect a spec interactively
/spec-driven:collect-spec "add user authentication"

# Or describe what you need — the skill activates automatically
"I need to add rate limiting to the API"

# Challenge an existing spec
"Poke holes in this spec"

# Validate a spec for completeness
"Is this spec ready for implementation?"
```
