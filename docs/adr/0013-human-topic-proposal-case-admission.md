# ADR 0013: Admit a citizen-signed Topic proposal through one human Case transition

- **Status:** accepted
- **Date:** 2026-08-22

## Context

Röbel's normal feed contains ordinary posts as well as civic discussions. A
resident may promote a post into a municipality-scoped Topic, ask public
Mecky for cited information, edit a proposal, and sign it. At that point no
Civic Case exists. This is intentional: a resident signature is provenance,
not authority to create administration work.

The existing `admit_signed_suggestion_v1` command starts from a discussion
that is already bound to a Case. Reusing it for a Topic proposal would either
pre-allocate a Case before the resident signs or smuggle a Case identifier
into a case-free signature. Both erase the human admission boundary.

## Decision

Add the separate `admit_signed_topic_suggestion_v1` command. Only a registered
`case_steward` may issue it, and only against an empty, deterministically
identified Case journal at expected version zero.

The command independently verifies:

- the NIP-01 signature and exact tags of the Topic discussion;
- municipality and Topic continuity and the absence of any Case tag;
- the allowlisted public Mecky identity, its in-thread answer receipt, and one
  to three reviewed HTTPS evidence references;
- the resident's exact NIP-01 proposal signature, draft digest, signer,
  timestamps, discussion, Topic, and Mecky receipt; and
- the deterministic Case identity derived from the candidate event.

One accepted command atomically appends `case_created_v1`,
`discussion_recorded_v1`, and `signed_topic_suggestion_admitted_v1`. No
department package, administration message, publication, ballot, treasury
operation, or formal decision is created. The event actor is the human
steward; the source discussion and proposal retain the resident's signatures.

The reference implementation derives a valid UUID-v7-shaped identifier from
the signed candidate's timestamp and event digest. This gives the same signed
candidate one stable Case identity across retries. The embedded timestamp is
an identity input, not the municipal filing or admission time. Production
adapters must additionally enforce uniqueness in their durable Case registry.

## Consequences

Röbel can keep its feed and discussions Topic-first while Stadtstack receives
one explicit, idempotent admission seam. Mecky cannot invoke the command, a
resident cannot self-admit, and a second Case identity cannot be selected for
the same candidate through this interface.

The Case projection carries the source Topic in the admission provenance and
then continues through the existing department review, Citizen Brief,
advisory Mitmachen, and reviewed outcome path. Legal submission, openDesk
delivery, governance voting, and treasury execution remain separately owned
authority transitions.

This repository proves a municipality-neutral reference contract under the
`test` Case namespace. A production HTTP adapter, steward authentication,
durable uniqueness enforcement, and deployment require their own reviewed
operations boundary.
