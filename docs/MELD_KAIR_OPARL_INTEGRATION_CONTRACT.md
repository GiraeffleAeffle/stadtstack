# Meld/Kair × OParl/RIS × Röbel integration contract

- **Status:** proposed integration contract
- **Date:** 2026-08-24
- **Scope:** the municipality-neutral exchange boundary between Röbel App,
  Stadtstack, OParl/RIS adapters, and a consent-scoped Meld/Kair adapter

This contract records the smallest shared boundary discussed by the Röbel,
Stadtstack, and Komma collaborators. It is a coordination contract, not a
claim that the Meld/Kair implementation, source licensing, deployment, or
timeline has been confirmed. Those items are explicitly listed as assumptions
below and must be confirmed by the owners before implementation or publication.

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

| Inbound seam | What enters | First owner and gate | What it is not |
| --- | --- | --- | --- |
| Röbel conversation | A signed public contribution, Topic, discussion graph, or citizen-signed suggestion candidate | Röbel preserves the Nostr provenance; a **Human Case admission** independently verifies the exact candidate before a Case event | A formal proposal, official record, or administration request |
| Reviewed public source | One exact municipality- and source-bound `ratsinformation` or `local_news` capture; `oparl` and `ris_export` are capture formats for the former | A source-specific city Adapter captures it; a human **Reviewed source admission** prepares a source-specific **Reviewed source projection** | A new canonical municipal database, editorial reporting disguised as an official record, or an automatic answer approval |
| Meld/Kair session bundle | A consent-scoped bundle derived from one recording/session, with its consent and redaction evidence | A dedicated Meld/Kair Adapter verifies consent, scope, retention, provenance, and review before any claim can enter the Public knowledge projection | Resident identity, official record, Case admission, or authority transition |

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
2. **Public-source capture and admission:** preserve the original identity,
   timestamp, owner and exact source kind. An accountable human accepts or
   rejects one exact OParl/RIS/news capture under a named policy; the Adapter
   preserves `official_record` versus `editorial_report` authority.
3. **Meld/Kair consent, classification and deliberation review:** bind the
   private bundle to a specific session consent receipt and processing
   purpose. An accountable human may derive one public-safe Reviewed
   deliberation artifact under a named policy. Revocation or expiry makes the
   private bundle ineligible for new projections.
4. **Claim and citation validation:** generated text must point to exact
   reviewed artifacts and must separate fact, attributed statement,
   interpretation, uncertainty, and missing evidence.
5. **Human Case admission:** only a registered human Case Steward can turn a
   citizen-signed Topic suggestion candidate into one Civic case. Source
   review and a citizen signature never substitute for this transition.
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
  "sourceKind": "roebel_discussion|ratsinformation|local_news|reviewed_deliberation_artifact|case_journal",
  "captureFormat": "nostr|oparl|ris_export|rss|https_snapshot|private_bundle|case_journal",
  "sourceAuthority": "attributed_statement|official_record|editorial_report|reviewed_session_derivative|case_projection",
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
but the canonical Case journal, private evidence, workspace IDs and identity
credentials remain outside the projection.

## Interchange transports

### REST/cursor change feed (initial interchange)

The initial RSS-like interchange is a read-only, deterministic HTTP feed over
the eligibility-gated Public knowledge projection:

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

MCP is an Adapter over the same Public knowledge projection. It may expose bounded
resources such as a Topic, reviewed source record, Case projection, or change
cursor, and read-only tools for citation lookup and source/status explanation.
It must enforce municipality, visibility, source, and result-size limits. MCP
does not authenticate a resident, attest a review, admit a Case, submit to
openDesk, start a vote, sign a Safe transaction, or move treasury funds.

MCP notifications or subscriptions can be added later as a delivery
optimization. They must not become a second source of truth or replace the
cursor feed's replay and correction semantics.

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
  "consent": {"receiptDigest": "sha256:<digest>", "purpose": "<purpose>", "expiresAt": "<time>", "revokedAt": null},
  "provenance": {"producer": "<adapter>", "sourceDigest": "sha256:<digest>", "captureVersion": "<version>"},
  "privacyClassification": {"profile": "<version>", "state": "review_required", "assessmentRef": "<private-reference>"},
  "contentRefs": ["<private-reference>"],
  "reviewEligibility": "pending"
}
```

This shape is a contract proposal, not a claim about Kair's current wire
format. The Adapter must not infer a persistent Röbel member identity from a
session pseudonym. An explicit, separately reviewed link receipt is required
if a resident later chooses to associate a contribution with their Röbel
account. Consent can permit retrieval without permitting public publication,
Case admission, or cross-municipality similarity discovery.

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

The following are deliberately not stated as facts by this contract:

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

These tests extend, and do not precede, the already-prioritized golden Civic
Journey browser tracer.

1. Each seam rejects the other seams' identifiers and missing source bindings.
2. A revoked or expired Meld/Kair consent receipt cannot enter a new public
   projection; existing publication is handled by an explicit correction or
   withdrawal policy.
3. A Meld/Kair session pseudonym cannot authenticate a Röbel account or Case
   Steward.
4. An OParl/RIS capture cannot become a formal decision merely by being
   imported or cited.
5. Public Mecky answers cite only the one Public knowledge projection and distinguish
   attributed statements from reviewed facts.
6. REST replay and MCP reads agree on the same projection digest and correction
   state; Nostr verification agrees for the independently permanent-public
   subset only.
7. Human Case admission, openDesk return, Citizen Brief derivation, advisory
   participation, formal vote, and treasury execution each fail closed when
   their own owner, version, or review evidence is missing.
8. The end-to-end browser tracer shows one Topic/Case/Journey identity without
   creating a parallel Mini App record.

## Ownership

Röbel owns its social feed, signed discussion presentation, and resident
experience. Stadtstack owns the municipality-neutral Case contracts and the
Public knowledge projection seam. Each city owns its OParl/RIS/news source adapters and
authority transitions. The Meld/Kair technical owners own their capture and
bundle implementation. Lawful-basis, controller, processor, consent-language
and retention ownership remain unresolved until the collaborators and the
responsible municipality confirm them. openDesk owns administration task
execution. No recipient gains the authority of another owner merely by
consuming this contract.
