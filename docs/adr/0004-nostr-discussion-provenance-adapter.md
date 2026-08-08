# ADR 0004: Keep Nostr as the signed discussion and provenance Adapter

- **Status:** accepted for inbound discussion/provenance; ADR 0009 supersedes
  its narrower public-transport boundary
- **Date:** 2026-08-05

## Context

An open protocol is useful for signed public discussion and for exchanging
references between communities, but a relay can replay, reorder, or lose
events. It does not provide the retention, privacy, review, or legal-authority
semantics required by a municipal record.

## Decision

Nostr/NIP-01 is the open Adapter for signed discussion, provenance, and later
federation references. Stadtstack verifies and normalizes those events into
reviewed, versioned contracts. Stadtstack owns neutral case coordination,
evidence references, review/redaction state, checksums, and derived projections;
city systems retain private and official source records plus formal proposal,
publication, and vote authority. OParl and other official source protocols
remain complementary Adapters for official records; Nostr does not replace
them.

## Why

The boundary preserves Nostr's interoperability and agent-native exchange
without turning transport behavior into civic truth. It also lets a city adopt
or replace a relay without moving its source authority or retention policy.

## Consequences

Relay retention, moderation, indexing, and availability remain Adapter
concerns. Import requires signature, scope, replay, and policy validation;
private administration content, ballots, identities, and authority transitions
must never be inferred from or written to the discussion lane.
