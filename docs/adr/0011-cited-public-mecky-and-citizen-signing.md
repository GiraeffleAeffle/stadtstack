# ADR 0011: Let public Mecky answer from cited reviewed knowledge

- **Status:** accepted
- **Date:** 2026-08-10

## Context

Residents should be able to ask Mecky about an active public discussion in the
same conversational way they address a knowledgeable participant. Requiring an
administration employee to approve every generated sentence would make that
interaction too expensive. Letting a model answer from unreviewed discussion,
private evidence, or unstated memory would be unsafe and would blur municipal
authority.

Residents should also be able to turn a useful answer into their own
suggestion. A Mecky draft must not silently become a city case, publication,
submission, or vote.

## Decision

Add a deep `PublicMecky` Module with three operations:

- `answer` handles only an explicit `@Mecky` mention or an explicit Ask-Mecky
  button action;
- `prepareSuggestion` incorporates the resident's edits into an unsigned,
  deterministic NIP-01 signing request; and
- `acceptSignedSuggestion` verifies the resident's signature and returns a
  candidate awaiting separate human case admission.

The Module receives only a public `CompanionRuntime.prepareTask` reader and a
validated `CompanionHarnessAdapter.run` worker. It has no coordinator handle,
private search tool, relay publisher, case submission operation, or voting
operation.

An answer is admissible only when all of the following are true:

1. the public discussion is a valid NIP-01 event and is the exact discussion
   projected by the Case;
2. the projected citizen brief is current, public-safe, source-bound to that
   discussion, and contains non-conflicting reviewed citations;
3. every generated fact cites an admitted source, and at least one cited
   source is a reviewed public artifact;
4. the public discussion citation names its signing public key, so discussion
   claims remain attributed rather than becoming reviewed facts; and
5. worker role, identity, Case, session, context, citations, default-deny tool
   policy, and prohibited effects remain bound to the public task.

The returned answer keeps `facts`, `uncertainty`, and `reasoningSummary`
separate. Administration reviews the source artifacts under the normal package
and brief workflow; it does not approve every Mecky answer. The answer receipt
therefore says both `sourceArtifactReviewRequired: true` and
`administrationAnswerReviewRequired: false`.

Insufficient, stale, conflicting, private, forged, or unbound evidence fails
closed before generation where possible. Ordinary discussion without an
explicit invocation remains ordinary discussion.

The suggestion returned by Mecky is only a draft. The resident may adopt or
edit its title and summary, then signs the exact resulting NIP-01 event. A
valid signature produces `awaiting_human_case_admission`; it does not mutate
the Case, write to Nostr, publish, submit, or vote.

## Consequences

Mecky can answer frequently from reviewed public knowledge without creating a
per-answer administration queue. The cost is deliberate conservatism: Mecky
must say that an answer is unavailable whenever the reviewed evidence boundary
cannot be proved.

Later product Adapters may render citations, identity, uncertainty, and the
signing prompt in the Röbel discussion UI. They may not weaken the same source,
signature, role, and authority boundaries. Admission of a signed suggestion
into the civic workflow is a separate decision and Interface.

The deterministic Marienfelder Straße tracer is local proof only. It performs
no network call, publication, provider request, Case mutation, submission, or
vote, and it does not establish deployment readiness.
