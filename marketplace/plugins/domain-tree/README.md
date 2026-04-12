# domain-tree

Domain-driven codebase structure — enforce 1:1 mirroring between `spec/` and code namespaces, with DDD-informed subdomain classification, context mapping, and shared kernel management.

## Philosophy

The domain tree is a structural contract informed by Domain-Driven Design. It encodes three things:

1. **Where things live** — the 1:1 namespace mirror between `spec/` and code
2. **How much rigor each domain deserves** — core vs supporting vs generic classification
3. **How domains communicate** — the context map declaring integration patterns

Domains aren't limited to business logic. Security, UX, CI/CD, and infrastructure are domains too — anything with behavior worth specifying. A technical domain like security can be `core` if it's central to the product's value.

## DDD concepts used

| Concept | How we use it |
|---------|--------------|
| **Subdomain classification** | `type: core/supporting/generic` on each domain — drives spec rigor and review requirements |
| **Bounded context** | Each domain IS a bounded context with its own ubiquitous language |
| **Context map** | `context-map:` section declaring cross-domain relationships and integration patterns |
| **Shared kernel** | `type: shared-kernel` for jointly-owned types — strictest change rules |
| **Anti-corruption layer** | Declared in context map — enforced by boundary-enforcer agent |
| **Ubiquitous language** | `language:` field in domains — terms that code and specs must use consistently |

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

The `context-map` in `spec/domains.yaml` declares how domains communicate:

```yaml
context-map:
  - from: issuance
    to: wallet
    pattern: open-host-service
    via: OpenID4VCI credential offer
  - from: wallet
    to: verification
    pattern: anti-corruption-layer
    via: mobile/shared/.../verification/acl/
```

Supported patterns: `shared-kernel`, `customer-supplier`, `conformist`, `anti-corruption-layer`, `open-host-service`, `published-language`, `partnership`, `separate-ways`.

The boundary-enforcer uses the context map to guide cross-domain changes — it knows whether to suggest "update the contract", "route through the ACL", or "notify all kernel consumers".

## Quick start

### New or existing project

```
/domain-tree:init
```

Scans your codebase, proposes domains with classifications, detects cross-domain relationships, and scaffolds `spec/` directories. Works with what exists — coverage grows organically via spec-on-touch.

### Day-to-day

- **Before coding:** Domain Navigator resolves which domain you're in, checks classification-appropriate spec requirements.
- **During coding:** Boundary enforcer consults the context map for cross-domain changes, guards shared kernel, prevents ACL bypass.
- **Periodic health check:** `/domain-tree:check` validates structure, context map, and classification gaps. `/domain-tree:map` shows coverage weighted by domain importance.

## The spec-on-touch convention

> The first time you modify a domain, write its spec.

Rigor scales with classification:
- **Core** domains: spec required before any code change
- **Shared kernel**: spec required, all consumers notified
- **Supporting** domains: warning when missing
- **Generic** domains: only when the integration boundary changes
