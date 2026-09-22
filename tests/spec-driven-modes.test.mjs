import assert from "node:assert/strict";
import {
  buildSpecCollectionPrompt,
  buildSpecVerificationPrompt,
  classifySpecContent,
  selectSpecMode,
} from "../marketplace/plugins/spec-driven/pi/spec-modes.ts";

assert.deepEqual(selectSpecMode("", true), { mode: "domain", topic: "" });
assert.deepEqual(selectSpecMode("queue semantics", true), {
  mode: "domain",
  topic: "queue semantics",
});
assert.deepEqual(selectSpecMode("--mode iteration queue refactor", true), {
  mode: "iteration",
  topic: "queue refactor",
});
assert.deepEqual(selectSpecMode("queue refactor --mode=system", true), {
  mode: "system",
  topic: "queue refactor",
});
assert.deepEqual(selectSpecMode("queue refactor", false), {
  mode: "standalone",
  topic: "queue refactor",
});
assert.match(selectSpecMode("--mode domain queue", false).error, /requires a valid/);
assert.match(selectSpecMode("--mode temporary queue", true).error, /must be/);

assert.equal(
  classifySpecContent(
    "---\ndomain: business/queue\nstatus: approved\n---\n# Queue\n",
    true,
  ),
  "domain",
);
assert.equal(
  classifySpecContent(
    "---\nsystem: example\nstatus: approved\n---\n# Safety\n",
    true,
  ),
  "system",
);
assert.equal(classifySpecContent("# Iteration\n", true), "iteration");
assert.equal(classifySpecContent("# Development spec\n", false), "standalone");

const domainPrompt = buildSpecCollectionPrompt(selectSpecMode("queue", true));
assert.match(domainPrompt, /default normative artifact/);
assert.match(domainPrompt, /durable, present-tense/);
assert.match(domainPrompt, /Do not include problem history/);
assert.doesNotMatch(domainPrompt, /six phases/);

const iterationPrompt = buildSpecCollectionPrompt(
  selectSpecMode("--mode iteration queue", true),
);
assert.match(iterationPrompt, /temporary, non-normative/);
assert.match(iterationPrompt, /Acceptance Criteria/);
assert.match(iterationPrompt, /Do not add domain or system frontmatter/);

const systemPrompt = buildSpecCollectionPrompt(
  selectSpecMode("--mode system safety", true),
);
assert.match(systemPrompt, /subsidiarity/);
assert.match(systemPrompt, /RFC 2119/);
assert.match(systemPrompt, /cannot own ubiquitous language/);

const standalonePrompt = buildSpecCollectionPrompt(
  selectSpecMode("feature", false),
);
assert.match(standalonePrompt, /development specification/);
assert.match(standalonePrompt, /Acceptance Criteria/);

assert.match(
  buildSpecVerificationPrompt("domain", "src/domain/README.md"),
  /DRY canonical definitions/,
);
assert.match(
  buildSpecVerificationPrompt("system", "doc/system/safety.md"),
  /irreducible to one domain/,
);
assert.match(
  buildSpecVerificationPrompt("iteration", "iteration.md"),
  /testable acceptance criteria/,
);
