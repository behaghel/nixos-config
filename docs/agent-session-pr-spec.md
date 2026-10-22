# Spec: Agent sessions from GitHub pull requests

## Problem

A reviewer needs an isolated, managed worktree for an existing pull request,
with the ability to push review fixes to that same PR. Today, `as` creates
sessions from the upstream default branch, leaving PR checkout, tracking, and
session integration to the reviewer. Reviewers also need an explicit way to
start separate follow-up work without updating the original PR.

## Context

- [Agent-session documentation](../modules/flake/agent-session/README.md)
  describes the slug-first commands, creation guards, local links, receipts,
  preparation, launch, and guarded cleanup.
- [Arguments](../modules/flake/agent-session/arguments.ts) and
  [dispatch](../modules/flake/agent-session/cli.ts) define the command surface.
- [Lifecycle](../modules/flake/agent-session/lifecycle.ts) creates and prepares
  worktrees; current creation always allocates `agent/<slug>` from the default
  branch. Current `start` always attempts creation rather than reusing a session.
- [Inspection](../modules/flake/agent-session/inspection.ts) currently assumes
  the initial branch belongs to the session and checks freshness against the
  default branch. PR sessions require distinguishing borrowed branches from
  session-created branches and tracking the PR base separately.
- [Cleanup](../modules/flake/agent-session/finish.ts),
  [metadata](../modules/flake/agent-session/types.ts), and
  [session persistence](../modules/flake/agent-session/sessions.ts) participate
  in branch ownership and lifecycle safety.
- [Regression tests](../tests/agent-session.test.ts) exercise the CLI using
  disposable Git repositories and local remotes.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Provider | GitHub through authenticated `gh`; PR number or URL | Reuse established authentication and PR discovery without a multi-provider abstraction. |
| Repository | PR targets this checkout's configured upstream repository; source may be a fork | Preserve project identity while supporting normal external review. |
| Default | Check out the PR head branch and configure newly created local review branches to push to its source | Review fixes should update the existing PR, not accidentally create another one. |
| Separate work | `-c`, alias `--create-branch`, creates `agent/<slug>` at the fetched PR head | The required slug already supplies a branch name; no extra naming argument is needed. |
| Entry points | Both `create --pr` and `start --pr` | Preserve the distinction between preparing and launching an agent. |
| Existing session | Reuse a matching PR binding without updating its checkout | Repeated commands must not discard review work or silently fetch a new head into it. |
| Existing local branch | Reuse only at the exact resolved PR head, with compatible tracking and no other worktree using it | Preserve local commits, tracking configuration, and other active worktrees. |
| Execution trust | Explicit confirmation before PR code executes; `--trust-pr` for automation; trust bound to the resolved head commit | Checkout of a PR must not silently authorize execution of its environment or preparation code. |
| PR state | Draft, open, closed, and merged are eligible when the head remains fetchable | Historical review and separate follow-up work remain useful. |
| Preview | Offline and non-mutating, with unresolved PR details identified | Preserve the existing dry-run contract rather than implying online validation. |
| Freshness | Compare with the recorded PR base branch, including separate-work sessions | A release-targeted PR must not be judged against an unrelated default branch. |
| Agent | Normal configured launch, no injected review prompt | Keep `as` agent-neutral and do not presume the user's next task. |
| Cleanup | Preserve borrowed branches; normal guarded cleanup for session-created branches | Checking out an existing branch does not transfer ownership to `as`. |

### Command contract

```sh
as review-auth create --pr 123
as review-auth create --pr https://github.com/owner/repo/pull/123
as review-auth start --pr 123
as auth-followup create --pr 123 -c
as auth-followup start --pr 123 --create-branch
as review-auth create --pr 123 --trust-pr --json
as review-auth create --pr 123 --dry-run --json
```

The PR head means the source commit, not GitHub's synthetic merge commit.
Creation never pushes. A read-only reviewer can create a session without push
permission; a later unauthorized push fails rather than targeting another branch.
A deleted source branch is not automatically recreated remotely, and a closed PR
is not reopened. A push failure never triggers an alternate push destination.

A reused session is identified by canonical repository/PR identity and branch
mode, not by the spelling of its number or URL. A different PR or branch mode
is refused rather than converting an existing session. An unchanged matching
session is reused without rerunning preparation; `start` may launch its agent.
A session that is not valid under existing binding checks is not repaired by
these commands. No automatic PR-head refresh is introduced.

Trust confirmation identifies the PR and resolved head commit. Declining, EOF,
or a non-interactive invocation without `--trust-pr` does not execute PR code.
Fetching and inspection alone do not require trust. Trust is not blanket approval
for a future remote head: if support for adopting another PR head is added later,
execution at that head requires renewed consent. Ordinary local review edits do
not themselves constitute adopting a new remote head.

## Acceptance Criteria

- [ ] AC-1: Given an eligible same-repository PR and an unused slug, when
  `create --pr <number>` is authorized, the recorded worktree checks out the PR
  source head and no agent is launched.
- [ ] AC-2: Given the equivalent PR URL, when creation is requested by URL, it
  resolves to the same canonical repository/PR identity as the number form.
- [ ] AC-3: Given an eligible fork PR and a reviewer without push permission,
  when creation is authorized, checkout succeeds without requiring push access.
- [ ] AC-4: Given a newly created local review branch, when its push destination
  is inspected, it targets the PR source repository and branch; an attempted
  unauthorized push fails without sending commits elsewhere.
- [ ] AC-5: Given an eligible PR, when either `-c` or `--create-branch` is used,
  creation produces `agent/<slug>` at the PR head without configuring pushes to
  the original PR branch. This works even if that PR branch is checked out
  elsewhere.
- [ ] AC-6: Given a PR session creation request using `start`, when preparation
  succeeds and trust is granted, the configured agent launches in that worktree
  without an injected review prompt. Existing `--no-agent` behavior is retained.
- [ ] AC-7: Given a valid existing session for the same PR and branch mode, when
  `create --pr` or `start --pr` is repeated, its commits, working files, and
  preparation state remain unchanged. Only `start` launches the configured agent.
- [ ] AC-8: Given an existing slug bound to another PR or branch mode, when it is
  requested for the new selection, the command fails without changing its binding.
- [ ] AC-9: Given a PR branch checked out in another worktree, when default-mode
  creation is requested, it fails and identifies that worktree's path without
  changing it.
- [ ] AC-10: Given an unused local PR branch, when it exactly matches the PR head
  and has compatible tracking, it can be reused. If its commit or tracking
  conflicts, creation fails without resetting, merging, rebasing, or rewriting
  that branch's configuration.
- [ ] AC-11: Given a new PR execution context, when trust is declined or missing
  in a non-interactive invocation, no PR-supplied code executes. Explicit
  confirmation or `--trust-pr` authorizes execution for the identified head;
  reuse of that trusted session requires no new prompt.
- [ ] AC-12: Given a draft, closed, or merged PR with a fetchable head, when
  creation is authorized, it succeeds and exposes the PR state without reopening
  the PR or recreating a remote branch. An unavailable head fails clearly.
- [ ] AC-13: Given a PR URL targeting a different repository, when creation is
  requested, it fails without cloning that repository or allocating a session.
- [ ] AC-14: Given a dirty primary checkout or one not on its upstream default
  branch, when a new PR session is requested, existing creation guards refuse it
  without switching or cleaning the primary checkout.
- [ ] AC-15: Given `create --pr ... --dry-run`, when a preview is requested, it
  performs no network calls or Git/session mutations and marks unverified PR
  identity, commit, and branch information as unresolved rather than fabricated.
- [ ] AC-16: Given a created PR session, when creation JSON or `status --json` is
  inspected, it exposes PR URL, number, base branch, and fetched head commit.
  Human output exposes PR identity and state. Status does not contact the network
  unless `--refresh` is requested.
- [ ] AC-17: Given a PR targeting `release/2.x`, when freshness is inspected, it
  is evaluated against that recorded base branch rather than `main` or `master`,
  in both default and `-c` modes.
- [ ] AC-18: Given a session using a preexisting local PR branch, when cleanup
  succeeds, that branch remains. A session-created branch is eligible only for
  normal guarded cleanup. No cleanup mode deletes a remote branch.
- [ ] AC-19: Given a failed preparation, when creation rolls back, it removes
  only worktree/branch assets created by that attempt and preserves any borrowed
  local branch and its configuration. No successful creation receipt is emitted.
- [ ] AC-20: Given a missing or unauthenticated `gh`, an inaccessible PR, or a
  failed fetch, when actual creation is requested, it fails with an actionable
  diagnostic and no successful session receipt or preparation/agent execution.

## Invariants

- Existing commands without `--pr` retain their behavior and JSON contracts.
  PR-related metadata is additive; older records remain readable without
  fabricated PR identity or branch ownership.
- Slug-first grammar, explicit current-session targeting, managed-path and Git
  registration validation, ignored worktree-root policy, operation locks,
  explicit local-link allowlists, and invoking-worktree cleanup protection remain.
- Actual JSON creation retains one stdout receipt; progress, trust prompts, and
  dependency diagnostics do not corrupt it. Dry-run JSON remains a preview.
- No automatic push, remote deletion, PR reopening, merge, activation, credential
  copying, or alteration of someone else's worktree is authorized by this feature.
- Rollback and cleanup distinguish preexisting assets from assets created by the
  session. Force does not turn a borrowed branch into session-owned property.
- Preserve regression tests protecting these behaviors; tests encoding the old
  assumption that every initial branch is session-owned may be revised.

## Scope

**May modify:**

- `modules/flake/agent-session/{arguments,cli,completion,lifecycle,git,sessions,types,inspection,finish,doctor}.ts`
  where required for PR selection, trust, metadata, branch ownership, inspection,
  and cleanup integration.
- `modules/flake/agent-session/README.md` and this specification.
- `tests/agent-session.test.ts`, `tests/agent-session.nix`, and
  `tests/agent-session-templates.test.ts` for relevant regression coverage.
- A focused GitHub/PR helper and associated tests within the same module/test
  boundaries, if warranted; no new provider framework is required.
- `modules/flake/agent-session/default.nix` and `devenv.nix` only as needed to
  make the approved `gh` dependency available for PR operations and tests.

**Must not modify:** host configuration, activation behavior, unrelated agent
configuration, credentials, other managed sessions, or remote repository assets.

**Outside v1:** GitLab/other providers, cloning a foreign target repository,
automatic PR-head updates, review-prompt generation, and automatic pushing.

## Verification Plan

Use the existing disposable-Git CLI harness, with deterministic `gh` responses
and command-execution sentinels; never depend on live credentials for automated
coverage. Fault injection verifies failure and rollback paths.

| Criteria | Concrete verification | Automated? |
|----------|-----------------------|------------|
| AC-1–2 | Create by number and URL; compare canonical PR metadata and checked-out SHA; assert no agent invocation. | Yes |
| AC-3–4 | Fork source/base remotes and read-only GitHub response; inspect tracking and push destination; reject a push and assert no alternate destination. | Yes |
| AC-5 | Exercise both aliases with the PR branch occupied; assert new branch SHA and absence of original-PR push tracking. | Yes |
| AC-6 | Agent/preparation sentinels record cwd, order, and arguments; cover `--no-agent`. | Yes |
| AC-7–8 | Repeat against dirty/local-ahead sessions and a changed remote head; compare files, refs, metadata, preparation count, and launch count; reject identity/mode changes. | Yes |
| AC-9–10 | Register a competing worktree; test exact-match, divergent, ahead/behind, and conflicting-tracking local branches; compare branch configuration before/after refusal. | Yes |
| AC-11 | Exercise terminal approval/decline, EOF, non-terminal invocation, explicit trust, and trusted reuse; sentinels detect PR code execution before authorization. | Yes |
| AC-12–13 | Supply PR-state fixtures, unavailable-head failures, and foreign-target URLs; assert state reporting and absence of prohibited remote changes. | Yes |
| AC-14 | Dirty and non-default primary checkout fixtures; assert unchanged primary refs/files and no allocation. | Yes |
| AC-15 | Fail-on-call network stubs plus before/after Git/session snapshots; inspect unresolved preview fields and JSON framing. | Yes |
| AC-16–17 | Check creation/status JSON and human output, network-call counts, and freshness against a non-default PR base in both modes. | Yes |
| AC-18–19 | Cleanup/rollback with borrowed and newly created branches; inspect surviving refs, branch configuration, metadata, and receipt output. | Yes |
| AC-20 | Missing executable, authentication, inaccessible PR, and fetch-failure fixtures; assert actionable stderr and no execution or success receipt. | Yes |
| Invariants | Run existing agent-session regression/template checks and shell-completion coverage; run `nix flake check` before opening a PR. | Yes |

A real GitHub smoke test complements the fixtures: create an authorized review
session for a same-repository PR and a fork PR, inspect their HEAD and push
configuration, and confirm no push occurred. Any test push requires separate
explicit authorization. Automated success does not substitute for the user's
acceptance of the working feature.

## References

- [Agent-session module](../modules/flake/agent-session/README.md)
- [Agent-session regression tests](../tests/agent-session.test.ts)
- [Repository workflow and safety](../AGENTS.md)
