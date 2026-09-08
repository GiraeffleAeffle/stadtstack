# ADR 0033: Connect role-scoped workspace review to the existing Case

- **Status:** accepted by the product owner for implementation, 2026-09-08
- **Scope:** neutral reference Interface; no deployment or credential issuance

## Decision

The Citizen App and Town Workspace integrate with one Case coordinator.
Workspace documents and tasks remain with their owning products. Review,
corrections and brief derivation remain attributable Case events. A browser-first
workspace can complement openDesk; its framework and optional desktop shell do
not change the coordination Interface.

Login and municipal authorization are separate claims. Nostr or wallet control
does not establish a staff role. A trusted municipal issuer maps a subject to
scoped, current roles. The staging reference uses explicit test role bindings;
production can integrate city OIDC. A future EUDI Adapter can verify credentials
at the same seam. Account linking is optional and keeps personal participation
distinguishable from official work. Agent and human reviewer identities remain
different, even when one tester exercises multiple human roles.

Public Mecky reads public discussion and reviewed public evidence and answers
with citations, dates and uncertainty. Administration Mecky receives only its
permitted package context and may draft a contribution. Human review and release
remain explicit. A cited explanation of existing public evidence does not itself
require a new official review. New official statements and private-to-public
release do. Accepted changes update the public context consumed by the app,
future map/timeline and public Mecky.

## First implementation

Extend `DurableCaseContinuation`, rather than adding another workflow engine:

- provide an authenticated workspace view filtered to the assigned department;
- permit an assigned contributor to record a draft directly in the workspace;
- retain checksum-bound independent review and steward brief preparation;
- enable synthetic department review only through an explicit constructor pin
  on the synthetic adoption lane, preserving its distinct Case identity;
- admit only department assignment, draft, review, correction/retraction and
  brief derivation on that lane, including during durable replay;
- keep participation, outcome and ordinary public-knowledge delivery outside
  that new synthetic lane until their separately typed integrations exist.

Credentials and trusted actor mappings stay in the server composition. Clients
cannot choose their actor, issuer or role by supplying JSON fields. Workspace
views carry the acting role, Case version and explicit rehearsal status. A view
or successful login never serves as a review attestation.

The existing eight-department brief requirement is retained. Start with one
departmental round trip; it does not constitute a complete Citizen Brief. A
smaller complete brief requires a deliberate change to all affected contracts,
not invented reviews for irrelevant departments.

## Evidence and rollout

Local acceptance must cover signed synthetic admission, authenticated workspace
read/write, cross-department denial, stale-draft denial, durable restart and
unchanged public admission receipt. The existing SQLite configuration fingerprint
includes the explicit review pin. Opening an old store with new actors or policy
must continue to fail; an Operations-owned migration and rollout plan is required
before using the new Interface on an already-deployed Case.

The reference does not issue EUDI credentials, connect live city SSO, write to an
external workspace, deploy a Town Workspace, or claim municipal authority.
