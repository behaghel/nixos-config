---
name: Domain Navigator
description: |
  Navigate and enforce domain-driven codebase structure. Use when the user references a domain, asks where code or specs live, wants to understand project structure, asks about domain boundaries, or when you need to locate the right spec or code for a given feature area. Also use when creating new files to ensure they land in the correct domain namespace.
---

# Domain Navigator

Provides domain-aware navigation and enforcement for codebases structured around `spec/domains.yaml`.

Load `references/manifest-schema.md` when working with `spec/domains.yaml`.
Load `references/conventions.md` when making decisions about file placement or domain boundaries.

## When to activate

- User references a domain or feature area ("the issuance flow", "wallet onboarding")
- User creates a new file and you need to decide where it belongs
- User asks "where does X live?" or "what domain owns Y?"
- Before starting spec collection (to scope which domain the spec belongs to)
- Before planning TDD iterations (to scope which domain boundaries apply)

## Core behavior

### 1. Load the domain tree

1. Read `spec/domains.yaml` at the project root.
2. If it doesn't exist, tell the user: "No domain tree found. Run `/domain-tree:init` to create one."
3. Parse the tree into a mental model of domains, subdomains, code paths, and spec paths.

### 2. Resolve domain from context

When the user describes work or you're about to modify code:

1. Match the target file(s) against `code` paths in the manifest.
2. Identify the governing domain, subdomain, and **domain type** (core/supporting/generic/shared-kernel).
3. Locate the corresponding `spec` path.
4. Report: "This is in the **[domain] > [subdomain]** namespace (type: **[type]**). Spec at `spec/[path]/`. Code at `[code paths]`."

If a file doesn't match any domain:
- Flag it: "This file isn't covered by any domain in `spec/domains.yaml`. Should we add it to an existing domain or create a new one?"

### 3. Enforce placement on new files

When creating new files:

1. Determine which domain the file belongs to based on its purpose.
2. Check that the target path is within that domain's `code` paths.
3. If it isn't, suggest the correct location: "This looks like it belongs in **[domain]**. The convention is `[correct path]`."
4. If a new subdomain is needed, propose updating `spec/domains.yaml` first.

### 4. Spec-on-touch (classification-aware)

When editing production code:

1. Resolve the governing domain and its `type`.
2. Check if a spec exists at the domain's `spec` path.
3. Apply rigor based on domain type:
   - **core** — Hard block. "No spec exists for **[domain]** (core). This domain requires a spec before any code change."
   - **supporting** — Warning. "No spec exists for **[domain]** yet. Consider writing one before this change."
   - **generic** — Soft note. "No spec for **[domain]**. Only needed if you're changing the integration boundary."
   - **shared-kernel** — Hard block. "This is shared kernel — changes affect all consumers. Spec required, and consumers must be notified."
4. If a spec exists, check its `status` field:
   - `draft` — "This spec is a draft. Verify it's accurate before implementing against it."
   - `approved` — proceed normally.
   - `stale` — "This spec may be outdated. Review it before implementation."

### 5. Cross-domain awareness (context-map-driven)

When work spans multiple domains:

1. Identify all affected domains.
2. Consult the `context-map` in `spec/domains.yaml` for the declared relationship.
3. If a relationship exists:
   - Report the pattern: "This crosses **[domain A]** → **[domain B]** (pattern: **[pattern]**)."
   - Guide based on pattern:
     - **shared-kernel**: "Both domains consume this. Update the kernel spec and notify all consumers."
     - **customer-supplier**: "**[upstream]** owns the contract. Check if the change is compatible."
     - **anti-corruption-layer**: "Changes should go through the ACL at `[via path]`, not bypass it."
     - **conformist**: "**[downstream]** conforms to **[upstream]**'s model. Update the downstream's mapping."
4. If no relationship is declared:
   - Flag it: "This crosses **[domain A]** and **[domain B]** but no relationship is declared in the context map. Add one before proceeding."
5. Note which specs need updating in each affected domain.

### 6. Shared kernel awareness

When editing code in a `shared-kernel` domain:

1. Identify all consumers from the `context-map` (domains with `pattern: shared-kernel` pointing to this domain).
2. Warn: "This is shared kernel. Changes affect: **[list of consuming domains]**."
3. Check for contract tests in each consuming domain.
4. Recommend: "Run contract tests for [consumers] after this change."

## Guardrails

- Do NOT create files outside the domain tree without flagging it.
- Do NOT let domain boundaries drift silently — every new code path should map to a domain.
- Do NOT treat `spec/domains.yaml` as documentation — it is a structural contract.
- Do NOT enforce domains on non-production files (tests, scripts, CI) unless they have their own technical domain.
- Do NOT allow cross-domain changes without consulting the context map.
- Do NOT allow shared-kernel changes without notifying all consumers.
