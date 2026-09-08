# ADR 0035: Bind administration review to the existing Case runtime

- **Status:** implementation decision for the accepted ADR 0033 roadmap
- **Date:** 2026-09-08
- **Scope:** source composition and deployment contract; live activation pending

## Decision

Compose the administration review service with the existing SQLite owner in
`StagingCaseControlRuntime`. The runtime gains an optional `administrationReview`
configuration naming one already admitted synthetic Case, allowed hosts and
server-owned expiring grants. It enables the existing synthetic review pin and
derives role mappings from the pinned actor registry: one Case Steward, one
administration reader, one public reader and one contributor/reviewer per
required department. Ambiguous or incomplete mappings fail before storage opens.
The synthetic continuation no longer needs an unused participation reviewer.
Municipal continuation still requires its existing participation role.

Admission credentials and review grants must differ. A review grant must match
the configured Case and a registered actor. It cannot select another city or
role, and it does not authorize the admission listener. The public outbox remains
credential-free and cannot serve review requests. Credential possession remains
staging attribution, not proof of employment or a human identity.

Review has its own listener, sharing the existing process lifecycle and durable
owner. A version-2 reviewed control deployment binding pins exactly four
listeners: admission on 18085, private outbox on 18087, probe on 18088 and
administration review on 18090. The application and binding must both include
review or both omit it. Version 1 retains exactly its original three listeners.
The independently checked binding checksum, storage preflight, opaque listener
capabilities and deployment claim remain mandatory for Pod-network binding.
Loopback composition uses an explicitly supplied fourth loopback listener.

Every listener must become ready before the runtime reports ready. Failure of
the review bind drains the already-started siblings before releasing the writer.
Normal shutdown seals the same database; restart reconstructs review from the
same journal. There is no second writer, review database or public write path.
The control image's exact source closure includes the review implementation and
its continuation dependencies. The public image retains its separate closure.

## Review time

The enabled synthetic review lane accepts a calendar-valid canonical UTC
`reviewedAt`, including milliseconds. The reviewer supplies this time and the
server preserves it as declared metadata; it is not a trusted server-clock
attestation. A workspace should submit the time of the review and retain the
exact command on retry. Replacing it with a new current time would change the
attestation and lose exact idempotency. Invalid calendar dates and alternate
encodings fail. Replay enforces the same rule. Other reference lanes and their
deterministic fixtures keep their existing timestamp contract.

## Remaining activation and workspace work

This change does not activate the ADR 0034 migration candidate. That candidate
has no deployment claim or shutdown seal, and the existing recovery Interface
still requires an unchanged configuration fingerprint. Operations must prepare
an explicit transition binding the original sealed state, candidate preservation
proof, target image/configuration and storage claim, with interruption recovery.
Existing deployment bindings cannot silently gain the new listener.

Town Workspace connects through an authenticated server gateway to this internal
review listener. Browser cookies and Origin remain rejected on the internal
transport. Reusing the test account requires server-owned role mappings and
grants at that gateway. City OIDC/EUDI, browser login, a public brief return and
Mecky delivery are not supplied by the runtime composition.

## Evidence

Acceptance covers sealed-copy migration followed by real HTTP assignment, draft,
review using a non-fixture date, clean seal, restart and exact retries. It checks
cross-listener token isolation, department filtering, original receipt/outbox
preservation, and sibling shutdown after the fourth bind fails. A separate
fresh bound fixture exercises the version-2 Operations composition on its pinned
ports. Version mismatch and mutable/forged listener facts fail. No live city
database or credential is used by these tests.
