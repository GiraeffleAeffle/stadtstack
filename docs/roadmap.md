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
7. prove replay, correction, explicit withdrawal from future eligibility, and
   reference-surface evidence locally without claiming erasure of independent
   originals or permanent public copies.

## End-to-end status on 2026-08-25

The architecture covers the intended Civic Journey, but the complete real-user
staging journey has **not** been accepted end to end yet. “Implemented” below
means that a contract, reference module, synthetic tracer or UI exists; it does
not mean that a Röbel resident has successfully completed the whole line in the
deployed staging environment.

| Journey segment | Evidence today | Remaining acceptance gate |
| --- | --- | --- |
| Thirdweb sign-in → signed normal post | Thirdweb-backed web path and Nostr provenance exist | One real staging person signs in, publishes, reloads, and sees the same post |
| Post → Discussion → pro/contra tree and sunburst | Discussion UI and synthetic graph examples exist | Promote a real signed post and prove both views and replies in the browser |
| Explicit `@Mecky` question → cited answer | Public Mecky boundary and answer presentation exist | Live retrieval over admitted Röbel/RIS/news records with visible citations, freshness and failure behavior |
| Resident adopts/signs a suggestion | Topic suggestion and citizen-signature contracts exist | One real signed suggestion remains bound to the exact Discussion and Mecky answer |
| Human Case admission → one Civic Case | Coordinator, Case journal and public binding receipt exist | Authorized staging steward admits the real candidate without exposing its credential to Röbel |
| Department package → openDesk return → Citizen Brief | Provider-neutral request/return and review contracts plus synthetic tracers exist | One idempotent staging connector round trip and independent review produce the same browser-visible Case version |
| Citizen Brief → advisory Mitmachen | Advisory projection exists | The real returned brief appears in the same Journey and records one effect-free advisory result |
| Municipal publication → RIS/OParl-compatible return | ADR 0030 now defines candidate, receipt and two-view public exchange | Name a municipal publication owner/target and prove the closed-loop publication tracer |
| Kair session → reviewed context artifact | ADR 0025 and the exchange contract define the boundary | Receive the code, confirm the licence, install one owned device, freeze the actual bundle contract and run one consented test |
| Verified Citizen credential | Thirdweb is the current staging baseline; provider-neutral bridge is designed | Real passkey enrolment/recovery plus Safe/Pimlico and membership binding are not implemented or accepted |
| Formal private ballot | Strausberg-labelled contract/proof substrate and operational plans exist | A Röbel-specific ownership decision, credential bridge, fresh deployment/verifier proof and isolated ballot exercise |
| Treasury execution | Synthetic/read-only budget context only | City-owned Safe policy, signers, legal effect, spending limits and an explicitly authorized execution path; no live funds are in scope now |

The shortest honest staging acceptance path is therefore:

```text
A. Thirdweb sign-in -> normal signed post -> Discussion -> pro/contra tree/sunburst
B. cited Public Mecky answer -> resident-edited and signed suggestion
C. Human Case admission -> synthetic openDesk return -> Reviewed citizen brief
   -> advisory Mitmachen result, all on one Topic/Case/Journey identity
D. exact RIS source + Kair device/session -> reviewed artifact -> publication
   candidate -> municipal receipt -> updated feed/MCP/Röbel context
E. provider-neutral Citizen credential -> separate formal ballot -> separate
   treasury eligibility/execution decisions
```

Steps A–C do not need a new formal-voting smart-contract deployment. They use
the current Thirdweb/Nostr identity baseline and effect-free staging authority.
Passkey, Safe and Pimlico work belongs to the provider-neutral Citizen
credential bridge before Step E; it is not already a completed Röbel login or
a prerequisite for proving the first Civic Journey. Formal ballot and treasury
remain separate authority lanes rather than hidden side effects of a proposal.

The next accepted product seam keeps ordinary Röbel posts and discussions
Topic-bound until a resident signs one exact suggestion candidate. An
explicitly authorized human Case Steward under municipality policy then uses
one idempotent admission command to create the Case and preserve that Topic
provenance before any department or openDesk round trip begins. The production
identity and authorization mechanism remains an implementation gate.

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

Kair is a proposed contextual-enrichment connection, not merely a third source
Adapter and not a shortcut through the Civic Journey. Charlie Fisher / Komma
Systems brings the session/runtime layer; the current shared direction is to
obtain code access and install it on commodity hardware controlled by the team.
That deployment model remains a hypothesis until repository, licence and device
evidence exists. The integration maps exact council records into shared
context, grounds a consented session in that context, and makes one reviewed
public-safe derivative discoverable across clients. Its first proof remains
contract-only: one exact
synthetic council-context fixture and one consent-scoped Kair session bundle
enter a local `pending_review` path; one human reviewer derives a public-safe
deliberation artifact; correction or withdrawal removes that artifact from the
next prepared Public knowledge projection. Raw audio, transcripts, private
speaker mappings and model working state never enter the public Module.

Subject to municipality approval and source-specific rights, an exact
Strausberg RIS capture is the intended first real interoperability-validation
target after the fixtures pass. The proposed canonical replay surface remains
a versioned cursor-based change feed. MCP may expose eligibility-gated,
read-only bodies, meetings, agenda items, papers, consultations, files,
published result fields, reviewed artifacts, and change cursors over the same
reviewed bytes; subscriptions remain jointly deferred. Nostr may mirror
separately signed public-safe records. No transport gains source review, Case,
publication, voting or treasury authority.

The return path is governed by ADR 0030. A reviewed Kair artifact or openDesk
response may prepare a Municipal publication candidate, but only an accountable
municipal publication receipt creates an Official municipal publication. The
strict OParl-compatible projection contains only official parliamentary objects
that fit OParl semantics. The broader Municipal Civic Context Exchange keeps
Discussions, Reviewed sources, Citizen Briefs, Case projections and status
records linked without turning them into custom OParl objects. A new Civic
change event then closes the loop back to Röbel, Mecky and other clients.

Next implementation slices are listed in dependency order within their path.
The interoperability preparation in items 11–12 may progress in parallel with
the Röbel staging path once the shared source, consent, and review contracts are
accepted; neither path is proof that the other works:

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
   Adapter and prove correction withdrawal through the Röbel consumer;
10. add correction and withdrawal UX before any formal governance or treasury
   integration;
11. freeze exact synthetic council-context and Kair session-bundle fixtures and
    prove context binding, consent purposes, public-safe extraction, human
    review, correction, withdrawal, and `caseCitation` isolation locally before
    adding a Kair network connection; obtain the Kair repository and licence,
    install one owned test device, prove update/rollback/recovery and freeze the
    actual versioned bundle interface; and, only after municipality and rights
    approval, repeat the source-capture proof against the intended real
    Strausberg RIS target; then
12. expose one correction-aware Civic change feed over the already-reviewed
    projection, then add the bounded municipal MCP resources and one Röbel
    consumer over the same version and digest rather than treating MCP as an
    ungoverned resident-facing fan-out transport; then
13. implement ADR 0030's Municipal publication candidate and receipt, use one
    synthetic openDesk return to create an explicitly authorized publication,
    validate its strict OParl-compatible mapping, and observe the resulting
    correction-aware change through REST, MCP and Röbel; then
14. prove a provider-neutral Citizen credential bridge over the complete
    Thirdweb-backed signed-Nostr tracer, including passkey-signed commitment
    enrolment, replay, recovery, rotation, revocation and post-Anchor
    non-transfer; and
15. decide explicitly whether the Strausberg-labelled Gnosis pilot may host a
    Röbel exercise, then prepare one fresh namespaced formal cryptographic
    ballot with advisory legal effect, frozen eligibility and isolated
    off-chain stores while keeping treasury execution absent.

For the first accepted staging journey, deployment and browser proof take
precedence on the Röbel product path. That priority does not block the separate
interoperability track's document review or synthetic fixture preparation, but
it does block presenting that preparation as a live Röbel capability.
Provider-neutral passkey/Safe coexistence follows the complete Thirdweb-backed
tracer; it is not a hidden signup prerequisite. No duplicate eligibility or
voting suite is deployed before the credential bridge, real deployed-verifier
proof, and compatibility/ownership decision in ADR 0029.

Formal city authority, live operations, second-city federation, and public
relay publication require new owners, ADRs, and exact external-effects gates.
