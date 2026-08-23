# ADR 0023: Stage Case state with quiesced backup and fresh-volume restore

- **Status:** accepted as an activation gate; implementation in progress
- **Date:** 2026-08-23

## Context

ADR 0022 proves the Case admission and public binding line with one SQLite
owner, but its temporary directory is deliberately not a durability claim. A
Talos deployment needs an explicit owner for the database, a bounded loss and
recovery objective, and evidence that a backup can recreate the same Case and
public receipt. Merely attaching a persistent volume protects against Pod
replacement; it does not protect against corruption, accidental deletion,
schema mistakes or loss of the volume.

The backup destination must also not be confused with Terraform state. Both
may use S3-compatible object storage, but they have different data,
credentials, retention, recovery and authority boundaries.

## Decision

### One control-only staging volume

The staging Case control Deployment is the sole writer and sole runtime mounter
of one persistent volume claim. `ReadWriteOncePod` is preferred if the live CSI
driver proves support; otherwise the claim uses `ReadWriteOnce` together with
one replica, a `Recreate` strategy, no overlapping rollout and a closed-world
check that no other controller or Pod references the claim. The old Pod must be
observed terminated and its volume detached before a replacement starts. The
application must also acquire and hold one exclusive owner lock before opening
SQLite or binding a civic listener. `ReadWriteOnce` alone is not treated as a
single-writer guarantee because two Pods on one node can otherwise overlap.
The public binding Deployment has no volume, SQLite path or Kubernetes
permission over the claim.

The owner lock is a live advisory/exclusive operating-system lock held for the
process lifetime and released by process death. It is not a persistent sentinel
file and cannot be confused with the durable shutdown seal written only after a
successful checkpoint and close.

The SQLite Adapter now accepts durable mode only at one exact, existing,
non-symlink directory; the legacy multi-connection reference mode remains
restricted below the system temporary directory. That path check and the
root-global live owner lock are a reference foundation, not a live storage
claim. Before any non-loopback civic listener binds, Operations must also prove
the expected uid/gid and permissions, filesystem type and free-space floor,
StorageClass/PVC identity and the reviewed bind composition. A mismatch must
fail before the listener becomes ready.

### Reviewed control deployment preflight

The live control composition uses one deep application Module rather than
passing raw storage paths, hosts or ports through process configuration. Its
input has one source port for the canonical **Reviewed control deployment
binding**, a separate source port for its immutable checksum pin, and a narrow
local filesystem-observation Adapter. The protected Operations verifier is the
remote-but-owned source of truth for Kubernetes facts; the filesystem Adapter
is local-substitutable and observes only the mounted filesystem. The
application receives no Kubernetes API client, ServiceAccount token, Downward
API identity claim or permission to discover or select a claim.

The reviewed binding closes over the exact staging environment, municipality,
namespace, control workload and release; PVC name and immutable UID; PV and
StorageClass identity; access and volume modes; requested bytes; exact mount
root and immutable marker; expected uid, gid, permission bits, filesystem
magic and minimum available bytes; and the three fixed control listener
identities and ports. The bind scope is the closed semantic value
`pod_network`: admission is `18085`, private outbox is `18087`, and the
capability-free control probe is `18088`. No caller can supply a host string or
change those ports. The existing reference factory remains loopback-only.

Preflight is ordered before the credential authenticator, durable SQLite owner,
HTTP server construction and every bind. It validates the canonical binding
and independently pinned digest, then requires one exact existing non-symlink
mount root, an exact read-only marker, matching real path, uid/gid/mode and
filesystem type, and `availableBlocks * blockSize >= minimumAvailableBytes`
using integer arithmetic that cannot overflow. It returns only an opaque,
runtime-verified authorization from which the control composition can derive
the exact durable root, source release and listener plans. A structural cast or
plain-object forgery does not authorize a Pod-network bind.

Any mismatch fails closed with stable operational errors before the database,
owner lock, shutdown seal or socket exists. Health never reveals a path,
claim/PV/StorageClass identity, filesystem fact or bind address. The public
Case-binding runtime cannot receive the binding, filesystem Adapter, control
credential, volume or write capability. These checks authorize deployment
composition only; they are not Human Case admission, Review attestation,
publication, governance or treasury authority.

Binding-source reads, the immutable pin read, local observation and the SQLite
open occur synchronously with no application-controlled asynchronous gap;
listener construction and binding happen only afterwards. This Interface
checks the facts presented by an honest mount namespace. It does not claim to
defend against a compromised node, kernel, CSI implementation or root process
that can replace mounts or files during system calls; those remain protected
Operations and cluster-security authorities. Reviewed in-process source code
is likewise trusted at this seam: the opaque proof prevents accidental or
unreviewed composition, but is not a sandbox against malicious code already
running inside the control process.

Operations may publish the schema and an explicit `blocked` evidence inventory
before the live claim exists, but it must not substitute guessed values for a
PVC UID, PV, StorageClass, filesystem, ownership, capacity, release digest or
binding digest. A deployable binding is admitted only after every exact fact is
reviewed and protected. Two different in-memory wrapper objects are not proof
of independent authority: the live Operations composition must implement the
binding source from the protected reviewed artifact and the pin source from a
separately protected immutable deployment value.

The live storage contract must capture the claim's access and volume modes,
StorageClass, requested capacity and minimum free-space threshold, filesystem,
reclaim policy, binding mode and topology, expansion support and volume
encryption evidence. No manifest may invent a StorageClass name or silently
select the cluster default.

The staging recovery-evidence format and durable owner have one matching,
reviewed operational capacity of 10,000 Cases per municipal store. A new Case
is rejected before its first row commits when that capacity is reached, so a
valid store can never cross into an unsealable state. This is storage
backpressure, not a civic eligibility or rejection decision: the system must
report admission unavailable, preserve already admitted Cases, and require a
reviewed capacity/evidence-format migration before reopening intake.

The state claim is not part of an ordinary pruning application Kustomization.
It is either outside Flux inventory or in a separate reviewed state
Kustomization whose installed-version behavior has been proven to retain the
claim during removal and rollback. A comment saying “do not prune” is not
sufficient evidence.

### A two-phase GitOps maintenance transaction

The backup Job does not receive permission to scale workloads or suspend Flux.
The owner of quiescence is a two-phase, protected Operations transaction:

1. an enter-maintenance change makes both civic Services select no active
   release slot, scales public polling to zero and requests graceful control
   shutdown; the control shutdown hook rejects new admission, drains both
   listeners, runs `wal_checkpoint(TRUNCATE)`, verifies the checkpoint result,
   closes SQLite and writes a shutdown seal beside the database;
2. Flux keeps both Deployments at zero while an external verifier observes Pod
   termination and volume detachment; the seal pins the source release,
   database path, schema, Case count, outbox cursor, checkpoint result and
   closure time, and the main database has no non-empty WAL or SHM file;
3. only then may the exact reviewed backup Job run; and
4. a separate resume change is admissible only after the retained upload and
   restore evidence are complete. Any failure leaves the system in maintenance
   mode and does not recreate a writer.

The control runtime receives a signed, non-secret recovery attestation that
pins environment, municipality, stable store and PVC identity, backup ID,
shutdown-seal/checkpoint time, source release, signer policy and expiry. The
expiry is calculated from database closure time, not upload, restore or review
completion. Startup and admission fail closed when that recovery point is
older than 24 hours or any binding differs. Existing public projections may
stay readable, but no new Case admission resumes until a fresh attestation has
been reviewed.

### Quiesced, application-consistent backups

Staging accepts a short maintenance window in exchange for a simple and
auditable backup:

1. verify the enter-maintenance revision, shutdown seal, zero replicas, Pod
   termination, volume detachment and absence of a non-empty WAL or SHM file;
2. mount the claim read-only in a one-shot Job whose ServiceAccount token is
   disabled and whose backup credential is available only to that Job;
3. run SQLite integrity verification and copy the complete closed database;
4. create a canonical manifest containing schema version, source release
   digest, database byte length, SHA-256 checksum, Case count, outbox cursor,
   creation time, retention class, canonical projection schema version,
   projection entry count, a canonical ordered set of `(Case ID, Case version,
   journal-head checksum)`, its aggregate digest, and the digest of every
   Case-ID/discussion-root receipt;
5. encrypt the database as an `age` v1 envelope to one versioned X25519
   recipient whose private identity is unavailable to the backup Job, then
   upload it;
6. pin the exact bucket, database object key, returned object version, sizes,
   ciphertext and plaintext checksums, retention deadline, envelope version and
   recipient fingerprint into the manifest, encrypt that manifest and upload
   it;
7. write as the last object a signed completion receipt containing only
   civic-content-free metadata at a content-addressed unique key that pins the
   exact bucket, manifest object key and version, manifest ciphertext checksum,
   retention deadline, signing-key version and one immutable backup identifier;
   and
8. record that receipt's exact key, returned object version and checksum through
   a compare-and-swap update to the protected Operations recovery catalog.

The receipt is the object-store commit marker; the recovery catalog is its
external root locator and is outside the backup writer's authority. Restore
starts only from an exact catalog entry and never requires bucket listing. A
database object or manifest without a valid matching receipt and catalog entry
is incomplete and never restorable. The backup signing key is one-purpose
operational authority, not civic authority; its public verification key is
pinned in reviewed Operations policy.

Copying the live database file, WAL or shared-memory sidecar while the control
process is running is forbidden. The read-only Job cannot repair an unsealed
WAL; it must fail instead. A CSI `VolumeSnapshot` may later reduce downtime,
but it does not replace the checksum-validating restore drill and is not
assumed to exist in the current Talos cluster.

Backups run before every database/schema-affecting release and at least once
per 24 hours while the staging Case runtime is active. The staging objectives
are an RPO of at most 24 hours and a measured RTO of at most 4 hours. Missing or
expired backup evidence closes admission; it must not merely emit a warning.

### Versioned, retention-protected object storage

The preferred staging target is a dedicated private Hetzner Object Storage
bucket because it exposes an S3-compatible API, versioning and Object Lock.
Object Lock must be enabled when the bucket is created; it cannot be added
later. The bucket uses versioning, bucket-default governance-mode retention of
at least 35 days, a lifecycle policy for obsolete noncurrent versions, and
deletion protection on the bucket resource. The upload receipt must still
prove retention on every database, manifest and completion-receipt version.
Client-side encryption remains mandatory; the object store is not trusted with
plaintext civic state.

Hetzner S3 keys are project-wide by default, so the backup and restore keys are
preferably created in separate credential projects. In every layout the bucket
policy must deny default project-wide reach before it allowlists the two exact
identities and prefix actions. The backup writer receives only the upload and
multipart-cleanup actions required for the exact staging prefix; it receives no
read, delete or governance-bypass action. The restore identity receives
exact-version read access, including `GetObjectVersion`, and no write or delete
action. Neither identity is mounted in either civic Deployment. Credentials
and private keys never enter Git, image layers, public Mecky, the Röbel Web
Deployment or the public binding workload. Any governance-retention bypass
identity is separate, offline and available only through an audited break-glass
procedure.

The `age` recipient fingerprint and envelope version are pinned per backup.
Rotation never removes an old private identity before every retained bundle it
protects has expired. Activation and every rotation require a key-recovery
drill from escrow using an exact retained bundle.

The Terraform backend uses a different private bucket, credential and recovery
runbook. A prefix in the Case bucket is not sufficient administrative
isolation. Case backup Jobs cannot read or write Terraform state, and Terraform
automation cannot read Case backups.

### Restore into a fresh claim

A restore never overwrites the active claim. The restore procedure:

1. creates a fresh, explicitly named PVC with the reviewed StorageClass and
   capacity;
2. downloads the exact receipt-pinned manifest object version with the
   read-only restore identity;
3. verifies the signed receipt and manifest ciphertext checksum, decrypts the
   authenticated manifest and validates its canonical form;
4. downloads the manifest-pinned database object version, verifies its
   ciphertext checksum, decrypts it in memory or on the fresh claim and
   verifies the manifest's plaintext database checksum;
5. runs SQLite integrity checks and validates the expected schema, Case count
   and outbox cursor;
6. starts a uniquely labelled blue/green control runtime against the fresh
   claim and a separate restored public runtime behind restore-only Services
   and NetworkPolicies; only control mounts the claim, while public remains
   credential-free and volume-free and may reach only the restore control
   outbox. No Röbel or staff workload may reach either restore Service;
7. replays the private outbox into that fresh public projection and compares
   the canonical response bodies—not dynamic HTTP headers—against the manifest
   entry count, ordered per-Case version/journal-head checksums, aggregate
   digest and exact Case-ID/discussion-root receipt digests;
8. records the measured duration and reviewer attestation; and
9. only then permits a separately reviewed switchover and soak: admission remains
   blocked, the public Service selects the restored public slot, the control
   admission Service selects the restored control slot, and both are verified
   for a bounded soak before admission is reopened. Service selectors choose
   release slots; they never pretend to choose a PVC.

The old Deployment and claim are retained and never pruned by Flux. Direct
selector rollback to that slot is permitted only during the soak and before the
first post-cutover admission. After any new admission, the old claim is
forensic evidence rather than a safe rollback target; recovery requires a new
quiesced backup and forward restore so that no newly admitted Case can be lost.
A failed restore destroys neither claim and cannot alter the active Deployment.

## Activation evidence

The first reconciliation remains blocked until a review bundle contains:

- the complete live storage and control-only mount contract;
- the exact default-deny, maintenance and restore-isolation policies;
- bucket policy, versioning, Object Lock, default and per-object retention and
  deletion-protection evidence;
- redacted backup/restore identity policies;
- one signed completion receipt containing only civic-content-free metadata and
  one encrypted backup manifest without credentials or personal content;
- the compare-and-swap Operations recovery-catalog entry that externally pins
  the receipt key, exact object version and checksum;
- one redacted decrypted manifest proving that every required field is present;
- one isolated successful restore report with checksum, Case/outbox counts,
  byte-identical canonical public receipts, RPO and measured RTO;
- immutable control, public, backup and restore-verifier image digests with
  provenance and SPDX SBOM evidence;
- one successful escrow/key-recovery drill; and
- rollback instructions that retain both the old PVC and backup objects.

## Consequences

The staging flow can survive Pod replacement and can be recovered from an
independently protected artifact without giving the public workload storage
authority. Backups introduce a short planned outage and separately scoped
Jobs. Online backup, multi-writer databases, production retention, legal data
retention and disaster recovery across providers remain later decisions.

## Source capability notes

Hetzner documents S3-compatible Object Storage, bucket versioning, lifecycle
policies, per-key bucket policies and retention-based Object Lock. Object Lock
must be selected when a bucket is created. Hetzner also states that objects are
not encrypted at rest by default. These provider capabilities support this
decision but do not themselves constitute configured or tested backup
infrastructure:

- <https://docs.hetzner.com/storage/object-storage/howto-protect-objects/protect-versioning/>
- <https://docs.hetzner.com/storage/object-storage/howto-protect-objects/protect-object-lock-retention/>
- <https://docs.hetzner.com/storage/object-storage/howto-protect-objects/manage-lifecycle/>
- <https://docs.hetzner.com/storage/object-storage/faq/s3-credentials/>
- <https://docs.hetzner.com/storage/object-storage/faq/general/>
