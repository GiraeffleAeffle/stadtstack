# ADR 0022: Compose isolated staging Case runtimes before network exposure

- **Status:** accepted; loopback reference implemented; deployment blocked on the Operations gate
- **Date:** 2026-08-23

## Context

ADR 0021 supplies the staging credential, private delivery, projection and
single-listener lifecycle Adapters, but deliberately declares them
non-deploying. A complete tracer now needs process ownership and startup,
readiness, degradation and shutdown semantics. It must not collapse staff
admission, private replay and public discovery into one server merely to make
the demo easier.

There is also an important distinction between a process that is correct on
loopback and a Pod that is safe to expose. A Kubernetes Service cannot reach a
listener bound only to `127.0.0.1`, while accepting `0.0.0.0` before the exact
Service and NetworkPolicy contract exists would widen the staff surface ahead
of its deployment control. This decision therefore separates executable
process composition from later network exposure.

## Decision

### One control process, two civic ports

The staging Case control runtime is one process and the only owner of the
SQLite Adapter, Case coordinator factory and staging steward credentials. It
constructs two different servers over that one durable owner:

1. the authenticated staff admission server; and
2. the credential-free private binding-outbox server.

A capability-free probe server may run in the same process but is not a civic
API and receives no database, token, coordinator or projection capability.
The process binds the probe first, the private outbox second and staff
admission last. It becomes ready only after all listeners are bound. Shutdown
reverses that order so new admissions stop first, replay drains next, the probe
stops last, and invokes the one durable release callback exactly once after
every listener has stopped. A cleanup failure rejects close with one stable,
redacted error instead of reporting success. Any partial bind failure performs
the same reverse rollback before release.

The control composition validates before bind that every configured staging
credential maps to an actor registered as `case_steward` for the same
municipality. The HTTP caller cannot add or replace that actor binding.

### One public process, replay before discovery

The public Case-binding runtime is a separate process. Its configuration
contains only the pinned private outbox origin, public/probe host allowlists,
listener plans and bounded reconciliation policy. It cannot accept a SQLite
path or object, a steward credential, a control service, admission port, Case
coordinator, Kubernetes token or write capability.

Startup exposes at most a not-ready probe, replays from sequence zero through
the credential-free HTTP client, constructs the verified atomic projection,
and only then binds the public discovery listener. Periodic reconciliation is
single-flight and schedules the next attempt only after the previous attempt
settles. A fault preserves the last verified projection bytes but changes
readiness to the stable redacted `outbox_unavailable` state. A later successful
reconciliation restores readiness. Shutdown cancels future polls, drains the
public listener and then stops the probe.

### Capability-free probes

Probe routes are separate from staff, outbox and public Case routes. They
accept only exact credential-free `GET`/`HEAD` requests and return stable
`ok`/`not_ready` bytes. They never serialize phase details, ports, origins,
cursors, exceptions, database paths, identities or secrets. No Kubernetes
Service or Ingress is created for a probe; a later Pod probe addresses its
container port directly.

### Network-exposure gate

The reference composition remains loopback-only until Operations has a
closed-world, independently reviewed contract for all three civic Services:

- staff gateway to Case admission;
- public binding workload to private outbox; and
- designated Röbel/Ingress consumers to public binding discovery.

That contract must include default-deny ingress and egress, exact ports and Pod
selectors, two tokenless ServiceAccounts, no public Secret/PVC/RBAC reference,
and a staging-only check that rejects the token Adapter from production
overlays. Only after that verifier exists may a later change introduce the
deployment bind Adapter for `0.0.0.0`. Self-asserting a network-policy name or
digest in application configuration is not sufficient proof.

The existing Operations topology keeps public binding on port `18086`; the
least disruptive later extension adds the private outbox Service on `18087`
targeting the control Pod while admission remains on `18085`. Probe ports are
not Services.

## Storage boundary

The current SQLite Adapter accepts only test Case identities and a real,
non-symlink directory below the system temporary root. A staging RWO volume may
eventually be mounted at one exact `/tmp/...` directory for the tracer, but it
must not be called production durability. PVC activation remains blocked on a
separate decision covering StorageClass, capacity/growth, encryption,
retention, quiesced backup, isolated checksum-validating restore and ownership.

## Required acceptance suite

The composition is complete only when one integration tracer proves this exact
line through real loopback HTTP:

`signed discussion -> cited Mecky answer -> citizen-signed suggestion ->`
`bearer-protected admission -> atomic SQLite outbox -> private HTTP replay ->`
`public lookup by discussion root and Case ID`

The tracer must also prove invalid credentials and wrong municipality scope
fail before admission without adding an outbox entry, public configuration has
no staff/storage capability, and a durable restart returns byte-identical
public receipts. Focused HTTP/lifecycle acceptance tests prove that replay
failure preserves the prior projection while readiness fails, recovery
restores readiness, in-flight replay is cancelled and awaited on shutdown,
reverse rollback closes every listener, and each release callback is invoked
once. These faults are not injected through the capability-minimal production
composition interface merely to place every assertion in one test function.

## Authority boundary

This runtime composition can admit the already-defined citizen-signed topic
suggestion as one Case and publish its authority-free binding receipt. It does
not create Department feedback, a Citizen Brief, a ballot, a council decision,
an openDesk write, a Safe transaction, Pimlico sponsorship or treasury
movement. Those remain later human and system boundaries on the same Case
line.

## Consequences

The next code slice can prove the whole admission-and-discovery line without a
cluster or duplicated storage. The next Operations slice can then review the
exact exposure and storage contracts without inventing application behavior.
Neither slice alone authorizes a live workload.
