---
description: Visualize the domain tree with spec coverage, test coverage, and staleness indicators
allowed-tools: [Read, Glob, Grep, Bash]
---

# Domain Map

Shows the current state of the domain tree — what's specced, what's tested, what's stale.

## Instructions

### Step 1: Load the manifest

1. Read `spec/domains.yaml`.
2. If it doesn't exist: "No domain tree found. Run `/domain-tree:init` to create one."

### Step 2: Check each domain

For each domain (and subdomain) in the tree:

1. **Spec coverage:**
   - Check if the `spec` path exists and contains `.md` files
   - Read frontmatter `status` from each spec file
   - Count: total specs, approved, draft, stale

2. **Code coverage:**
   - Check if the `code` paths exist
   - Estimate size: count `.go`, `.kt`, `.ts` files (whatever is relevant)

3. **Test coverage:**
   - Look for test files in or near the code paths (`*_test.go`, `*Test.kt`, `*.test.ts`)
   - Count test files

4. **Staleness:**
   - Compare `last-reviewed` dates in spec frontmatter against recent git commits in the code paths
   - If code changed significantly after the last review, mark as potentially stale

### Step 3: Present the map

```
Domain Tree — <project name>
Generated: <date>

Domain                     Type        Specs  Status     Tests  Last Changed  Alert
──────────────────────────────────────────────────────────────────────────────────────
verification/              core
  presentation                        2      approved   12     3 days ago
  packs                               1      approved   8      1 week ago
issuance                   core       3      approved   23     today         ⚠ spec may be stale
registry                   supporting 1      draft      5      2 weeks ago
receipts                   supporting 0      —          2      1 month ago   ○ needs spec
common                     kernel     0      —          0      2 weeks ago   ● needs spec (shared)
wallet/                    core
  onboarding                          1      draft      0      5 days ago    ○ needs tests
  credentials                         2      approved   3      today
  verification-flow                   0      —          0      3 days ago    ○ needs spec
security                   core       1      approved   7      1 week ago
ux                         supporting 0      —          0      2 weeks ago   ○ needs spec
infra                      generic    0      —          0      1 month ago
cicd                       generic    0      —          0      3 weeks ago

Context Map:
  issuance ──open-host──→ wallet        (OpenID4VCI)
  wallet ──acl──→ verification          (mobile/shared/.../acl/)
  verification ──customer──→ registry   (GET /policy/manifest)
  issuance ──kernel──→ common           (credential types)
  verification ──kernel──→ common       (credential types)
  receipts ──customer──→ verification   (consent events)

Legend: ⚠ = stale spec   ○ = no spec   ● = shared kernel needs spec
```

### Step 4: Recommendations

Based on the map, suggest priorities weighted by domain type:

1. **Core domains without specs** — highest priority. These are the competitive advantage and must be specced.
2. **Shared kernel without specs** — high priority. Changes ripple everywhere.
3. **Stale specs in core domains** — "Review `spec/issuance/` — core domain code changed since last review."
4. **Active supporting domains without specs** — medium priority if recently active.
5. **Undeclared context-map relationships** — if cross-domain imports exist without a declared relationship, flag them.
6. **Generic/dormant domains** — low priority for catchup.

## Rules

- Do NOT read every file in the codebase — use glob counts and git log, not exhaustive reads
- Keep the output concise — one line per domain/subdomain
- Surface the actionable items, don't just report status
