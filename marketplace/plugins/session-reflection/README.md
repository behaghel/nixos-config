# Session reflection for Pi

On-demand reflection on the current coding session, available from any project.
A thin extension registers four commands; the bundled skill owns the reflection
and issue-drafting guidance. No separate model, transcript collector, background
hook, GitHub client, or automatic issue publisher is introduced.

## Install personally

After the package is merged and your stable checkout contains it:

```sh
pi install ~/nixos-config/marketplace/plugins/session-reflection
```

Do not add `-l`: personal installation applies across projects and future sessions.
Run `/reload` in each already-open session. Pi owns the personal declaration in
`~/.pi/agent/settings.json`; devenv does not install or select these resources.
Do not persist a package selection pointing at a temporary task worktree.
This is a local marketplace package, not a published npm release.

## Commands

| Command | Requested dimensions |
|---|---|
| `/reflect:all` | Efficiency, quality, architecture |
| `/reflect:efficiency` | Efficiency only |
| `/reflect:quality` | Quality only |
| `/reflect:arch` | Architecture only |

Optional text narrows the user's focus, for example
`/reflect:quality Focus on the recent tests`.

The command sends a request into the current Pi session with the bundled skill
resolved from the package itself, never a project-relative `.agents` path. If Pi
is busy, it queues a follow-up instead of interrupting the current work. Loading
or reloading the package starts no reflection and changes no project resources,
model settings, or project trust.

Reflection uses available session context and relevant project evidence. It must
state missing evidence and trade-offs, not invent findings to fill a category.
Selected findings may become drafts, but selecting a finding is **not** approval
to publish it: the agent must show the exact issue title/body and obtain explicit
approval before each issue is created. Repository changes and queue labels also
need their own authorization. These are instructions to the existing agent, not
a new enforcement boundary around every GitHub tool.

## Existing project-local copies

Pi resolves extension commands before prompt templates, so these commands take
precedence over same-named legacy project prompts. Commands always use this
package's skill even if a project still advertises an older skill with the same
name. Such copies can still produce redundant skill discovery warnings.

Keep the old project resources until personal installation and command discovery
are verified. Then remove the four project prompt templates and old skill in that
project's normal review flow. Installing this package never deletes those files
or changes a project's trust/resource settings automatically.

## Verification

```sh
devenv -q shell -- node --test marketplace/plugins/session-reflection/test/extension.test.mjs
```

Tests exercise registration, dimension selection, request/approval boundaries,
follow-up delivery, package resources, and invocation outside the source project.
They do not call a model, create an issue, or install personal configuration.
