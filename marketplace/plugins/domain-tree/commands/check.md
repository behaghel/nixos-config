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

### Step 4: Check spec → code traceability

For spec files with `governs` frontmatter:

1. Verify each governed file exists.
2. If a governed file was deleted or renamed: report as **broken traceability**.

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

### Step 8: Report

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

⚠ Broken traceability:
  - spec/issuance/webhook.md governs services/issuance-gateway/webhook.go → file renamed to webhooks.go

⚠ Context map issues:
  - issuance → wallet (ACL): via path mobile/shared/.../acl/ does not exist
  - services/verifier/ imports services/common/crypto/ — no relationship declared

⚠ Classification gaps:
  - verification (core): no approved specs — HIGH RISK
  - common (shared-kernel): no contract tests from consumers

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
