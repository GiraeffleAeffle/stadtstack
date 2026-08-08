# ADR 0001: Keep the civic coordination Module neutral

- **Status:** accepted
- **Date:** 2026-08-08

## Context

The coordination kernel, city-specific products, pilot adapters, and private
operations have different owners, licenses, data, and authority boundaries.
Combining them makes the public Interface shallow and makes provenance and
privacy review harder.

## Decision

Stadtstack is a municipality-neutral Module. It owns versioned contracts for
civic cases, evidence/review state, redaction, projections, and role-scoped
companion tasks. A city product owns its source records and formal civic
transitions. Pilot products own their own interfaces and adapters. A separate
private operations boundary owns deployment, credentials, runtime topology,
and rollback.

The public Module contains only reviewed source, synthetic fixtures, tests,
documentation, and license notices. It never copies a city-specific
implementation or unreviewed asset.

## Consequences

The coordinator Interface can be reused by multiple communities without
merging their source systems. Integrations must use typed, versioned Adapters;
authority is never inferred from a discussion, review, forecast, or worker
output. Private operations and runtime evidence remain outside this lineage.

## Rejected alternatives

- combining the civic kernel and a city application;
- importing a pilot implementation and relabeling it as an Adapter; and
- publishing the operations boundary with the neutral Module.
