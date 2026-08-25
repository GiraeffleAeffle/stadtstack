# ADR 0030: Close the civic-context loop through explicit municipal publication

- **Status:** proposed
- **Date:** 2026-08-25

## Context

The Kair, Röbel, Stadtstack and openDesk integration is intended to be
bidirectional. Existing municipal publications can ground a consented Kair
session and a Röbel discussion. A signed resident suggestion can become a
Civic Case and enter administration work. The reviewed result should then
return as improved public context for residents, municipalities and agents.

Kair and openDesk can create useful structured material, but neither is the
municipal system of record. OParl provides anonymous read access to already
public parliamentary information; it is not a write workflow and does not
define generic community-discussion, administration-task, ballot or treasury
objects. MCP is a delivery interface for resources and tools; it does not
grant publication or municipal authority.

If a Kair session bundle or openDesk response were allowed to become an OParl
record automatically, transport delivery would silently create official
status. If every reviewed civic artifact were forced into custom OParl kinds,
standard semantics would become municipality- or vendor-specific. Conversely,
if administration results never return to the shared projection, the intended
civic learning loop remains one-way and residents cannot follow an outcome.

## Decision

Introduce an explicit municipal publication boundary with three distinct
artifacts:

1. a **Municipal publication candidate** binds one exact reviewed payload,
   version, digest, proposed publisher, proposed official target kind,
   visibility and correction relationship. It is non-official and has no
   institutional effect;
2. a **Municipal publication receipt** records that a named, accountable
   municipal publisher accepted that exact candidate and assigned an official
   identifier, publication state, version, timestamp and effect ceiling; and
3. an **Official municipal publication** is the resulting public source record.

Only the receipt creates official publication. A Kair Adapter, openDesk
connector, Case coordinator, agent, MCP server, Nostr relay or feed publisher
cannot issue it.

Expose the resulting public information through a **Municipal Civic Context
Exchange** with two linked views:

- a strict OParl-compatible view containing only municipality-published
  parliamentary objects that fit OParl semantics; and
- a broader reviewed civic-context view containing typed Discussions, Reviewed
  sources, Reviewed deliberation artifacts, Citizen Briefs, Case projections,
  eligible publication candidates, official publications and correction/status
  records.

Do not call the exchange “OParl 2” or invent proprietary OParl object types.
When an Official municipal publication fits OParl, project it through the
appropriate standard `Body`, `LegislativeTerm`, `Organization`, `Person`,
`Membership`, `Meeting`, `AgendaItem`, `Paper`, `Consultation`, `File`, or
`Location` relationships. Published results remain attached to their correct
official source semantics; there is no generic OParl `Decision` object.

The exchange is correction-aware and append-only at the event boundary. A
correction, withdrawal or superseding publication produces a new Civic change
event and never rewrites what an old cursor meant. REST/cursor, bounded MCP and
any independently eligible Nostr mirror consume the same public projection
version and digest. MCP and Nostr remain read/delivery Adapters with no
publication, Case, vote or treasury capability.

Keep the following properties independent: origin, review state, visibility,
publication state, institutional effect, authority receipt, consent scope and
correction lineage. Public does not mean reviewed; reviewed does not mean
official; official publication does not necessarily mean a binding decision.

The implementation seams are:

- `CouncilContextCatalog` for exact official-source capture and mapping;
- `SessionEvidenceIntake` for consent-scoped Kair bundles and reviewed
  derivatives;
- `CivicCaseCoordinator` for the resident-to-administration journey;
- `MunicipalPublicationGate` for candidate and receipt verification;
- `PublicContextProjection` for the two linked public views; and
- `OParlProjectionAdapter`, `McpCivicContextAdapter`, and `CivicChangeFeed` as
  replaceable delivery Adapters.

These names describe architectural ownership seams, not required classes or
deployment units.

## Consequences

The administration return can close the public information loop without
pretending that an openDesk work record was already official. Röbel can show a
continuous journey from post to published outcome, while Mecky and other agents
can cite the same correction-aware public context. Municipalities can share
standard parliamentary records and broader reviewed civic learning without
losing source or authority distinctions.

The municipality must name a publication owner and target mapping before the
closed-loop tracer can be accepted. A provider-specific openDesk connector is
insufficient evidence. The prototype also needs candidate/receipt persistence,
idempotency, correction handling, strict mapping validation and public-projection
equivalence tests.

This ADR does not authorize a live municipal publication, OParl endpoint, MCP
endpoint, Nostr publication, formal ballot, Safe transaction or treasury
execution.

## Rejected alternatives

- **Let Kair or openDesk create OParl records directly:** grants official status
  to a session or work-system output without a municipal publisher.
- **Put all civic artifacts into custom OParl objects:** breaks standard
  semantics and creates a proprietary municipal fork.
- **Treat human review as publication:** confuses evidence quality with
  institutional authority.
- **Use MCP as the write or authority layer:** turns an agent-delivery protocol
  into an unaccountable municipal command surface.
- **Publish only a final PDF without the return feed:** leaves residents and
  clients unable to follow corrections or connect the result to its journey.

## Acceptance conditions

This decision may move to `accepted` after a dependency-free tracer proves:

1. a reviewed Kair artifact and an openDesk response remain non-official before
   a valid publication receipt;
2. only the named municipal publisher can accept the exact candidate version
   and digest, idempotently;
3. an invalid official-kind mapping fails closed and never enters the strict
   OParl-compatible view;
4. the broader view preserves the candidate, review and authority distinctions;
5. a correction or withdrawal creates a new change event with intact lineage;
6. REST/cursor, MCP and the Röbel consumer observe the same official publication
   version, digest and correction state; and
7. no path grants Case admission, formal voting or treasury authority.
