# Reviewed source projection contract

## Status

The municipality-neutral preparation contract and loopback reference transport
are implemented and tested with synthetic records. No real Röbel news or
Ratsinformationssystem record is admitted by this repository, and no public
endpoint is deployed by this Module.

## Boundary

```text
city-specific capture (private) → human source review → Stadtstack preparation
                                                       ↓ exact public bytes
Röbel GET-only adapter → bounded evidence packet → cited Mecky answer
```

Source collection, reviewer authentication and publication are outside the public Module. The preparer performs no network request and no write.

## Review input

One `reviewed_source_admission_batch_v1` contains one municipality, one source kind, one policy version, one generation time and up to 100 reviewed records. Each record has:

- a closed public evidence object;
- `sourceCaptureSha256`, equal to its public `evidenceId`; and
- one `source_review_attestation_v1` with an exact checksum.

The review attestation binds municipality, source kind, evidence/capture checksum, reviewer actor, actor class `source_reviewer`, decision `admit_public`, canonical review time and policy version. Changing any field invalidates the checksum. An agent identity cannot substitute for the human actor class.

## Public output

The projection is byte-compatible with the Röbel consumer contract:

```json
{
  "schemaVersion": "reviewed_public_knowledge_projection_v1",
  "municipalityId": "roebel-mueritz",
  "sourceKind": "ratsinformation",
  "generatedAt": "2026-08-22T12:00:00.000Z",
  "records": [],
  "contentSha256": "sha256:<canonical projection checksum>"
}
```

The checksum covers the other five fields as recursively key-sorted canonical JSON. Record order is deterministic by evidence ID.

Local news is always `editorial_report`: review confirms the public capture, attribution and summary, not every assertion in the article. Ratsinformationssystem material is always `official_record`: it proves what the exact paper states, not that a proposal was adopted, implemented or paid.

`current`, `stale`, `superseded` and `withdrawn` remain explicit. The Röbel consumer admits only `current` records before ranking. This lets one corrected source disappear without making an unrelated source unavailable.

## Public transport

`createReviewedPublicKnowledgeServer` revalidates and serves the exact prepared
projection at:

- `/api/federation/v1/municipalities/{municipalityId}/public-knowledge/local-news`
- `/api/federation/v1/municipalities/{municipalityId}/public-knowledge/ratsinformation`

The pure router is GET-only, value-free, correction-aware and
byte/checksum-preserving. It rejects snapshots above the Röbel consumer's
512,000-byte default. Its bundled Node listener is loopback-only and
rejects query strings, writes, unknown routes and non-loopback Host headers.
A production Adapter may mount that router behind a reviewed ingress without
widening the two paths. Deployment and city-specific review data belong in the
appropriate private operations repository.
