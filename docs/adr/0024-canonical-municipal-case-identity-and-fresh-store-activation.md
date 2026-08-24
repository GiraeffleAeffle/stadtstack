# ADR 0024: Canonical municipal Case identity and fresh-store activation

- **Status:** accepted; implementation in progress
- **Date:** 2026-08-24

## Context

Earlier staging tracers encoded `test` inside durable Case IDs. That conflates
deployment environment with civic identity: restoring a journal into a later
environment would either preserve a misleading identifier or silently rewrite
the ID that participates in every event checksum, binding receipt and public
route.

The Case Steward, SQLite admission adapter, continuation service, recovery
evidence, shutdown seal and public binding reader all consume the same Case
identifier. A partial compatibility layer would make those independently
verified chains disagree.

## Decision

The sole durable v1 identity is exactly:

`urn:stadtstack:case:municipality:<municipality>:<uuid-v7>`

`<municipality>` is the canonical lower-case municipal slug and `<uuid-v7>` is
lower-case RFC UUID-v7 syntax. The Case coordinator derives this value from
the municipal scope and signed-suggestion timestamp-derived UUID. Every
receipt, journal event, recovery manifest, shutdown seal, public GET/HEAD
route and continuation request validates this exact namespace.

Staging/test remains explicit only in deployment claims, release metadata,
actor credentials and verification fixtures. It is not a durable Case-ID
namespace.

There is no dual-write, alias, read fallback or in-place rewrite from
`urn:stadtstack:case:test:*`. Before startup creates or admits into a SQLite
store, it scans every Case-ID-bearing durable table. Any legacy record rejects
activation with `atomic_admission_legacy_case_id_present`; no journal, receipt,
outbox or state receipt is mutated. The affected store remains inspectable for
a future separately reviewed, offline migration design.

## Consequences

- A fresh municipal store is required for this cutover.
- Existing legacy durable state is deliberately blocked rather than migrated
  implicitly; operations must retain it as evidence until a separate migration
  ADR defines backup, verification, rollback and authority ownership.
- Public discovery remains the same GET/HEAD capability and preserves the
  receipt checksum/journal semantics; only the exact Case-ID grammar changes.
- No civic authority, vote, treasury, OpenDesk write or public writer is added.

## Rejected alternatives

- **Keep `test` in the Case ID:** it makes deployment environment durable civic
  meaning and prevents an unambiguous later promotion.
- **Accept both ID formats forever:** it makes lookups and receipt verification
  ambiguous and permits split public projections.
- **Rewrite records at startup:** it would mutate checksum-bound evidence and
  violates fail-closed recovery.
