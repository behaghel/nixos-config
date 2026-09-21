# Domain Manifest Schema

The domain manifest lives at `domains.yaml` and is the structural contract between specs and code. It encodes the domain tree, subdomain classifications, and the context map.

## Structure

```yaml
# domains.yaml

# Optional project-level metadata
project:
  name: my-project
  description: One-line project description

# The domain tree
domains:
  <domain-name>:
    description: What this domain is responsible for
    type: core | supporting | generic | shared-kernel  # default: supporting
    status: active | deprecated | planned              # default: active
    owners: [team-or-person]                           # optional
    language:                                          # optional: ubiquitous language
      - term: Cachet
        meaning: A privacy-preserving trust badge issued after credential verification

    # Code paths (leaf domain). Specs live in the first code path by default.
    code: [path/to/code/, another/path/]
    # Optional override when specs cannot live in the first code path:
    spec: path/to/code/

    # OR subdomains (branch domain)
    subdomains:
      <subdomain-name>:
        description: ...
        type: core | supporting | generic    # inherits from parent if omitted
        code: [path/to/code/]
        # Optional override; otherwise specs live in path/to/code/.
        # subdomains can nest further

# Cross-context relationships
context-map:
  - provider: <fully-qualified/domain-name>
    consumers: [<fully-qualified/consumer-name>]
    pattern: <relationship-pattern>
    contract: <canonical spec path>
```

## Domain classification

Every domain has a `type` that determines how much modeling rigor it deserves. This comes from DDD's subdomain classification:

| Type | What it means | Spec rigor | Example |
|------|--------------|------------|---------|
| **core** | Competitive advantage. The reason the project exists. | High — thorough specs, careful TDD, deep modeling | verification, issuance |
| **supporting** | Necessary, custom-built, but not differentiating. | Moderate — good specs, standard TDD | registry, receipts |
| **generic** | Solved problem. Use existing solutions where possible. | Light — spec the integration, not the internals | auth, email, payment |
| **shared-kernel** | Shared types and contracts across domains. Joint ownership. | High — changes affect all consumers, must be explicit | common types, shared events |

### How classification drives behavior

- **spec-on-touch**: Core domains require a spec before any code change. Supporting domains get a warning. Generic domains only need an integration spec.
- **spec-driven collection**: Core domains get the full 6-phase treatment. Supporting domains can use a lighter format. Generic domains spec only the boundary.
- **spec-tdd planning**: Core domains get thorough iteration plans. Supporting domains can take larger slices. Generic domains focus on contract tests.
- **code review**: Core domain specs need human approval before implementation. Supporting specs can be self-approved.

## Context map

The `context-map` section declares semantic contracts between domains. Each entry names one provider, one or more consumers, an integration pattern, and the canonical contract. Ordinary imports do not require context-map entries.

### Relationship patterns

| Pattern | Meaning | What to spec |
|---------|---------|-------------|
| **shared-kernel** | Both domains share a small, explicit set of types. Changes require agreement from both. | The shared types themselves — what's in the kernel and what's not |
| **customer-supplier** | Upstream domain provides what downstream needs. Downstream can negotiate. | The API contract between them — what's promised, what can change |
| **conformist** | Downstream accepts upstream's model as-is. No negotiation. | Only the downstream's usage — how it maps upstream concepts to its own |
| **anti-corruption-layer** | Downstream translates upstream's model to protect its own. | The translation layer — what comes in, what comes out, where the ACL lives |
| **open-host-service** | Upstream exposes a general-purpose protocol for many consumers. | The protocol spec (often an existing standard like OpenID4VCI) |
| **published-language** | A shared, documented interchange format. Often paired with open-host-service. | The schema or format definition |
| **separate-ways** | No integration. Domains are independent. | Nothing — but document WHY they're separate |
| **partnership** | Two domains evolve together with coordinated planning. | Joint specs that cover the shared evolution |

### How the context map drives behavior

- **boundary-enforcer**: When a cross-domain change is detected, consult the context map. The provider owns the canonical `contract`; consumers follow the declared pattern.
- **domain-tree:check**: Validate that providers and consumers exist, patterns are supported, and canonical contract paths resolve.
- **spec-driven collection**: When speccing a domain that consumes another, the context map tells you which integration pattern to follow — and therefore what to spec.

## Path rules

- `code` paths are relative to project root, always end with `/`.
- The most-specific matching child path owns a file. Parent/child overlap is valid; unrelated domains cannot claim the same path.
- Specs live next to code. The first `code` path is the default spec directory; `README.md` is the required main domain spec.
- `spec` is optional and only overrides the inferred spec directory when specs cannot live in the first `code` path.
- A domain is either a **leaf** (has `code`) or a **branch** (has `subdomains`)
- Branch domains may also have `code` + `spec` for domain-level concerns (shared types, domain events)

## Domain types

Domains are not limited to business logic. The tree covers everything with behavior worth specifying:

| Category | Examples | What gets specced |
|----------|----------|------------------|
| **Business** | verification, issuance, registry | User-facing behavior, acceptance criteria |
| **Technical** | security, crypto, infra | Architectural constraints, invariants |
| **Platform** | ux, cicd, observability | Conventions, patterns, tooling behavior |
| **Integration** | webhooks, external-apis | Contract specs, error handling |

Domain category is about WHAT it covers. Domain type (core/supporting/generic) is about HOW MUCH rigor it deserves. They're orthogonal — a technical domain like security can be `core`.

## Naming conventions

- Domain names: lowercase, hyphenated (`issuance-gateway`, `receipts-log`)
- Match existing module/package names where possible
- Prefer domain language over implementation language ("verification" not "verifier-service")

## Coverage

Not every file needs to be in a domain. Exclude:
- Generated files (build output, lock files)
- Configuration that doesn't encode behavior (.editorconfig, .gitignore)
- Third-party code (vendor/, node_modules/)

Everything else should map to a domain. Unmapped production code is a smell.

## Example

```yaml
project:
  name: cachet
  description: Privacy-preserving trust provider

domains:
  verification:
    description: Credential presentation and cach'pack verification
    type: core
    language:
      - term: Cach'Pack
        meaning: Reusable, privacy-preserving credential template
      - term: Presentation
        meaning: Verifiable credential bundle verified against a policy
    subdomains:
      presentation:
        description: Verify credential presentations against policies
        code: [services/verifier/presentation/]
      packs:
        description: Cach'pack list management and definitions
        code: [services/verifier/packs/]

  issuance:
    description: OpenID4VCI credential issuance via Veriff
    type: core
    code: [services/issuance-gateway/]

  registry:
    description: Policy and pack registry with DID-signed manifests
    type: supporting
    code: [services/registry/]

  receipts:
    description: Consent receipts and transparency logging
    type: supporting
    code: [services/receipts-log/]

  wallet:
    description: Mobile wallet application
    type: core
    subdomains:
      onboarding:
        description: First-run experience and identity verification
        code: [mobile/shared/.../onboarding/, mobile/androidApp/.../onboarding/]
      credentials:
        description: Credential storage, display, and management
        code: [mobile/shared/.../credentials/, mobile/androidApp/.../credentials/]
      verification-flow:
        description: QR scan, consent, presentation flow
        code: [mobile/shared/.../verification/, mobile/androidApp/.../verification/]

  common:
    description: Shared types, value objects, and contracts across services
    type: shared-kernel
    code: [services/common/]

  security:
    description: Cryptographic operations, key management, threat model
    type: core
    code: [services/common/crypto/]

  ux:
    description: Design system, theming, shared UI components
    type: supporting
    code: [mobile/androidApp/.../ui/theme/, mobile/androidApp/.../ui/components/]

  infra:
    description: Deployment, Cloud Run, networking, service mesh
    type: generic
    code: [deploy/, terraform/]

  cicd:
    description: CI/CD pipelines, pre-commit hooks, release automation
    type: generic
    code: [.github/workflows/, scripts/]

context-map:
  - provider: issuance
    consumers: [wallet]
    pattern: open-host-service
    contract: services/issuance-gateway/README.md

  - provider: verification
    consumers: [wallet]
    pattern: anti-corruption-layer
    contract: services/verifier/presentation/README.md

  - provider: registry
    consumers: [verification]
    pattern: customer-supplier
    contract: services/registry/README.md

  - provider: common
    consumers: [issuance, verification]
    pattern: shared-kernel
    contract: services/common/README.md
```

## Lifecycle

1. **Init** — `/domain-tree:init` proposes the initial tree from codebase analysis
2. **Classify** — Assign core/supporting/generic to each domain based on business value
3. **Map** — Declare cross-context relationships in `context-map`
4. **Grow** — Add domains/subdomains as the project evolves
5. **Split** — When a domain gets too large, split into subdomains
6. **Deprecate** — Mark domains `status: deprecated` before removing
7. **Validate** — `/domain-tree:check` verifies the tree matches reality
