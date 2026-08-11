# ADR 0013: Run the permanent Röbel workflow behind one reviewed-public boundary

- **Status:** accepted
- **Date:** 2026-08-11

## Context

ADR 0012 closes the in-process Case loop from a resident's signed suggestion
through reviewed administration material, a Citizen Brief, advisory
participation, and a reviewed outcome. Röbel-App now has two consumers of that
same public truth:

- the Mitmachen tab displays reviewed Cases and their current stage; and
- Public Mecky answers an explicit `@Mecky` question autonomously from reviewed
  public evidence and cites the Case it used.

The existing Talos platform also runs unrelated releases, including the current
Röbel presentation deployment and a WordPress project. A permanent Stadtstack
release must not adopt, relabel, or replace any of those resources. The earlier
`stadtstack-e2e` runtime used an `emptyDir` and synthetic fixture. It is useful
evidence, but it is not a promotable permanent release.

## Decision

### One public read Module

Add `createPermanentPublicRuntime` as the single public HTTP Module over a
`PublicKnowledgeReader`. It publishes only:

- the reviewed municipality Case index;
- the checksum-bound Case manifest and stage map;
- a checksum-bound reviewed public artifact;
- the read-only Mitmachen reference page and public Case page; and
- health/readiness endpoints.

The Module has no command, vote, relay-write, administration, Secret, or
workspace capability. Before the coordinator can derive a complete reviewed
`PublicKnowledgeProjectionV1`, the municipality index responds `200` with
`cases: []`. It never substitutes demo content, an old cached projection, or an
unreviewed Case. Malformed scope, Case, policy, checksum, Host, method, or route
input fails closed.

The public projection is adapted to Röbel-App's pinned
`civic_federation_case_index_v1`, `civic_federation_manifest_v1`, and
`civic_case_stage_snapshot_v1` contracts. The Case, manifest, stage map,
Mitmachen page, and Public Mecky therefore have one source of truth. Root-
relative URLs remain confined to the configured Stadtstack origin.

### The visible civic flow

The permanent Röbel flow is:

1. a resident writes a signed public discussion and explicitly mentions
   `@Mecky`;
2. Public Mecky may answer immediately, without per-answer administration
   approval, but only from already reviewed public Case evidence and with
   citations;
3. a resident edits and signs a suggestion; that signature is provenance, not
   admission or municipal authority;
4. an accountable steward admits the exact signed suggestion;
5. eight role-bound administration packages are drafted and independently
   reviewed;
6. the coordinator derives the reviewed Citizen Brief;
7. Mitmachen displays the Citizen Brief and the reviewed advisory choice/result;
8. a reviewed institutional outcome is linked back to the discussion; and
9. later delivery and outcome evidence remain visible as the same Case advances.

The Citizen Brief, advisory result, and reviewed outcome are visible in the
Mitmachen tab and may be explained by Public Mecky. They are not silently
converted into a formal governance vote. `formalVoteAvailable` remains false
until a separately owned legal-authority Adapter binds the Case to an actual
ballot. Public Mecky cannot vote, admit a suggestion, approve administration
work, publish an institutional response, or access private evidence.

### Separate public and control planes

The public server remains read-only. Commands enter through a separate
cluster-internal control Adapter with its own Service, NetworkPolicy, exact
role identity, value-free Secret reference, body limit, idempotency key, and
audit receipt. Its Ingress exposure is forbidden. A credential for one actor
may not impersonate another actor. The control Adapter may only call the
coordinator's existing `handle` operation; it does not receive public
publication or infrastructure capabilities.

Röbel-App, Stadtstack, and private operations stay separate:

- `Roebel-App` owns the discussion UI, Mitmachen UI, Nostr integration, and
  Public Mecky watcher;
- `stadtstack` owns public coordination contracts and the runtime Modules; and
- `stadtstack-operations-private` owns Talos manifests, Secret references,
  registry/readback receipts, backup configuration, apply, and rollback.

The historical `stadtstack-bootstrap-private` repository remains provenance
and recovery material until its contents have been inventoried and superseded;
it is not the source of the permanent app release and is not deleted as part of
this decision.

### Durable state and recovery

Run exactly one coordinator replica for the first permanent release. Store its
SQLite WAL journal on one dedicated `Retain` persistent volume mounted at the
adapter's bounded path `/tmp/stadtstack-cases`. No existing PVC, database,
bucket, or namespace may be adopted. A second active writer is forbidden until
the journal interface is replaced by a reviewed multi-writer implementation.

The release is not ready to apply until private operations binds:

- an exact PVC, StorageClass, capacity ceiling, owner labels, UID preconditions,
  and reclaim behavior;
- a dedicated versioned object-storage bucket/prefix and least-privilege backup
  identity, separate from Terraform state, registry, database, and other
  projects;
- an online-consistent SQLite backup mechanism, restore init path, retention,
  checksum, and alerting;
- a successful empty-namespace restore rehearsal and byte-/event-identical
  replay receipt; and
- a rollback plan that preserves the retained journal and backup unless the
  operator explicitly selects the separately reviewed data-destruction step.

The Terraform/OpenTofu state may later move to its own dedicated, versioned
Hetzner Object Storage backend. That migration is a separate infrastructure
operation; it must not share this runtime's bucket, credentials, or lifecycle.

### Talos release boundary

Deploy the workflow into a dedicated permanent namespace (planned as
`stadtstack-roebel-workflow`) with exact resource ownership. Preserve the
existing Röbel preview, WordPress, data, registry, ingress, and administration
workloads byte-for-byte unless a later reviewed release explicitly names one.

The release uses immutable linux/amd64 image digests, registry readback,
server-side dry-run and Kubernetes conformance, explicit NetworkPolicies,
value-free Secret references, non-root containers, bounded resources, and an
outside-inventory digest. Apply requires one consolidated human approval after
all locks pass. Canary/readiness and browser QA precede traffic promotion.
Rollback targets only resources whose namespace, UID, resourceVersion, labels,
and manifest digest match the release receipt.

## Consequences

Röbel-App can show reviewed Citizen Briefs and advisory results and Public
Mecky can answer from them without creating a second store or an administration
approval queue. An empty or incomplete Case remains honestly unavailable.

The first permanent runtime favors a simple, auditable single-writer journal
over horizontal coordinator scaling. Availability depends on the retained
volume and tested object-storage restore. The public stateless read Adapter and
Public Mecky watcher can be restarted independently, but the watcher also runs
as one replica until a reviewed leader/partition contract exists.

This ADR authorizes architecture and local release preparation only. It does
not itself authorize registry publication, Secret materialization, Talos apply,
traffic changes, formal voting, municipal decisions, or deletion.
