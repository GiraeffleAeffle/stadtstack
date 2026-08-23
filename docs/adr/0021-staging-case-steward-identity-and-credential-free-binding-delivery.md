# ADR 0021: Use staging-only steward tokens and credential-free binding delivery

- **Status:** accepted; reference Adapters implemented; runtime composition pending
- **Date:** 2026-08-23

## Context

ADR 0020 seals Case admission and public binding discovery behind different
HTTP transports, but deliberately leaves two deployment decisions open. The
staff transport needs an attributable staging credential Adapter, and a public
workload that cannot mount or open the staff SQLite database needs a replayable
delivery path for already-public Case binding receipts.

Thirdweb or a resident passkey can authenticate a resident subject, but neither
conveys a municipal role without a separately trusted issuer, audience and
subject-to-role mapping. A Thirdweb client ID is public configuration, not a
secret or municipal identity assertion. Safe ownership and Pimlico sponsorship
are wallet capabilities, not staff authorization. Mounting the SQLite PVC into
the public workload, giving it a database or object-store credential, or adding
Kubernetes reconciliation
RBAC would break the public capability boundary.

The first complete journey is explicitly staging-only and still uses
`urn:stadtstack:case:test:*` identities. It needs a small, replaceable path that
attributes use of the tracer to deployment-pinned staging actors without
pretending to prove a human identity or to be the production municipal identity
system.

## Decision

### Human staging identity

Use one distinct bearer token, generated from 32 bytes by a CSPRNG, per staging
Case Steward. Canonical token length proves only encoding capacity; entropy
cannot be established by inspecting the token value. The staging authenticator
maps possession of each configured token to one deployment-pinned
`case_steward` actor and explicit municipality set. It accepts only the exact
admission method and path, parses one exact bearer credential, compares
fixed-length token digests without an early match exit during authentication,
and returns the pinned principal or no principal. Bearer possession attributes
the request to the configured actor; it cannot prevent sharing and is not proof
of a named human or non-repudiation. The token is not an actor identifier. The
caller cannot directly supply or override actor, municipality, command, or the
Case and idempotency identities derived from the signed discussion/suggestion.

Tokens are staging secrets. Operations injects them only into the single Case
control workload from a Kubernetes Secret or equivalent secret store. They
must not enter Git, ConfigMaps, Röbel Web, public Mecky, the public binding
workload, logs, URLs, traces, Nostr events, Case events, or response bodies.
Rotation replaces the credential and restarts the one control workload. A
shared token across multiple humans is forbidden.

The factory requires the explicit composition value
`deploymentEnvironment: "staging"`. Before deployment, Operations CI must also
reject any reference to this Adapter from every production overlay. The module
name and configuration guard reduce accidental reuse; they do not themselves
prove that a deployment is staging.

This is a bounded, attributable staging tracer gate, not the production
identity decision. Production replaces only the injected authenticator with
direct OIDC access
token verification or a cryptographically authenticated administrative
gateway assertion. That later Adapter must pin issuer, audience, subject to
actor mapping, Röbel scope, expiry and revocation, and require the municipality
to select its MFA/WebAuthn policy. Thirdweb or a resident passkey may
authenticate a resident subject, but Thirdweb client configuration, resident
authentication, Safe ownership, and Pimlico sponsorship do not confer Case
Steward authority.

### Credential-free cross-workload delivery

The single-writer Case control workload remains the only owner of SQLite, its
PVC, admission, coordinator factory, and staging steward secrets. On a second
private listener it exposes one credential-free, read-only outbox operation:

`GET /v1/internal/public-case-bindings/outbox?afterSequence={canonical-decimal}&limit={1..256}`

The route accepts no authorization, cookie, request body, transfer/content
encoding, query alias, reordered or additional query field, noncanonical
integer, other method, public Host, ACK, cursor write, delete, arbitrary Case
lookup, or admission command. Each bounded response is read from one validated
SQLite snapshot and contains only ordered `CaseBindingOutboxEntryV1` values.
Every receipt remains independently checksum-verified. Sequence is an opaque,
strictly increasing cursor; generated-key gaps are valid, while a delivery
Adapter must guarantee that an entry at or below an observed cursor cannot
appear later.

A separate public binding workload has no volume, secret, database client,
Kubernetes token, or write capability. Its deployment-pinned HTTP client can
call only that private origin. It fully replays from sequence zero before
readiness, then reconciles bounded pages into the existing atomic projector.
Any transport, JSON, schema, checksum, ordering, duplication, conflict, size,
timeout, or availability failure leaves the last valid public bytes unchanged
and makes readiness fail closed.

The staff admission port, private outbox port, and public binding port are
three different Services or proxy routes even when the first two terminate in
the same single-writer workload. Default-deny NetworkPolicies permit only:

- an administrative gateway to the staff admission port;
- the public binding workload to the private outbox port; and
- the ingress controller and Röbel consumer to the public binding port.

Röbel Web, public Mecky, and other workloads cannot reach either private Case
port. All ServiceAccounts disable token automount and receive no Role or
RoleBinding.

This staging pull deliberately uses plain HTTP inside that isolated network.
Service DNS plus NetworkPolicy are operational routing controls, not
cryptographic peer authentication, and receipt checksums prove deterministic
integrity rather than server identity. A later threat model may require mTLS or
a signed delivery envelope; this reference Adapter must not be represented as
providing either.

## Rejected alternatives

- **Public SQLite or PVC access:** rejected because it crosses the storage and
  writer boundary and inherits WAL, locking, failover, and corruption risk.
- **Database replica:** rejected for this staging slice because it introduces
  credentials, replication, recovery, and failover before the tracer needs
  them.
- **Message broker:** rejected because the public consumer would need broker
  credentials and durable consumer state.
- **Object-store snapshots:** viable later, but require a publishing
  credential, atomic manifest/version protocol, retention, and restore policy.
- **Thirdweb or resident passkey as staff authorization:** rejected because
  authenticating a resident subject does not supply the separately trusted
  municipal role mapping required for Case Steward authorization.
- **Generic signed staff requests:** deferred because key registration,
  nonce/replay state, recovery, revocation, and clock policy would create a new
  identity protocol rather than finish the staging journey.

## Runtime and storage boundary

The control workload is one replica and the only SQLite writer. The public
workload may have no database or staff-secret reference. Startup validates the
complete atomic admission unit; public readiness waits for full replay.
Shutdown stops reconciliation, drains listeners with a fixed deadline, records
the last good cursor as observability only, and closes the database owner once.
The public process replays from zero after restart rather than treating a local
cursor as truth.

Before the staging database is called durable operational evidence, Operations
must select a storage class, RWO volume policy, encryption and retention, then
prove a quiesced backup and isolated checksum-validating restore. None of those
effects is authorized by this ADR.

## Deployment gate

The reference Adapters in this decision are not a deployable runtime by
themselves. Deployment remains fail-closed until all of the following exist in
one reviewed stack:

- a control process that owns both the staff admission listener and the private
  outbox listener, drains both, and releases SQLite exactly once;
- a separate public process that completes replay from zero before readiness,
  reconciles without overlapping polls, preserves its last verified projection
  through an outbox fault, and exposes no database or steward credential;
- a two-process tracer test covering staff HTTP authentication, atomic
  admission, private HTTP replay, projection, and public lookup by Case and
  signed discussion root;
- a deployment-capable listener and a capability-free readiness probe for each
  process; and
- an Operations verifier that permits the staging token Adapter only in the
  staging composition and rejects it from every production overlay.

Until those gates pass, no runtime image, workload, PVC, Secret reference,
Ingress, Flux Kustomization, or live route is authorized by this decision.

## Authority boundary

This decision can attribute possession of a configured staging credential to a
pinned Case Steward actor for the already-defined initial admission command and
deliver an already-public binding receipt. It does not prove the token holder's
human identity or prevent credential sharing. It does not let the token holder
write Department feedback, attest an independent
review, publish a Citizen Brief, cast or count a vote, submit to council,
invoke openDesk, sign a Safe transaction, sponsor a wallet operation, or move
treasury funds. It does not let the public binding workload create or mutate a
Case. Formal production identity, administration connectors, governance and
treasury execution remain separate decisions and effects.

## Consequences

The realistic staging tracer can cross a human gate without leaking that gate
into the resident application, while the public UI discovers the same Case
without touching its source-of-truth database. Both Adapters remain
replaceable: production can replace the authenticator and delivery transport
without changing Case identity, journal semantics, receipt verification, or
the Röbel product line.

The bounded token authenticator, private outbox server and client, asynchronous
hydration/reconciliation, and lifecycle seam are now implemented as reference
Adapters. The next slice must compose and test the two isolated processes before
Operations may add workloads, storage, secrets, ingress, or live bindings.
