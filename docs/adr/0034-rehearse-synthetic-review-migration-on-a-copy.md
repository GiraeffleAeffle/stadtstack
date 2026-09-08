# ADR 0034: Rehearse synthetic review migration on a sealed copy

- **Status:** implementation decision for the accepted ADR 0033 roadmap
- **Date:** 2026-09-08
- **Scope:** isolated migration candidate; runtime activation remains separate

## Decision

An admitted synthetic Case must keep its identity, original admission receipt,
root binding and complete journal when department review becomes available.
The immutable store configuration cannot gain actors or a review capability
through an ordinary restart. Retain that rejection.

`prepareSyntheticDepartmentReviewMigration` is an Operations composition seam
beside the SQLite adapter. It accepts one checksum-pinned clean shutdown of one
synthetic Case at admission version 3. The source has the original synthetic
admission configuration, without a department-policy or review pin. The caller
can add department contributors/reviewers and administration/public readers;
existing actor IDs and bindings, admission policy and signer sets cannot change.
The existing eight-department contract still applies.

Preparation reads the source files and validates their seal, claim and absence
of an active epoch/recovery or nonempty SQLite sidecars. It copies the database
to a fresh private temporary directory and performs the original adapter's full
validation there. One transaction updates only the municipality configuration
fingerprint and Case options fingerprint. Shared constructor helpers calculate
these pins, avoiding a second implementation of configuration semantics.

The candidate must reopen with the target configuration and replay its original
Case. Every stored civic field, retry record, root claim, receipt, outbox entry
and sequence is compared before and after; only those two fingerprint fields
are excluded. The source is checked again before the candidate is returned.
Failure removes only the freshly generated candidate directory. Success returns
its path and a private receipt pinning the source seal, source/target database
hashes, configurations and preservation proof. Candidate files are mode 0600 in
a mode 0700 directory. The caller owns retention or removal after review.

## Activation boundary

The candidate has no shutdown seal, deployment claim or activation token. The
preparation function is not a runtime route and is not called on normal startup.
A hash is integrity evidence, not authorization. Existing Operations recovery
and deployment checks remain unchanged and cannot treat this receipt as an
approved image/configuration transition.

The next integration must connect candidate activation to an exact reviewed
source/target deployment and preserve the original sealed snapshot for recovery.
It must compose the review service with the same single writer and server-owned
role bindings. Town Workspace authentication, genuine review timestamps, the
explicit citizen-brief release and separately typed synthetic public/Mecky
delivery remain work. A fixture review timestamp is not evidence of a real
person reviewing a live Case.

## Evidence

The test begins with a sealed admission-only database, creates the candidate,
assigns a package, records a draft and independently reviews it using the
existing continuation facade. Reopen and exact retries preserve the result and
the original admission receipt. Source files remain byte-identical throughout
preparation and candidate use. Drifted source pins/data, an active or unsealed
source, nonempty sidecars, actor replacement, new admission/council roles and a
missing reviewer are rejected. Full existing adapter and runtime tests remain
required because the fingerprint and coordinator construction helpers are shared.
