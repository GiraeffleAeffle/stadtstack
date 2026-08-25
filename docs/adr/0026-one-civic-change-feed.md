# ADR 0026: Publish one Civic change feed with bounded MCP and Nostr adapters

- **Status:** proposed
- **Date:** 2026-08-24

## Context

The project needs an RSS-like interchange so Röbel, Mecky, municipal tools,
and future Netizen clients can learn what changed. MCP is useful for bounded
agent access, while Nostr is already the signed public exchange seam for Röbel
discussion and public-safe records. They solve different delivery problems.

If each consumer reads a different database, or if MCP becomes a write API,
the same Civic Journey can fork into incompatible Case, Citizen Brief, or
treasury timelines. If Nostr becomes the Case journal, private records and
authority transitions become relay data. A single eligibility-gated Public
knowledge projection is needed, with replayable corrections and
transport-specific adapters.

## Decision

Define one **Civic change feed** over the existing Public knowledge
projection. Its initial interchange is a bounded, read-only REST/cursor feed:

```text
GET /v1/changes?cursor=<opaque>&limit=<bounded>
GET /v1/changes/<change-id>
```

Each page returns a stable projection version, a bounded set of
`civic_change_event_v1` records, and an opaque next cursor. The cursor is a
delivery position, not a database row count, Case version, or authority token.
Corrections and withdrawals are new eligibility-gated changes that preserve the
lineage of the previous record; an old cursor never silently changes meaning.
The feed rejects writes, arbitrary upstream fetches, private identifiers,
credentials, and caller-selected authority.

Each change record is content-minimal: it carries the public artifact
reference and kind, projection version and digest, correction state and change
time. It carries no title, summary, raw source reference, session/bundle
identity or authority upgrade. Artifact content remains in the separately
versioned Public knowledge projection.

An Official municipal publication admitted through ADR 0030 becomes a new
eligible artifact and change event. Its preceding Municipal publication
candidate remains a distinct artifact with lower authority. The feed never
upgrades a Kair derivative or openDesk response merely because it was delivered.

MCP is a bounded read Adapter over exactly the same projection and digest. It
may expose resources and read-only tools for retrieving a Topic, reviewed
source record, Case projection, citation, correction, or change cursor. It
must enforce municipality, visibility, source, and result-size limits. MCP
notifications or subscriptions may later reduce polling, but they are not a
second source of truth and do not replace cursor replay.

MCP may expose the strict OParl-compatible view and the broader Municipal Civic
Context Exchange defined in ADR 0030, but it must preserve their record kinds
and authority states. It does not invent a generic OParl `Decision` resource;
published results remain attached to the correct official source semantics.

Nostr is a signed public mirror for eligible Discussion and Public exchange
records. The event carries the public-safe envelope and projection digest. It
does not expose the private Case journal, consent receipts, raw audio, private
evidence, workspace identifiers, or authority credentials. A relay is a
transport and discovery surface, not a Civic case owner.

Only permanently public artifacts are eligible for this irreversible mirror.
Meld/Kair derivatives are excluded by default and require a separate explicit
irreversible-publication consent plus permanent-public eligibility. A later
withdrawal can produce a signed correction but cannot erase replicated relay
copies.

The REST feed, MCP Adapter, and Nostr publisher all read from the same eligible
projection version. A verification harness must prove that their
public-safe records, correction state, and projection digest agree. None of
the three transports can perform Human Case admission, openDesk handoff,
Citizen Brief derivation, advisory participation, formal voting, or treasury
execution.

## Consequences

The system gets a simple first interchange that behaves like RSS while leaving
room for agent-friendly reads and signed public replication. Public Mecky can
answer normal explicit questions from reviewed artifacts without the
administration checking every sentence. Röbel's feed and Mitmachen view share
one versioned projection instead of maintaining mini-app copies.

The projection builder, cursor retention, correction policy, bounded MCP
schema, and signed Nostr mirror still need implementation and Operations
review. A public endpoint or relay publication is not authorized by this ADR;
the deployment and publication effects remain separate decisions.

## Rejected alternatives

- **MCP as the only feed:** couples fan-out interchange to agent-session
  semantics and makes replay/correction less explicit.
- **Nostr as the Case source of truth:** exposes the wrong data and grants a
  relay an authority it cannot safely own.
- **A feed per Mini App:** duplicates Case state, review state, and correction
  handling.
- **Direct source retrieval during inference:** bypasses human source admission
  and makes a citation change without a projection version.

## Acceptance conditions

The decision can move to `accepted` after a dependency-free reference proves
bounded parsing, deterministic pages, cursor replay, correction/withdrawal,
MCP read equivalence, Nostr signature verification, and rejection of every
write or authority-bearing path.
