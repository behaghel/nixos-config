---
description: Validate that the domain tree matches the actual codebase — find orphaned code, missing specs, and structural drift
allowed-tools: [Read, Glob, Grep, Bash]
---

# Check Domain Tree

Validates the structural contract between `spec/domains.yaml` and the actual codebase.

## Instructions

### Step 1: Load manifest

1. Read `spec/domains.yaml`.
2. If it doesn't exist: "No domain tree found. Run `/domain-tree:init` to create one."

### Step 2: Check manifest → code (do declared paths exist?)

For each domain's `code` paths:

1. Verify the directory exists.
2. If it doesn't: report as **broken mapping** — "Domain **[name]** declares `[path]` but it doesn't exist. Was it renamed or removed?"

For each domain's `spec` path:

1. Verify the directory exists.
2. If it doesn't: report as **missing spec directory** — "Domain **[name]** has no spec directory at `[path]`."

### Step 3: Check code → manifest (is all production code covered?)

1. Find all production code directories (not test, vendor, generated, or build output).
2. For each directory, check if it falls under any domain's `code` paths.
3. Report **orphaned code** — production code not governed by any domain.

Exclude from orphan detection:
- Files in project root (go.mod, package.json, etc.)
- Generated code directories
- Vendor/dependency directories
- Build output directories

### Step 4: Check code-paths quality

For each domain's `code-paths`:

1. Flag **individual files** (not directories) as **refactoring signal** — "Domain **[name]** lists individual file `[path]`. Consider refactoring into a subdirectory that matches the domain boundary."
2. Flag **many subdirectories of the same parent** — if 3+ paths share the same parent directory, suggest listing the parent instead: "Domain **[name]** lists [N] paths under `[parent/]` — consider using the parent directory."
3. Flag **overlapping paths** — if two domains claim paths in the same directory, report as **boundary violation**.

Also check for stale `governs:` frontmatter in spec files — if found, report as **deprecated** — "`governs:` in `[file]` is deprecated. Code ownership is declared via `code-paths` in `domains.yaml`."

Also check for **spec files outside the domain tree** — scan `docs/` for files matching `SPEC_*.md` or `*_PROTOCOL.md` patterns. Report as **misplaced spec** — "`[file]` looks like a behavioral spec but lives outside `spec/`. Move it to `spec/{domain}/`."

### Step 5: Check naming alignment

1. Verify domain names in `spec/domains.yaml` match their directory names under `spec/`.
2. Verify subdomain nesting in the filesystem matches the YAML hierarchy.
3. Report **naming drift** if they've diverged.

### Step 6: Check context map health

1. For each `context-map` entry:
   - Verify both `from` and `to` domains exist in the tree.
   - For `anti-corruption-layer` patterns: check the `via` code path exists.
   - For `shared-kernel` patterns: verify the kernel domain has `type: shared-kernel`.
2. Scan for **undeclared relationships**:
   - Look for cross-domain imports (Go imports, Kotlin imports) not covered by any context-map entry.
   - Report as **undeclared coupling**: "**[domain A]** imports from **[domain B]** but no relationship is declared."
3. For `shared-kernel` domains:
   - Verify all consumers listed in context-map entries.
   - Check that each consumer has contract tests for shared types.

### Step 7: Check classification consistency

1. Verify every domain has a `type` field.
2. Flag core domains without specs as **high-risk gaps**.
3. Flag shared-kernel domains without consumer contract tests.

### Step 7b: Check index.md quality

For each `index.md` file under `spec/`:

1. Check frontmatter does NOT contain `type:` (classification lives in domains.yaml).
2. Check frontmatter does NOT contain `consumers:` (consumer lists live in domains.yaml).
3. Check body does NOT contain a "Context Map Relationships" section (context map lives in domains.yaml).
4. Check body does NOT repeat the domain description from domains.yaml verbatim.
5. Report **index.md duplication** for any violations — "**[domain]** index.md duplicates information from domains.yaml: [field/section]."
6. Check if the index.md has substantive content beyond the title and reference line (ubiquitous language, invariants, domain events). If it only contains a heading and a reference line, report as **empty index.md** — "**[domain]** index.md adds no content beyond the reference line. Consider deleting it."

`index.md` is optional. Do NOT flag domains that lack one — only flag ones that exist but add nothing.

### Step 8: Check OpenAPI completeness (backend domains only)

For each backend domain (language: `go`) that has a `spec.md`:

1. Scan the spec.md for HTTP endpoint references (patterns like `POST /path`, `GET /path`, or endpoint descriptions).
2. For each endpoint found in spec.md, check whether `schemas/openapi.yaml` declares a matching path+method.
3. Report **undeclared endpoints** — "spec.md for **[domain]** describes `[METHOD] [path]` but it is not in `schemas/openapi.yaml`."

For each path in `schemas/openapi.yaml`:

1. Identify which domain owns it (via the `tags` field).
2. If the owning domain is `type: core` and has a `spec.md`, check whether the spec.md mentions the endpoint.
3. Report **unspecced endpoints** — "`[METHOD] [path]` is in OpenAPI (tag: [tag]) but has no behavioral spec in `spec/[domain]/spec.md`."

Also check:

- If `schemas/openapi.yaml` does not exist, skip this step with a note.
- Flag OpenAPI error responses that use only the generic `Error` schema without domain-specific error codes, for core domain endpoints.

### Step 9: Report

```
Domain Tree Health Check
────────────────────────

✓ Passed: [N] domains verified
✓ Passed: [N] spec directories exist
✓ Passed: [N] context-map relationships verified

⚠ Broken mappings:
  - issuance.code[1]: services/issuance/ → renamed to services/issuance-gateway/

⚠ Orphaned code (not in any domain):
  - services/relay/         ← should this be its own domain?
  - scripts/benchmarks/     ← consider adding to cicd domain

⚠ Missing spec directories:
  - spec/ux/                ← domain declared but directory not created

⚠ Code-paths quality:
  - wallet/credentials lists 4 individual .kt files in ui/ — refactor into ui/credentials/
  - wallet/verification-flow lists 7 individual .kt files in ui/ — refactor into ui/verification/
  - wallet lists 4 subdirectories under .../android/ — consider using the parent

⚠ Deprecated governs:
  - spec/issuance/spec.md still uses governs: — remove, code ownership is in domains.yaml

⚠ Misplaced specs:
  - docs/VERIFICATION_PROTOCOL.md — move to spec/security/
  - docs/SPEC_REVOKED_CACHET_UX.md — move to spec/wallet/credentials/ or delete

⚠ Empty index.md:
  - spec/wallet/onboarding/index.md — adds nothing beyond reference line
  - spec/registry/index.md — adds nothing beyond reference line

⚠ Context map issues:
  - issuance → wallet (ACL): via path mobile/shared/.../acl/ does not exist
  - services/verifier/ imports services/common/crypto/ — no relationship declared

⚠ Classification gaps:
  - verification (core): no approved specs — HIGH RISK
  - common (shared-kernel): no contract tests from consumers

⚠ OpenAPI gaps:
  - spec/verification/spec.md describes POST /sessions — not in schemas/openapi.yaml
  - spec/issuance/spec.md describes GET /status/{listId} — not in schemas/openapi.yaml
  - POST /presentations/verify (tag: verifier) — no behavioral spec coverage (only generic Error)

Recommendations:
1. Update domains.yaml: issuance code path → services/issuance-gateway/
2. Create directory: spec/ux/
3. Add domain for: services/relay/
4. Add context-map entry: verification → common (shared-kernel)
5. PRIORITY: spec core domain verification — it has no approved specs
```

## Rules

- Do NOT automatically fix issues — report them for the user to decide
- Distinguish structural drift (needs manifest update) from genuine orphans (needs new domain)
- Keep the check fast — use glob and directory existence, not file content reading
- Prioritize core and shared-kernel issues over supporting/generic
- Exit with a clear pass/fail: "N issues found" or "All checks passed"
