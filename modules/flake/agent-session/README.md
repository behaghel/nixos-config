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
The remote tip is fetched for creation; `status` does not fetch unless requested.
The default agent is `pi`, which must be available in your environment.

```sh
as my-task create                   # prepare without launching a nested agent
as my-task start                    # prepare and launch Pi
as list --json                      # cheap recorded-binding inventory
as status                           # reconcile all sessions
as my-task status                   # inspect one session
as my-task launch                   # launch in an existing worktree
as my-task resume                   # launch with --continue
as my-task cd                       # change the current shell's directory
as my-task run bun test             # run devenv -q shell -- bun test there
as my-task finish --dry-run         # preview local cleanup
as my-task finish                   # guarded local cleanup, with confirmation
```

## Command grammar and migration

Both `as` and `agent-session` use `<slug> <command>` for session-scoped actions.
Repository-wide commands remain command-first: `as list`, `as status`, `as doctor`,
`as finish --all|--gone`, and `as completion bash|zsh|fish`.

Command words are reserved in the first position so old command-first calls cannot
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

Session metadata remains in the shared Git directory at
`agent-session/sessions/`. Existing Herbert sessions need no data migration.
Cleanup preserves remote assets and refuses unsafe work unless explicitly forced.
Interactive cleanup uses Node-compatible confirmation for normal, forced and bulk
finish. Only `y` or `yes` (case-insensitive) confirms; empty input, EOF, or a failed
prompt cancels without cleanup. Non-terminal calls require explicit `--yes`.
`--yes` skips only confirmation, not ownership or cleanup safety checks.

## Recorded-binding inventory

`as list [--json]` reads recorded session bindings without inspecting checkout
Git state, refreshing remotes, or running preparation or agent commands. JSON is
one document with `version: 1`, `command: "list"`, and `sessions`, each containing
only `slug`, `branch`, and `worktreePath`. `branch` is the recorded **initial**
branch, not an observation of the current branch, ownership, or clean state.
Use the selected `slug` with `as <slug> status --json` and guarded `finish` for
fresh inspection and cleanup; inventory alone never authorizes removal.

The inventory includes valid records whose checkout is missing, but not
unrecorded Git worktrees. An empty inventory therefore does not prove a resource
is absent: consumers also check native Git registration and the filesystem.
Malformed, unreadable, or unsafe records fail the whole inventory before any
output rather than silently omitting potential bindings. A dangling metadata
store is not reported as an empty inventory. Listing does not repair records,
prune registrations, or remove files. It accepts only `--json`, not `--refresh`,
and is repository-wide rather than a session action.

## Exact-resource inspection

```sh
as status --worktree /absolute/path/to/.worktrees/my-task --json
```

Exact status runs from another checkout of the same repository, even when the
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
`configuredLinks`, `ignoredPaths`, `unapprovedPaths` and `blockers`, plus
workspace/link filesystem identities. Configured-link states are `verified`, `missing`,
`mismatch` or `unsafe`. Link and ancestor identity/timestamps/destinations—not
primary target contents—are bound into single-session receipts and batch
fingerprints. Apply rechecks the evidence; single finish also rechecks after
interactive confirmation. New ignored data or changed link evidence requires a
fresh preview, not a force fallback.

There are no implicit artifact exemptions based on familiar names or Nix-store
targets. Unconfigured symlinks, generated hook links, `.devenv/`, `node_modules/`,
`coverage/`, databases and other ignored local data block non-forced retirement
unless explicitly covered by the project policy below. Direct single-session
`finish --yes` cannot bypass either the data guard or artifact receipt approval;
it may refuse workspaces that older versions removed.

Obtain fresh previews for present worktrees after upgrading: older receipts did
not bind this evidence and cannot authorize removal under the new guard. Existing
interrupted-batch reconciliation still requires confirmed native/filesystem
absence and unchanged residual binding/branch evidence before metadata-only
completion. Explicit forced-cleanup semantics are unchanged and are not an
automatic recovery mechanism for an ignored-data refusal.

## Explicit artifact-disposal policy

`agentSession.disposablePaths` defaults to `[]`. Projects may opt into exact
workspace-relative ignored paths, for example:

```nix
agentSession.disposablePaths = [ "node_modules" "coverage" ".pre-commit-config.yaml" ];
```

This is a declaration of disposal authority, not a generated-file detector.
Paths are literal: no globs, absolute paths, empty/dot/traversing components or
`.git` components. A file authorizes that entry; a symlink authorizes only the
link, never its target. A directory authorizes its **entire subtree**, including
logs, databases, local patches and other potentially valuable data. In particular,
listing `.devenv` would authorize its diagnostic logs and task databases too.
Retain/move needed evidence before approving such a policy, or choose narrower
exact paths. This provider does not populate a project's policy automatically.

Policy does not waive cleanliness, identity, activity, ownership or native-lock
checks, nor configured-link replacement protection. Nested policy paths require
safe non-symlink, same-filesystem ancestors. Structural parents do not authorize
siblings: `.cache/generated` is not permission to discard `.cache/other-data`.
Missing optional policy roots are recorded, not repaired or created.

Non-forced previews expose `ignoredData.policy`, `policyRoots` and
`approvedArtifacts`, alongside the existing blockers and ignored-path evidence.
Each present policy root has a complete metadata-tree `fingerprint`. The digest
binds relative entry paths, device/inode identity, type/mode, uid/gid, link count,
size, nanosecond modification/change times, allocation metadata and symlink
destination text. Directory traversal is sorted; neither file contents nor
symlink-target contents are read. Missing/unsafe roots are explicit. Unreadable,
changing, cross-filesystem or incomplete trees cannot authorize retirement.

Artifact disposal requires **both policy and a matching preview receipt**.
For one session, use the existing branch-preserving receipt workflow:

```sh
as task finish --keep-branch --dry-run --json
as task finish --keep-branch --expected <receipt> --yes
```

The first response provides `plan.receipt` and
`plan.artifactDisposalRequiresReceipt`. Direct `finish --yes`, even with
`--keep-branch`, refuses approved artifacts without that receipt. Legacy bulk
finish has no receipt contract and skips/refuses artifact disposal; use single
receipts or inactive-batch preview/apply instead. Inactive batch already requires
its selection receipt and explicit `--yes`.

Both guarded paths bind policy, root states and recursive metadata fingerprints
into their receipts and freshly validate them before native removal. A changed
policy, deep entry, restored content/mtime with changed ctime, renamed/replaced
entry or newly observed unapproved data requires fresh inspection/approval.
Single finish also rechecks after interactive confirmation, without repeating
full-tree walks merely to calculate a receipt. Artifacts are never pre-deleted
to make Git accept removal; all guards precede non-forced native worktree removal.
All artifact receipt workflows preserve branches and never modify remote assets.

Metadata fingerprints are change detection, not cryptographic content-integrity
proof or a filesystem reservation. They do not hash dependency contents, freeze
unmanaged writers or guarantee reclaimed space. Explicit ownership exclusions
and a quiet target remain necessary. Forced-cleanup semantics are unchanged;
there is no automatic force fallback.

## Inactive-session retirement

```sh
as batch finish --inactive-for 7d --exclude retained-task --dry-run --json
```

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

The receipt binds repository/configuration identity, exact selected paths,
metadata digests, checkout/Git-directory identity, HEAD, branch refs and observed
activity. It is self-contained, so preview creates no saved state. Its checksum
catches corruption; it is **not a signature or ownership authorization**. The
caller remains responsible for retained-work exclusions and consumer authority.
Treat it as opaque and obtain a fresh preview when it no longer matches.

Apply holds the provider operation lock and freshly checks each selected target's
identity, inactivity, cleanliness, ignored data and live/process evidence before
non-forced native removal. Managed work starting through `as` uses the same lock
when recording activity. Native worktree locks and submodules are also refused.
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
- `activity`: `lastWorkAt`, `limitingEvidence`, latest timestamp observations for
  creation, managed work, each inspected reflog and the most recent non-ignored
  file, plus `filesChecked`, `problems`, `complete` and `inactive`.
- `ignoredData`: configured-link evidence, ignored path types/classifications,
  local symlink destinations and size observations, with all data-inspection
  blockers. Paths remain `unapproved` unless verified configured links, structural
  parents or explicitly policy-covered `approved-artifact` entries.
- `processEvidence`: the process observation time/source, matching cwd PIDs and
  every managed operation's observed state, including interrupted/foreign owners.
- `blockers` and `inspectionComplete`: all observable safety refusals and whether
  the applicable evidence could be established, rather than just the first one.

Explicitly excluded resources are not deeply inspected. Invalid or ambiguous
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

Progress is emitted on stderr: per-resource inspection/apply/recheck events and
metadata-scan chunk counts for long traversals. With `--json` these are versioned
progress records; stdout remains one result document. Progress completion means
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
- Outside `as`, checkout and session-owned branch **reflog event times** and
  current non-ignored working-file mtimes contribute to the latest observed work.
  Commit author dates and Git-index mtimes are not inactivity clocks: checking
  out an old commit is recent work, while status can refresh the index.
- Same-user processes whose cwd is the worktree or a subdirectory block
  eligibility. The packaged `lsof` supplies this evidence; unavailable,
  unrecognized or failed process inspection blocks eligibility.

Direct `status`, `list` and batch-preview polling update none of these clocks.
Preview does not fetch, repair metadata, prune registrations, remove resources or
start an agent. Git status inspection disables optional index writes.

**Observed inactivity is not proof of disposability.** These checks cannot see
editors with cwd elsewhere, all other-user/remote processes, restored timestamps,
or events removed by reflog expiry. Explicitly exclude retained or otherwise active
work. Dirty resources, unapproved ignored local data, foreign-owned directories, the invoking
worktree and unresolved resource evidence are refused. Ignored files can contain
important local work; age alone never authorizes their removal. A clean workspace
with no such evidence may be a candidate, not permission to finish it.

## Current-session targeting

Inside a recorded managed worktree, including its nested directories, use the
explicit target `.` instead of repeating its slug:

```sh
as . status --json
as . cd
as . run bun test
as . resume
```

Resolution verifies the current Git worktree against its configured location,
persisted metadata, and shared Git registration. It does not infer identity from
the current branch name, fetch, allocate, or repair anything. The selected command
retains its normal behavior, and JSON output uses the canonical slug, never `.`.
Renaming the current branch does not change the session identity.

There is no implicit default target: `as status` still lists all sessions. `.` is
rejected from the primary checkout, unmanaged worktrees, and unrecorded or invalid
bindings. A nested Git repository is a separate context, not its outer session.
Use an explicit slug to inspect or repair missing metadata. Creation, `start`,
and `repair` require explicit slugs; `.` supports only `cd`, `run`, `launch`,
`resume`, `status`, `doctor`, and `finish`. The escape form `as -- . status` also works.

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
to repair or remove anything. Use `status` for dirtiness, freshness, publication,
and branch-ownership diagnostics; doctor is not a replacement for cleanup guards.
There are no `--fix`, `--repair`, or `--refresh` options.

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
creation without fetching or modifying Git. Human-readable creation and agent
startup output are unchanged. The entrypoint drains pending stdout/stderr writes
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
be fetched. No PR is reopened or marked ready by creation. Human creation/status
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
receipts and status envelopes remain version 1. Version-1-only launchers reject
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

Creation receipts and `status --json` expose a `pr` object containing `number`,
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
| `inspection.ts` | Local session state, branch ownership, and status reporting |
| `doctor.ts` | Read-only configuration, integration, binding, local-link, and lock diagnostics |
| `lifecycle.ts` | Creation, preparation, launch/resume, repair, and one-off execution |
| `finish.ts` | Cleanup previews, receipts, confirmations, and guarded removal |
| `runtime.ts` | Shared command errors, subprocess execution, and progress output |
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
