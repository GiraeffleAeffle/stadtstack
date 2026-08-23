# ADR 0018: Isolate Case Steward control and expose public Case binding receipts

- **Status:** accepted boundary; local durability reference implemented; network and deployment pending
- **Date:** 2026-08-23

## Context

ADR 0013 defines the atomic command that admits one citizen-signed Topic
suggestion and creates its deterministically identified Civic Case. The
command is intentionally restricted to a human `case_steward`, but a command
kernel alone does not establish a safe product boundary. If Röbel's public Web
client held the steward credential or called an admission route, a resident,
browser extension, or public Mecky process could cross the human authority
gate. If Röbel instead copied the resulting state into its own mutable
workflow, the discussion and Civic Case could diverge.

The public journey still needs one trustworthy way to learn that a separately
performed admission succeeded so it can advance from the signed candidate to
the same Case timeline.

## Decision

Add an asynchronous, protocol-only Röbel control service with one exact staff
operation:

- `POST /v1/nostr/suggestions/admit`

The closed request body contains only the source discussion, cited public
Mecky answer, and citizen-signed suggestion. A separately supplied
`CaseStewardAuthenticator` must return the `case_steward` actor and an explicit
municipality scope containing Röbel. Authentication occurs before the body is
cloned or cryptographically verified; the network adapter must additionally
enforce byte, depth, timeout and rate limits before decoding. The service
independently verifies all three signed artifacts, derives the Case identity,
expected version zero, and the deterministic idempotency key, and invokes only
`admit_signed_topic_suggestion_v1`. The caller cannot choose a Case identifier,
actor binding, expected version, or idempotency key.

The control handler delegates the state change to one deployment-owned atomic
admission port. That port must durably claim the immutable discussion root,
append the initial Case events and enqueue the public receipt in one database
transaction, or provide an equivalent replay-safe journal/outbox guarantee.
The root claim is globally unique within the municipality so two replicas
cannot admit different candidates for one discussion. Unknown adapter faults
are redacted from the public response.

On success, project one `public_case_binding_receipt_v1` from the coordinator
receipt. It binds the immutable discussion root, Topic, candidate, cited
answer, Case identity and version, ordered Case event identities, journal head
and receipt checksum. It explicitly carries `authorityBinding: "none"` and
`openDeskWrite: false`. It neither changes the signed Nostr root nor starts an
administration, publication, governance, voting, or treasury operation.

Expose that receipt from a separate, credential-free reader through exact
GET-only lookups:

- `/v1/public/case-bindings/{caseId}`
- `/v1/public/case-bindings/by-discussion/{rootEventId}`

The public route accepts no credential or request body, rejects query strings
and writes, and fails closed for unknown identities. Its interface exposes no
writer, authenticator, admission method or coordinator. One discussion root
may bind to only one receipt. Röbel's public UI may sign a candidate and read
this projection; it must not receive the Case Steward credential or admission
command. Staff control and public read use separate composition roots, pods,
service accounts, Services and ingress/network policies.

The private append-only Case journal remains the durable source of truth. The
binding receipt is a public-safe, replayable read model, not a second workflow
store. A production adapter must rebuild its indexes from the durable outbox
before readiness after restart. Its checksum detects corruption and binds the
receipt fields; it is not independently authentic without the trusted
Stadtstack projection endpoint or a future signed inclusion proof.

## Consequences

Citizen signing, human Case admission, and public journey advancement now have
three distinct owners and receipts. Public Mecky can explain evidence and help
draft a candidate but cannot admit it. A Case Steward can admit only the exact
verified candidate and gains no later municipal authority. Röbel can render
the resulting Case without keeping an administrative secret or inventing a
parallel lifecycle.

The repository includes a staging-only SQLite reference for the durability
boundary. One municipality database uses WAL and `synchronous=FULL`; the first
Case transaction claims the immutable root, appends the initial journal and
idempotency record, and writes the public receipt and append-only outbox. A
deployment-pinned actor registry preserves the exact authenticated Case
Steward identity, while the same private coordinator/journal composition seam
continues later Case commands. Startup and public replay fail closed unless
the journal, claim, receipt, and outbox form one checksum-bound unit.

The reference still provides no network listener, staff OIDC/WebAuthn adapter,
secret lookup, operator console, Kubernetes resource, ingress rule, or live
Röbel wiring. It does not make SQLite-on-a-shared-volume a production storage
decision. Multi-pod contention against the selected shared storage,
post-commit crash recovery, public readiness replay, backup/restore, and the
selected deployment database remain mandatory integration work for the
deployment slice.
openDesk delivery, Citizen Brief publication, formal governance and treasury
execution remain separately authenticated commands under their own decisions.
