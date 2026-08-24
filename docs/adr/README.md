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
- [ADR 0012](./0012-citizen-brief-mitmachen-outcome-loop.md) — admit an exact
  citizen signature through a human steward, then carry one reviewed public
  projection through Citizen Brief, advisory Mitmachen, and the outcome
  backlink without creating voting authority.
- [ADR 0013](./0013-human-topic-proposal-case-admission.md) — keep the public
  journey Topic-first, then let one accountable human atomically create the
  deterministically identified Case and admit the exact citizen signature.
- [ADR 0014](./0014-provider-neutral-administration-workspace-round-trip.md) —
  bind one Department package to a replaceable municipal workspace and accept
  its exact return only as a draft that still needs independent human review.
- [ADR 0015](./0015-human-citizen-brief-derivation-readiness.md) — expose
  checksum-bound Department review readiness, then let only a human Case
  steward prepare the exact Citizen Brief derivation command.
- [ADR 0016](./0016-human-reviewed-source-projection.md) — admit exact captured
  news and council records through a human source review, then prepare the
  checksum-bound public projection consumed by Röbel without publishing it.
- [ADR 0017](./0017-reviewed-source-public-transport.md) — expose already
  prepared source snapshots through two exact GET-only routes in a loopback
  reference transport without adding source or civic write authority.
- [ADR 0018](./0018-role-isolated-case-steward-control-and-public-binding-receipts.md) —
  isolate human Case admission behind a staff-authenticated control seam and
  expose only a checksum-bound, GET-only public Case binding receipt.
- [ADR 0019](./0019-one-durable-case-continuation-line.md) — compose
  administration feedback, Citizen Brief, advisory Mitmachen, and reviewed
  outcome over the same admitted Case and durable journal rather than Mini App
  timelines.
- [ADR 0020](./0020-sealed-case-control-and-public-discovery-transports.md) —
  put staff-only Case control, credential-free Case discovery, and outbox
  hydration behind disjoint, bounded transport capabilities.
- [ADR 0021](./0021-staging-case-steward-identity-and-credential-free-binding-delivery.md) —
  use per-steward staging tokens and a private credential-free outbox
  pull to connect separate control and public binding workloads.
- [ADR 0022](./0022-compose-isolated-staging-case-runtimes-before-network-exposure.md) —
  compose the separate control and public processes on loopback, prove the
  complete HTTP tracer, and require verified Operations policy before network
  exposure.
- [ADR 0023](./0023-stage-case-state-with-quiesced-backup-and-fresh-volume-restore.md) —
  give the staging control process one reviewed single-writer claim and block
  activation until a quiesced encrypted backup has been restored and verified
  on a fresh claim.
- [ADR 0024](./0024-canonical-municipal-case-identity-and-fresh-store-activation.md) —
  use one municipality-scoped durable Case ID and block activation of legacy
  staging-identity stores rather than rewriting checksum-bound evidence.

## Proposed extensions

- [ADR 0025](./0025-consent-scoped-kair-session-bundles.md) — keep Meld/Kair
  session bundles consent-scoped and review-gated rather than treating a
  recording-derived artifact as identity, source authority, or a Case.
- [ADR 0026](./0026-one-civic-change-feed.md) — publish one replayable
  eligibility-gated change feed and keep MCP and Nostr as bounded Adapters over
  the same Public knowledge projection.
- [ADR 0027](./0027-cross-municipality-similarity-is-discovery.md) — use
  cross-municipality similarity for public-safe discovery without merging
  identity, consent, Cases, or municipal authority.
- [ADR 0028](./0028-separate-public-and-control-deployables-around-one-civic-kernel.md) —
  extract one framework-neutral Civic coordination kernel and split public and
  staff surfaces into independently built and deployed applications.
- [ADR 0029](./0029-reuse-advisory-voting-infrastructure-after-citizen-identity-bridge.md) —
  gate any Röbel cryptographic ballot on a provider-neutral Citizen credential
  bridge and an explicit cross-municipality compatibility/ownership decision;
  never reopen the expired pilot or imply treasury authority.

## Historical

- [ADR 0002](./0002-one-city-nostr-control-plane-companion-test.md) — the
  original one-city test ladder, retained as context.

An ADR records architecture. It is not an authorization for repository
visibility changes, public relay publication, deployment, provider access,
voting, or other civic effects.
