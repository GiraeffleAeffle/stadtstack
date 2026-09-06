# ADR 0032: Isolate synthetic Case admission

- **Status:** accepted; isolated admission and delivery implemented; staging activation pending
- **Date:** 2026-09-06

The staging test Citizen Pass proves neither residence nor municipal civic
eligibility. Its saved adoption can nevertheless support a staff rehearsal.
We choose an explicitly configured synthetic admission mode in the existing
Case coordinator and atomic SQLite writer. It has its own evidence validator,
`urn:stadtstack:synthetic-case:municipality:` identity namespace, admission event
and public receipt schema. It cannot share a store with municipal admission.
The municipal identity parser and eligibility validator remain strict; legacy
`urn:stadtstack:case:test:` records are not revived or migrated.

The synthetic verifier checks the complete signed discussion, cited answer,
participant suggestion and test challenge proof, and reads the exact adoption
from a deployment-pinned HTTPS ledger. Acceptance must have happened inside
the original challenge window; a later staff rehearsal does not require a new
challenge. The public acceptance checksum alone is not a trusted ledger read.
Private wallet/session material remains with Röbel. The original preview
projection is immutable; only a separate post-admission receipt reports that
a synthetic Case was created. Every synthetic receipt remains staging-only,
test-only and without civic authority, endorsement, vote, decision or payment.

The tradeoff is explicit protocol branching at admission, replay and public
delivery. Reusing the existing transaction avoids a second journal or outbox.
Downstream municipal work and authority transitions must continue to reject
synthetic identities until a separately scoped rehearsal is implemented.


The staff HTTP body is the closed
`roebel_case_steward_synthetic_adoption_request_v1` with only `schemaVersion`
and `bundle`. That bundle uses `synthetic_citizen_adoption_case_input_v1` and
contains `sourceDiscussion`, `sourceAnswer`, `participantSuggestionEvent` and
`proofEvent`, all complete signed NIP-01 events. Callers cannot supply an
acceptance projection, Case identity, staff role or verification assertion.
Authentication precedes body inspection. The writer's configured reader resolves
only the pinned suggestion/adopter path, with no credentials or redirects and a
16 KiB response bound inside a 10-second verification budget. A different proof
for that pair is rejected. The ledger's checksum of the original private request
is preserved as an opaque binding; it is not independently reconstructed.

`syntheticAdoption` runtime JSON contains only `policy` and `acceptanceBaseUrl`.
Policy pins the municipality, test policy version, allowed public Mecky keys,
test contract, 300-second challenge window, allowed event clock skew and exact
staging/test-only flags. It is mutually exclusive with `citizenAdoption` in the
loopback, reviewed Operations and recovery compositions. For Röbel, the base
path ends in `/api/staging-participant/v1/synthetic-citizen-adoption/by-suggestion`;
the reader appends only `<suggestion-id>/adopter/<adopter-pubkey>`.

The existing SQLite transaction records creation, the original discussion and
`synthetic_adoption_admitted_v1` together with the root claim, idempotency result
and public outbox. The Case UUID-v7 derives from the signed test proof. An exact
bundle/actor retry returns the original receipt, including after offline restart;
changed actors, proofs or bundles conflict. Both database and coordinator
fingerprints pin the synthetic policy. Replay rechecks the complete stored
protocol. No new SQLite tables, second journal or package dependency are needed.
Shutdown/recovery checks recognize the separate namespace and a seal cannot mix
synthetic and municipal identities.

The public `public_synthetic_case_binding_receipt_v1` binds the test tracer,
proof, participant suggestion, original discussion, cited answer, acceptance
checksum and test policy to the three journal events. It has exact
`environment: staging`, `testOnly: true`, `syntheticCaseCreated: true` and
`civicCaseCreated: false` fields, plus the existing false civic-effect flags.
It carries no eligibility receipt or issuer claim. The existing credential-free
outbox and public GET routes deliver this distinct schema. The municipal parser,
real adoption HTTP mode and civic continuation reject it. The synthetic
coordinator currently rejects every command after admission; extending the
rehearsal into department work remains separate work.

Offline tests use a new fixture generated through Röbel's public signing and
synthetic adoption APIs. They exercise source signatures, historical challenge
acceptance, altered ledger data, bounded reads, staff isolation, atomic rollback,
concurrent retries, durable seals, restart and HTTP delivery. No Röbel
implementation or private/live operational record is included in the neutral
repository. Activation still requires the reviewed staging workload/storage and
staff credential bindings, the pinned ledger endpoint, and Röbel's separately
typed browser receipt handling. A source merge does not create a live Case.
