import { createHash } from "node:crypto";

import {
  getEventHash,
  finalizeEvent,
  getPublicKey,
  validateEvent,
  verifyEvent,
  type Event as NostrEvent,
} from "nostr-tools/pure";
import { hexToBytes } from "@noble/hashes/utils.js";

import type {
  ActorBinding,
  CivicCaseCoordinator,
  QueryEnvelope,
  ProjectionEnvelope,
} from "../civic-case-coordinator.ts";

export const PUBLIC_EXCHANGE_SCHEMA_VERSION = "public_exchange_record_v1" as const;
export const PUBLIC_EXCHANGE_KIND = 39999 as const;
export const PUBLIC_EXCHANGE_DISCLOSURE_POLICY = "permanent_public_v1" as const;
export const PUBLIC_EXCHANGE_FIXTURE_TAG = ["t", "stadtstack-e2e-fixture"] as const;
export const PUBLIC_EXCHANGE_NODE = "stadtstack-public-exchange-test" as const;
export const PUBLIC_EXCHANGE_AGENT = "stadtstack-public-exchange-v1" as const;
export const PUBLIC_EXCHANGE_CREATED_AT = 1_754_035_205 as const;

export const PUBLIC_EXCHANGE_REGISTRY_PROOF = Object.freeze({
  url: "https://github.com/nostr-protocol/registry-of-kinds/blob/92279d41d839e50d141126ebfcb9b450f4a9596d/schema.yaml",
  gitBlobSha1: "92279d41d839e50d141126ebfcb9b450f4a9596d",
  rawSha256: "31aac03f9c3a4154355d524962b908e183512d44641953e9b24270acfb946b86",
  byteLength: 72_438,
  observedAt: "2026-08-08",
  parsedKindCount: 257,
  kind39999Absent: true,
  kind30078InUse: true,
  notAllocated: true,
  noStandardizationClaim: true,
});

export type PublicExchangeRegistryProof = {
  url: string;
  gitBlobSha1: string;
  rawSha256: string;
  byteLength: number;
  observedAt: string;
  parsedKindCount?: number;
  kind39999Absent?: boolean;
  kind30078InUse?: boolean;
  notAllocated?: boolean;
  noStandardizationClaim?: boolean;
};

type CorrectionRelation = "none" | "corrects" | "retracts";

export type PublicExchangeSource = Pick<CivicCaseCoordinator, "project">;

export type PublicExchangeSigner = {
  seed: string;
  workerIdentityId: string;
};

export type PublicExchangeSignerProjection = {
  class: "city_test_agent";
  pubkey: string;
  bot: true;
  node: typeof PUBLIC_EXCHANGE_NODE;
  agent: typeof PUBLIC_EXCHANGE_AGENT;
};

export type PublicExchangeSourceBinding = {
  packageId: string;
  departmentId: string;
  packageChecksum: string;
  draftArtifactChecksum: string;
  reviewAttestationChecksum: string;
  reviewedAt: string;
};

export type PublicExchangeRecordV1 = {
  schemaVersion: typeof PUBLIC_EXCHANGE_SCHEMA_VERSION;
  recordId: string;
  eventKind: typeof PUBLIC_EXCHANGE_KIND;
  canonicalCaseId: string;
  municipalityId: string;
  caseVersion: number;
  projectionChecksum: string;
  artifact: {
    kind: "reviewed_citizen_brief_v1";
    id: string;
    version: number;
    checksum: string;
    correctionState: "current" | "retracted";
    public: {
      title: string;
      summary: string;
      responses: Array<{
        departmentId: string;
        publicSummary: string;
        publicCitations: string[];
      }>;
    } | null;
  };
  provenance: {
    sourceDiscussionRef: { type: "nostr_event"; id: string; ref: string };
    suggestionId: string;
    sourceBindings: PublicExchangeSourceBinding[];
    publicCitations: string[];
  };
  reviewAttestations: Array<{
    packageId: string;
    departmentId: string;
    attestationChecksum: string;
    reviewedAt: string;
    policyVersion: string;
    reviewerClass: "department_reviewer";
  }>;
  visibility: "public";
  disclosurePolicy: typeof PUBLIC_EXCHANGE_DISCLOSURE_POLICY;
  signer: PublicExchangeSignerProjection;
  aiAttribution: {
    schemaVersion: "ai_attribution_v1";
    kind: "agent_contribution";
    workerIdentityId: string;
    profile: "public";
    adapterKind: "deterministic-local";
    authorityBinding: "none";
  };
  correctionReference: {
    relation: CorrectionRelation;
    recordId: string | null;
    priorChecksum: string | null;
  };
  authorityBinding: "none";
  recordChecksum: string;
};

export type PublicExchangeAdapterOptions = {
  source: PublicExchangeSource;
  caseId: string;
  policyVersion: string;
  publicActor: ActorBinding;
  signer: PublicExchangeSigner;
  registryProof?: PublicExchangeRegistryProof;
  registrySnapshot?: string;
};

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function nonEmptyString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(code);
  return value.trim();
}

function requireChecksum(value: unknown, code: string): string {
  const checksum = nonEmptyString(value, code);
  if (!SHA256.test(checksum)) throw new Error(code);
  return checksum;
}

const FORBIDDEN_PUBLIC_MARKER = /(?:nsec\d|npub\d|ncryptsec\d|private[_ -]?evidence|private[_ -]?case|employee|participants?(?:[_ -]?(?:id|identity|data|record|list))?\b|eligib|ballot|wallet|secret|credential|prompt|reasoning|trace|journal|case[_ -]?event|raw[_ -]?event|internal|unpublished)/i;

function assertNoForbiddenPublicValue(value: unknown, code = "public_exchange_disclosure_forbidden", path = "root"): void {
  if (typeof value === "string") {
    if (FORBIDDEN_PUBLIC_MARKER.test(value)) throw new Error(`${code}:${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenPublicValue(item, code, `${path}[${index}]`));
    return;
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_PUBLIC_MARKER.test(key)) throw new Error(`${code}:${path}.${key}`);
      assertNoForbiddenPublicValue(child, code, `${path}.${key}`);
    }
  }
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], code: string): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) throw new Error(code);
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha1GitBlob(value: Uint8Array): string {
  const header = Buffer.from(`blob ${value.byteLength}\0`, "utf8");
  return createHash("sha1").update(Buffer.concat([header, Buffer.from(value)])).digest("hex");
}

/**
 * Verify an injected, read-only registry snapshot.  The repository deliberately
 * carries only factual provenance; callers provide the bytes they reviewed.
 * This parser accepts the registry's simple `kinds:` map and rejects unknown
 * or malformed input before an event can be built.
 */
export function verifyRegistrySnapshot(
  snapshot: { rawYaml: string; sourceUrl: string; gitBlobSha1: string; rawSha256: string; byteLength: number; observedAt: string },
  expected: { candidateKind: number },
): { parsedKindCount: number; candidateAbsent: true } {
  if (!isObject(snapshot) || typeof snapshot.rawYaml !== "string" || snapshot.rawYaml.length === 0) throw new Error("public_exchange_registry_snapshot_invalid");
  if (!Number.isSafeInteger(expected.candidateKind) || expected.candidateKind < 0 || expected.candidateKind > 65535) throw new Error("public_exchange_registry_candidate_invalid");
  if (typeof snapshot.sourceUrl !== "string" || snapshot.sourceUrl.trim() === "" || !/^[a-z][a-z0-9+.-]*:\S+$/i.test(snapshot.sourceUrl) || !/^[0-9a-f]{40}$/.test(snapshot.gitBlobSha1) || !/^[0-9a-f]{64}$/.test(snapshot.rawSha256) || !Number.isSafeInteger(snapshot.byteLength) || snapshot.byteLength < 1 || typeof snapshot.observedAt !== "string" || snapshot.observedAt.trim() === "") throw new Error("public_exchange_registry_proof_invalid");
  const raw = new TextEncoder().encode(snapshot.rawYaml);
  if (raw.byteLength !== snapshot.byteLength || sha256Bytes(raw) !== snapshot.rawSha256 || sha1GitBlob(raw) !== snapshot.gitBlobSha1) throw new Error("public_exchange_registry_snapshot_digest_invalid");
  const lines = snapshot.rawYaml.replace(/\r\n?/g, "\n").split("\n");
  const kindsRoot = lines.findIndex((line) => /^kinds:\s*(?:#.*)?$/.test(line));
  if (kindsRoot < 0) throw new Error("public_exchange_registry_kinds_missing");
  const keys = new Set<number>();
  let sawMapEntry = false;
  let mapIndent = -1;
  for (let index = kindsRoot + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^\S/.test(line) && line.trim() !== "") break;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const match = /^(\s{2,})(?:["']?)(\d+)(?:["']?)\s*:/.exec(line);
    if (!match) {
      if (line.trim() === "" || /^\s*#/.test(line)) continue;
      if (mapIndent < 0 || indent > mapIndent) continue;
      throw new Error("public_exchange_registry_yaml_invalid");
    }
    if (mapIndent < 0) mapIndent = match[1]!.length;
    if (indent !== mapIndent) continue;
    const kind = Number(match[2]);
    if (!Number.isSafeInteger(kind) || kind < 0 || kind > 65535 || keys.has(kind)) throw new Error("public_exchange_registry_kind_invalid");
    keys.add(kind);
    sawMapEntry = true;
  }
  if (!sawMapEntry) throw new Error("public_exchange_registry_kinds_invalid");
  if (keys.has(expected.candidateKind)) throw new Error("public_exchange_registry_kind_occupied");
  return { parsedKindCount: keys.size, candidateAbsent: true };
}

function assertRegistryProof(proof: PublicExchangeRegistryProof, snapshot?: string): void {
  if (!isObject(proof) ||
      proof.url !== PUBLIC_EXCHANGE_REGISTRY_PROOF.url ||
      proof.gitBlobSha1 !== PUBLIC_EXCHANGE_REGISTRY_PROOF.gitBlobSha1 ||
      proof.rawSha256 !== PUBLIC_EXCHANGE_REGISTRY_PROOF.rawSha256 ||
      proof.byteLength !== PUBLIC_EXCHANGE_REGISTRY_PROOF.byteLength ||
      proof.observedAt !== PUBLIC_EXCHANGE_REGISTRY_PROOF.observedAt ||
      proof.parsedKindCount !== PUBLIC_EXCHANGE_REGISTRY_PROOF.parsedKindCount ||
      proof.kind39999Absent !== true || proof.kind30078InUse !== true || proof.notAllocated !== true || proof.noStandardizationClaim !== true) {
    throw new Error("public_exchange_registry_proof_invalid");
  }
  if (snapshot !== undefined) {
    const result = verifyRegistrySnapshot({ rawYaml: snapshot, sourceUrl: proof.url, gitBlobSha1: proof.gitBlobSha1, rawSha256: proof.rawSha256, byteLength: proof.byteLength, observedAt: proof.observedAt }, { candidateKind: PUBLIC_EXCHANGE_KIND });
    if (proof.parsedKindCount !== undefined && proof.parsedKindCount !== result.parsedKindCount) throw new Error("public_exchange_registry_kind_count_invalid");
  }
}

function deriveSecretKey(seed: string): Uint8Array {
  const normalized = nonEmptyString(seed, "public_exchange_signer_seed_required");
  if (/(?:nsec\d|private|secret|credential)/i.test(normalized)) throw new Error("public_exchange_signer_seed_invalid");
  const digest = createHash("sha256").update(normalized, "utf8").digest("hex");
  return hexToBytes(digest);
}

function signerProjection(signer: PublicExchangeSigner): PublicExchangeSignerProjection {
  const secretKey = deriveSecretKey(signer.seed);
  return {
    class: "city_test_agent",
    pubkey: getPublicKey(secretKey),
    bot: true,
    node: PUBLIC_EXCHANGE_NODE,
    agent: PUBLIC_EXCHANGE_AGENT,
  };
}

function sourceBindingsFromBrief(brief: Record<string, unknown>): PublicExchangeSourceBinding[] {
  const provenance = brief.provenance;
  if (!isObject(provenance) || !Array.isArray(provenance.packageBindings) || provenance.packageBindings.length !== 8) {
    throw new Error("public_exchange_provenance_invalid");
  }
  const result = provenance.packageBindings.map((binding, index) => {
    if (!isObject(binding)) throw new Error(`public_exchange_source_binding_invalid:${index}`);
    assertExactKeys(binding, ["packageId", "departmentId", "packageChecksum", "draftArtifactChecksum", "reviewAttestationChecksum", "reviewedAt"], `public_exchange_source_binding_invalid:${index}`);
    return {
      packageId: nonEmptyString(binding.packageId, `public_exchange_source_binding_invalid:${index}`),
      departmentId: nonEmptyString(binding.departmentId, `public_exchange_source_binding_invalid:${index}`),
      packageChecksum: requireChecksum(binding.packageChecksum, `public_exchange_source_binding_invalid:${index}`),
      draftArtifactChecksum: requireChecksum(binding.draftArtifactChecksum, `public_exchange_source_binding_invalid:${index}`),
      reviewAttestationChecksum: requireChecksum(binding.reviewAttestationChecksum, `public_exchange_source_binding_invalid:${index}`),
      reviewedAt: nonEmptyString(binding.reviewedAt, `public_exchange_source_binding_invalid:${index}`),
    };
  }).sort((left, right) => left.packageId.localeCompare(right.packageId));
  if (new Set(result.map((binding) => binding.packageId)).size !== result.length || new Set(result.map((binding) => binding.departmentId)).size !== result.length) throw new Error("public_exchange_source_binding_duplicate");
  return result;
}

function verifyBriefChecksum(brief: Record<string, unknown>): string {
  const checksum = requireChecksum(brief.briefChecksum, "public_exchange_artifact_checksum_invalid");
  const withoutChecksum = Object.fromEntries(Object.entries(brief).filter(([key]) => key !== "briefChecksum"));
  if (sha256(withoutChecksum) !== checksum) throw new Error("public_exchange_artifact_checksum_invalid");
  return checksum;
}

function verifyProjectionEnvelope(envelope: ProjectionEnvelope, caseId: string, policyVersion: string): Record<string, unknown> {
  if (!isObject(envelope) || envelope.schemaVersion !== "projection_envelope_v1") throw new Error("public_exchange_projection_invalid");
  if (envelope.caseId !== caseId || envelope.visibility !== "public" || envelope.policyVersion !== policyVersion) throw new Error("public_exchange_projection_scope_invalid");
  if (!Number.isSafeInteger(envelope.caseVersion) || envelope.caseVersion < 0 || !SHA256.test(envelope.journalHeadChecksum) || !SHA256.test(envelope.projectionChecksum)) throw new Error("public_exchange_projection_invalid");
  if (!isObject(envelope.projection) || envelope.projection.schemaVersion !== "case_projection_v1" || envelope.projection.caseId !== caseId || envelope.projection.municipalityId !== "sample-municipality") throw new Error("public_exchange_projection_invalid");
  const expected = sha256({ schemaVersion: "projection_envelope_v1", caseId, caseVersion: envelope.caseVersion, visibility: "public", policyVersion, projection: envelope.projection });
  if (expected !== envelope.projectionChecksum) throw new Error("public_exchange_projection_checksum_invalid");
  return envelope.projection as unknown as Record<string, unknown>;
}

function mapRecord(envelope: ProjectionEnvelope, options: { caseId?: string; policyVersion?: string; signer: PublicExchangeSigner; correctionReference?: PublicExchangeRecordV1["correctionReference"]; artifactVersion?: number }): PublicExchangeRecordV1 {
  const caseId = options.caseId ?? envelope.caseId;
  const policyVersion = options.policyVersion ?? envelope.policyVersion;
  const projection = verifyProjectionEnvelope(envelope, caseId, policyVersion);
  assertNoForbiddenPublicValue(projection, "public_exchange_disclosure_forbidden", "projection");
  const brief = projection.reviewedCitizenBrief;
  if (!isObject(brief) || brief.schemaVersion !== "citizen_brief_projection_v1" || brief.correctionState !== "current" || brief.authorityBinding !== "none") throw new Error("public_exchange_brief_not_current");
  assertExactKeys(brief, ["schemaVersion", "id", "title", "summary", "responses", "provenance", "policyVersion", "correctionState", "authorityBinding", "briefChecksum"], "public_exchange_artifact_invalid");
  if (brief.policyVersion !== policyVersion) throw new Error("public_exchange_policy_version_invalid");
  const briefChecksum = verifyBriefChecksum(brief);
  const sourceBindings = sourceBindingsFromBrief(brief);
  const provenance = brief.provenance as Record<string, unknown>;
  assertExactKeys(provenance, ["sourceDiscussionRef", "suggestionId", "packageBindings"], "public_exchange_provenance_invalid");
  const sourceDiscussionRef = provenance.sourceDiscussionRef;
  if (!isObject(sourceDiscussionRef) || sourceDiscussionRef.type !== "nostr_event") throw new Error("public_exchange_provenance_invalid");
  assertExactKeys(sourceDiscussionRef, ["type", "id", "ref"], "public_exchange_provenance_invalid");
  const sourceRef = nonEmptyString(sourceDiscussionRef.ref, "public_exchange_provenance_invalid");
  if (!/^nostr:\/\/\S+$/i.test(sourceRef)) throw new Error("public_exchange_provenance_invalid");
  const responses = brief.responses;
  if (!Array.isArray(responses)) throw new Error("public_exchange_artifact_invalid");
  const publicResponses = responses.map((response, index) => {
    if (!isObject(response)) throw new Error(`public_exchange_response_invalid:${index}`);
    assertExactKeys(response, ["departmentId", "publicSummary", "publicCitations"], `public_exchange_response_invalid:${index}`);
    if (!Array.isArray(response.publicCitations) || response.publicCitations.some((ref) => typeof ref !== "string" || !/^synthetic:\/\/\S+$/i.test(ref))) throw new Error(`public_exchange_response_invalid:${index}`);
    return { departmentId: nonEmptyString(response.departmentId, `public_exchange_response_invalid:${index}`), publicSummary: nonEmptyString(response.publicSummary, `public_exchange_response_invalid:${index}`), publicCitations: [...new Set(response.publicCitations as string[])].sort() };
  }).sort((left, right) => left.departmentId.localeCompare(right.departmentId));
  if (publicResponses.length !== 8 || new Set(publicResponses.map((response) => response.departmentId)).size !== publicResponses.length) throw new Error("public_exchange_artifact_responses_invalid");
  const bindingDepartments = new Set(sourceBindings.map((binding) => binding.departmentId));
  if (bindingDepartments.size !== sourceBindings.length || publicResponses.some((response) => !bindingDepartments.has(response.departmentId)) || sourceBindings.some((binding) => !publicResponses.some((response) => response.departmentId === binding.departmentId))) throw new Error("public_exchange_artifact_bindings_invalid");
  const publicCitations = [...new Set(publicResponses.flatMap((response) => response.publicCitations))].sort();
  const recordId = `urn:stadtstack:public-exchange:${sha256({ caseId, artifactKind: "reviewed_citizen_brief_v1" }).slice("sha256:".length)}`;
  const artifact = {
    kind: "reviewed_citizen_brief_v1" as const,
    id: nonEmptyString(brief.id, "public_exchange_artifact_invalid"),
    version: options.artifactVersion ?? 1,
    checksum: briefChecksum,
    correctionState: "current" as const,
    public: { title: nonEmptyString(brief.title, "public_exchange_artifact_invalid"), summary: nonEmptyString(brief.summary, "public_exchange_artifact_invalid"), responses: publicResponses },
  };
  const signer = signerProjection(options.signer);
  const recordWithoutChecksum = {
    schemaVersion: PUBLIC_EXCHANGE_SCHEMA_VERSION,
    recordId,
    eventKind: PUBLIC_EXCHANGE_KIND,
    canonicalCaseId: caseId,
    municipalityId: "sample-municipality",
    caseVersion: envelope.caseVersion,
    projectionChecksum: envelope.projectionChecksum,
    artifact,
    provenance: {
      sourceDiscussionRef: { type: "nostr_event" as const, id: nonEmptyString(sourceDiscussionRef.id, "public_exchange_provenance_invalid"), ref: sourceRef },
      suggestionId: nonEmptyString(provenance.suggestionId, "public_exchange_provenance_invalid"),
      sourceBindings,
      publicCitations,
    },
    reviewAttestations: sourceBindings.map((binding) => ({ packageId: binding.packageId, departmentId: binding.departmentId, attestationChecksum: binding.reviewAttestationChecksum, reviewedAt: binding.reviewedAt, policyVersion, reviewerClass: "department_reviewer" as const })),
    visibility: "public" as const,
    disclosurePolicy: PUBLIC_EXCHANGE_DISCLOSURE_POLICY,
    signer,
    aiAttribution: { schemaVersion: "ai_attribution_v1" as const, kind: "agent_contribution" as const, workerIdentityId: nonEmptyString(options.signer.workerIdentityId, "public_exchange_worker_identity_required"), profile: "public" as const, adapterKind: "deterministic-local" as const, authorityBinding: "none" as const },
    correctionReference: options.correctionReference ?? { relation: "none" as const, recordId: null, priorChecksum: null },
    authorityBinding: "none" as const,
  };
  return clone({ ...recordWithoutChecksum, recordChecksum: sha256(recordWithoutChecksum) });
}

export function createPublicExchangeRecord(
  envelope: ProjectionEnvelope,
  options: Pick<PublicExchangeAdapterOptions, "signer"> & Partial<Pick<PublicExchangeAdapterOptions, "caseId" | "policyVersion" | "registryProof" | "registrySnapshot">>,
): PublicExchangeRecordV1 {
  assertRegistryProof(options.registryProof ?? PUBLIC_EXCHANGE_REGISTRY_PROOF, options.registrySnapshot);
  return validatePublicExchangeRecord(mapRecord(envelope, options));
}

export function signPublicExchangeRecord(record: PublicExchangeRecordV1, signer: PublicExchangeSigner): NostrEvent {
  validatePublicExchangeRecord(record);
  const expectedSigner = signerProjection(signer);
  if (record.signer.pubkey !== expectedSigner.pubkey) throw new Error("public_exchange_signer_mismatch");
  return finalizeEvent({
    kind: PUBLIC_EXCHANGE_KIND,
    created_at: PUBLIC_EXCHANGE_CREATED_AT,
    tags: [
      ["d", record.recordId],
      [...PUBLIC_EXCHANGE_FIXTURE_TAG],
      ["schema", PUBLIC_EXCHANGE_SCHEMA_VERSION],
      ["municipality", record.municipalityId],
      ["case", "sample-case"],
      ["artifact", record.artifact.kind],
      ["bot", "true"],
      ["node", PUBLIC_EXCHANGE_NODE],
      ["agent", PUBLIC_EXCHANGE_AGENT],
    ],
    content: canonicalJson(record),
  }, deriveSecretKey(signer.seed));
}

export type PublicExchangePublishReceipt = {
  schemaVersion: "public_exchange_relay_v1";
  relayUrl: "memory://public-exchange";
  eventId: string;
  ok: true;
  ack: readonly ["OK", string, true];
};

export type PublicExchangeQueryReceipt = {
  schemaVersion: "public_exchange_relay_v1";
  relayUrl: "memory://public-exchange";
  recordId: string;
  events: readonly [NostrEvent];
  eose: true;
};

export type PublicExchangeRelay = {
  publish(event: NostrEvent): Promise<PublicExchangePublishReceipt>;
  query(recordId: string | { kind: number; pubkey: string; d: string } | { recordId: string }): Promise<PublicExchangeQueryReceipt>;
  reimport(event: NostrEvent): PublicExchangeRecordV1;
  readonly publishCount: number;
  readonly queryCount: number;
};

export type PublicExchangeRelayOptions = {
  relayUrl?: string;
  registryProof?: PublicExchangeRegistryProof;
  registrySnapshot?: string;
  allowedSignerPubkey?: string;
};

const RECORD_KEYS = [
  "schemaVersion", "recordId", "eventKind", "canonicalCaseId", "municipalityId", "caseVersion", "projectionChecksum", "artifact", "provenance", "reviewAttestations", "visibility", "disclosurePolicy", "signer", "aiAttribution", "correctionReference", "authorityBinding", "recordChecksum",
] as const;

function assertRfc3339(value: unknown, code: string): string {
  const text = nonEmptyString(value, code);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text) || Number.isNaN(Date.parse(text))) throw new Error(code);
  return text;
}

function assertSyntheticIdentity(value: unknown, code: string): string {
  const identity = nonEmptyString(value, code);
  if (!/^(?:did:stadtstack:|synthetic:)/.test(identity) || FORBIDDEN_PUBLIC_MARKER.test(identity)) throw new Error(code);
  return identity;
}

function validatePublicExchangeRecord(record: unknown): PublicExchangeRecordV1 {
  if (!isObject(record)) throw new Error("public_exchange_record_invalid");
  assertExactKeys(record, RECORD_KEYS, "public_exchange_record_unknown_field");
  if (record.schemaVersion !== PUBLIC_EXCHANGE_SCHEMA_VERSION || record.eventKind !== PUBLIC_EXCHANGE_KIND || record.visibility !== "public" || record.disclosurePolicy !== PUBLIC_EXCHANGE_DISCLOSURE_POLICY || record.authorityBinding !== "none") throw new Error("public_exchange_record_invalid");
  const caseId = nonEmptyString(record.canonicalCaseId, "public_exchange_record_invalid");
  if (!/^urn:stadtstack:case:/.test(caseId)) throw new Error("public_exchange_case_id_invalid");
  if (!Number.isSafeInteger(record.caseVersion) || (record.caseVersion as number) < 0) throw new Error("public_exchange_record_invalid");
  requireChecksum(record.projectionChecksum, "public_exchange_projection_checksum_invalid");
  const artifact = record.artifact;
  if (!isObject(artifact)) throw new Error("public_exchange_artifact_invalid");
  assertExactKeys(artifact, ["kind", "id", "version", "checksum", "correctionState", "public"], "public_exchange_artifact_unknown_field");
  if (artifact.kind !== "reviewed_citizen_brief_v1" || !Number.isSafeInteger(artifact.version) || (artifact.version as number) < 1 || (artifact.correctionState !== "current" && artifact.correctionState !== "retracted")) throw new Error("public_exchange_artifact_invalid");
  requireChecksum(artifact.checksum, "public_exchange_artifact_checksum_invalid");
  if (artifact.correctionState === "retracted") {
    if (artifact.public !== null) throw new Error("public_exchange_retraction_not_redacted");
  } else {
    const publicArtifact = artifact.public;
    if (!isObject(publicArtifact)) throw new Error("public_exchange_artifact_public_invalid");
    assertExactKeys(publicArtifact, ["title", "summary", "responses"], "public_exchange_artifact_public_unknown_field");
    nonEmptyString(publicArtifact.title, "public_exchange_artifact_public_invalid");
    nonEmptyString(publicArtifact.summary, "public_exchange_artifact_public_invalid");
    if (!Array.isArray(publicArtifact.responses)) throw new Error("public_exchange_artifact_public_invalid");
    publicArtifact.responses.forEach((response, index) => {
      if (!isObject(response)) throw new Error(`public_exchange_response_invalid:${index}`);
      assertExactKeys(response, ["departmentId", "publicSummary", "publicCitations"], `public_exchange_response_invalid:${index}`);
      nonEmptyString(response.departmentId, `public_exchange_response_invalid:${index}`);
      nonEmptyString(response.publicSummary, `public_exchange_response_invalid:${index}`);
      if (!Array.isArray(response.publicCitations) || response.publicCitations.some((citation) => typeof citation !== "string" || !/^synthetic:\/\/\S+$/.test(citation))) throw new Error(`public_exchange_response_invalid:${index}`);
      const citations = response.publicCitations as unknown[];
      if (citations.some((citation, citationIndex) => citationIndex > 0 && String(citation).localeCompare(String(citations[citationIndex - 1])) < 0)) throw new Error(`public_exchange_response_order_invalid:${index}`);
      if (new Set(citations.map(String)).size !== citations.length) throw new Error(`public_exchange_response_duplicate_citation:${index}`);
    });
  }
  const provenance = record.provenance;
  if (!isObject(provenance)) throw new Error("public_exchange_provenance_invalid");
  assertExactKeys(provenance, ["sourceDiscussionRef", "suggestionId", "sourceBindings", "publicCitations"], "public_exchange_provenance_unknown_field");
  if (!isObject(provenance.sourceDiscussionRef)) throw new Error("public_exchange_provenance_invalid");
  assertExactKeys(provenance.sourceDiscussionRef, ["type", "id", "ref"], "public_exchange_provenance_invalid");
  if (provenance.sourceDiscussionRef.type !== "nostr_event" || !/^[0-9a-f]{64}$/.test(nonEmptyString(provenance.sourceDiscussionRef.id, "public_exchange_provenance_invalid")) || !/^nostr:\/\/\S+$/.test(nonEmptyString(provenance.sourceDiscussionRef.ref, "public_exchange_provenance_invalid"))) throw new Error("public_exchange_provenance_invalid");
  nonEmptyString(provenance.suggestionId, "public_exchange_provenance_invalid");
  if (!Array.isArray(provenance.publicCitations) || provenance.publicCitations.some((citation) => typeof citation !== "string" || !/^synthetic:\/\/\S+$/.test(citation))) throw new Error("public_exchange_provenance_invalid");
  if (!Array.isArray(provenance.sourceBindings) || provenance.sourceBindings.length !== 8) throw new Error("public_exchange_provenance_invalid");
  provenance.sourceBindings.forEach((binding, index) => {
    if (!isObject(binding)) throw new Error(`public_exchange_source_binding_invalid:${index}`);
    assertExactKeys(binding, ["packageId", "departmentId", "packageChecksum", "draftArtifactChecksum", "reviewAttestationChecksum", "reviewedAt"], `public_exchange_source_binding_invalid:${index}`);
    nonEmptyString(binding.packageId, `public_exchange_source_binding_invalid:${index}`);
    nonEmptyString(binding.departmentId, `public_exchange_source_binding_invalid:${index}`);
    requireChecksum(binding.packageChecksum, `public_exchange_source_binding_invalid:${index}`);
    requireChecksum(binding.draftArtifactChecksum, `public_exchange_source_binding_invalid:${index}`);
    requireChecksum(binding.reviewAttestationChecksum, `public_exchange_source_binding_invalid:${index}`);
    assertRfc3339(binding.reviewedAt, `public_exchange_source_binding_invalid:${index}`);
  });
  const bindingPackageIds = provenance.sourceBindings.map((binding) => binding.packageId as string);
  if (bindingPackageIds.some((id, index) => index > 0 && id.localeCompare(bindingPackageIds[index - 1]!) < 0)) throw new Error("public_exchange_source_binding_order_invalid");
  if (new Set(bindingPackageIds).size !== 8 || new Set(provenance.sourceBindings.map((binding) => binding.departmentId)).size !== 8) throw new Error("public_exchange_source_binding_duplicate");
  const provenanceCitations = provenance.publicCitations as unknown[];
  if (provenanceCitations.some((citation, index) => index > 0 && String(citation).localeCompare(String(provenanceCitations[index - 1])) < 0)) throw new Error("public_exchange_provenance_order_invalid");
  if (!Array.isArray(record.reviewAttestations) || record.reviewAttestations.length !== 8 || record.reviewAttestations.length !== provenance.sourceBindings.length) throw new Error("public_exchange_review_attestations_invalid");
  record.reviewAttestations.forEach((attestation, index) => {
    if (!isObject(attestation)) throw new Error(`public_exchange_review_attestation_invalid:${index}`);
    assertExactKeys(attestation, ["packageId", "departmentId", "attestationChecksum", "reviewedAt", "policyVersion", "reviewerClass"], `public_exchange_review_attestation_invalid:${index}`);
    nonEmptyString(attestation.packageId, `public_exchange_review_attestation_invalid:${index}`);
    nonEmptyString(attestation.departmentId, `public_exchange_review_attestation_invalid:${index}`);
    requireChecksum(attestation.attestationChecksum, `public_exchange_review_attestation_invalid:${index}`);
    assertRfc3339(attestation.reviewedAt, `public_exchange_review_attestation_invalid:${index}`);
    nonEmptyString(attestation.policyVersion, `public_exchange_review_attestation_invalid:${index}`);
    if (attestation.reviewerClass !== "department_reviewer") throw new Error(`public_exchange_review_attestation_invalid:${index}`);
  });
  const attestationPackageIds = record.reviewAttestations.map((attestation) => attestation.packageId as string);
  if (attestationPackageIds.some((id, index) => index > 0 && id.localeCompare(attestationPackageIds[index - 1]!) < 0)) throw new Error("public_exchange_review_attestation_order_invalid");
  if (new Set(attestationPackageIds).size !== 8 || new Set(record.reviewAttestations.map((attestation) => attestation.departmentId)).size !== 8) throw new Error("public_exchange_review_attestation_duplicate");
  const responsesForOrder = isObject(artifact.public) && Array.isArray(artifact.public.responses) ? artifact.public.responses : [];
  const departmentIds = responsesForOrder.map((response) => isObject(response) ? String(response.departmentId) : "");
  if (departmentIds.some((id, index) => index > 0 && id.localeCompare(departmentIds[index - 1]!) < 0)) throw new Error("public_exchange_response_order_invalid");
  if (artifact.correctionState === "current" && (departmentIds.length !== 8 || new Set(departmentIds).size !== 8)) throw new Error("public_exchange_artifact_responses_invalid");
  if (!isObject(record.signer)) throw new Error("public_exchange_signer_invalid");
  assertExactKeys(record.signer, ["class", "pubkey", "bot", "node", "agent"], "public_exchange_signer_invalid");
  if (record.signer.class !== "city_test_agent" || !HEX_64.test(nonEmptyString(record.signer.pubkey, "public_exchange_signer_invalid")) || record.signer.bot !== true || record.signer.node !== PUBLIC_EXCHANGE_NODE || record.signer.agent !== PUBLIC_EXCHANGE_AGENT) throw new Error("public_exchange_signer_invalid");
  if (!isObject(record.aiAttribution)) throw new Error("public_exchange_ai_attribution_invalid");
  assertExactKeys(record.aiAttribution, ["schemaVersion", "kind", "workerIdentityId", "profile", "adapterKind", "authorityBinding"], "public_exchange_ai_attribution_invalid");
  if (record.aiAttribution.schemaVersion !== "ai_attribution_v1" || record.aiAttribution.kind !== "agent_contribution" || record.aiAttribution.profile !== "public" || record.aiAttribution.adapterKind !== "deterministic-local" || record.aiAttribution.authorityBinding !== "none") throw new Error("public_exchange_ai_attribution_invalid");
  assertSyntheticIdentity(record.aiAttribution.workerIdentityId, "public_exchange_ai_attribution_invalid");
  if (!isObject(record.correctionReference)) throw new Error("public_exchange_correction_invalid");
  assertExactKeys(record.correctionReference, ["relation", "recordId", "priorChecksum"], "public_exchange_correction_invalid");
  const relation = record.correctionReference.relation;
  if (relation !== "none" && relation !== "corrects" && relation !== "retracts") throw new Error("public_exchange_correction_invalid");
  if (relation === "none") {
    if (record.correctionReference.recordId !== null || record.correctionReference.priorChecksum !== null || artifact.correctionState !== "current") throw new Error("public_exchange_correction_invalid");
  } else {
    if (typeof record.correctionReference.recordId !== "string" || !record.correctionReference.recordId.startsWith("urn:stadtstack:public-exchange:") || typeof record.correctionReference.priorChecksum !== "string" || !SHA256.test(record.correctionReference.priorChecksum)) throw new Error("public_exchange_correction_invalid");
    if (relation === "retracts" && artifact.correctionState !== "retracted") throw new Error("public_exchange_correction_invalid");
    if (relation === "corrects" && artifact.correctionState !== "current") throw new Error("public_exchange_correction_invalid");
  }
  if (isObject(artifact.public) && Array.isArray(artifact.public.responses)) {
    const flattened = artifact.public.responses.flatMap((response) => isObject(response) && Array.isArray(response.publicCitations) ? response.publicCitations.map(String) : []).sort();
    const expected = [...new Set(flattened)];
    const actual = [...(provenance.publicCitations as unknown[])].map(String);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("public_exchange_provenance_citations_mismatch");
  }
  if (record.reviewAttestations.length !== (provenance.sourceBindings as unknown[]).length || record.reviewAttestations.some((attestation, index) => {
    const binding = (provenance.sourceBindings as unknown[])[index];
    if (!isObject(binding)) return true;
    return attestation.packageId !== binding.packageId || attestation.departmentId !== binding.departmentId || attestation.attestationChecksum !== binding.reviewAttestationChecksum || attestation.reviewedAt !== binding.reviewedAt;
  })) throw new Error("public_exchange_review_binding_mismatch");
  if (artifact.correctionState === "current" && isObject(artifact.public) && Array.isArray(artifact.public.responses)) {
    const bindingDepartments = new Set((provenance.sourceBindings as unknown[]).filter(isObject).map((binding) => String(binding.departmentId)));
    const attestationDepartments = new Set(record.reviewAttestations.map((attestation) => attestation.departmentId));
    const responseDepartments = new Set(artifact.public.responses.filter(isObject).map((response) => String(response.departmentId)));
    if (bindingDepartments.size !== 8 || attestationDepartments.size !== 8 || responseDepartments.size !== 8 || [...bindingDepartments].some((departmentId) => !attestationDepartments.has(departmentId) || !responseDepartments.has(departmentId))) throw new Error("public_exchange_review_department_mismatch");
  }
  assertNoForbiddenPublicValue(record);
  const expectedRecordId = `urn:stadtstack:public-exchange:${sha256({ caseId, artifactKind: "reviewed_citizen_brief_v1" }).slice("sha256:".length)}`;
  if (record.recordId !== expectedRecordId) throw new Error("public_exchange_record_id_invalid");
  const withoutChecksum = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "recordChecksum"));
  if (sha256(withoutChecksum) !== record.recordChecksum) throw new Error("public_exchange_record_checksum_invalid");
  return clone(record as PublicExchangeRecordV1);
}

function expectedExchangeTags(record: PublicExchangeRecordV1): string[][] {
  return [
    ["d", record.recordId],
    [...PUBLIC_EXCHANGE_FIXTURE_TAG],
    ["schema", PUBLIC_EXCHANGE_SCHEMA_VERSION],
    ["municipality", record.municipalityId],
    ["case", "sample-case"],
    ["artifact", record.artifact.kind],
    ["bot", "true"],
    ["node", PUBLIC_EXCHANGE_NODE],
    ["agent", PUBLIC_EXCHANGE_AGENT],
  ];
}

function parseSignedExchangeEvent(event: unknown): { event: NostrEvent; record: PublicExchangeRecordV1 } {
  if (!isObject(event)) throw new Error("public_exchange_event_invalid");
  assertExactKeys(event, ["content", "created_at", "id", "kind", "pubkey", "sig", "tags"], "public_exchange_event_unknown_field");
  if (!validateEvent(event as NostrEvent) || !verifyEvent(event as NostrEvent)) throw new Error("public_exchange_event_signature_invalid");
  if (event.kind !== PUBLIC_EXCHANGE_KIND || event.created_at !== PUBLIC_EXCHANGE_CREATED_AT || !HEX_64.test(nonEmptyString(event.pubkey, "public_exchange_event_invalid")) || !HEX_128.test(nonEmptyString(event.sig, "public_exchange_event_invalid"))) throw new Error("public_exchange_event_invalid");
  const recordValue: unknown = (() => { try { return JSON.parse(event.content as string); } catch { throw new Error("public_exchange_event_content_invalid"); } })();
  const record = validatePublicExchangeRecord(recordValue);
  if (event.pubkey !== record.signer.pubkey) throw new Error("public_exchange_event_signer_mismatch");
  if (canonicalJson(record) !== event.content) throw new Error("public_exchange_event_content_noncanonical");
  const expectedTags = expectedExchangeTags(record);
  if (!Array.isArray(event.tags) || event.tags.length !== expectedTags.length || event.tags.some((tag, index) => !Array.isArray(tag) || tag.length !== expectedTags[index]!.length || tag.some((part, partIndex) => part !== expectedTags[index]![partIndex]))) throw new Error("public_exchange_event_tags_invalid");
  if (getEventHash(event as NostrEvent) !== event.id) throw new Error("public_exchange_event_id_invalid");
  return { event: clone(event as NostrEvent), record };
}

export function reimportPublicExchangeEvent(event: NostrEvent): PublicExchangeRecordV1 {
  return parseSignedExchangeEvent(event).record;
}

function recordCoordinate(record: PublicExchangeRecordV1): string {
  return `${record.eventKind}:${record.signer.pubkey}:${record.recordId}`;
}

function normalizeRelayQueryFilter(filter: string | { kind: number; pubkey: string; d: string } | { recordId: string }): { recordId?: string; coordinate?: string } {
  if (typeof filter === "string") {
    if (!filter.startsWith("urn:stadtstack:public-exchange:")) throw new Error("public_exchange_relay_query_invalid");
    return { recordId: filter };
  }
  if (!isObject(filter)) throw new Error("public_exchange_relay_query_invalid");
  const candidate = filter as Record<string, unknown>;
  const keys = Object.keys(filter).sort();
  if (keys.length === 1 && keys[0] === "recordId") {
    if (typeof candidate.recordId !== "string" || !candidate.recordId.startsWith("urn:stadtstack:public-exchange:")) throw new Error("public_exchange_relay_query_invalid");
    return { recordId: candidate.recordId };
  }
  assertExactKeys(filter, ["kind", "pubkey", "d"], "public_exchange_relay_query_invalid");
  if (candidate.kind !== PUBLIC_EXCHANGE_KIND || typeof candidate.pubkey !== "string" || !HEX_64.test(candidate.pubkey) || typeof candidate.d !== "string" || !candidate.d.startsWith("urn:stadtstack:public-exchange:")) throw new Error("public_exchange_relay_query_invalid");
  return { coordinate: `${candidate.kind}:${candidate.pubkey}:${candidate.d}` };
}

export function createLocalPublicExchangeRelay(options: PublicExchangeRelayOptions = {}): PublicExchangeRelay {
  if (options.relayUrl !== undefined && options.relayUrl !== "memory://public-exchange") throw new Error("public_exchange_relay_external_url_forbidden");
  assertRegistryProof(options.registryProof ?? PUBLIC_EXCHANGE_REGISTRY_PROOF, options.registrySnapshot);
  const byCoordinate = new Map<string, { event: NostrEvent; record: PublicExchangeRecordV1 }>();
  let publishCount = 0;
  let queryCount = 0;
  let allowedSignerPubkey: string | undefined = options.allowedSignerPubkey;
  if (allowedSignerPubkey !== undefined && !HEX_64.test(allowedSignerPubkey)) throw new Error("public_exchange_relay_signer_invalid");
  return {
    get publishCount() { return publishCount; },
    get queryCount() { return queryCount; },
    async publish(event: NostrEvent): Promise<PublicExchangePublishReceipt> {
      publishCount += 1;
      const parsed = parseSignedExchangeEvent(event);
      const frameBytes = new TextEncoder().encode(JSON.stringify(event)).byteLength;
      const contentBytes = new TextEncoder().encode(event.content).byteLength;
      if (frameBytes > 131_072) throw new Error("public_exchange_relay_frame_too_large");
      if (contentBytes > 65_536) throw new Error("public_exchange_relay_content_too_large");
      if (allowedSignerPubkey === undefined) allowedSignerPubkey = parsed.event.pubkey;
      if (parsed.event.pubkey !== allowedSignerPubkey) throw new Error("public_exchange_relay_signer_mismatch");
      const coordinate = recordCoordinate(parsed.record);
      const existing = byCoordinate.get(coordinate);
      if (existing) {
        if (existing.event.id === parsed.event.id && existing.record.recordChecksum === parsed.record.recordChecksum) {
          return { schemaVersion: "public_exchange_relay_v1", relayUrl: "memory://public-exchange", eventId: parsed.event.id, ok: true, ack: ["OK", parsed.event.id, true] };
        }
        if (existing.record.artifact.correctionState === "retracted") throw new Error("public_exchange_relay_coordinate_retracted");
        const relation = parsed.record.correctionReference;
        if (relation.relation === "none" || relation.recordId !== existing.record.recordId || relation.priorChecksum !== existing.record.recordChecksum || parsed.record.artifact.version <= existing.record.artifact.version) throw new Error("public_exchange_relay_address_conflict");
      } else if (parsed.record.correctionReference.relation !== "none") {
        throw new Error("public_exchange_relay_prior_missing");
      }
      byCoordinate.set(coordinate, { event: clone(parsed.event), record: clone(parsed.record) });
      return { schemaVersion: "public_exchange_relay_v1", relayUrl: "memory://public-exchange", eventId: parsed.event.id, ok: true, ack: ["OK", parsed.event.id, true] };
    },
    async query(filter: string | { kind: number; pubkey: string; d: string } | { recordId: string }): Promise<PublicExchangeQueryReceipt> {
      queryCount += 1;
      const normalized = normalizeRelayQueryFilter(filter);
      const match = normalized.recordId !== undefined
        ? [...byCoordinate.values()].find((entry) => entry.record.recordId === normalized.recordId)
        : byCoordinate.get(normalized.coordinate!);
      if (!match) throw new Error("public_exchange_relay_record_not_found");
      return { schemaVersion: "public_exchange_relay_v1", relayUrl: "memory://public-exchange", recordId: match.record.recordId, events: [clone(match.event)], eose: true };
    },
    reimport(event: NostrEvent): PublicExchangeRecordV1 {
      return reimportPublicExchangeEvent(event);
    },
  };
}

export type PublicExchangeAdapter = {
  createCurrentRecord(): PublicExchangeRecordV1;
  createCorrectionRecord(previous: PublicExchangeRecordV1): PublicExchangeRecordV1;
  createRetractionRecord(previous: PublicExchangeRecordV1): PublicExchangeRecordV1;
  sign(record: PublicExchangeRecordV1): NostrEvent;
  publishAndQuery(record: PublicExchangeRecordV1): Promise<{ publish: PublicExchangePublishReceipt; query: PublicExchangeQueryReceipt; event: NostrEvent }>;
  reimport(event: NostrEvent): PublicExchangeRecordV1;
};

function assertActor(actor: ActorBinding): void {
  if (!isObject(actor)) throw new Error("public_exchange_actor_invalid");
  assertExactKeys(actor, ["actorId", "actorClass"], "public_exchange_actor_invalid");
  if (typeof actor.actorId !== "string" || actor.actorId.trim() === "" || actor.actorClass !== "public") throw new Error("public_exchange_actor_invalid");
}

export function createPublicExchangeAdapter(options: PublicExchangeAdapterOptions & { relay: PublicExchangeRelay }): PublicExchangeAdapter {
  if (!isObject(options) || !isObject(options.source) || typeof options.source.project !== "function") throw new Error("public_exchange_source_invalid");
  if (Object.prototype.hasOwnProperty.call(options.source, "handle")) throw new Error("public_exchange_source_handle_forbidden");
  nonEmptyString(options.caseId, "public_exchange_case_id_required");
  nonEmptyString(options.policyVersion, "public_exchange_policy_version_required");
  assertActor(options.publicActor);
  assertRegistryProof(options.registryProof ?? PUBLIC_EXCHANGE_REGISTRY_PROOF, options.registrySnapshot);
  const source = options.source;
  const projectCurrent = (): ProjectionEnvelope => {
    const query: QueryEnvelope = {
      schemaVersion: "query_envelope_v1",
      queryType: "case_projection_v1",
      caseId: options.caseId,
      actorBinding: clone(options.publicActor),
      visibility: "public",
      policyVersion: options.policyVersion,
      atCaseVersion: null,
    };
    const envelope = source.project(query);
    return clone(envelope);
  };
  const createCurrentRecord = (): PublicExchangeRecordV1 => {
    const record = mapRecord(projectCurrent(), { caseId: options.caseId, policyVersion: options.policyVersion, signer: options.signer });
    validatePublicExchangeRecord(record);
    return clone(record);
  };
  const createCorrectionRecord = (previous: PublicExchangeRecordV1): PublicExchangeRecordV1 => {
    const prior = validatePublicExchangeRecord(previous);
    if (prior.artifact.correctionState !== "current" || prior.correctionReference.relation === "retracts") throw new Error("public_exchange_correction_prior_invalid");
    const current = mapRecord(projectCurrent(), { caseId: options.caseId, policyVersion: options.policyVersion, signer: options.signer, artifactVersion: prior.artifact.version + 1, correctionReference: { relation: "corrects", recordId: prior.recordId, priorChecksum: prior.recordChecksum } });
    if (current.artifact.checksum === prior.artifact.checksum || current.caseVersion <= prior.caseVersion) throw new Error("public_exchange_correction_unchanged");
    return validatePublicExchangeRecord(current);
  };
  const createRetractionRecord = (previous: PublicExchangeRecordV1): PublicExchangeRecordV1 => {
    const prior = validatePublicExchangeRecord(previous);
    if (prior.artifact.correctionState !== "current" || prior.correctionReference.relation === "retracts") throw new Error("public_exchange_retraction_prior_invalid");
    const current = mapRecord(projectCurrent(), { caseId: options.caseId, policyVersion: options.policyVersion, signer: options.signer, artifactVersion: prior.artifact.version + 1, correctionReference: { relation: "retracts", recordId: prior.recordId, priorChecksum: prior.recordChecksum } });
    if (current.artifact.checksum !== prior.artifact.checksum) throw new Error("public_exchange_retraction_stale");
    current.artifact.correctionState = "retracted";
    current.artifact.public = null;
    current.recordChecksum = sha256(Object.fromEntries(Object.entries(current).filter(([key]) => key !== "recordChecksum")));
    return validatePublicExchangeRecord(current);
  };
  const sign = (record: PublicExchangeRecordV1): NostrEvent => signPublicExchangeRecord(validatePublicExchangeRecord(record), options.signer);
  const reimport = (event: NostrEvent): PublicExchangeRecordV1 => {
    const imported = reimportPublicExchangeEvent(event);
    if (imported.signer.pubkey !== signerProjection(options.signer).pubkey) throw new Error("public_exchange_signer_mismatch");
    return imported;
  };
  const publishAndQuery = async (record: PublicExchangeRecordV1) => {
    const event = sign(record);
    const publish = await options.relay.publish(event);
    const query = await options.relay.query({ kind: PUBLIC_EXCHANGE_KIND, pubkey: event.pubkey, d: record.recordId });
    if (query.events.length !== 1 || query.events[0]!.id !== event.id || query.eose !== true) throw new Error("public_exchange_relay_query_invalid");
    return { publish, query, event: clone(event) };
  };
  return Object.freeze({ createCurrentRecord, createCorrectionRecord, createRetractionRecord, sign, publishAndQuery, reimport });
}
