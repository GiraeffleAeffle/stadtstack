import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

export const MUNICIPAL_CONTEXT_SCHEMA_VERSION = "municipal_context_snapshot_v1" as const;
export const KAIR_SESSION_BUNDLE_SCHEMA_VERSION = "kair_session_bundle_v1" as const;
export const REVIEWED_DELIBERATION_SCHEMA_VERSION = "reviewed_deliberation_artifact_v1" as const;
export const REVIEWED_ADMINISTRATION_RETURN_SCHEMA_VERSION = "reviewed_administration_return_v1" as const;
export const MUNICIPAL_PUBLICATION_CANDIDATE_SCHEMA_VERSION = "municipal_publication_candidate_v1" as const;
export const MUNICIPAL_PUBLICATION_RECEIPT_SCHEMA_VERSION = "municipal_publication_receipt_v1" as const;
export const OFFICIAL_MUNICIPAL_PUBLICATION_SCHEMA_VERSION = "official_municipal_publication_v1" as const;
export const CIVIC_CHANGE_EVENT_SCHEMA_VERSION = "civic_change_event_v1" as const;
export const CIVIC_CHANGE_PAGE_SCHEMA_VERSION = "civic_change_page_v1" as const;
export const MUNICIPAL_CONTEXT_PROJECTION_SCHEMA_VERSION = "municipal_civic_context_projection_v1" as const;
export const STRICT_OPARL_PROJECTION_SCHEMA_VERSION = "strict_oparl_projection_v1" as const;
export const MCP_CIVIC_CONTEXT_PAGE_SCHEMA_VERSION = "mcp_civic_context_page_v1" as const;

export type Sha256 = `sha256:${string}`;
export type ConsentPurpose = "publicSafeReview" | "caseCitation";
export type CorrectionState = "current" | "withdrawn" | "superseded";
export type PublicArtifactKind =
  | "reviewed_deliberation_artifact"
  | "reviewed_administration_return"
  | "municipal_publication_candidate"
  | "official_municipal_publication"
  | "correction";

export type MunicipalSourceRecordV1 = Readonly<{
  recordId: string;
  sourceSystem: string;
  sourceRecordId: string;
  recordKind: "paper" | "meeting" | "agenda_item" | "consultation" | "file";
  publisher: string;
  publicationState: "official_public" | "public_non_official";
  authorityCeiling: "official_publication" | "public_information";
  sourceVersion: string;
  contentSha256: Sha256;
}>;

export type MunicipalContextSnapshotV1 = Readonly<{
  schemaVersion: typeof MUNICIPAL_CONTEXT_SCHEMA_VERSION;
  snapshotId: string;
  municipalityId: string;
  version: number;
  generatedAtUtc: string;
  sourceRecords: readonly MunicipalSourceRecordV1[];
  contentSha256: Sha256;
}>;

export type KairSessionBundleV1 = Readonly<{
  schemaVersion: typeof KAIR_SESSION_BUNDLE_SCHEMA_VERSION;
  bundleId: string;
  municipalityId: string;
  sourceContentSha256: Sha256;
  sessionStartedAtUtc: string;
  sessionEndedAtUtc: string;
  contextReferences: readonly Readonly<{
    snapshotId: string;
    version: number;
    contentSha256: Sha256;
  }>[];
  consent: Readonly<{
    receiptSha256: Sha256;
    purposes: readonly ConsentPurpose[];
    expiresAtUtc: string;
    revoked: boolean;
  }>;
  adapter: Readonly<{ version: string; provenanceOwner: string }>;
  redactionProfile: string;
  privateContentReferences: readonly string[];
  eligibilityState: "pending_review";
  capturedAtUtc: string;
  bundleSha256: Sha256;
}>;

export type PublicSafePayloadV1 = Readonly<{
  title: string;
  summary: string;
  citations: readonly string[];
}>;

export type ReviewedDeliberationArtifactV1 = Readonly<{
  schemaVersion: typeof REVIEWED_DELIBERATION_SCHEMA_VERSION;
  artifactId: string;
  municipalityId: string;
  contextReferences: KairSessionBundleV1["contextReferences"];
  publicPayload: PublicSafePayloadV1;
  publicPayloadSha256: Sha256;
  review: Readonly<{ policyId: string; reviewerId: string; reviewedAtUtc: string }>;
  correctionState: "current";
  authorityState: "reviewed_non_official";
  artifactSha256: Sha256;
}>;

export type ReviewedAdministrationReturnV1 = Readonly<{
  schemaVersion: typeof REVIEWED_ADMINISTRATION_RETURN_SCHEMA_VERSION;
  artifactId: string;
  municipalityId: string;
  canonicalCaseId: string;
  sourceSystem: "openDesk";
  requestId: string;
  responseId: string;
  responseSha256: Sha256;
  reviewAttestationSha256: Sha256;
  publicPayload: PublicSafePayloadV1;
  publicPayloadSha256: Sha256;
  reviewedAtUtc: string;
  correctionState: "current";
  authorityState: "reviewed_non_official";
  artifactSha256: Sha256;
}>;

export type MunicipalPublicationCandidateV1 = Readonly<{
  schemaVersion: typeof MUNICIPAL_PUBLICATION_CANDIDATE_SCHEMA_VERSION;
  candidateId: string;
  municipalityId: string;
  sourceArtifactId: string;
  sourceArtifactSha256: Sha256;
  version: number;
  proposedPublisher: string;
  proposedOfficialKind: "Paper" | "Meeting" | "AgendaItem" | "Consultation" | "File";
  visibility: "public";
  correctionOf: string | null;
  publicPayload: PublicSafePayloadV1;
  publicPayloadSha256: Sha256;
  institutionalEffect: "none";
  candidateSha256: Sha256;
}>;

export type MunicipalPublicationAuthorizationV1 = Readonly<{
  schemaVersion: "municipal_publication_authorization_v1";
  municipalityId: string;
  policyId: string;
  principalId: string;
  endpointId: string;
  allowedOfficialKinds: readonly MunicipalPublicationCandidateV1["proposedOfficialKind"][];
  validFromUtc: string;
  validUntilUtc: string;
  authorizationSha256: Sha256;
}>;

export type MunicipalPublicationReceiptV1 = Readonly<{
  schemaVersion: typeof MUNICIPAL_PUBLICATION_RECEIPT_SCHEMA_VERSION;
  receiptId: string;
  candidateId: string;
  candidateSha256: Sha256;
  candidateVersion: number;
  municipalityId: string;
  policyId: string;
  principalId: string;
  endpointId: string;
  authorizationSha256: Sha256;
  officialId: string;
  officialKind: MunicipalPublicationCandidateV1["proposedOfficialKind"];
  publicationState: "published";
  publishedAtUtc: string;
  institutionalEffectCeiling: "official_publication";
  receiptSha256: Sha256;
}>;

export type OfficialMunicipalPublicationV1 = Readonly<{
  schemaVersion: typeof OFFICIAL_MUNICIPAL_PUBLICATION_SCHEMA_VERSION;
  officialId: string;
  municipalityId: string;
  officialKind: MunicipalPublicationCandidateV1["proposedOfficialKind"];
  candidateId: string;
  candidateSha256: Sha256;
  receiptId: string;
  receiptSha256: Sha256;
  publicPayload: PublicSafePayloadV1;
  publicPayloadSha256: Sha256;
  version: number;
  publicationState: "published";
  institutionalEffectCeiling: "official_publication";
  publishedAtUtc: string;
  publicationSha256: Sha256;
}>;

export type CivicChangeEventV1 = Readonly<{
  schemaVersion: typeof CIVIC_CHANGE_EVENT_SCHEMA_VERSION;
  changeId: string;
  cursor: string;
  artifact: Readonly<{ kind: PublicArtifactKind; id: string }>;
  projectionVersion: number;
  projectionSha256: Sha256;
  correctionState: CorrectionState;
  changedAtUtc: string;
  eventSha256: Sha256;
}>;

export type CivicChangePageV1 = Readonly<{
  schemaVersion: typeof CIVIC_CHANGE_PAGE_SCHEMA_VERSION;
  projectionVersion: number;
  projectionSha256: Sha256;
  events: readonly CivicChangeEventV1[];
  nextCursor: string | null;
  pageSha256: Sha256;
}>;

export type MunicipalContextProjectionV1 = Readonly<{
  schemaVersion: typeof MUNICIPAL_CONTEXT_PROJECTION_SCHEMA_VERSION;
  version: number;
  contentSha256: Sha256;
  records: readonly Readonly<{ kind: PublicArtifactKind; id: string; value: unknown }>[];
}>;

export type OparlPaperV1 = Readonly<{
  id: string;
  type: "https://schema.oparl.org/1.1/Paper";
  body: string;
  name: string;
  reference: string;
  publicationDate: string;
  lastModified: string;
  files: readonly unknown[];
}>;

export type StrictOparlProjectionV1 = Readonly<{
  schemaVersion: typeof STRICT_OPARL_PROJECTION_SCHEMA_VERSION;
  version: number;
  contentSha256: Sha256;
  papers: readonly OparlPaperV1[];
}>;

export type McpCivicContextAdapter = Readonly<{
  listChanges(cursor: string | null, limit: number): Readonly<{
    schemaVersion: typeof MCP_CIVIC_CONTEXT_PAGE_SCHEMA_VERSION;
    projectionVersion: number;
    projectionSha256: Sha256;
    page: CivicChangePageV1;
    readOnly: true;
    authority: "none";
  }>;
  readBroadProjection(): MunicipalContextProjectionV1;
  readStrictOparlProjection(): StrictOparlProjectionV1;
}>;

export type CivicContextReferenceConsumerReceiptV1 = Readonly<{
  schemaVersion: "municipal_context_reference_consumer_receipt_v1";
  projectionVersion: number;
  projectionSha256: Sha256;
  pageSha256: Sha256;
  acceptedEventCount: number;
  restMcpEquivalent: true;
  authority: "none";
  receiptSha256: Sha256;
}>;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const MUNICIPALITY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const CASE_ID = /^urn:stadtstack:case:municipality:([a-z0-9]+(?:-[a-z0-9]+)*):[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PRIVATE_REFERENCE = /^private:\/\/[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const MAX_CONTEXT_RECORDS = 100;
const MAX_CHANGES = 10_000;
const MAX_PAGE = 100;
const SUPPORTED_OPARL_KINDS: Partial<Record<MunicipalPublicationCandidateV1["proposedOfficialKind"], true>> = {
  Paper: true,
};

function fail(code: string): never { throw new Error(code); }

function canonical(value: unknown): string {
  const walk = (input: unknown): unknown => {
    if (input === null || typeof input === "string" || typeof input === "boolean") return input;
    if (typeof input === "number") {
      if (!Number.isSafeInteger(input)) fail("municipal_context_number_invalid");
      return input;
    }
    if (Array.isArray(input)) return input.map(walk);
    if (typeof input !== "object" || utilTypes.isProxy(input)) fail("municipal_context_value_invalid");
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) fail("municipal_context_value_invalid");
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input as Record<string, unknown>).sort()) {
      const child = (input as Record<string, unknown>)[key];
      if (child === undefined) fail("municipal_context_value_invalid");
      output[key] = walk(child);
    }
    return output;
  };
  return JSON.stringify(walk(value));
}

function sha256(value: unknown): Sha256 {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as Readonly<T>;
}

function exact(value: unknown, keys: readonly string[], code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value)) fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(code);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join("\0") !== [...keys].sort().join("\0")) fail(code);
  return record;
}

function array(value: unknown, max: number, code: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(code);
  return value;
}

function text(value: unknown, code: string, max = 4_000): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > max || value.trim() !== value) fail(code);
  return value;
}

function id(value: unknown, code: string): string {
  const parsed = text(value, code, 256);
  if (!SAFE_ID.test(parsed)) fail(code);
  return parsed;
}

function municipality(value: unknown, code: string): string {
  const parsed = text(value, code, 100);
  if (!MUNICIPALITY.test(parsed)) fail(code);
  return parsed;
}

function checksum(value: unknown, code: string): Sha256 {
  if (typeof value !== "string" || !SHA256.test(value)) fail(code);
  return value as Sha256;
}

function iso(value: unknown, code: string): string {
  const parsed = text(value, code, 40);
  const date = new Date(parsed);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== parsed) fail(code);
  return parsed;
}

function positiveInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) fail(code);
  return value as number;
}

function payload(value: unknown, code: string): PublicSafePayloadV1 {
  const record = exact(value, ["title", "summary", "citations"], code);
  const citations = array(record.citations, 50, code).map((citation) => {
    const parsed = text(citation, code, 2_000);
    let url: URL;
    try { url = new URL(parsed); } catch { fail(code); }
    if (url.protocol !== "https:" || url.username || url.password || url.hash) fail(code);
    return parsed;
  });
  return deepFreeze({ title: text(record.title, code, 500), summary: text(record.summary, code, 8_000), citations });
}

function sourceRecord(value: unknown): MunicipalSourceRecordV1 {
  const code = "municipal_context_source_invalid";
  const record = exact(value, ["recordId", "sourceSystem", "sourceRecordId", "recordKind", "publisher", "publicationState", "authorityCeiling", "sourceVersion", "contentSha256"], code);
  const recordKind = text(record.recordKind, code) as MunicipalSourceRecordV1["recordKind"];
  if (!["paper", "meeting", "agenda_item", "consultation", "file"].includes(recordKind)) fail(code);
  const publicationState = text(record.publicationState, code) as MunicipalSourceRecordV1["publicationState"];
  const authorityCeiling = text(record.authorityCeiling, code) as MunicipalSourceRecordV1["authorityCeiling"];
  if (!["official_public", "public_non_official"].includes(publicationState) || !["official_publication", "public_information"].includes(authorityCeiling)) fail(code);
  if ((publicationState === "official_public") !== (authorityCeiling === "official_publication")) fail(code);
  return deepFreeze({
    recordId: id(record.recordId, code), sourceSystem: id(record.sourceSystem, code), sourceRecordId: id(record.sourceRecordId, code),
    recordKind, publisher: text(record.publisher, code, 500), publicationState, authorityCeiling,
    sourceVersion: id(record.sourceVersion, code), contentSha256: checksum(record.contentSha256, code),
  });
}

export function municipalContextSnapshotChecksum(value: Omit<MunicipalContextSnapshotV1, "contentSha256">): Sha256 {
  const parsed = parseMunicipalContextSnapshot({ ...value, contentSha256: `sha256:${"0".repeat(64)}` }, false);
  const unsigned = { ...parsed, contentSha256: undefined } as unknown as Record<string, unknown>;
  delete unsigned.contentSha256;
  return sha256(unsigned);
}

function parseMunicipalContextSnapshot(value: unknown, verifyChecksum = true): MunicipalContextSnapshotV1 {
  const code = "municipal_context_snapshot_invalid";
  const record = exact(value, ["schemaVersion", "snapshotId", "municipalityId", "version", "generatedAtUtc", "sourceRecords", "contentSha256"], code);
  if (record.schemaVersion !== MUNICIPAL_CONTEXT_SCHEMA_VERSION) fail(code);
  const sourceRecords = array(record.sourceRecords, MAX_CONTEXT_RECORDS, code).map(sourceRecord);
  if (sourceRecords.length === 0 || new Set(sourceRecords.map((item) => item.recordId)).size !== sourceRecords.length) fail(code);
  const parsed = {
    schemaVersion: MUNICIPAL_CONTEXT_SCHEMA_VERSION, snapshotId: id(record.snapshotId, code), municipalityId: municipality(record.municipalityId, code),
    version: positiveInteger(record.version, code), generatedAtUtc: iso(record.generatedAtUtc, code), sourceRecords, contentSha256: checksum(record.contentSha256, code),
  } as const;
  const unsigned = { ...parsed, contentSha256: undefined } as unknown as Record<string, unknown>;
  delete unsigned.contentSha256;
  if (verifyChecksum && parsed.contentSha256 !== sha256(unsigned)) fail("municipal_context_snapshot_checksum_invalid");
  return deepFreeze(parsed);
}

function parseContextReference(value: unknown): KairSessionBundleV1["contextReferences"][number] {
  const code = "kair_session_context_reference_invalid";
  const record = exact(value, ["snapshotId", "version", "contentSha256"], code);
  return deepFreeze({ snapshotId: id(record.snapshotId, code), version: positiveInteger(record.version, code), contentSha256: checksum(record.contentSha256, code) });
}

function parseBundle(value: unknown, verifyChecksum = true): KairSessionBundleV1 {
  const code = "kair_session_bundle_invalid";
  const record = exact(value, ["schemaVersion", "bundleId", "municipalityId", "sourceContentSha256", "sessionStartedAtUtc", "sessionEndedAtUtc", "contextReferences", "consent", "adapter", "redactionProfile", "privateContentReferences", "eligibilityState", "capturedAtUtc", "bundleSha256"], code);
  if (record.schemaVersion !== KAIR_SESSION_BUNDLE_SCHEMA_VERSION || record.eligibilityState !== "pending_review") fail(code);
  const started = iso(record.sessionStartedAtUtc, code); const ended = iso(record.sessionEndedAtUtc, code);
  if (ended <= started) fail(code);
  const contextReferences = array(record.contextReferences, 20, code).map(parseContextReference);
  if (contextReferences.length === 0 || new Set(contextReferences.map((item) => item.snapshotId)).size !== contextReferences.length) fail(code);
  const consentRecord = exact(record.consent, ["receiptSha256", "purposes", "expiresAtUtc", "revoked"], code);
  const purposes = array(consentRecord.purposes, 2, code).map((purpose) => text(purpose, code) as ConsentPurpose);
  if (purposes.length === 0 || new Set(purposes).size !== purposes.length || !purposes.every((purpose) => purpose === "publicSafeReview" || purpose === "caseCitation")) fail(code);
  const adapterRecord = exact(record.adapter, ["version", "provenanceOwner"], code);
  const privateContentReferences = array(record.privateContentReferences, 100, code).map((reference) => {
    const parsed = text(reference, code, 512); if (!PRIVATE_REFERENCE.test(parsed)) fail(code); return parsed;
  });
  const parsed = {
    schemaVersion: KAIR_SESSION_BUNDLE_SCHEMA_VERSION, bundleId: id(record.bundleId, code), municipalityId: municipality(record.municipalityId, code),
    sourceContentSha256: checksum(record.sourceContentSha256, code), sessionStartedAtUtc: started, sessionEndedAtUtc: ended, contextReferences,
    consent: { receiptSha256: checksum(consentRecord.receiptSha256, code), purposes: [...purposes].sort() as ConsentPurpose[], expiresAtUtc: iso(consentRecord.expiresAtUtc, code), revoked: consentRecord.revoked === true },
    adapter: { version: id(adapterRecord.version, code), provenanceOwner: id(adapterRecord.provenanceOwner, code) },
    redactionProfile: id(record.redactionProfile, code), privateContentReferences, eligibilityState: "pending_review" as const,
    capturedAtUtc: iso(record.capturedAtUtc, code), bundleSha256: checksum(record.bundleSha256, code),
  };
  if (consentRecord.revoked !== false) fail("kair_session_consent_revoked");
  const unsigned = { ...parsed, bundleSha256: undefined } as unknown as Record<string, unknown>; delete unsigned.bundleSha256;
  if (verifyChecksum && parsed.bundleSha256 !== sha256(unsigned)) fail("kair_session_bundle_checksum_invalid");
  return deepFreeze(parsed);
}

export function kairSessionBundleChecksum(value: Omit<KairSessionBundleV1, "bundleSha256">): Sha256 {
  const parsed = parseBundle({ ...value, bundleSha256: `sha256:${"0".repeat(64)}` }, false);
  const unsigned = { ...parsed, bundleSha256: undefined } as unknown as Record<string, unknown>;
  delete unsigned.bundleSha256;
  return sha256(unsigned);
}

function reviewCommand(value: unknown): Readonly<{ bundleId: string; bundleSha256: Sha256; artifactId: string; policyId: string; reviewerId: string; reviewedAtUtc: string; publicPayload: PublicSafePayloadV1; publicPayloadSha256: Sha256 }> {
  const code = "kair_session_review_invalid";
  const record = exact(value, ["bundleId", "bundleSha256", "artifactId", "policyId", "reviewerId", "reviewedAtUtc", "publicPayload", "publicPayloadSha256"], code);
  const publicPayload = payload(record.publicPayload, code); const publicPayloadSha256 = checksum(record.publicPayloadSha256, code);
  if (publicPayloadSha256 !== sha256(publicPayload) || canonical(publicPayload).includes("private://")) fail(code);
  return deepFreeze({ bundleId: id(record.bundleId, code), bundleSha256: checksum(record.bundleSha256, code), artifactId: id(record.artifactId, code), policyId: id(record.policyId, code), reviewerId: id(record.reviewerId, code), reviewedAtUtc: iso(record.reviewedAtUtc, code), publicPayload, publicPayloadSha256 });
}

export function publicSafePayloadChecksum(value: PublicSafePayloadV1): Sha256 { return sha256(payload(value, "public_safe_payload_invalid")); }

export function municipalPublicationAuthorizationChecksum(value: Omit<MunicipalPublicationAuthorizationV1, "authorizationSha256">): Sha256 {
  const parsed = parseAuthorization({ ...value, authorizationSha256: `sha256:${"0".repeat(64)}` }, false);
  const unsigned = { ...parsed, authorizationSha256: undefined } as unknown as Record<string, unknown>;
  delete unsigned.authorizationSha256;
  return sha256(unsigned);
}

function parseAuthorization(value: unknown, verifyChecksum = true): MunicipalPublicationAuthorizationV1 {
  const code = "municipal_publication_authorization_invalid";
  const record = exact(value, ["schemaVersion", "municipalityId", "policyId", "principalId", "endpointId", "allowedOfficialKinds", "validFromUtc", "validUntilUtc", "authorizationSha256"], code);
  if (record.schemaVersion !== "municipal_publication_authorization_v1") fail(code);
  const allowedOfficialKinds = array(record.allowedOfficialKinds, Object.keys(SUPPORTED_OPARL_KINDS).length, code).map((kind) => text(kind, code) as MunicipalPublicationCandidateV1["proposedOfficialKind"]);
  if (allowedOfficialKinds.length === 0 || new Set(allowedOfficialKinds).size !== allowedOfficialKinds.length || !allowedOfficialKinds.every((kind) => SUPPORTED_OPARL_KINDS[kind] === true)) fail(code);
  const parsed = { schemaVersion: "municipal_publication_authorization_v1" as const, municipalityId: municipality(record.municipalityId, code), policyId: id(record.policyId, code), principalId: id(record.principalId, code), endpointId: id(record.endpointId, code), allowedOfficialKinds: [...allowedOfficialKinds].sort(), validFromUtc: iso(record.validFromUtc, code), validUntilUtc: iso(record.validUntilUtc, code), authorizationSha256: checksum(record.authorizationSha256, code) };
  if (parsed.validUntilUtc <= parsed.validFromUtc) fail(code);
  const unsigned = { ...parsed, authorizationSha256: undefined } as unknown as Record<string, unknown>; delete unsigned.authorizationSha256;
  if (verifyChecksum && parsed.authorizationSha256 !== sha256(unsigned)) fail("municipal_publication_authorization_checksum_invalid");
  return deepFreeze(parsed);
}

function adminReturn(value: unknown): ReviewedAdministrationReturnV1 {
  const code = "reviewed_administration_return_invalid";
  const record = exact(value, ["schemaVersion", "artifactId", "municipalityId", "canonicalCaseId", "sourceSystem", "requestId", "responseId", "responseSha256", "reviewAttestationSha256", "publicPayload", "publicPayloadSha256", "reviewedAtUtc", "correctionState", "authorityState", "artifactSha256"], code);
  if (record.schemaVersion !== REVIEWED_ADMINISTRATION_RETURN_SCHEMA_VERSION || record.sourceSystem !== "openDesk" || record.correctionState !== "current" || record.authorityState !== "reviewed_non_official") fail(code);
  const municipalityId = municipality(record.municipalityId, code); const canonicalCaseId = id(record.canonicalCaseId, code);
  if (CASE_ID.exec(canonicalCaseId)?.[1] !== municipalityId) fail(code);
  const publicPayload = payload(record.publicPayload, code); const publicPayloadSha256 = checksum(record.publicPayloadSha256, code);
  if (publicPayloadSha256 !== sha256(publicPayload)) fail(code);
  const parsed = { schemaVersion: REVIEWED_ADMINISTRATION_RETURN_SCHEMA_VERSION, artifactId: id(record.artifactId, code), municipalityId, canonicalCaseId, sourceSystem: "openDesk" as const, requestId: id(record.requestId, code), responseId: id(record.responseId, code), responseSha256: checksum(record.responseSha256, code), reviewAttestationSha256: checksum(record.reviewAttestationSha256, code), publicPayload, publicPayloadSha256, reviewedAtUtc: iso(record.reviewedAtUtc, code), correctionState: "current" as const, authorityState: "reviewed_non_official" as const, artifactSha256: checksum(record.artifactSha256, code) };
  const unsigned = { ...parsed, artifactSha256: undefined } as unknown as Record<string, unknown>; delete unsigned.artifactSha256;
  if (parsed.artifactSha256 !== sha256(unsigned)) fail("reviewed_administration_return_checksum_invalid");
  return deepFreeze(parsed);
}

export function reviewedAdministrationReturnChecksum(value: Omit<ReviewedAdministrationReturnV1, "artifactSha256">): Sha256 {
  const parsed = { ...value, artifactSha256: `sha256:${"0".repeat(64)}` };
  const record = { ...adminReturn({ ...parsed, artifactSha256: sha256(value) }), artifactSha256: undefined } as unknown as Record<string, unknown>;
  delete record.artifactSha256;
  return sha256(record);
}

type PublicRecord = Readonly<{ kind: PublicArtifactKind; id: string; value: unknown }>;
type ReviewedSource = ReviewedDeliberationArtifactV1 | ReviewedAdministrationReturnV1;

export class MunicipalContextExchange {
  readonly #contexts = new Map<string, MunicipalContextSnapshotV1>();
  readonly #bundles = new Map<string, KairSessionBundleV1>();
  readonly #reviews = new Map<string, ReviewedDeliberationArtifactV1>();
  readonly #administrationReturns = new Map<string, ReviewedAdministrationReturnV1>();
  readonly #reviewBundleIds = new Map<string, string>();
  readonly #candidates = new Map<string, MunicipalPublicationCandidateV1>();
  readonly #publicationAuthorizations = new Map<Sha256, MunicipalPublicationAuthorizationV1>();
  readonly #receipts = new Map<string, MunicipalPublicationReceiptV1>();
  readonly #official = new Map<string, OfficialMunicipalPublicationV1>();
  readonly #records: PublicRecord[] = [];
  readonly #changes: CivicChangeEventV1[] = [];
  readonly #cursorIndex = new Map<string, number>();
  readonly #withdrawn = new Set<string>();
  #projectionVersion = 0;
  #projectionSha256: Sha256 = sha256({ schemaVersion: MUNICIPAL_CONTEXT_PROJECTION_SCHEMA_VERSION, version: 0, records: [] });
  constructor(publicationAuthorizations: readonly unknown[] = []) {
    for (const value of array(publicationAuthorizations, 100, "municipal_publication_authority_config_invalid")) {
      const authorization = parseAuthorization(value);
      const existing = this.#publicationAuthorizations.get(authorization.authorizationSha256);
      if (existing && canonical(existing) !== canonical(authorization)) fail("municipal_publication_authority_config_conflict");
      this.#publicationAuthorizations.set(authorization.authorizationSha256, authorization);
    }
  }


  registerContext(value: unknown): MunicipalContextSnapshotV1 {
    const parsed = parseMunicipalContextSnapshot(value); const existing = this.#contexts.get(parsed.snapshotId);
    if (existing) { if (canonical(existing) !== canonical(parsed)) fail("municipal_context_snapshot_conflict"); return existing; }
    this.#contexts.set(parsed.snapshotId, parsed); return parsed;
  }

  intakeSession(value: unknown, nowUtc: string): KairSessionBundleV1 {
    const parsed = parseBundle(value); const now = iso(nowUtc, "kair_session_clock_invalid");
    if (parsed.consent.expiresAtUtc < now) fail("kair_session_consent_expired");
    for (const reference of parsed.contextReferences) {
      const context = this.#contexts.get(reference.snapshotId);
      if (!context || context.municipalityId !== parsed.municipalityId || context.version !== reference.version || context.contentSha256 !== reference.contentSha256) fail("kair_session_context_binding_invalid");
    }
    const existing = this.#bundles.get(parsed.bundleId);
    if (existing) { if (canonical(existing) !== canonical(parsed)) fail("kair_session_bundle_conflict"); return existing; }
    this.#bundles.set(parsed.bundleId, parsed); return parsed;
  }

  reviewSession(value: unknown): ReviewedDeliberationArtifactV1 {
    const command = reviewCommand(value); const bundle = this.#bundles.get(command.bundleId);
    if (!bundle || bundle.bundleSha256 !== command.bundleSha256 || !bundle.consent.purposes.includes("publicSafeReview") || bundle.consent.revoked || bundle.consent.expiresAtUtc < command.reviewedAtUtc) fail("kair_session_review_not_eligible");
    const unsigned = { schemaVersion: REVIEWED_DELIBERATION_SCHEMA_VERSION, artifactId: command.artifactId, municipalityId: bundle.municipalityId, contextReferences: bundle.contextReferences, publicPayload: command.publicPayload, publicPayloadSha256: command.publicPayloadSha256, review: { policyId: command.policyId, reviewerId: command.reviewerId, reviewedAtUtc: command.reviewedAtUtc }, correctionState: "current" as const, authorityState: "reviewed_non_official" as const };
    const artifact = deepFreeze({ ...unsigned, artifactSha256: sha256(unsigned) });
    const existing = this.#reviews.get(artifact.artifactId);
    if (existing) {
      if (canonical(existing) !== canonical(artifact) || this.#reviewBundleIds.get(artifact.artifactId) !== bundle.bundleId) fail("kair_session_review_conflict");
      return existing;
    }
    this.#reviews.set(artifact.artifactId, artifact);
    this.#reviewBundleIds.set(artifact.artifactId, bundle.bundleId);
    this.#appendRecord("reviewed_deliberation_artifact", artifact.artifactId, artifact, "current", artifact.review.reviewedAtUtc);
    return artifact;
  }

  createCaseCitation(value: unknown): Readonly<{ schemaVersion: "reviewed_deliberation_case_citation_v1"; artifactId: string; canonicalCaseId: string; municipalityId: string; citedAtUtc: string; citationSha256: Sha256 }> {
    const code = "kair_session_case_citation_invalid";
    const record = exact(value, ["bundleId", "bundleSha256", "artifactId", "canonicalCaseId", "citedAtUtc"], code);
    const bundle = this.#bundles.get(id(record.bundleId, code));
    const artifact = this.#reviews.get(id(record.artifactId, code));
    const citedAtUtc = iso(record.citedAtUtc, code);
    if (!bundle || !artifact || this.#reviewBundleIds.get(artifact.artifactId) !== bundle.bundleId || bundle.bundleSha256 !== checksum(record.bundleSha256, code) || !bundle.consent.purposes.includes("caseCitation") || bundle.consent.expiresAtUtc < citedAtUtc || this.#withdrawn.has(artifact.artifactId)) fail("kair_session_case_citation_forbidden");
    const canonicalCaseId = id(record.canonicalCaseId, code); if (CASE_ID.exec(canonicalCaseId)?.[1] !== bundle.municipalityId) fail(code);
    const citationUnsigned = { schemaVersion: "reviewed_deliberation_case_citation_v1" as const, artifactId: artifact.artifactId, canonicalCaseId, municipalityId: bundle.municipalityId, citedAtUtc };
    return deepFreeze({ ...citationUnsigned, citationSha256: sha256(citationUnsigned) });
  }

  withdrawReviewedArtifact(value: unknown): Readonly<{ schemaVersion: "public_artifact_withdrawal_v1"; correctionId: string; artifactId: string; artifactSha256: Sha256; reasonCode: string; withdrawnAtUtc: string; correctionSha256: Sha256 }> {
    const code = "public_artifact_withdrawal_invalid"; const record = exact(value, ["artifactId", "artifactSha256", "reasonCode", "withdrawnAtUtc"], code);
    const artifactId = id(record.artifactId, code); const artifact = this.#reviewedSource(artifactId);
    if (artifact.artifactSha256 !== checksum(record.artifactSha256, code)) fail(code);
    const correctionId = `urn:stadtstack:correction:${sha256({ artifactId, artifactSha256: artifact.artifactSha256, reasonCode: record.reasonCode, withdrawnAtUtc: record.withdrawnAtUtc }).slice(7)}`;
    const unsigned = { schemaVersion: "public_artifact_withdrawal_v1" as const, correctionId, artifactId, artifactSha256: artifact.artifactSha256, reasonCode: id(record.reasonCode, code), withdrawnAtUtc: iso(record.withdrawnAtUtc, code) };
    const correction = deepFreeze({ ...unsigned, correctionSha256: sha256(unsigned) });
    if (this.#withdrawn.has(artifactId)) {
      const existing = this.#records.find((item) => item.id === correctionId)?.value;
      if (!existing || canonical(existing) !== canonical(correction)) fail("public_artifact_withdrawal_conflict");
      return existing as typeof correction;
    }
    this.#withdrawn.add(artifactId); this.#appendRecord("correction", correctionId, correction, "withdrawn", correction.withdrawnAtUtc); return correction;
  }

  admitReviewedAdministrationReturn(value: unknown): ReviewedAdministrationReturnV1 {
    const parsed = adminReturn(value); const existing = this.#administrationReturns.get(parsed.artifactId);
    if (existing) { if (canonical(existing) !== canonical(parsed)) fail("reviewed_administration_return_conflict"); return existing; }
    this.#administrationReturns.set(parsed.artifactId, parsed); this.#appendRecord("reviewed_administration_return", parsed.artifactId, parsed, "current", parsed.reviewedAtUtc); return parsed;
  }

  preparePublicationCandidate(value: unknown): MunicipalPublicationCandidateV1 {
    const code = "municipal_publication_candidate_invalid";
    const record = exact(value, ["candidateId", "sourceArtifactId", "sourceArtifactSha256", "version", "proposedPublisher", "proposedOfficialKind", "visibility", "correctionOf"], code);
    const source = this.#reviewedSource(id(record.sourceArtifactId, code));
    if (this.#withdrawn.has(source.artifactId) || source.artifactSha256 !== checksum(record.sourceArtifactSha256, code)) fail("municipal_publication_source_not_eligible");
    const proposedOfficialKind = text(record.proposedOfficialKind, code) as MunicipalPublicationCandidateV1["proposedOfficialKind"];
    const proposedPublisher = id(record.proposedPublisher, code);
    if (SUPPORTED_OPARL_KINDS[proposedOfficialKind] !== true || proposedPublisher !== source.municipalityId || record.visibility !== "public" || (record.correctionOf !== null && typeof record.correctionOf !== "string")) fail(code);
    const unsigned = { schemaVersion: MUNICIPAL_PUBLICATION_CANDIDATE_SCHEMA_VERSION, candidateId: id(record.candidateId, code), municipalityId: source.municipalityId, sourceArtifactId: source.artifactId, sourceArtifactSha256: source.artifactSha256, version: positiveInteger(record.version, code), proposedPublisher, proposedOfficialKind, visibility: "public" as const, correctionOf: record.correctionOf === null ? null : id(record.correctionOf, code), publicPayload: source.publicPayload, publicPayloadSha256: source.publicPayloadSha256, institutionalEffect: "none" as const };
    const candidate = deepFreeze({ ...unsigned, candidateSha256: sha256(unsigned) }); const existing = this.#candidates.get(candidate.candidateId);
    if (existing) { if (canonical(existing) !== canonical(candidate)) fail("municipal_publication_candidate_conflict"); return existing; }
    this.#candidates.set(candidate.candidateId, candidate); this.#appendRecord("municipal_publication_candidate", candidate.candidateId, candidate, "current", source.schemaVersion === REVIEWED_DELIBERATION_SCHEMA_VERSION ? source.review.reviewedAtUtc : source.reviewedAtUtc); return candidate;
  }

  publishCandidate(value: unknown): Readonly<{ receipt: MunicipalPublicationReceiptV1; publication: OfficialMunicipalPublicationV1 }> {
    const code = "municipal_publication_action_invalid";
    const record = exact(value, ["candidateId", "candidateSha256", "authorization", "officialId", "publishedAtUtc"], code);
    const candidate = this.#candidates.get(id(record.candidateId, code)); if (!candidate || candidate.candidateSha256 !== checksum(record.candidateSha256, code)) fail(code);
    const authorization = parseAuthorization(record.authorization);
    const publishedAtUtc = iso(record.publishedAtUtc, code);
    const officialId = id(record.officialId, code);
    if (authorization.municipalityId !== candidate.municipalityId || authorization.validFromUtc > publishedAtUtc || authorization.validUntilUtc < publishedAtUtc || !authorization.allowedOfficialKinds.includes(candidate.proposedOfficialKind)) fail("municipal_publication_authority_forbidden");
    const prior = this.#receipts.get(candidate.candidateId);
    const trustedAuthorization = this.#publicationAuthorizations.get(authorization.authorizationSha256);
    if (!trustedAuthorization || canonical(trustedAuthorization) !== canonical(authorization)) fail("municipal_publication_authority_forbidden");
    if (prior) {
      const publication = this.#official.get(prior.officialId); if (!publication) fail("municipal_publication_state_invalid");
      if (candidate.candidateSha256 !== prior.candidateSha256 || candidate.version !== prior.candidateVersion || authorization.authorizationSha256 !== prior.authorizationSha256 || officialId !== publication.officialId || publishedAtUtc !== publication.publishedAtUtc) fail("municipal_publication_action_conflict");
      return deepFreeze({ receipt: prior, publication });
    }
    if (this.#withdrawn.has(candidate.sourceArtifactId)) fail("municipal_publication_source_not_eligible");
    if (this.#official.has(officialId)) fail("municipal_publication_official_id_conflict");
    const receiptUnsigned = { schemaVersion: MUNICIPAL_PUBLICATION_RECEIPT_SCHEMA_VERSION, receiptId: `urn:stadtstack:municipal-publication-receipt:${sha256({ candidateId: candidate.candidateId, candidateSha256: candidate.candidateSha256, officialId, publishedAtUtc }).slice(7)}`, candidateId: candidate.candidateId, candidateSha256: candidate.candidateSha256, candidateVersion: candidate.version, municipalityId: candidate.municipalityId, policyId: authorization.policyId, principalId: authorization.principalId, endpointId: authorization.endpointId, authorizationSha256: authorization.authorizationSha256, officialId, officialKind: candidate.proposedOfficialKind, publicationState: "published" as const, publishedAtUtc, institutionalEffectCeiling: "official_publication" as const };
    const receipt = deepFreeze({ ...receiptUnsigned, receiptSha256: sha256(receiptUnsigned) });
    const publicationUnsigned = { schemaVersion: OFFICIAL_MUNICIPAL_PUBLICATION_SCHEMA_VERSION, officialId, municipalityId: candidate.municipalityId, officialKind: candidate.proposedOfficialKind, candidateId: candidate.candidateId, candidateSha256: candidate.candidateSha256, receiptId: receipt.receiptId, receiptSha256: receipt.receiptSha256, publicPayload: candidate.publicPayload, publicPayloadSha256: candidate.publicPayloadSha256, version: candidate.version, publicationState: "published" as const, institutionalEffectCeiling: "official_publication" as const, publishedAtUtc };
    const publication = deepFreeze({ ...publicationUnsigned, publicationSha256: sha256(publicationUnsigned) });
    this.#receipts.set(candidate.candidateId, receipt); this.#official.set(officialId, publication); this.#appendRecord("official_municipal_publication", officialId, publication, "current", publishedAtUtc);
    return deepFreeze({ receipt, publication });
  }

  changes(cursor: string | null, limit: number): CivicChangePageV1 {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE) fail("civic_change_limit_invalid");
    let start = 0;
    if (cursor !== null) { if (typeof cursor !== "string" || !this.#cursorIndex.has(cursor)) fail("civic_change_cursor_invalid"); start = this.#cursorIndex.get(cursor)! + 1; }
    const events = this.#changes.slice(start, start + limit); const nextCursor = events.length === 0 ? null : events.at(-1)!.cursor;
    const unsigned = { schemaVersion: CIVIC_CHANGE_PAGE_SCHEMA_VERSION, projectionVersion: this.#projectionVersion, projectionSha256: this.#projectionSha256, events, nextCursor };
    return deepFreeze({ ...unsigned, pageSha256: sha256(unsigned) });
  }

  broadProjection(): MunicipalContextProjectionV1 {
    return deepFreeze({ schemaVersion: MUNICIPAL_CONTEXT_PROJECTION_SCHEMA_VERSION, version: this.#projectionVersion, contentSha256: this.#projectionSha256, records: this.#currentRecords() });
  }

  strictOparlProjection(): StrictOparlProjectionV1 {
    const papers: readonly OparlPaperV1[] = [...this.#official.values()].filter((publication) => publication.officialKind === "Paper").map((publication) => deepFreeze({ id: publication.officialId, type: "https://schema.oparl.org/1.1/Paper" as const, body: `urn:stadtstack:oparl-body:${publication.municipalityId}`, name: publication.publicPayload.title, reference: publication.candidateId, publicationDate: publication.publishedAtUtc, lastModified: publication.publishedAtUtc, files: [] }));
    const unsigned = { schemaVersion: STRICT_OPARL_PROJECTION_SCHEMA_VERSION, version: this.#projectionVersion, papers };
    return deepFreeze({ ...unsigned, contentSha256: sha256(unsigned) });
  }

  #currentRecords(): readonly PublicRecord[] {
    return this.#records.filter((record) => {
      if (record.kind === "reviewed_deliberation_artifact" || record.kind === "reviewed_administration_return") return !this.#withdrawn.has(record.id);
      if (record.kind !== "municipal_publication_candidate") return true;
      const candidate = this.#candidates.get(record.id);
      return candidate !== undefined && !this.#withdrawn.has(candidate.sourceArtifactId);
    });
  }

  #reviewedSource(artifactId: string): ReviewedSource {
    const source = this.#reviews.get(artifactId) ?? this.#administrationReturns.get(artifactId);
    if (!source) fail("reviewed_publication_source_absent"); return source;
  }

  #appendRecord(kind: PublicArtifactKind, idValue: string, value: unknown, correctionState: CorrectionState, changedAtUtc: string): void {
    if (this.#changes.length >= MAX_CHANGES) fail("civic_change_capacity_exceeded");
    const record = deepFreeze({ kind, id: idValue, value }); this.#records.push(record); this.#projectionVersion += 1;
    const projectionUnsigned = { schemaVersion: MUNICIPAL_CONTEXT_PROJECTION_SCHEMA_VERSION, version: this.#projectionVersion, records: this.#currentRecords() };
    this.#projectionSha256 = sha256(projectionUnsigned);
    const sequence = this.#changes.length + 1; const changeId = `urn:stadtstack:civic-change:${sha256({ sequence, kind, id: idValue, projectionVersion: this.#projectionVersion, projectionSha256: this.#projectionSha256, correctionState, changedAtUtc }).slice(7)}`;
    const cursor = `civic-change:${sequence}:${sha256({ changeId, sequence }).slice(7)}`;
    const unsigned = { schemaVersion: CIVIC_CHANGE_EVENT_SCHEMA_VERSION, changeId, cursor, artifact: { kind, id: idValue }, projectionVersion: this.#projectionVersion, projectionSha256: this.#projectionSha256, correctionState, changedAtUtc };
    const event = deepFreeze({ ...unsigned, eventSha256: sha256(unsigned) }); this.#cursorIndex.set(cursor, this.#changes.length); this.#changes.push(event);
  }
}

function parseChangeEvent(value: unknown): CivicChangeEventV1 {
  const code = "civic_change_event_invalid";
  const record = exact(value, ["schemaVersion", "changeId", "cursor", "artifact", "projectionVersion", "projectionSha256", "correctionState", "changedAtUtc", "eventSha256"], code);
  if (record.schemaVersion !== CIVIC_CHANGE_EVENT_SCHEMA_VERSION) fail(code);
  const artifactRecord = exact(record.artifact, ["kind", "id"], code);
  const kind = text(artifactRecord.kind, code) as PublicArtifactKind;
  if (!["reviewed_deliberation_artifact", "reviewed_administration_return", "municipal_publication_candidate", "official_municipal_publication", "correction"].includes(kind)) fail(code);
  const correctionState = text(record.correctionState, code) as CorrectionState;
  if (!["current", "withdrawn", "superseded"].includes(correctionState)) fail(code);
  const parsed = {
    schemaVersion: CIVIC_CHANGE_EVENT_SCHEMA_VERSION,
    changeId: id(record.changeId, code),
    cursor: id(record.cursor, code),
    artifact: { kind, id: id(artifactRecord.id, code) },
    projectionVersion: positiveInteger(record.projectionVersion, code),
    projectionSha256: checksum(record.projectionSha256, code),
    correctionState,
    changedAtUtc: iso(record.changedAtUtc, code),
    eventSha256: checksum(record.eventSha256, code),
  };
  const unsigned = { ...parsed, eventSha256: undefined } as unknown as Record<string, unknown>;
  delete unsigned.eventSha256;
  if (parsed.eventSha256 !== sha256(unsigned)) fail("civic_change_event_checksum_invalid");
  return deepFreeze(parsed);
}

function parseChangePage(value: unknown): CivicChangePageV1 {
  const code = "civic_change_page_invalid";
  const record = exact(value, ["schemaVersion", "projectionVersion", "projectionSha256", "events", "nextCursor", "pageSha256"], code);
  if (record.schemaVersion !== CIVIC_CHANGE_PAGE_SCHEMA_VERSION) fail(code);
  const events = array(record.events, MAX_PAGE, code).map(parseChangeEvent);
  if (new Set(events.map((event) => event.changeId)).size !== events.length || new Set(events.map((event) => event.cursor)).size !== events.length) fail(code);
  const nextCursor = record.nextCursor === null ? null : id(record.nextCursor, code);
  if ((events.length === 0) !== (nextCursor === null) || (events.length > 0 && nextCursor !== events.at(-1)!.cursor)) fail(code);
  const projectionVersion = record.projectionVersion;
  if (typeof projectionVersion !== "number" || !Number.isSafeInteger(projectionVersion) || projectionVersion < 0) fail(code);
  const parsed = { schemaVersion: CIVIC_CHANGE_PAGE_SCHEMA_VERSION, projectionVersion, projectionSha256: checksum(record.projectionSha256, code), events, nextCursor, pageSha256: checksum(record.pageSha256, code) };
  const unsigned = { ...parsed, pageSha256: undefined } as unknown as Record<string, unknown>;
  delete unsigned.pageSha256;
  if (parsed.pageSha256 !== sha256(unsigned)) fail("civic_change_page_checksum_invalid");
  return deepFreeze(parsed);
}

export function consumeEquivalentCivicContextPages(restValue: unknown, mcpValue: unknown): CivicContextReferenceConsumerReceiptV1 {
  const rest = parseChangePage(restValue);
  const mcpRecord = exact(mcpValue, ["schemaVersion", "projectionVersion", "projectionSha256", "page", "readOnly", "authority"], "mcp_civic_context_page_invalid");
  if (mcpRecord.schemaVersion !== MCP_CIVIC_CONTEXT_PAGE_SCHEMA_VERSION || mcpRecord.readOnly !== true || mcpRecord.authority !== "none") fail("mcp_civic_context_page_invalid");
  const mcpPage = parseChangePage(mcpRecord.page);
  if (mcpRecord.projectionVersion !== rest.projectionVersion || mcpRecord.projectionSha256 !== rest.projectionSha256 || canonical(mcpPage) !== canonical(rest)) fail("municipal_context_reference_consumer_drift");
  const unsigned = {
    schemaVersion: "municipal_context_reference_consumer_receipt_v1" as const,
    projectionVersion: rest.projectionVersion,
    projectionSha256: rest.projectionSha256,
    pageSha256: rest.pageSha256,
    acceptedEventCount: rest.events.length,
    restMcpEquivalent: true as const,
    authority: "none" as const,
  };
  return deepFreeze({ ...unsigned, receiptSha256: sha256(unsigned) });
}

export function createMcpCivicContextAdapter(exchange: MunicipalContextExchange): McpCivicContextAdapter {
  return Object.freeze({
    listChanges(cursor, limit) {
      const page = exchange.changes(cursor, limit);
      return deepFreeze({ schemaVersion: MCP_CIVIC_CONTEXT_PAGE_SCHEMA_VERSION, projectionVersion: page.projectionVersion, projectionSha256: page.projectionSha256, page, readOnly: true as const, authority: "none" as const });
    },
    readBroadProjection: () => exchange.broadProjection(),
    readStrictOparlProjection: () => exchange.strictOparlProjection(),
  });
}

export function serializeCivicChangePage(value: CivicChangePageV1): string { return `${canonical(value)}\n`; }
export function municipalContextCanonicalSha256(value: unknown): Sha256 { return sha256(value); }
