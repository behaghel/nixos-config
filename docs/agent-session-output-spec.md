# Spec: State-first agent-session output

## Problem

Users need to understand what `as` is doing, what is true when it stops, and
whether they need to act. Internal phase logs, repeated readiness messages and
dense approval prose obscure those answers. A consistent, colourful, updating
presentation makes all human-facing subcommands easier to scan without hiding
failure evidence or weakening cleanup approval.

## Context

- [Runtime output](../modules/flake/agent-session/runtime.ts) currently defaults
  to STARTED/COMPLETED phase messages. Compact progress is limited to selected
  batch-preview phases.
- [Inventory requirements](agent-session-list-spec.md) and the
  [creator-tree contract](agent-session-tree-spec.md) establish compact tables,
  creator grouping, activity ordering and machine compatibility.
- [CLI dispatch](../modules/flake/agent-session/cli.ts) includes human commands,
  protocol-producing commands, and commands handing control to another program.
- [Cleanup contracts](../modules/flake/agent-session/README.md) define distinct
  single-session, recursive, historical-branch and batch scopes, with existing
  confirmation, receipt, ownership, artifact and interruption safeguards.

This spec supersedes earlier human-presentation requirements where they conflict:
mandatory unwrapped inventory rows on narrow terminals, raw receipts in ordinary
text, JSON-only access to blocker explanations, and separate branch-selection
and final cleanup confirmations. It does not supersede identity, selection,
activity, eligibility, receipt or other machine/safety contracts. The command
entrypoint for live inspection is `list --inspect`; `status` is removed with a
migration error, while inspection JSON payload shapes remain unchanged.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Human output | Temporary in-place progress followed by a durable result | Show current state rather than a transcript of implementation phases. |
| Collections | Stable rows whose state changes during processing; final counts | Make batch progress and outcomes visible without repeated log lines. |
| Individual resources | Compact summaries using the same state vocabulary; inspection uses the same table for one or many rows | Unify session inspection without a separate single-resource status interface. |
| Inspection entrypoint | Cheap inventory through `list`; live Git/binding tables through `list --inspect`; remove `status` with migration guidance | Keep inspection cost explicit and avoid two overlapping listing commands. |
| Terminal use | Normal scrollback, no full-screen takeover | Remain a conventional CLI and coexist with launched programs. |
| Narrow terminals | Inspection keeps a state-column table, shortening secondary branch display and wrapping cells; other views may stack entries | Keep inspected state visually comparable without losing session identity or state. |
| Redirected output | Plain append-only output by default; no cursor control | Keep captured output readable and predictable. |
| Colour | `--color=auto|always|never`, default `auto`, respecting `NO_COLOR` | Provide restrained visual emphasis and explicit control. |
| Meaning | Words carry every state; colour is supplementary | Output remains understandable without colour. |
| Diagnostics | `--verbose` exposes successful checks and preparation details | Troubleshooting does not require consuming JSON. |
| Normal cleanup | Inspect, show exact proposed scope, ask once with `[y/N]`, then update results | Remove the separate preview/apply ceremony from interactive use. |
| Read-only inspection | Retain `--dry-run` and existing structured previews | Inspection must remain possible without entering an approval flow. |
| Branch preference | Preserve by default; `--keep-branch` and `--delete-branches` override personal defaults | Worktree removal alone does not imply branch deletion. |
| Personal preferences | XDG-aware personal configuration for colour and interactive branch disposition only | Support personal workflow without introducing project-level policy overrides. |
| Automation | Personal branch defaults do not affect automated execution; branch disposition is explicit | A preference-file edit cannot silently expand a script's deletion scope. |
| Handoff boundaries | Leave launched agents and commands invoked through `run` untouched | `as` owns preparation output, not the child program's UI or streams. |

## Acceptance Criteria

### Presentation

- AC-1: During a human-facing operation, default output shows concise current
  progress rather than routine internal STARTED/COMPLETED pairs. Initial progress
  appears before potentially slow discovery or inspection, not only once the
  table is ready. Successful Git and devenv preparation does not leak incidental
  logs into that display.
- AC-2: At completion, transient progress gives way to a durable summary of the
  result, affected resources, actionable warnings and any necessary next action.
  Repeated readiness messages and completed-step checklists are absent.
- AC-3: While processing a collection on a capable terminal, rows retain their
  positions and update as work proceeds. The final display retains each outcome
  and aggregate counts. Display order never changes the required execution order.
- AC-4: Preview labels describe proposals, such as `Would remove` or `Would
  preserve`, and end with `Nothing changed`. Execution labels describe observed
  outcomes, such as `Removed`, `Preserved`, `Failed` or `Uncertain`. An unsettled
  operation is never presented as successful completion.
- AC-5: Each row gives a concise reason. Default collection output ends with the
  table and aggregate counts, without a diagnostic appendix or receipt-retrieval
  hint pushing the result off-screen. `--verbose` exposes fuller actionable
  blocker explanations in human-readable form; JSON is not required. Actual
  command failures still surface relevant original technical errors. Routine
  successful checks stay hidden.
- AC-6: `list --inspect` remains a table with a visible state column for one or
  many sessions, including narrower terminals. Secondary branch display may
  shorten with an ellipsis; verbose details retain the complete current branch.
  Session identity and state wrap within their columns when necessary rather
  than switching to cards. Other views may use compact stacked entries on
  narrow terminals. Redirected output is append-only without cursor movement,
  and preserves full resource identities and branch values.
- AC-7: `--color=never` suppresses colour; `auto` colours only suitable terminal
  output and respects `NO_COLOR`; `always` explicitly requests colour, including
  redirected human output. Colour never replaces words or affects JSON/protocol
  output. Explicit flags override personal colour preferences; `NO_COLOR`
  suppresses automatic colour, while explicit `always` opts in.
- AC-8: `--verbose` makes successful checks and preparation diagnostics available
  in human-readable form. Relevant original technical errors appear on failure
  even without it, with credential values redacted. Failures distinguish no
  changes, confirmed partial changes and uncertain effects; cancellation does
  not imply that any cleanup happened.

### Approval and preferences

- AC-9: Interactive cleanup shows the exact proposed resources and branch
  disposition before one final `[y/N]` approval. Empty input, No, EOF and failed
  input approve nothing. The existing rechecks still occur after approval.
- AC-10: Branches are preserved by the built-in default. `--delete-branches`
  requests deletion only of branches eligible under the selected cleanup mode;
  `--keep-branch` explicitly requests preservation. The displayed proposal
  identifies deletions, preservations and reasons before approval. Modes without
  supported branch deletion do not gain deletion authority through a preference.
- AC-11: Personal configuration can request eligible branch deletion for
  interactive cleanup and choose colour behaviour. It is XDG-aware, does not
  load project-level overrides, and cannot enable force, grant consent, change
  eligibility or weaken safety checks. Explicit branch flags override it.
- AC-12: Read-only previews can reflect effective personal branch preferences.
  Receipt- and `--yes`-based cleanup retain their explicit branch dispositions
  and existing JSON and receipt contracts. Plain named `finish` uses the
  scoped defaults below.
- AC-13: `--dry-run` remains read-only without confirmation. Ordinary human output
  omits raw receipt tokens and copy-a-receipt instructions; structured previews
  retain the complete receipts required by supported automation.

### Command boundaries

- AC-14: The presentation applies to `list` (including `--inspect`), `doctor`, `create`, `start`,
  `launch`, `resume`, `repair`, `branch create`, `ownership`, `activity reconcile`,
  and every `finish`/`batch finish` mode, including errors and empty results.
  Presentation does not add mutation or consent capabilities to those commands.
- AC-15: Agent launch/resume and `run` preserve child output, input and exit
  behaviour. `cd`, completion and internal completion output remain protocol-clean;
  successful `activity touch` remains silent. New presentation flags are parsed
  as `as` options only in their documented positions, never stolen from child
  command arguments.

- AC-16: `list` remains a cheap recorded-binding inventory by default.
  `list --inspect` shows live Git/binding state as a table for one or many sessions;
  scoped calls use `as <slug> list --inspect`, including `.`. Explicit remote
  refresh and exact-path inspection remain available under `--inspect`.
  Inspection-only modifiers and scoped calls without `--inspect` fail before
  inspection. `status` is absent from help/completions and fails with migration
  guidance rather than aliasing or being reinterpreted as a session name; an
  explicitly escaped session named `status` remains usable. Live and exact
  inspection retain their previous JSON payload schemas at the new entrypoint.

- AC-17: Non-forced single-session cleanup refuses live, interrupted, foreign-host
  and unknown managed operations, incomplete same-user cwd observations, and
  processes inside the selected worktree or its descendants. Preview emits no
  approval receipt while activity is blocked. Apply checks before approval and
  freshly after approval/revalidation, immediately before native removal;
  `--yes` and an earlier receipt do not waive this check. Refusal preserves
  resources and recorded operations without acknowledging or killing anything.
  The probe does not claim to detect remote work or editors whose cwd is elsewhere.

### Plain named finish

- `as <slug> finish` shows a readiness table for the named session, not a
  repository-wide ancestry inventory. Human recursive output also omits
  unrelated unknown ancestry; structured diagnostics remain available in JSON.
- At a terminal, confirmed direct children start collapsed and unselected. The
  operator can select children, review their assets and blockers, and recheck or
  deselect a blocked child. Final confirmation names the sessions to finish and
  the direct children to keep. The command revalidates the selection before any
  removal, then finishes selected children before the parent. Unselected children
  retain their records and recorded parent identity. A non-interactive run never
  selects children.
- The plain command retires the worktree with or without a terminal when the
  default selection is ready. It deletes verified, exclusively owned and merged
  local branches, preserves borrowed or unverified branches, and leaves remote
  assets alone. Personal `branches: preserve` keeps local branches.
- Finished records are archived by session identity, marked with a finish time,
  and omitted from active inventory and ownership claims. Personal `records:
  delete` opts out of archiving. An archive does not reserve the slug or grant
  any authority over later sessions or refs.
- The terminal review can acknowledge a verified interruption, using the same
  evidence, consent and rechecks as standalone reconciliation. Acknowledgment
  does not authorize cleanup; `finish` rechecks readiness and asks separately.
  Live or uncertain activity can be rechecked, not overridden. Local artifact
  disposal and ambiguous branch decisions do not run automatically.

## Invariants

- Existing JSON envelopes, fields, receipts and structured progress events remain
  compatible and free of ANSI styling or human commentary.
- Resource ancestry, creator relationships, activity clocks, inventory ordering
  and cleanup execution ordering retain their existing meanings.
- Cleanup still requires the existing ownership, branch eligibility, cleanliness,
  process, ignored-artifact, binding, lock and scope-revalidation checks.
- A personal default is a request to include eligible branches in a proposal,
  never consent or evidence of ownership. Historical branch review retains its
  own explicitly reviewed selection and eligibility rules.
- No automatic force fallback, repair, migration or remote mutation is
  introduced. Only a requested plain named finish can retire a ready selection
  without separate confirmation. Partial and uncertain outcomes retain their
  original evidence.
- Human presentation changes do not impose arbitrary JSON support on commands
  which do not currently offer it, or turn interactive-only operations into
  automated ones.

## Scope

**May modify:** agent-session command parsing/completion, runtime presentation,
command output and interactive approval wiring under `modules/flake/agent-session/`;
personal-preference loading in that provider; regression tests and test fixtures;
its README, relevant `docs/agent-session-*-spec.md` presentation clauses, and the
agent-session skill where command guidance changes.

**Must not modify:** unrelated host configuration, agent or child-command UIs,
Pi conversation storage, safety/identity/selection semantics, JSON protocols,
personal preference files on the user's machine, or real session resources for
acceptance testing without separate explicit approval.

Configuration filename, syntax and terminal-rendering internals are implementation
details to specify in command documentation before shipping. They do not expand
the agreed settings or authority boundaries.

## Verification Plan

| Criteria | Method | Automated? |
|----------|--------|------------|
| AC-1–2 | Exercise successful and failed create/preparation with noisy fixture subprocesses; assert concise results and retained failure evidence. | Yes; terminal review too |
| AC-3–5 | Capture a controlled multi-resource operation with mixed results; verify stable row updates, proposals versus outcomes, counts and explanations. | Yes; terminal review too |
| AC-6 | Exercise wide/narrow terminal dimensions, resize and redirected streams; verify readable identities and absence of cursor escapes in pipes. | Yes; terminal review too |
| AC-7 | Test explicit colour modes, configured defaults, `NO_COLOR`, TTY/pipe and machine output combinations. | Yes |
| AC-8 | Exercise verbose/nonverbose success and failure, redaction, cancellation and injected partial/uncertain cleanup outcomes. | Yes |
| AC-9–10 | In isolated fixtures, approve/decline exact plans, request branch deletion/preservation, and change evidence after confirmation. | Yes; terminal review too |
| AC-11–12 | Isolate HOME/XDG settings; test flag precedence, interactive preferences, automation independence and unsupported deletion modes. | Yes |
| AC-13 | Verify previews do not mutate or prompt; human output excludes receipt tokens while JSON retains valid receipts. | Yes |
| AC-14–16 | Command-family coverage including empty/error cases, help/completions, child passthrough, cheap versus live inventory, scoped/exact selectors and retired-command migration/refusal. | Yes |
| AC-17 | Clean-worktree fixtures with managed operations, failed/partial probes, a real nested-cwd worker, post-confirmation activity and receipt/apply races; verify byte-identical records and retained resources. | Yes |
| Invariants | Existing provider/template regression suite and flake checks, plus receipt, refusal and interruption regressions. | Yes |

Terminal appearance and live updates also require human acceptance; captured
fixture output alone does not establish that the result is appealing in use.
No real user session is retired as part of an automatic verification run.

## References

- [Agent-session usage and safety contracts](../modules/flake/agent-session/README.md)
- [Inventory spec](agent-session-list-spec.md)
- [Creator-tree spec](agent-session-tree-spec.md)
- [PR worktree spec](agent-session-pr-spec.md)
- [Provider regression tests](../tests/agent-session.test.ts)
- [Merged PR #86](https://github.com/behaghel/nixos-config/pull/86)
