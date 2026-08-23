import { createHash, createPublicKey, verify as verifyEd25519 } from "node:crypto";
import { types as utilTypes } from "node:util";

import { verifyCaseShutdownSeal, type CaseShutdownSealV2 } from "./case-shutdown-seal.ts";

/** Pure, credential-free verifier for an Operations-reviewed recovery point.
 * It deliberately has no filesystem, bucket, Kubernetes, deployment, or civic
 * capability. The only non-local authority it accepts is signed evidence
 * supplied through narrowly captured source ports. */

export type StagingCaseRecoverySource = Readonly<{ read(): unknown }>;
export type StagingCaseRecoveryClock = Readonly<{ now(): unknown }>;

export type StagingCaseRecoveryGateInput = Readonly<{
  recoveryPolicySource: StagingCaseRecoverySource;
  recoveryPolicyPinSource: StagingCaseRecoverySource;
  shutdownSealSource: StagingCaseRecoverySource;
  catalogLocatorSource: StagingCaseRecoverySource;
  recoveryAttestationSource: StagingCaseRecoverySource;
  clock: StagingCaseRecoveryClock;
}>;

export type StagingCaseRecoveryGate = Readonly<{
  readonly schemaVersion: "staging_case_recovery_gate_v2";
}>;

export type StagingCaseRecoveryGateFacts = Readonly<{
  municipalityId: string;
  sourceReleaseDigest: string;
  sourcePvcNamespace: string;
  sourcePvcName: string;
  sourcePvcUid: string;
  sourceDeploymentClaimChecksum: string;
  controlDeploymentBindingChecksum: string;
  targetPvcNamespace: string;
  targetPvcName: string;
  targetPvcUid: string;
  targetPvName: string;
  recoveryOperationId: string;
  recoveryAttestationChecksum: string;
  shutdownSealChecksum: string;
  shutdownClosedAtUtc: string;
  databaseBasename: string;
  databaseByteLength: number;
  databaseSha256: string;
  expiresAtUtc: string;
  verifiedAtUtc: string;
}>;

type RecoveryPolicy = Readonly<{
  schemaVersion: "staging_case_recovery_policy_v1";
  deploymentEnvironment: "staging";
  municipalityId: string;
  storeId: string;
  sourcePvc: Readonly<{ namespace: string; name: string; uid: string }>;
  targetPvc: Readonly<{ namespace: string; name: string; uid: string }>;
  targetPvName: string;
  recoveryOperationId: string;
  controlDeploymentBindingChecksum: string;
  catalogLocatorChecksum: string;
  restoreVerifierReleaseDigest: string;
  signer: Readonly<{
    algorithm: "Ed25519";
    purpose: "staging_case_recovery_attestation";
    status: "active";
    keyId: string;
    keyVersion: string;
    spkiDerBase64url: string;
    spkiSha256: string;
    activeFromUtc: string;
    activeUntilUtc: string;
  }>;
  maxAgeSeconds: 86400;
  maxRtoSeconds: 14400;
  policyChecksum: string;
}>;

type ObjectLocator = Readonly<{
  bucket: string;
  key: string;
  objectVersion: string;
  checksum: string;
}>;

type CatalogLocator = Readonly<{
  schemaVersion: "case_backup_catalog_locator_v1";
  deploymentEnvironment: "staging";
  municipalityId: string;
  storeId: string;
  recoveryOperationId: string;
  casGeneration: string;
  backupId: string;
  completionReceipt: ObjectLocator & Readonly<{ keyVersion: string }>;
  encryptedManifest: ObjectLocator;
  retentionUntilUtc: string;
  locatorChecksum: string;
}>;

type RecoveryAttestation = Readonly<{
  schemaVersion: "staging_case_recovery_attestation_v2";
  deploymentEnvironment: "staging";
  municipalityId: string;
  storeId: string;
  recoveryOperationId: string;
  policyChecksum: string;
  controlDeploymentBindingChecksum: string;
  catalogLocatorChecksum: string;
  casGeneration: string;
  backupId: string;
  completionReceipt: ObjectLocator & Readonly<{ keyVersion: string }>;
  encryptedManifest: ObjectLocator;
  sourcePvcUid: string;
  targetPvcUid: string;
  targetPvName: string;
  seal: Readonly<{
    sealChecksum: string;
    closedAtUtc: string;
    databaseSchemaVersion: string;
    configFingerprint: string;
    sourceReleaseDigest: string;
    deploymentClaimChecksum: string;
    databaseBasename: string;
    databaseByteLength: number;
    databaseSha256: string;
    recoveryEvidenceChecksum: string;
    caseCount: number;
    outboxCursor: number;
    headsAggregateChecksum: string;
    publicProjectionChecksum: string;
  }>;
  restoreReport: Readonly<{
    restoreReportChecksum: string;
    verifierReleaseDigest: string;
    restoredDatabaseByteLength: number;
    restoredDatabaseSha256: string;
    integrity: "ok";
    recoveryEvidenceChecksum: string;
    caseCount: number;
    outboxCursor: number;
    headsAggregateChecksum: string;
    publicProjectionChecksum: string;
    isolatedRestore: true;
    startedAtUtc: string;
    completedAtUtc: string;
    rtoSeconds: number;
  }>;
  issuedAtUtc: string;
  expiresAtUtc: string;
  signerKeyId: string;
  signerKeyVersion: string;
  signatureAlgorithm: "Ed25519";
  attestationChecksum: string;
  signature: string;
}>;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const MUNICIPALITY = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const KUBE_NAME = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u;
const KUBE_UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const DECIMAL = /^[1-9][0-9]{0,18}$/u;
type StoredStagingCaseRecoveryGateFacts = Omit<StagingCaseRecoveryGateFacts, "verifiedAtUtc">;
const gateFacts = new WeakMap<object, StoredStagingCaseRecoveryGateFacts>();

function fail(code: string): never { throw new Error(code); }

function exactRecord(value: unknown, fields: readonly string[], code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" || !fields.includes(key))) fail(code);
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail(code);
  }
  return value as Record<string, unknown>;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object" && !utilTypes.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0))) return JSON.stringify(value);
  fail("staging_case_recovery_value_invalid");
}

function checksum(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function text(value: unknown, expression: RegExp, maxBytes: number, code: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || Buffer.byteLength(value, "utf8") > maxBytes || !expression.test(value)) fail(code);
  return value;
}

function identifier(value: unknown, code: string): string { return text(value, KUBE_NAME, 253, code); }
function checksumValue(value: unknown, code: string): string { return text(value, SHA256, 71, code); }
function uuidV7(value: unknown, code: string): string { return text(value, UUID_V7, 36, code); }
function decimal(value: unknown, code: string): string { return text(value, DECIMAL, 19, code); }

function utc(value: unknown, code: string): string {
  if (typeof value !== "string" || !UTC.test(value)) fail(code);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail(code);
  return value;
}

function instant(value: string): number { return new Date(value).getTime(); }

function safeCount(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 10_000) fail(code);
  return value as number;
}

function nonnegativeInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(code);
  return value as number;
}

function positiveBytes(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) fail(code);
  return value as number;
}

function base64url(value: unknown, code: string): string {
  const parsed = text(value, BASE64URL, 16_384, code);
  let bytes: Buffer;
  try { bytes = Buffer.from(parsed, "base64url"); } catch { fail(code); }
  if (bytes.length === 0 || bytes.toString("base64url") !== parsed) fail(code);
  return parsed;
}

function ed25519Signature(value: unknown, code: string): string {
  const parsed = base64url(value, code);
  if (Buffer.from(parsed, "base64url").length !== 64) fail(code);
  return parsed;
}

function parsePvc(value: unknown, code: string): Readonly<{ namespace: string; name: string; uid: string }> {
  const record = exactRecord(value, ["namespace", "name", "uid"], code);
  return Object.freeze({
    namespace: identifier(record.namespace, code),
    name: identifier(record.name, code),
    uid: text(record.uid, KUBE_UID, 36, code),
  });
}

function parseObjectLocator(value: unknown, code: string, needsKeyVersion = false): ObjectLocator & Readonly<{ keyVersion?: string }> {
  const fields = needsKeyVersion ? ["bucket", "key", "objectVersion", "checksum", "keyVersion"] : ["bucket", "key", "objectVersion", "checksum"];
  const record = exactRecord(value, fields, code);
  const bucket = text(record.bucket, KUBE_NAME, 253, code);
  const key = text(record.key, /^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$/u, 1024, code);
  const objectVersion = text(record.objectVersion, /^[A-Za-z0-9][A-Za-z0-9._~+/=:-]{0,511}$/u, 512, code);
  const parsed = { bucket, key, objectVersion, checksum: checksumValue(record.checksum, code) };
  if (!needsKeyVersion) return Object.freeze(parsed);
  return Object.freeze({ ...parsed, keyVersion: text(record.keyVersion, /^[A-Za-z0-9._-]{1,128}$/u, 128, code) });
}

function policyBody(policy: Omit<RecoveryPolicy, "policyChecksum">): Record<string, unknown> {
  return {
    schemaVersion: policy.schemaVersion, deploymentEnvironment: policy.deploymentEnvironment, municipalityId: policy.municipalityId,
    storeId: policy.storeId, sourcePvc: policy.sourcePvc, targetPvc: policy.targetPvc, targetPvName: policy.targetPvName,
    recoveryOperationId: policy.recoveryOperationId, controlDeploymentBindingChecksum: policy.controlDeploymentBindingChecksum,
    catalogLocatorChecksum: policy.catalogLocatorChecksum, restoreVerifierReleaseDigest: policy.restoreVerifierReleaseDigest,
    signer: policy.signer, maxAgeSeconds: policy.maxAgeSeconds, maxRtoSeconds: policy.maxRtoSeconds,
  };
}

function parsePolicy(value: unknown): RecoveryPolicy {
  const record = exactRecord(value, [
    "schemaVersion", "deploymentEnvironment", "municipalityId", "storeId", "sourcePvc", "targetPvc", "targetPvName",
    "recoveryOperationId", "controlDeploymentBindingChecksum", "catalogLocatorChecksum", "restoreVerifierReleaseDigest", "signer",
    "maxAgeSeconds", "maxRtoSeconds", "policyChecksum",
  ], "staging_case_recovery_policy_invalid");
  const signer = exactRecord(record.signer, [
    "algorithm", "purpose", "status", "keyId", "keyVersion", "spkiDerBase64url", "spkiSha256", "activeFromUtc", "activeUntilUtc",
  ], "staging_case_recovery_policy_invalid");
  if (record.schemaVersion !== "staging_case_recovery_policy_v1" || record.deploymentEnvironment !== "staging" ||
    record.maxAgeSeconds !== 86400 || record.maxRtoSeconds !== 14400) fail("staging_case_recovery_policy_invalid");
  const parsed = Object.freeze({
    schemaVersion: "staging_case_recovery_policy_v1" as const,
    deploymentEnvironment: "staging" as const,
    municipalityId: text(record.municipalityId, MUNICIPALITY, 63, "staging_case_recovery_policy_invalid"),
    storeId: identifier(record.storeId, "staging_case_recovery_policy_invalid"),
    sourcePvc: parsePvc(record.sourcePvc, "staging_case_recovery_policy_invalid"),
    targetPvc: parsePvc(record.targetPvc, "staging_case_recovery_policy_invalid"),
    targetPvName: identifier(record.targetPvName, "staging_case_recovery_policy_invalid"),
    recoveryOperationId: uuidV7(record.recoveryOperationId, "staging_case_recovery_policy_invalid"),
    controlDeploymentBindingChecksum: checksumValue(record.controlDeploymentBindingChecksum, "staging_case_recovery_policy_invalid"),
    catalogLocatorChecksum: checksumValue(record.catalogLocatorChecksum, "staging_case_recovery_policy_invalid"),
    restoreVerifierReleaseDigest: checksumValue(record.restoreVerifierReleaseDigest, "staging_case_recovery_policy_invalid"),
    signer: Object.freeze({
      algorithm: signer.algorithm === "Ed25519" ? "Ed25519" as const : fail("staging_case_recovery_policy_invalid"),
      purpose: signer.purpose === "staging_case_recovery_attestation"
        ? "staging_case_recovery_attestation" as const
        : fail("staging_case_recovery_policy_invalid"),
      status: signer.status === "active" ? "active" as const : fail("staging_case_recovery_policy_invalid"),
      keyId: text(signer.keyId, /^[A-Za-z0-9._-]{1,128}$/u, 128, "staging_case_recovery_policy_invalid"),
      keyVersion: text(signer.keyVersion, /^[A-Za-z0-9._-]{1,128}$/u, 128, "staging_case_recovery_policy_invalid"),
      spkiDerBase64url: base64url(signer.spkiDerBase64url, "staging_case_recovery_policy_invalid"),
      spkiSha256: checksumValue(signer.spkiSha256, "staging_case_recovery_policy_invalid"),
      activeFromUtc: utc(signer.activeFromUtc, "staging_case_recovery_policy_invalid"),
      activeUntilUtc: utc(signer.activeUntilUtc, "staging_case_recovery_policy_invalid"),
    }),
    maxAgeSeconds: 86400 as const,
    maxRtoSeconds: 14400 as const,
    policyChecksum: checksumValue(record.policyChecksum, "staging_case_recovery_policy_invalid"),
  });
  if (parsed.sourcePvc.uid === parsed.targetPvc.uid || instant(parsed.signer.activeFromUtc) >= instant(parsed.signer.activeUntilUtc) ||
    checksum(policyBody(parsed)) !== parsed.policyChecksum) fail("staging_case_recovery_policy_invalid");
  const actualSpkiChecksum = `sha256:${createHash("sha256").update(Buffer.from(parsed.signer.spkiDerBase64url, "base64url")).digest("hex")}`;
  if (actualSpkiChecksum !== parsed.signer.spkiSha256) fail("staging_case_recovery_policy_invalid");
  return parsed;
}

function catalogBody(locator: Omit<CatalogLocator, "locatorChecksum">): Record<string, unknown> {
  return {
    schemaVersion: locator.schemaVersion, deploymentEnvironment: locator.deploymentEnvironment,
    municipalityId: locator.municipalityId, storeId: locator.storeId,
    recoveryOperationId: locator.recoveryOperationId, casGeneration: locator.casGeneration, backupId: locator.backupId,
    completionReceipt: locator.completionReceipt, encryptedManifest: locator.encryptedManifest, retentionUntilUtc: locator.retentionUntilUtc,
  };
}

function parseCatalog(value: unknown): CatalogLocator {
  const record = exactRecord(value, [
    "schemaVersion", "deploymentEnvironment", "municipalityId", "storeId", "recoveryOperationId", "casGeneration", "backupId", "completionReceipt",
    "encryptedManifest", "retentionUntilUtc", "locatorChecksum",
  ], "staging_case_recovery_catalog_invalid");
  if (record.schemaVersion !== "case_backup_catalog_locator_v1" || record.deploymentEnvironment !== "staging") {
    fail("staging_case_recovery_catalog_invalid");
  }
  const receipt = parseObjectLocator(record.completionReceipt, "staging_case_recovery_catalog_invalid", true);
  const parsed = Object.freeze({
    schemaVersion: "case_backup_catalog_locator_v1" as const,
    deploymentEnvironment: "staging" as const,
    municipalityId: text(record.municipalityId, MUNICIPALITY, 63, "staging_case_recovery_catalog_invalid"),
    storeId: identifier(record.storeId, "staging_case_recovery_catalog_invalid"),
    recoveryOperationId: uuidV7(record.recoveryOperationId, "staging_case_recovery_catalog_invalid"),
    casGeneration: decimal(record.casGeneration, "staging_case_recovery_catalog_invalid"),
    backupId: uuidV7(record.backupId, "staging_case_recovery_catalog_invalid"),
    completionReceipt: Object.freeze({ ...receipt, keyVersion: receipt.keyVersion! }),
    encryptedManifest: parseObjectLocator(record.encryptedManifest, "staging_case_recovery_catalog_invalid"),
    retentionUntilUtc: utc(record.retentionUntilUtc, "staging_case_recovery_catalog_invalid"),
    locatorChecksum: checksumValue(record.locatorChecksum, "staging_case_recovery_catalog_invalid"),
  });
  if (checksum(catalogBody(parsed)) !== parsed.locatorChecksum || parsed.completionReceipt.bucket === parsed.encryptedManifest.bucket &&
    parsed.completionReceipt.key === parsed.encryptedManifest.key && parsed.completionReceipt.objectVersion === parsed.encryptedManifest.objectVersion) {
    fail("staging_case_recovery_catalog_invalid");
  }
  return parsed;
}

function attestationBody(value: Omit<RecoveryAttestation, "attestationChecksum" | "signature">): Record<string, unknown> {
  return {
    schemaVersion: value.schemaVersion, deploymentEnvironment: value.deploymentEnvironment,
    municipalityId: value.municipalityId, storeId: value.storeId, recoveryOperationId: value.recoveryOperationId,
    policyChecksum: value.policyChecksum, controlDeploymentBindingChecksum: value.controlDeploymentBindingChecksum,
    catalogLocatorChecksum: value.catalogLocatorChecksum, casGeneration: value.casGeneration, backupId: value.backupId,
    completionReceipt: value.completionReceipt, encryptedManifest: value.encryptedManifest, sourcePvcUid: value.sourcePvcUid,
    targetPvcUid: value.targetPvcUid, targetPvName: value.targetPvName, seal: value.seal, restoreReport: value.restoreReport,
    issuedAtUtc: value.issuedAtUtc, expiresAtUtc: value.expiresAtUtc, signerKeyId: value.signerKeyId,
    signerKeyVersion: value.signerKeyVersion, signatureAlgorithm: value.signatureAlgorithm,
  };
}

function signedEnvelope(value: RecoveryAttestation): Record<string, unknown> {
  return { ...attestationBody(value), attestationChecksum: value.attestationChecksum };
}

function parseSealBinding(value: unknown, code: string): RecoveryAttestation["seal"] {
  const record = exactRecord(value, [
    "sealChecksum", "closedAtUtc", "databaseSchemaVersion", "configFingerprint", "sourceReleaseDigest", "deploymentClaimChecksum", "databaseBasename",
    "databaseByteLength", "databaseSha256", "recoveryEvidenceChecksum", "caseCount", "outboxCursor", "headsAggregateChecksum", "publicProjectionChecksum",
  ], code);
  return Object.freeze({
    sealChecksum: checksumValue(record.sealChecksum, code), closedAtUtc: utc(record.closedAtUtc, code),
    databaseSchemaVersion: text(record.databaseSchemaVersion, /^[A-Za-z0-9._-]{1,128}$/u, 128, code),
    configFingerprint: checksumValue(record.configFingerprint, code), sourceReleaseDigest: checksumValue(record.sourceReleaseDigest, code),
    deploymentClaimChecksum: checksumValue(record.deploymentClaimChecksum, code),
    databaseBasename: text(record.databaseBasename, /^[A-Za-z0-9._-]{1,256}$/u, 256, code),
    databaseByteLength: positiveBytes(record.databaseByteLength, code), databaseSha256: checksumValue(record.databaseSha256, code),
    recoveryEvidenceChecksum: checksumValue(record.recoveryEvidenceChecksum, code), caseCount: safeCount(record.caseCount, code),
    outboxCursor: nonnegativeInteger(record.outboxCursor, code), headsAggregateChecksum: checksumValue(record.headsAggregateChecksum, code),
    publicProjectionChecksum: checksumValue(record.publicProjectionChecksum, code),
  });
}

function restoreReportBody(report: RecoveryAttestation["restoreReport"]): Record<string, unknown> {
  return {
    verifierReleaseDigest: report.verifierReleaseDigest,
    restoredDatabaseByteLength: report.restoredDatabaseByteLength,
    restoredDatabaseSha256: report.restoredDatabaseSha256,
    integrity: report.integrity,
    recoveryEvidenceChecksum: report.recoveryEvidenceChecksum,
    caseCount: report.caseCount,
    outboxCursor: report.outboxCursor,
    headsAggregateChecksum: report.headsAggregateChecksum,
    publicProjectionChecksum: report.publicProjectionChecksum,
    isolatedRestore: report.isolatedRestore,
    startedAtUtc: report.startedAtUtc,
    completedAtUtc: report.completedAtUtc,
    rtoSeconds: report.rtoSeconds,
  };
}

function parseRestoreReport(value: unknown, code: string): RecoveryAttestation["restoreReport"] {
  const record = exactRecord(value, [
    "restoreReportChecksum", "verifierReleaseDigest", "restoredDatabaseByteLength", "restoredDatabaseSha256", "integrity",
    "recoveryEvidenceChecksum", "caseCount", "outboxCursor", "headsAggregateChecksum", "publicProjectionChecksum", "isolatedRestore",
    "startedAtUtc", "completedAtUtc", "rtoSeconds",
  ], code);
  if (record.integrity !== "ok" || record.isolatedRestore !== true || !Number.isSafeInteger(record.rtoSeconds) ||
    (record.rtoSeconds as number) < 0) fail(code);
  const parsed = Object.freeze({
    restoreReportChecksum: checksumValue(record.restoreReportChecksum, code), verifierReleaseDigest: checksumValue(record.verifierReleaseDigest, code),
    restoredDatabaseByteLength: positiveBytes(record.restoredDatabaseByteLength, code), restoredDatabaseSha256: checksumValue(record.restoredDatabaseSha256, code),
    integrity: "ok" as const, recoveryEvidenceChecksum: checksumValue(record.recoveryEvidenceChecksum, code), caseCount: safeCount(record.caseCount, code),
    outboxCursor: nonnegativeInteger(record.outboxCursor, code), headsAggregateChecksum: checksumValue(record.headsAggregateChecksum, code),
    publicProjectionChecksum: checksumValue(record.publicProjectionChecksum, code), isolatedRestore: true as const,
    startedAtUtc: utc(record.startedAtUtc, code), completedAtUtc: utc(record.completedAtUtc, code),
    rtoSeconds: nonnegativeInteger(record.rtoSeconds, code),
  });
  if (checksum(restoreReportBody(parsed)) !== parsed.restoreReportChecksum) {
    fail("staging_case_recovery_restore_report_checksum_invalid");
  }
  return parsed;
}

function parseAttestation(value: unknown): RecoveryAttestation {
  const record = exactRecord(value, [
    "schemaVersion", "deploymentEnvironment", "municipalityId", "storeId", "recoveryOperationId", "policyChecksum", "controlDeploymentBindingChecksum",
    "catalogLocatorChecksum", "casGeneration", "backupId", "completionReceipt", "encryptedManifest", "sourcePvcUid", "targetPvcUid",
    "targetPvName", "seal", "restoreReport", "issuedAtUtc", "expiresAtUtc", "signerKeyId", "signerKeyVersion", "signatureAlgorithm",
    "attestationChecksum", "signature",
  ], "staging_case_recovery_attestation_invalid");
  if (record.schemaVersion !== "staging_case_recovery_attestation_v2" || record.deploymentEnvironment !== "staging") {
    fail("staging_case_recovery_attestation_invalid");
  }
  const receipt = parseObjectLocator(record.completionReceipt, "staging_case_recovery_attestation_invalid", true);
  const parsed = Object.freeze({
    schemaVersion: "staging_case_recovery_attestation_v2" as const,
    deploymentEnvironment: "staging" as const,
    municipalityId: text(record.municipalityId, MUNICIPALITY, 63, "staging_case_recovery_attestation_invalid"),
    storeId: identifier(record.storeId, "staging_case_recovery_attestation_invalid"),
    recoveryOperationId: uuidV7(record.recoveryOperationId, "staging_case_recovery_attestation_invalid"),
    policyChecksum: checksumValue(record.policyChecksum, "staging_case_recovery_attestation_invalid"),
    controlDeploymentBindingChecksum: checksumValue(record.controlDeploymentBindingChecksum, "staging_case_recovery_attestation_invalid"),
    catalogLocatorChecksum: checksumValue(record.catalogLocatorChecksum, "staging_case_recovery_attestation_invalid"),
    casGeneration: decimal(record.casGeneration, "staging_case_recovery_attestation_invalid"), backupId: uuidV7(record.backupId, "staging_case_recovery_attestation_invalid"),
    completionReceipt: Object.freeze({ ...receipt, keyVersion: receipt.keyVersion! }), encryptedManifest: parseObjectLocator(record.encryptedManifest, "staging_case_recovery_attestation_invalid"),
    sourcePvcUid: text(record.sourcePvcUid, KUBE_UID, 36, "staging_case_recovery_attestation_invalid"), targetPvcUid: text(record.targetPvcUid, KUBE_UID, 36, "staging_case_recovery_attestation_invalid"),
    targetPvName: identifier(record.targetPvName, "staging_case_recovery_attestation_invalid"), seal: parseSealBinding(record.seal, "staging_case_recovery_attestation_invalid"),
    restoreReport: parseRestoreReport(record.restoreReport, "staging_case_recovery_attestation_invalid"), issuedAtUtc: utc(record.issuedAtUtc, "staging_case_recovery_attestation_invalid"),
    expiresAtUtc: utc(record.expiresAtUtc, "staging_case_recovery_attestation_invalid"), signerKeyId: text(record.signerKeyId, /^[A-Za-z0-9._-]{1,128}$/u, 128, "staging_case_recovery_attestation_invalid"),
    signerKeyVersion: text(record.signerKeyVersion, /^[A-Za-z0-9._-]{1,128}$/u, 128, "staging_case_recovery_attestation_invalid"),
    signatureAlgorithm: record.signatureAlgorithm === "Ed25519" ? "Ed25519" as const : fail("staging_case_recovery_attestation_invalid"),
    attestationChecksum: checksumValue(record.attestationChecksum, "staging_case_recovery_attestation_invalid"),
    signature: ed25519Signature(record.signature, "staging_case_recovery_attestation_invalid"),
  });
  if (checksum(attestationBody(parsed)) !== parsed.attestationChecksum) fail("staging_case_recovery_attestation_checksum_invalid");
  return parsed;
}

function captureSource(value: unknown, code: string): StagingCaseRecoverySource {
  const record = exactRecord(value, ["read"], code);
  if (typeof record.read !== "function" || utilTypes.isProxy(record.read)) fail(code);
  return Object.freeze({ read: record.read as () => unknown });
}

function captureClock(value: unknown): StagingCaseRecoveryClock {
  const record = exactRecord(value, ["now"], "staging_case_recovery_clock_invalid");
  if (typeof record.now !== "function" || utilTypes.isProxy(record.now)) fail("staging_case_recovery_clock_invalid");
  return Object.freeze({ now: record.now as () => unknown });
}

function readClock(clock: StagingCaseRecoveryClock): string {
  let rawNow: unknown;
  try { rawNow = clock.now(); } catch { fail("staging_case_recovery_clock_unavailable"); }
  return utc(rawNow, "staging_case_recovery_clock_invalid");
}

function sourceValue(source: StagingCaseRecoverySource, unavailable: string): unknown {
  try { return source.read(); } catch { fail(unavailable); }
}

function recoveryEvidenceChecksum(seal: CaseShutdownSealV2): string { return checksum(seal.recoveryEvidence); }

function sameLocator(a: ObjectLocator, b: ObjectLocator): boolean {
  return a.bucket === b.bucket && a.key === b.key && a.objectVersion === b.objectVersion && a.checksum === b.checksum;
}

function verifySignature(policy: RecoveryPolicy, attestation: RecoveryAttestation): void {
  if (attestation.signerKeyId !== policy.signer.keyId || attestation.signerKeyVersion !== policy.signer.keyVersion ||
    attestation.signatureAlgorithm !== policy.signer.algorithm) fail("staging_case_recovery_attestation_signer_invalid");
  let key: ReturnType<typeof createPublicKey>;
  try { key = createPublicKey({ key: Buffer.from(policy.signer.spkiDerBase64url, "base64url"), format: "der", type: "spki" }); }
  catch { fail("staging_case_recovery_attestation_key_invalid"); }
  if (key.asymmetricKeyType !== "ed25519") fail("staging_case_recovery_attestation_key_invalid");
  let canonicalSpki: Buffer;
  try {
    const exported = key.export({ format: "der", type: "spki" });
    canonicalSpki = Buffer.isBuffer(exported) ? exported : Buffer.from(exported);
  } catch { fail("staging_case_recovery_attestation_key_invalid"); }
  if (!canonicalSpki.equals(Buffer.from(policy.signer.spkiDerBase64url, "base64url"))) {
    fail("staging_case_recovery_attestation_key_invalid");
  }
  const message = Buffer.from(`stadtstack:staging-case-recovery-attestation:v2\0${canonical(signedEnvelope(attestation))}`, "utf8");
  try {
    if (!verifySignatureNode(message, key, Buffer.from(attestation.signature, "base64url"))) fail("staging_case_recovery_attestation_signature_invalid");
  } catch (error) {
    if (error instanceof Error && error.message === "staging_case_recovery_attestation_signature_invalid") throw error;
    fail("staging_case_recovery_attestation_signature_invalid");
  }
}

function verifySignatureNode(message: Buffer, key: ReturnType<typeof createPublicKey>, signature: Buffer): boolean {
  return verifyEd25519(null, message, key, signature);
}

function verifyBindings(policy: RecoveryPolicy, catalog: CatalogLocator, seal: CaseShutdownSealV2, attestation: RecoveryAttestation, now: string): void {
  const evidence = seal.recoveryEvidence;
  const sealFacts = attestation.seal;
  if (catalog.deploymentEnvironment !== policy.deploymentEnvironment || attestation.deploymentEnvironment !== policy.deploymentEnvironment ||
    catalog.locatorChecksum !== policy.catalogLocatorChecksum || catalog.municipalityId !== policy.municipalityId || catalog.storeId !== policy.storeId ||
    catalog.recoveryOperationId !== policy.recoveryOperationId || attestation.municipalityId !== policy.municipalityId || attestation.storeId !== policy.storeId ||
    attestation.recoveryOperationId !== policy.recoveryOperationId || attestation.policyChecksum !== policy.policyChecksum ||
    attestation.controlDeploymentBindingChecksum !== policy.controlDeploymentBindingChecksum || attestation.catalogLocatorChecksum !== catalog.locatorChecksum ||
    attestation.casGeneration !== catalog.casGeneration || attestation.backupId !== catalog.backupId ||
    !sameLocator(attestation.completionReceipt, catalog.completionReceipt) || attestation.completionReceipt.keyVersion !== catalog.completionReceipt.keyVersion ||
    !sameLocator(attestation.encryptedManifest, catalog.encryptedManifest) || attestation.sourcePvcUid !== policy.sourcePvc.uid ||
    attestation.targetPvcUid !== policy.targetPvc.uid || attestation.targetPvcUid === attestation.sourcePvcUid || attestation.targetPvName !== policy.targetPvName ||
    sealFacts.sealChecksum !== seal.sealChecksum || sealFacts.closedAtUtc !== seal.closedAtUtc || sealFacts.databaseSchemaVersion !== seal.databaseSchemaVersion ||
    sealFacts.configFingerprint !== seal.configFingerprint || sealFacts.sourceReleaseDigest !== seal.sourceReleaseDigest ||
    sealFacts.deploymentClaimChecksum !== seal.deploymentClaimChecksum || sealFacts.databaseBasename !== seal.databaseBasename ||
    sealFacts.databaseByteLength !== seal.databaseByteLength || sealFacts.databaseSha256 !== seal.databaseSha256 ||
    sealFacts.recoveryEvidenceChecksum !== recoveryEvidenceChecksum(seal) || sealFacts.caseCount !== evidence.orderedHeads.length ||
    sealFacts.outboxCursor !== evidence.outboxCursor || sealFacts.headsAggregateChecksum !== evidence.headsAggregateChecksum ||
    sealFacts.publicProjectionChecksum !== evidence.publicProjectionChecksum) fail("staging_case_recovery_attestation_binding_mismatch");

  const report = attestation.restoreReport;
  if (report.verifierReleaseDigest !== policy.restoreVerifierReleaseDigest ||
    report.restoredDatabaseByteLength !== seal.databaseByteLength || report.restoredDatabaseSha256 !== seal.databaseSha256 ||
    report.recoveryEvidenceChecksum !== recoveryEvidenceChecksum(seal) || report.caseCount !== evidence.orderedHeads.length ||
    report.outboxCursor !== evidence.outboxCursor || report.headsAggregateChecksum !== evidence.headsAggregateChecksum ||
    report.publicProjectionChecksum !== evidence.publicProjectionChecksum || report.rtoSeconds > policy.maxRtoSeconds) {
    fail("staging_case_recovery_attestation_restore_mismatch");
  }
  const closed = instant(seal.closedAtUtc);
  const started = instant(report.startedAtUtc);
  const completed = instant(report.completedAtUtc);
  const issued = instant(attestation.issuedAtUtc);
  const expires = instant(attestation.expiresAtUtc);
  const current = instant(now);
  if (expires !== closed + policy.maxAgeSeconds * 1000 || closed > started || started > completed || completed > issued || issued > current || current >= expires ||
    instant(catalog.retentionUntilUtc) < expires || instant(policy.signer.activeFromUtc) > issued || instant(policy.signer.activeUntilUtc) < expires ||
    report.rtoSeconds !== Math.ceil((completed - started) / 1000)) fail("staging_case_recovery_attestation_time_invalid");
}

/**
 * Verifies one exact, already-produced recovery point. It is intentionally
 * non-deploying: callers receive no bucket, PVC, database, listener, or civic
 * capability, only a provenance-checked operational startup gate.
 */
export function createStagingCaseRecoveryGateFromReviewedSources(input: StagingCaseRecoveryGateInput): StagingCaseRecoveryGate {
  const record = exactRecord(input, [
    "recoveryPolicySource", "recoveryPolicyPinSource", "shutdownSealSource", "catalogLocatorSource", "recoveryAttestationSource", "clock",
  ], "staging_case_recovery_input_invalid");
  const sources = [
    captureSource(record.recoveryPolicySource, "staging_case_recovery_policy_source_invalid"),
    captureSource(record.recoveryPolicyPinSource, "staging_case_recovery_policy_pin_source_invalid"),
    captureSource(record.shutdownSealSource, "staging_case_recovery_seal_source_invalid"),
    captureSource(record.catalogLocatorSource, "staging_case_recovery_catalog_source_invalid"),
    captureSource(record.recoveryAttestationSource, "staging_case_recovery_attestation_source_invalid"),
  ];
  const originalSources = [record.recoveryPolicySource, record.recoveryPolicyPinSource, record.shutdownSealSource, record.catalogLocatorSource, record.recoveryAttestationSource];
  if (new Set(originalSources).size !== originalSources.length) fail("staging_case_recovery_source_identity_invalid");
  const clock = captureClock(record.clock);
  const policy = parsePolicy(sourceValue(sources[0]!, "staging_case_recovery_policy_source_unavailable"));
  const pin = sourceValue(sources[1]!, "staging_case_recovery_policy_pin_source_unavailable");
  if (typeof pin !== "string" || !SHA256.test(pin) || pin !== policy.policyChecksum) fail("staging_case_recovery_policy_pin_mismatch");
  let rawSeal: unknown;
  try { rawSeal = sourceValue(sources[2]!, "staging_case_recovery_seal_source_unavailable"); } catch { fail("staging_case_recovery_seal_source_unavailable"); }
  let seal: CaseShutdownSealV2;
  try { seal = verifyCaseShutdownSeal(rawSeal); } catch { fail("staging_case_recovery_seal_invalid"); }
  const catalog = parseCatalog(sourceValue(sources[3]!, "staging_case_recovery_catalog_source_unavailable"));
  const attestation = parseAttestation(sourceValue(sources[4]!, "staging_case_recovery_attestation_source_unavailable"));
  const now = readClock(clock);
  verifyBindings(policy, catalog, seal, attestation, now);
  verifySignature(policy, attestation);
  const gate: StagingCaseRecoveryGate = Object.freeze({ schemaVersion: "staging_case_recovery_gate_v2" });
  gateFacts.set(gate, Object.freeze({
    municipalityId: policy.municipalityId, sourceReleaseDigest: seal.sourceReleaseDigest,
    sourcePvcNamespace: policy.sourcePvc.namespace, sourcePvcName: policy.sourcePvc.name, sourcePvcUid: policy.sourcePvc.uid,
    sourceDeploymentClaimChecksum: seal.deploymentClaimChecksum ?? fail("staging_case_recovery_attestation_binding_mismatch"),
    controlDeploymentBindingChecksum: policy.controlDeploymentBindingChecksum,
    targetPvcNamespace: policy.targetPvc.namespace, targetPvcName: policy.targetPvc.name,
    targetPvcUid: policy.targetPvc.uid, targetPvName: policy.targetPvName,
    recoveryOperationId: policy.recoveryOperationId, recoveryAttestationChecksum: attestation.attestationChecksum, expiresAtUtc: attestation.expiresAtUtc,
    shutdownSealChecksum: seal.sealChecksum, shutdownClosedAtUtc: seal.closedAtUtc,
    databaseBasename: seal.databaseBasename, databaseByteLength: seal.databaseByteLength, databaseSha256: seal.databaseSha256,
  }));
  return gate;
}

/** Provenance check for the non-civic recovery startup gate. */
export function consumeStagingCaseRecoveryGateForRuntime(
  value: unknown,
  trustedClock: StagingCaseRecoveryClock,
): StagingCaseRecoveryGateFacts {
  if (!value || typeof value !== "object") fail("staging_case_recovery_gate_invalid");
  const facts = gateFacts.get(value);
  if (!facts) fail("staging_case_recovery_gate_invalid");
  const now = readClock(captureClock(trustedClock));
  if (instant(now) >= instant(facts.expiresAtUtc)) fail("staging_case_recovery_gate_expired");
  return Object.freeze({ ...facts, verifiedAtUtc: now });
}
