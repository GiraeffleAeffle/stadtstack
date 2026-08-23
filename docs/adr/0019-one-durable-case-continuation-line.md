# ADR 0019: Continue administration, Citizen Brief, Mitmachen, and outcome on one durable Case line

- **Status:** accepted; authenticated local composition reference implemented
- **Date:** 2026-08-23

## Context

The accepted contracts already cover the individual steps after human Case
admission: a provider-neutral administration request and return, independent
Department review, Citizen Brief readiness, advisory participation, and a
reviewed public outcome. ADR 0018 and its SQLite staging reference additionally
make the initial Case admission, public binding receipt, and outbox atomic.

Those pieces are insufficient if a Röbel page, administration workspace, or
Mini App recreates the workflow in its own database. Copying a status such as
"awaiting administration" or rebuilding a brief beside the coordinator would
create parallel timelines, weaken correction handling, and make it impossible
to prove that the public outcome belongs to the discussion the resident
actually signed.

## Decision

Add one deployment-neutral **Durable Case continuation** Module over the
existing `caseCoordinators.open(caseId)` seam. It may operate only on a Case
that the atomic admission store already contains. Every operation reopens the
exact Case, reads a fresh role-scoped projection, and delegates domain
validation and appends to the existing coordinator and journal.

The Module composes, but does not replace, the existing boundaries:

1. prepare one checksum-bound administration work request from the current
   Department package;
2. bind a separately observed workspace handoff and return; appending the
   private draft requires both the administration actor that observed the
   handoff and the assigned Department agent;
3. assess Citizen Brief readiness and let a registered human Case Steward
   apply only the exact prepared derivation command;
4. accept advisory participation and reviewed outcome commands only at the
   exact current Case version and through their already registered human role;
   and
5. derive the one current Public knowledge projection consumed by both Public
   Mecky and Mitmachen.

Every private operation requires an injected, Case-scoped role authenticator.
The Module authenticates before it reads a private projection or supplies a
registered actor binding to the coordinator. The Case Steward, administration
reader, each of the eight Department agents and independent reviewers, and the
participation reviewer are pinned configuration actors; their actor IDs must
be unique. A returned workspace response is therefore a two-role transition:
the assigned agent cannot manufacture the administrator's handoff attestation,
and the administrator cannot author the Department draft. Public knowledge
remains a credential-free public projection.

The interface must not accept a caller-provided projection, stage, Case
version override, authority flag, actor binding, or parallel persistence
handle. Stale or cross-Case requests, handoffs, returns, commands, policies,
actors, and checksums fail before an append. Closing and reopening the durable
store must recover the same Case version, journal head, projection checksum,
and public knowledge checksum.

Mini Apps may render a focused view or collect an input, but they remain views
of this line. They do not own a second proposal, Case, brief, participation
result, treasury state, or execution timeline.

## Authority and deployment boundary

This Module is a deployment-neutral, authenticated staging composition
reference. Its authenticated commands do append internal events to the one
durable Case journal. It has no HTTP listener, concrete OIDC or WebAuthn
authenticator, openDesk credential, connector, publication key, formal ballot,
council submission, Safe transaction, or treasury capability. Preparation
does not send; a workspace acknowledgement does not constitute Department
review; advisory participation is not a vote; and a reviewed outcome is not a
municipal decision or execution receipt.

Returned public citations may be stored as exact, public-shaped HTTPS
references with no user information, port, fragment, local/test hostname, or
credential marker. This compatibility rule does not fetch the URL or grant a
network capability. Private evidence remains synthetic in the local reference
until a separately owned private evidence store is decided.

The separately sealed staff control route and GET-only public receipt route
remain the next deployment slice. A live administration connector, public
projection publication, formal governance, and treasury execution each need
their own exact owner and external-effects gate.

## Consequences

The desktop and mobile product can show one continuous journey while each
transition still has its correct human owner. Corrections and retractions flow
forward from one journal rather than being reconciled across Mini Apps. Public
Mecky and Mitmachen cannot disagree because they consume one projection at one
Case version and checksum.

The local tracer becomes meaningful evidence for the whole product line, but
an injected test authenticator does not by itself prove production staff
identity, network isolation, a live workspace round trip, publication, or
municipal authority.
