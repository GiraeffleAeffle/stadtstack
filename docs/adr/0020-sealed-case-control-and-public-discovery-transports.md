# ADR 0020: Seal Case control and public discovery behind separate transports

- **Status:** accepted; reference transports implemented
- **Date:** 2026-08-23

## Context

ADR 0018 separates human Case admission from the credential-free Case binding
receipt, but its accepted interfaces are protocol handlers rather than network
services. Passing an unbounded HTTP body directly to the control handler would
leave request size, media type, timeout, Host, and JSON-shape policy undefined.
Serving the in-memory projection object directly would expose its writer beside
the public reader. Combining both surfaces in one listener would also put the
Case Steward credential boundary on the same route table as a public lookup.

The Case binding projection is deliberately rebuildable from the append-only
outbox. It is not permission to give a public workload the SQLite writer,
coordinator factory, admission port, or staff authenticator.

## Decision

Add three small, deployment-neutral Adapters with disjoint capabilities.

1. The **Case Steward control transport** receives only the existing control
   service's `respond` method. It accepts the exact staff-only operation
   `POST /v1/nostr/suggestions/admit`, one opaque authorization header, and a
   bounded UTF-8 JSON body. It rejects every other path, query, alias, media
   type, encoding, method, Host, oversized body, and over-complex JSON value
   before calling the control service. It never receives a public reader,
   outbox, coordinator, SQLite handle, or later Case capability.
2. The **public Case binding transport** receives only `get` and
   `getByRootEventId`. It serves the two exact discovery paths with `GET` and
   conventional representation-equivalent `HEAD`. It rejects credentials,
   cookies, request bodies, transfer encodings, queries, encoded aliases,
   unconfigured Hosts, and every mutating method. A receipt is re-verified and
   bound to the requested Case or root before it crosses the response boundary.
3. The **credential-free outbox projector** receives only `replay`. It hydrates
   the public indexes in bounded pages before readiness. Incremental reconcile
   gathers and validates a complete batch, constructs a fresh projection, and
   swaps it atomically; any sequence, checksum, or uniqueness failure leaves
   the last good reader unchanged. Reconcile is a private composition method,
   never an HTTP route.

The outbox sequence is an opaque, strictly increasing durable cursor rather
than a row count, so generated-key gaps are valid. A delivery Adapter must
present committed entries in order and guarantee that no entry at or below an
observed cursor can appear later. The SQLite reference validates the complete
atomic admission unit before every page; a different delivery implementation
must provide an equivalent completeness guarantee.

The transport factories return unbound Node servers. A deployment composition
root owns the socket bind, shutdown and drain order. It must place staff and
public servers in separate workloads, ServiceAccounts, Services and ingress or
proxy policies. Canonical Hosts, TLS, rate limiting, identity verification,
observability, and request concurrency are Operations configuration, not
caller-selected request fields.

The current Case identifier contains the explicit `:test:` namespace and is a
staging contract. A production Case-ID grammar requires a later coordinated
change across derivation, coordinator, durable admission, receipt verification,
router and consumers; the HTTP path must not loosen it independently.

## Storage and lifecycle boundary

The SQLite Adapter remains a single-writer staging reference. Replaying its
credential-free outbox in the same process proves the read-model contract, but
does not authorize a second pod to mount or open that write database. A real
separate public workload requires an Operations-selected, read-only delivery
implementation for the same outbox contract, or a separately reviewed database
topology. The public workload receives no database-write, Kubernetes API,
staff-authentication, Mecky, openDesk, governance, Safe, or treasury secret.

Startup must validate the durable admission unit and fully hydrate the public
projection before readiness. Shutdown stops new HTTP work, drains bounded
in-flight requests, stops projection reconciliation at a known sequence, and
closes the single database owner exactly once. Backup/restore, storage class,
locking, failover, and multi-replica behavior remain explicit deployment
decisions.

## Authority boundary

These Adapters add transport and replay effects only. They do not authenticate
a resident, create a Case, review a Department response, publish a Citizen
Brief, cast a vote, submit to council, sign a Safe transaction, or move funds.
The staff control service still admits only the exact citizen-signed candidate
through its injected human authenticator. The public service remains
credential-free and read-only.

## Consequences

Röbel can discover a Case without receiving an admission credential, while a
staff route can be deployed without inheriting public traffic. Request parsing
and replay now have executable fail-closed budgets instead of relying on an
ingress promise. The remaining staging deployment work is honest and narrow:
select the staff identity Adapter, public outbox delivery topology and durable
storage, then render two isolated workloads and prove their network boundary.
