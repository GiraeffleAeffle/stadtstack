# Public implementation roadmap

The current cross-repository Röbel execution truth is the dated
[2026-08-23 staging snapshot](verification/2026-08-23-roebel-staging.md). It
maps these neutral contracts to the Röbel product and reviewed GitOps source
without moving product UX, credentials, or deployment authority into
Stadtstack. The sole open public tracker item is
[issue #25](https://github.com/GiraeffleAeffle/stadtstack/issues/25).

This clean public lineage starts with the smallest reviewable vertical slices:

1. establish the public boundary and CI;
2. replace the current in-memory lifecycle with the two-operation
   `CivicCaseCoordinator` over an append-only journal;
3. add one department review and a redacted citizen brief;
4. add advisory participation and a read-only council rehearsal;
5. exercise three role-scoped companion contexts;
6. round-trip one reviewed public exchange record through a local Nostr
   Adapter; and
7. prove replay, correction, deletion, and reference-surface evidence locally.

The next accepted product seam keeps ordinary Röbel posts and discussions
Topic-bound until a resident signs a proposal. A registered human steward then
uses one idempotent admission command to create the Case and preserve that
Topic provenance before any department or openDesk round trip begins.

The accepted control seam now keeps that command behind a separately
authenticated Case Steward interface. The public application may only read a
checksum-bound Case binding receipt by Case or source-discussion identity. The
coordinator journal remains the durable source of truth; the public receipt is
a rebuildable projection and performs no openDesk write or authority
transition. The reference implementation now includes a local-only SQLite
WAL/FULL atomic root claim, Case journal, binding receipt, and append-only
outbox Adapter. Separate unbound reference servers now enforce a bounded
staff-only POST surface and credential-free public GET/HEAD surface, while a
bounded projector atomically rebuilds the public index from the outbox. It
now selects a staging-only, per-steward Case Steward token Adapter and a private
credential-free HTTP outbox pull between separate control and public
workloads. The control and public processes now have separate bounded lifecycle
composition roots, and durable control state has a root-global live owner lock,
quiesced shutdown seal and canonical recovery evidence. The current slice adds
a reviewed Operations preflight Module: a local filesystem Adapter must match
the checksum-pinned PVC/PV/StorageClass contract before SQLite or one of the
three exact control Pod-network listeners can exist. Raw hosts, ports and paths
are not application inputs, while the reference factories remain loopback-only.
A pure recovery-attestation verifier now checks the separately pinned policy,
catalog CAS locator, local shutdown seal, signed restore statement, exact fresh
PVC identity, four-hour RTO and closure-derived 24-hour expiry without gaining
filesystem, bucket, Kubernetes, signing or civic capability. The reference
control composition now consumes that gate only while holding the durable
single-writer lock. It revalidates the local seal, closed database bytes and
empty sidecars, binds the exact reviewed PVC/PV and deployment checksum, writes
one canonical fsync'd v2 Recovery Activation Marker, atomically rotates the
source deployment claim to the exact target claim, and only then invalidates
the old seal and opens SQLite. The marker carries the complete source claim,
target claim and source seal, so an interrupted activated process can restart
only after renewed signed-gate verification at or after the marker's durable
activation time; a marker alone grants nothing and a process-local clock reset
cannot move that floor backwards.
The v2 shutdown seal binds the active deployment claim. A canonical fsync'd
bootstrap receipt permits the one empty-store initialization, while an ordinary
open-epoch receipt records its last clean seal; a recovery marker supplies its
own source-seal baseline. Existing durable databases open only read/write with
the exact schema and must dominate that baseline. Signed evidence is rechecked
immediately before each listener's own bind, with admission last. A later
failed check synchronously rolls back already-bound probe/outbox listeners and
uses a recovery-specific non-sealing abort, so the marker survives and ordinary
startup remains blocked. A target clean seal is allowed only after the complete
listener set reached ready. This does not claim there was zero transient socket exposure. Exact claim matching
currently blocks ordinary in-place release changes until a separate reviewed
claim-transition slice exists. The real encrypted backup/restore drill, immutable
workloads and Flux binding do not exist yet. Staff control and public read
remain separate identities and network surfaces; Röbel Web and Mecky receive
neither the staff credential nor SQLite access.

The next accepted administration seam renders one exact Department package as
an effect-free, idempotent workspace request. A separately authorized
openDesk, OpenProject, or municipal-workspace connector may return an
acknowledgement and response bound to that request. Stadtstack accepts the
return only as a private Department draft; the existing independent reviewer
attestation remains the sole path to Citizen Brief eligibility.

The accepted Citizen Brief readiness seam now projects those independent
reviews into explicit Case-bound blockers or one effect-free steward command.
Only the coordinator can apply that command and derive the brief used by the
shared public knowledge projection.

The accepted reviewed-source seam now prepares separate local-news and
Ratsinformationssystem projections from exact human attestations. A loopback
reference transport revalidates and serves the exact checksum-bound bytes on
the two Röbel GET routes. It does not crawl or deploy a public endpoint.

Meld/Kair is a proposed third source Adapter, not a shortcut through the civic
journey. Its first slice is contract-only: one synthetic, consent-scoped Kair
session bundle enters a local `pending_review` inbox, one human reviewer derives
a public-safe deliberation artifact, and correction or withdrawal removes that
artifact from the next prepared Public knowledge projection. Raw audio,
transcripts, private speaker mappings and model working state never enter the
public Module. The initial interchange remains a versioned cursor-based change
feed; MCP may expose bounded read resources and tools over the same reviewed
bytes, while Nostr may mirror separately signed public-safe records. Neither
protocol gains source review, Case, publication, voting or treasury authority.

Next implementation slices are:

1. merge the green stacked Case boundary, continuation, transport, runtime,
   recovery-gate, durable-seal, deployment-preflight and recovery-activation
   slices in dependency order;
2. merge their matching still-inert Operations evidence inventories without
   reconciling a workload;
3. prove a quiesced, encrypted backup can restore byte-identically to the exact
   fresh claim under ADR 0023 and produce the signed activation inputs before
   any control activation;
4. admit immutable control/public/backup/verifier images and the protected policy migration,
   then let Flux reconcile only the reviewed resources;
5. let Röbel discover the Case binding receipt by its signed discussion root
   and advance the public journey without receiving an admission credential;
6. expose the prepared request and handoff state in the Röbel administration
   journey without creating a second Case timeline;
7. implement one exact, idempotent openDesk connector behind the public
   contract, with credentials and endpoint policy kept in private operations;
8. expose the resulting current Citizen Brief through the same Röbel journey
   and public knowledge checksum consumed by Mecky and Mitmachen; and
9. deploy one synthetic reviewed-source projection behind the reviewed public
   Adapter and prove correction withdrawal through the Röbel consumer; and
10. add correction and withdrawal UX before any formal governance or treasury
   integration; then
11. freeze a synthetic Kair session-bundle fixture and prove consent,
    public-safe extraction, human review, correction and withdrawal locally
    before adding a Meld/Kair network Adapter; and
12. expose one correction-aware Civic change feed over the already-reviewed
    projection, then add MCP as a read-only agent Adapter rather than a
    resident-facing fan-out transport; then
13. prove a provider-neutral Citizen credential bridge over the complete
    Thirdweb-backed signed-Nostr tracer, including passkey-signed commitment
    enrolment, replay, recovery, rotation, revocation and post-Anchor
    non-transfer; and
14. decide explicitly whether the Strausberg-labelled Gnosis pilot may host a
    Röbel exercise, then prepare one fresh namespaced formal cryptographic
    ballot with advisory legal effect, frozen eligibility and isolated
    off-chain stores while keeping treasury execution absent.

For the first accepted staging journey, deployment and browser proof now take
precedence over adding another contract slice. Provider-neutral passkey/Safe
coexistence follows the complete Thirdweb-backed tracer; it is not a hidden
signup prerequisite. No duplicate eligibility or voting suite is deployed
before the credential bridge, real deployed-verifier proof, and
compatibility/ownership decision in ADR 0029.

Formal city authority, live operations, second-city federation, and public
relay publication require new owners, ADRs, and exact external-effects gates.
