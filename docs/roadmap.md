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
outbox Adapter. It still has no HTTP listener, staff identity adapter,
production storage decision, replay service, backup/restore proof, or
deployment resources. Staff control and public read are separate interfaces
and must become separate identities and network surfaces.

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

Next implementation slices are:

1. review and merge the authenticated durable continuation reference that
   composes administration, Citizen Brief, Mitmachen, and outcome over the
   same reopened Case and proves close/reopen checksum continuity;
2. compose the Case Steward and continuation handlers with a staff identity adapter,
   durable coordinator factory and replayable public binding index, then deploy
   the staff and GET-only public routes behind separate ingress policies;
3. let Röbel discover the Case binding receipt by its signed discussion root
   and advance the public journey without receiving an admission credential;
4. expose the prepared request and handoff state in the Röbel administration
   journey without creating a second Case timeline;
5. implement one exact, idempotent openDesk connector behind the public
   contract, with credentials and endpoint policy kept in private operations;
6. expose the resulting current Citizen Brief through the same Röbel journey
   and public knowledge checksum consumed by Mecky and Mitmachen; and
7. deploy one synthetic reviewed-source projection behind the reviewed public
   Adapter and prove correction withdrawal through the Röbel consumer; and
8. add correction and withdrawal UX before any formal governance or treasury
   integration.

For the first accepted staging journey, deployment and browser proof now take
precedence over adding another contract slice. Provider-neutral passkey/Safe
coexistence follows the complete Thirdweb-backed tracer; it is not a hidden
signup prerequisite.

Formal city authority, live operations, second-city federation, and public
relay publication require new owners, ADRs, and exact external-effects gates.
