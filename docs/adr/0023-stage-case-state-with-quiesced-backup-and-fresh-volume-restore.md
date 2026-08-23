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

The durable root also has a small, canonical epoch ledger. The first empty
store is admitted only through a mode-0600, file-and-directory-fsync'd
`case-store-bootstrap-v1.json` receipt. Before an ordinary durable runtime
opens a sealed store it writes a separate mode-0600,
file-and-directory-fsync'd `case-open-epoch-v1.json`, recording the exact clean
shutdown seal that is its baseline. The bootstrap receipt is consumed once that
initial database has been sealed; an open-epoch receipt is removed only after
the next clean seal is durable. These are local integrity receipts, not
Kubernetes authority and not restart permissions.

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

The reference recovery-attestation Module is an effect-free verifier. It reads
one reviewed per-operation policy and its separately pinned checksum, the
protected catalog locator, the local shutdown seal, the signed recovery
attestation and a trusted UTC clock through narrow source ports. It verifies
the attestor's purpose-specific Ed25519 public key and binds the catalog CAS
generation, exact receipt and encrypted-manifest object versions, source and
fresh target PVC identities, reviewed restore-verifier release, database
bytes, canonical recovery evidence, isolated restore report, four-hour RTO
and closure-derived 24-hour expiry. It
has no bucket, Kubernetes, signing, civic or credential capability. A valid
signature is operational recovery evidence only; it cannot admit a Case,
publish content, vote, move treasury funds or select a Service/PVC.

Distinct in-memory source wrappers are reference seams, not proof of separate
authority. The live composition must source the policy, its pin and the catalog
locator from separately protected Operations artifacts and bind their exact
resource versions. Until that composition is reviewed, source-port identity
checks provide tamper resistance inside one process but do not establish an
organizational trust boundary.

That pure verifier is necessary but not sufficient for activation. The
reference recovery composition now acquires the durable owner lock and, while
holding it, verifies the same bound target claim, local v2 seal, closed database
bytes, absent-or-empty WAL and SHM, and signed attestation before it
invalidates the prior seal or opens SQLite. It writes a canonical, mode-0600,
file-and-directory-fsync'd v2 Recovery Activation Marker binding the complete
source and target deployment claims, source seal, exact original database
identity, recovery operation, attestation checksum and fixed activation window.
A deployment claim is itself canonical and mode-0600 and binds municipality,
release digest, reviewed control-binding checksum, PVC namespace/name/UID and
PV name. The v2 shutdown seal includes that claim checksum. An ordinary target
startup therefore cannot open a copied restored source volume, and a generic
durable startup cannot bypass a present marker.

The legal recovery transition order is marker, atomic source-to-target claim
rotation, source-seal invalidation, then opening the already-restored SQLite
file in `mode=rw`. Recovery never creates a database or schema: it requires the
exact expected schema and municipal metadata, and requires the current journal
and recovery evidence to dominate the last clean baseline. That baseline is the
source seal embedded in the marker; on an ordinary open it is the seal embedded
in the open-epoch receipt. A retry with a source seal present rehashes the
closed database. The only legal interrupted recovery states are: marker plus
source claim plus source seal (before rotation); marker plus target claim plus
source seal (after rotation); marker plus target claim without local source seal
(after invalidation or while the recovered database is open); and target clean seal plus marker
(clean close before marker cleanup). Each recovery retry still needs newly
consumed, exact, unexpired signed evidence whose fresh verification time is not
earlier than the marker's durable activation time; this monotonic floor survives
a process restart and rejects host-clock rollback. A marker with the source claim but
no local source seal, a marker mixed with bootstrap/open-epoch evidence, or any
claim/seal/configuration mismatch is not an honest crash state and fails
closed. The original marker timestamp and expiry never move.

A recovered runtime may write a target v2 seal only after all three listeners
have reached ready. A freshness failure, bind failure or close before readiness
uses the non-sealing abort path: it releases SQLite and the owner lock while
preserving the marker and target claim, so ordinary startup remains blocked and
a renewed reviewed activation is still required. A later clean runtime shutdown
writes the target seal before fsync-removing the marker. If a crash lands between those operations, startup reconciles only the
exact target claim, target release, municipality and verified closed database;
a supplied recovery authorization is freshly rechecked as well. The runtime
reconsumes the signed sources and clock immediately before *each* listener's
own bind, with admission bound last. If a later check fails, the lifecycle
synchronously closes any already-bound probe or private-outbox listener and
fails startup without sealing the interrupted recovery. This prevents a failed
freshness check from being laundered into ordinary restart authority, but does
not claim zero transient socket exposure while an earlier
listener has bound and a later check is pending. After the fixed expiry, a new
reviewed recovery point is required. The marker is durable restart evidence,
never restart authority by itself.

Exact claim identity deliberately also rejects an ordinary in-place release or
binding change on the same volume. A later, separately reviewed deployment-
claim transition must be specified and proven before routine control upgrades;
this slice does not weaken recovery identity to make upgrades convenient. The
reference composition still cannot authorize a live Deployment: real backup/
restore evidence, immutable images and protected Operations policy are separate
gates.

Gate consumption re-reads a trusted clock and rejects an expired attestation;
the returned operational facts retain the target namespace, PVC name and UID,
PV name, reviewed deployment-binding checksum, shutdown seal, database identity
and fresh verification time. The Adapter compares that complete claim while
holding the lock, and the lifecycle repeats the freshness check immediately
before every bind; neither caches the gate as timeless deployment authority.

### Quiesced, application-consistent backups

Staging accepts a short maintenance window in exchange for a simple and
auditable backup:

1. verify the enter-maintenance revision, shutdown seal, zero replicas, Pod
   termination, volume detachment and absence of a non-empty WAL or SHM file;
2. mount the claim read-only in a one-shot Job whose ServiceAccount token is
   disabled and whose backup credential is available only to that Job;
3. run SQLite integrity verification and create one encrypted backup bundle
   containing the complete closed database **and** the exact canonical bytes of
   `case-shutdown-seal-v2.json` and
   `case-durable-deployment-claim-v1.json`; the Job rejects either receipt
   unless it is a regular mode-0600 file, its verifier succeeds, and the
   seal's deployment-claim checksum equals the source claim checksum;
4. create a canonical manifest containing schema version, source release
   digest, database byte length, SHA-256 checksum, Case count, outbox cursor,
   creation time, retention class, canonical projection schema version,
   projection entry count, a canonical ordered set of `(Case ID, Case version,
   journal-head checksum)`, its aggregate digest, and the digest of every
   Case-ID/discussion-root receipt; include the exact byte length and SHA-256
   checksum of the canonical v2 shutdown-seal and source-deployment-claim
   receipts, plus their verified seal and claim checksums;
5. encrypt the complete bundle as an `age` v1 envelope to one versioned X25519
   recipient whose private identity is unavailable to the backup Job, then
   upload it;
6. pin the exact bucket, bundle object key, returned object version, sizes,
   ciphertext and plaintext checksums, retention deadline, envelope version,
   recipient fingerprint, and the receipt checksums from step 4 into the
   manifest, encrypt that manifest and upload it;
7. write as the last object a signed completion receipt containing only
   civic-content-free metadata at a content-addressed unique key that pins the
   exact bucket, manifest object key and version, manifest ciphertext checksum,
   retention deadline, signing-key version, immutable backup identifier, and
   the source seal and source deployment-claim checksums; and
8. record that receipt's exact key, returned object version and checksum through
   a compare-and-swap update to the protected Operations recovery catalog,
   together with the receipt-pinned source seal and source deployment-claim
   checksums.

The receipt is the object-store commit marker; the recovery catalog is its
external root locator and is outside the backup writer's authority. Restore
starts only from an exact catalog entry and never requires bucket listing. A
database object or manifest without a valid matching receipt and catalog entry
is incomplete and never restorable. The backup signing key is one-purpose
operational authority, not civic authority; its public verification key is
pinned in reviewed Operations policy.

Copying only a live database file, WAL or shared-memory sidecar while the
control process is running is forbidden. A `cp`-style database-only backup or
an archive that omits either canonical receipt is not a recoverable Case
baseline. The read-only Job cannot repair an unsealed WAL; it must fail
instead. A CSI `VolumeSnapshot` may later reduce downtime, but it does not
replace the checksum-validating restore drill and is not assumed to exist in
the current Talos cluster.

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
4. downloads the manifest-pinned encrypted bundle version, verifies its
   ciphertext checksum, decrypts it in memory or on the fresh claim and
   verifies the manifest's plaintext database checksum and the exact canonical
   v2 seal and source-claim receipt bytes; restores both receipt files as
   regular mode-0600 files beside the database and proves that the restored
   seal binds that restored source claim;
5. runs SQLite integrity checks and validates the exact expected schema,
   municipal metadata, Case count and outbox cursor against the seal/manifest;
   it also proves that current recovery evidence dominates the seal baseline;
6. starts a uniquely labelled blue/green control runtime against the fresh
   claim and a separate restored public runtime behind restore-only Services
   and NetworkPolicies; only control mounts the claim, while public remains
   credential-free and volume-free and may reach only the restore control
   outbox. No Röbel or staff workload may reach either restore Service;
7. replays the private outbox into that fresh public projection and compares
   the canonical response bodies—not dynamic HTTP headers—against the manifest
   entry count, ordered per-Case version/journal-head checksums, aggregate
   digest and exact Case-ID/discussion-root receipt digests;
8. derives the **target** durable deployment claim only from the fresh target
   Operations deployment proof. The restored source claim is evidence for the
   signed recovery transition and must not authorize an ordinary target start;
   the lock-held runtime writes the activation marker and atomically rotates it
   to that fresh target claim; then
9. records the measured duration and reviewer attestation; and
10. only then permits a separately reviewed switchover and soak: admission remains
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
- proof that the encrypted bundle, manifest, receipt and catalog pin the exact
  canonical v2 shutdown seal and source deployment claim, and that restore
  recreates those receipts as regular mode-0600 files before recovery begins;
- the compare-and-swap Operations recovery-catalog entry that externally pins
  the receipt key, exact object version and checksum;
- one redacted decrypted manifest proving that every required field is present;
- one isolated successful restore report with checksum, Case/outbox counts,
  byte-identical canonical public receipts, RPO and measured RTO;
- one canonical Recovery Activation Marker receipt from the exact restored
  claim, plus proof that ordinary copied-root startup fails, every legal crash
  state resumes only with fresh exact evidence, impossible state combinations
  fail closed, and an expiry check before each listener bind synchronously rolls
  back any earlier transient listener rather than leaving a recovered runtime
  available;
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
