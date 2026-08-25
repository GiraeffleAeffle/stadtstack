# Meld/Kair × OParl/RIS × Röbel integration contract

- **Status:** proposed integration contract
- **Date:** 2026-08-24
- **Scope:** the municipality-neutral exchange boundary between Röbel App,
  Stadtstack, OParl/RIS adapters, and a consent-scoped Meld/Kair adapter

> **Stadtstack integration response — proposed boundary v0.** This document
> changes and extends the collaborator brief supplied on 24 August 2026. It is
> not an agreed summary of Charlie/Komma's proposal and does not allocate work,
> ownership, funding, publication rights, or municipal authority. Röbel,
> Komma/Meld/Kair, Stadtstack, and each participating municipality must confirm
> the interpretation below.

This contract records a proposed shared boundary for the Röbel, Stadtstack,
and Komma collaborators. It is not a claim that the Meld/Kair implementation,
source licensing, deployment, or timeline has been confirmed. Those items are
explicitly listed as assumptions below and must be confirmed before
implementation or publication.

## Collaborator proposal under review

Our current reading of Charlie's core proposal is a **contextual enrichment
network**, not merely another input beside Röbel:

```text
municipal RIS / OParl / permitted public pages
  -> exact source capture and common council-context mapping
  -> consented session references that exact context
  -> Meld/Kair derives a contextual session bundle or graph
  -> a reviewed, public-safe derivative enters an update feed
  -> Röbel, facilitators, developers and agent clients can discover and use it
```

The useful hypothesis is that municipal records can ground a facilitated
conversation, while the resulting structured deliberation can enrich a shared,
cross-client civic context. The review and authority gates in this contract do
not reject that flow. They prevent a source mapping, recording, model output,
or transport notification from silently becoming an official decision, Civic
case, formal ballot, or treasury action.

| Original collaborator direction | Stadtstack response | Status |
| --- | --- | --- |
| Normalise heterogeneous council records into a common context | Preserve exact source, record kind, mapping evidence, publication state, and correction lineage around a common context snapshot | Shared goal; exact schema to agree |
| Ground Kair sessions in council context and attach a structured bundle | Permit an exact context reference inside a consent-scoped private bundle, then require separate review before a public derivative exists | Shared goal with added consent/review gates |
| Provide an RSS-like, cross-client civic update stream | Use one replayable change feed; expose MCP over the same projection and evaluate subscriptions jointly | Shared goal; transport decision proposed |
| Let Röbel surface deliberation and resident signals | Link reviewed artifacts into the existing Röbel Civic Journey without automatic Case admission or voting authority | Shared goal with separate product acceptance |
| Two-month infrastructure prototype for facilitators/developers | Keep an interoperability prototype distinct from the Röbel browser tracer and confirm dates, programme scope, hardware, and owners | Not yet agreed |

Two related tracks therefore remain distinct:

- the **interoperability prototype** proves source mapping, contextual bundle,
  change-feed replay, and MCP consumption for facilitators/developers; and
- the **Röbel staging product slice** proves the resident-facing Topic, Mecky,
  Case, administration, Citizen Brief, and advisory Mitmachen journey.

They may progress in parallel and share public contracts, but one is not proof
that the other works. Subject to municipality approval and source-specific
rights, the intended first real interoperability-validation target is an exact
Strausberg RIS capture; synthetic fixtures prove the contract before that real
source is admitted. Röbel consumption follows the same reviewed public
contract rather than receiving a private or source-system shortcut.

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
| Meld/Kair session bundle | If agreed, a consent-scoped bundle derived from one recording/session, with exact council-context references plus consent and redaction evidence | A proposed Meld/Kair connection verifies consent, context references, scope, retention, provenance, and review eligibility before any claim can enter the Public knowledge projection | Resident identity, official publication, Case admission, or authority transition |

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
6. **Authority transition:** formal submission, publication, vote, council
   decision, and treasury execution remain explicit transitions owned by the
   responsible city or governance system. Nothing in this contract performs
   one.

## Public artifact projection and content-minimal change notice

The shared public surface is one versioned, checksum-bound **Public knowledge
projection**. Public Mecky and the Mitmachen view consume the same projection
version and checksum. It contains public-safe records only. The illustrative
artifact envelope keeps source authority separate from effect authority and
uses the gate that belongs to the originating seam:

```json
{
  "schemaVersion": "public_knowledge_artifact_v1",
  "artifactRef": "urn:stadtstack:artifact:<municipality>:<opaque-id>",
  "municipality": "<canonical-municipality>",
  "topicRef": "<optional-topic-id>",
  "caseRef": "<optional-canonical-case-id>",
  "artifactKind": "signed_discussion|reviewed_source_record|reviewed_deliberation_artifact|case_projection",
  "sourceSystemKind": "roebel|ris|news_publisher|meld_kair|case_journal",
  "recordKind": "discussion|meeting|agenda_item|paper|minutes|decision|article|session_derivative|case_projection",
  "captureFormat": "nostr|oparl|ris_export|rss|https_snapshot|private_bundle|case_journal",
  "sourceIdentifier": "<exact-originating-identifier>",
  "publisher": "<public-publisher-identity>",
  "sourceOwner": "<responsible-source-owner>",
  "publicationState": "draft|published|corrected|withdrawn|unknown",
  "sourceAuthority": "attributed_statement|official_publication|editorial_report|reviewed_derivative|case_projection",
  "rightsProfile": "<source-specific-policy-version>",
  "eligibility": {
    "gate": "signed_provenance|human_source_admission|human_deliberation_review|case_projection",
    "policyVersion": "<policy-or-signature-profile>",
    "attestationRef": "<optional-non-secret-reference>"
  },
  "effectAuthority": "none",
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
  "changeId": "urn:stadtstack:change:<municipality>:<opaque-id>",
  "cursor": "<opaque-delivery-position>",
  "municipality": "<canonical-municipality>",
  "artifactRef": "urn:stadtstack:artifact:<municipality>:<opaque-id>",
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

## Interchange transports

### REST/cursor change feed (proposed initial interchange)

Charlie's proposal makes cross-client discovery and consumption central. The
Stadtstack response proposes a read-only, deterministic HTTP feed over the
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
`paper`, and `decision` records together with Topics, reviewed source records,
Case projections, and change cursors. It may also provide read-only tools for
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
  "contextRefs": [{"artifactRef": "<reviewed-council-context-ref>", "version": "<version>", "digest": "sha256:<digest>"}],
  "consent": {"receiptDigest": "sha256:<digest>", "purposes": ["privateReview"], "expiresAt": "<time>", "revokedAt": null},
  "provenance": {"producer": "<adapter>", "sourceDigest": "sha256:<digest>", "captureVersion": "<version>"},
  "privacyClassification": {"profile": "<version>", "state": "review_required", "assessmentRef": "<private-reference>"},
  "contentRefs": ["<private-reference>"],
  "reviewEligibility": "pending"
}
```

This shape is a **Stadtstack contract proposal**, not a claim about Kair's
current wire format. Its context references bind a session derivative to exact,
reviewed and versioned council context; they do not turn that context or the
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
```

The round trip never turns a Meld/Kair bundle or an agent contribution into an
official answer. Public Mecky can explain reviewed material without asking the
administration to approve every generated sentence. Human review remains on
source admission, Department response, Case admission, Citizen Brief
derivation, and every Authority transition.

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
| On-device or edge capture, transcription, pseudonymisation, temporal graphing, and downstream retrieval | Collaborator-reported direction; pending written confirmation |
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
4. A Meld/Kair derivative names exact council-context references and versions;
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

## Proposed responsibility split — pending confirmation

Röbel is the proposed technical product steward for its social feed, signed
discussion presentation, resident experience, and Civic Journey rendering.
Stadtstack maintains the municipality-neutral contract and reference
implementation; this does not give Stadtstack publication or municipal-policy
authority. The municipality's designated owner controls source admission,
publication policy, Case authority, and Authority transitions. The responsible
municipal department owns administration task execution; openDesk may host or
exchange the task record but is not the responsible authority.

Komma/Meld/Kair controls its own implementation and must confirm its interface
and operational responsibilities. Controller/processor roles, lawful basis,
consent language, retention, licensing, and support remain unresolved until the
collaborators and responsible municipality accept them. No recipient gains the
authority of another actor merely by consuming this contract.
