# ADR 0025: Keep Meld/Kair session bundles consent-scoped and review-gated

- **Status:** proposed
- **Date:** 2026-08-24

## Context

The Röbel, Stadtstack, and Komma collaborators are exploring a contextual
enrichment flow in which exact council records are mapped into shared context,
a consented Meld/Kair session is grounded in that context, and a structured
session bundle can later contribute a reviewed derivative to a cross-client
update feed. Röbel can surface that derivative beside signed discussions and
municipal source material. A session bundle may contain conversation-derived
claims, exact council-context references, and a temporal or topical structure.

The bundle has a different authority and privacy shape from both other inbound
seams. A signed Röbel discussion is public provenance, while an OParl/RIS
capture preserves the exact publisher, source system, record kind, publication
state, and authority of one public source record. OParl is an interchange
specification and RIS is a source system/publication surface; neither label
alone makes an imported item a final official decision. A recording session can
be consent-scoped, pseudonymised, revocable, and private even when a reviewed
summary eventually becomes public. Treating the three as one generic feed
would silently turn consent into identity, a model output into a source
attestation, or a session into a Civic case.

The current shared direction is to obtain Kair code access and test the runtime
on commodity hardware operated by the team. The comparison to MeshCore or
Meshtastic describes self-owned deployment ethos only and is not a protocol or
topology claim. Edge capture, transcription, pseudonymisation, temporal
graphing, downstream retrieval, the bundle schema, receipt fields, private
review ledger, and Adapter API remain hypotheses until repository, licence and
device inspection confirms them. Processing location, controller/processor
roles, lawful basis, retention, support, programme scope, and dates remain
unresolved.

## Decision

Introduce a dedicated **Meld/Kair session-bundle Adapter** with a separate
`kair_session_bundle_v1` contract. The Adapter must preserve:

- one opaque bundle ID and one exact source-content digest;
- municipality scope and session start/end metadata;
- exact, versioned, checksum-bound references to reviewed council context;
- a consent receipt digest, purpose, expiry, and revocation state;
- the capture/adapter version and provenance owner;
- an explicit redaction profile and private content references; and
- a pending/reviewed/withdrawn eligibility state.

The Adapter may prepare a bundle for review. It cannot create a Topic, sign a
Discussion, admit a Civic case, authenticate a resident, create an
administration work request, publish a Citizen Brief, start participation,
cast a vote, or execute treasury funds.

Human review is required to derive a **Reviewed deliberation artifact** before
any bundle-derived claim enters the Public knowledge projection. The private
review binds to the exact bundle digest and a named policy, while the public
record contains only the reviewed artifact reference and its public-payload
digest. It does not expose the bundle ID, source digest, session pseudonym,
consent receipt or private content references. An agent contribution may
summarize or identify candidate claims, but it is not a review attestation.
Public output must separate an attributed session statement from a reviewed
fact and cite the exact Reviewed deliberation artifact.

Consent is purpose- and scope-bound. Private review or retrieval consent does
not imply public publication, Case admission, Case or Department-package
citation, cross-municipality discovery, identity linking, or reuse for model
training. Case citation requires a separate `caseCitation` purpose or other
documented lawful basis. A later link to a Röbel member identity requires a
separate explicit receipt and must not replace the session pseudonym in the
bundle's original provenance. Expiry or revocation blocks new derivative and
projection use; already projected material follows an explicit
correction/withdrawal policy.

Meld/Kair derivatives are excluded from the irreversible Nostr public-exchange
lane by default. A Reviewed deliberation artifact may be mirrored only after a
separate explicit irreversible-publication consent and permanent-public
eligibility gate. Withdrawal can stop new projection use and add a correction;
it cannot erase copies already replicated by a public relay, the original
public council record, or evidence that must be retained under an independently
applicable Case-journal policy.

The bundle may be cited by a Topic or Civic case only through a provenance
reference after the relevant review gate. A reviewed derivative may also
prepare a Municipal publication candidate under ADR 0030, but only a separate
municipal publication receipt can create an Official municipal publication.
A bundle is never an Official source record and never replaces the Case
journal.

## Consequences

Röbel can offer a natural path from a conversation or facilitated session into
the one Civic Journey while keeping the session's consent and identity
boundaries legible. Public Mecky can answer from Reviewed deliberation
artifacts without the
administration approving each generated sentence. A Mini App can display the
review state, consent scope, and provenance without owning a second workflow.

The additional Adapter and review policy are necessary implementation work.
They also make it possible to discard or correct a bundle without rewriting a
signed Discussion or municipal source record. Cross-municipality similarity
must use the separate discovery boundary in ADR 0027.

## Rejected alternatives

- **Treat every bundle as a Röbel post:** loses session consent and source
  provenance, and implies a persistent member identity.
- **Treat every bundle as an OParl/RIS record:** falsely grants institutional
  authority to a conversation-derived artifact.
- **Let Mecky publish bundle summaries directly:** removes the human review
  gate and makes correction and withdrawal ambiguous.
- **Attach the bundle directly to a Case ID:** lets a session create or select
  a Case without Human Case admission.

## Confirmation required before implementation

The Meld/Kair technical owners and the responsible municipal/privacy owners
must confirm repository access, licence, supported hardware, installation,
updates and recovery, actual wire format, controller/processor roles, lawful
basis, consent and revocation semantics, retention/deletion behavior,
processing locations, model/runtime dependencies and delivery timeline. This
ADR remains `proposed` until those assumptions and the Adapter's exact
data-protection review are accepted.
