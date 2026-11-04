# Domain modelling and encapsulation

Structural ownership is the starting point, not a design verdict. A valid manifest, colocated specifications and a green domain-tree check do not establish a good domain model. Use this guidance when designing or reviewing behaviour, abstractions, source resolution or a cross-domain contract. Apply it proportionately to the change, not as another approval stage or mandatory report.

## Start with domain understanding, not an API shape

Evans centres DDD on the core domain, creative collaboration between domain and software practitioners, and a ubiquitous language within an explicitly bounded context. A model selects the concepts and rules useful for solving a domain problem; it is not a copy of reality, a database schema or a vocabulary invented solely for developer convenience. Invest modelling effort where the domain's complexity and value justify it, not equally in every module.

Use concrete scenarios, counterexamples and corrections from domain practitioners to discover that model. Exercise its language in conversations, requirements, tests and code; improve the model when the language cannot express an important distinction. Investigate available domain evidence before asking questions, and ask about unresolved business meaning rather than seeking approval for every class or pattern.

Keep model and implementation in a feedback loop. The same concepts and responsibilities should be recognisable in both; a polished facade over unrelated implementation concepts is not model-driven design. Refactor toward deeper domain understanding, not merely shorter call sites. The sources below ground these principles; they do not prescribe a particular programming paradigm.

## Start from the consumer's intention

Read a representative use of the proposed abstraction. Describe what the person or consuming code wants to accomplish in the domain's language, before choosing files, providers, records or classes.

A useful model lets the consumer ask that meaningful question without reconstructing how the system answers it. A module named after a domain is not enough if its consumers still assemble business meaning from provider fields. Neither renaming a DTO nor moving the same orchestration behind a new facade establishes encapsulation.

Look for the decision that changes when the business understanding changes. Give that meaning and its policy one narrow semantic owner. Application code coordinates the use case; surface adapters translate delivery concerns; source adapters translate external representations into domain facts or observations. Ordinary consumers should not have to know provider precedence, storage layout, transport syntax or which connector to call.

## Model behaviour, identity and consistency

Name the rules, calculations, state transitions and invariants that make the abstraction meaningful. Show how behaviour preserves those invariants, including invalid or concurrent attempts where relevant. Encapsulation is not just selecting a convenient field: a reservation that cannot oversell stock needs a model of the reservation and its consistency obligations, not merely a quantity getter.

Use entity identity where continuity matters and immutable values where meaning does not require identity. Place behaviour where it fits the model. A significant domain operation that fits no entity or value naturally can be a domain service; do not create a God Person or force every rule into an entity method. Domain functions over domain values are also valid; method counts do not measure model richness.

Choose aggregate boundaries from rules that must remain consistent together, not from everything a view can navigate or fetch. A reference or lazy lookup does not bring another aggregate inside that boundary. Establish cross-boundary coordination from actual business requirements and failure cases rather than assuming either a global transaction or eventual consistency everywhere.

Transport DTOs, query projections and read-only observation views are legitimate. They become insufficient when they are used instead of a needed behavioural model and business policy leaks into controllers or each consumer. Do not call every data-shaped read model anemic or introduce CQRS, event sourcing or repositories for every type merely to remedy that label.

## Encapsulate the ordinary question

For example, a consumer needing the best available timezone for a person should ask that meaningful domain question, rather than choosing among Slack profile fields, directory locations and working-timezone records itself. A schematic call such as `await person.timezone()` illustrates the intent; the semantic owner might be a Person, a domain service or a context-specific query model. This is not a prescribed API, class hierarchy or universal Person spanning all bounded contexts.

The model owns what its ordinary answer means and how relevant available observations support it. An observation aggregator that leaves every caller to select the answer has not encapsulated that policy. Nor has a resolved view whose policy is still independently reconstructed by each surface.

There need not be one universally correct answer for every purpose. A person's current display clock, their working hours and the timezone interpreting a meeting instruction can differ. Establish a useful ordinary default; expose more specific domain questions where the use case genuinely needs those distinctions. Do not replace every ordinary call with a catalogue of provider fields, mandatory purpose flags or source-selection parameters.

Distinguish real requirements from inherited implementation choices. A currently exposed `workingTimeZone` field, a source-only fallback rule or a passing test does not by itself establish the intended business meaning. Check the governing requirements and their rationale; resolve material contradictions before changing an important guarantee. Do not silently turn a display setting into a working-location fact, or an inference into a confirmed observation.

## Resolve lazily without hiding the contract

On-demand resolution is a project design preference, not a requirement of DDD or the definition of a rich domain model. A domain-facing view can resolve components when the use case needs them: requesting identity need not fetch timezone, employment, calendar and messaging profiles. The caller asks for domain meaning, not a sequence of source reads.

Do not infer that entities should perform arbitrary I/O, that every property needs lazy loading, or that a navigable object graph should become one aggregate. Keep acquisition and persistence mechanics outside domain rules. Application or infrastructure collaborators can obtain the needed observations through ports and repositories where appropriate, then supply them to domain behaviour or policy. A lazy facade may expose that answer without making the underlying entity own clients or storage. Lazy proxies are another implementation option, not a universal recommendation.

Make acquisition and command effects distinguishable from calculations over supplied domain values. Immutable value operations should be side-effect-free; a seemingly simple read must not hide a business mutation. Keep simple models simple: eagerly supplying a small, already-available value may be clearer than adding a resolver.

Lazy resolution still has a contract:

- Respect existing read authority and resource bounds; property access is not permission for command effects or contact with another person.
- Define freshness and consistency where they affect correctness. Reuse observations within an appropriate request or snapshot when needed, rather than accidentally mixing incompatible moments. Do not introduce a global cache by default.
- Preserve meaningful unavailable, conflicting or inferred outcomes. Do not silently invent a successful resolution or substitute UTC as a known personal timezone.
- Keep source, basis, age and selection reasoning inspectable when relevant. Ordinary consumers need not assemble that evidence themselves, but encapsulation must not become an access ceiling for authorised diagnosis or actor judgment.

## Keep judgment and boundaries honest

Encapsulate established domain policy, not an imagined universal ranking of sources. Use the cases to determine which selection rules are actually defined. Where a project delegates open-ended interpretation to a capable actor, preserve that judgment while giving it an expressive model and established rules; do not make it reconstruct stable business knowledge from raw fields on every use. Neither DDD nor a domain abstraction requires a classifier, resolver actor or fixed workflow.

A provider handle is not automatically a domain identity. Translating a Slack mention or directory record belongs at the appropriate boundary; source authentication and verified identity bindings retain their existing guarantees. Domain abstractions do not grant disclosure or effect authority.

A domain entry declares an intended semantic boundary, not proof of a coherent bounded context. A subdomain describes a problem area; a bounded context bounds a model and its language. Do not infer either solely from a directory, technical layer, provider or number of specification files. The same business word may have different meanings in different contexts; translate at their boundary rather than forcing one universal model.

A shared kernel can include deliberately shared behaviour and invariants as well as types. Keep that shared model small, explicitly owned and compatible with its consumers. Shared data structures without shared meaning do not solve semantic coupling.

## Review through cases, not a pattern checklist

Choose cases that can challenge the proposed abstraction: useful evidence is present, only weaker or older evidence remains, sources conflict, a source is unavailable, no source is relevant to the request, and a specialised use case legitimately needs a different answer. Select the cases relevant to this change rather than requiring an exhaustive suite for every design.

Compare the consuming code before and after. Ask:

- Does the language fit domain practitioners' scenarios, and does the implementation express that same model?
- Which behaviour and invariants does the model own, including state, identity or consistency when those matter?
- What knowledge or decision has disappeared from the caller, and who now owns it?
- Can a source be replaced or added without teaching ordinary consumers its representation or repeating the policy?
- Does the code express the domain's intention, not just shorten a provider lookup?
- Are source reads deferred until useful while uncertainty and authorised inspection remain available?
- Is this smaller than the alternatives, or did we merely add objects, layers and indirection?

Recommend the smallest end-to-end improvement supported by those cases. Explain material trade-offs and distinguish observed code facts from proposed design. Use functions, value objects, entities, aggregates or domain events where they clarify actual behaviour and invariants—not to satisfy a prescribed pattern count. Keep delivery plans and acceptance results in the conversation or PR, not normative domain specifications.

## Sources and scope

- Eric Evans, [Domain-Driven Design Reference (2015)](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf): Putting the Model to Work; Ubiquitous Language; Model-Driven Design; Refactoring Toward Deeper Insight; Layered Architecture; Services; Aggregates; Repositories; Intention-Revealing Interfaces; Side-Effect-Free Functions; Conceptual Contours; Shared Kernel; Core Domain. These connect collaborative learning, model/code correspondence, encapsulation and consistency—not just tactical patterns.
- Martin Fowler, [Domain Driven Design](https://martinfowler.com/bliki/DomainDrivenDesign.html) and [Anemic Domain Model](https://martinfowler.com/bliki/AnemicDomainModel.html): domain behaviour and application coordination have different responsibilities; DDD's conceptual foundations are not limited to object-oriented programming, and rich domain models are not necessary everywhere.
- Vaughn Vernon, [Effective Aggregate Design, Part II (2011)](https://www.dddcommunity.org/wp-content/uploads/files/pdf_articles/Vernon_2011_2.pdf), especially Model Navigation: object navigation does not define aggregate boundaries; resolving dependencies before aggregate behaviour is an alternative to repository lookups inside it. His rules of thumb include justified exceptions, not blanket distribution mandates.
- Martin Fowler, [CQRS](https://martinfowler.com/bliki/CQRS.html): query and update models can differ where useful, but that separation adds costs and is not a default architecture for every context.

This guide applies those foundations to agent-assisted development. On-demand views and preserving actor-owned open-ended judgment are explicit design choices, not additional definitions of DDD. The timezone example illustrates a modelling question; it does not establish a universal source ranking or require every system to implement Person accessors.
