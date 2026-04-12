# Domain Tree Conventions

Rules for maintaining the 1:1 mirror between `spec/` and code namespaces, informed by Domain-Driven Design.

## The mirroring principle

The directory structure under `spec/` MUST mirror the domain tree. The domain tree SHOULD mirror the code's module/package structure. When they diverge, the domain tree is the authority — refactor code to match, not the other way around.

```
spec/                          code (various roots)
├── domains.yaml               (the manifest)
├── verification/              services/verifier/
│   ├── presentation/          services/verifier/presentation/
│   └── packs/                 services/verifier/packs/
├── issuance/                  services/issuance-gateway/
├── wallet/                    mobile/shared/ + mobile/androidApp/
│   ├── onboarding/              .../onboarding/
│   └── credentials/             .../credentials/
├── common/                    services/common/          ← shared kernel
├── security/                  services/common/crypto/
└── cicd/                      .github/workflows/ + scripts/
```

## Ubiquitous language

Each domain has its own vocabulary. The same word can mean different things in different domains — that's expected and healthy. What matters is consistency WITHIN a domain.

- Define key terms in the domain's `language` field in `domains.yaml` or in `spec/{domain}/index.md`
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
| shared-kernel | `spec/common/` (the kernel domain) | The shared types, their invariants, and which domains consume them |
| customer-supplier | Upstream domain's spec | The contract — what the upstream promises and what can change |
| conformist | Downstream domain's spec | How the downstream maps upstream concepts to its own model |
| anti-corruption-layer | Downstream domain's spec | The ACL: what comes in, what comes out, where it lives in code |
| open-host-service | Upstream domain's spec | The protocol or API definition (often a published standard) |
| published-language | `spec/{domain}/` of the publisher | The schema or interchange format |

### Cross-domain changes with context map awareness

When a change spans domains, the context map tells you how to handle it:

1. **shared-kernel change** → Update the kernel spec. Notify ALL consuming domains. Run contract tests from each consumer.
2. **customer-supplier change** → Upstream changes its contract → downstream must update its conformance. Check the downstream's ACL or conformist layer.
3. **anti-corruption-layer change** → Only the downstream's ACL needs updating. The upstream is unaware.
4. **partnership change** → Both domains update together. Coordinate specs.

If a cross-domain change doesn't fit any declared relationship, the context map is incomplete — add the relationship before proceeding.

## Spec file conventions

### Naming

- One spec per bounded concern: `spec/issuance/credential-flow.md`
- Use the behavior name, not the implementation name: `verification-request.md` not `verify-handler.md`
- Plans live next to their spec: `spec/issuance/credential-flow.plan.md`

### Frontmatter

Every spec file should have YAML frontmatter:

```yaml
---
domain: issuance
status: draft | approved | stale
governs:
  - services/issuance-gateway/handler/credential.go
  - services/issuance-gateway/service/issuance.go
last-reviewed: 2026-04-12
---
```

- `domain` — must match a domain in `spec/domains.yaml`
- `status` — lifecycle state (`draft` → `approved` → `stale` when code outpaces spec)
- `governs` — specific files this spec covers (more granular than the domain's `code` paths)
- `last-reviewed` — when a human last verified accuracy

### Domain-level spec

Each domain should have an `index.md` at its root:

```
spec/issuance/
├── index.md              ← domain overview, key concepts, invariants
├── credential-flow.md    ← specific behavior spec
├── credential-flow.plan.md
└── webhook-handling.md
```

The `index.md` covers:
- Domain purpose and boundaries
- Ubiquitous language (key terms and their meanings in this domain)
- Cross-cutting invariants
- Context map relationships (which domains does this interact with, via which patterns)

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
