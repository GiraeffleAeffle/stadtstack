# ADR 0009: Use Nostr for reviewed public exchange

- **Status:** accepted; exact event kind remains a conformance decision
- **Date:** 2026-08-08

## Context

Nostr is well suited to signed, agent-readable public discussion and
provenance. It is not a suitable store for private drafts, erasable case
state, ballots, or municipal authority. The inbound discussion Adapter alone
does not describe how another community can consume a reviewed public result.

## Decision

Stadtstack has two public Nostr lanes:

1. signed discussion records enter through the verified discussion Adapter;
2. reviewed, redacted, permanently public artifacts may leave as a versioned
   `public_exchange_record_v1` envelope.

The private Case journal, review drafts, PII, ballots, prompts, and reasoning
remain local. A public exchange record contains canonical case identity,
municipality scope, provenance references, review/public-safety metadata,
checksums, and attributable signer/agent information. It never grants
authority or creates a formal city transition.

The exact addressable Nostr kind is deferred until the schema is checked with
participating clients and the current NIP registry. NIP-78 application data is
not selected as a civic interoperability kind.

## Consequences

Communities and agents can exchange reviewed information through an open
protocol while each city retains its own source and authority. Public relay
publication, real identities, and formal transitions require later gates.
