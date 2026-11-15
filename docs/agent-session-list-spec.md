# Spec: Tidy, recent-first agent-session inventory

Tree grouping, subtree activity rollup and creator-conversation resume are defined
in the [creator-session tree spec](agent-session-tree-spec.md). Its traversal and
ordering contract supersedes global flat ordering below; its shared inactivity
clock also governs `batch finish --inactive-for`. The activity signals, columns,
time labels, read-only behavior and JSON fields remain unchanged.

## Problem

When returning to a project after time away, the user needs to see where they
last picked up work. `as list` currently prints each session across two lines
without an activity time. A compact table ordered by local engagement makes
recent sessions easy to find without inspecting every worktree or contacting
a remote service.

## Context

- [Inventory rendering](../modules/flake/agent-session/inspection.ts) currently
  projects recorded bindings to `slug`, `branch`, and `worktreePath`.
- [Inventory contract](../modules/flake/agent-session/README.md#recorded-binding-inventory)
  includes missing worktrees, preserves the recorded initial branch, and fails
  before output when session records cannot safely be read.
- [Session persistence](../modules/flake/agent-session/sessions.ts) records
  creation and managed-command start/completion timestamps. Long-running Pi
  conversations currently have no per-message activity integration.
- [Lifecycle commands](../modules/flake/agent-session/lifecycle.ts) wrap agent
  launch/resume and `run` in managed activity tracking.
- [Devenv's Pi extension](../marketplace/plugins/devenv-workflow/pi/extension.ts)
  already receives session lifecycle events and is a candidate integration point.
- [Inventory tests](../tests/agent-session.test.ts) protect metadata-only
  discovery, unchanged JSON fields, missing-worktree inclusion, and Git namespace
  discovery whose subprocess count does not grow with the number of records.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Default view | `SESSION`, `BRANCH`, `LAST ACTIVE`, one row per session; no worktree-path column | Make returning to recent work easy to scan. |
| Ordering | Latest local activity first; equal timestamps use ascending session name | Useful default with deterministic ties; no new sorting flags. |
| Engagement | Start/launch/resume, commands through `as`, user messages, assistant responses, and commits made in the session | Picking work back up counts even before producing a new commit. |
| Exclusions | Polling, internal tool calls alone, inherited commits, and rebasing alone do not bump activity | Navigation by inspection and incidental Git history changes should not reorder sessions. |
| Locality | No network access to determine activity or order | `as` remains a straightforward local UNIX tool. |
| Pi integration | Pi records an activity timestamp for `as`; listing does not parse conversation files | Keep listing independent of Pi's conversation format and history size. |
| Fallback | Use creation time when there is no later qualifying local activity evidence | Existing sessions remain listable without a migration or Pi-history backfill. |
| Time display | Relative ages below one week; `YYYY-MM-DD` dates from one week onward | Recent work is quick to compare; older work is easy to place in time. |
| Terminal layout | Preserve full session names; shorten branch names with `…` when needed; retain activity column; no wrapped rows | Session names remain usable in commands. |
| Piped output | Aligned table, full names, no truncation or colour | `as list \| less` remains useful without adding another format. |
| JSON compatibility | Same ordering as text; unchanged version, envelope, and session fields | Existing machine consumers retain their schema. |

### Activity semantics

The ordering timestamp is the latest qualifying local activity observation for
that session, with creation as the baseline. Managed work counts at its start
and normal completion, including failed commands, as it does today. An idle open
agent is not a continuously advancing clock. Pi user messages and assistant
responses count; tool-call and tool-result events alone do not.

A commit counts when made in the session, not because its commit object became
reachable through fetching, checkout, reset, merge of existing history, or
rebasing. Replaying an existing commit during rebase does not make it new
engagement for this purpose. A commit made before the session was created is not
session activity merely because it is its branch tip. Commit attribution here
is an activity observation, not a branch-ownership or cleanup authority claim.

PR activity contributes only through qualifying local actions. Listing does not
query GitHub, PR timestamps, reviews, CI, or remote branch state. File mtimes and
Git-index refreshes are not additional ordering signals.

An explicit `as <session> run ...` still counts as managed engagement even if its
command happens to be a rebase or a read-only command. The exclusions above
prevent those events from independently bumping activity when performed outside
managed work.

### Command/output example

```text
$ as list
SESSION       BRANCH                  LAST ACTIVE
better-list   agent/better-list        2m ago
mail-sync     fix/mail-sync            3h ago
cleanup       agent/cleanup            2026-05-12
```

`BRANCH` remains the recorded initial branch, consistent with `--json`; the
column does not promise live checkout state. Example times are illustrative.

## Acceptance Criteria

- [ ] AC-1: Given recorded sessions with distinct activity times, `as list`
  prints the three headers and one aligned row per session, newest activity
  first, without worktree paths.
- [ ] AC-2: Given equal activity times, text and JSON list those sessions in
  ascending session-name order. Existing records with no later activity use
  creation time.
- [ ] AC-3: Given an older session, starting, launching, or resuming its agent,
  or running a command through `as`, moves it ahead of less recently engaged
  sessions. It need not wait for the command to finish.
- [ ] AC-4: Given an open Pi session in a managed worktree, a user message or
  assistant response advances its list activity while Pi remains open. Tool-only
  events and an idle agent do not independently advance that time.
- [ ] AC-5: Given a local commit made in a session outside `as run`, that session
  moves ahead of sessions whose last engagement predates the commit event.
  Importing newer existing history or rebasing alone does not have that effect.
- [ ] AC-6: Given recent and older activity, the table shows relative ages below
  seven days and dates at or beyond seven days, using one observation of now
  throughout a listing.
- [ ] AC-7: Given a terminal wide enough for the session and activity columns,
  long branch names shorten with `…` as needed; session names remain complete,
  activity remains visible, and rows do not wrap.
- [ ] AC-8: Given redirected or piped stdout, the table retains full session and
  branch names with aligned columns, no colour, and no truncation.
- [ ] AC-9: Given `as list --json`, the envelope remains `version: 1`,
  `command: "list"`, and `sessions`; each session contains only `slug`, `branch`,
  and `worktreePath`. Its order matches the text view for the same observations.
- [ ] AC-10: Given unavailable network access and command guards rejecting remote
  queries, listing succeeds from local evidence without launching an agent or
  preparation command. Repeating list/status inspection does not advance activity.
- [ ] AC-11: Given a missing recorded worktree, listing retains the binding and
  uses available local activity evidence or creation. Invalid, unreadable, or
  unsafe session records still fail before any inventory output.

## Invariants

- Listing remains read-only: no metadata repair, registration pruning, fetching,
  index refresh, agent execution, or preparation.
- The inventory is recorded-binding discovery, not live Git status or a claim
  that a session is clean, active, owned, or safe to remove.
- Pi activity recording cannot manufacture or clear managed-operation leases,
  acknowledge interruptions, change resource identity, or establish branch ownership.
- Existing metadata versions remain readable. Activity updates preserve other
  fields and concurrent managed-operation tracking.
- Session enumeration does not start inspecting each checkout's working files
  or invoke Git namespace discovery once per record.
- Inactivity age selection shares the list clock as specified in the tree spec.
  Non-age retirement safety checks and approval authority remain independent.
- No activation, package installation, pin upgrade, automatic retirement, or
  copying of Pi conversations/runtime state is part of this change.

## Scope

**May modify:** `modules/flake/agent-session/` inventory rendering, local activity
observation/persistence, and a minimal integration command if needed;
`marketplace/plugins/devenv-workflow/pi/` for Pi event integration; corresponding
CLI and extension tests; agent-session README and skill guidance for the changed
list behavior.

**Must not modify:** unrelated packages/configuration, credentials, Pi history,
PR/network behavior, session ownership, branch creation authority, cleanup
approval, and non-age retirement safety algorithms.

## Verification Plan

| Criteria | Method | Automated? |
|----------|--------|------------|
| AC-1–2 | CLI fixtures with controlled creation/activity timestamps; assert complete rows and deterministic text/JSON order | Yes |
| AC-3 | Launch/run fixture that stays open; list during execution and after completion, including a failed command | Yes |
| AC-4 | Pi event-handler tests for user/assistant messages, tool events, and idle periods; list from a second terminal during a real conversation | Both |
| AC-5 | Disposable local Git repositories with distinct event times: commit, amend, inherited tip, checkout/reset, merge of existing history, and rebase | Yes |
| AC-6 | Controlled clock tests immediately below, at, and above seven days | Yes |
| AC-7–8 | Controlled TTY width and redirected-output tests, including long names; visual terminal check | Both |
| AC-9 | Exact JSON-key assertions and order comparison with text | Yes |
| AC-10 | Network/agent/preparation command guards plus before/after activity snapshots | Yes |
| AC-11 | Existing malformed, dangling, missing-worktree, and fail-before-output inventory regressions | Yes |
| Invariants | Existing inventory scale, managed-activity, interruption, and cleanup regression suites; concurrent activity-writer tests | Yes |

## Implementation Investigation

These are evidence and design constraints, not additional agreed product features:

- Existing `lastWorkAt` supplies managed-command start/completion. Pi's timestamp
  writer needs to preserve operation records and avoid losing concurrent updates.
- Git reflogs distinguish locally recorded commit events from checkout and rebase
  events. Use event time, not commit author/committer time: imported history can
  carry recent commit timestamps without any session engagement.
- The existing `reflogEntries` helper in `git.ts` uses `%ct`, a commit timestamp;
  it is not directly suitable as an engagement clock. Local reflog event selectors
  can expose event times instead.
- Reflogs are retained evidence, not a permanent audit log. Expiry, disabled
  reflogs, deleted branches, and missing worktrees can remove commit observations.
  Do not invent historical activity from an inherited branch tip; retain the
  available recorded engagement/creation fallback. The exact bounded reader and
  branch/worktree attribution need an implementation spike and fixture tests.
- Checkout/owned-branch reflogs and working-file mtimes are not engagement clocks
  for listing or inactivity age selection. Non-age cleanup inspection can retain
  its conservative evidence checks without introducing a second age cutoff.
- Existing inventory scale tests require Git subprocess count not to grow with
  record count. The implementation must preserve cheap listing rather than
  replacing it with per-session status or one Git subprocess per worktree.
- At terminal widths too small to fit even a complete session name and the
  activity column, full names, no wrapping, and staying within the terminal width
  cannot all hold. The ordinary-width contract is AC-7; handling physically
  impossible widths remains a presentation detail to resolve before that slice.

## References

- [Agent-session documentation](../modules/flake/agent-session/README.md)
- [Agent-session operating guide](../marketplace/plugins/devenv-workflow/skills/agent-session/SKILL.md)
- [Local Git helpers](../modules/flake/agent-session/git.ts)
- [Batch activity evidence](../modules/flake/agent-session/batch.ts)
- [Agent-session regression tests](../tests/agent-session.test.ts)
