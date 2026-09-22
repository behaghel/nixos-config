import assert from "node:assert/strict";
import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import domainTreeExtension from "../pi/extension.ts";
import {
  DomainManifestError,
  buildTermIndex,
  findAmbiguousCodeMappings,
  findContextMapIssues,
  flattenDomains,
  parseDomainManifest,
  parseDomainsYaml,
  resolveDomainForFilePath,
  resolveTerm,
  specDirForEntry,
  entryForResolution,
  validateNormativeSpecContent,
  validateSpecificationWiki,
  validateSystemSpecContent,
} from "../pi/domain-core.ts";

const manifest = `
domains:
  business:
    type: core
    spec: src/business/
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

  const invalidContext = parseDomainManifest(`${manifest}\n  - provider: business/missing\n    consumers: [business/also-missing]\n    pattern: invented\n`);
  assert.equal(invalidContext.domains, null);
  assert.match(
    invalidContext.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
    /Context provider `business\/missing` is not declared/,
  );
  assert.match(
    invalidContext.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
    /unsupported pattern `invented`/,
  );

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
    consumers: [business/operations/time-management]
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
  assert.deepEqual(findContextMapIssues(grouped), []);

  const invalidManifest = parseDomainManifest(`
project:
  name: invalid-project
  unexpected: true
system-specs: [../outside/]
domains:
  business:
    kind: group
    type: core
    code: [src/business/]
    domains:
      time-management:
        type: essential
        status: shipping
        codes: [src/business/time-management/]
context-map:
  - provider: business
    consumers: foundation/persistence
    pattern: invented
    contract: 42
    notes: legacy shape
`);
  assert.equal(invalidManifest.domains, null);
  assert.match(
    invalidManifest.diagnostics.map((diagnostic) => diagnostic.path).join("\n"),
    /project\.unexpected/,
  );
  assert.match(
    invalidManifest.diagnostics.map((diagnostic) => diagnostic.path).join("\n"),
    /system-specs\[0\]/,
  );
  assert.match(
    invalidManifest.diagnostics.map((diagnostic) => diagnostic.path).join("\n"),
    /domains\.business\.type/,
  );
  assert.match(
    invalidManifest.diagnostics.map((diagnostic) => diagnostic.path).join("\n"),
    /domains\.business\.code/,
  );
  assert.match(
    invalidManifest.diagnostics.map((diagnostic) => diagnostic.path).join("\n"),
    /domains\.business\.domains\.time-management\.codes/,
  );
  assert.match(
    invalidManifest.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
    /Declare `kind: group`, or provide a domain specification anchor/,
  );
  assert.match(
    invalidManifest.diagnostics.map((diagnostic) => diagnostic.path).join("\n"),
    /context-map\[0\]\.notes/,
  );
  const locatedTypeDiagnostic = invalidManifest.diagnostics.find(
    (diagnostic) => diagnostic.path === "domains.business.domains.time-management.type",
  );
  assert.equal(typeof locatedTypeDiagnostic.line, "number");
  assert.equal(typeof locatedTypeDiagnostic.column, "number");

  const malformedManifest = parseDomainManifest("domains:\n  broken: [\n");
  assert.equal(malformedManifest.domains, null);
  assert.equal(malformedManifest.diagnostics[0].path, "domains.yaml");
  assert.equal(typeof malformedManifest.diagnostics[0].line, "number");
  assert.equal(typeof malformedManifest.diagnostics[0].column, "number");

  assert.throws(
    () => parseDomainsYaml("domains:\n  orphan:\n    subdomains: {}\n"),
    (error) =>
      error instanceof DomainManifestError &&
      error.diagnostics.some((diagnostic) =>
        diagnostic.message.includes("Declare `kind: group`")
      ),
  );

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
  assert.deepEqual(
    validateNormativeSpecContent(
      "---\ndomain: business/time-management\nstatus: approved\n---\n# Time management\n\n## Roadmap\n\nShip later.\n",
      "business/time-management",
      false,
    ),
    ["Normative specifications must not contain a `Roadmap` section."],
  );
  assert.deepEqual(
    validateSystemSpecContent(
      "---\nsystem: grouped-project\nstatus: approved\n---\n# Safety\n\nThe system MUST fail closed.\n",
      "grouped-project",
    ),
    [],
  );
  assert.deepEqual(
    validateSystemSpecContent(
      "---\nsystem: another-project\nstatus: approved\nterm: Unsafe term\n---\n# Safety\n\n## Verification Plan\n\nCheck it later.\n",
      "grouped-project",
    ),
    [
      "Unsupported system-spec frontmatter key `term`.",
      "System frontmatter must identify `grouped-project`.",
      "System specifications must contain at least one RFC 2119 requirement keyword.",
      "Normative specifications must not contain a `Verification Plan` section.",
    ],
  );
  assert.deepEqual(
    validateNormativeSpecContent(
      "---\ndomain: business/time-management\nstatus: approved\nterm: Event\naliases: events\n---\n# Event\n",
      "business/time-management",
      false,
    ),
    ["Normative frontmatter `aliases` must be a list of strings."],
  );

  const wikiDocuments = [
    {
      path: "src/noise/blip.md",
      domain: "business/noise",
      content: "---\ndomain: business/noise\nstatus: approved\nterm: Blip\naliases: [blips]\n---\n# Blip\n",
    },
    {
      path: "src/operator/operator.md",
      domain: "business/operator",
      content: "---\ndomain: business/operator\nstatus: approved\nterm: Operator\naliases: [operator]\n---\n# Operator\n",
    },
  ];
  const termIndex = buildTermIndex(wikiDocuments);
  assert.deepEqual(termIndex.diagnostics, []);
  assert.deepEqual(resolveTerm(termIndex, "BLIPS"), {
    canonicalTerm: "Blip",
    matchedAlias: "blips",
    domain: "business/noise",
    path: "src/noise/blip.md",
  });
  const duplicateTerms = buildTermIndex([
    ...wikiDocuments,
    {
      path: "src/other/blips.md",
      domain: "business/other",
      content: "---\ndomain: business/other\nstatus: approved\nterm: blips\n---\n# Other blips\n",
    },
  ]);
  assert.match(duplicateTerms.diagnostics[0].message, /already owned by/);

  await mkdir(join(root, "wiki"), { recursive: true });
  await writeFile(join(root, "wiki/blip.md"), "# Blip\n\n## Invariants\n");
  await writeFile(join(root, "wiki/wrong.md"), "# Wrong\n");
  const wikiIssues = await validateSpecificationWiki(root, [
    {
      path: "wiki/source.md",
      domain: "business/source",
      content: "---\ndomain: business/source\nstatus: approved\n---\n# Source\n\n[Blip](wrong.md), [details](blip.md#missing), [gone](missing.md), and [external](https://example.com).\n",
    },
    {
      path: "wiki/blip.md",
      domain: "business/noise",
      content: wikiDocuments[0].content,
    },
  ]);
  assert.equal(wikiIssues.length, 3);
  assert.match(wikiIssues.map((issue) => issue.message).join("\n"), /canonical page/);
  assert.match(wikiIssues.map((issue) => issue.message).join("\n"), /heading anchor/);
  assert.match(wikiIssues.map((issue) => issue.message).join("\n"), /does not exist/);

  await writeFile(join(root, "domains.yaml"), `
domains:
  legacy-group:
    subdomains:
      child:
        code: [src/child/]
`);
  const registeredTools = new Map();
  const registeredCommands = new Map();
  const registeredHandlers = new Map();
  domainTreeExtension({
    on(name, handler) {
      registeredHandlers.set(name, [
        ...(registeredHandlers.get(name) || []),
        handler,
      ]);
    },
    registerTool(tool) {
      registeredTools.set(tool.name, tool);
    },
    registerCommand(name, command) {
      registeredCommands.set(name, command);
    },
    sendUserMessage() {},
  });
  const notifications = [];
  const context = {
    cwd: root,
    ui: {
      setStatus() {},
      notify(message, level) {
        notifications.push({ message, level });
      },
    },
  };
  for (const [toolName, params] of [
    ["domain_tree_resolve", { path: "src/child/file.ts" }],
    ["domain_tree_check", {}],
    ["domain_tree_map", {}],
  ]) {
    const result = await registeredTools.get(toolName).execute(
      "test-call",
      params,
      undefined,
      undefined,
      context,
    );
    assert.equal(result.details.valid, false);
    assert.match(result.content[0].text, /domains\.legacy-group/);
    assert.match(result.content[0].text, /ownership results are unavailable/i);
  }
  await registeredCommands.get("domain-tree:check").handler("", context);
  assert.match(notifications.at(-1).message, /domains\.legacy-group/);
  assert.match(notifications.at(-1).message, /line \d+, column \d+/);

  const beforeAgentStart = registeredHandlers.get("before_agent_start")[0];
  const promptResult = await beforeAgentStart({ systemPrompt: "base" });
  assert.match(promptResult.systemPrompt, /Invalid Domain Manifest/);
  assert.match(promptResult.systemPrompt, /domains\.legacy-group/);

  await mkdir(join(root, "src/operations"), { recursive: true });
  await mkdir(join(root, "doc/system/security"), { recursive: true });
  await mkdir(join(root, "doc/iterations"), { recursive: true });
  await writeFile(
    join(root, "src/operations/README.md"),
    "---\ndomain: business/operations\nstatus: approved\n---\n# Operations\n\n## Roadmap\n\nTemporary delivery detail.\n",
  );
  await writeFile(
    join(root, "src/operations/blip.md"),
    "---\ndomain: business/operations\nstatus: approved\nterm: Blip\naliases: [blips]\n---\n# Blip\n",
  );
  await writeFile(
    join(root, "doc/system/security/safety.md"),
    "---\nsystem: grouped-project\nstatus: approved\n---\n# Safety\n\nThe system MUST fail closed.\n",
  );
  await writeFile(
    join(root, "doc/system/delivery.md"),
    "---\nsystem: grouped-project\nstatus: approved\n---\n# Delivery notes\n\nNo durable requirement.\n",
  );
  await writeFile(
    join(root, "doc/iterations/current.md"),
    "# Iteration\n\n## Roadmap\n\nThis non-normative plan is allowed.\n",
  );
  await writeFile(join(root, "domains.yaml"), `
project:
  name: grouped-project
system-specs: [doc/system/]
domains:
  business:
    kind: group
    domains:
      operations:
        type: core
        code: [src/operations/]
`);
  const corpusResult = await registeredTools.get("domain_tree_check").execute(
    "corpus-call",
    {},
    undefined,
    undefined,
    context,
  );
  assert.match(corpusResult.content[0].text, /README\.md.*Roadmap/s);
  assert.match(corpusResult.content[0].text, /doc\/system\/delivery\.md/);
  assert.match(corpusResult.content[0].text, /RFC 2119/);
  assert.doesNotMatch(corpusResult.content[0].text, /doc\/iterations/);

  const corpusMap = await registeredTools.get("domain_tree_map").execute(
    "corpus-map",
    {},
    undefined,
    undefined,
    context,
  );
  assert.match(corpusMap.content[0].text, /System specifications:\*\* 1\/2 valid/);
  assert.match(corpusMap.content[0].text, /Specification wiki:\*\* 1 canonical term/);

  const resolvedTerm = await registeredTools.get("domain_tree_resolve_term").execute(
    "term-call",
    { term: "blips" },
    undefined,
    undefined,
    context,
  );
  assert.match(resolvedTerm.content[0].text, /Blip/);
  assert.match(resolvedTerm.content[0].text, /business\/operations/);
  assert.equal(resolvedTerm.details.path, "src/operations/blip.md");
} finally {
  await rm(root, { recursive: true, force: true });
}
