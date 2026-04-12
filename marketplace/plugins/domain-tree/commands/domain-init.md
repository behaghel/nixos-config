---
description: Bootstrap the domain tree for an existing codebase — analyzes project structure and creates spec/domains.yaml
argument-hint: [optional: focus-area]
allowed-tools: [Read, Glob, Grep, Bash]
---

# Initialize Domain Tree

Analyzes an existing codebase and proposes a domain tree with 1:1 spec-code mirroring.

## Instructions

### Step 1: Scan the codebase

1. Read the project structure — top-level directories, build files, module definitions.
2. Identify code namespaces:
   - **Go:** packages under `services/`, `cmd/`, `internal/`, `pkg/`
   - **Kotlin/Android:** packages under `src/main/`, module directories
   - **TypeScript:** directories under `src/`, package.json workspaces
   - **Infrastructure:** `deploy/`, `terraform/`, `.github/workflows/`, `scripts/`
3. Read existing documentation:
   - Architecture docs (`docs/ARCHITECTURE.md`, `docs/*.md`)
   - API specs (`api/*.yaml`, `api/*.json`)
   - Existing specs (`spec/` if it exists)
   - README files in subdirectories
4. Read recent git history to understand which areas are actively changing.

### Step 2: Propose domains

1. Group code namespaces into domains based on:
   - **Cohesion** — code that changes together belongs together
   - **Responsibility** — each domain should have one clear purpose
   - **Naming** — prefer the language of the domain, not the implementation
2. Identify business domains (user-facing behavior):
   - Look for service boundaries, API endpoints, user flows
3. Identify technical domains (cross-cutting concerns):
   - Security, crypto, key management
   - UX, design system, theming
   - Infrastructure, deployment, networking
   - CI/CD, automation, quality gates
   - Observability, logging, monitoring
4. Identify shared code:
   - Common modules, shared types, cross-cutting utilities
   - Propose these as `type: shared-kernel` domains
5. For each proposed domain, define:
   - Name and description
   - Code paths it governs
   - Spec path (mirroring the domain name under `spec/`)
   - Whether it needs subdomains

### Step 2b: Classify domains

For each proposed domain, assign a DDD subdomain type:

1. **core** — Is this why the project exists? Does it differentiate from competitors? Does it encode the deepest domain knowledge?
2. **supporting** — Is it necessary and custom-built, but not the competitive edge?
3. **generic** — Is this a solved problem? Could you use a library or standard?
4. **shared-kernel** — Is this shared types/contracts used across multiple domains?

Ask the user for each non-obvious classification:
- "I classified **verification** as core because it encodes the trust model. Agree?"
- "**infra** looks generic — standard Cloud Run deployment. Should it be supporting instead?"

### Step 2c: Propose context map

Analyze how domains interact:

1. Look for cross-service API calls (HTTP clients, gRPC stubs).
2. Look for shared imports — modules importing from other domains.
3. Look for event publishing/subscribing patterns.
4. Look for shared type definitions.
5. For each relationship found, propose a DDD integration pattern:
   - Shared imports of common types → `shared-kernel`
   - Service A calls Service B's API → `customer-supplier` or `conformist`
   - Service uses external standard (OpenID4VCI, OAuth) → `open-host-service` / `published-language`
   - Translation layer between domains → `anti-corruption-layer`
6. Present the proposed context map and ask for confirmation.

### Step 3: Present and refine

1. Show the proposed tree as a YAML block (following `references/manifest-schema.md` format), including `type` for each domain and the `context-map`.
2. Show a visual tree comparing spec structure to code structure.
3. For each domain, explain the rationale and classification.
4. Ask targeted questions:
   - "I grouped [X] and [Y] together as **[domain]**. Should these be separate?"
   - "[Module] doesn't fit cleanly into any domain. Where should it go?"
   - "[Area] is large — should it be split into subdomains?"
   - "I classified **[domain]** as **[type]**. Does that match your sense of its importance?"
   - "I see **[domain A]** calling **[domain B]** — is that a customer-supplier relationship or should there be an ACL?"
5. Iterate until the user approves the tree, classifications, and context map.

### Step 4: Scaffold

1. Create `spec/domains.yaml` with the approved tree (including `type`, `language`, and `context-map`).
2. Create the `spec/` directory structure (empty domain directories).
3. For each domain, create a skeleton `index.md` tailored to its type:

For **core** domains:
```markdown
---
domain: <domain-name>
type: core
status: draft
last-reviewed: <today>
---

# <Domain Name>

<Description from domains.yaml>

## Ubiquitous Language

<!-- Define key terms. Code and specs MUST use these terms consistently. -->

| Term | Meaning |
|------|---------|
| | |

## Key Concepts

<!-- TODO: define domain concepts, aggregates, and their relationships -->

## Invariants

<!-- TODO: what must never break in this domain -->

## Context Map Relationships

<!-- TODO: which other domains does this interact with, via which patterns -->

## Domain Events

<!-- TODO: what events does this domain publish or consume -->
```

For **supporting/generic** domains, use a lighter skeleton (omit ubiquitous language and domain events sections).

For **shared-kernel** domains:
```markdown
---
domain: <domain-name>
type: shared-kernel
status: draft
last-reviewed: <today>
consumers: [list, of, consuming, domains]
---

# <Domain Name>

<Description from domains.yaml>

## Shared Types

<!-- TODO: list every type in the kernel and which domains consume it -->

## Change Rules

- No unilateral changes — all consumers must agree
- Contract tests required from each consumer
- Prefer value objects over entities
```

### Step 5: Seed from existing artifacts

For domains that already have documentation or specs:

1. **OpenAPI files** → Extract endpoint descriptions into the domain's spec as behavioral requirements.
2. **Architecture docs** → Extract relevant sections into domain `index.md` files.
3. **Test suites** → Note which domains have test coverage (for the coverage map).
4. **CLAUDE.md / AGENTS.md** → Extract domain-relevant guidelines.

Mark all seeded content as `status: draft` — it needs human review before it's authoritative.

### Step 6: Report coverage

Show a summary:

```
Domain Tree Coverage Report

Domain                  Spec    Tests   Code    Status
────────────────────────────────────────────────────────
verification/present.   draft   ✓ 12    ✓       ready to spec
verification/packs      draft   ✓ 8     ✓       ready to spec
issuance                draft   ✓ 23    ✓       ready to spec
registry                draft   ✓ 5     ✓       ready to spec
wallet/onboarding       —       —       ✓       needs spec
wallet/credentials      —       ✓ 3     ✓       needs spec
security                draft   ✓ 7     ✓       ready to spec
ux                      —       —       ✓       needs spec
infra                   —       —       ✓       low priority
cicd                    —       —       ✓       low priority
```

Tell the user: "The domain tree is scaffolded. Specs will fill in naturally as you work — the spec-on-touch convention means the first time you modify a domain, you write its spec."

## Rules

- Do NOT invent domains for code that doesn't exist — map what's there
- Do NOT create too many domains — start coarse, split later when pain emerges
- Do NOT spec everything now — scaffold empty structure, fill on touch
- Prefer fewer domains (5-10) over many granular ones — you can always split
- Every domain must have at least one code path — no spec-only domains
