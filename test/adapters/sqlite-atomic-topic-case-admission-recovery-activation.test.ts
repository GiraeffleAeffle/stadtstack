import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { finalizeEvent, getPublicKey, type Event as NostrEvent } from "nostr-tools/pure";

import {
  CASE_DURABLE_DEPLOYMENT_CLAIM_FILENAME,
  createCaseDurableDeploymentClaimToken,
  readCanonicalCaseDurableDeploymentClaim,
  verifyCaseDurableDeploymentClaim,
  type CaseDurableDeploymentClaim,
} from "../../src/case-durable-deployment-claim.ts";
import {
  CASE_RECOVERY_ACTIVATION_FILENAME,
  CASE_SHUTDOWN_SEAL_FILENAME,
  createSqliteAtomicTopicCaseAdmission,
  type CaseShutdownSealV2,
  type SqliteAtomicTopicCaseAdmissionOptions,
} from "../../src/adapters/sqlite-atomic-topic-case-admission.ts";
import {
  CASE_STORE_BOOTSTRAP_FILENAME,
  CASE_OPEN_EPOCH_FILENAME,
  createCaseStoreBootstrap,
  readCanonicalCaseStoreBootstrap,
  readCanonicalCaseOpenEpoch,
  removeCanonicalCaseOpenEpoch,
  writeCanonicalCaseStoreBootstrap,
} from "../../src/case-store-epoch.ts";
import {
  createStagingCaseControlDeploymentProof,
  type StagingCaseControlReviewedBindingV1,
  type StagingCaseControlStorageObservation,
} from "../../src/staging-case-control-preflight.ts";
import type { CitizenSignedTopicSuggestionV1 } from "../../src/citizen-suggestion.ts";
import { verifyTopicCaseAdmission } from "../../src/topic-case-admission.ts";
import type { AtomicTopicCaseAdmissionV1 } from "../../src/roebel-control-service.ts";
import {
  assertStagingCaseRecoveryActivationAuthorizationFresh,
  createStagingCaseRecoveryActivationAuthorization,
  type StagingCaseRecoveryActivationAuthorization,
} from "../../src/staging-case-recovery-activation-authority.ts";
import type { StagingCaseRecoveryGateInput } from "../../src/staging-case-recovery-attestation.ts";

const MUNICIPALITY_ID = "roebel-mueritz";
const SOURCE_RELEASE = `sha256:${"a".repeat(64)}`;
const TARGET_RELEASE = `sha256:${"e".repeat(64)}`;
const TOPOLOGY = `sha256:${"b".repeat(64)}`;
const ACTOR_REGISTRY = [{ actorId: "roebel:case-steward", actorClass: "case_steward" as const }];
const ROOTS = new Set<string>();
const OPERATION = "01983a00-0000-7000-8000-000000000001";
const BACKUP = "01983a00-0000-7000-8000-000000000002";
const CHECKSUM = (letter: string) => `sha256:${letter.repeat(64)}`;
const TOPIC_ID = "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse";
const CITIZEN_SECRET = new Uint8Array(32).fill(21);
const AGENT_SECRET = new Uint8Array(32).fill(22);
const CITIZEN_PUBKEY = getPublicKey(CITIZEN_SECRET);
const AGENT_PUBKEY = getPublicKey(AGENT_SECRET);
const RECEIPT_ID = `urn:stadtstack:mecky-answer:${"a".repeat(64)}`;

after(() => { for (const root of ROOTS) rmSync(root, { recursive: true, force: true }); });

function root(prefix = ".stadtstack-recovery-"): string {
  const value = mkdtempSync(join(homedir(), prefix));
  ROOTS.add(value);
  return value;
}

function copyRoot(source: string): string {
  const target = root(".stadtstack-recovery-target-");
  cpSync(source, target, { recursive: true });
  return target;
}

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

function rawDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function bufferDigest(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function markerBody(binding: Omit<StagingCaseControlReviewedBindingV1, "bindingChecksum">): Record<string, unknown> {
  return {
    schemaVersion: "staging_case_control_storage_marker_v1",
    deploymentEnvironment: binding.deploymentEnvironment,
    municipalityId: binding.municipalityId,
    workloadName: binding.workloadName,
    workload: binding.workload,
    releaseDigest: binding.releaseDigest,
    operationsTopologyChecksum: binding.operationsTopologyChecksum,
    deployment: binding.deployment,
    pvcNamespace: binding.storage.pvcNamespace,
    pvcName: binding.storage.pvcName,
    pvcUid: binding.storage.pvcUid,
    pvName: binding.storage.pvName,
    storageClass: binding.storage.storageClass,
    accessMode: binding.storage.accessMode,
    volumeMode: binding.storage.volumeMode,
    requestedBytes: binding.storage.requestedBytes,
    rootDir: binding.storage.rootDir,
    uid: binding.storage.uid,
    gid: binding.storage.gid,
    mode: binding.storage.mode,
    filesystemType: binding.storage.filesystemType,
    minAvailableBytes: binding.storage.minAvailableBytes,
    marker: {
      fileName: binding.storage.marker.fileName,
      uid: binding.storage.marker.uid,
      gid: binding.storage.marker.gid,
      mode: binding.storage.marker.mode,
    },
  };
}

function binding(rootDir: string, overrides: Readonly<{
  releaseDigest?: string;
  pvcName?: string;
  pvcUid?: string;
  pvName?: string;
}> = {}): StagingCaseControlReviewedBindingV1 {
  const unsigned = {
    schemaVersion: "staging_case_control_deployment_binding_v1" as const,
    deploymentEnvironment: "staging" as const,
    municipalityId: MUNICIPALITY_ID,
    workloadName: "roebel-case-steward-control",
    workload: { serviceAccountName: "roebel-case-steward-control", automountServiceAccountToken: false as const },
    releaseDigest: overrides.releaseDigest ?? SOURCE_RELEASE,
    operationsTopologyChecksum: TOPOLOGY,
    deployment: { replicas: 1 as const, strategy: "Recreate" as const, noOverlappingPods: true as const },
    storage: {
      rootDir,
      pvcNamespace: "stadtstack-roebel-staging-lab",
      pvcName: overrides.pvcName ?? "roebel-case-steward-control-state",
      pvcUid: overrides.pvcUid ?? "12345678-1234-4234-9234-123456789abc",
      pvName: overrides.pvName ?? "pvc-12345678-1234-4234-9234-123456789abc",
      storageClass: "hcloud-volumes",
      accessMode: "ReadWriteOncePod" as const,
      volumeMode: "Filesystem" as const,
      requestedBytes: "10737418240",
      uid: 10001,
      gid: 10001,
      mode: "0700",
      filesystemType: "0xef53",
      minAvailableBytes: "1",
      marker: { fileName: "staging-case-control-storage.marker.json", checksum: "", uid: 10001, gid: 10001, mode: "0600" },
    },
    listeners: [
      { id: "admission" as const, port: 18085 as const, bindScope: "pod_network" as const },
      { id: "private-outbox" as const, port: 18087 as const, bindScope: "pod_network" as const },
      { id: "probe" as const, port: 18088 as const, bindScope: "pod_network" as const },
    ],
  };
  unsigned.storage.marker.checksum = rawDigest(`${canonical(markerBody(unsigned))}\n`);
  return Object.freeze({ ...unsigned, bindingChecksum: digest(unsigned) }) as StagingCaseControlReviewedBindingV1;
}

function observation(value: StagingCaseControlReviewedBindingV1): StagingCaseControlStorageObservation {
  return Object.freeze({
    rootDir: value.storage.rootDir,
    rootKind: "directory" as const,
    rootIsSymbolicLink: false,
    rootUid: value.storage.uid,
    rootGid: value.storage.gid,
    rootMode: Number.parseInt(value.storage.mode, 8),
    filesystemType: BigInt(value.storage.filesystemType),
    availableBytes: BigInt(value.storage.minAvailableBytes),
    markerPath: join(value.storage.rootDir, value.storage.marker.fileName),
    markerKind: "file" as const,
    markerIsSymbolicLink: false,
    markerUid: value.storage.marker.uid,
    markerGid: value.storage.marker.gid,
    markerMode: Number.parseInt(value.storage.marker.mode, 8),
    markerText: `${canonical(markerBody(value))}\n`,
  });
}

function proof(value: StagingCaseControlReviewedBindingV1) {
  return createStagingCaseControlDeploymentProof({
    reviewedBinding: value,
    expectedBindingChecksum: value.bindingChecksum,
    storageObserver: Object.freeze({ observe: () => observation(value) }),
  });
}

function claimFor(value: StagingCaseControlReviewedBindingV1): CaseDurableDeploymentClaim {
  const unsigned = {
    schemaVersion: "case_durable_deployment_claim_v1" as const,
    municipalityId: value.municipalityId,
    releaseDigest: value.releaseDigest,
    controlDeploymentBindingChecksum: value.bindingChecksum,
    pvc: { namespace: value.storage.pvcNamespace, name: value.storage.pvcName, uid: value.storage.pvcUid },
    pvName: value.storage.pvName,
  };
  return verifyCaseDurableDeploymentClaim({ ...unsigned, claimChecksum: digest(unsigned) });
}

function tokenFor(value: StagingCaseControlReviewedBindingV1) {
  return createCaseDurableDeploymentClaimToken(proof(value));
}

function options(
  rootDir: string,
  bindingValue: StagingCaseControlReviewedBindingV1,
  extras: Partial<Pick<SqliteAtomicTopicCaseAdmissionOptions, "deploymentClaimToken" | "recoveryActivationAuthorization">> = {},
): SqliteAtomicTopicCaseAdmissionOptions {
  return {
    rootDir,
    municipalityId: MUNICIPALITY_ID,
    policyVersion: "case-intake-v1",
    actorRegistry: ACTOR_REGISTRY,
    allowedSignerPubkeys: [CITIZEN_PUBKEY],
    allowedAgentPubkeys: [AGENT_PUBKEY],
    durableState: { mode: "durable_single_writer", sourceReleaseDigest: bindingValue.releaseDigest },
    deploymentClaimToken: tokenFor(bindingValue),
    ...extras,
  };
}

function times(closedAtUtc: string): Readonly<Record<"started" | "completed" | "issued" | "expires" | "now", string>> {
  const base = new Date(closedAtUtc).getTime();
  const at = (minutes: number) => new Date(base + minutes * 60_000).toISOString();
  return { started: at(1), completed: at(2), issued: at(3), expires: at(1440), now: at(4) };
}

function recoverySources(
  sourceClaim: CaseDurableDeploymentClaim,
  targetClaim: CaseDurableDeploymentClaim,
  shutdownSeal: CaseShutdownSealV2,
  reads?: string[],
  onPolicyRead?: () => void,
  nowRef?: { value: string },
): StagingCaseRecoveryGateInput {
  const pair = generateKeyPairSync("ed25519");
  const spki = pair.publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const clock = times(shutdownSeal.closedAtUtc);
  const completionReceipt = {
    bucket: "stadtstack-backups", key: "cases/backup-receipt.json", objectVersion: "receipt-v1", checksum: CHECKSUM("d"), keyVersion: "backup-key-v1",
  };
  const encryptedManifest = { bucket: "stadtstack-backups", key: "cases/manifest.age", objectVersion: "manifest-v1", checksum: CHECKSUM("e") };
  const catalogUnsigned = {
    schemaVersion: "case_backup_catalog_locator_v1" as const,
    deploymentEnvironment: "staging" as const,
    municipalityId: MUNICIPALITY_ID,
    storeId: "roebel-case-store",
    recoveryOperationId: OPERATION,
    casGeneration: "7",
    backupId: BACKUP,
    completionReceipt,
    encryptedManifest,
    retentionUntilUtc: "2099-01-01T00:00:00.000Z",
  };
  const catalog = { ...catalogUnsigned, locatorChecksum: digest(catalogUnsigned) };
  const policyUnsigned = {
    schemaVersion: "staging_case_recovery_policy_v1" as const,
    deploymentEnvironment: "staging" as const,
    municipalityId: MUNICIPALITY_ID,
    storeId: "roebel-case-store",
    sourcePvc: sourceClaim.pvc,
    targetPvc: targetClaim.pvc,
    targetPvName: targetClaim.pvName,
    recoveryOperationId: OPERATION,
    controlDeploymentBindingChecksum: targetClaim.controlDeploymentBindingChecksum,
    catalogLocatorChecksum: catalog.locatorChecksum,
    restoreVerifierReleaseDigest: CHECKSUM("1"),
    signer: {
      algorithm: "Ed25519" as const,
      purpose: "staging_case_recovery_attestation" as const,
      status: "active" as const,
      keyId: "recovery-attester",
      keyVersion: "ed25519-v1",
      spkiDerBase64url: spki.toString("base64url"),
      spkiSha256: bufferDigest(spki),
      activeFromUtc: "2020-01-01T00:00:00.000Z",
      activeUntilUtc: "2099-01-01T00:00:00.000Z",
    },
    maxAgeSeconds: 86400 as const,
    maxRtoSeconds: 14400 as const,
  };
  const policy = { ...policyUnsigned, policyChecksum: digest(policyUnsigned) };
  const recoveryEvidenceChecksum = digest(shutdownSeal.recoveryEvidence);
  const seal = {
    sealChecksum: shutdownSeal.sealChecksum,
    closedAtUtc: shutdownSeal.closedAtUtc,
    databaseSchemaVersion: shutdownSeal.databaseSchemaVersion,
    configFingerprint: shutdownSeal.configFingerprint,
    sourceReleaseDigest: shutdownSeal.sourceReleaseDigest,
    deploymentClaimChecksum: shutdownSeal.deploymentClaimChecksum,
    databaseBasename: shutdownSeal.databaseBasename,
    databaseByteLength: shutdownSeal.databaseByteLength,
    databaseSha256: shutdownSeal.databaseSha256,
    recoveryEvidenceChecksum,
    caseCount: shutdownSeal.recoveryEvidence.orderedHeads.length,
    outboxCursor: shutdownSeal.recoveryEvidence.outboxCursor,
    headsAggregateChecksum: shutdownSeal.recoveryEvidence.headsAggregateChecksum,
    publicProjectionChecksum: shutdownSeal.recoveryEvidence.publicProjectionChecksum,
  };
  const restoreReportUnsigned = {
    verifierReleaseDigest: policy.restoreVerifierReleaseDigest,
    restoredDatabaseByteLength: shutdownSeal.databaseByteLength,
    restoredDatabaseSha256: shutdownSeal.databaseSha256,
    integrity: "ok" as const,
    recoveryEvidenceChecksum,
    caseCount: shutdownSeal.recoveryEvidence.orderedHeads.length,
    outboxCursor: shutdownSeal.recoveryEvidence.outboxCursor,
    headsAggregateChecksum: shutdownSeal.recoveryEvidence.headsAggregateChecksum,
    publicProjectionChecksum: shutdownSeal.recoveryEvidence.publicProjectionChecksum,
    isolatedRestore: true as const,
    startedAtUtc: clock.started,
    completedAtUtc: clock.completed,
    rtoSeconds: 60,
  };
  const restoreReport = { ...restoreReportUnsigned, restoreReportChecksum: digest(restoreReportUnsigned) };
  const attestationUnsigned = {
    schemaVersion: "staging_case_recovery_attestation_v2" as const,
    deploymentEnvironment: "staging" as const,
    municipalityId: MUNICIPALITY_ID,
    storeId: "roebel-case-store",
    recoveryOperationId: OPERATION,
    policyChecksum: policy.policyChecksum,
    controlDeploymentBindingChecksum: targetClaim.controlDeploymentBindingChecksum,
    catalogLocatorChecksum: catalog.locatorChecksum,
    casGeneration: "7",
    backupId: BACKUP,
    completionReceipt,
    encryptedManifest,
    sourcePvcUid: sourceClaim.pvc.uid,
    targetPvcUid: targetClaim.pvc.uid,
    targetPvName: targetClaim.pvName,
    seal,
    restoreReport,
    issuedAtUtc: clock.issued,
    expiresAtUtc: clock.expires,
    signerKeyId: "recovery-attester",
    signerKeyVersion: "ed25519-v1",
    signatureAlgorithm: "Ed25519" as const,
  };
  const attestationChecksum = digest(attestationUnsigned);
  const envelope = { ...attestationUnsigned, attestationChecksum };
  const signature = sign(
    null,
    Buffer.from(`stadtstack:staging-case-recovery-attestation:v2\0${canonical(envelope)}`, "utf8"),
    pair.privateKey,
  ).toString("base64url");
  const attestation = { ...envelope, signature };
  const read = (name: string, value: unknown, hook?: () => void) => Object.freeze({
    read: () => { reads?.push(name); hook?.(); return value; },
  });
  return Object.freeze({
    recoveryPolicySource: read("policy", policy, onPolicyRead),
    recoveryPolicyPinSource: read("pin", policy.policyChecksum),
    shutdownSealSource: read("seal", shutdownSeal),
    catalogLocatorSource: read("catalog", catalog),
    recoveryAttestationSource: read("attestation", attestation),
    clock: Object.freeze({ now: () => nowRef?.value ?? clock.now }),
  });
}

function plainEvent(event: NostrEvent): NostrEvent {
  return JSON.parse(JSON.stringify(event)) as NostrEvent;
}

function admittedInput(): AtomicTopicCaseAdmissionV1 {
  const sourceDiscussion = plainEvent(finalizeEvent({
    kind: 1,
    created_at: 1_787_356_800,
    content: "@Mecky Welche geprüften Möglichkeiten gibt es für eine sichere Querung?",
    tags: [["p", AGENT_PUBKEY], ["t", "stadtstack-civic-discussion"], ["municipality", MUNICIPALITY_ID], ["topic", TOPIC_ID], ["stance", "root"], ["argument-root", "self"]],
  }, CITIZEN_SECRET));
  const sourceAnswer = plainEvent(finalizeEvent({
    kind: 1,
    created_at: sourceDiscussion.created_at + 1,
    content: "Geprüfte Unterlagen beschreiben mehrere Varianten.",
    tags: [["e", sourceDiscussion.id, "", "reply"], ["p", CITIZEN_PUBKEY], ["municipality", MUNICIPALITY_ID], ["topic", TOPIC_ID], ["mecky-receipt", RECEIPT_ID], ["evidence", CHECKSUM("c"), "https://roebel.example/reviewed/crossing-options"]],
  }, AGENT_SECRET));
  const core = {
    sourceAnswerReceiptId: RECEIPT_ID,
    sourceDiscussionId: sourceDiscussion.id,
    sourceDiscussionRef: `nostr://event/${sourceDiscussion.id}`,
    municipalityId: MUNICIPALITY_ID,
    topicId: TOPIC_ID,
    citizenPubkey: CITIZEN_PUBKEY,
    title: "Sichere Querung gemeinsam prüfen",
    summary: "Die geprüften Varianten sollen öffentlich abgewogen und anschließend menschlich in den Civic-Case-Prozess aufgenommen werden.",
  };
  const draft = {
    schemaVersion: "public_mecky_topic_suggestion_draft_v1" as const,
    draftId: `urn:stadtstack:topic-suggestion-draft:${digest(core).slice(7)}`,
    ...core,
    entryState: "citizen_signature_required" as const,
    authorityBinding: "none" as const,
    submittedToCivicWorkflow: false as const,
  };
  const signedEvent = plainEvent(finalizeEvent({
    kind: 1,
    created_at: sourceAnswer.created_at + 1,
    content: JSON.stringify(draft),
    tags: [["schema", "citizen_signed_topic_suggestion_v1"], ["municipality", MUNICIPALITY_ID], ["topic", TOPIC_ID], ["e", sourceDiscussion.id, "", "root"], ["mecky-receipt", RECEIPT_ID]],
  }, CITIZEN_SECRET));
  const signedSuggestion: CitizenSignedTopicSuggestionV1 = {
    schemaVersion: "citizen_signed_topic_suggestion_v1",
    candidateId: `urn:stadtstack:signed-topic-suggestion:${signedEvent.id}`,
    signerPubkey: signedEvent.pubkey,
    draft,
    event: { ...signedEvent, kind: 1 },
    verification: { kind: "nostr_nip01", verified: true },
    entryState: "awaiting_human_case_admission",
    authorityBinding: "none",
    submittedToCivicWorkflow: false,
  };
  const verified = verifyTopicCaseAdmission({
    sourceDiscussion,
    sourceAnswer,
    signedSuggestion,
    allowedAgentPubkeys: [AGENT_PUBKEY],
  });
  return {
    schemaVersion: "atomic_topic_case_admission_v1",
    municipalityId: MUNICIPALITY_ID,
    rootEventId: verified.discussion.id,
    caseId: verified.identity.caseId,
    actorBinding: { actorId: "roebel:case-steward", actorClass: "case_steward" },
    expectedCaseVersion: 0,
    idempotencyKey: `roebel:admit-signed-topic-suggestion:${signedEvent.id}`,
    policyVersion: "case-intake-v1",
    sourceDiscussion,
    verifiedAdmission: verified,
  };
}

function seed(value: StagingCaseControlReviewedBindingV1): Readonly<{
  token: ReturnType<typeof tokenFor>;
  claim: CaseDurableDeploymentClaim;
  seal: CaseShutdownSealV2;
}> {
  const adapter = createSqliteAtomicTopicCaseAdmission(options(value.storage.rootDir, value));
  const claim = readCanonicalCaseDurableDeploymentClaim(value.storage.rootDir);
  assert.ok(claim);
  const seal = adapter.sealAndClose();
  return Object.freeze({ token: tokenFor(value), claim, seal });
}

async function seedWithCase(value: StagingCaseControlReviewedBindingV1): Promise<Readonly<{
  token: ReturnType<typeof tokenFor>;
  claim: CaseDurableDeploymentClaim;
  seal: CaseShutdownSealV2;
}>> {
  const adapter = createSqliteAtomicTopicCaseAdmission(options(value.storage.rootDir, value));
  await adapter.admission.admit(admittedInput());
  const claim = readCanonicalCaseDurableDeploymentClaim(value.storage.rootDir);
  assert.ok(claim);
  const seal = adapter.sealAndClose();
  return Object.freeze({ token: tokenFor(value), claim, seal });
}

function activation(
  rootDir: string,
  targetBinding: StagingCaseControlReviewedBindingV1,
  recovery?: StagingCaseRecoveryActivationAuthorization,
) {
  return createSqliteAtomicTopicCaseAdmission(options(rootDir, targetBinding, {
    deploymentClaimToken: tokenFor(targetBinding),
    ...(recovery === undefined ? {} : { recoveryActivationAuthorization: recovery }),
  }));
}

function makeAuthorization(
  source: Readonly<{ claim: CaseDurableDeploymentClaim; seal: CaseShutdownSealV2 }>,
  target: StagingCaseControlReviewedBindingV1,
  reads?: string[],
  onPolicyRead?: () => void,
  nowRef?: { value: string },
) {
  const recovery = recoverySources(source.claim, claimFor(target), source.seal, reads, onPolicyRead, nowRef);
  return createStagingCaseRecoveryActivationAuthorization({
    targetDeploymentClaimToken: tokenFor(target),
    recovery,
  });
}

function restoredBinding(rootDir: string): StagingCaseControlReviewedBindingV1 {
  return binding(rootDir, {
    releaseDigest: TARGET_RELEASE,
    pvcName: "roebel-case-steward-control-restored",
    pvcUid: "22222222-2222-4222-8222-222222222222",
    pvName: "pvc-22222222-2222-4222-8222-222222222222",
  });
}

async function interruptedRecovery(withCase = false): Promise<Readonly<{
  source: Readonly<{ claim: CaseDurableDeploymentClaim; seal: CaseShutdownSealV2 }>;
  targetRoot: string;
  targetBinding: StagingCaseControlReviewedBindingV1;
  authorization: StagingCaseRecoveryActivationAuthorization;
  markerText: string;
  claim: CaseDurableDeploymentClaim;
  databasePath: string;
}>> {
  const sourceRoot = root();
  const sourceBinding = binding(sourceRoot);
  const source = withCase ? await seedWithCase(sourceBinding) : seed(sourceBinding);
  const targetRoot = copyRoot(sourceRoot);
  const targetBinding = restoredBinding(targetRoot);
  const authorization = makeAuthorization(source, targetBinding);
  const active = activation(targetRoot, targetBinding, authorization);
  const markerText = readFileSync(join(targetRoot, CASE_RECOVERY_ACTIVATION_FILENAME), "utf8");
  active.close();
  const claim = readCanonicalCaseDurableDeploymentClaim(targetRoot);
  assert.ok(claim);
  return Object.freeze({
    source,
    targetRoot,
    targetBinding,
    authorization,
    markerText,
    claim,
    databasePath: join(targetRoot, source.seal.databaseBasename),
  });
}

function completedRecoveryWithMarker(): Readonly<{
  targetRoot: string;
  targetBinding: StagingCaseControlReviewedBindingV1;
  authorization: StagingCaseRecoveryActivationAuthorization;
  markerText: string;
  targetSeal: CaseShutdownSealV2;
  claim: CaseDurableDeploymentClaim;
}> {
  const sourceRoot = root();
  const sourceBinding = binding(sourceRoot);
  const source = seed(sourceBinding);
  const targetRoot = copyRoot(sourceRoot);
  const targetBinding = restoredBinding(targetRoot);
  const authorization = makeAuthorization(source, targetBinding);
  const active = activation(targetRoot, targetBinding, authorization);
  const markerText = readFileSync(join(targetRoot, CASE_RECOVERY_ACTIVATION_FILENAME), "utf8");
  const targetSeal = active.sealAndClose();
  // Model a crash after the target shutdown seal was durably written but
  // before the final marker unlink. The exact marker bytes are retained so
  // retry paths can prove they did not silently rewrite or consume evidence.
  writeFileSync(join(targetRoot, CASE_RECOVERY_ACTIVATION_FILENAME), markerText, { mode: 0o600, flag: "wx" });
  chmodSync(join(targetRoot, CASE_RECOVERY_ACTIVATION_FILENAME), 0o600);
  const claim = readCanonicalCaseDurableDeploymentClaim(targetRoot);
  assert.ok(claim);
  return Object.freeze({ targetRoot, targetBinding, authorization, markerText, targetSeal, claim });
}

function claimedRootWithoutDatabase(): Readonly<{
  rootDir: string;
  reviewed: StagingCaseControlReviewedBindingV1;
  claim: CaseDurableDeploymentClaim;
  configFingerprint: string;
  databaseBasename: string;
  databasePath: string;
}> {
  const rootDir = root();
  const reviewed = binding(rootDir);
  const adapter = createSqliteAtomicTopicCaseAdmission(options(rootDir, reviewed));
  adapter.close();
  const epoch = readCanonicalCaseOpenEpoch(rootDir);
  assert.ok(epoch);
  const claim = readCanonicalCaseDurableDeploymentClaim(rootDir);
  assert.ok(claim);
  removeCanonicalCaseOpenEpoch(rootDir);
  const databasePath = join(rootDir, epoch.databaseBasename);
  for (const suffix of ["-wal", "-shm"] as const) {
    const sidecar = `${databasePath}${suffix}`;
    if (existsSync(sidecar)) unlinkSync(sidecar);
  }
  unlinkSync(databasePath);
  return Object.freeze({
    rootDir,
    reviewed,
    claim,
    configFingerprint: epoch.configFingerprint,
    databaseBasename: epoch.databaseBasename,
    databasePath,
  });
}

test("an empty durable root is first claimed by a genuine deployment proof token", () => {
  const rootDir = root();
  const reviewed = binding(rootDir);
  const adapter = createSqliteAtomicTopicCaseAdmission(options(rootDir, reviewed));
  const claim = readCanonicalCaseDurableDeploymentClaim(rootDir);
  assert.deepEqual(claim, claimFor(reviewed));
  const seal = adapter.sealAndClose();
  assert.equal(seal.schemaVersion, "case_shutdown_seal_v2");
  assert.equal(seal.deploymentClaimChecksum, claim?.claimChecksum);
});

test("a copied sealed source root cannot be opened by an ordinary target deployment claim", () => {
  const sourceRoot = root();
  const sourceBinding = binding(sourceRoot);
  const source = seed(sourceBinding);
  const targetRoot = copyRoot(sourceRoot);
  const targetBinding = binding(targetRoot, {
    releaseDigest: TARGET_RELEASE,
    pvcName: "roebel-case-steward-control-restored",
    pvcUid: "22222222-2222-4222-8222-222222222222",
    pvName: "pvc-22222222-2222-4222-8222-222222222222",
  });
  assert.throws(() => activation(targetRoot, targetBinding), /atomic_admission_deployment_claim_mismatch/u);
  assert.deepEqual(readCanonicalCaseDurableDeploymentClaim(targetRoot), source.claim);
  assert.equal(existsSync(join(targetRoot, CASE_SHUTDOWN_SEAL_FILENAME)), true);
  assert.deepEqual(readdirSync(targetRoot).filter((entry) => entry === CASE_RECOVERY_ACTIVATION_FILENAME), []);
});

test("reviewed recovery rotates the claim, persists a v2 marker, and invalidates the source seal", () => {
  const sourceRoot = root();
  const sourceBinding = binding(sourceRoot);
  const source = seed(sourceBinding);
  const targetRoot = copyRoot(sourceRoot);
  const targetBinding = binding(targetRoot, {
    releaseDigest: TARGET_RELEASE,
    pvcName: "roebel-case-steward-control-restored",
    pvcUid: "22222222-2222-4222-8222-222222222222",
    pvName: "pvc-22222222-2222-4222-8222-222222222222",
  });
  const authorization = makeAuthorization(source, targetBinding);
  const adapter = activation(targetRoot, targetBinding, authorization);
  assert.deepEqual(readCanonicalCaseDurableDeploymentClaim(targetRoot), claimFor(targetBinding));
  assert.equal(existsSync(join(targetRoot, CASE_RECOVERY_ACTIVATION_FILENAME)), true);
  assert.equal(existsSync(join(targetRoot, CASE_SHUTDOWN_SEAL_FILENAME)), false);
  adapter.close();
  const marker = JSON.parse(readFileSync(join(targetRoot, CASE_RECOVERY_ACTIVATION_FILENAME), "utf8")) as Record<string, unknown>;
  assert.equal(marker.schemaVersion, "case_recovery_activation_v2");
  assert.equal((marker.targetDeploymentClaim as { claimChecksum: string }).claimChecksum, claimFor(targetBinding).claimChecksum);
});

test("a marker without authorization fails, while a renewed exact authorization resumes marker plus target claim without a local seal", () => {
  const sourceRoot = root();
  const sourceBinding = binding(sourceRoot);
  const source = seed(sourceBinding);
  const targetRoot = copyRoot(sourceRoot);
  const targetBinding = binding(targetRoot, {
    releaseDigest: TARGET_RELEASE,
    pvcName: "roebel-case-steward-control-restored",
    pvcUid: "22222222-2222-4222-8222-222222222222",
    pvName: "pvc-22222222-2222-4222-8222-222222222222",
  });
  const authorization = makeAuthorization(source, targetBinding);
  const first = activation(targetRoot, targetBinding, authorization);
  first.close();
  assert.throws(() => activation(targetRoot, targetBinding), /atomic_admission_recovery_marker_requires_activation/u);
  const forged = { schemaVersion: "staging_case_recovery_activation_authorization_v1" };
  assert.throws(() => activation(targetRoot, targetBinding, forged as never), /atomic_admission_recovery_activation_unavailable/u);
  const resumed = activation(targetRoot, targetBinding, authorization);
  const seal = resumed.sealAndClose();
  assert.equal(seal.deploymentClaimChecksum, claimFor(targetBinding).claimChecksum);
  assert.equal(existsSync(join(targetRoot, CASE_RECOVERY_ACTIVATION_FILENAME)), false);
});

test("marker plus source claim without the local source seal is rejected as an impossible crash state", () => {
  const sourceRoot = root();
  const sourceBinding = binding(sourceRoot);
  const source = seed(sourceBinding);
  const targetRoot = copyRoot(sourceRoot);
  const targetBinding = binding(targetRoot, {
    releaseDigest: TARGET_RELEASE,
    pvcName: "roebel-case-steward-control-restored",
    pvcUid: "22222222-2222-4222-8222-222222222222",
    pvName: "pvc-22222222-2222-4222-8222-222222222222",
  });
  const authorization = makeAuthorization(source, targetBinding);
  activation(targetRoot, targetBinding, authorization).close();
  assert.equal(existsSync(join(targetRoot, CASE_SHUTDOWN_SEAL_FILENAME)), false);
  writeFileSync(
    join(targetRoot, CASE_DURABLE_DEPLOYMENT_CLAIM_FILENAME),
    `${canonical(source.claim)}\n`,
    { mode: 0o600, flag: "w" },
  );
  assert.throws(
    () => activation(targetRoot, targetBinding, authorization),
    /atomic_admission_recovery_claim_mismatch/u,
  );
});

test("a new-process recovery authorization cannot roll its gate clock behind the durable marker", async () => {
  const state = await interruptedRecovery();
  const marker = JSON.parse(state.markerText) as { activatedAtUtc: string };
  const rollbackTimes = times(state.source.seal.closedAtUtc);
  assert.ok(new Date(rollbackTimes.issued).getTime() < new Date(marker.activatedAtUtc).getTime());
  // This is intentionally a newly created authorization, so its process-local
  // freshness watermark starts empty. The durable marker must still reject it.
  const rolledBackAuthorization = makeAuthorization(
    state.source,
    state.targetBinding,
    undefined,
    undefined,
    { value: rollbackTimes.issued },
  );
  assert.throws(
    () => activation(state.targetRoot, state.targetBinding, rolledBackAuthorization),
    /atomic_admission_recovery_activation_stale/u,
  );
  assert.equal(readFileSync(join(state.targetRoot, CASE_RECOVERY_ACTIVATION_FILENAME), "utf8"), state.markerText);
  assert.deepEqual(readCanonicalCaseDurableDeploymentClaim(state.targetRoot), state.claim);
  assert.equal(existsSync(join(state.targetRoot, CASE_SHUTDOWN_SEAL_FILENAME)), false);
});

test("an existing durable claim prevents a wrong municipality from poisoning a new owner binding", () => {
  const rootDir = root();
  const reviewed = binding(rootDir);
  const expectedClaim = claimFor(reviewed);
  writeFileSync(
    join(rootDir, CASE_DURABLE_DEPLOYMENT_CLAIM_FILENAME),
    `${canonical(expectedClaim)}\n`,
    { mode: 0o600, flag: "wx" },
  );
  assert.throws(() => createSqliteAtomicTopicCaseAdmission({
    ...options(rootDir, reviewed),
    municipalityId: "other-town",
    deploymentClaimToken: undefined,
  }), /atomic_admission_store_binding_mismatch/u);
  assert.throws(
    () => createSqliteAtomicTopicCaseAdmission(options(rootDir, reviewed)),
    /atomic_admission_unclean_epoch_requires_recovery/u,
  );
});

test("a target seal written before marker cleanup is reconciled only for the exact target claim", () => {
  const sourceRoot = root();
  const sourceBinding = binding(sourceRoot);
  const source = seed(sourceBinding);
  const targetRoot = copyRoot(sourceRoot);
  const targetBinding = binding(targetRoot, {
    releaseDigest: TARGET_RELEASE,
    pvcName: "roebel-case-steward-control-restored",
    pvcUid: "22222222-2222-4222-8222-222222222222",
    pvName: "pvc-22222222-2222-4222-8222-222222222222",
  });
  const authorization = makeAuthorization(source, targetBinding);
  const active = activation(targetRoot, targetBinding, authorization);
  const markerText = readFileSync(join(targetRoot, CASE_RECOVERY_ACTIVATION_FILENAME), "utf8");
  const targetSeal = active.sealAndClose();
  writeFileSync(join(targetRoot, CASE_RECOVERY_ACTIVATION_FILENAME), markerText, { mode: 0o600, flag: "wx" });
  chmodSync(join(targetRoot, CASE_RECOVERY_ACTIVATION_FILENAME), 0o600);
  assert.throws(() => createSqliteAtomicTopicCaseAdmission({
    ...options(targetRoot, targetBinding, { recoveryActivationAuthorization: authorization }),
    policyVersion: "case-intake-v2",
  }), /atomic_admission_config_mismatch/u);
  assert.equal(readFileSync(join(targetRoot, CASE_RECOVERY_ACTIVATION_FILENAME), "utf8"), markerText);
  assert.equal(existsSync(join(targetRoot, CASE_SHUTDOWN_SEAL_FILENAME)), true);
  const reconciled = activation(targetRoot, targetBinding, authorization);
  assert.equal(existsSync(join(targetRoot, CASE_RECOVERY_ACTIVATION_FILENAME)), false);
  assert.equal(targetSeal.deploymentClaimChecksum, claimFor(targetBinding).claimChecksum);
  assert.equal(reconciled.sealAndClose().deploymentClaimChecksum, claimFor(targetBinding).claimChecksum);
});

test("a completed target seal plus marker cannot be resumed without a deployment token", () => {
  const state = completedRecoveryWithMarker();
  assert.throws(
    () => createSqliteAtomicTopicCaseAdmission(options(state.targetRoot, state.targetBinding, {
      deploymentClaimToken: undefined,
    })),
    /atomic_admission_recovery_marker_requires_activation/u,
  );
  assert.equal(readFileSync(join(state.targetRoot, CASE_RECOVERY_ACTIVATION_FILENAME), "utf8"), state.markerText);
  assert.equal(existsSync(join(state.targetRoot, CASE_SHUTDOWN_SEAL_FILENAME)), true);
  assert.deepEqual(readCanonicalCaseDurableDeploymentClaim(state.targetRoot), state.claim);
  assert.equal(state.targetSeal.deploymentClaimChecksum, state.claim.claimChecksum);
});

test("a completed target seal plus marker rejects a token for a different reviewed target and preserves the marker", () => {
  const state = completedRecoveryWithMarker();
  const wrongTarget = binding(state.targetRoot, {
    releaseDigest: state.targetBinding.releaseDigest,
    pvcName: "roebel-case-steward-control-restored-other",
    pvcUid: "33333333-3333-4333-8333-333333333333",
    pvName: "pvc-33333333-3333-4333-8333-333333333333",
  });
  assert.throws(
    () => createSqliteAtomicTopicCaseAdmission(options(state.targetRoot, state.targetBinding, {
      deploymentClaimToken: tokenFor(wrongTarget),
      recoveryActivationAuthorization: state.authorization,
    })),
    /atomic_admission_recovery_marker_mismatch/u,
  );
  assert.equal(readFileSync(join(state.targetRoot, CASE_RECOVERY_ACTIVATION_FILENAME), "utf8"), state.markerText);
  assert.equal(existsSync(join(state.targetRoot, CASE_SHUTDOWN_SEAL_FILENAME)), true);
  assert.deepEqual(readCanonicalCaseDurableDeploymentClaim(state.targetRoot), state.claim);
  assert.equal(state.targetSeal.deploymentClaimChecksum, state.claim.claimChecksum);
});

test("forged tokens, forged authorizations, and mismatched target evidence fail before municipal DB open", () => {
  const emptyRoot = root();
  const emptyBinding = binding(emptyRoot);
  const forgedToken = { schemaVersion: "case_durable_deployment_claim_token_v1" };
  assert.throws(() => createSqliteAtomicTopicCaseAdmission(options(emptyRoot, emptyBinding, {
    deploymentClaimToken: forgedToken as never,
  })), /atomic_admission_options_invalid/u);
  assert.deepEqual(readdirSync(emptyRoot), []);

  const forgedClaimRoot = root();
  const forgedClaimBinding = binding(forgedClaimRoot);
  const forgedClaim = { ...claimFor(forgedClaimBinding), claimChecksum: CHECKSUM("9") };
  writeFileSync(join(forgedClaimRoot, CASE_DURABLE_DEPLOYMENT_CLAIM_FILENAME), `${canonical(forgedClaim)}\n`, { mode: 0o600, flag: "wx" });
  assert.throws(() => createSqliteAtomicTopicCaseAdmission(options(forgedClaimRoot, forgedClaimBinding)), /case_durable_deployment_claim_invalid/u);
  assert.equal(readdirSync(forgedClaimRoot).some((entry) => entry.endsWith("atomic-admission.sqlite")), false);

  const sourceRoot = root();
  const sourceBinding = binding(sourceRoot);
  const source = seed(sourceBinding);
  const targetRoot = copyRoot(sourceRoot);
  const targetA = binding(targetRoot, {
    releaseDigest: TARGET_RELEASE,
    pvcName: "roebel-case-steward-control-restored",
    pvcUid: "22222222-2222-4222-8222-222222222222",
    pvName: "pvc-22222222-2222-4222-8222-222222222222",
  });
  const targetB = binding(targetRoot, {
    releaseDigest: `sha256:${"f".repeat(64)}`,
    pvcName: "roebel-case-steward-control-restored-b",
    pvcUid: "33333333-3333-4333-8333-333333333333",
    pvName: "pvc-33333333-3333-4333-8333-333333333333",
  });
  const mismatched = makeAuthorization(source, targetB);
  assert.throws(() => activation(targetRoot, targetA, mismatched), /atomic_admission_recovery_activation_unavailable/u);
  assert.deepEqual(readCanonicalCaseDurableDeploymentClaim(targetRoot), source.claim);
  assert.equal(existsSync(join(targetRoot, CASE_SHUTDOWN_SEAL_FILENAME)), true);
});

test("all reviewed recovery source reads happen while the durable owner lock is held", () => {
  const sourceRoot = root();
  const sourceBinding = binding(sourceRoot);
  const source = seed(sourceBinding);
  const targetRoot = copyRoot(sourceRoot);
  const targetBinding = binding(targetRoot, {
    releaseDigest: TARGET_RELEASE,
    pvcName: "roebel-case-steward-control-restored",
    pvcUid: "22222222-2222-4222-8222-222222222222",
    pvName: "pvc-22222222-2222-4222-8222-222222222222",
  });
  const reads: string[] = [];
  const targetOptions = options(targetRoot, targetBinding);
  const authorization = createStagingCaseRecoveryActivationAuthorization({
    targetDeploymentClaimToken: tokenFor(targetBinding),
    recovery: recoverySources(source.claim, claimFor(targetBinding), source.seal, reads, () => {
      assert.throws(() => createSqliteAtomicTopicCaseAdmission(targetOptions), /atomic_admission_owner_locked/u);
      throw new Error("stop-after-lock-proof");
    }),
  });
  assert.throws(() => activation(targetRoot, targetBinding, authorization), /atomic_admission_recovery_activation_unavailable/u);
  assert.deepEqual(reads, ["policy"]);
  assert.equal(existsSync(join(targetRoot, CASE_SHUTDOWN_SEAL_FILENAME)), true);
  assert.equal(existsSync(join(targetRoot, CASE_RECOVERY_ACTIVATION_FILENAME)), false);
});

test("signed recovery evidence is re-read and cannot expire between activation and listener bind", () => {
  const sourceRoot = root();
  const sourceBinding = binding(sourceRoot);
  const source = seed(sourceBinding);
  const targetRoot = copyRoot(sourceRoot);
  const targetBinding = binding(targetRoot, {
    releaseDigest: TARGET_RELEASE,
    pvcName: "roebel-case-steward-control-restored",
    pvcUid: "22222222-2222-4222-8222-222222222222",
    pvName: "pvc-22222222-2222-4222-8222-222222222222",
  });
  const activationTimes = times(source.seal.closedAtUtc);
  const nowRef = { value: activationTimes.now };
  const authorization = makeAuthorization(source, targetBinding, undefined, undefined, nowRef);
  const adapter = activation(targetRoot, targetBinding, authorization);
  assert.doesNotThrow(() => assertStagingCaseRecoveryActivationAuthorizationFresh(authorization));
  // Establish the process-local watermark with an equal trusted timestamp,
  // then move the trusted clock backwards while it is still within the
  // attestation's validity window. The authority must reject the rollback as
  // stale rather than treating it as a fresh activation.
  nowRef.value = activationTimes.issued;
  assert.throws(
    () => assertStagingCaseRecoveryActivationAuthorizationFresh(authorization),
    /staging_case_recovery_activation_authorization_stale/u,
  );
  nowRef.value = activationTimes.expires;
  assert.throws(
    () => assertStagingCaseRecoveryActivationAuthorizationFresh(authorization),
    /staging_case_recovery_attestation_time_invalid/u,
  );
  adapter.close();
});

test("marker plus target claim with no local seal rejects a missing database and preserves the restart receipts", async () => {
  const state = await interruptedRecovery();
  unlinkSync(state.databasePath);
  assert.throws(
    () => activation(state.targetRoot, state.targetBinding, state.authorization),
    /atomic_admission_recovery_database_required/u,
  );
  assert.equal(existsSync(state.databasePath), false);
  assert.equal(readFileSync(join(state.targetRoot, CASE_RECOVERY_ACTIVATION_FILENAME), "utf8"), state.markerText);
  assert.deepEqual(readCanonicalCaseDurableDeploymentClaim(state.targetRoot), state.claim);
});

test("marker plus target claim with no local seal rejects a truncated database and preserves the restart receipts", async () => {
  const state = await interruptedRecovery();
  const originalSize = statSync(state.databasePath).size;
  assert.ok(originalSize > 1);
  truncateSync(state.databasePath, 0);
  assert.throws(
    () => activation(state.targetRoot, state.targetBinding, state.authorization),
    /atomic_admission_recovery_database_required/u,
  );
  assert.equal(statSync(state.databasePath).size, 0);
  assert.equal(readFileSync(join(state.targetRoot, CASE_RECOVERY_ACTIVATION_FILENAME), "utf8"), state.markerText);
  assert.deepEqual(readCanonicalCaseDurableDeploymentClaim(state.targetRoot), state.claim);
});

test("a valid current database below a non-empty marker source-seal baseline is rejected and preserves marker plus claim", async () => {
  const state = await interruptedRecovery(true);
  const emptyRoot = root();
  const emptyBinding = binding(emptyRoot);
  const empty = seed(emptyBinding);
  unlinkSync(state.databasePath);
  cpSync(join(emptyRoot, empty.seal.databaseBasename), state.databasePath);
  assert.throws(
    () => activation(state.targetRoot, state.targetBinding, state.authorization),
    /atomic_admission_recovery_database_below_baseline/u,
  );
  assert.equal(existsSync(state.databasePath), true);
  assert.equal(readFileSync(join(state.targetRoot, CASE_RECOVERY_ACTIVATION_FILENAME), "utf8"), state.markerText);
  assert.deepEqual(readCanonicalCaseDurableDeploymentClaim(state.targetRoot), state.claim);
});

test("an exact Operations claim reopens an open epoch, preserves admitted data, and seals a fresh baseline", async () => {
  const rootDir = root();
  const reviewed = binding(rootDir);
  const adapter = createSqliteAtomicTopicCaseAdmission(options(rootDir, reviewed));
  const receipt = await adapter.admission.admit(admittedInput());
  const before = adapter.outbox.replay();
  adapter.close();
  const openEpoch = readCanonicalCaseOpenEpoch(rootDir);
  assert.ok(openEpoch);
  assert.deepEqual(openEpoch.deploymentClaim, claimFor(reviewed));
  assert.equal(openEpoch.baselineShutdownSeal.recoveryEvidence.orderedHeads.length, 0);
  assert.equal(existsSync(join(rootDir, CASE_OPEN_EPOCH_FILENAME)), true);
  const reopened = createSqliteAtomicTopicCaseAdmission(options(rootDir, reviewed));
  assert.deepEqual(reopened.outbox.replay(), before);
  assert.equal(reopened.outbox.replay()[0]?.receipt.receiptChecksum, receipt.receiptChecksum);
  const seal = reopened.sealAndClose();
  assert.deepEqual(readCanonicalCaseDurableDeploymentClaim(rootDir), claimFor(reviewed));
  assert.equal(existsSync(join(rootDir, CASE_OPEN_EPOCH_FILENAME)), false);
  assert.equal(existsSync(join(rootDir, CASE_SHUTDOWN_SEAL_FILENAME)), true);
  assert.equal(seal.recoveryEvidence.orderedHeads.length, 1);
  assert.equal(seal.recoveryEvidence.orderedBindingEvidence.length, 1);
});

test("an open epoch with a missing database is rejected before recovery evidence can be reopened", () => {
  const rootDir = root();
  const reviewed = binding(rootDir);
  const adapter = createSqliteAtomicTopicCaseAdmission(options(rootDir, reviewed));
  adapter.close();
  const epochText = readFileSync(join(rootDir, CASE_OPEN_EPOCH_FILENAME), "utf8");
  unlinkSync(join(rootDir, `stadtstack-${MUNICIPALITY_ID}-atomic-admission.sqlite`));
  assert.throws(
    () => createSqliteAtomicTopicCaseAdmission(options(rootDir, reviewed)),
    /atomic_admission_recovery_database_required/u,
  );
  assert.equal(existsSync(join(rootDir, `stadtstack-${MUNICIPALITY_ID}-atomic-admission.sqlite`)), false);
  assert.equal(readFileSync(join(rootDir, CASE_OPEN_EPOCH_FILENAME), "utf8"), epochText);
  assert.deepEqual(readCanonicalCaseDurableDeploymentClaim(rootDir), claimFor(reviewed));
});

test("an open epoch with a non-empty baseline rejects a rolled-back current database", async () => {
  const rootDir = root();
  const reviewed = binding(rootDir);
  await seedWithCase(reviewed);
  const active = createSqliteAtomicTopicCaseAdmission(options(rootDir, reviewed));
  active.close();
  const epochText = readFileSync(join(rootDir, CASE_OPEN_EPOCH_FILENAME), "utf8");
  const openEpoch = readCanonicalCaseOpenEpoch(rootDir);
  assert.ok(openEpoch);
  assert.equal(openEpoch.baselineShutdownSeal.recoveryEvidence.orderedHeads.length, 1);

  const emptyRoot = root();
  const empty = seed(binding(emptyRoot));
  const databasePath = join(rootDir, `stadtstack-${MUNICIPALITY_ID}-atomic-admission.sqlite`);
  for (const suffix of ["-wal", "-shm"] as const) {
    const sidecar = `${databasePath}${suffix}`;
    if (existsSync(sidecar)) unlinkSync(sidecar);
  }
  unlinkSync(databasePath);
  cpSync(join(emptyRoot, empty.seal.databaseBasename), databasePath);
  assert.throws(
    () => createSqliteAtomicTopicCaseAdmission(options(rootDir, reviewed)),
    /atomic_admission_recovery_database_below_baseline/u,
  );
  assert.equal(readFileSync(join(rootDir, CASE_OPEN_EPOCH_FILENAME), "utf8"), epochText);
  assert.deepEqual(readCanonicalCaseDurableDeploymentClaim(rootDir), claimFor(reviewed));
  assert.equal(existsSync(databasePath), true);
});

test("a canonical bootstrap receipt plus the exact claim resumes schema creation and transitions to an open epoch", () => {
  const state = claimedRootWithoutDatabase();
  const bootstrap = createCaseStoreBootstrap({
    municipalityId: MUNICIPALITY_ID,
    deploymentClaim: state.claim,
    configFingerprint: state.configFingerprint,
    databaseBasename: state.databaseBasename,
  });
  writeCanonicalCaseStoreBootstrap(state.rootDir, bootstrap);
  assert.equal(existsSync(join(state.rootDir, CASE_STORE_BOOTSTRAP_FILENAME)), true);
  assert.deepEqual(readCanonicalCaseStoreBootstrap(state.rootDir), bootstrap);

  const adapter = createSqliteAtomicTopicCaseAdmission(options(state.rootDir, state.reviewed));
  assert.equal(existsSync(state.databasePath), true);
  assert.equal(statSync(state.databasePath).size > 0, true);
  assert.equal(readCanonicalCaseStoreBootstrap(state.rootDir), undefined);
  const openEpoch = readCanonicalCaseOpenEpoch(state.rootDir);
  assert.ok(openEpoch);
  assert.deepEqual(openEpoch.deploymentClaim, state.claim);
  assert.equal(openEpoch.baselineShutdownSeal.recoveryEvidence.orderedHeads.length, 0);

  const seal = adapter.sealAndClose();
  assert.equal(existsSync(join(state.rootDir, CASE_OPEN_EPOCH_FILENAME)), false);
  assert.equal(existsSync(join(state.rootDir, CASE_SHUTDOWN_SEAL_FILENAME)), true);
  assert.equal(seal.deploymentClaimChecksum, state.claim.claimChecksum);
});

test("an established claim cannot create a missing database without bootstrap, open-epoch, seal, or recovery marker evidence", () => {
  const state = claimedRootWithoutDatabase();
  assert.equal(readCanonicalCaseStoreBootstrap(state.rootDir), undefined);
  assert.equal(readCanonicalCaseOpenEpoch(state.rootDir), undefined);
  assert.equal(existsSync(join(state.rootDir, CASE_SHUTDOWN_SEAL_FILENAME)), false);
  assert.equal(existsSync(join(state.rootDir, CASE_RECOVERY_ACTIVATION_FILENAME)), false);
  assert.throws(
    () => createSqliteAtomicTopicCaseAdmission(options(state.rootDir, state.reviewed)),
    /atomic_admission_unclean_epoch_requires_recovery/u,
  );
  assert.equal(existsSync(state.databasePath), false);
  assert.deepEqual(readCanonicalCaseDurableDeploymentClaim(state.rootDir), state.claim);
});

test("a v2 shutdown seal is cryptographically bound to the durable deployment claim", () => {
  const rootDir = root();
  const reviewed = binding(rootDir);
  const source = seed(reviewed);
  assert.equal(source.seal.schemaVersion, "case_shutdown_seal_v2");
  assert.equal(source.seal.deploymentClaimChecksum, source.claim.claimChecksum);
  assert.throws(() => {
    const tampered = { ...source.seal, deploymentClaimChecksum: CHECKSUM("9") };
    writeFileSync(join(rootDir, CASE_SHUTDOWN_SEAL_FILENAME), `${canonical(tampered)}\n`, { mode: 0o600, flag: "w" });
    createSqliteAtomicTopicCaseAdmission(options(rootDir, reviewed));
  }, /atomic_admission_seal_invalid/u);
  writeFileSync(join(rootDir, CASE_SHUTDOWN_SEAL_FILENAME), `${canonical(source.seal)}\n`, { mode: 0o600, flag: "w" });
  assert.equal(statSync(join(rootDir, CASE_DURABLE_DEPLOYMENT_CLAIM_FILENAME)).mode & 0o777, 0o600);
});
