# ADR 0005: Keep one owner for each authority boundary

- **Status:** accepted
- **Date:** 2026-08-08

## Context

The coordination Module, a city source system, community UX, and operations
have different authority and privacy boundaries. A caller must not gain a
second system's authority merely by importing an event or projection.

## Decision

Each product, city source, public/private surface, and operations boundary has
one explicit owner. Stadtstack may accept reviewed contracts and expose
projections, but it cannot publish, submit, vote, or mutate an official source
unless a separately owned city Adapter explicitly performs that transition.
Nostr is transport/provenance, never an authority store.

## Consequences

Cross-product integration is a typed Adapter seam. Ownership is visible in
the contract and review receipt. Ambiguous ownership, missing provenance, or
authority-shaped fields are rejected rather than inferred.
