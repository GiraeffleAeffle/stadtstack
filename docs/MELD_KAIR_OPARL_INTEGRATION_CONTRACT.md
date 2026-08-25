# Municipal Civic Context Exchange — Kair, Röbel and Stadtstack working profile

- **Status:** shared working contract; interfaces pending implementation evidence
- **Date:** 2026-08-25
- **Scope:** the municipality-neutral exchange boundary between Kair, Röbel App,
  Stadtstack, OParl/RIS adapters, openDesk work, and municipal publication

> This document combines the first three-contributor brief with the current
> Röbel/Stadtstack Civic Journey. It is a concrete basis for the next working
> session, not a claim that Kair code access, device operation, municipal
> participation, publication rights, funding, or delivery dates are already
> confirmed.

## Three contributors and three parts

| Contributor | Project | Working contribution |
| --- | --- | --- |
| Charlie Fisher | Komma Systems / Kair | Conversation-session software, contextual bundles, and a locally operated runtime that the team intends to test on self-owned hardware |
| Max Brych | Röbel App | Resident-facing posts, signed discussions, pro/contra views, proposals, and the visible Civic Journey |
| Maximilian Stahl | Stadtstack | Municipal-source adapters, shared Civic Case contracts, administration/openDesk exchange, public context interfaces, identity, voting and authority boundaries |

Each contributor keeps control of their own implementation. A participating
municipality remains the owner of its official records, publication policy,
administrative decisions and institutional effects.

## Shared civic-context loop

The shared goal is a **bidirectional civic learning loop**:

```text
official municipal publication / RIS / OParl / permitted public sources
  -> exact source capture and common municipal-context mapping
  -> consented Kair session references that exact context
  -> reviewed deliberation artifact enters the shared change feed and MCP view
  -> a municipality-specific resident interface can discuss, compare pro/contra and develop a signed proposal
  -> an authorized human admits a Civic Case
  -> administration works through an openDesk-compatible Department package
  -> reviewed administration return becomes a municipal publication candidate
  -> a municipality-operated Kair/openDesk/RIS/Stadtstack publication endpoint accepts the exact candidate under named municipal policy and accountable delegation
  -> official publication returns through RIS/OParl-compatible context and feed
```

Municipal records can ground a facilitated conversation; the resulting
structured deliberation can enrich a shared context; a resident proposal can
enter accountable administration work; and an explicitly published outcome can
improve the public context for the next community. The return path is as
important as the ingestion path.

| Shared direction | Contract form | Status |
| --- | --- | --- |
| Normalize heterogeneous municipal records into common context | Preserve exact source, record kind, mapping evidence, publication state, and correction lineage around a Municipal context snapshot | Shared goal; exact source examples still to freeze |
| Ground Kair sessions in municipal context | Reference exact source versions inside a consent-scoped private bundle, then separately review any public derivative | Shared goal; actual Kair interface awaits code access |
| Provide an RSS-like, cross-client update stream | Use one replayable change feed with MCP over the same public projection | Shared goal; prototype contract proposed |
| Let a municipal resident interface surface deliberation and resident signals | Link reviewed artifacts into that interface's Civic Journey without automatic Case admission or voting authority | Shared goal; Röbel is the current tracer, while other interfaces remain possible |
| Return administration results to public context | Prepare a municipal publication candidate, require a policy-bound municipal publication receipt, then publish the official result through the appropriate RIS/OParl-compatible view | Added closed-loop requirement; municipal authority, endpoint and target mapping to confirm |
| Prototype in two months, targeting end of October | Retain the original three phases, then re-baseline once Kair repository access, test hardware, participants and source scope are confirmed | Original scoping target; not a current commitment |

Three related tracks therefore remain distinct:

- the **Röbel staging product slice** proves the resident-facing Topic, Mecky,
  Case, administration, Citizen Brief, and advisory Mitmachen journey;
- the **municipality-neutral exchange protocol** proves source mapping,
  contextual bundles, correction-aware change-feed replay, MCP consumption and
  an authorized municipal-publication return; and
- the **Kair device/runtime trial** confirms code access, licence, self-operated
  hardware, consent behavior and the actual versioned session-bundle interface.

They may progress in parallel and share public contracts, but one is not proof
that the others work. Röbel is the current product tracer, not the canonical
municipality or mandatory interface for the protocol. A selected participating
municipality supplies the first authorized source and publication tracer after
synthetic fixtures pass. Candidate Kair trial contexts supplied for review,
both pending participation, rights and
publication-authority confirmation, are Herzogtum Lauenburg
(Schleswig-Holstein; lead client NextLearning e.V., local partner Landvorteil
e.V., and WFL) and Ludwigslust-Parchim (Mecklenburg-Vorpommern; South West
Mecklenburg Economic Development Agency). Röbel may later consume the same
contract or use Kair in local meetings if separately agreed; Strausberg remains
a separate existing project context. Neither Röbel nor Strausberg is a protocol
default or substitute for a participating municipality's approval. Every client consumes the same
reviewed public contract rather than receiving a private or source-system
shortcut.

The protocol mandates no frontend. Each municipality or integrator may provide
its own resident app, staff workspace, public portal and visual language while
preserving the same versioned identifiers, authority states, corrections and
receipts. Röbel is one concrete client profile, not a UI that every municipality
must adopt.

## Product rule

There is one **Civic Journey**, not one combined database and not a collection
of mini-app timelines:

```text
ordinary Röbel conversation
  -> Topic / signed Discussion
  -> optional structured discussion and cited Public Mecky answer
  -> citizen-signed suggestion candidate
  -> Human Case admission
  -> Civic case and Department packages
  -> openDesk work request / response / independent review
  -> Reviewed citizen brief
  -> advisory participation in Mitmachen
  -> separately authorized Authority transition, if any
  -> reviewed public outcome and effect evidence
```

The Röbel journey, Stadtstack projections and Stage Tools preserve the same
canonical Case and Topic references together with each artifact's bound
version and checksum. A Mini App may render or collect one bounded part of
this line; it does not own a Case, a brief, participation, treasury state, or
an execution timeline.

## Three independent inbound seams

The three input types are deliberately independent. None is allowed to masquerade
as another source, and none creates a Civic case by itself.

| Inbound seam | What enters | Proposed responsibility and gate | What it is not |
| --- | --- | --- | --- |
| Röbel conversation | A signed public contribution, Topic, discussion graph, or citizen-signed suggestion candidate | Röbel preserves the Nostr provenance; a **Human Case admission** independently verifies the exact candidate before a Case event | A formal proposal, official record, or administration request |
| Reviewed public source | One exact municipality-, publisher-, source-system-, and record-bound capture; OParl, RIS exports, feeds, and permitted HTML snapshots are capture/interchange formats | A municipality-approved source Adapter captures it; an explicitly authorized human performs **Reviewed source admission** under source and rights policy | A new canonical municipal database, every imported item being an official decision, editorial reporting disguised as an official publication, or an automatic answer approval |
| Meld/Kair session bundle | If agreed, a consent-scoped bundle derived from one recording/session, with exact Municipal context references plus consent and redaction evidence | A proposed Meld/Kair connection verifies consent, context references, scope, retention, provenance, and review eligibility before any claim can enter the Public knowledge projection | Resident identity, official publication, Case admission, or authority transition |

The seams may be joined by explicit provenance references after their own gates.
For example, an admitted Topic can cite a reviewed RIS record, reviewed local
reporting, and a reviewed Meld/Kair contribution. Joining references does not
merge source authority,
copy raw transcripts into a public projection, or create an official answer.

## Review and authority gates

Every inbound seam preserves its source kind, municipality scope, exact
content digest, visibility class and correction lineage, but the gates are
deliberately not identical:

1. **Röbel signature and provenance:** verify the signed public contribution
   and its Topic/Discussion lineage. This is attributed provenance, not a
   human source-review attestation.
2. **Public-source capture and admission:** preserve the source system,
   originating identifier, publisher, owner, timestamp, record kind,
   publication state, rights profile, exact bytes, and mapping evidence. An
   accountable human accepts or rejects one exact capture under a named
   source and rights policy. OParl is an interchange specification, RIS is a
   source system/publication surface, and a meeting, agenda item, paper,
   minutes, and final decision do not have interchangeable authority.
3. **Meld/Kair consent, classification and deliberation review:** bind the
   private bundle to a specific session consent receipt and processing
   purpose. An accountable human may derive one public-safe Reviewed
   deliberation artifact under a named policy. Revocation or expiry makes the
   private bundle ineligible for new projections.
4. **Claim and citation validation:** generated text must point to exact
   reviewed artifacts and must separate fact, attributed statement,
   interpretation, uncertainty, and missing evidence.
5. **Human Case admission:** only an explicitly authorized human Case Steward
   under municipality policy can turn a citizen-signed Topic suggestion
   candidate into one Civic case. The production identity and authorization
   mechanism remains an implementation gate. Source review and a citizen
   signature never substitute for this transition.
6. **Municipal publication candidate:** a reviewed Kair artifact, Department
   response, Citizen Brief, or result may be proposed for a named municipal
   publication target. The candidate binds the exact payload, version, digest,
   proposed publication authority, endpoint, official kind, and correction
   relationship. It remains non-official and has no institutional effect.
7. **Municipal publication receipt:** a designated municipality-operated Kair,
   openDesk, RIS, Stadtstack, or other publication endpoint may accept that
   exact candidate only under its named municipal policy and accountable
   principal or recorded delegated workflow. The receipt assigns the official
   identifier, publication state, version, timestamp, and institutional-effect
   ceiling. The policy-bound receipt—not a Kair/openDesk output, MCP, an agent,
   or ordinary transport delivery—creates the official municipal publication.
8. **Authority transition:** formal submission, publication, vote, council
   decision, and treasury execution remain explicit transitions owned by the
   responsible city or governance system. Apart from the publication gate
   defined above, nothing in this contract performs one.

These properties remain independent and must not be compressed into one
status field: `originClass`, `reviewState`, `visibility`, `publicationState`,
`institutionalEffect`, `authorityReceiptRef`, `consentScope`, and correction
lineage (`correctionOf` / `supersedes`). A public artifact can still be
unreviewed; a reviewed artifact can remain private; a published artifact can
have no binding institutional effect.

## Municipal operating and authority model

The protocol deliberately separates three facts which may coincide in one
municipal deployment but must not be inferred from one another:

| Fact | Meaning | Example |
| --- | --- | --- |
| `operatedBy` | Who hosts and operates the runtime or data surface | A municipality runs Kair or openDesk on its own infrastructure; a local partner operates a trial device |
| `systemRole` | What the software is doing in the exchange | Kair is a session runtime; openDesk is an administration workspace; an RIS or Stadtstack deployment is a publication endpoint |
| `publicationAuthority` | Which municipal policy, accountable principal or recorded delegation can make an official publication | A named municipal office approves a version, or an approved service workflow executes that office's recorded delegation |

Kair, openDesk, an RIS or Stadtstack may therefore be the **designated municipal
publication endpoint**. It can create the official record and receipt when the
candidate, authority policy, accountable principal or delegation, target
mapping, and idempotency checks are valid. The same systems remain
non-authoritative when they merely capture a session, prepare a draft, relay a
response, or are operated outside that municipal delegation.

## Municipal Civic Context Exchange

The public exchange has two linked views:

1. a **strict OParl-compatible view** containing only municipality-published
   parliamentary objects that fit OParl semantics; and
2. a **broader reviewed civic-context view** containing typed Discussions,
   Reviewed sources, Reviewed deliberation artifacts, Citizen Briefs, Case
   projections, publication candidates that are allowed to be visible, and
   status/correction records.

OParl provides anonymous read access to already-public parliamentary
information. It is not an automatic write workflow for a Kair session or
openDesk task. A municipality-operated Kair, openDesk, RIS or Stadtstack
workflow may create the appropriate official record when it executes the
policy-bound publication receipt. The integration therefore does not invent
private OParl extensions or label the broader view “OParl 2.” When an
authorized municipal publication fits an official OParl kind, an Adapter may
project it using the appropriate `Body`,
`LegislativeTerm`, `Organization`, `Person`, `Membership`, `Meeting`,
`AgendaItem`, `Paper`, `Consultation`, `File`, or `Location` relationship.
There is no generic OParl `Decision` object; published results remain attached
to the appropriate official object and source semantics.

The broader view and strict view remain linked by exact identifiers, versions,
digests and correction lineage. They never gain each other's authority by
being delivered through the same feed.

## Public artifact projection and content-minimal change notice

The shared public surface is one versioned, checksum-bound **Public knowledge
projection**. Public Mecky and the Mitmachen view consume the same projection
version and checksum. It contains public-safe records only. The illustrative
artifact envelope keeps source authority separate from effect authority and
uses the gate that belongs to the originating seam:

```json
{
  "schemaVersion": "public_knowledge_artifact_v1",
  "artifactRef": "urn:municipal-civic-context:artifact:<municipality>:<opaque-id>",
  "municipality": "<canonical-municipality>",
  "topicRef": "<optional-topic-id>",
  "caseRef": "<optional-canonical-case-id>",
  "artifactKind": "signed_discussion|reviewed_source_record|reviewed_deliberation_artifact|case_projection|municipal_publication_candidate|official_municipal_publication",
  "originClass": "municipal_source|community_statement|session_derivative|administration_work_product|case_projection",
  "reviewState": "accepted|superseded|withdrawn",
  "operatedBy": "municipality|municipal_partner|community_operator|independent_provider",
  "systemRole": "resident_interface|session_runtime|administration_workspace|ris|municipal_publication_endpoint|source_adapter|case_journal",
  "sourceSystemKind": "resident_interface|ris|news_publisher|session_runtime|administration_workspace|municipal_publisher|case_journal",
  "recordKind": "discussion|meeting|agenda_item|paper|consultation|file|published_result|article|session_derivative|case_projection|publication_candidate|official_publication",
  "captureFormat": "nostr|oparl|ris_export|rss|https_snapshot|private_bundle|administration_return|municipal_publication|case_journal",
  "sourceIdentifier": "<exact-originating-identifier>",
  "publisher": "<public-publisher-identity>",
  "sourceOwner": "<responsible-source-owner>",
  "publicationState": "draft|published|corrected|withdrawn|unknown",
  "sourceAuthority": "attributed_statement|official_publication|editorial_report|reviewed_derivative|administration_work_product|case_projection",
  "rightsProfile": "<source-specific-policy-version>",
  "consentScope": "not_applicable|reviewed_publication|irreversible_publication",
  "eligibility": {
    "gate": "signed_provenance|human_source_admission|human_deliberation_review|case_projection|municipal_publication_receipt",
    "policyVersion": "<policy-or-signature-profile>",
    "attestationRef": "<optional-non-secret-reference>"
  },
  "institutionalEffect": "none|administrative_statement|formal_submission|formal_decision|implementation_commitment",
  "publicationAuthority": {
    "municipality": "<required-for-official-publication; otherwise-null>",
    "policyRef": "<required-for-official-publication; otherwise-null>",
    "principalRef": "<accountable-human-or-delegated-service-reference; otherwise-null>",
    "endpointRef": "<municipality-designated-endpoint; otherwise-null>"
  },
  "authorityReceiptRef": "<required-for-official-publication; otherwise-null>",
  "visibility": "public",
  "correction": {"state": "current|superseded|withdrawn", "supersedes": "<optional-artifact-ref>"},
  "publicPayloadDigest": "sha256:<digest>"
}
```

For Meld/Kair, the public record points only to the Reviewed deliberation
artifact and its public-payload digest. The private bundle ID, source digest,
session pseudonym, consent receipt and content references never enter this
envelope. The private review ledger retains the one-way provenance binding.

The replay feed carries a separate, content-minimal **Civic change event**:

```json
{
  "schemaVersion": "civic_change_event_v1",
  "changeId": "urn:municipal-civic-context:change:<municipality>:<opaque-id>",
  "cursor": "<opaque-delivery-position>",
  "municipality": "<canonical-municipality>",
  "artifactRef": "urn:municipal-civic-context:artifact:<municipality>:<opaque-id>",
  "artifactKind": "<public-artifact-kind>",
  "projectionVersion": "<version>",
  "projectionDigest": "sha256:<digest>",
  "correctionState": "current|superseded|withdrawn",
  "changedAt": "<canonical-time>"
}
```

The change event carries no title, summary, raw source reference, identity
correlation or authority upgrade. Both illustrative shapes are contracts, not
database schemas. Producers reject unknown authority, private identifiers,
credentials, raw transcript content, direct evidence blobs and ineligible
source references. Public artifact payloads may carry cited HTTPS references,
metadata, digests, and rights-permitted excerpts. Human review does not grant a
right to republish editorial content; full local-news articles are excluded by
default. The canonical Case journal, private evidence, workspace IDs, identity
credentials, and content outside the source-specific rights profile remain
outside the projection.

The projected `consentScope` is a public-safe eligibility class, never the
private receipt or its participant mapping. `operatedBy` and `systemRole`
describe deployment and software capability; they never establish civic
authority. `authorityReceiptRef` and `publicationAuthority` are mandatory for
`official_municipal_publication`, point only to public-safe authority and
receipt references, and are `null` for artifacts without an authority
transition. Pending/rejected review records and private consent details remain
in their own ledgers and cannot enter this public envelope.

## Interchange transports

### REST/cursor change feed (proposed initial interchange)

Cross-client discovery and consumption are central to the shared project. The
initial contract uses a read-only, deterministic HTTP feed over the
eligibility-gated Public knowledge projection as the canonical replay surface:

```text
GET /v1/changes?cursor=<opaque>&limit=<bounded>
GET /v1/changes/<change-id>
```

The server returns the exact projection version, the next opaque cursor, and a
stable page of changes. Cursors are delivery positions, not row counts or
authority tokens. The endpoint has no write method, caller-selected source,
Case mutation, credential-bearing query, or arbitrary upstream fetch. A
withdrawal or correction is an explicit eligibility-gated change, not an in-place
rewrite that makes an old cursor silently mean something else.

### MCP (bounded agent interface)

MCP retains the collaborator proposal's cross-client goal and is an Adapter
over the same Public knowledge projection. Its intended municipal resource
classes include normalized, eligibility-gated `body`, `meeting`, `agenda-item`,
`paper`, `consultation`, and `file` records together with published result
fields, Topics, reviewed source records, Case projections, and change cursors.
It may also provide read-only tools for
citation lookup and source/status explanation.
It must enforce municipality, visibility, source, and result-size limits. MCP
does not authenticate a resident, attest a review, admit a Case, submit to
openDesk, start a vote, sign a Safe transaction, or move treasury funds.

Whether MCP notifications or subscriptions are part of the first shared
prototype is jointly deferred. If added, they remain a delivery optimization
and must not become a second source of truth or replace the cursor feed's replay
and correction semantics.

### Nostr (signed public mirror)

Nostr remains the signed public mirror for eligible discussion and reviewed
public-exchange records. The mirror signs the public-safe envelope and its
projection digest; it does not mirror the private Case journal, a consent
receipt, raw audio, private evidence, or an administration credential. A relay
is a transport and discovery surface, not the Case owner. Nostr events can be
replayed and verified, but they do not grant a recipient civic authority.

Meld/Kair derivatives are excluded from the Nostr mirror by default because a
relay copy cannot be erased after consent withdrawal. A Reviewed deliberation
artifact may enter that irreversible lane only under a separate explicit
irreversible-publication consent and permanent-public eligibility gate. A
later correction can add a signed correction record but cannot retract copies
already replicated by third parties.

## Consent-scoped Meld/Kair bundle boundary

The Meld/Kair Adapter must provide a separate, private input contract before a
bundle can be reviewed:

```json
{
  "schemaVersion": "kair_session_bundle_v1",
  "bundleId": "<opaque-session-bundle-id>",
  "municipality": "<scope>",
  "session": {"pseudonym": "<session-scoped-id>", "startedAt": "<time>", "endedAt": "<time>"},
  "contextRefs": [{"artifactRef": "<reviewed-municipal-context-ref>", "version": "<version>", "digest": "sha256:<digest>"}],
  "consent": {"receiptDigest": "sha256:<digest>", "purposes": ["privateReview"], "expiresAt": "<time>", "revokedAt": null},
  "provenance": {"producer": "<adapter>", "sourceDigest": "sha256:<digest>", "captureVersion": "<version>"},
  "privacyClassification": {"profile": "<version>", "state": "review_required", "assessmentRef": "<private-reference>"},
  "contentRefs": ["<private-reference>"],
  "reviewEligibility": "pending"
}
```

This shape is a **Stadtstack contract proposal**, not a claim about Kair's
current wire format. Its context references bind a session derivative to exact,
reviewed and versioned Municipal context; they do not turn that context or the
session into an official decision. The Adapter must not infer a persistent
Röbel member identity from a session pseudonym. An explicit, separately
reviewed link receipt is required if a resident later chooses to associate a
contribution with their Röbel account.

Consent purposes remain distinct. Private review or retrieval does not permit
public publication, Case admission, cross-municipality similarity discovery,
or use of a reviewed session artifact in a Case or Department package. That
last use requires a separate `caseCitation` purpose or other documented lawful
basis. Expiry or withdrawal blocks new derivative eligibility and creates an
explicit correction or withdrawal record. It cannot erase the originating
public source, third-party public copies, or evidence that a responsible owner
must legally retain under the Case journal's own policy.

## Self-hosted Kair working hypothesis

The current shared direction is to obtain access to the Kair code, buy suitable
commodity hardware, and install and test the runtime independently. A later
municipality may operate the same runtime itself, including as its designated
publication endpoint. The comparison to MeshCore or Meshtastic is limited to
the self-owned deployment ethos: a community or municipality can operate
software on hardware it controls. It is not a claim of protocol compatibility,
network topology, radio capability, or shared implementation.

Before this becomes an accepted architecture, the device tracer must establish:

- repository access, licence, dependency availability, modification and
  redistribution rights;
- supported and replaceable hardware, installation, provisioning, update,
  rollback, backup, recovery and device-identity procedures;
- processing location, encryption, offline behavior, synchronization and
  failure/replay semantics;
- consent capture, retention, deletion, revocation and export behavior; and
- the actual Kair bundle interface and its versioning and compatibility policy.

Kair remains its own deep module. Stadtstack depends only on the versioned
session-bundle exchange contract; it does not copy Kair internals into the
Civic Case or public projection.

## Original prototype phases and re-baselining

The first shared brief proposed a two-month infrastructure prototype targeting
the end of October:

1. ingest and normalize one participating municipality's authorized RIS/OParl
   or other official-source example, then prove the same consumer contract in
   the selected resident interface;
2. bind one Kair session bundle to that context and publish a correction-aware
   change through the shared feed; and
3. expose the same projection through bounded MCP resources and a resident
   interface client.

That date is retained as the original scoping target, not a current delivery
commitment. It must be re-baselined after Kair repository access, the first
hardware installation, named prototype participants, municipal-source scope,
the designated publication endpoint, and the responsible municipal publication
authority are confirmed. Candidate trial contexts are Herzogtum Lauenburg
(Schleswig-Holstein; lead client NextLearning e.V., local partner Landvorteil
e.V., and WFL) and Ludwigslust-Parchim (Mecklenburg-Vorpommern; South West
Mecklenburg Economic Development Agency); their participation, roles, sources,
rights and publication authority are not yet confirmed. The revised acceptance
criterion adds the return path: an administration response becomes a candidate,
is explicitly published through the municipality's authorized workflow, and
reappears as a new version through the same feed and MCP view.

## Administration and participation continuation

Once a human steward admits a Case, Department packages remain the unit of
administration work. The provider-neutral openDesk round trip is:

```text
Department package
  -> prepared administration work request (not sent)
  -> separately authorized openDesk handoff receipt
  -> checksum-bound administration response return
  -> assigned Department draft
  -> independent human review
  -> Reviewed citizen brief
  -> advisory participation / Mitmachen
  -> municipal publication candidate, when an official return is intended
  -> accountable municipal publication receipt
  -> official municipal publication and new Civic change event
```

The openDesk response is an administration work record, not automatically an
OParl record or official public answer. It can prepare the exact material for a
publication candidate and, when municipality-operated and policy-authorized,
can execute the publication receipt itself. The municipal publication receipt
is the explicit return gate. Public Mecky can explain reviewed material without
asking the administration to approve every generated sentence. Human review
remains on source admission, Department response, Case admission, Citizen
Brief derivation, publication, and every Authority transition where municipal
policy requires it.

## Cross-municipality discovery

Similarity or pattern matching may help people discover related Topics across
municipalities. It is an advisory discovery projection only. It may link exact
public-artifact digests and public-safe descriptors, but it must not merge
Cases, transfer consent, infer identity, copy private session content, or make
one municipality's record precedent for another. Each municipality retains its
own source owner, Case Steward, review policy, and Authority transitions.

## Assumptions requiring collaborator confirmation

| Claim | Current status |
| --- | --- |
| Access to Kair source code and independent installation on self-owned commodity hardware | Current shared direction; pending repository, licence and device evidence |
| On-device or edge capture, transcription, pseudonymisation, temporal graphing, and downstream retrieval | Pending code and device inspection; not stated as a confirmed implementation |
| `kair_session_bundle_v1`, consent receipt fields, private review ledger, and Adapter API | Stadtstack proposal; not a claimed Kair interface |
| Controller/processor roles, lawful basis, retention, licensing, hosting, programme scope, and delivery dates | Unresolved; must be accepted before implementation |

The following are deliberately not stated as confirmed facts by this contract:

- the exact Meld/Kair component names, wire format, deployment topology,
  pseudonymisation guarantees, and model/runtime choices;
- whether recording, transcription, NER, temporal graphing, or downstream
  retrieval happens on a device, in a community node, or on EU-hosted
  infrastructure;
- the consent language, lawful basis, retention, deletion/revocation
  semantics, and whether a session may be reused for retrieval or public
  exchange;
- ownership, contributor, model, data, and software licenses;
- delivery dates, funding/programme boundaries, and operational support;
- the exact OParl/RIS source coverage, terms of use, correction behavior, and
  municipality-specific adapter obligations.

Until these are confirmed by the owners, they remain planning assumptions and
must not appear as live capability, legal approval, or production readiness.

## Acceptance tests before a Meld/Kair or change-feed staging tracer

The Röbel product tracer and interoperability prototype have separate
acceptance criteria and may progress in parallel. Neither is evidence that the
other works, and live public activation waits for every gate relevant to the
surface being activated.

1. Each seam rejects the other seams' identifiers and missing source bindings.
2. A revoked or expired Meld/Kair consent receipt cannot enter a new public
   projection; existing publication is handled by an explicit correction or
   withdrawal policy.
3. A Meld/Kair session pseudonym cannot authenticate a Röbel account or Case
   Steward.
4. A Meld/Kair derivative names exact Municipal context references and versions;
   missing or changed references fail closed.
5. Private-review or retrieval consent cannot authorize Case/Department-package
   citation without a separate `caseCitation` purpose or documented lawful basis.
6. An OParl/RIS capture cannot become a formal decision merely by being
   imported or cited, and local-news projection fails without a matching rights
   profile.
7. Public Mecky answers cite only the one Public knowledge projection and distinguish
   attributed statements from reviewed facts.
8. REST replay and MCP reads agree on the same projection digest and correction
   state; Nostr verification agrees for the independently permanent-public
   subset only.
9. Human Case admission, openDesk return, Citizen Brief derivation, advisory
   participation, formal vote, and treasury execution each fail closed when
   their own owner, version, or review evidence is missing.
10. The end-to-end browser tracer shows one Topic/Case/Journey identity without
    creating a parallel Mini App record.
11. A Kair artifact or openDesk response cannot appear in the strict
    OParl-compatible view without an exact municipal publication receipt and a
    valid mapping to an official OParl kind; a municipality-operated Kair,
    openDesk, RIS or Stadtstack endpoint publishes successfully only with its
    named policy and accountable principal or recorded delegation, and fails
    closed without them.
12. Publishing an exact candidate creates a new correction-aware change event;
    the REST feed, MCP Adapter, and Röbel consumer observe the same version and
    digest, while the original candidate remains distinguishable from the
    official publication.

## Proposed responsibility split — pending confirmation

Max Brych / Röbel is the proposed technical product steward for its social
feed, signed discussion presentation, resident experience, and Civic Journey
rendering. Maximilian Stahl / Stadtstack maintains the municipality-neutral
contract and reference implementation; this does not give Stadtstack
publication or municipal-policy authority. Charlie Fisher / Komma Systems /
Kair controls the session runtime and must confirm its exchange interface and
operational responsibilities.

The municipality's designated owner controls source admission, publication
policy, Case authority, and Authority transitions. The responsible municipal
department owns administration task execution. Kair, openDesk, an RIS or a
Stadtstack deployment may host the task record and may be the municipality's
designated publication endpoint; only a named policy plus accountable principal
or recorded delegation gives that endpoint authority to publish. Controller/
processor roles, lawful basis, consent language, retention, licensing, and
support remain unresolved until the collaborators and responsible municipality
accept them. No recipient gains the authority of another actor merely by
consuming this contract.
