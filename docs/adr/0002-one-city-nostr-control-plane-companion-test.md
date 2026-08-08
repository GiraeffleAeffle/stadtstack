# ADR 0002: Prove one synthetic city path before federation

- **Status:** historical baseline; retained for context
- **Date:** 2026-08-08

## Context

The product vision includes multiple communities sharing reviewed knowledge.
Starting with federation would multiply identity, privacy, replay, and
authority ambiguities before one local path is trustworthy.

## Decision

The first proof is one offline synthetic case:

```text
signed discussion -> suggestion -> department review -> reviewed brief
  -> advisory aggregate -> council rehearsal -> role-scoped companions
```

Nostr is an Adapter for signed public discussion and later reviewed exchange.
The coordinator retains private case/review state. Companion workers receive
role-scoped, default-deny tasks. Every result is advisory and carries
`authorityBinding: none`.

Federation, formal city submission, publication, and voting require separate
owners and later decisions after replay, redaction, and deletion are proven.

## Consequences

The first test is small, deterministic, and deletable. It exercises the
important seams without contacting a relay, model, provider, database, or
city authority. The one-city boundary is a constraint, not a claim that the
future multi-community protocol is complete.
