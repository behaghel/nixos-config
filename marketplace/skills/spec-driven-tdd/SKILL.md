---
name: spec-driven-tdd
description: Enforce rigorous specification-driven development and iterative TDD for code changes. Use when work must start from Markdown specs in `spec/`, when behavior changes require explicit spec updates before coding, when implementation should be delivered as approved vertical slices, and when test suites need disciplined pruning/refactoring of low-value tests.
---

# Specification-Driven TDD

Drive changes from specification first, then execute strict red-green-refactor iterations with an approved vertical-slice plan.

Load `references/templates.md` when drafting or reviewing spec updates, iteration plans, or pruning decisions.

## Workflow

1. Align on specification changes before implementation.
   - Read relevant Markdown files under `spec/`.
   - Record behavior changes in `spec/` before touching production code.
   - Keep specs conceptually organized.
   - Split oversized files when they become hard to review or navigate.
   - Reorganize files when project evolution introduces new concepts or breaks existing conceptual boundaries.
   - Preserve traceability by linking new or moved sections from related spec files.
2. Produce an iterative test plan from the updated specs.
   - Start with the smallest viable end-to-end vertical slice.
   - Define vertical slice as user-interactive functionality across the full path (for example UI/API/data flow where applicable).
   - Reject iterations that deliver only backend or only frontend work.
   - Add iterations that progressively introduce complexity and edge cases.
   - Define, for each iteration: scope, tests, expected failing signal, expected passing behavior, and how humans will exercise and validate it.
   - Pause for explicit plan approval before implementation.
3. Execute one iteration at a time with strict red-green-refactor discipline.
   - Write tests first in `test/` by default.
   - Use the repository's idiomatic test location if the project enforces one.
   - Run the tests and confirm failure before implementation.
   - Implement only the minimal code required to pass the iteration tests.
   - Re-run targeted tests and relevant impacted suites.
   - Refactor only after green, preserving behavior.
4. Repeat until the approved plan is complete.
   - Move to the next iteration only after the current one is passing.
   - Update `spec/` when implementation discoveries require clarified behavior.
   - Collect human feedback on the user-interactive increment before planning the next slice.
   - Keep changes small and reviewable; avoid mixing multiple iteration scopes.
5. Continuously prune or refactor low-value tests.
   - Treat tests as candidates for pruning when they rarely fail but need frequent edits to track superficial spec wording or implementation details.
   - Challenge status quo when unrelated tests break during focused work without a clear behavioral link to the changed spec.
   - Replace brittle tests with behavior-focused tests that map directly to spec requirements.
   - Keep at least one strong test path per critical requirement or bug class.

## Guardrails

- Do not start implementation before spec updates and iteration plan approval.
- Do not write broad test suites up front; grow coverage by iteration.
- Do not implement beyond what is needed to make current failing tests pass.
- Do not call an iteration complete unless users can exercise the new behavior end to end.
- Do not keep tests that add maintenance cost without decision-making value.
- Keep explicit linkage between spec statements and tests.

## Completion Checklist

- `spec/` reflects final agreed behavior and structure.
- Each planned iteration has executed red then green.
- Each iteration delivered a minimal user-interactive end-to-end increment.
- Implementation remains minimal and behavior-focused.
- High-value tests remain; brittle low-signal tests are pruned or refactored.
- Full relevant suite passes.
