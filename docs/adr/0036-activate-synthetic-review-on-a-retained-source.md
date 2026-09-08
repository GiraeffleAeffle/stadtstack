# ADR 0036: Activate synthetic review from a retained source

- **Status:** implementation decision for the accepted ADR 0033 roadmap
- **Date:** 2026-09-08
- **Scope:** explicit offline staging activation; Operations deployment pending

## Decision

`activateOperationsBoundSyntheticReviewMigration` imports the existing synthetic
admission into a separately reviewed review-capable deployment. It performs no
HTTP bind, credential issuance, civic command or traffic switch. The ordinary
runtime still rejects configuration drift and cannot adopt a candidate receipt.
The backup recovery Interface and signed recovery attestation remain unchanged.

Operations supplies the target version-2 deployment binding, its independent
checksum pin and the existing storage observation port. Preflight must prove
the target mount and fourth review listener before the importer can create a
deployment claim capability. A separate migration plan and independent pin bind
one synthetic Case, the original and target deployment claim checksums, and the
exact ADR 0034 candidate checksum. That candidate commits the source seal,
source/target configurations and databases, original admission and complete
preservation proof. The plan has a canonical UTC validity interval of at most
24 hours. Its pin is an Operations-owned trust input, never a browser argument
or a checksum supplied alongside an otherwise untrusted document.

The importer acquires the existing SQLite owner locks on the retained source
and target. It requires separate, non-nested directories, different PVC UIDs
and PV names, and a completely sealed admission-only source. It reproduces the
candidate through the original migration Implementation, compares the exact
reviewed checksum, checks integrity and recovery evidence, and checkpoints and
closes the candidate. It never opens municipal SQLite on the source. The source
database, claim, shutdown seal, receipt, outbox and journal remain unchanged.

The only permitted target transition is:

1. Persist and fsync a canonical migration intent linking the plan, candidate,
   original claim/seal, target claim and start time.
2. Copy the validated candidate to a private staging file, fsync it, compare its
   bytes and atomically rename it into the empty target database path.
3. Persist the exact preflight-derived target deployment claim.
4. Seal those verified, checkpointed, closed database bytes under the held
   target owner, using the target configuration and release. This is an offline
   import seal produced by the owning Implementation, not a caller-created seal
   used to persuade normal startup to accept an unverified candidate.
5. Persist the linked activation receipt, then remove the intent and fsync the
   directory before releasing either owner.

Operations evidence and the clock are read again before writes. A changed pin,
changed document, expired interval or backward clock fails without completing
the import. The persisted start time also prevents a new process from using an
earlier clock. Errors omit paths, actor configuration and stored payloads.

## Interruption and deployment

Ordinary startup rejects any outstanding migration intent, including the
interval after a target seal has been written. Only the exact reviewed import
may resume. Existing imported bytes, claims and receipts must match; the
importer never replaces a changed municipal database. A partially copied
private staging file can be rebuilt only while its exact intent exists.
An already completed import returns the same receipt while its target remains
the same closed store. Once the runtime progresses or reseals that store, the
retired import cannot overwrite it. Completed activation provenance remains
stored beside the target database; it grants no runtime role or new authority.

After an expired plan, retain the interrupted target for inspection. A newly
reviewed attempt uses a fresh target and the original sealed snapshot; changing
the old intent or extending its plan in place is not a recovery mechanism.

Operations must quiesce and keep the source workload stopped, retain its sealed
snapshot and existing encrypted backup, provision and pin the separate target
volume, review the reproduced candidate, invoke this offline operation, verify
the receipt, then start the ordinary version-2 runtime and check its original
admission/outbox before switching traffic. Process-local owner locks do not
replace workload fencing between two volumes. Routing, protection changes,
storage provisioning and real role grants are outside this source operation.
The existing container entrypoint does not automatically run a migration;
Operations still needs a bounded activation invocation and rollout contract.

## Evidence and remaining flow

Acceptance starts with a claimed, sealed admission-only Case. The Operations
composition activates it, the ordinary runtime serves assignment, draft and
independent review over its private HTTP listener, and shutdown/restart plus
exact retries preserve Case version 6 and the original admission. Source bytes
remain identical. Tests cover all five durable interruption points, SIGKILL,
changed Operations evidence, invalid pins/candidates/capabilities, occupied or
changed target databases, and refusal to rewind a progressed Case.

This source change does not deploy the review runtime or complete roadmap step
7. The Town Workspace gateway, existing test-account role mapping, relevant
department work, steward brief release and separately typed synthetic public
context for the Citizen App and Mecky remain the connected delivery sequence.
