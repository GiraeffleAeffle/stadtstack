# ADR 0017: Serve reviewed source snapshots through two exact GET routes

- **Status:** accepted
- **Date:** 2026-08-22

## Context

ADR 0016 prepares checksum-bound local-news and Ratsinformationssystem
projections after human source review. Röbel already consumes those two source
kinds through independent bounded adapters. A transport boundary is still
needed between them; it must not turn the answer path into a crawler, admit a
partially valid snapshot, or add an administration credential.

## Decision

Add `createReviewedPublicKnowledgeServer` as a credential-free reference
transport over already-prepared projections.

At construction the server revalidates the complete projection, fixed source
authority, municipality, canonical times, deterministic record order, source
identity uniqueness, and content checksum. It stores canonical immutable bytes
for at most one local-news and one Ratsinformationssystem snapshot. Invalid or
duplicate input prevents the listener from starting.

The router exposes only these exact source-specific paths:

- `/api/federation/v1/municipalities/{municipalityId}/public-knowledge/local-news`
- `/api/federation/v1/municipalities/{municipalityId}/public-knowledge/ratsinformation`

Only `GET` is accepted. Query strings, alternate municipalities and unknown
paths fail closed; writes return `405` with `Allow: GET`. Responses are
`no-store`, checksum-labelled JSON with a deterministic content length. A
missing source returns `404` rather than borrowing the other source or
inventing an empty reviewed result. A serialized snapshot larger than 512,000
bytes is rejected before listen, matching the Röbel consumer default.

The embedded Node listener binds only to loopback and rejects a non-loopback
Host header. A deployment Adapter may mount the pure `respond` function behind
a reviewed public ingress, but must preserve the exact paths and semantics.
It may not add source collection, reviewer authentication, credentials or
write methods to this Module.

## Consequences

The producer and consumer now share a testable HTTP boundary. A withdrawn,
superseded or stale record remains explicit in its checksum-bound snapshot so
the Röbel consumer can omit it before ranking; transport does not silently
rewrite history.

This ADR does not publish a real Röbel source, create a reviewed corpus, expose
the loopback server publicly, configure DNS or deploy Kubernetes resources.
Production activation still requires a city-specific reviewed dataset,
correction proof, immutable deployment and browser-level citation test.
