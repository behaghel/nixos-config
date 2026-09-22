# Domain Tree Conventions

Rules for maintaining the 1:1 mirror between colocated domain specs and code namespaces, informed by Domain-Driven Design.

## The colocation principle

`domains.yaml` lives at the project root. Domain specs live beside the code they govern: the first `code` path is the default spec directory, `README.md` is the main domain spec, and additional behavior specs are sibling `*.md` files. If specs cannot live in the first `code` path, an explicit `spec:` override may point to the colocated spec directory.

For a project that uses `src/`, the common shape is:

```
.
├── domains.yaml               (the manifest)
└── src/
    ├── verification/
    │   ├── README.md          (main domain spec)
    │   ├── presentation.md    (specific behavior spec)
    │   └── ...code...
    ├── issuance/
    │   ├── README.md
    │   └── ...code...
    └── shared-kernel/
        ├── README.md
        └── ...code...
```

The domain tree SHOULD mirror the code's module/package structure. When they diverge, make the drift visible in `/domain-tree:check` and decide whether to refactor code or update `domains.yaml`.

## Ubiquitous language

Each domain has its own vocabulary. The same word can mean different things in different domains — that's expected and healthy. What matters is consistency WITHIN a domain.

- Define key terms in the domain's `language` field in `domains.yaml` or in `<domain code path>/README.md`
- Code names (types, functions, variables) MUST use the domain's vocabulary
- Spec text MUST use the domain's vocabulary
- When two domains need to communicate, the context map defines how terms translate

Example: "Credential" means an SD-JWT VC in the issuance domain, but a displayable card in the wallet domain. The ACL between them handles the translation.

## Domain classification and spec rigor

Not all domains deserve equal investment. Classification drives how thoroughly you spec:

### Core domains (`type: core`)

The competitive advantage. Invest the most here.

- **Spec rigor:** Full spec-driven collection (all 6 phases). Every behavioral change specced before code.
- **TDD rigor:** Thorough iteration plans, small slices, careful red-green-refactor.
- **Review:** Specs need human approval before implementation.
- **Spec-on-touch:** Hard requirement — no code changes without a spec.
- **Modeling:** Rich domain models with explicit aggregates, value objects, domain events.

### Supporting domains (`type: supporting`)

Necessary, custom-built, not differentiating.

- **Spec rigor:** Good specs but lighter process. Can skip some collection phases.
- **TDD rigor:** Standard TDD. Larger slices acceptable.
- **Review:** Self-approval OK for straightforward specs.
- **Spec-on-touch:** Warning when missing, not blocking.
- **Modeling:** Simpler models. CRUD-like patterns are fine.

### Generic domains (`type: generic`)

Solved problems. Use existing libraries, standards, infrastructure.

- **Spec rigor:** Spec the integration boundary only. Don't spec the internals of something you didn't build.
- **TDD rigor:** Contract tests at the boundary. Don't unit-test the library.
- **Review:** Minimal — the standard/library IS the spec.
- **Spec-on-touch:** Only when the integration surface changes.
- **Modeling:** Thin wrappers. Anti-corruption layers where the external model leaks.

### Shared kernel (`type: shared-kernel`)

Shared types and contracts across domains. Treated with the rigor of core, because changes ripple everywhere.

- **Spec rigor:** High. Every shared type must be explicitly specced.
- **TDD rigor:** High. Contract tests from every consumer.
- **Review:** Joint approval from all consuming domains.
- **Spec-on-touch:** Always — any change to shared kernel needs spec update.
- **Modeling:** Value objects and immutable types preferred. Minimize the kernel surface.

## Context map conventions

The context map in `domains.yaml` declares cross-domain relationships. These relationships are architectural decisions, not just documentation.

### Integration patterns and what to spec

| Pattern | Spec location | What the spec covers |
|---------|--------------|---------------------|
| shared-kernel | The kernel domain's colocated spec directory | The shared types, their invariants, and which domains consume them |
| customer-supplier | Upstream domain's spec | The contract — what the upstream promises and what can change |
| conformist | Downstream domain's spec | How the downstream maps upstream concepts to its own model |
| anti-corruption-layer | Downstream domain's spec | The ACL: what comes in, what comes out, where it lives in code |
| open-host-service | Upstream domain's spec | The protocol or API definition (often a published standard) |
| published-language | `<domain code path>/` of the publisher | The schema or interchange format |

### Cross-domain changes with context map awareness

When a change spans domains, the context map tells you how to handle it:

1. **shared-kernel change** → Update the kernel spec. Notify ALL consuming domains. Run contract tests from each consumer.
2. **customer-supplier change** → Upstream changes its contract → downstream must update its conformance. Check the downstream's ACL or conformist layer.
3. **anti-corruption-layer change** → Only the downstream's ACL needs updating. The upstream is unaware.
4. **partnership change** → Both domains update together. Coordinate specs.

If a cross-domain change doesn't fit any declared relationship, the context map is incomplete — add the relationship before proceeding.

## Spec file conventions

### Naming

- One spec per bounded concern: `src/issuance/credential-flow.md`
- Use the behavior name, not the implementation name: `verification-request.md` not `verify-handler.md`
- Keep iteration plans outside domain and system corpora; delete them when no longer operationally useful.

### Frontmatter

Every spec file should have YAML frontmatter:

```yaml
---
domain: issuance
status: draft | approved | stale
---
```

- `domain` — must match a domain in `domains.yaml`
- `status` — lifecycle state (`draft` → `approved` → `stale` when code outpaces spec)
- canonical term pages additionally declare `term` and may declare `aliases`

Keep normative metadata minimal. Do NOT use `last-reviewed`, delivery state, or `governs:`. Code ownership is already declared in `domains.yaml`; Git preserves review and delivery history.

### Domain-level spec

A domain MAY have a `README.md` at its code root:

```
src/issuance/
├── README.md             ← main domain spec: ubiquitous language, invariants, domain events
├── credential-flow.md    ← specific behavior spec
├── webhook-handling.md
└── ...code...
```

`README.md` is the required domain overview. Keep it concise and substantive: ubiquitous language, responsibilities, invariants, boundaries, or domain events. Do not create an overview that only repeats manifest metadata.

`README.md` does NOT duplicate information already in `domains.yaml`:
- Description
- Domain type/classification
- Code paths
- Context map relationships
- Consumer lists

### Specification DRY

Define each concept, invariant, or contract once at its narrowest semantic owner. Other specifications link to that canonical definition and describe only their local use, constraints, or consequences. Domain specifications are the default normative artifact.

Use a declared system spec only for a durable RFC 2119 requirement that cannot be assigned to one domain by subsidiarity. Keep temporary acceptance criteria, implementation scope, sequencing, rollout, migration, progress, and verification plans in non-normative iteration artifacts outside both corpora. Normative specs describe current durable behavior in the present tense; they do not preserve legacy or transitional commentary.

## Code-paths rules

`code-paths` in `domains.yaml` should be **directories, not individual files**. A code-path means "everything under this directory belongs to this domain."

### Signals that code-paths need attention

1. **Individual files listed**: If a domain lists `ui/FooScreen.kt`, `ui/BarScreen.kt` instead of `ui/foo/`, the code likely needs refactoring into subdirectories that match the domain boundary.
2. **Many subdirectories of the same parent**: If a domain lists `ui/mapper/`, `ui/model/`, `ui/components/` — the parent `ui/` probably belongs to the domain. List the parent, not each child.
3. **Overlapping paths**: Parent/child overlap is valid and the most-specific matching child owns the file. If unrelated domains claim the same path, establish one semantic owner or refactor into distinct directories.

When `/domain-tree:check` detects these patterns, it should recommend the refactoring rather than silently accepting the file-level mappings.

### Spec files live next to code, not in docs/

All behavioral specifications must live under the domain's colocated spec directory (normally the first `code` path). `README.md` and sibling Markdown with `domain`/`status` frontmatter form the normative corpus. Prompts, agent instructions, guides, plans, and historical documents without that frontmatter are non-normative. If a spec-like document exists in `docs/`, move it next to the owning domain's code; keep only non-normative material in `docs/`.

## When to create a new domain

Create a new domain when:
- New code doesn't fit any existing domain's description
- An existing domain has grown to cover two distinct responsibilities
- A technical concern (monitoring, deployment) becomes complex enough to spec

Do NOT create a new domain when:
- The code is a utility used by exactly one domain (put it in that domain)
- The code is shared across domains (add it to the shared kernel)
- The work is a one-off script (not everything needs a domain)

## When to split a domain into subdomains

Split when:
- The domain has more than 5 spec files
- Two parts of the domain can change independently
- Different people/teams own different parts
- The code already has natural package boundaries
- The ubiquitous language has started to diverge within the domain (same word, different meanings)

## Shared kernel rules

The shared kernel is the most constrained domain:

1. **Minimize the surface.** The less you share, the less coupling.
2. **Prefer value objects.** Immutable, identity-less types are safe to share. Entities with lifecycles are not.
3. **No business logic.** The kernel is types and contracts, not behavior.
4. **Explicit consumers.** The context map must list every domain that depends on the kernel.
5. **Joint approval.** No unilateral changes — all consumers must agree.
6. **Contract tests.** Every consumer maintains tests that verify the kernel's contracts.

## Technical domains vs business domains

Technical domains follow the same rules but spec different things:

| Domain type | Spec contains |
|------------|---------------|
| Business | Acceptance criteria, user behavior, data flow |
| Security | Threat model, cryptographic requirements, invariants |
| UX | Design tokens, component behavior, accessibility rules |
| Infra | Deployment topology, scaling rules, network policies |
| CI/CD | Pipeline stages, quality gates, release process |

The common thread: if it has behavior or constraints worth verifying, it gets a spec.

Technical domains CAN be `type: core` — security in a trust provider is absolutely core, even though it's not "business logic" in the traditional DDD sense.
