# Agent sessions for devenv

Project-scoped Git worktrees for concurrent coding agents. Includes `agent-session`,
its executable shorthand `as`, and dynamic Bash, Zsh, and Fish completions.

## Adopt in a project

Add to `devenv.yaml` (reuse an existing input for this repository if present):

```yaml
inputs:
  nixos-config:
    url: github:behaghel/nixos-config
    flake: false
imports:
  - nixos-config/modules/flake/agent-session
```

Enable in `devenv.nix`:

```nix
agentSession.enable = true;
```

Add `/.worktrees/` to `.gitignore`. Commit project setup before creating sessions:
creation requires a clean primary checkout on the upstream remote's default branch.
The remote tip is fetched for creation; `list --inspect` fetches only with explicit `--refresh`.
The default agent is `pi`, which must be available in your environment.

```sh
as my-task create                   # prepare without launching a nested agent
as my-task start                    # prepare and launch Pi
as list                             # recent-first creator-session tree
as list --json                      # cheap recorded-binding inventory
as list --inspect                   # live Git/binding table for all sessions
as my-task list --inspect           # the same table for one session
as my-task launch                   # launch in an existing worktree
as my-task resume                   # creator conversation, or latest own conversation for roots
as my-task cd                       # change the current shell's directory
as my-task run bun test             # run devenv -q shell -- bun test there
as my-task branch create feat/work  # create and record ownership; no checkout
as my-task finish --dry-run         # preview local cleanup
as my-task finish                   # guarded local cleanup, with confirmation
```

## Command grammar and migration

Both `as` and `agent-session` use `<slug> <command>` for session-scoped actions.
Repository-wide commands remain command-first: `as list`, `as list --inspect`, `as doctor`,
`as finish --all|--gone`, and `as completion bash|zsh|fish`.
`as <slug> finish --all --dry-run` previews only that recorded session tree;
`as finish --all --dry-run` retains repository-wide scope.

Command words, including retired `status`, stay reserved in the first position so old calls cannot
be mistaken for an action on a differently named session. To address an existing
session whose slug is a command word, put `--` before the slug:

```sh
as -- status create
as -- status cd
as -- status run bun test
```

The separator is valid for any slug. Legacy forms such as `as create my-task` and
`as status my-task` fail with migration hints before any Git mutation or execution.
Update scripts and their pinned input together; older pins keep their old grammar.
Existing non-PR session records and cleanup receipt schemas remain supported.
Creation supports both preview JSON and an actual creation receipt.

`status` is removed, not an alias. Replace `as status` with `as list --inspect`
and `as <slug> status` with `as <slug> list --inspect`. Refresh and exact-path
inspection require `--inspect`; scoped `list` also requires it. Old calls fail
with migration guidance before inspection or mutation. The recorded-inventory,
live-inspection and exact-resource JSON payload shapes remain unchanged; update
script invocations with the provider pin. A session named `status` remains usable
through the explicit escape, for example `as -- status list --inspect`.

Session metadata remains in the shared Git directory at
`agent-session/sessions/`. Existing Herbert sessions need no data migration.
Cleanup preserves remote assets and refuses unsafe work unless explicitly forced.
Interactive cleanup uses Node-compatible confirmation for normal, forced and bulk
finish. Only `y` or `yes` (case-insensitive) confirms; empty input, EOF, or a failed
prompt cancels without cleanup. Non-terminal calls require explicit `--yes`.
`--yes` skips only confirmation, not ownership or cleanup safety checks.

## Recording local engagement

`as <slug> activity touch` records the current time as local engagement for an
existing, verified managed worktree. `as . activity touch` selects the current
managed binding, including from nested directories. Success is silent. There are
no timestamp, force, approval, or JSON arguments, and no network requests.

The command takes the lifecycle lock, revalidates the worktree, and updates only
`lastWorkAt`. Existing operation leases, interruption history, identity, branches,
and work are preserved. Missing or unregistered worktrees are refused, not
repaired. This records engagement, not successful operation completion, and does
not acknowledge interrupted work or authorize retirement.

The `devenv-workflow` Pi extension calls this command on session entry and
qualifying completed messages. It passes only the current working directory;
conversation contents and Pi history are never copied into session metadata.
Older launchers or failed writes produce a warning without stopping the Pi
conversation or automatically upgrading tools. Retry a later message after
fixing the launcher/environment; ordinary primary or unmanaged contexts stay
quiet. The extension must be loaded from the intended package source; changing a
project pin alone does not update personal Pi resources.

## Interrupted activity recovery

Managed launch/resume/run records start and normal completion. An abrupt stop may
leave `activeOperations` entries whose recorded process is absent. Those entries
remain uncertain activity, not proof that a job or its side effects completed.
Non-forced cleanup refuses them; polling and `doctor` never silently erase them.
Single-session `finish` and its preview use the same managed-operation and
same-user cwd inspection as batch cleanup. Clean Git state alone is not enough:
processes in the worktree or any nested directory block removal, and incomplete
process evidence is a refusal rather than an assumption of inactivity. Apply
rechecks after confirmation and expensive validation, immediately before native
removal; `--yes` and earlier receipts cannot waive the check. Blocked previews
emit no approval receipt. Operations and resources are retained without killing
processes or acknowledging interruptions. This does not detect every editor,
detached job or remote writer, and does not change explicit force semantics.

```sh
# From the primary checkout or another worktree, not inside my-task:
as my-task doctor --json
as my-task activity reconcile --dry-run --json  # inspect, no mutation
as my-task activity reconcile                  # review, then confirm [y/N]
```

Reconciliation reviews all unsettled operations for the selected session and
requires explicit terminal confirmation. It accepts only same-host recorded
PIDs proven absent (`ESRCH`), with complete same-user cwd evidence and no process
inside that worktree. Live PIDs (including possible PID reuse), foreign hosts,
permission/unknown probe failures and incomplete process observations block it.
Never kill a process merely because an old record mentions its PID.

The record and native worktree must have verified same-user ownership, a unique
binding, and unchanged metadata, filesystem identity and configuration. After
confirmation, the CLI acquires the lifecycle lock and rechecks that scope and all
activity evidence. New/changed operations or process evidence refuse the write.
Empty input, No, EOF, or failed confirmation changes nothing. `--yes`, `--force`
and automation apply receipts are not supported; `--json` is preview-only.

Approved records move to the optional `acknowledgedInterruptions` array in the
same session metadata, retaining their original ID/PID/host/start fields and
adding `outcome = interrupted` and an actual `acknowledgedAt` timestamp. Existing
acknowledgements are retained, `lastWorkAt` is unchanged, and no successful
completion time is invented. This history shares the session metadata lifecycle;
it is not a separate permanent log surviving approved session retirement.

Reconciliation neither removes worktrees/branches nor alters their ownership.
It does not waive dirty-state, artifact, lock, process or other cleanup guards,
and cannot establish that detached work elsewhere finished. Retry cleanup as a
separate reviewed action only after reconciliation. With no unsettled records,
reconciliation is a no-op. `repair` restores missing records; it is not activity
recovery and must not overwrite an existing record.

`doctor` reports interrupted, foreign-host and unknown operations as errors with
recovery/inspection guidance. A currently existing PID is reported as information,
not proof of safe cleanup; acknowledgements are shown as history, not completion.

## Branches used in one worktree

`as <slug> finish --branches` reviews one recorded worktree and the local branches
found in its saved initial/current branch, recorded branch creations and retained
HEAD checkout history. It does **not** select descendant sessions; `--all` retains
that separate meaning.

```sh
as my-task finish --branches --dry-run --json  # read-only discovery
as my-task finish --branches                 # interactive approval
as my-task finish --branches --keep-branch   # remove worktree, preserve refs
```

Checkout history is candidate-discovery evidence, **not proof of ownership**.
Reflogs may expire, branches may be renamed or recreated, and deleted refs may
appear in the list. The preview reports this limitation, candidate sources and
current tips. Previews and the final plan use `delete:` or `preserve:` according
to the effective branch request; preservation is the built-in default. Branches blocked
from deletion are always labeled `preserve:` with their reason. The preview
never promises exhaustive history or silently adopts branches.

The operator requests eligible deletion with `--delete-branches` or a personal
interactive preference, explicitly including candidates without recorded ownership
in this mode. The final plan states what will be removed and asks once for
confirmation (default No). `--keep-branch` overrides every deletion request. Non-terminal removal,
`--yes`, `--expected`, `--force`, `--all` and `--gone` cannot be combined with this
mode. `--json` is available only for read-only previews, not as an apply receipt.

This path supports legacy records and a different currently checked-out branch
without inventing ancestry or branch ownership. It requires the uniquely bound
native worktree to match its recorded path and preserves all other guards:
clean tracked/untracked state, approved ignored artifacts, native locks,
submodules, managed activity and same-user process cwd evidence. Detached HEAD,
missing or ambiguous resources remain blocked. Only the selected worktree is
removed, non-forcibly, after scope is rechecked under the operation lock.

Branches qualify for deletion only when their reviewed tips are ancestors of the
local default/PR-base ref. Primary/default/base branches, shared session references,
external checkouts, missing local refs/bases and unmerged commits are preserved
with reasons. Squash merges without ancestry proof are not treated as merged.
Remote refs and worktrees outside the selected path remain untouched.

The post-confirmation recheck binds the worktree, metadata, policy, retained
history, branch tips and merge base. Branch deletion starts only after confirmed
native removal and metadata cleanup, and uses the shared compare-and-delete ref
transaction. A changed tip/base or new session reference refuses deletion and
stops later deletions. Failure after native removal is reported as partial or
uncertain; no automatic rollback, force fallback or replay authorization is
implied. Inspect interrupted cleanup before taking further action.

## Session-tree ownership and guarded finish

```sh
as parent create
# From parent's managed worktree:
as child create
# From child's managed worktree:
as grandchild create
# From another checkout, outside the selected tree:
as parent finish --all --dry-run --json
```

New session records have a unique `sessionId` and a `parentSessionId`: `null`
means creation from the primary checkout; creation from a verified managed
worktree records that session's ID automatically. Creation and `start` use the
same ownership recording. Reusing a slug creates a new ID and never adopts the
previous session's surviving descendants. Reusing an existing PR session retains
its identity and parent. Directory nesting and names do not determine ownership.

A recursive preview emits resources in descendants-first order, excludes
unrelated sessions and modifies no assets. JSON uses `mode: "session-all"`,
`sessionId`, ordered `plans`, `skipped` reasons and `resources` with execution
guards. Each plan includes the worktree path, parent ID, recorded owned branches
and artifact-disposal evidence. Lost branch evidence and an unclaimed current
branch appear as `unresolvedBranches`, never as cleanup authority.

Interactive recursive cleanup needs no receipt to copy:

```sh
as parent finish --all
# Review the selected tree and eligible/preserved branches.
# Branches are preserved by default; --delete-branches requests eligible deletion.
# Review the final removal plan.
# Remove these local session assets? [y/N]
```

There is no separate branch question: `--delete-branches` or the effective
personal preference requests eligible deletion, and `--keep-branch` always wins.
The final confirmation defaults to cancellation; empty input,
EOF and failed confirmation never approve removal. Non-terminal calls cannot
use this interactive path, and `--yes` alone does not replace receipt approval.

Only exclusively owned branches whose creation evidence is still verified and
whose approved tip is an ancestor of the **local** default/base branch qualify
for deletion. A missing local base, unmerged work (including squash-merged work
without ancestry proof), unclaimed ownership or an external checkout preserves
the branch with a reason. Primary/default/base branches are never candidates.
Shared ownership claims still block tree cleanup entirely, as described below.
No fetch is required; this conservative check uses the displayed local base ref.

Branch deletion starts only after every selected worktree has been removed.
The CLI rechecks ownership, claims, checkout state, merge-base revision and tip
before cleanup and again before each branch deletion. A Git ref transaction
verifies the approved merge base and compares-and-deletes the approved tip
atomically. A refusal stops later branch deletions
and is reported as partial completion; already removed worktrees are not restored.
Branch-deletion approval exists only for this terminal invocation, not in the
branch-preserving receipt. After an interruption, inspect remaining resources
rather than assuming that replaying a receipt resumes branch deletion.
Remote refs are never deleted.

For automation, branch-preserving recursive execution requires a matching tree
receipt and explicit approval:

```sh
as parent finish --all --keep-branch --dry-run --json
# Review the selected worktrees, branches, artifact scopes and blockers.
# Only after separately approving this exact selection:
as parent finish --all --keep-branch --expected <receipt> --yes --json
```

A fully resolved metadata-v3 tree with no blockers receives a top-level
`receipt` beginning `tree-v1.` and `executionSupported: true`. Otherwise no
execution receipt is issued. Preview with `--delete-branches` remains available
for inspection. Automated recursive branch deletion and recursive `--force`
are not supported.
Single-session and inactive-batch receipts cannot authorize a recursive finish.

Conflicting branch claims appear in `sharedBranches` with every claiming session
and are excluded from the plan's exclusively owned branches. They withhold an
execution receipt, even if a claimant has stale or missing creation evidence.
Apply checks the current catalogue again: a shared claim added after preview
also refuses removal. Duplicate worktree bindings remain blocked by native/physical
identity checks. Claims are not proof of ownership, and neither a shared resource
nor another record is silently deleted to resolve ambiguity.

Apply rechecks the complete selected tree before any native removal and freshly
rechecks each target before its turn. Changed ownership, descendants, commits,
configuration, artifact metadata, dirtiness, native locks, uncertain/live managed
operations and unavailable or live same-user cwd evidence refuse cleanup.
Explicitly selecting a tree does not impose an inactivity cutoff; it does not
waive activity guards. Process observation has the same limits as inactive-batch
finish: it cannot detect editors with cwd elsewhere, other users or remote use.
Receipt-based automation preserves all branches. Interactive branch deletion
requires the separate choice and final confirmation above. Native worktree
removal is always non-forced.

Execution stops on the first refused or uncertain target, preserving all later
targets including its ancestors. Results distinguish `success`, `partial` and
per-resource outcomes. A durable journal binds started removals to the receipt.
Replaying the same approved receipt may reconcile uniquely unchanged residual
metadata only after filesystem and native-registration absence are confirmed;
it does not repeat a confirmed native removal or broaden the selection. Changed
or ambiguous evidence requires a fresh review, not force or registration pruning.
A preview does not authorize deletion. Ownership changes during a partial run
report the approved and current parent, leaving the affected resource and later
ancestors intact. A completed receipt cannot apply to a replacement session
created under the same slug.

Older records without identity/parentage remain usable through existing commands,
but their ancestry is reported as unknown and they are excluded from recursive
selection. Creation from a legacy parent is refused rather than inventing its
identity or ancestry. An explicitly reviewed [legacy mapping](#reviewed-legacy-mappings)
is required; there is no automatic migration. Missing ancestors are reported and preserved;
duplicate identities, incomplete identity fields and ownership cycles fail closed.
Remote branches remain untouched.

## Reviewed legacy mappings

The human explicitly declares each legacy record to be a root or the child of
an already mapped parent. The tool never reconstructs ancestry from names,
checkout history or directory nesting. Map parents first:

```sh
as old-root ownership --root --dry-run --json
# After reviewing and approving that exact mapping:
as old-root ownership --root --expected <ownership-receipt> --yes --json
as old-child ownership --parent old-root --dry-run --json
# After separate review and approval:
as old-child ownership --parent old-root --expected <ownership-receipt> --yes --json
```

The top-level `ownership-v1.` receipt binds the worktree's physical/native
identity, metadata, current saved initial branch, HEAD/reflog evidence,
configuration and declared parent ancestry. Apply rechecks the same declaration
under the repository operation lock. The reviewed stable ID is retained, including
an existing recorded ID; known ancestry cannot be changed into a transfer.
Duplicate IDs, cycles, unresolved parents, shared branch claims, conflicting saved
branches and recorded managed activity refuse mapping. Already mapped v3 sessions cannot be remapped.

Apply upgrades the one legacy record to schema v3 and records only its saved
initial branch's existing ownership disposition. An owned initial branch receives
a unique reviewed-incarnation marker via `git reflog write`; its ref never moves.
Borrowed branches receive no ownership record or marker. Other plain-Git branches
are not adopted. Dirty files, commits, branch refs, worktrees and remote resources
remain unchanged. Git without `reflog write` support cannot map an owned initial
branch; metadata remains unchanged if that command fails. If metadata persistence
cannot be confirmed after a marker was appended, inspect status and obtain fresh
review; the marker alone is not a completed mapping.

Preview is read-only. Mapping approval is not retirement approval, does not
approve artifact disposal and cannot substitute for a single-session, tree or
batch retirement receipt. This command does not repair missing/ambiguous bindings,
transfer ownership, import renamed branches or silently upgrade an installed CLI.

## Explicit branch ownership

```sh
as . branch create feat/work       # create at this session's HEAD; no checkout
# Switch separately if needed:
git switch feat/work
```

Use `as <slug> branch create <name> [--json]` for a named session. The command
creates a new local branch and records its ownership under the session's stable
ID. New sessions use metadata schema version 3, which older CLI builds reject
rather than interpreting with their earlier ownership inference. Legacy version
1/2 records remain readable; there is no automatic migration.
Existing local branches are refused, not adopted. It does not switch branches,
copy dirty files, configure upstreams or touch remote branches. Session creation
records its newly created initial branch too; a borrowed PR branch is excluded.

Plain Git branch creation, checkout and rename do **not** establish ownership.
Status and cleanup no longer infer additional owned branches from names,
timestamps or checkout/rename history, including on legacy sessions. Legacy
records retain only their explicitly saved initial branch disposition; the new
branch command requires identity and branch records and refuses silent migration.

A recorded branch also needs its unique creation marker in its own Git reflog.
The marker verifies an already-recorded creation; it never discovers ownership
from Git activity. Later commits do not invalidate it. Deleted/recreated names,
manual renames and expired or missing creation evidence are not adopted. Such
resources remain unclaimed or unresolved and are preserved; an unclaimed current
branch blocks guarded retirement. This applies to individual cleanup as well as
recursive previews. The branch command rejects reuse of an earlier recorded name.

## Completion scope guidance

`as <session> finish --all` selects recorded descendants of that session;
`as finish --all` selects repository-wide sessions. Zsh and Fish completion
menus describe the different `--all` scopes. Bash retains plain flag insertion;
its generated completion source and CLI help explain the distinction without
inserting description text into commands. Fish registration replaces stale
assembler completions for the installed `as` alias.

## Personal defaults and branch disposition

Optional personal defaults are read from
`$XDG_CONFIG_HOME/agent-session/config.json`, or
`~/.config/agent-session/config.json` when XDG is unset, empty or relative.
No project-level override is searched. The file is read-only to the CLI and
supports two optional keys:

```json
{
  "color": "auto",
  "branches": "preserve"
}
```

Colour values are `auto`, `always` and `never`; an absent colour key defaults to `auto`.
Explicit `--color` flags override the file. Nonempty `NO_COLOR` suppresses personal
colour settings, including configured `always`; only explicit `--color=always`
opts back in. Configured `always` can colour redirected human output when
`NO_COLOR` is empty. Colour never changes state words or cleanup scope.

Branch values are `preserve` (the built-in default) and `delete` (a request for
eligible deletion, not consent). Personal branch requests apply to single-session,
recorded session-tree and historical-review previews and interactive cleanup.
Repository-wide `--all`/`--gone` and inactive batches do not inherit them; use
explicit branch flags where the selected mode already supports deletion.
`--keep-branch` overrides both `--delete-branches` and the personal setting,
regardless of argument order. Existing ownership, publication/ancestry, process,
artifact, binding and native checks still apply; an ineligible request may refuse
cleanup rather than weaken a guard.

Every automated `finish --yes` must state `--keep-branch` or `--delete-branches`.
Automation never inherits personal branch defaults. Receipt-based single/tree
apply still requires explicit `--keep-branch`; no automated guarded-deletion
protocol is added. Unrecorded cleanup and inactive batches always preserve refs;
`--delete-branches` cannot expand their authority.

JSON ignores colour preferences. Scope previews can reflect personal branch
requests unless flags explicitly choose a disposition. Completion, `cd`, `run`
and other protocol output do not consult these settings. Malformed JSON, invalid
types, unsupported settings and unreadable files stop normal preference consumers
before work, without printing file contents. Explicit colour and branch flags
bypass their respective defaults for diagnosis. This file cannot configure
verbosity, force, consent, project policy or agent/child commands.

## Human inspection output

`list` (including `--inspect`) and `doctor` accept `--color=auto|always|never` and `--verbose`.
Colour is automatic on capable terminals, respects nonempty `NO_COLOR`, and
never replaces state words. Explicit `always` opts into colour even in a pipe;
`never` disables it. JSON remains unstyled and has no new progress events.

Human inspection announces activity before discovery and updates one temporary
line while checking sessions. That line clears before the durable result.
Redirected output gets one plain notice on stderr. Plain inventory and doctor
views may stack entries on narrow terminals. `list --inspect` always retains a
table with a `STATE` column: secondary branch display shortens with `…` when
needed, while full session names and state wrap within their columns on smaller
screens. Verbose details retain the full current branch, and redirected tables
do not shorten branch values.

`list --inspect` shows `SESSION`, `BRANCH` and `STATE`, followed by counts, using
the same table for one or many sessions. When PR sessions exist it adds a compact
`PR` number/recorded-state column; selected PR sessions retain their full link and
base. PR state is not requeried from GitHub. `list --inspect --worktree <path>`
shows a resource table with path and evidence classification. `--verbose` retains collection paths and full PR links,
initial/owned branches and full problem explanations rather than appending them
to every default report. Attention counts
refer to the displayed Git/binding state, not cleanup eligibility or proof that
all activity has completed. Inspection stays offline by default; `--refresh` retains
its explicit remote-refresh behaviour.

## Human single-session cleanup output

`as <slug> finish` and its previews accept `--color=auto|always|never` and
`--verbose`, with the same colour policy as inspection. These flags are not
supported with `--all`, `--gone` or `--branches` selectors.

Human previews and confirmation plans show `ASSET`, `ACTION` and `DETAIL`,
including exact worktree and record paths, owned/borrowed branch disposition and
approved artifact roots. Directory approval covers the whole subtree, including
logs and task databases; link targets and remote assets remain preserved.
Very narrow terminals may stack cells, never shorten the approved paths.

The default-No confirmation retains its existing permission and revalidation
checks. After approval, the same table changes from proposed actions to live
outcomes, ending with confirmed resource states and counts. Reuse requires a plan
that fits the unchanged terminal and a verified ordinary prompt echo. If those
positions cannot be established safely (including redirected, resized or verbose
output), the plan remains in scrollback and execution follows below it instead.
Terminal-mode queries are read-only; cleanup never changes the user's echo mode.
Short viewports show a compact live window, then the complete final result;
resizing never clears unrelated scrollback. Redirected output is plain
and append-only by default. Successful Git chatter is hidden unless verbose.
A failed native operation leaves affected resources `Uncertain`, not presumed
intact or removed, and retains the original available diagnostic. Confirmed
removals and unattempted actions remain distinct after partial cleanup.

Ordinary human previews end with `Nothing changed`, without receipt tokens or
replay hints. Supported automation still reads the unchanged full JSON plan and
receipt from `--dry-run --json`. Presentation does not change deletion eligibility, force semantics or consent;
branch defaults and explicit requests are described above.

## Recorded-binding inventory

`as list [--json] [--verbose] [--color=auto|always|never]` reads recorded session
bindings without inspecting checkout
Git state, refreshing remotes, or running preparation or agent commands. Text
output is an aligned `SESSION`, `BRANCH`, `LAST ACTIVE` table with `tree`-style
connectors for recorded Pi creator relationships. Parents precede their children.
Each node displays the newest activity in its subtree; roots and sibling sets
sort by that time, newest first, with session names breaking ties. Activity
reflects locally recorded
creation and managed start/launch/resume/run start and completion, including
failed commands; listing and status polling never advance it. With the
`devenv-workflow` Pi extension loaded and a supporting launcher, Pi session entry,
user messages and visible assistant responses also record local engagement while
Pi stays open. Tool-only and thinking-only messages, streaming updates, tool
results, and idle time do not independently advance it. Commits made outside
managed commands are not yet observed.

Activity is shown as a relative age below seven days and a local `YYYY-MM-DD`
date thereafter. Narrow terminals stack entries with wrapped fields, preserving
full session names, branches, activity and creator connectors. `--verbose` adds
the recorded worktree path without querying live checkout state. Piped output
retains the aligned table with full names, no truncation and no automatic colour.

JSON uses the same parent-first traversal, with unprefixed slugs, no nesting,
and no added relationship or activity fields. It remains
one document with `version: 1`, `command: "list"`, and `sessions`, each containing
only `slug`, `branch`, and `worktreePath`. `branch` is the recorded **initial**
branch, not an observation of the current branch, ownership, or clean state.
Use the selected `slug` with `as <slug> list --inspect --json` and guarded `finish` for
fresh inspection and cleanup; inventory alone never authorizes removal.

The inventory includes valid records whose checkout is missing, but not
unrecorded Git worktrees. An empty inventory therefore does not prove a resource
is absent: consumers also check native Git registration and the filesystem.
Malformed, unreadable, or unsafe records fail the whole inventory before any
inventory rows are printed rather than silently omitting potential bindings. A dangling metadata
store is not reported as an empty inventory. Listing does not repair records,
prune registrations, or remove files. It accepts `--json` and presentation flags,
not `--refresh`, and is repository-wide rather than a session action.

## Creator conversations and resume

When Pi creates a worktree from a managed parent, the CLI can record an optional
`creatorConversation` containing the parent's stable session ID and the exact Pi
conversation ID/file. Pi's agent-run Bash/PowerShell commands supply
`PI_SESSION_ID` and `PI_SESSION_FILE`; the CLI checks only the bounded JSONL
header against the verified invoking worktree. It never scans conversation
entries or guesses a creator from the most recent file. Custom session storage
locations work through the explicit locator.

```text
SESSION       BRANCH        LAST ACTIVE
parent        agent/parent  2m ago
└── child     agent/child   2m ago
```

`as child resume` reopens that exact creator conversation in the parent's
worktree, using Pi's `--session` argument rather than the child's `--continue`.
A newer conversation in the parent does not replace the recorded creator.
Missing/replaced conversations, unavailable parent worktrees, and changed parent
identity are errors; no substitute conversation is launched. `as child launch`
still launches inside the child.

Without creator information, listing treats a binding as a root and `resume`
keeps its own-worktree `--continue` behavior. This covers legacy records and shell
`create`/`start`, even from another managed worktree. Pi's user-entered `!`/`!!`
commands do not receive its shell-tool session variables and use that same
shell fallback. A stale/inherited context whose header names a different
worktree cannot establish a creator association.

Creator provenance is separate from `parentSessionId`, which continues to govern
resource ancestry and guarded recursive cleanup. Shell-created or legacy entries
can be roots in this listing while remaining resource descendants for cleanup.
Rollup changes no stored timestamps. `batch finish --inactive-for` uses that same
rolled-up activity for its age cutoff, including excluded descendants. Missing
creator parents do not hide their
children from inventory or erase known provenance; resume still refuses the
unavailable origin. Slug reuse never adopts an earlier parent's conversation.

## Exact-resource inspection

```sh
as list --inspect --worktree /absolute/path/to/.worktrees/my-task --json
```

Exact inspection runs from another checkout of the same repository, even when the
selected directory is missing. The path must identify a configured managed slot.
It reads the binding catalogue and shared native worktree registration list,
then only the selected checkout's Git state. Unrelated checkout status and
reflogs are not queried. A directory-name convention alone does not identify a
binding: duplicate/moved path claims are inconsistent, and incomplete catalogue
evidence is unknown rather than proof of absence.
Relative paths resolve against the calling directory; aliases are canonicalized.
`--worktree` cannot be combined with a slug or `--refresh`.

JSON includes `worktreePath`, `resourceState`, `evidence`, `bindingSlugs` and `sessions`:
- `present`: directory, managed metadata and native registration agree. The one
  selected session's ordinary status reports cleanliness and branch state.
- `absent`: the configured slot has no directory, managed record or registration.
  Branches may still exist; absence does not mean commits were deleted.
- `inconsistent`: evidence disagrees (including stale metadata/registration,
  unrecorded directories or a branch conflict). No absence is inferred.
- `unknown`: evidence cannot be established, for example malformed metadata,
  inaccessible paths, dangling target symlinks or paths outside configured slots.

`evidence` exposes `filesystem`, `metadata` and `registered` observations; values
not established remain `"unknown"` or `null`. A successful JSON response can report
any resource state: consumers must examine `resourceState`, not just exit status.
These observations are not cleanup authorization. Neither command fetches,
repairs, prunes, removes resources, starts an agent or updates session metadata.

## Known local links and non-forced retirement

Single-session `finish`, legacy bulk finish and inactive-batch finish share the
same ignored-data guard on their non-forced paths. An unchanged configured
`agentSession.localLinks` symlink does not count as unknown ignored data when it
points to its expected path in the primary checkout. Retirement removes only the
workspace link as part of native worktree removal; it never traverses or deletes
the link target. Targets may be files, directories or missing: target existence
and contents are deliberately not inspected. Optional configured links that are
absent in the workspace do not require repair before cleanup.

Verification uses the configured relative path, actual symlink destination and
same-filesystem, non-symlink parent chain. A regular-file replacement, redirected
link, unsafe ancestor or unverified inspection blocks removal. A relative link to the same
expected primary path is recognized, but rewriting/replacing a link after a
preview still changes its receipt evidence.

Non-forced single previews expose `plan.ignoredData`; batch resources expose
`ignoredData` whenever a batch resource has verified physical checkout identity,
even if other guards fail. The evidence contains `safe`, `complete`,
`configuredLinks`, `generatedLinks`, `ignoredPaths`, `unapprovedPaths` and `blockers`, plus
workspace/link filesystem identities. Configured-link states are `verified`, `missing`,
`mismatch` or `unsafe`. Link and ancestor identity/timestamps/destinations—not
primary target contents—are bound into single-session receipts and batch
fingerprints. Apply rechecks the evidence; single finish also rechecks after
interactive confirmation. New ignored data or changed link evidence requires a
fresh preview, not a force fallback.

Devenv-owned defaults are declared by the integration below, not inferred from
familiar names or arbitrary Nix-store targets. Other unconfigured symlinks,
`node_modules/`, `coverage/`, `.pi/npm/`, databases and ignored local data block
non-forced retirement unless explicitly covered by project policy. Direct single-session
`finish --yes` cannot bypass either the data guard or artifact receipt approval;
it may refuse workspaces that older versions removed.

Obtain fresh previews for present worktrees after upgrading: older receipts did
not bind this evidence and cannot authorize removal under the new guard. Existing
interrupted-batch reconciliation still requires confirmed native/filesystem
absence and unchanged residual binding/branch evidence before metadata-only
completion. Explicit forced-cleanup semantics are unchanged and are not an
automatic recovery mechanism for an ignored-data refusal.

## Explicit artifact-disposal policy

The devenv integration provides two practical defaults:

| Scope | Default authority |
| --- | --- |
| `.devenv` | Whole workspace scratch subtree, including task databases and diagnostic logs. |
| `.pre-commit-config.yaml` | Symlink only, matching the exact current project `git-hooks.configFile` target when git-hooks is enabled. |

`agentSession.disposablePaths` defaults to `[ ".devenv" ]`. An explicit list
replaces that policy; include `.devenv` if retaining the default while adding
other exact workspace-relative paths:

```nix
agentSession.disposablePaths = [ ".devenv" "node_modules" "coverage" ];
```

Generated hook recognition is separate from ordinary path disposal. It compares
the actual link destination with the project's declared generated target; neither
the filename nor an arbitrary `/nix/store/…` target is sufficient. Missing links
are allowed. A regular-file replacement, redirected link or unsafe ancestor
blocks cleanup, even if a broader disposal path covers it. Neither the generated
target's existence nor its contents are inspected or changed. A changed/stale
hook target requires review, not a prefix-based exemption.

When git-hooks is absent or disabled, no generated-hook authority is declared.
Set `agentSession.recognizeGeneratedHookConfig = false` to disable automatic
recognition. To retain both scopes, set it false and
`agentSession.disposablePaths = []`; explicit disposal paths remain authoritative.
Intentional hand-written hook workflows must disable generated-link recognition
before separately authorizing that ignored entry. No `.pi` path is a default:
`.pi/npm` and other project-specific installations require their own policy.

This is a declaration of disposal authority, not a generated-file detector.
Paths are literal: no globs, absolute paths, empty/dot/traversing components or
`.git` components. A file authorizes that entry; a symlink authorizes only the
link, never its target. A directory authorizes its **entire subtree**, including
logs, databases, local patches and other potentially valuable data. In particular,
the default `.devenv` scope authorizes its diagnostic logs and task databases too.
Retain/move needed evidence before finishing, or replace the default with narrower
exact paths. Declaring defaults does not approve an actual retirement: terminal
confirmation or a matching automation receipt is still required.

Policy does not waive cleanliness, identity, activity, ownership or native-lock
checks, nor configured-link replacement protection. Nested policy paths require
safe non-symlink, same-filesystem ancestors. Structural parents do not authorize
siblings: `.cache/generated` is not permission to discard `.cache/other-data`.
Missing optional policy roots are recorded, not repaired or created.

Non-forced previews expose `ignoredData.policy`, `policyRoots` and
`approvedArtifacts`, alongside the existing blockers and ignored-path evidence.
`generatedLinks` reports `verified`, `missing`, `mismatch` or `unsafe` against each
declared generated target. Verified ignored generated links are classified as
`generated-link` and included in the approved artifact summary; their destination,
identity and ancestor evidence are receipt-bound just like other guarded scopes.
Each present policy root has a complete metadata-tree `fingerprint`. The digest
binds relative entry paths, device/inode identity, type/mode, uid/gid, link count,
size, nanosecond modification/change times, allocation metadata and symlink
destination text. Directory traversal is sorted; neither file contents nor
symlink-target contents are read. Missing/unsafe roots are explicit. Unreadable,
changing, cross-filesystem or incomplete trees cannot authorize retirement.

Artifact disposal requires **both policy and approval of the inspected scope**.
For a human at a terminal, use one command:

```sh
as task finish --keep-branch
```

It inspects the target, shows the exact worktree, branch disposition and approved
artifact roots, and asks once. The CLI binds that observation internally; there
is no receipt to copy. It rechecks after confirmation and refuses changed
metadata, commits, policy or artifact evidence. No/empty input/EOF cancels without
removal. Built-in behaviour preserves branches. `--delete-branches` or a personal
interactive request selects the existing eligible-deletion path; `--keep-branch`
always overrides it. The selected disposition is shown before final approval.

For automation, use the existing branch-preserving receipt workflow:

```sh
as task finish --keep-branch --dry-run --json
as task finish --keep-branch --expected <receipt> --yes
```

The first response provides `plan.receipt` and
`plan.artifactDisposalRequiresReceipt` (the automation requirement). Human
`finish --dry-run` previews show scope and disposition without raw receipts or
replay hints. `--json` remains one machine-readable result with the complete
receipt; public automation receipts still require `--keep-branch`.

Direct `finish --yes` requires an explicit branch flag, even on a terminal.
Approved artifacts still require a matching receipt with explicit `--keep-branch`. Piped stdin does not confer human
approval. Legacy bulk finish cannot use one global confirmation to authorize
artifact disposal and still skips/refuses it; use single-session approval or
inactive-batch preview/apply instead. Inactive batch requires its selection
receipt and explicit `--yes`.

Both guarded paths bind policy, root states and recursive metadata fingerprints
into their receipts and freshly validate them before native removal. A changed
policy, deep entry, restored content/mtime with changed ctime, renamed/replaced
entry or newly observed unapproved data requires fresh inspection/approval.
Single finish also rechecks after interactive confirmation, without repeating
full-tree walks merely to calculate a receipt. Artifacts are never pre-deleted
to make Git accept removal; all guards precede non-forced native worktree removal.
Automated artifact receipt workflows preserve branches. Neither interactive nor
automated retirement modifies remote assets.

Metadata fingerprints are change detection, not cryptographic content-integrity
proof or a filesystem reservation. They do not hash dependency contents, freeze
unmanaged writers or guarantee reclaimed space. Explicit ownership exclusions
and a quiet target remain necessary. Forced-cleanup semantics are unchanged;
there is no automatic force fallback.

## Inactive-session retirement

```sh
as batch finish --inactive-for 7d --exclude retained-task --dry-run
```

Human preview announces `Discovering sessions` before collecting the namespace
and activity snapshots, then shows a creator-tree table with `SESSION`,
`LAST ACTIVE`, `PLAN` and `REASON`. On capable terminals, rows update in place from `Waiting` to `Checking`
and then `Would remove` or `Would preserve`. Identity and row order stay stable;
inspection order remains independent of creator-tree display order. The final
summary retains every candidate, including excluded/unknown names, and gives
eligible/retained counts followed by `Nothing changed`.

A short primary reason and `(+N)` identify retained resources. Default output ends
with the table and counts, without a diagnostic appendix or receipt hint. Add
`--verbose` for dirty paths and process/recovery details below the summary; JSON
is not required to inspect blockers. Narrow terminals use stacked entries
with wrapped text and full identities. Oversized live displays stay within the
viewport and show the current inspection/count; the final output includes all
results. Resizing starts a fresh display block rather than risking unrelated
scrollback. Piped output is append-only with full text and no cursor controls.

Batch colour uses `--color=auto|always|never`. Automatic colour
requires a capable terminal and respects nonempty `NO_COLOR`; explicit `always`
opts in even for redirected output or when `NO_COLOR` is set. Colour supplements
state words, never replaces them. `--color=never` disables colour, not in-place
terminal updates. JSON results and progress events are never styled. Both human preview and receipt-approved apply use these colour controls and
`--verbose`.

The raw approval receipt is not printed in human mode. Add `--json` for the full
receipt and structured inspection evidence. This performs a fresh preview, so review that selection
before authorizing its receipt; human output itself does not authorize removal.
No shortened receipt alias or saved preview state is introduced.

`--dry-run` is a **read-only preview**. `--inactive-for` is required;
positive integer durations use `s`, `m`, `h`, `d` or `w`. Repeat `--exclude <slug>`
for resources retained by you or another owner. Exclusions are explicit per call,
not persisted ownership declarations. Branch preservation is unconditional;
`--keep-branch` is accepted for clarity. There is no batch force option.

JSON `resources` reports each recorded/discovered session's exact slug, path when
established, and eligibility/refusal `reason`. Excluded names remain visible even
when no record exists. Verified worktrees expose activity and inspection evidence
even when blocked; `reason` is the primary refusal while `blockers` lists all
observable refusals. `observedAt` and `cutoff` define the explicit observation window.
Preview also returns an opaque `receipt` freezing only the eligible selection.
Apply requires that receipt, the same duration and exclusions, and explicit
`--yes`; no newly eligible resource is added during apply:

```sh
preview=$(as batch finish --inactive-for 7d --exclude retained-task --dry-run --json)
receipt=$(printf '%s' "$preview" | jq -r .receipt)
as batch finish --inactive-for 7d --exclude retained-task \
  --expected "$receipt" --yes --json
```

Human apply announces inspection before checking the approved context, then shows
stable `SESSION`, `STATE` and `REASON` rows. Approved targets move from `Waiting`
through `Checking` and, only when native removal is attempted, `Removing`.
Durable outcomes are `Removed`, `Already absent`, `Refused` or `Uncertain`, with
counts and an explicit branch-preservation summary. Default output omits routine
STARTED/COMPLETED messages, raw receipts and replay hints; `--verbose` adds approved
paths and successful check progress. Actual failures retain original diagnostic
wording in plain text, with terminal instructions removed and credential-like URL
userinfo/authorization values redacted. Live views stay bounded, fall back safely
on resize, and retain all identities in the final output; pipes are append-only.
No additional prompt or approval is introduced: the same receipt and explicit
`--yes` remain mandatory. JSON envelopes, progress events and journal/replay
semantics remain unchanged.

The receipt binds repository/configuration identity, exact selected paths,
metadata digests, checkout/Git-directory identity, HEAD, branch refs and observed
activity. It is self-contained, so preview creates no saved state. Its checksum
catches corruption; it is **not a signature or ownership authorization**. The
caller remains responsible for retained-work exclusions and consumer authority.
Treat it as opaque and obtain a fresh preview when it no longer matches.

Batch age selection uses the same own/subtree engagement clock shown by
`LAST ACTIVE`. Recent descendant engagement protects its ancestors, including when
that descendant is excluded from removal. Checkout events and file mtimes do not
supply a hidden alternative age clock.

Apply holds the provider operation lock and freshly checks each selected target's
identity, inactivity, cleanliness, ignored data and live/process evidence before
non-forced native removal. Managed work starting through `as` uses the same lock
when recording activity. Native worktree locks and submodules are also refused.
Selected creator ancestors precede selected descendants in this independent
batch, so an approved descendant removal cannot invalidate an ancestor's clock
before its recheck. This neither adds descendants to the receipt nor changes the
descendants-first order of explicit recursive `finish --all`.
There is no branch deletion, force fallback, remote/PR mutation or consumer case
bookkeeping. Local checks do not reserve the filesystem against arbitrary
unmanaged processes; ownership fences and exclusions remain necessary.

Apply JSON reports per-resource `outcome` (`finished`, `absent`, `refused` or
`uncertain`) with a `reason` and diagnostic when available. `finished` requires
confirmed directory, binding and native-registration removal; `absent` requires
all three sources to confirm absence. `success` is true only when every selected
resource is finished/absent; `partial` identifies mixed success and refusal or
uncertainty. Exit status is 0 for full success (including an empty selection),
1 for refusal/uncertainty, and 64 for invalid/mismatched receipt arguments before
any cleanup. Apply does not abort reporting after one target fails.

### Inspection evidence, size accounting and progress

Batch inspection does not stop at the first dirty, ignored, active or recent
condition. Resources with verified physical checkout identity include:
- `resource`: native/filesystem/binding evidence and logical identity state.
- `git`: actual cleanliness, porcelain changes, current branch and owned branches.
  A detached/identity-conflicting checkout may also be dirty; both are reported.
- `activity`: the shared effective `lastWorkAt`, `limitingEvidence`, creation and
  recorded-engagement observations, and the latest contributing
  `descendant:<slug>` when relevant. It retains `filesChecked` (zero for this
  metadata-only clock), `problems`, `complete` and `inactive`.
- `ignoredData`: configured-link evidence, ignored path types/classifications,
  local symlink destinations and size observations, with all data-inspection
  blockers. Paths remain `unapproved` unless verified configured links, structural
  parents, verified `generated-link` entries or policy-covered `approved-artifact` entries.
- `processEvidence`: the process observation time/source, matching cwd PIDs and
  every managed operation's observed state, including interrupted/foreign owners.
- `blockers` and `inspectionComplete`: all observable safety refusals and whether
  the applicable evidence could be established, rather than just the first one.

Explicitly excluded resources are not deeply inspected, but their recorded
engagement still contributes to their ancestors' clock. Invalid or ambiguous
bindings/native topology are not permission to traverse an unverified checkout;
those resources report incomplete inspection rather than fabricated evidence.
If activity evidence is partial, its timestamp is only the latest *observed*
value, `complete` is false and `inactive` is null. An old partial timestamp is
not proof of inactivity. Unknown process evidence also blocks eligibility while
other available worktree evidence remains visible. Apply refusals include the
fresh candidate view under `inspection` when available.

`ignoredPaths[].size` reports decimal-string `apparentBytes` and `allocatedBytes`
(the latter may be null), entry/unique-inode counts, completeness and problems.
The scope is `tree-no-follow` for ordinary directories and `entry` for symlinks,
files and structural parent-directory entries whose children are reported
separately. Directory accounting walks metadata, not file contents; it does not
follow symlink targets or descend across filesystem-device boundaries. Errors,
disappearing paths or detected changes yield explicit incomplete evidence and
block eligibility. Partial byte values are only observed lower bounds.

Allocation counts unique device/inode pairs within each reported path, not across
separate worktrees or roots. It is a footprint observation, **not guaranteed
reclaimed space**: hardlinks outside the path, shared extents, open files and
filesystem snapshots can change what retirement would actually free. Neither
size nor directory location is disposal authority. Large trees can still take
time to inspect; no fixed wall-clock completion guarantee is made.

Preview snapshots the binding catalogue/native namespace and same-user process
cwd list once, rather than repeating shared scans per candidate. The top-level
`processSnapshot` reports process-probe completeness and its observation time.
Standalone exact inspection and each selected apply target use fresh namespace
information; apply captures fresh process evidence after the target's metadata
inspection, before removal. A preview snapshot is not a reservation against
unmanaged activity.

Human batch preview/apply use updating resource rows on capable terminals and
bounded plain startup feedback when redirected; routine STARTED/COMPLETED pairs
and metadata chunks do not bury the review. `--verbose` exposes detailed check
progress. Failures remain visible. Devenv shell/task startup messages belong to
the outer launcher and are unaffected.

With `--json`,
per-resource and every metadata-scan chunk event remain versioned progress
records; stdout remains one unchanged result document. Progress completion means
a scan/chunk completed, not that a workspace was removed—only the final explicit
outcome confirms that. Observation remains read-only and does not advance managed
activity clocks, repair metadata, prune registrations or create an intent journal.

### Interrupted apply and reconciliation

Only apply writes a small per-receipt intent journal under the shared Git
`agent-session/retirements/` directory. Atomic, synced intent recording precedes
native removal; preview and observation never create or repair this state.
This records provider cleanup intent, not consumer case history.

Replay the same apply command after a process interruption:
- Confirmed filesystem, managed-binding and native-registration absence returns
  `absent`, without repeating a destructive effect.
- If recorded intent exists, the original directory and native registration are
  confirmed gone, and the unique residual metadata and preserved branch refs
  still match the preview, replay removes only that residual metadata and
  confirms `finished` with reason `reconciled-removal`.
- A present target is reconsidered only after fresh safe, unchanged-identity
  checks. A replacement checkout, changed metadata, stale native registration,
  unavailable evidence or invalid journal is refused/uncertain, not force-cleaned
  or claimed finished. Inspect the reported evidence; do not delete records or
  registrations merely to make a replay succeed.

The process-kill recovery path is tested; a power-loss durability guarantee is
not claimed. Caller bookkeeping remains a separate step after observing the
provider result.

Activity evidence:
- Managed `start`/`launch`/`resume` and `run` record work start and completion in
  shared session metadata. Failed work still counts as activity. `run` counts its
  command conservatively, even when the command itself is read-only.
- Live managed operation records block eligibility. An interrupted owner leaves
  an unresolved activity record; polling neither clears it nor invents a completion time.
  A record belonging to another host also blocks eligibility.
- Pi activity recorded through `activity touch` contributes to the same clock as
  managed work. Creator-descendant activity rolls up exactly as in `list`.
- Checkout/rebase events, working-file mtimes and index refreshes do not advance
  the inactivity clock independently. Dirty/ignored work and live/unknown process
  evidence still block disposal. Explicit non-age cleanup retains its existing
  conservative inspection evidence without adding an inactivity cutoff.
- Same-user processes whose cwd is the worktree or a subdirectory block
  eligibility. The packaged `lsof` supplies this evidence; unavailable,
  unrecognized or failed process inspection blocks eligibility.

Direct `list`, `list --inspect` and batch-preview polling update none of these clocks.
Preview does not fetch, repair metadata, prune registrations, remove resources or
start an agent. Git status inspection disables optional index writes.

**Observed inactivity is not proof of disposability.** These checks cannot see
editors with cwd elsewhere, all other-user/remote processes, or unrecorded
engagement outside managed commands/Pi messages. Explicitly exclude retained or otherwise active
work. Dirty resources, unapproved ignored local data, foreign-owned directories, the invoking
worktree and unresolved resource evidence are refused. Ignored files can contain
important local work; age alone never authorizes their removal. A clean workspace
with no such evidence may be a candidate, not permission to finish it.

## Current-session targeting

Inside a recorded managed worktree, including its nested directories, use the
explicit target `.` instead of repeating its slug:

```sh
as . list --inspect --json
as . cd
as . run bun test
as . resume
```

Resolution verifies the current Git worktree against its configured location,
persisted metadata, and shared Git registration. It does not infer identity from
the current branch name, fetch, allocate, or repair anything. The selected command
retains its normal behavior, and JSON output uses the canonical slug, never `.`.
Renaming the current branch does not change the session identity.

There is no implicit default target: `as list --inspect` inspects all sessions. `.` is
rejected from the primary checkout, unmanaged worktrees, and unrecorded or invalid
bindings. A nested Git repository is a separate context, not its outer session.
Use an explicit slug to inspect or repair missing metadata. Creation, `start`,
and `repair` require explicit slugs; `.` supports only `cd`, `run`, `launch`,
`resume`, `list --inspect`, `doctor`, and `finish`. The escape form `as -- . list --inspect` also works.

The existing invoking-worktree cleanup guard still rejects `as . finish`, even
with `--force` or `--dry-run`. Move to the primary checkout and finish by slug.
Bash, Zsh, and Fish offer `.` only for a valid current binding and filter its
action completions to existing-session commands.

## Retiring an unrecorded worktree

If a registered worktree has lost its session record, explicit forced cleanup can
retire it without inventing ownership metadata:

```sh
as my-task finish --force --dry-run
as my-task finish --force --dry-run --json
as my-task finish --force
```

This requires genuinely absent metadata and an existing, non-symlink worktree in
the configured Git-ignored slot, registered to the same repository. Locked
worktrees, the primary checkout, and the invoking worktree remain protected.
Malformed, mismatched, inaccessible or dangling records are not absence and
never enable this path. Use the explicit slug: `.` cannot identify an unrecorded
session.

**All branches are preserved**, regardless of whether `--keep-branch` was passed.
`--delete-branches` is rejected for unrecorded cleanup; a personal deletion
preference cannot supply missing ownership authority.
No branch ownership is inferred, no session record is created or removed, and no
remote is contacted. Force discards the worktree's uncommitted and ignored local
files; verify ownership, active use and needed local data before confirming.
Detached HEAD commits can become unreachable: create a branch first if needed.
After confirmation, the held operation lock protects revalidation of metadata
absence, canonical location, directory identity, Git registration, branch and
HEAD before removal. A changed target is refused rather than reinterpreted.

The JSON preview has `state: "unrecorded"`, effective `keepBranch: true`,
`allBranchesPreserved: true`, `ownedBranches: []`, `initialBranch: null`, and
`clean: null` (cleanliness is not assessed). It exposes the observed `head` and
`currentBranch` plus `uncommittedWorkWillBeDiscarded` and
`detachedHeadMayBecomeUnreachable`. Preview changes nothing and supplies no
recorded-session receipt. `--expected` remains restricted to non-forced,
branch-preserving recorded cleanup; no fallback weakens that contract.

This path is explicit-slug-only: `finish --all` and `finish --gone` still consider
recorded sessions exclusively, including when forced. Existing recorded-session
force behavior is unchanged. `repair` continues to restore only recognizable
original managed branches; for renamed/detached unrecorded slots it refuses to
invent history and instead prints the guarded preview/retirement commands.
Metadata repair does not recreate local configuration links.

## Read-only diagnostics

```sh
as doctor
as doctor --json
as my-task doctor --json
as . doctor --json
```

Default human output shows warnings/errors in a compact `SESSION`, `CHECK`,
`STATE`, `REASON` table, followed by error/warning/pass counts. Repeated identical
findings share one row with a multiplicity marker; the counts still reflect every
check. Successful and informational checks stay hidden unless `--verbose` is
requested. Verbose reports retain every check and its complete safe explanation;
JSON always retains the original flat checks array, without grouping or omissions.
Neither mode reveals configuration contents or performs repairs.

Doctor checks module configuration, ignored worktree-root policy, installed shell
and completion files, recorded bindings and registered managed slots, configured
local symlinks, and lifecycle locks. It also finds registered slots whose metadata
is missing after a branch rename. Named reports restrict binding/link checks to
that slug; repository/configuration/integration/lock checks remain project-wide.
An unresolved `.` reports a `current-target` error and skips binding/link checks
rather than guessing or falling back. Use a named or repository-wide report to
inspect a broken binding.

Doctor never fetches, probes remotes, executes agent/preparation commands, calls
credential helpers, acquires/removes locks, repairs state, or deletes files. Its
Git queries are limited to local topology and ignore policy; it does not run
`git status`, refresh the index, or invoke fsmonitor. It does not read local-link
file contents or print configuration commands, metadata values, remote URLs, or
raw parse errors. Optional absent local sources do not require links; existing
sources require matching, non-dangling symlinks in valid sessions.

JSON is one newline-terminated document with `version: 1`, `command: "doctor"`,
`ok`, and a `checks` array. Scoped reports contain `slug` unless the current
target could not be resolved.
Each check has `id`, `status` (`ok`, `info`, `warning`, or `error`), and `message`;
binding/link checks can include `slug` and a project-relative link `path`.
Binding errors can also include a safe `code` explaining the failure:

| Code | Meaning and next step |
|------|-----------------------|
| `metadata-missing` | Expected managed branch has no record; explicitly `repair` it after verifying ownership. |
| `metadata-missing-renamed` | Registered slot has no record and uses a renamed/detached branch; `repair` cannot recover it. Keep it intact or explicitly preview and retire it with `finish --force`, preserving all branches. |
| `metadata-invalid` | Record is unreadable, malformed or unsafe; inspect/restore it rather than overwriting it. |
| `metadata-path-mismatch` | Configured slot and record disagree; check for a moved worktree or changed configuration. |
| `worktree-missing` | Record exists but directory is absent; locate moved work and preserve branches before stale-record cleanup. |
| `git-binding-invalid` | Directory exists but Git registration or repository identity disagrees; inspect local registration. |
| `session-unknown` | Neither a record nor a registered configured slot exists for the requested slug. |

A healthy binding does not imply cleanup eligibility: doctor does not run the
freshness, publication or dirty-work checks required by `finish`.
Exit status is `0` with no errors (warnings are allowed), `1` for diagnostic
errors, and `64` for invalid CLI arguments. Valid diagnostic requests still
return JSON when configuration or repository context is missing.

Installed files cannot prove that the parent shell loaded its functions or
completions; the `shell-parent` informational check asks you to verify `type as`
there. Lock warnings report only stored owner information, not process liveness
or proven ownership. Neither a successful report nor a warning grants authority
to repair or remove anything. Use `list --inspect` for dirtiness, freshness, publication,
and branch-ownership diagnostics; doctor is not a replacement for cleanup guards.
There are no `--fix`, `--repair`, or `--refresh` options.

## Human creation and preparation

`create` and `start` show one updating preparation line on capable terminals.
Redirected output has one plain preparation notice. Successful Git/worktree and
configured preparation output stays hidden by default; `create` and
`start --no-agent` finish with one `Ready` summary showing the session, branch
and worktree. `start` clears preparation progress before handing input, output
and the exit status to the configured agent.

Both commands accept `--color=auto|always|never` and `--verbose`. Colour uses the
same rules as batch previews. Verbose preparation retains successful command
output and phase diagnostics; it also leaves interactive preparation output
visible. Normal quiet preparation inherits stdin while capturing stdout/stderr.
Use verbose mode when a custom preparation command needs visible prompts.

Failed quiet preparation shows a red headline when colour is enabled, followed
by the original captured stdout and stderr without added styling. It does not
print successful worktree creation/deletion chatter or a false readiness message. If local rollback cannot be confirmed, its native diagnostics and a
request to inspect the remaining resources are shown. This does not relax
rollback's existing branch-deletion safeguards or claim uncertain effects
succeeded. PR trust still requires its existing explicit approval.

## JSON creation receipts

```sh
as my-task create --json
as my-task create --dry-run --json
```

Actual creation writes one newline-terminated JSON document to stdout:

| Field | Value |
|-------|-------|
| `version` | `1` |
| `command` | `"create"` |
| `dryRun` | `false` |
| `session` | The persisted session metadata |
| `session.slug` | The requested slug |
| `session.branch` | The initial `agent/<slug>` branch |
| `session.worktreePath` | The canonical absolute worktree path |

The receipt also retains the metadata's remote, default branch, creation time,
and preexisting branch snapshot. Consumers can use the returned binding without
parsing human output or discovering it through another status call. It describes
what was recorded at creation, not a fresh inspection of its current state.

Lifecycle progress is newline-delimited JSON on stderr. Successful Git and
preparation output is captured rather than streamed in JSON mode, so it cannot
corrupt stdout or progress records. Failed commands retain their diagnostic text
in failed-phase records and stderr diagnostics. A failed preparation emits no
creation receipt and rolls back only the worktree and branch created by that
attempt. Creation still prepares without launching the configured agent.

Preview output is unchanged: `dryRun` is `true`, and `plan` describes the proposed
creation without fetching or modifying Git. The entrypoint drains pending stdout/stderr writes
before exiting, including JSON responses larger than a pipe buffer.

## Reviewing a GitHub PR

```sh
as review-auth create --pr 123                  # ask before executing PR code
as review-auth create --pr https://github.com/owner/repo/pull/123
as review-auth create --pr 123 --trust-pr --json # explicit non-interactive trust
as review-auth create --pr 123 --dry-run --json  # offline, unresolved preview
as review-auth start --pr 123                   # prepare/reuse, then launch
as followup start --pr 123 -c --no-agent         # independent preparation only
```

This checks out the PR's source head, not its synthetic merge commit, and
prepares a managed worktree without launching an agent or pushing. The packaged
launcher includes `gh`; authenticate it with `gh auth login` before use.

Inspect the PR before granting trust: its environment configuration can execute
code. On a terminal, creation displays the PR URL and exact fetched head commit
and asks for confirmation before creating the checkout or running preparation.
Only `y` or `yes` (case-insensitive) confirms; no, empty input, EOF, or prompt
failure cancels. The operation lock remains held while waiting; creation
rechecks the local target after approval rather than populating a slot that
appeared during confirmation. Prompts go to stderr, including with `--json`;
stdout remains reserved for the creation receipt.

`--trust-pr` explicitly authorizes preparation and later execution in this PR
checkout without prompting. Non-terminal creation of a new session requires this
flag; matching trusted sessions can be reused without it. Trust is recorded
against the fetched head commit, not against future remote updates.

PR dry runs require no trust, GitHub lookup, remote query, checkout, preparation,
or session-record write. They use cached remote HEAD to check the primary
branch; missing cached information fails without an online fallback. The plan
contains `pr.number`, `pr.resolved: false`, `trustRequired: true`, and null values
for unverified PR URL/repository/base/head and the proposed branch/base. In
independent mode the requested `agent/<slug>` branch name is known and shown,
but its starting commit remains unresolved. This previews the request, not PR
existence or checkout eligibility.

Selection accepts a positive PR number or an HTTPS `github.com` PR URL. Both
identify a PR targeting this checkout's configured upstream repository; repository
names are compared case-insensitively. A URL for another target repository is
refused without GitHub lookup or cloning. Numbers never select another project.
PRs may come from forks; checkout does not require push permission.

Open, draft, closed, and merged PRs are supported when their retained head can
be fetched. No PR is reopened or marked ready by creation. Human creation/inspection
output includes PR identity, state, draft status, and the recorded base branch;
JSON keeps `state` and `isDraft` separate. These are recorded at creation:
Git-only status refresh does not requery GitHub or adopt a new PR head.
Default review mode can borrow an unused local source branch only if its commit
exactly matches the resolved PR head and its existing upstream and effective push
destination already target the PR source branch/repository. Missing or conflicting
tracking must be configured explicitly by the user; creation does not rewrite it.
A source branch checked out elsewhere is refused with that worktree's path.
Unsupported requests fail rather than falling back to default-branch creation.

The new local branch tracks the PR's source branch for `git push`. For a fork,
creation reuses a matching configured remote without changing it, or adds
`as-pr-<slug>` pointing to the source repository over HTTPS. Conflicting remote
configuration or an existing ref namespace is preserved and refused. A failed
creation removes only a source remote created by that attempt. Successful
sessions retain their source remote after cleanup so preserved branches keep
working tracking; remote repositories and their branches are never deleted.

Conflicting push URLs, explicit remote push refspecs, mirror mode,
`push.default=matching`, and fetch mappings that would track another source branch
are refused rather than rewritten. Git transport rewrites and credentials remain
under the user's control. Creation verifies that the resolved PR head and fetched PR ref agree before
preparing the checkout; available source branches must also match. A source
branch is considered deleted only after an explicit remote query establishes
its absence, never because authentication or transport failed.

### Historical PRs and release bases

A deleted source branch does not prevent reviewing a retained PR head when its
repository is still identifiable. The local review branch keeps its intended
source tracking, which can be gone; no remote branch or fake remote-tracking ref
is created. `sourceBranchMissing: true` records verified absence at creation.
An explicit later `git push` may restore that branch, so use `-c` for independent
follow-up work when you do not intend to restore it. `as` never pushes.

If GitHub no longer identifies the source repository, default review mode refuses
with a `-c` hint. Explicit independent mode can still use the retained head,
records `sourceRepository: null`, and configures no source remote or source push
destination. It never guesses a repository or silently changes branch mode.

Freshness, launch warnings, and merge-based cleanup use the recorded PR base
branch, including release branches, not the repository default. The primary
checkout must still satisfy the normal clean/upstream-default creation guard.
Missing cached base refs cannot establish freshness and are treated as stale.

### Dependency diagnostics

A missing/unexecutable `gh` is reported as an executable problem. GitHub's
authentication-required exit status prompts `gh auth login`; lookup/network
failures retain their actual diagnostic and repository identity without falsely
claiming the user is logged out. Failed lookup/fetch emits no successful creation
receipt and executes no PR preparation or agent command.

### Launch and reuse

`start --pr` accepts the same PR selection, trust, and branch-mode flags as
`create --pr`. It prepares the session and launches the configured agent normally,
without injecting review instructions. `--no-agent` prepares or reuses only. An
agent failure leaves the prepared session available for later use.

Repeating `create --pr` or `start --pr` with the same canonical repository, PR
number, and branch mode reuses a valid recorded session offline. It does not
fetch, reset, pull, change the worktree, rewrite metadata, repeat preparation, or
request trust again. Local commits and dirty files are preserved; only `start`
launches the configured agent. New-session creation retains its primary-checkout
clean/default-branch guards; reuse allocates nothing and verifies the existing
path, Git registration, metadata, and allowed branch lineage instead.

A different PR/mode, a non-PR record, or an invalid binding is refused rather than
converted or repaired. Bare `start` without `--pr` keeps its existing creation
behavior; use `launch` / `resume` for ordinary existing sessions.

### Borrowed branches and metadata compatibility

Borrowing does not transfer branch ownership. Normal cleanup, forced cleanup,
failed preparation, and missing-worktree cleanup preserve the initial borrowed
branch and its configuration. Renaming it does not make it session-owned.
Branches actually created during the session retain normal ownership checks.

Borrowed sessions store metadata `version: 2` with `initialBranchOwned: false`
and a preexisting-branch snapshot containing the borrowed branch. Owned sessions
retain metadata version 1; current readers accept both versions. Outer creation
receipts and inspection envelopes remain version 1. Version-1-only launchers reject
borrowed records rather than ignoring an added flag and deleting a borrowed
`agent/<slug>` branch. Inconsistent version/ownership records are refused.
Do not downgrade borrowed records or reconstruct them as version 1. If a borrowed
record is lost, restore the original version-2 record; unrecorded forced retirement
preserves all branches and is not permission to invent ownership with `repair`.

### Independent follow-up work

```sh
as auth-followup create --pr 123 -c
as auth-followup create --pr 123 --create-branch --trust-pr --json
```

`-c` / `--create-branch` requires `--pr` and creates `agent/<slug>` at the PR's
fetched source head. It does not check out or change the original source branch,
so that branch can already be occupied by another worktree. Creation refuses
an existing follow-up branch, its saved configuration, or its upstream tracking
ref rather than resetting or adopting them.

This mode still requires execution trust, but does not fetch or configure a fork
source remote, add an upstream for the new branch, or configure pushes to the
original PR. Ordinary user Git settings remain unchanged. Publication starts as
`unpublished`; normal cleanup protects this separate work. Use
`finish --keep-branch` to remove the worktree and preserve its branch.

Creation receipts and `list --inspect --json` expose a `pr` object containing `number`,
`url`, `repository`, `baseBranch`, `headBranch`, `headCommit`, `state`, `isDraft`,
`mode`, `trustedHeadCommit`, `sourceRepository`, `sourceRemote`, and the optional
`sourceBranchMissing` annotation. Older records
without source fields remain readable. `mode` is `review` or `independent`;
independent sessions retain PR source provenance but have no `sourceRemote`.
Status is offline by default; explicit refresh and guarded cleanup fetch both
target and source remotes for review sessions when they differ, and only the
target remote for independent sessions. Freshness uses the target branch;
publication uses the current local branch's upstream, if any.
Normal cleanup protects unpushed review fixes and removes only session-owned
local assets; it never deletes the remote PR branch.

## Project settings

```nix
agentSession = {
  enable = true;
  worktreeRoot = ".worktrees";
  agentCommand = [ "pi" ];
  prepareCommand = [ ];
  localLinks = [ "devenv.local.nix" ".envrc.local" ];
};
```

Local links are explicit ignored paths, not automatic secret copying. Keep
project-specific links and preparation commands in the consuming project.

## Navigation and one-off commands

`as <slug> cd` changes the current shell's directory. It needs the shell function
shipped with the package: an executable cannot change its parent shell's directory.
Without that function, `as <slug> cd` reports how to enable it instead of pretending to navigate.
This repository's managed Bash, Zsh, and Fish configs load it at startup after
Home Manager activation. Bash devenv startup and Fish's vendor startup also load
it. In an already-running shell, or on another machine, initialize it explicitly:

```sh
# Bash or Zsh
source "$AGENT_SESSION_SHELL_ROOT/init.sh"
# Fish
source "$AGENT_SESSION_SHELL_ROOT/init.fish"
```

The `as` executable is retained for scripts and every other subcommand. Outside
an enabled project the function delegates unchanged to the executable on PATH,
including the system assembler. For scripts that need just a path,
`agent-session <slug> cd` prints the validated absolute worktree path.

`as <slug> run <command> [args...]` runs exactly one command inside that worktree
through `devenv -q shell --`. Arguments, empty arguments, stdout, stderr, and exit
status are preserved; the caller's directory is unchanged. Slugs and commands are
required, and command arguments are not evaluated as shell code. Use an explicit
shell for pipelines or shell operators:

```sh
as my-task run sh -c 'bun test && bun run lint'
```

Both commands work from any checkout in the same repository, including a dirty
primary checkout or worktree, without fetching or launching an agent. They reject
unknown sessions, missing worktrees, invalid metadata, and unregistered paths
without changing directories or running a command.

## Completions

Both command names have installed completions. The module exports
`AGENT_SESSION_COMPLETION_ROOT` and defaults `DIRENV_ZSH_COMPLETION_DIRS` to its
Zsh completion directory. Completion offers session names and global commands
first, session actions after the slug, and options after the action. After `run`,
it switches to command completion (command/file names in Bash, native command
completion in Zsh and Fish). This repository's managed post-direnv hook registers
these after `compinit`, preserves existing completions, and restores registrations
on project exit. Plain direnv cannot register completions in an already-running
Zsh without that shell integration.

PR flags are offered for both `create` and `start`. After `--pr`, enter a number
or URL; option names are not suggested in that value position. PR flag/value
completion performs no GitHub lookup or fetch.

Projects with their own completions override the directory list explicitly:

```nix
env.DIRENV_ZSH_COMPLETION_DIRS =
  "${config.env.AGENT_SESSION_COMPLETION_ROOT}/zsh/site-functions:${myCompletions}/share/zsh/site-functions";
```

Do not export `FPATH` through direnv: it replaces the running shell's `fpath`.
Manual loading is also available:

```sh
source <(agent-session completion bash)
agent-session completion fish | source
```

For manual Zsh setup, save `agent-session completion zsh` output as
`_agent_session` in a directory on `fpath`, then rerun `compinit`.

## Implementation layout

`cli.ts` remains the executable entrypoint for packaged and source-based consumers.
It dispatches to modules with explicit imports and no initialization side effects:

| Module | Responsibility |
|--------|----------------|
| `arguments.ts` | Argument parsing, command names, help, and diagnostics |
| `completion.ts` | Dynamic candidates and Bash/Zsh/Fish completion scripts |
| `sessions.ts` | Configuration, session records, locks, discovery, and path validation |
| `git.ts` | Git execution, repository roots, refs, and worktree registration |
| `github.ts` | GitHub PR resolution, source-head verification, and review push safeguards |
| `inspection.ts` | Local session state, creator-tree inventory, branch ownership, and status reporting |
| `creator.ts` | Bounded Pi header validation and creator-context capture |
| `ownership.ts` | Explicitly reviewed legacy identity and ancestry mapping |
| `doctor.ts` | Read-only configuration, integration, binding, local-link, and lock diagnostics |
| `lifecycle.ts` | Creation, preparation, launch/resume, repair, and one-off execution |
| `finish.ts` | Cleanup previews, receipts, confirmations, and guarded removal |
| `runtime.ts` | Shared command errors, subprocess execution, table/time formatting, and progress output |
| `types.ts` | Shared configuration, metadata, and status types |

The Nix wrapper packages this source directory as a unit so Node can resolve the
relative TypeScript imports in the Nix store. No bundler or npm dependencies are
required. The module dependency graph is acyclic; shared records and Git primitives
do not import command dispatch or lifecycle operations.

## Runtime and verification

The command uses Nix-provided Node.js 24's native TypeScript support, Git,
and the GitHub CLI (`gh`) for PR selection.
`run` also needs the `devenv` executable on PATH.
It needs no npm dependencies, install step, or Bun runtime. Bun remains only in
this repository's optional regression-test profile; the default shell does not
include it. Package cache availability still depends on the consumer's nixpkgs pin.

From this repository:

```sh
devenv -q --profile agent-session-tests build outputs.agent-session-tests
devenv -q --profile agent-session-tests shell -- bash tests/zsh-direnv-completion.sh
```

The regression tests run the CLI with Node against disposable local Git remotes.
They cover creation, resumption, recovery, cleanup guards, installed completions,
and default-on template wiring. The Nix check also runs outside a Git checkout.
It runs four independent suite groups with at most four concurrent Bun processes,
limited by `NIX_BUILD_CORES`. Tests within each group remain sequential. Each
process has its own home and temporary directories; any failed group fails the
check. New suites join the default group automatically, so adding tests does not
require updating a shard list. Logs identify their group as `[agent-session N/4]`.
