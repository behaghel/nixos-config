import assert from "node:assert/strict";
import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findAmbiguousCodeMappings,
  findContextMapIssues,
  flattenDomains,
  parseDomainsYaml,
  resolveDomainForFilePath,
  specDirForEntry,
  entryForResolution,
  validateNormativeSpecContent,
} from "../pi/domain-core.ts";

const manifest = `
domains:
  business:
    type: core
    subdomains:
      time-management:
        type: core
        code:
          - src/business/time-management/
          - src/business/time-management/meeting-attention/
        subdomains:
          meeting-attention:
            type: core
            code: [src/business/time-management/meeting-attention/]

      noise-management:
        type: core
        code: [src/business/noise-management/]
        subdomains:
          surface-scanning:
            type: core
            code: [src/business/noise-management/]
            spec: src/business/noise-management/surface-scanning/
          email-triage:
            type: core
            code: [src/business/noise-management/]
            spec: src/business/noise-management/email-triage/

context-map:
  - provider: business/noise-management
    consumers: [business/time-management, business/noise-management/email-triage]
    pattern: customer-supplier
    contract: src/business/noise-management/README.md
`;

const root = await mkdtemp(join(tmpdir(), "domain-tree-nested-"));
try {
  await mkdir(join(root, "src/business/time-management/meeting-attention"), { recursive: true });
  await mkdir(join(root, "src/business/noise-management/surface-scanning"), { recursive: true });
  await mkdir(join(root, "src/business/noise-management/email-triage"), { recursive: true });
  await writeFile(join(root, "src/business/noise-management/surface-scanning/README.md"), "# Surface scanning\n");
  await writeFile(join(root, "src/business/noise-management/email-triage/README.md"), "# Email triage\n");

  const domains = parseDomainsYaml(manifest);
  const labels = flattenDomains(domains).map((node) => node.path.join(" > "));
  assert.deepEqual(labels, [
    "business",
    "business > time-management",
    "business > time-management > meeting-attention",
    "business > noise-management",
    "business > noise-management > surface-scanning",
    "business > noise-management > email-triage",
  ]);

  assert.deepEqual(
    resolveDomainForFilePath("src/business/time-management/calendar-scheduling.ts", root, domains),
    { domain: "business", subdomain: "time-management", type: "core" },
  );

  assert.deepEqual(
    resolveDomainForFilePath("src/business/time-management/meeting-attention/README.md", root, domains),
    { domain: "business", subdomain: "time-management > meeting-attention", type: "core" },
  );

  assert.deepEqual(
    resolveDomainForFilePath("src/business/noise-management/worker.ts", root, domains),
    { domain: "business", subdomain: "noise-management", type: "core" },
  );

  const surface = resolveDomainForFilePath("src/business/noise-management/surface-scanning/README.md", root, domains);
  assert.deepEqual(surface, { domain: "business", subdomain: "noise-management > surface-scanning", type: "core" });
  const surfaceEntry = entryForResolution(domains, surface);
  assert.equal(specDirForEntry(root, surfaceEntry), join(root, "src/business/noise-management/surface-scanning/"));

  const ambiguous = findAmbiguousCodeMappings(domains).join("\n");
  assert.match(ambiguous, /src\/business\/noise-management/);
  assert.match(ambiguous, /surface-scanning/);
  assert.match(ambiguous, /email-triage/);
  assert.doesNotMatch(ambiguous, /noise-management, business > noise-management >/);

  assert.deepEqual(domains._contextEntries, [
    {
      provider: "business/noise-management",
      consumers: [
        "business/time-management",
        "business/noise-management/email-triage",
      ],
      pattern: "customer-supplier",
      contract: "src/business/noise-management/README.md",
    },
  ]);
  assert.deepEqual(findContextMapIssues(domains), []);

  const invalidContext = parseDomainsYaml(`${manifest}\n  - provider: business/missing\n    consumers: [business/also-missing]\n    pattern: invented\n`);
  assert.deepEqual(findContextMapIssues(invalidContext), [
    "Context provider `business/missing` is not declared in the domain tree.",
    "Context consumer `business/also-missing` is not declared in the domain tree.",
    "Context relationship `business/missing` uses unsupported pattern `invented`.",
    "Context relationship `business/missing` has no canonical contract path.",
  ]);

  const parentChildOnly = parseDomainsYaml(`
domains:
  business:
    type: core
    code: [src/business/]
    subdomains:
      time-management:
        type: core
        code: [src/business/]
        spec: src/business/time-management/
`);
  assert.deepEqual(findAmbiguousCodeMappings(parentChildOnly), []);

  const grouped = parseDomainsYaml(`
project:
  name: grouped-project
domains:
  business:
    kind: group
    description: >-
      Business capabilities grouped for navigation.
    domains:
      operations:
        kind: group
        domains:
          time-management:
            description: "Allocation of attention over time"
            type: core
            code: [src/business/time-management/]
  foundation:
    kind: group
    domains:
      persistence:
        type: supporting
        code:
          - src/foundation/persistence/
context-map:
  - provider: foundation/persistence
    consumers: [business]
    pattern: customer-supplier
    contract: src/foundation/persistence/README.md
`);
  assert.deepEqual(
    flattenDomains(grouped).map((node) => node.path.join("/")),
    ["business/operations/time-management", "foundation/persistence"],
  );
  assert.deepEqual(
    resolveDomainForFilePath(
      "src/business/time-management/calendar.ts",
      root,
      grouped,
    ),
    {
      domain: "business",
      subdomain: "operations > time-management",
      type: "core",
    },
  );
  assert.equal(
    entryForResolution(grouped, {
      domain: "foundation",
      subdomain: "persistence",
      type: "supporting",
    })?.name,
    "persistence",
  );
  assert.equal(
    entryForResolution(grouped, {
      domain: "business",
      subdomain: "operations > time-management",
      type: "core",
    })?.description,
    "Allocation of attention over time",
  );
  assert.deepEqual(findContextMapIssues(grouped), [
    "Context consumer `business` is not declared in the domain tree.",
  ]);

  assert.deepEqual(
    validateNormativeSpecContent(
      "---\ndomain: business/time-management\nstatus: approved\n---\n# Time management\n",
      "business/time-management",
      true,
    ),
    [],
  );
  assert.deepEqual(
    validateNormativeSpecContent(
      "---\ndomain: business/time-management\nstatus: approved\nlast-reviewed: 2026-01-01\n---\n# Time management\n",
      "business/time-management",
      true,
    ),
    ["Unsupported normative frontmatter key `last-reviewed`."],
  );
  assert.deepEqual(
    validateNormativeSpecContent(
      "---\ndomain: business/time-management\nstatus: active\n---\n# Invalid status\n",
      "business/time-management",
      true,
    ),
    ["Normative frontmatter `status` must be `draft`, `approved`, or `stale`."],
  );
  assert.deepEqual(
    validateNormativeSpecContent("# Missing metadata\n", "business/time-management", true),
    ["README.md must declare normative frontmatter with `domain` and `status`."],
  );
  assert.deepEqual(
    validateNormativeSpecContent("# Non-normative guide\n", "business/time-management", false),
    [],
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
