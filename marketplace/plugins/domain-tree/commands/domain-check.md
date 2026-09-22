---
description: Validate that the domain tree matches the actual codebase — find orphaned code, missing specs, and structural drift
allowed-tools: [Read, Glob, Grep, Bash]
---

# Check Domain Tree

Validates the structural contract between `domains.yaml` and the actual codebase.

## Instructions

### Step 1: Load manifest

1. Read `domains.yaml`.
2. If it doesn't exist: "No domain tree found. Run `/domain-tree:init` to create one."
3. Validate the complete manifest before using it. Report every path-aware schema diagnostic, including YAML line and column where available.
4. If any diagnostic exists, stop: ownership resolution, maps, and coverage must not use a partial tree.
5. For a structural-only node with children but no `code` or `spec`, recommend either explicit `kind: group` plus `domains`, or a real domain specification anchor. Never rewrite it automatically.

### Step 1b: Legacy migration prompt

If `domains.yaml` is missing but `spec/domains.yaml` exists, report the legacy layout and include this migration section before the health check:

1. Move `spec/domains.yaml` to project-root `domains.yaml`.
2. For each domain, move `spec/<domain>/index.md` to the domain's code directory as `README.md`.
3. Move other domain `*.md` files into that same colocated directory.
4. Remove old `spec:` fields or update them to explicit colocated paths.
5. Delete the old `spec/` tree once empty.

### Step 2: Check manifest → code (do declared paths exist?)

For each domain's `code` paths:

1. Verify the directory exists.
2. If it doesn't: report as **broken mapping** — "Domain **[name]** declares `[path]` but it doesn't exist. Was it renamed or removed?"

For each domain's colocated spec path (the first `code` path by default, or explicit `spec:` override):

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
3. Apply **subsidiarity** to overlapping paths — parent/child overlap is valid and the most-specific child wins. Report only unrelated domains claiming the same path as a **boundary violation**.

Also check for stale `governs:` frontmatter in spec files — if found, report as **deprecated** — "`governs:` in `[file]` is deprecated. Code ownership is declared via `code-paths` in `domains.yaml`."

Also check for **spec files outside the domain tree** — scan `docs/` for files matching `SPEC_*.md` or `*_PROTOCOL.md` patterns. Report as **misplaced spec** — "`[file]` looks like a behavioral spec but lives outside the domain code tree. Move it next to the owning domain's code."

### Step 5: Check naming alignment

1. Verify domain names in `domains.yaml` match or clearly map to their code directory names.
2. Verify subdomain nesting in the filesystem matches the YAML hierarchy where the code layout allows it.
3. Report **naming drift** if they've diverged.

### Step 6: Check context map health

1. For each semantic `context-map` entry:
   - Verify the `provider` and every entry in `consumers` exist in the tree.
   - Verify `pattern` is supported.
   - Verify the canonical `contract` path exists.
   - For `shared-kernel` patterns: verify the provider has `type: shared-kernel`.
2. Scan for **undeclared semantic contracts**:
   - Look for cross-domain APIs, events, shared models, or translation boundaries not covered by a context-map entry.
   - Do not require context-map entries for ordinary imports.
   - Report genuine undeclared coupling with the provider and consumers that need an explicit contract.
3. For `shared-kernel` domains:
   - Verify all consumers listed in context-map entries.
   - Check that each consumer has contract tests for shared types.

### Step 7: Check classification consistency

1. Verify every classified domain has a `type` field.
2. Flag core domains without specs as **high-risk gaps**.
3. Flag shared-kernel domains without consumer contract tests.

### Step 7b: Check README.md quality

For each domain's colocated specification directory:

1. Require `README.md` with `domain` and `status` frontmatter matching the fully qualified domain path.
2. Treat sibling Markdown as normative only when it has frontmatter; prompts, guides, plans, and history without frontmatter are non-normative.
3. Allow only minimal normative keys: `domain`, `status`, plus `term` and optional `aliases` on canonical term pages.
4. Check frontmatter does NOT contain `type:` (classification lives in domains.yaml).
5. Check frontmatter does NOT contain `consumers:` (consumer lists live in domains.yaml).
6. Check body does NOT contain a "Context Map Relationships" section (context map lives in domains.yaml).
7. Check body does NOT repeat the domain description from domains.yaml verbatim.
8. Reject project-management sections: roadmaps, rollout or migration plans, progress, implementation plans, delivery status, verification plans, milestones, deadlines, and assignees. Reject delivery-phase tracking and completion percentages during semantic review without banning legitimate domain lifecycle language.
9. Require durable present-tense behavior rather than legacy comparisons, transitional commentary, or temporary workarounds.
10. Report **README.md duplication** for any violations — "**[domain]** README.md duplicates information from domains.yaml: [field/section]."
11. Check that README.md has substantive content beyond the title and reference line.

### Step 7c: Check system specifications

For every file or recursively scanned directory declared in `system-specs`:

1. Require Markdown files with only `system` and `status` frontmatter.
2. Require `system` to equal `project.name`.
3. Require at least one uppercase RFC 2119 keyword: `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, or `MAY`.
4. Reject `term` and `aliases`; ubiquitous language remains domain-owned.
5. Apply the same timelessness and project-management exclusions as domain specs.
6. Ignore iteration documents outside declared domain and system corpora.

### Step 7d: Check specification wiki integrity

1. Build one case-insensitive index from canonical `term` and `aliases` frontmatter on domain-owned pages.
2. Reject labels owned by more than one page, including alias-to-term and alias-to-alias collisions across domains.
3. Validate relative links originating from normative domain and system Markdown; external URLs are outside this check.
4. Require every local target to exist and every Markdown fragment to identify a real heading anchor.
5. When link text exactly matches a canonical term or alias, require the link to target its canonical owner.
6. Treat meaningful first-occurrence linking as semantic guidance, not a lexical hard failure.

### Step 8: Check OpenAPI completeness (backend domains only)

For each backend domain (language: `go`) that has a `README.md`:

1. Scan the README.md for HTTP endpoint references (patterns like `POST /path`, `GET /path`, or endpoint descriptions).
2. For each endpoint found in README.md, check whether `schemas/openapi.yaml` declares a matching path+method.
3. Report **undeclared endpoints** — "README.md for **[domain]** describes `[METHOD] [path]` but it is not in `schemas/openapi.yaml`."

For each path in `schemas/openapi.yaml`:

1. Identify which domain owns it (via the `tags` field).
2. If the owning domain is `type: core` and has a `README.md`, check whether the README.md mentions the endpoint.
3. Report **unspecced endpoints** — "`[METHOD] [path]` is in OpenAPI (tag: [tag]) but has no behavioral spec in `[domain code path]/README.md`."

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
  - src/ux/                 ← domain declared but directory not created

⚠ Code-paths quality:
  - wallet/credentials lists 4 individual .kt files in ui/ — refactor into ui/credentials/
  - wallet/verification-flow lists 7 individual .kt files in ui/ — refactor into ui/verification/
  - wallet lists 4 subdirectories under .../android/ — consider using the parent

⚠ Deprecated governs:
  - src/issuance/README.md still uses governs: — remove, code ownership is in domains.yaml

⚠ Misplaced specs:
  - docs/VERIFICATION_PROTOCOL.md — move next to security code
  - docs/SPEC_REVOKED_CACHET_UX.md — move next to wallet credentials code or delete

⚠ Empty README.md:
  - src/wallet/onboarding/README.md — adds nothing beyond reference line
  - src/registry/README.md — adds nothing beyond reference line

⚠ Context map issues:
  - issuance → wallet (ACL): via path mobile/shared/.../acl/ does not exist
  - services/verifier/ imports services/common/crypto/ — no relationship declared

⚠ Classification gaps:
  - verification (core): no approved specs — HIGH RISK
  - common (shared-kernel): no contract tests from consumers

⚠ OpenAPI gaps:
  - src/verification/README.md describes POST /sessions — not in schemas/openapi.yaml
  - src/issuance/README.md describes GET /status/{listId} — not in schemas/openapi.yaml
  - POST /presentations/verify (tag: verifier) — no behavioral spec coverage (only generic Error)

Recommendations:
1. Update domains.yaml: issuance code path → services/issuance-gateway/
2. Create directory/spec: src/ux/README.md
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
