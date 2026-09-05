# ADR 0031: Verify citizen adoption before human Case admission

- **Status:** accepted; staff HTTP/coordinator/SQLite integration implemented; deployment activation pending
- **Date:** 2026-09-05

[ADR 0018](0018-role-isolated-case-steward-control-and-public-binding-receipts.md)
separates staff admission from the public client. A participant signature alone
does not prove municipal eligibility. The new intake follows the public wire
contract in [Röbel ADR 0023](https://github.com/GiraeffleAeffle/Roebel-App/blob/cb10509a2d8bb9e36e0ff4262fa7afaa582cd689/docs/adr/0023-city-neutral-citizen-eligibility-and-suggestion-adoption.md),
using an independent neutral verifier; city credential lookup and private
holder evidence remain with the issuer.

The closed `eligible_citizen_adopted_topic_suggestion_v1` bundle contains four
complete NIP-01 events (discussion, cited Mecky answer, participant suggestion,
citizen adoption) and the public issuer receipt. The verifier binds every
signature, canonical payload, ordered tag set, source reference, municipality,
Topic, participant and adopter. Selected post/comment provenance is retained.
The issuer policy, keys and status URL come from deployment configuration.

Adoption acceptance is a separate trusted-ledger read by exact adoption event
ID. Its checksum and original receipt-time window must match; later reads do
not reapply event clock skew. Each verification creates a fresh random status
nonce, reads only the pinned HTTPS status endpoint and verifies its current
signed `active` observation. Unknown fields, stale or revoked evidence,
redirects, oversized responses and unavailable dependencies fail closed within
a bounded verification budget. The returned immutable evidence includes its
expiry deadline and grants no authority.

The staff HTTP handler authenticates the municipality-scoped Case Steward
before inspecting the bundle. Its closed
`roebel_case_steward_citizen_adoption_request_v1` body contains only
`schemaVersion` and `bundle`. Deployment composition explicitly chooses
`admissionKind: eligible_citizen_adopted_topic_suggestion_v1`; this lane rejects
the direct-candidate and synthetic request shapes. The existing SQLite owner
provides `admitCitizenAdoption`, with a configured issuer policy, exact-event
acceptance reader, HTTPS status client and clock. Callers cannot supply a Case
ID, acceptance receipt, observed status, nonce or verification flag.

The writer performs the fresh reads before opening its write transaction.
`admit_citizen_adoption_v1` derives the Case's UUID-v7 from the signed adoption
and appends creation, the original discussion, and
`citizen_adoption_admitted_v1`. The latter stores the complete verified evidence
and consumes the status nonce in that same admission event. Under
`BEGIN IMMEDIATE`, the writer checks for a previously consumed nonce and
commits the root claim, journal, idempotency record and public outbox together.
It checks freshness inside the transaction and again immediately before commit.

The journal itself records nonce consumption. This avoids a second nonce ledger
and preserves the existing exact SQLite table schema, shutdown seals and recovery
format. The tradeoff is a bounded journal scan when admitting or validating the
store; an indexed representation would require an explicit future migration.
The deployment policy participates in both database and coordinator fingerprints.
An existing legacy-policy store is never silently switched to adoption mode.

An exact retry checks the complete original signed bundle and authenticated
staff actor, verifies the recorded evidence and returns the original receipt.
Concurrent identical requests converge; different actors or bundles conflict.
Historical replay rechecks signatures, policy bindings and the original validity
interval without fetching current eligibility or reapplying event clock skew.
Expiry or later revocation cannot rewrite an already admitted Case; later staff
work continues its existing journal.

The public projection for this path is `public_case_binding_receipt_v2`, binding
the adoption, eligibility and acceptance checksums to the same journal.
The old direct-candidate contract remains available for its existing reference
flow; it cannot be relabelled as citizen adoption. The same public reader,
credential-free outbox and HTTP transport validate either closed receipt schema.
The v2 receipt carries exact false values for administrative endorsement,
binding vote, council decision, openDesk write, treasury effect and payment effect.
Private eligibility status, nonce, proofs and staff identity stay in the journal.

This is a composable implementation, not live operator configuration. The runtime
entrypoint still has no adoption activation switch, issuer credentials or trusted
ledger connection. Deployment composition, issuer ownership and a real municipal
Case Steward must be established before activating this path.

Offline tests use clearly synthetic wire vectors generated by Röbel's public
signing/adoption APIs, including a selected-comment conversation. Node crypto
independently verifies issuer proofs. No Röbel implementation, private
credential, operational record or package dependency is incorporated here.
