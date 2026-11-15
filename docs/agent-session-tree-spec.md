# Spec: Creator-session trees and resume

## Problem

A worktree can be the result of a conversation in another worktree. A flat
inventory hides that relationship, and continuing the most recent conversation
inside the child loses the context that led to its creation. The user needs to
see related work grouped together and return to the exact conversation that
gave birth to a child, in that conversation's parent worktree.

## Context

- [The existing inventory spec](agent-session-list-spec.md) defines the three
  table columns, local activity signals, time labels, terminal/piped behavior,
  and version-1 JSON fields. This spec changes grouping, ordering and child
  resume; those other contracts remain in place.
- [Session metadata](../modules/flake/agent-session/types.ts) records resource
  identity and `parentSessionId`, but `conversation` is currently always null.
- [Creation](../modules/flake/agent-session/lifecycle.ts) records resource ancestry
  from the verified invoking worktree, including shell creation. That ancestry
  is not evidence of which Pi conversation caused the creation.
- [Resume dispatch](../modules/flake/agent-session/cli.ts) currently passes
  `--continue` to the configured agent inside the selected worktree. Pi uses that
  flag for the latest conversation in the current directory, not an exact creator.
- [The Pi integration](../marketplace/plugins/devenv-workflow/pi/session-activity.ts)
  records conversation activity without copying conversation contents or history.
- [Guarded session-tree cleanup](../modules/flake/agent-session/README.md#session-tree-ownership-and-guarded-finish)
  uses recorded resource ancestry and ownership for removal scope. The new
  listing/resume relationship must not reinterpret those cleanup records.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Default text view | Retain the aligned table; add `tree`-style relationship lines in `SESSION` | Show the relationship without introducing another command or losing activity context. |
| Listing relationship | A child has a recorded, exact creator Pi conversation associated with a parent managed worktree | A directory or resource-parent record alone does not identify a conversation. |
| Roots | Shell-created worktrees and older records without creator information appear at the root | Keep legacy and non-Pi use simple; no ancestry guessing or history backfill. |
| Activity rollup | Display the maximum of a node's own activity and every descendant's activity | Recent child work makes the whole group easy to find. |
| Ordering | Roots and each sibling set sort by rolled-up activity, newest first; ties use ascending slug | Keep related work contiguous while retaining the recent-first default. |
| Traversal | Parent before its children, recursively | Match the familiar `tree` layout. |
| Child resume | Reopen the exact recorded creator Pi conversation in its parent worktree | Return to the conversation that led to the child, not a new or unrelated conversation inside it. |
| Root resume | Keep the existing behavior: continue the latest conversation in the root entry's own worktree | Preserve familiar shell and legacy workflows. |
| Explicit child work | `as child launch` still launches inside the child worktree | Starting work in the child remains a separate, explicit action. |
| Missing known origin | Fail clearly if the recorded conversation or parent worktree is unavailable | Never silently substitute another conversation or convert a known child into a root-resume fallback. |
| JSON | Flat version-1 array, unchanged fields, matching text traversal order | Preserve existing consumers without putting visual prefixes into machine data. |
| Inactivity cutoff | `batch finish --inactive-for` uses the same effective activity as `LAST ACTIVE`, including descendants | Preview selection must agree with the activity the user sees. |
| Human batch preview | All candidate rows in creator-tree order, with `SESSION`, `LAST ACTIVE`, `PLAN`, `REASON`, and a selection summary | Make review readable without hiding why a session is retained. |
| Preview progress | One updating line on terminals; bounded plain progress when redirected | Routine STARTED/COMPLETED pairs must not bury the review summary. |
| Receipt presentation | Full receipt and blocker details stay in `--json`; normal text gives a retrieval hint, not a raw or abbreviated token | Keep machine authority intact without flooding human output. |
| Cleanup boundary | Preserve resource ancestry, ownership, non-age safety checks and approval independently | Shared activity determines age eligibility, not disposal authority. |

### Listing contract

```text
SESSION             BRANCH               LAST ACTIVE
parent              agent/parent         2m ago
├── child-a         agent/child-a        2m ago
│   └── grandchild  agent/grandchild     1h ago
└── child-b         agent/child-b        3h ago
another-root        agent/another-root   1d ago
```

Use `├──`, `└──` and `│` with indentation to distinguish siblings, descendants
and continuation lines. Each recorded binding appears once. Full session slugs
remain visible and directly usable as command arguments; prefixes are presentation
only. Column alignment and terminal branch truncation account for the prefix
width. Piped output retains full names and relationship lines without colour.

A parent's `LAST ACTIVE` and its position among siblings use the same rolled-up
time. Rollup is recursive and includes its own activity. A recent grandchild can
move its ancestor group above another root, but does not appear ahead of its own
parent. Rollup is computed for the listing; it does not write activity timestamps
into parent records or invent engagement. `batch finish --inactive-for` evaluates
its age cutoff against that same effective timestamp.

`--json` remains `{ version: 1, command: "list", sessions: [...] }`. Entries still
contain only `slug`, `branch` and `worktreePath`, without indentation, connectors,
nested arrays or added relationship/activity fields. The sequence is the same
parent-first traversal as the text table, not a globally sorted flat list.

### Shared inactivity clock

`as batch finish --inactive-for <duration>` compares its cutoff against the same
own/subtree activity used by `as list`, with the same creator relationships and
legacy-root rules. A recent descendant protects its ancestors from age selection.
All recorded descendants contribute, even if excluded from the batch's removal
selection. Ordinary checkout events and working-file mtimes do not introduce a
second age clock behind the displayed activity.

Age eligibility is not permission to remove a worktree. Dirty state, live or
uncertain operations/processes, ownership, native registration/locks, ignored
data, unknown evidence, branch preservation and explicit receipt approval retain
their independent guards. Incomplete subtree activity prevents age eligibility.

Apply rechecks the shared clock against fresh records for each selected target.
New descendant activity after preview prevents removal of its ancestor. When
both an ancestor and its descendants are selected, applying the approved selection
must not invalidate an ancestor's clock merely because the batch already removed
one of its own approved descendants. Receipts still bind the exact selected
resources; this does not imply recursive cleanup or add descendants to the selection.

Explicit cleanup without an inactivity cutoff retains its existing non-age
inspection and approval rules; this change does not introduce a cutoff there.

### Human batch preview

The default dry-run output is a review summary, not an execution log. It keeps
all candidates visible, uses the same creator-tree order and activity labels as
`list`, and aligns `SESSION`, `LAST ACTIVE`, `PLAN` and `REASON` columns. Candidates
without a trustworthy tree position still appear as ungrouped rows; unavailable
activity is shown as unknown, not invented.

`PLAN` says `would remove` only for the exact receipt selection; other rows say
`keep`. Reasons use readable labels without upgrading uncertain process/resource
evidence into a claim of successful completion or confirmed ownership. Show the
primary reason and `(+N)` for additional blockers. Full slugs remain visible;
terminals may shorten reason text with an ellipsis while piped output stays full.

The summary states the inactivity window, branch preservation, eligible/retained
counts and that no changes were made. It does not print the raw receipt by default
or replace it with a short approval alias. A concise hint points to `--json`, which
retains the complete receipt, blockers, existing schema and structured progress.

Terminal progress uses one updating inspection line that clears before the final
table. Redirected human progress stays bounded and contains no terminal controls.
Failures remain visible rather than being hidden with routine progress. Devenv's
own shell/task startup output is outside this renderer's scope.

### Creator and resume contract

A creator association identifies the exact conversation and the stable parent
worktree identity at creation. It is not inferred from the latest Pi conversation,
branch names, path basenames, or filesystem nesting. Reusing an existing resource
must not retarget its creator to whoever most recently launched or inspected it.
A reused slug must not adopt the creator relationship of an earlier incarnation.

Creation without a recorded creator conversation in a managed parent worktree
produces a root for listing/resume. This includes ordinary shell `create`/`start`,
even when invoked from another managed worktree, and legacy records without
creator information. Existing resource-parent records remain unchanged and do
not become Pi creator evidence merely because they contain a parent ID.

For a child, `as child resume` selects its immediate creator conversation, not
the oldest conversation at the top of the tree. A grandchild therefore resumes
the conversation that created that grandchild. The command runs that conversation
in its recorded parent worktree; it does not move the conversation into the child,
copy its history, fork it, or silently create a new conversation.

Once a creator is recorded, failure to locate its conversation or original parent
is an error, not evidence that no creator was ever recorded. A missing relationship
target must not make a child disappear from inventory or silently associate it
with a different resource that happens to have the same slug. Display detachment
never erases creator information or enables the root-resume fallback.

The existing `launch` action continues to use the selected child's worktree.
A root's `resume` continues to use its own worktree. These commands do not become
implicit worktree creation, repair, conversation migration, or session cleanup.

## Acceptance Criteria

- [ ] AC-1: Given Pi in a managed parent worktree creates a child, listing shows
  the child beneath that parent with a relationship line and aligned columns.
- [ ] AC-2: Given multiple children and a grandchild, listing shows correct
  continuation/last-child connectors and prints each binding once, parent first.
- [ ] AC-3: Given a grandchild with the newest activity, its ancestor group moves
  ahead of older roots and each ancestor displays that newest time. Within each
  sibling set, rolled-up time determines order; ties use ascending slug.
- [ ] AC-4: Given repeated listing of the same records, own activity timestamps,
  resource ancestry, ownership and cleanup evidence remain unchanged by polling.
- [ ] AC-5: Given the table, JSON contains the same slugs in the same traversal
  order, but retains its exact existing envelope and unprefixed entry fields.
- [ ] AC-6: Given a child whose parent contains multiple Pi conversations,
  `as child resume` reopens the exact conversation that created the child in the
  parent worktree, even if another conversation there is newer.
- [ ] AC-7: Given a grandchild, `resume` opens its immediate creator conversation
  in that creator's worktree, rather than recursively redirecting to the top root.
- [ ] AC-8: Given shell `create` or `start` outside Pi, including invocation from
  inside another managed worktree, the entry is a listing/resume root. Legacy
  records without creator information also remain roots; root resume keeps its
  own-worktree latest-conversation behavior.
- [ ] AC-9: Given a known creator conversation or original parent worktree is
  missing, `resume` reports the missing origin and launches no replacement,
  picker, fork or guessed latest conversation.
- [ ] AC-10: Given `as child launch`, the configured agent still launches in the
  child's worktree rather than the creator's worktree.
- [ ] AC-11: Given narrow terminal or piped output, full slugs and relationship
  connectors survive; terminal branch shortening and full piped names retain
  the existing table contract.

- [ ] AC-12: Given old parent activity and a recent descendant, batch preview
  reports that descendant's timestamp as the parent's effective activity and
  refuses age eligibility for the parent, even when the descendant is excluded.
- [ ] AC-13: Given an eligible ancestor preview, new descendant activity before
  apply causes a fresh refusal without removing the ancestor. A batch selecting
  an inactive parent and child can complete its exact approved selection without
  weakening receipt or branch-preservation checks.
- [ ] AC-14: Given old recorded engagement but fresh checkout/file timestamps,
  batch uses the displayed engagement for age. Dirty data, ignored data and
  live/unknown process evidence still independently block removal.

- [ ] AC-15: Given a batch preview with selected, retained and multiply blocked
  entries, text shows every candidate in tree order with aligned activity, plan
  and reason columns, correct counts, additional-blocker cues and no raw receipt.
  JSON retains the complete receipt/blockers and unchanged schema.
- [ ] AC-16: Given a terminal preview, inspection progress uses one updating line
  cleared before the table; redirected progress is bounded without escape codes.
  JSON retains every structured progress event and failures stay visible.

## Invariants

- Listing remains local and read-only: no fetch, remote/PR query, conversation
  history scan, agent launch, preparation, repair or metadata migration.
- Existing activity signals and time labels remain as specified in the inventory
  spec; this work does not add local commit detection or new activity sources.
- Creator associations neither confer branch ownership nor replace cleanup's
  recorded ancestry, reviewed mappings, approval receipts or safety checks.
- Listing old children as roots does not rewrite their resource-parent records.
- No credentials, message text or copies of Pi runtime/history enter repository
  files or agent-session records. A conversation locator is not conversation content.
- Malformed/unsafe records and invalid relationship graphs are not silently
  downgraded to unrelated roots or omitted to produce an apparently complete list.
- No implicit upgrades, new client installation, activation, merging, retirement,
  primary-checkout update or personal Pi configuration edits.

## Scope

**May modify:** `modules/flake/agent-session/` creation metadata, inventory graph
assembly/rendering, resume dispatch and associated compatibility handling;
`marketplace/plugins/devenv-workflow/pi/` for minimal creator-context integration
if needed; corresponding CLI, Pi and packaged tests; agent-session and plugin
documentation and skill guidance.

**Must not modify:** cleanup/ownership scope or authority, unrelated host/dev
configuration, package pins, credentials, Pi conversation contents, existing
conversation working directories, or the separate local-commit detection work.

## Verification Plan

| Criteria | Method | Automated? |
|----------|--------|------------|
| AC-1, AC-6 | Create a child using Pi creator context; fake-agent argv/cwd assertions; real Pi manual check with an identifiable creator conversation and a newer competing conversation | Both |
| AC-2–3 | Controlled multi-root/multi-level fixtures, including last-child connectors, descendant-only recency and stable ties | Yes |
| AC-4 | Compare metadata, refs, native registrations and cleanup previews before/after repeated listing | Yes |
| AC-5 | Exact JSON envelope/field assertions and traversal comparison with text | Yes |
| AC-7 | Parent/child/grandchild fixtures with distinct creator conversations; assert immediate creator target and cwd | Yes |
| AC-8 | Shell creation/start fixtures from primary and managed directories plus legacy records with resource parents but no Pi creator | Yes |
| AC-9 | Missing conversation, missing parent worktree and reused-parent-slug fixtures; assert error and no agent execution | Yes |
| AC-10 | Fake-agent launch argv/cwd regression | Yes |
| AC-11 | Controlled terminal widths and redirected output with deep prefixes and long names | Yes |
| AC-12–13 | Parent/child/grandchild fixtures, excluded descendants, controlled engagement timestamps, preview/apply races and exact branch-preserving batch receipts | Yes |
| AC-14 | Checkout/touch fixtures with old engagement plus dirty, ignored-data and live/unknown-process guard regressions | Yes |
| AC-15–16 | Mixed-candidate CLI fixtures, text/JSON comparisons, controlled terminal-width/progress probes and read-only before/after evidence | Yes |
| Invariants | Existing inventory scale, metadata compatibility, lifecycle, Pi activity and guarded-cleanup regressions; host flake checks | Yes |

## References

- [Existing inventory spec](agent-session-list-spec.md)
- [Agent-session documentation](../modules/flake/agent-session/README.md)
- [Pi activity integration](../marketplace/plugins/devenv-workflow/pi/session-activity.ts)
- [Agent-session operating guide](../marketplace/plugins/devenv-workflow/skills/agent-session/SKILL.md)
- [CLI regression tests](../tests/agent-session.test.ts)
