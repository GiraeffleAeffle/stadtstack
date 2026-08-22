import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareReviewedPublicKnowledgeProjection,
  sourceReviewAttestationChecksum,
  type ReviewedLocalNewsEvidence,
  type ReviewedPublicKnowledgeEvidence,
  type ReviewedRatsinformationEvidence,
  type ReviewedSourceAdmissionBatchV1,
  type SourceReviewAttestationDraftV1,
} from "../src/reviewed-public-knowledge.ts";

const sha = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const MUNICIPALITY = "roebel-mueritz";
const GENERATED_AT = "2026-08-22T12:00:00.000Z";
const REVIEWED_AT = "2026-08-22T10:00:00.000Z";
const POLICY = "public-source-review-v1";

function news(overrides: Partial<ReviewedLocalNewsEvidence> = {}): ReviewedLocalNewsEvidence {
  return {
    evidenceId: sha("a"),
    municipalityId: MUNICIPALITY,
    sourceKind: "local_news",
    authority: "editorial_report",
    title: "Bericht zur Marienfelder Straße",
    summary: "Die Redaktion berichtet über Vorschläge für eine sichere Querung.",
    publishedAt: "2026-08-20T08:00:00.000Z",
    admissionState: "admitted",
    lifecycle: "current",
    publisher: "Röbel Kurier",
    articleUrl: "https://news.example/roebel/marienfelder-strasse",
    reviewedAt: REVIEWED_AT,
    ...overrides,
  };
}

function ris(overrides: Partial<ReviewedRatsinformationEvidence> = {}): ReviewedRatsinformationEvidence {
  return {
    evidenceId: sha("b"),
    municipalityId: MUNICIPALITY,
    sourceKind: "ratsinformation",
    authority: "official_record",
    title: "Ausschussvorlage zur Marienfelder Straße",
    summary: "Die Vorlage dokumentiert einen Prüfauftrag zur Querung.",
    publishedAt: "2026-08-19T08:00:00.000Z",
    admissionState: "admitted",
    lifecycle: "current",
    body: "Beratungsgegenstand ist die Prüfung einer sicheren Querung.",
    recordId: "RIS-2026-42",
    recordUrl: "https://ris.example/roebel/vorlagen/2026-42",
    reviewedAt: REVIEWED_AT,
    ...overrides,
  };
}

function attestation(evidence: ReviewedPublicKnowledgeEvidence, overrides: Partial<SourceReviewAttestationDraftV1> = {}) {
  const draft: SourceReviewAttestationDraftV1 = {
    schemaVersion: "source_review_attestation_v1",
    municipalityId: MUNICIPALITY,
    sourceKind: evidence.sourceKind,
    evidenceId: evidence.evidenceId,
    sourceCaptureSha256: evidence.evidenceId,
    reviewerActorId: "synthetic:source-reviewer-1",
    actorClass: "source_reviewer",
    decision: "admit_public",
    reviewedAt: evidence.reviewedAt,
    policyVersion: POLICY,
    ...overrides,
  };
  return { ...draft, attestationChecksum: sourceReviewAttestationChecksum(draft) };
}

function batch(evidence: ReviewedPublicKnowledgeEvidence): ReviewedSourceAdmissionBatchV1 {
  return {
    schemaVersion: "reviewed_source_admission_batch_v1",
    municipalityId: MUNICIPALITY,
    sourceKind: evidence.sourceKind,
    generatedAt: GENERATED_AT,
    policyVersion: POLICY,
    records: [{
      evidence,
      sourceCaptureSha256: evidence.evidenceId,
      review: attestation(evidence),
    }],
  };
}

test("a human-reviewed news capture becomes the exact checksum-bound Röbel projection", () => {
  const prepared = prepareReviewedPublicKnowledgeProjection(batch(news()));

  assert.deepEqual(Object.keys(prepared.projection).sort(), [
    "contentSha256", "generatedAt", "municipalityId", "records", "schemaVersion", "sourceKind",
  ]);
  assert.equal(prepared.projection.schemaVersion, "reviewed_public_knowledge_projection_v1");
  assert.equal(prepared.projection.sourceKind, "local_news");
  assert.deepEqual(prepared.projection.records, [news()]);
  assert.match(prepared.projection.contentSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(prepared.receipt.status, "prepared_not_published");
  assert.equal(prepared.receipt.authorityBinding, "none");
  assert.deepEqual(prepared.receipt.effects, {
    externalPublication: false,
    civicStateMutation: false,
    administrationWrite: false,
    vote: false,
    treasury: false,
  });
  assert.deepEqual(prepared.receipt.records, [{
    evidenceId: sha("a"),
    sourceCaptureSha256: sha("a"),
    reviewAttestationChecksum: attestation(news()).attestationChecksum,
  }]);
});

test("a council paper remains an official record rather than a later decision", () => {
  const prepared = prepareReviewedPublicKnowledgeProjection(batch(ris()));
  const [record] = prepared.projection.records;
  assert.equal(record?.sourceKind, "ratsinformation");
  assert.equal(record?.authority, "official_record");
  assert.equal("formalDecision" in (record ?? {}), false);
  assert.equal(prepared.receipt.effects.civicStateMutation, false);
});

test("source admission requires the exact human attestation and capture checksum", () => {
  const evidence = news();
  const valid = batch(evidence);
  const invalid = [
    {
      ...valid,
      records: [{ ...valid.records[0], sourceCaptureSha256: sha("c") }],
    },
    {
      ...valid,
      records: [{ ...valid.records[0], review: {
        ...valid.records[0]!.review,
        reviewerActorId: "synthetic:other-reviewer",
      } }],
    },
    {
      ...valid,
      records: [{ ...valid.records[0], review: {
        ...valid.records[0]!.review,
        actorClass: "agent",
      } }],
    },
  ];
  for (const value of invalid) {
    assert.throws(
      () => prepareReviewedPublicKnowledgeProjection(value as ReviewedSourceAdmissionBatchV1),
      /source_review|source_capture|admission/u,
    );
  }
});

test("cross-source, cross-town, pending, and future-reviewed evidence fail closed", () => {
  const valid = batch(news());
  const invalid = [
    { ...valid, sourceKind: "ratsinformation" },
    { ...valid, records: [{ ...valid.records[0], evidence: news({ municipalityId: "malchow" }) }] },
    { ...valid, records: [{ ...valid.records[0], evidence: news({ admissionState: "pending_review" as "admitted" }) }] },
    { ...valid, records: [{ ...valid.records[0], evidence: news({ reviewedAt: "2026-08-23T10:00:00.000Z" }) }] },
  ];
  for (const value of invalid) {
    assert.throws(() => prepareReviewedPublicKnowledgeProjection(
      value as ReviewedSourceAdmissionBatchV1,
    ));
  }
});

test("correction lifecycle is preserved for consumer-side pre-rank omission", () => {
  const withdrawn = news({ lifecycle: "withdrawn" });
  const prepared = prepareReviewedPublicKnowledgeProjection(batch(withdrawn));
  assert.equal(prepared.projection.records[0]?.lifecycle, "withdrawn");
  assert.equal(prepared.projection.records[0]?.admissionState, "admitted");
});

test("duplicates, unknown fields, accessors, and mutable caller data cannot alter the projection", () => {
  const evidence = { ...news() };
  const valid = batch(evidence);
  assert.throws(() => prepareReviewedPublicKnowledgeProjection({
    ...valid,
    records: [valid.records[0]!, { ...valid.records[0]! }],
  }), /duplicate/u);
  assert.throws(() => prepareReviewedPublicKnowledgeProjection({
    ...valid,
    unexpected: true,
  } as unknown as ReviewedSourceAdmissionBatchV1));
  assert.throws(() => prepareReviewedPublicKnowledgeProjection(new Proxy(valid, {})));
  const accessor = { ...valid.records[0]!.review } as Record<string, unknown>;
  Object.defineProperty(accessor, "reviewerActorId", { enumerable: true, get: () => "synthetic:reviewer" });
  assert.throws(() => prepareReviewedPublicKnowledgeProjection({
    ...valid,
    records: [{ ...valid.records[0]!, review: accessor }],
  } as unknown as ReviewedSourceAdmissionBatchV1));

  const prepared = prepareReviewedPublicKnowledgeProjection(valid);
  evidence.title = "mutated after preparation";
  assert.equal(prepared.projection.records[0]?.title, "Bericht zur Marienfelder Straße");
  assert.ok(Object.isFrozen(prepared.projection.records[0]));
});

test("projection identity is deterministic and record order is canonical", () => {
  const firstEvidence = news({ evidenceId: sha("c"), articleUrl: "https://news.example/c" });
  const secondEvidence = news({ evidenceId: sha("a"), articleUrl: "https://news.example/a" });
  const first = batch(firstEvidence);
  const second = batch(secondEvidence);
  const combined: ReviewedSourceAdmissionBatchV1 = {
    ...first,
    records: [first.records[0]!, second.records[0]!],
  };
  const reversed: ReviewedSourceAdmissionBatchV1 = {
    ...combined,
    records: [...combined.records].reverse(),
  };
  const left = prepareReviewedPublicKnowledgeProjection(combined);
  const right = prepareReviewedPublicKnowledgeProjection(reversed);
  assert.equal(left.projection.contentSha256, right.projection.contentSha256);
  assert.equal(left.receipt.preparationChecksum, right.receipt.preparationChecksum);
  assert.deepEqual(left.projection.records.map(({ evidenceId }) => evidenceId), [sha("a"), sha("c")]);
});

test("private or credential-bearing source URLs are rejected", () => {
  for (const articleUrl of [
    "http://news.example/article",
    "https://user:secret@news.example/article",
    "https://news.example/article#private",
  ]) {
    assert.throws(() => prepareReviewedPublicKnowledgeProjection(batch(news({ articleUrl }))));
  }
});
