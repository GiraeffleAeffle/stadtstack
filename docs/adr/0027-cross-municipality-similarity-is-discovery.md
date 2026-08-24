# ADR 0027: Treat cross-municipality similarity as discovery, not authority

- **Status:** proposed
- **Date:** 2026-08-24

## Context

Normalised OParl/RIS records, reviewed Röbel Discussions, and consent-scoped
Meld/Kair bundles may reveal similar concerns in different municipalities.
Surfacing those relationships could help residents, facilitators, and public
Mecky find useful examples. It also creates a serious boundary risk: a
similarity score can leak session content, imply that one city's record is a
precedent for another, or silently merge Cases and identities.

Similarity is an agent aid, not a source review, municipal decision, or legal
authority. A model-generated relationship is especially not evidence that two
Topics have the same facts, owner, procedure, or consent.

## Decision

Create a separate **cross-municipality discovery projection** from public-safe,
eligible records only. Each relationship must be attributable to the exact
public-artifact digests and carry:

- both municipality scopes and their independent Topic/source references;
- the projection version and similarity method/version;
- a public-safe explanation or feature summary, not raw private content;
- an uncertainty or confidence label that is clearly not a review attestation;
- an explicit opt-in/public eligibility result for each source; and
- correction, withdrawal, and expiry references.

The projection is advisory discovery. It may suggest “related Topics” or
“compare these reviewed source records,” but it must not:

- merge or re-identify Cases, Topics, residents, or session pseudonyms;
- infer consent, legal basis, official status, or municipal responsibility;
- copy a Meld/Kair transcript, private evidence, or workspace identifier;
- change a Case, Citizen Brief, Mitmachen result, decision, or treasury state;
- treat one municipality's record as another municipality's official source;
  or
- submit, publish, vote, sign, or execute anything on behalf of a city.

Public Mecky may use the projection only to explain the relationship and link
back to the independently reviewed sources. It must say when a relation is
model-assisted and must not present similarity as a verified fact. A human can
promote a useful relationship into a local Topic or Case only through the
ordinary Topic and Human Case admission gates; the discovery projection does
not create that transition.

Municipality-specific review, retention, correction, and visibility policies
remain authoritative. A source withdrawn in one municipality must disappear
from new discovery pages without rewriting the other municipality's source or
Case. The shared change feed in ADR 0026 may publish a public-safe correction
for the discovery record, but never its private inputs.

## Consequences

Communities can learn from one another without turning federation into a new
authority layer. The architecture supports future Netizen or MCP clients
without requiring a shared municipal database or universal identity.

Discovery requires its own privacy filter, projection store, model/version
record, correction handling, and browser wording. Similarity evaluation and
human confirmation remain separate from source admission, Department review,
Citizen Brief derivation, formal governance, and treasury execution.

## Rejected alternatives

- **Merge similar Cases globally:** destroys municipal ownership and makes
  correction and authority ambiguous.
- **Use all raw session material for matching:** violates consent scope and
  exposes information that was never eligible for public retrieval.
- **Treat a high score as evidence:** confuses model output with a reviewed
  source or human attestation.
- **Let a global index own the canonical Topic:** creates a federation owner
  that the municipality-neutral Stadtstack contract does not have.

## Acceptance conditions

The decision can move to `accepted` after a reference projection proves
public-safe filtering, independent municipality scope, public-artifact-digest lineage,
consent and withdrawal handling, no identity joins, bounded explanations, and
fail-closed behavior when either source is stale or not eligible for discovery.
