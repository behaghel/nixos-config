# domain-tree

Domain-driven codebase structure — enforce 1:1 mirroring between colocated domain specs and code namespaces, with DDD-informed subdomain classification, context mapping, and shared kernel management.

## Philosophy

The domain tree is a structural contract informed by Domain-Driven Design. It encodes three things:

1. **Where things live** — the 1:1 namespace mirror between domain specs and code
2. **How much rigor each domain deserves** — core vs supporting vs generic classification
3. **How domains communicate** — the context map declaring integration patterns

`domains.yaml` at the project root is the source of truth for that contract. Domain markdown files live beside the code they govern; `README.md` is the required main domain spec, and sibling Markdown is normative only when it declares `domain` and `status` frontmatter.

Domains aren't limited to business logic. Security, UX, CI/CD, and infrastructure are domains too — anything with behavior worth specifying. A technical domain like security can be `core` if it's central to the product's value.

## DDD concepts used

| Concept | How we use it |
|---------|--------------|
| **Subdomain classification** | `type: core/supporting/generic` on each domain — drives spec rigor and review requirements |
| **Bounded context** | Each domain IS a bounded context with its own ubiquitous language |
| **Context map** | `context-map:` section declaring cross-domain relationships and integration patterns |
| **Shared kernel** | `type: shared-kernel` for jointly-owned types — strictest change rules |
| **Anti-corruption layer** | Declared in context map — enforced by boundary-enforcer agent |
| **Ubiquitous language** | `language:` field in domains, with optional `<domain code path>/README.md` support — terms that code and specs must use consistently |

Ubiquitous language should be enriched on demand. Add new terms only when the domain needs sharper language, and get explicit developer approval before extending the glossary so the language stays intentional rather than drifting.

## Relationship to other plugins

This plugin is the **structural backbone** for spec-driven development:

| Plugin | Role | What domain-tree provides |
|--------|------|--------------------------|
| `spec-driven` | How to write specs | Where the spec lives, how much rigor it needs (core vs generic) |
| `spec-tdd` | How to execute specs | Which domain boundaries constrain iterations, which relationships to respect |
| `domain-tree` | Where things live | Namespace contract, classification, context map, enforcement |

Install any combination. They complement each other but don't depend on each other.

## What's included

| Component | Type | Description |
|-----------|------|-------------|
| Domain Navigator | Skill | Auto-resolves domains, enforces placement, classification-aware spec-on-touch |
| `/domain-tree:init` | Command | Bootstrap tree with classification and context map from existing codebase |
| `/domain-tree:map` | Command | Coverage dashboard with domain types and context map visualization |
| `/domain-tree:check` | Command | Structural health check including context map and classification validation |
| `boundary-enforcer` | Agent | Context-map-aware guard for cross-domain changes, ACL bypass, shared kernel |

## Domain classification

Every domain has a `type` that determines investment level:

| Type | What it means | Spec rigor |
|------|--------------|------------|
| **core** | Competitive advantage — why the project exists | Full spec collection, thorough TDD, human-approved specs |
| **supporting** | Necessary, custom-built, not differentiating | Good specs, standard TDD, self-approval OK |
| **generic** | Solved problem — use libraries/standards | Spec the integration boundary only |
| **shared-kernel** | Shared types across domains — joint ownership | High rigor, contract tests from all consumers |

## Context map

The `context-map` in `domains.yaml` declares how domains communicate:

```yaml
context-map:
  - provider: issuance
    consumers: [wallet]
    pattern: open-host-service
    contract: services/issuance-gateway/README.md
  - provider: verification
    consumers: [wallet]
    pattern: anti-corruption-layer
    contract: services/verifier/presentation/README.md
```

Supported patterns: `shared-kernel`, `customer-supplier`, `conformist`, `anti-corruption-layer`, `open-host-service`, `published-language`, `partnership`, `separate-ways`.

The boundary-enforcer uses the context map to guide cross-domain changes. Context entries are reserved for semantic contracts, not ordinary imports; the provider owns the canonical contract and consumers follow the declared pattern.

## Quick start

### New or existing project

```
/domain-tree:init
```

Scans your codebase, proposes domains with classifications, detects semantic cross-domain contracts, and scaffolds colocated `README.md` specs in each domain's code directory. Parent/child overlap follows subsidiarity: the most-specific matching child owns a file.

### Day-to-day

- **Before coding:** Domain Navigator resolves which domain you're in, checks classification-appropriate spec requirements, and keeps normal work inside one domain at a time.
- **During coding:** Boundary enforcer consults the context map for cross-domain changes, guards shared kernel, prevents ACL bypass, and helps break cross-domain work into a sequence of intra-domain tasks.
- **When work must cross domains:** Favor domain-focused subagents and finish the domain-local tasks first. The last step should be the explicit cross-domain integration and end-to-end testing pass.
- **For complex multi-domain work:** Start with a plan that the developer can challenge and approve before implementation begins.
- **Periodic health check:** `/domain-tree:check` validates structure, context map, and classification gaps. `/domain-tree:map` shows coverage weighted by domain importance.

## Migrating from the legacy `spec/` layout

The first `/domain-tree:check` on a legacy tree reports a migration section. The short version:

1. Move `spec/domains.yaml` to `domains.yaml` at the project root.
2. For each domain, move `spec/<domain>/index.md` to the domain's code directory as `README.md`.
3. Move other domain `*.md` specs into that same code directory.
4. Remove old `spec:` fields or update them to explicit colocated paths.
5. Delete the old `spec/` tree once empty.

## The spec-on-touch convention

> The first time you modify a domain, write its spec.

Rigor scales with classification:
- **Core** domains: spec required before any code change
- **Shared kernel**: spec required, all consumers notified
- **Supporting** domains: warning when missing
- **Generic** domains: only when the integration boundary changes
