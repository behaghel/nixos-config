# Domain modelling and encapsulation

Structural ownership is the starting point, not a design verdict. A valid manifest, colocated specifications and a green domain-tree check do not establish a good domain model. Use this guidance when designing or reviewing behaviour, abstractions, source resolution or a cross-domain contract. Apply it proportionately to the change, not as another approval stage or mandatory report.

## Start from the consumer's intention

Read a representative use of the proposed abstraction. Describe what the person or consuming code wants to accomplish in the domain's language, before choosing files, providers, records or classes.

A useful model lets the consumer ask that meaningful question without reconstructing how the system answers it. A module named after a domain is not enough if its consumers still assemble business meaning from provider fields. Neither renaming a DTO nor moving the same orchestration behind a new facade establishes encapsulation.

Look for the decision that changes when the business understanding changes. Give that meaning and its policy one narrow semantic owner. Application code coordinates the use case; surface adapters translate delivery concerns; source adapters translate external representations into domain facts or observations. Ordinary consumers should not have to know provider precedence, storage layout, transport syntax or which connector to call.

## Encapsulate the ordinary question

For example, a consumer needing the best available timezone for a person should ordinarily ask the Person model that question, rather than choosing among Slack profile fields, directory locations and working-timezone records itself. A schematic call such as `await person.timezone()` illustrates the intent; it is not a prescribed API, class hierarchy or requirement for a fluent DSL.

The model owns what its ordinary answer means and how relevant available observations support it. An observation aggregator that leaves every caller to select the answer has not encapsulated that policy. Nor has a resolved view whose policy is still independently reconstructed by each surface.

There need not be one universally correct answer for every purpose. A person's current display clock, their working hours and the timezone interpreting a meeting instruction can differ. Establish a useful ordinary default; expose more specific domain questions where the use case genuinely needs those distinctions. Do not replace every ordinary call with a catalogue of provider fields, mandatory purpose flags or source-selection parameters.

Distinguish real requirements from inherited implementation choices. A currently exposed `workingTimeZone` field, a source-only fallback rule or a passing test does not by itself establish the intended business meaning. Check the governing requirements and their rationale; resolve material contradictions before changing an important guarantee. Do not silently turn a display setting into a working-location fact, or an inference into a confirmed observation.

## Resolve lazily without hiding the contract

An on-demand domain view can resolve its components when the use case needs them. Requesting identity need not fetch timezone, employment, calendar and messaging profiles. The caller asks for domain meaning, not a sequence of source reads.

Keep source access behind appropriate boundaries. A Person should not become a container for Slack clients, SQL, formatting and arbitrary application services. Inject capabilities or use domain-owned policies and ports as appropriate; neither object-oriented nor functional implementation is mandatory.

Lazy resolution still has a contract:

- Respect existing read authority and resource bounds; property access is not permission for command effects or contact with another person.
- Define freshness and consistency where they affect correctness. Reuse observations within an appropriate request or snapshot when needed, rather than accidentally mixing incompatible moments. Do not introduce a global cache by default.
- Preserve meaningful unavailable, conflicting or inferred outcomes. Do not silently invent a successful resolution or substitute UTC as a known personal timezone.
- Keep source, basis, age and selection reasoning inspectable when relevant. Ordinary consumers need not assemble that evidence themselves, but encapsulation must not become an access ceiling for authorised diagnosis or actor judgment.

## Keep judgment and boundaries honest

Encapsulate established domain policy, not an imagined universal ranking of sources. Use the cases to determine which selection rules are actually defined. Open-ended interpretation of a person's intention, conflicting context and warranted exceptions remains with the capable actor; a domain abstraction is not a reason to add a classifier, resolver actor or fixed workflow.

A provider handle is not automatically a domain identity. Translating a Slack mention or directory record belongs at the appropriate boundary; source authentication and verified identity bindings retain their existing guarantees. Domain abstractions do not grant disclosure or effect authority.

A domain entry declares an intended semantic boundary, not proof of a coherent bounded context. A subdomain describes a problem area; a bounded context bounds a model and its language. Do not infer either solely from a directory, technical layer, provider or number of specification files. The same business word may have different meanings in different contexts; translate at their boundary rather than forcing one universal model.

A shared kernel can include deliberately shared behaviour and invariants as well as types. Keep that shared model small, explicitly owned and compatible with its consumers. Shared data structures without shared meaning do not solve semantic coupling.

## Review through cases, not a pattern checklist

Choose cases that can challenge the proposed abstraction: useful evidence is present, only weaker or older evidence remains, sources conflict, a source is unavailable, no source is relevant to the request, and a specialised use case legitimately needs a different answer. Select the cases relevant to this change rather than requiring an exhaustive suite for every design.

Compare the consuming code before and after. Ask:

- What knowledge or decision has disappeared from the caller, and who now owns it?
- Can a source be replaced or added without teaching ordinary consumers its representation or repeating the policy?
- Does the code express the domain's intention, not just shorten a provider lookup?
- Are source reads deferred until useful while uncertainty and authorised inspection remain available?
- Is this smaller than the alternatives, or did we merely add objects, layers and indirection?

Recommend the smallest end-to-end improvement supported by those cases. Explain material trade-offs and distinguish observed code facts from proposed design. Use functions, value objects, entities, aggregates or domain events where they clarify actual behaviour and invariants—not to satisfy a prescribed pattern count. Keep delivery plans and acceptance results in the conversation or PR, not normative domain specifications.
