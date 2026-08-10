# Stadtstack architecture decisions

Read this index before treating an older ADR as current architecture. The
public repository records contracts and boundaries; it does not authorize
publication, runtime operations, public relay writes, or civic effects.

## Accepted baseline

- [ADR 0001](./0001-stadtstack-repository-reset.md) — keep the coordination
  Module neutral and separate city products and private operations.
- [ADR 0003](./0003-one-city-runtime-acceptance-boundary.md) — prove one
  synthetic runtime path before external authority or federation.
- [ADR 0004](./0004-nostr-discussion-provenance-adapter.md) — signed Nostr
  discussion is provenance, not case or municipal authority.
- [ADR 0005](./0005-one-owner-per-authority-boundary.md) — one owner for each
  product, source, and authority boundary.
- [ADR 0006](./0006-replaceable-mecky-and-workspace-adapters.md) — companion
  and workspace products remain replaceable Adapters.
- [ADR 0007](./0007-clean-public-lineage-private-operations.md) — publish from
  one clean public root commit and keep operations private.
- [ADR 0008](./0008-append-only-case-journal-deep-interface.md) — use a
  durable append-only Case journal behind a two-operation coordinator.
- [ADR 0009](./0009-nostr-reviewed-public-exchange.md) — use Nostr for signed
  discussion and reviewed public exchange, not private case state.
- [ADR 0010](./0010-reference-surfaces-and-role-identities.md) — keep
  reference surfaces and agent identities role-scoped.
- [ADR 0011](./0011-cited-public-mecky-and-citizen-signing.md) — let public
  Mecky answer explicit questions from cited reviewed knowledge and let the
  resident sign an edited suggestion without submitting it.

## Historical

- [ADR 0002](./0002-one-city-nostr-control-plane-companion-test.md) — the
  original one-city test ladder, retained as context.

An ADR records architecture. It is not an authorization for repository
visibility changes, public relay publication, deployment, provider access,
voting, or other civic effects.
