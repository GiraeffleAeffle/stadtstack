import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import {
  consumeStagingCaseRecoveryGateForRuntime,
  createStagingCaseRecoveryGateFromReviewedSources,
} from "../src/staging-case-recovery-attestation.ts";
import { verifyCaseShutdownSeal } from "../src/adapters/sqlite-atomic-topic-case-admission.ts";
import { createCaseStateRecoveryEvidence } from "../src/case-state-recovery-evidence.ts";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

const MUNICIPALITY = "roebel-mueritz";
const STORE = "roebel-case-store";
const SOURCE_PVC = "11111111-1111-4111-8111-111111111111";
const TARGET_PVC = "22222222-2222-4222-8222-222222222222";
const OPERATION = "01983a00-0000-7000-8000-000000000001";
const BACKUP = "01983a00-0000-7000-8000-000000000002";
const CLOSED = "2026-08-23T12:00:00.000Z";
const STARTED = "2026-08-23T12:10:00.000Z";
const COMPLETED = "2026-08-23T12:20:00.000Z";
const ISSUED = "2026-08-23T12:30:00.000Z";
const NOW = "2026-08-23T12:31:00.000Z";
const EXPIRES = "2026-08-24T12:00:00.000Z";
const RETENTION = "2026-09-30T12:00:00.000Z";
const CHECKSUM = (letter: string) => `sha256:${letter.repeat(64)}`;
const RESTORE_VERIFIER_RELEASE = CHECKSUM("1");

function policyBody(value: Record<string, unknown>): Record<string, unknown> {
  const body = { ...value };
  delete body.policyChecksum;
  return body;
}

function catalogBody(value: Record<string, unknown>): Record<string, unknown> {
  const body = { ...value };
  delete body.locatorChecksum;
  return body;
}

function attestationBody(value: Record<string, unknown>): Record<string, unknown> {
  const body = { ...value };
  delete body.attestationChecksum;
  delete body.signature;
  return body;
}

function restoreReportBody(value: Record<string, any>): Record<string, unknown> {
  const body = { ...value };
  delete body.restoreReportChecksum;
  return body;
}

function seal() {
  const recoveryEvidence = createCaseStateRecoveryEvidence({ caseJournalHeads: [], outboxEntries: [] });
  const unsigned = {
    schemaVersion: "case_shutdown_seal_v1" as const,
    municipalityId: MUNICIPALITY,
    databaseSchemaVersion: "sqlite_atomic_topic_case_admission_v1",
    configFingerprint: CHECKSUM("a"),
    sourceReleaseDigest: CHECKSUM("b"),
    databaseBasename: `stadtstack-${MUNICIPALITY}-atomic-admission.sqlite`,
    databaseByteLength: 1234,
    databaseSha256: CHECKSUM("c"),
    closedAtUtc: CLOSED,
    walCheckpoint: { mode: "TRUNCATE" as const, busy: 0, log: 0, checkpointed: 0 },
    recoveryEvidence,
  };
  return verifyCaseShutdownSeal({ ...unsigned, sealChecksum: digest(unsigned) });
}

function fixture() {
  const pair = generateKeyPairSync("ed25519");
  const spki = pair.publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const shutdownSeal = seal();
  const evidenceChecksum = digest(shutdownSeal.recoveryEvidence);
  const completionReceipt = {
    bucket: "stadtstack-backups", key: "cases/backup-receipt.json", objectVersion: "receipt-v1", checksum: CHECKSUM("d"), keyVersion: "backup-key-v1",
  };
  const encryptedManifest = {
    bucket: "stadtstack-backups", key: "cases/manifest.age", objectVersion: "manifest-v1", checksum: CHECKSUM("e"),
  };
  const catalog = {
    schemaVersion: "case_backup_catalog_locator_v1",
    deploymentEnvironment: "staging",
    municipalityId: MUNICIPALITY, storeId: STORE, recoveryOperationId: OPERATION, casGeneration: "7", backupId: BACKUP,
    completionReceipt, encryptedManifest, retentionUntilUtc: RETENTION, locatorChecksum: "",
  } as Record<string, any>;
  catalog.locatorChecksum = digest(catalogBody(catalog));
  const policy = {
    schemaVersion: "staging_case_recovery_policy_v1",
    deploymentEnvironment: "staging",
    municipalityId: MUNICIPALITY, storeId: STORE,
    sourcePvc: { namespace: "stadtstack-roebel", name: "case-source", uid: SOURCE_PVC },
    targetPvc: { namespace: "stadtstack-roebel", name: "case-restore", uid: TARGET_PVC }, targetPvName: "pvc-restored",
    recoveryOperationId: OPERATION, controlDeploymentBindingChecksum: CHECKSUM("f"), catalogLocatorChecksum: catalog.locatorChecksum,
    restoreVerifierReleaseDigest: RESTORE_VERIFIER_RELEASE,
    signer: {
      algorithm: "Ed25519", purpose: "staging_case_recovery_attestation", status: "active",
      keyId: "recovery-attester", keyVersion: "ed25519-v1", spkiDerBase64url: spki.toString("base64url"),
      spkiSha256: `sha256:${createHash("sha256").update(spki).digest("hex")}`,
      activeFromUtc: "2026-08-01T00:00:00.000Z", activeUntilUtc: "2026-09-01T00:00:00.000Z",
    },
    maxAgeSeconds: 86400, maxRtoSeconds: 14400, policyChecksum: "",
  } as Record<string, any>;
  policy.policyChecksum = digest(policyBody(policy));
  const attestation = {
    schemaVersion: "staging_case_recovery_attestation_v1",
    deploymentEnvironment: "staging",
    municipalityId: MUNICIPALITY, storeId: STORE, recoveryOperationId: OPERATION,
    policyChecksum: policy.policyChecksum, controlDeploymentBindingChecksum: policy.controlDeploymentBindingChecksum,
    catalogLocatorChecksum: catalog.locatorChecksum, casGeneration: catalog.casGeneration, backupId: BACKUP,
    completionReceipt: { ...completionReceipt }, encryptedManifest: { ...encryptedManifest }, sourcePvcUid: SOURCE_PVC, targetPvcUid: TARGET_PVC, targetPvName: "pvc-restored",
    seal: {
      sealChecksum: shutdownSeal.sealChecksum, closedAtUtc: shutdownSeal.closedAtUtc, databaseSchemaVersion: shutdownSeal.databaseSchemaVersion,
      configFingerprint: shutdownSeal.configFingerprint, sourceReleaseDigest: shutdownSeal.sourceReleaseDigest, databaseBasename: shutdownSeal.databaseBasename,
      databaseByteLength: shutdownSeal.databaseByteLength, databaseSha256: shutdownSeal.databaseSha256, recoveryEvidenceChecksum: evidenceChecksum,
      caseCount: 0, outboxCursor: 0, headsAggregateChecksum: shutdownSeal.recoveryEvidence.headsAggregateChecksum,
      publicProjectionChecksum: shutdownSeal.recoveryEvidence.publicProjectionChecksum,
    },
    restoreReport: {
      restoreReportChecksum: "", verifierReleaseDigest: RESTORE_VERIFIER_RELEASE, restoredDatabaseByteLength: shutdownSeal.databaseByteLength,
      restoredDatabaseSha256: shutdownSeal.databaseSha256, integrity: "ok", recoveryEvidenceChecksum: evidenceChecksum, caseCount: 0,
      outboxCursor: 0, headsAggregateChecksum: shutdownSeal.recoveryEvidence.headsAggregateChecksum,
      publicProjectionChecksum: shutdownSeal.recoveryEvidence.publicProjectionChecksum, isolatedRestore: true,
      startedAtUtc: STARTED, completedAtUtc: COMPLETED, rtoSeconds: 600,
    },
    issuedAtUtc: ISSUED, expiresAtUtc: EXPIRES, signerKeyId: "recovery-attester", signerKeyVersion: "ed25519-v1",
    signatureAlgorithm: "Ed25519",
    attestationChecksum: "", signature: "",
  } as Record<string, any>;
  attestation.restoreReport.restoreReportChecksum = digest(restoreReportBody(attestation.restoreReport));
  attestation.attestationChecksum = digest(attestationBody(attestation));
  const envelope = { ...attestation };
  delete envelope.signature;
  attestation.signature = sign(null, Buffer.from(`stadtstack:staging-case-recovery-attestation:v1\0${canonical(envelope)}`, "utf8"), pair.privateKey).toString("base64url");
  return { policy, catalog, shutdownSeal, attestation };
}

function sources(value = fixture(), counts?: string[]) {
  return {
    recoveryPolicySource: Object.freeze({ read: () => { counts?.push("policy"); return value.policy; } }),
    recoveryPolicyPinSource: Object.freeze({ read: () => { counts?.push("pin"); return value.policy.policyChecksum; } }),
    shutdownSealSource: Object.freeze({ read: () => { counts?.push("seal"); return value.shutdownSeal; } }),
    catalogLocatorSource: Object.freeze({ read: () => { counts?.push("catalog"); return value.catalog; } }),
    recoveryAttestationSource: Object.freeze({ read: () => { counts?.push("attestation"); return value.attestation; } }),
    clock: Object.freeze({ now: () => NOW }),
  };
}

test("valid signed evidence yields a data-free operational recovery gate", () => {
  const value = fixture();
  const reads: string[] = [];
  const gate = createStagingCaseRecoveryGateFromReviewedSources(sources(value, reads));
  assert.deepEqual(reads, ["policy", "pin", "seal", "catalog", "attestation"]);
  assert.deepEqual(Reflect.ownKeys(gate), ["schemaVersion"]);
  const facts = consumeStagingCaseRecoveryGateForRuntime(gate, Object.freeze({ now: () => NOW }));
  assert.deepEqual(facts, {
    municipalityId: MUNICIPALITY, sourceReleaseDigest: value.shutdownSeal.sourceReleaseDigest,
    controlDeploymentBindingChecksum: CHECKSUM("f"), targetPvcNamespace: "stadtstack-roebel", targetPvcName: "case-restore",
    targetPvcUid: TARGET_PVC, targetPvName: "pvc-restored", recoveryOperationId: OPERATION,
    recoveryAttestationChecksum: value.attestation.attestationChecksum, expiresAtUtc: EXPIRES,
  });
  assert.throws(() => consumeStagingCaseRecoveryGateForRuntime(
    gate,
    Object.freeze({ now: () => EXPIRES }),
  ), /gate_expired/u);
});

test("cross-binding, signature, signer, and catalog drift fail closed", () => {
  const wrongTarget = fixture();
  wrongTarget.attestation.targetPvcUid = SOURCE_PVC;
  wrongTarget.attestation.attestationChecksum = digest(attestationBody(wrongTarget.attestation));
  assert.throws(() => createStagingCaseRecoveryGateFromReviewedSources(sources(wrongTarget)), /binding_mismatch/u);

  const wrongDb = fixture();
  wrongDb.attestation.restoreReport.restoredDatabaseSha256 = CHECKSUM("9");
  wrongDb.attestation.restoreReport.restoreReportChecksum = digest(restoreReportBody(wrongDb.attestation.restoreReport));
  wrongDb.attestation.attestationChecksum = digest(attestationBody(wrongDb.attestation));
  assert.throws(() => createStagingCaseRecoveryGateFromReviewedSources(sources(wrongDb)), /restore_mismatch/u);

  const badRestoreChecksum = fixture();
  badRestoreChecksum.attestation.restoreReport.restoreReportChecksum = CHECKSUM("9");
  badRestoreChecksum.attestation.attestationChecksum = digest(attestationBody(badRestoreChecksum.attestation));
  assert.throws(() => createStagingCaseRecoveryGateFromReviewedSources(sources(badRestoreChecksum)), /restore_report_checksum_invalid/u);

  const wrongVerifier = fixture();
  wrongVerifier.attestation.restoreReport.verifierReleaseDigest = CHECKSUM("2");
  wrongVerifier.attestation.restoreReport.restoreReportChecksum = digest(restoreReportBody(wrongVerifier.attestation.restoreReport));
  wrongVerifier.attestation.attestationChecksum = digest(attestationBody(wrongVerifier.attestation));
  assert.throws(() => createStagingCaseRecoveryGateFromReviewedSources(sources(wrongVerifier)), /restore_mismatch/u);

  const wrongEvidence = fixture();
  wrongEvidence.attestation.seal.publicProjectionChecksum = CHECKSUM("8");
  wrongEvidence.attestation.attestationChecksum = digest(attestationBody(wrongEvidence.attestation));
  assert.throws(() => createStagingCaseRecoveryGateFromReviewedSources(sources(wrongEvidence)), /binding_mismatch/u);

  const drift = fixture();
  drift.attestation.completionReceipt.objectVersion = "receipt-v2";
  drift.attestation.attestationChecksum = digest(attestationBody(drift.attestation));
  assert.throws(() => createStagingCaseRecoveryGateFromReviewedSources(sources(drift)), /binding_mismatch/u);

  const badSignature = fixture();
  badSignature.attestation.signature = Buffer.alloc(64, 7).toString("base64url");
  assert.throws(() => createStagingCaseRecoveryGateFromReviewedSources(sources(badSignature)), /signature_invalid/u);

  const badSpki = fixture();
  badSpki.policy.signer.spkiSha256 = CHECKSUM("9");
  badSpki.policy.policyChecksum = digest(policyBody(badSpki.policy));
  badSpki.attestation.policyChecksum = badSpki.policy.policyChecksum;
  badSpki.attestation.attestationChecksum = digest(attestationBody(badSpki.attestation));
  assert.throws(() => createStagingCaseRecoveryGateFromReviewedSources(sources(badSpki)), /policy_invalid/u);

  const badBase64 = fixture();
  badBase64.policy.signer.spkiDerBase64url = "not+base64";
  badBase64.policy.policyChecksum = digest(policyBody(badBase64.policy));
  badBase64.attestation.policyChecksum = badBase64.policy.policyChecksum;
  badBase64.attestation.attestationChecksum = digest(attestationBody(badBase64.attestation));
  assert.throws(() => createStagingCaseRecoveryGateFromReviewedSources(sources(badBase64)), /policy_invalid/u);
});

test("expiry, ordering, RTO, proxy/accessor/extra structure, and source failures fail closed", () => {
  const expired = fixture();
  assert.throws(() => createStagingCaseRecoveryGateFromReviewedSources({ ...sources(expired), clock: Object.freeze({ now: () => EXPIRES }) }), /time_invalid/u);

  const rto = fixture();
  rto.attestation.restoreReport.rtoSeconds = 14_401;
  rto.attestation.restoreReport.restoreReportChecksum = digest(restoreReportBody(rto.attestation.restoreReport));
  rto.attestation.attestationChecksum = digest(attestationBody(rto.attestation));
  assert.throws(() => createStagingCaseRecoveryGateFromReviewedSources(sources(rto)), /restore_mismatch/u);

  const subsecondRto = fixture();
  subsecondRto.attestation.restoreReport.completedAtUtc = "2026-08-23T12:20:00.001Z";
  subsecondRto.attestation.restoreReport.restoreReportChecksum = digest(restoreReportBody(subsecondRto.attestation.restoreReport));
  subsecondRto.attestation.attestationChecksum = digest(attestationBody(subsecondRto.attestation));
  assert.throws(() => createStagingCaseRecoveryGateFromReviewedSources(sources(subsecondRto)), /time_invalid/u);

  const rollback = fixture();
  rollback.attestation.casGeneration = "6";
  rollback.attestation.attestationChecksum = digest(attestationBody(rollback.attestation));
  assert.throws(() => createStagingCaseRecoveryGateFromReviewedSources(sources(rollback)), /binding_mismatch/u);

  const extra = fixture();
  assert.throws(() => createStagingCaseRecoveryGateFromReviewedSources({ ...sources(extra), catalogLocatorSource: Object.freeze({ read: () => ({ ...extra.catalog, extra: true }) }) }), /catalog_invalid/u);
  const proxied = fixture();
  assert.throws(() => createStagingCaseRecoveryGateFromReviewedSources({ ...sources(proxied), recoveryPolicySource: Object.freeze({ read: () => new Proxy(proxied.policy, {}) }) }), /policy_invalid/u);
  const accessor = fixture();
  const source = {} as Record<string, unknown>;
  Object.defineProperty(source, "read", { enumerable: true, get() { throw new Error("must_not_run"); } });
  assert.throws(() => createStagingCaseRecoveryGateFromReviewedSources({ ...sources(accessor), recoveryPolicySource: source as never }), /policy_source_invalid/u);
  assert.throws(() => createStagingCaseRecoveryGateFromReviewedSources({ ...sources(fixture()), recoveryAttestationSource: Object.freeze({ read: () => { throw new Error("offline"); } }) }), /attestation_source_unavailable/u);
  assert.throws(() => createStagingCaseRecoveryGateFromReviewedSources({ ...sources(fixture()), clock: Object.freeze({ now: () => { throw new Error("offline"); } }) }), /clock_unavailable/u);
  assert.throws(() => createStagingCaseRecoveryGateFromReviewedSources({ ...sources(fixture()), clock: Object.freeze({ now: () => "not-a-time" }) }), /clock_invalid/u);
});

test("sources must be distinct and opaque gates reject clones or type-shaped forgeries", () => {
  const value = fixture();
  const same = Object.freeze({ read: () => value.policy });
  assert.throws(() => createStagingCaseRecoveryGateFromReviewedSources({
    ...sources(value), recoveryPolicySource: same, recoveryPolicyPinSource: same,
  }), /source_identity_invalid/u);
  const gate = createStagingCaseRecoveryGateFromReviewedSources(sources());
  const runtimeClock = Object.freeze({ now: () => NOW });
  assert.throws(() => consumeStagingCaseRecoveryGateForRuntime(structuredClone(gate), runtimeClock), /gate_invalid/u);
  assert.throws(() => consumeStagingCaseRecoveryGateForRuntime({ schemaVersion: gate.schemaVersion }, runtimeClock), /gate_invalid/u);
});
