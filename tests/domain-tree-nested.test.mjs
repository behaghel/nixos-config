import assert from "node:assert/strict";
import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findAmbiguousCodeMappings,
  flattenDomains,
  parseDomainsYaml,
  resolveDomainForFilePath,
  specDirForEntry,
  entryForResolution,
} from "../marketplace/plugins/domain-tree/pi/domain-core.ts";

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
} finally {
  await rm(root, { recursive: true, force: true });
}
