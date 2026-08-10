# ADR 0012: Carry admitted suggestions through Mitmachen and the public outcome loop

- **Status:** accepted
- **Date:** 2026-08-10

## Context

A resident can now ask public Mecky about reviewed material, edit the resulting
suggestion, and sign it. That signature is meaningful provenance, but it does
not itself create administration work, a municipal proposal, or a vote.

The next slice must preserve one continuous civic Case from that signed
candidate through administration feedback, a Citizen Brief, advisory
participation in Röbel's Mitmachen view, and a reviewed public outcome. Public
Mecky and Mitmachen must not develop separate interpretations of the Case.

## Decision

Extend the append-only `CivicCaseCoordinator` with two commands:

- `admit_signed_suggestion_v1` lets only a registered `case_steward` admit the
  exact citizen-signed NIP-01 candidate; and
- `record_reviewed_outcome_v1` records a reviewed, advisory outcome after the
  current Citizen Brief and participation result have both been validated.

An admission verifies the NIP-01 identifier and signature, signer, signed
content, Mecky receipt reference, municipality, source discussion, canonical
Case, and exact tag set. When signed admission is required, no department
package can be assigned first. The admitted suggestion retains the canonical
suggestion ID and discussion continuity while adopting the resident's signed
title and summary.

The reviewed outcome is a Case event and a public projection, not an external
publication. It binds the current discussion, Citizen Brief checksum, advisory
participation checksum, review time, and public result artifact. The public
discussion projection carries a checksum backlink to that outcome. If a
source package, brief, or participation result is corrected or retracted, the
outcome and backlink disappear from public projections until a fresh reviewed
chain exists.

Add one `PublicKnowledgeProjectionV1` as the public read model for both public
Mecky and Mitmachen. It contains only:

- the attributed signed discussion and admitted citizen suggestion;
- the current reviewed Citizen Brief and its public citations;
- the reviewed advisory participation question, window, options, aggregate,
  dissent, and checksum; and
- the current reviewed outcome and discussion backlink, when available.

Every projection binds the Case version, journal head, source projection
checksum, policy version, and its own knowledge checksum. Public Mecky records
that knowledge checksum in its answer receipt. The Mitmachen Adapter renders
the same projection through an exact, loopback-only `/mitmachen` reference
route.

Mitmachen labels the choice `advisory_non_binding`. It exposes no submission
form or mutation call. `formalVoteAvailable` is always false in this Module,
with `separate_legal_authority_binding_required` as the reason. A later
city-owned governance Adapter may bind a reviewed Case to a lawful ballot, but
that is a distinct decision, authority, receipt chain, and deployment.

## Consequences

Residents can follow one public line from their original signed discussion to
the administration's reviewed information, the Citizen Brief, the advisory
Mitmachen result, and the reviewed outcome. Mecky can explain that same public
line without a parallel store or per-answer administration approval.

The reference surface deliberately cannot write, submit, publish to a relay,
start a formal vote, or claim a legal decision. Its deterministic Röbel /
Marienfelder Straße tracer is local acceptance evidence only. Production
publication, Röbel UI integration, identity and moderation policy, legal
voting authority, and Talos deployment remain separately reviewed Adapters
and operational decisions.
