# ADR 0008: Put an append-only Case journal behind a two-operation coordinator Interface

- **Status:** accepted by the product owner on 2026-08-08
- **Date:** 2026-08-08

## Context

The current kernel is an in-memory state machine with several command methods,
transitional publication names, and no explicit Civic Case lifecycle. That is
enough for an offline fixture but cannot prove fresh-process recovery,
corrections, accountable review, or a stable cross-surface case identity.
Using a relay as the missing state store would make public transport carry
private drafts and review state. Using only mutable database rows would make
replay and historical evidence a second concern bolted onto every write.

## Decision

Stadtstack's deepest Module is a `CivicCaseCoordinator` with two external
operations:

1. `handle(CommandEnvelope) -> CommandReceipt`
2. `project(QueryEnvelope) -> ProjectionEnvelope`

The Interface includes actor binding, canonical case identity, expected case
version, idempotency key, visibility, policy version, deterministic error
codes, and checksum rules. It does not expose storage, relay, model, workspace,
or transport details.

Every accepted command atomically appends one or more immutable `case_event_v1`
records to a Case journal. Each event carries the canonical case ID, monotonic
case version, prior-event checksum, actor class, artifact checksums, review or
authority binding, and correction reference. Current administration, council,
and public state is derived from that journal. Review attestations must be
explicit events; an agent contribution can never synthesize one. A successful
receipt returns the accepted case version, appended event IDs, and new journal
head checksum; idempotent replay returns the original receipt, while a reused
key with different content fails closed.

Canonical case IDs use
`urn:stadtstack:case:<jurisdiction-scheme>:<jurisdiction-value>:<uuid-v7>`.
The first production scheme is `de-ags`, whose value is the eight-digit German
municipality key; synthetic fixtures use the `test` scheme and never invent a
real municipality key. External proposal, OParl, Nostr, wallet, or city record
IDs remain typed source references rather than becoming the canonical case ID.
The synthetic fixture pins one fixed UUID so replay remains byte-deterministic.

The L0 Adapter is in-memory. The first durable L1/L2 Adapter is SQLite in WAL
mode on namespace-scoped storage, chosen for a single-writer disposable demo.
A later PostgreSQL Adapter may replace it without changing the coordinator
Interface. L2 deletion removes the namespace-scoped journal with the rest of
the candidate. Append-only means immutable within the active retention period,
not permanent retention: production retention, erasure, and legal holds are a
later city-owned policy and must not be inferred from this demo journal.

## Consequences

The Module gains Depth: lifecycle, idempotency, review invalidation,
corrections, replay, and role projections are exercised through two operations.
The journal is private case evidence, not a public activity feed. Tests replace
internal-state assertions with command receipts and role projections through
the same Interface used by the reference UI.

## Rejected alternatives

- **Keep many workflow methods as the external Interface:** leaks ordering and
  lifecycle complexity to every city, UI, and test caller.
- **Use Nostr as the Case journal:** cannot safely hold erasable drafts,
  department work, identities, or municipal review state.
- **Store only mutable snapshots:** weakens deterministic replay, corrections,
  and review provenance.
- **Start with a shared PostgreSQL cluster:** adds operations and retention
  authority before the disposable one-city contract is accepted.
