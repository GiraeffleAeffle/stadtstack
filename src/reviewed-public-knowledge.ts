import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

export type ReviewedSourceKind = "local_news" | "ratsinformation";
export type ReviewedSourceAuthority = "editorial_report" | "official_record";
export type ReviewedSourceLifecycle = "current" | "stale" | "superseded" | "withdrawn";

type ReviewedEvidenceCommon = {
  evidenceId: `sha256:${string}`;
  municipalityId: string;
  title: string;
  summary: string;
  publishedAt: string;
  admissionState: "admitted";
  lifecycle: ReviewedSourceLifecycle;
};

export type ReviewedLocalNewsEvidence = ReviewedEvidenceCommon & {
  sourceKind: "local_news";
  authority: "editorial_report";
  publisher: string;
  articleUrl: string;
  reviewedAt: string;
};

export type ReviewedRatsinformationEvidence = ReviewedEvidenceCommon & {
  sourceKind: "ratsinformation";
  authority: "official_record";
  body: string;
  recordId: string;
  recordUrl: string;
  reviewedAt: string;
};

export type ReviewedPublicKnowledgeEvidence =
  | ReviewedLocalNewsEvidence
  | ReviewedRatsinformationEvidence;

export type SourceReviewAttestationDraftV1 = {
  schemaVersion: "source_review_attestation_v1";
  municipalityId: string;
  sourceKind: ReviewedSourceKind;
  evidenceId: `sha256:${string}`;
  sourceCaptureSha256: `sha256:${string}`;
  reviewerActorId: string;
  actorClass: "source_reviewer";
  decision: "admit_public";
  reviewedAt: string;
  policyVersion: string;
};

export type SourceReviewAttestationV1 = SourceReviewAttestationDraftV1 & {
  attestationChecksum: `sha256:${string}`;
};

export type ReviewedSourceAdmissionV1 = {
  evidence: ReviewedPublicKnowledgeEvidence;
  sourceCaptureSha256: `sha256:${string}`;
  review: SourceReviewAttestationV1;
};

export type ReviewedSourceAdmissionBatchV1 = {
  schemaVersion: "reviewed_source_admission_batch_v1";
  municipalityId: string;
  sourceKind: ReviewedSourceKind;
  generatedAt: string;
  policyVersion: string;
  records: readonly ReviewedSourceAdmissionV1[];
};

export type ReviewedPublicKnowledgeProjectionV1 = {
  schemaVersion: "reviewed_public_knowledge_projection_v1";
  municipalityId: string;
  sourceKind: ReviewedSourceKind;
  generatedAt: string;
  records: readonly ReviewedPublicKnowledgeEvidence[];
  contentSha256: `sha256:${string}`;
};

export type ReviewedPublicKnowledgePreparationReceiptV1 = {
  schemaVersion: "reviewed_public_knowledge_preparation_receipt_v1";
  status: "prepared_not_published";
  municipalityId: string;
  sourceKind: ReviewedSourceKind;
  generatedAt: string;
  policyVersion: string;
  projectionContentSha256: `sha256:${string}`;
  records: readonly {
    evidenceId: `sha256:${string}`;
    sourceCaptureSha256: `sha256:${string}`;
    reviewAttestationChecksum: `sha256:${string}`;
  }[];
  authorityBinding: "none";
  effects: {
    externalPublication: false;
    civicStateMutation: false;
    administrationWrite: false;
    vote: false;
    treasury: false;
  };
  preparationChecksum: `sha256:${string}`;
};

export type PreparedReviewedPublicKnowledgeProjection = {
  projection: ReviewedPublicKnowledgeProjectionV1;
  receipt: ReviewedPublicKnowledgePreparationReceiptV1;
};

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const MUNICIPALITY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/u;
const MAX_RECORDS = 100;

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("reviewed_source_non_finite_number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!value || typeof value !== "object") throw new Error("reviewed_source_unsupported_value");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function exactObject(value: unknown, keys: readonly string[], code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error(code);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) throw new Error(code);
  const actual = (ownKeys as string[]).sort();
  const expected = [...keys].sort();
  if (canonical(actual) !== canonical(expected)) throw new Error(code);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) throw new Error(code);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, code: string, maxBytes = 4_000): string {
  if (typeof value !== "string" || !value || value !== value.trim() ||
    Buffer.byteLength(value, "utf8") > maxBytes) throw new Error(code);
  return value;
}

function checksumValue(value: unknown, code: string): `sha256:${string}` {
  const text = stringValue(value, code, 71);
  if (!SHA256.test(text)) throw new Error(code);
  return text as `sha256:${string}`;
}

function canonicalIso(value: unknown, code: string): string {
  const text = stringValue(value, code, 32);
  const epoch = Date.parse(text);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== text) throw new Error(code);
  return text;
}

function publicHttpsUrl(value: unknown, code: string): string {
  const text = stringValue(value, code, 2_048);
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error(code);
    return url.toString();
  } catch {
    throw new Error(code);
  }
}

function sourceKind(value: unknown): ReviewedSourceKind {
  if (value !== "local_news" && value !== "ratsinformation") {
    throw new Error("reviewed_source_kind_invalid");
  }
  return value;
}

function municipality(value: unknown): string {
  const result = stringValue(value, "reviewed_source_municipality_invalid", 80);
  if (!MUNICIPALITY_ID.test(result)) throw new Error("reviewed_source_municipality_invalid");
  return result;
}

function lifecycle(value: unknown): ReviewedSourceLifecycle {
  if (value !== "current" && value !== "stale" && value !== "superseded" && value !== "withdrawn") {
    throw new Error("reviewed_source_lifecycle_invalid");
  }
  return value;
}

function parseEvidence(
  value: unknown,
  expectedMunicipality: string,
  expectedSourceKind: ReviewedSourceKind,
  generatedAt: string,
): ReviewedPublicKnowledgeEvidence {
  const commonKeys = [
    "evidenceId", "municipalityId", "sourceKind", "authority", "title", "summary",
    "publishedAt", "admissionState", "lifecycle", "reviewedAt",
  ];
  const expectedKeys = expectedSourceKind === "local_news"
    ? [...commonKeys, "publisher", "articleUrl"]
    : [...commonKeys, "body", "recordId", "recordUrl"];
  const record = exactObject(value, expectedKeys, "reviewed_source_evidence_invalid");
  const evidenceId = checksumValue(record.evidenceId, "reviewed_source_evidence_id_invalid");
  const evidenceMunicipality = municipality(record.municipalityId);
  const evidenceSourceKind = sourceKind(record.sourceKind);
  const publishedAt = canonicalIso(record.publishedAt, "reviewed_source_published_at_invalid");
  const reviewedAt = canonicalIso(record.reviewedAt, "reviewed_source_reviewed_at_invalid");
  if (evidenceMunicipality !== expectedMunicipality || evidenceSourceKind !== expectedSourceKind ||
    record.admissionState !== "admitted" || Date.parse(publishedAt) > Date.parse(reviewedAt) ||
    Date.parse(reviewedAt) > Date.parse(generatedAt)) {
    throw new Error("reviewed_source_evidence_scope_invalid");
  }
  const common = {
    evidenceId,
    municipalityId: evidenceMunicipality,
    title: stringValue(record.title, "reviewed_source_title_invalid", 300),
    summary: stringValue(record.summary, "reviewed_source_summary_invalid", 4_000),
    publishedAt,
    admissionState: "admitted" as const,
    lifecycle: lifecycle(record.lifecycle),
    reviewedAt,
  };
  if (expectedSourceKind === "local_news") {
    if (record.authority !== "editorial_report") throw new Error("reviewed_source_authority_invalid");
    return Object.freeze({
      ...common,
      sourceKind: "local_news",
      authority: "editorial_report",
      publisher: stringValue(record.publisher, "reviewed_source_publisher_invalid", 300),
      articleUrl: publicHttpsUrl(record.articleUrl, "reviewed_source_url_invalid"),
    });
  }
  if (record.authority !== "official_record") throw new Error("reviewed_source_authority_invalid");
  return Object.freeze({
    ...common,
    sourceKind: "ratsinformation",
    authority: "official_record",
    body: stringValue(record.body, "reviewed_source_body_invalid", 10_000),
    recordId: stringValue(record.recordId, "reviewed_source_record_id_invalid", 300),
    recordUrl: publicHttpsUrl(record.recordUrl, "reviewed_source_url_invalid"),
  });
}

function parseAttestationDraft(value: unknown): SourceReviewAttestationDraftV1 {
  const record = exactObject(value, [
    "schemaVersion", "municipalityId", "sourceKind", "evidenceId", "sourceCaptureSha256",
    "reviewerActorId", "actorClass", "decision", "reviewedAt", "policyVersion",
  ], "source_review_attestation_invalid");
  if (record.schemaVersion !== "source_review_attestation_v1" ||
    record.actorClass !== "source_reviewer" || record.decision !== "admit_public") {
    throw new Error("source_review_attestation_invalid");
  }
  const reviewerActorId = stringValue(record.reviewerActorId, "source_reviewer_invalid", 200);
  const policyVersion = stringValue(record.policyVersion, "source_review_policy_invalid", 100);
  if (!SAFE_ID.test(reviewerActorId) || !SAFE_ID.test(policyVersion)) {
    throw new Error("source_review_attestation_invalid");
  }
  return {
    schemaVersion: "source_review_attestation_v1",
    municipalityId: municipality(record.municipalityId),
    sourceKind: sourceKind(record.sourceKind),
    evidenceId: checksumValue(record.evidenceId, "source_review_evidence_id_invalid"),
    sourceCaptureSha256: checksumValue(record.sourceCaptureSha256, "source_capture_checksum_invalid"),
    reviewerActorId,
    actorClass: "source_reviewer",
    decision: "admit_public",
    reviewedAt: canonicalIso(record.reviewedAt, "source_review_time_invalid"),
    policyVersion,
  };
}

export function sourceReviewAttestationChecksum(
  draft: SourceReviewAttestationDraftV1,
): `sha256:${string}` {
  return sha256(parseAttestationDraft(draft));
}

function parseReview(value: unknown): SourceReviewAttestationV1 {
  const record = exactObject(value, [
    "schemaVersion", "municipalityId", "sourceKind", "evidenceId", "sourceCaptureSha256",
    "reviewerActorId", "actorClass", "decision", "reviewedAt", "policyVersion",
    "attestationChecksum",
  ], "source_review_attestation_invalid");
  const { attestationChecksum: rawChecksum, ...draft } = record;
  const parsed = parseAttestationDraft(draft);
  const attestationChecksum = checksumValue(rawChecksum, "source_review_checksum_invalid");
  if (sourceReviewAttestationChecksum(parsed) !== attestationChecksum) {
    throw new Error("source_review_checksum_mismatch");
  }
  return Object.freeze({ ...parsed, attestationChecksum });
}

export function prepareReviewedPublicKnowledgeProjection(
  input: ReviewedSourceAdmissionBatchV1,
): PreparedReviewedPublicKnowledgeProjection {
  const batch = exactObject(input, [
    "schemaVersion", "municipalityId", "sourceKind", "generatedAt", "policyVersion", "records",
  ], "reviewed_source_batch_invalid");
  if (batch.schemaVersion !== "reviewed_source_admission_batch_v1" || !Array.isArray(batch.records) ||
    batch.records.length > MAX_RECORDS) throw new Error("reviewed_source_batch_invalid");
  const municipalityId = municipality(batch.municipalityId);
  const expectedSourceKind = sourceKind(batch.sourceKind);
  const generatedAt = canonicalIso(batch.generatedAt, "reviewed_source_generated_at_invalid");
  const policyVersion = stringValue(batch.policyVersion, "source_review_policy_invalid", 100);
  if (!SAFE_ID.test(policyVersion)) throw new Error("source_review_policy_invalid");

  const seenEvidence = new Set<string>();
  const seenSourceIdentity = new Set<string>();
  const prepared = batch.records.map((value) => {
    const admission = exactObject(value, [
      "evidence", "sourceCaptureSha256", "review",
    ], "reviewed_source_admission_invalid");
    const evidence = parseEvidence(
      admission.evidence,
      municipalityId,
      expectedSourceKind,
      generatedAt,
    );
    const sourceCaptureSha256 = checksumValue(
      admission.sourceCaptureSha256,
      "source_capture_checksum_invalid",
    );
    const review = parseReview(admission.review);
    if (sourceCaptureSha256 !== evidence.evidenceId || review.sourceCaptureSha256 !== sourceCaptureSha256 ||
      review.evidenceId !== evidence.evidenceId || review.municipalityId !== municipalityId ||
      review.sourceKind !== expectedSourceKind || review.reviewedAt !== evidence.reviewedAt ||
      review.policyVersion !== policyVersion) {
      throw new Error("reviewed_source_admission_binding_invalid");
    }
    const sourceIdentity = evidence.sourceKind === "local_news"
      ? evidence.articleUrl
      : evidence.recordId;
    if (seenEvidence.has(evidence.evidenceId) || seenSourceIdentity.has(sourceIdentity)) {
      throw new Error("reviewed_source_duplicate_invalid");
    }
    seenEvidence.add(evidence.evidenceId);
    seenSourceIdentity.add(sourceIdentity);
    return Object.freeze({ evidence, sourceCaptureSha256, review });
  }).sort((left, right) => left.evidence.evidenceId.localeCompare(right.evidence.evidenceId));

  const projectionDraft = {
    schemaVersion: "reviewed_public_knowledge_projection_v1" as const,
    municipalityId,
    sourceKind: expectedSourceKind,
    generatedAt,
    records: Object.freeze(prepared.map(({ evidence }) => evidence)),
  };
  const projection = Object.freeze({
    ...projectionDraft,
    contentSha256: sha256(projectionDraft),
  });
  const receiptDraft = {
    schemaVersion: "reviewed_public_knowledge_preparation_receipt_v1" as const,
    status: "prepared_not_published" as const,
    municipalityId,
    sourceKind: expectedSourceKind,
    generatedAt,
    policyVersion,
    projectionContentSha256: projection.contentSha256,
    records: Object.freeze(prepared.map(({ evidence, sourceCaptureSha256, review }) => Object.freeze({
      evidenceId: evidence.evidenceId,
      sourceCaptureSha256,
      reviewAttestationChecksum: review.attestationChecksum,
    }))),
    authorityBinding: "none" as const,
    effects: Object.freeze({
      externalPublication: false as const,
      civicStateMutation: false as const,
      administrationWrite: false as const,
      vote: false as const,
      treasury: false as const,
    }),
  };
  return Object.freeze({
    projection,
    receipt: Object.freeze({
      ...receiptDraft,
      preparationChecksum: sha256(receiptDraft),
    }),
  });
}
