import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { join } from "node:path";
import test, { after } from "node:test";

import {
  createRecoveryActivatedOperationsBoundStagingCaseControlRuntime,
  createOperationsBoundStagingCaseControlRuntime,
  type OperationsBoundStagingCaseControlApplicationConfig,
} from "../src/staging-case-control-runtime.ts";
import {
  CASE_RECOVERY_ACTIVATION_FILENAME,
  CASE_SHUTDOWN_SEAL_FILENAME,
  verifyCaseShutdownSeal,
} from "../src/adapters/sqlite-atomic-topic-case-admission.ts";
import {
  CASE_DURABLE_DEPLOYMENT_CLAIM_FILENAME,
  readCanonicalCaseDurableDeploymentClaim,
  verifyCaseDurableDeploymentClaim,
  type CaseDurableDeploymentClaim,
} from "../src/case-durable-deployment-claim.ts";
import type {
  StagingCaseControlReviewedBindingV1,
  StagingCaseControlStorageObservation,
} from "../src/staging-case-control-preflight.ts";
import type { CaseShutdownSealV2 } from "../src/case-shutdown-seal.ts";
import type { StagingCaseRecoveryGateInput } from "../src/staging-case-recovery-attestation.ts";

const MUNICIPALITY_ID = "roebel-mueritz";
const ROOTS = new Set<string>();

after(() => { for (const root of ROOTS) rmSync(root, { recursive: true, force: true }); });

function root(): string {
  const parent = process.env.STADTSTACK_TEST_DURABLE_PARENT ?? process.cwd();
  const value = mkdtempSync(join(parent, ".stadtstack-deployment-control-"));
  ROOTS.add(value);
  return value;
}

function copyRoot(sourceRoot: string): string {
  const targetRoot = root();
  cpSync(sourceRoot, targetRoot, { recursive: true });
  return targetRoot;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function checksum(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
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
    workload: {
      serviceAccountName: "roebel-case-steward-control",
      automountServiceAccountToken: false as const,
    },
    releaseDigest: overrides.releaseDigest ?? `sha256:${"a".repeat(64)}`,
    operationsTopologyChecksum: `sha256:${"b".repeat(64)}`,
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
      minAvailableBytes: "1073741824",
      marker: {
        fileName: "staging-case-control-storage.marker.json",
        checksum: "",
        uid: 10001,
        gid: 10001,
        mode: "0600",
      },
    },
    listeners: [
      { id: "admission" as const, port: 18085 as const, bindScope: "pod_network" as const },
      { id: "private-outbox" as const, port: 18087 as const, bindScope: "pod_network" as const },
      { id: "probe" as const, port: 18088 as const, bindScope: "pod_network" as const },
    ],
  };
  unsigned.storage.marker.checksum = `sha256:${createHash("sha256").update(`${canonical(markerBody(unsigned))}\n`, "utf8").digest("hex")}`;
  return Object.freeze({ ...unsigned, bindingChecksum: checksum(unsigned) }) as StagingCaseControlReviewedBindingV1;
}

function observation(value: StagingCaseControlReviewedBindingV1, availableBytes = BigInt(value.storage.minAvailableBytes)): StagingCaseControlStorageObservation {
  return Object.freeze({
    rootDir: value.storage.rootDir,
    rootKind: "directory" as const,
    rootIsSymbolicLink: false,
    rootUid: value.storage.uid,
    rootGid: value.storage.gid,
    rootMode: Number.parseInt(value.storage.mode, 8),
    filesystemType: BigInt(value.storage.filesystemType),
    availableBytes,
    markerPath: `${value.storage.rootDir}/${value.storage.marker.fileName}`,
    markerKind: "file" as const,
    markerIsSymbolicLink: false,
    markerUid: value.storage.marker.uid,
    markerGid: value.storage.marker.gid,
    markerMode: Number.parseInt(value.storage.marker.mode, 8),
    markerText: `${canonical(markerBody(value))}\n`,
  });
}

function application(): OperationsBoundStagingCaseControlApplicationConfig {
  return {
    municipalityId: MUNICIPALITY_ID,
    policyVersion: "case-intake-v1",
    actorRegistry: [{ actorId: "roebel:case-steward", actorClass: "case_steward" }],
    allowedSignerPubkeys: ["c".repeat(64)],
    allowedAgentPubkeys: ["d".repeat(64)],
    credentials: [{
      principal: { actorId: "roebel:case-steward", actorClass: "case_steward", municipalityIds: [MUNICIPALITY_ID] },
      token: Buffer.alloc(32, 71).toString("base64url"),
    }],
    admissionAllowedHosts: ["127.0.0.1"],
    outboxAllowedHosts: ["127.0.0.1"],
    probeAllowedHosts: ["127.0.0.1"],
    drainTimeoutMs: 500,
  };
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
  return verifyCaseDurableDeploymentClaim({ ...unsigned, claimChecksum: checksum(unsigned) });
}

function recoveryGate(
  sourceClaim: CaseDurableDeploymentClaim,
  targetClaim: CaseDurableDeploymentClaim,
  shutdownSeal: CaseShutdownSealV2,
  nowRef: { value: string },
): StagingCaseRecoveryGateInput {
  const pair = generateKeyPairSync("ed25519");
  const spki = pair.publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const base = new Date(shutdownSeal.closedAtUtc).getTime();
  const at = (minutes: number): string => new Date(base + minutes * 60_000).toISOString();
  const completionReceipt = {
    bucket: "stadtstack-backups", key: "cases/backup-receipt.json", objectVersion: "receipt-v1",
    checksum: `sha256:${"d".repeat(64)}`, keyVersion: "backup-key-v1",
  };
  const encryptedManifest = {
    bucket: "stadtstack-backups", key: "cases/manifest.age", objectVersion: "manifest-v1",
    checksum: `sha256:${"e".repeat(64)}`,
  };
  const catalogUnsigned = {
    schemaVersion: "case_backup_catalog_locator_v1" as const, deploymentEnvironment: "staging" as const,
    municipalityId: MUNICIPALITY_ID, storeId: "roebel-case-store", recoveryOperationId: "01983a00-0000-7000-8000-000000000001",
    casGeneration: "7", backupId: "01983a00-0000-7000-8000-000000000002", completionReceipt, encryptedManifest,
    retentionUntilUtc: "2099-01-01T00:00:00.000Z",
  };
  const catalog = { ...catalogUnsigned, locatorChecksum: checksum(catalogUnsigned) };
  const policyUnsigned = {
    schemaVersion: "staging_case_recovery_policy_v1" as const, deploymentEnvironment: "staging" as const,
    municipalityId: MUNICIPALITY_ID, storeId: "roebel-case-store", sourcePvc: sourceClaim.pvc, targetPvc: targetClaim.pvc,
    targetPvName: targetClaim.pvName, recoveryOperationId: "01983a00-0000-7000-8000-000000000001",
    controlDeploymentBindingChecksum: targetClaim.controlDeploymentBindingChecksum, catalogLocatorChecksum: catalog.locatorChecksum,
    restoreVerifierReleaseDigest: `sha256:${"1".repeat(64)}`,
    signer: {
      algorithm: "Ed25519" as const, purpose: "staging_case_recovery_attestation" as const, status: "active" as const,
      keyId: "recovery-attester", keyVersion: "ed25519-v1", spkiDerBase64url: spki.toString("base64url"),
      spkiSha256: `sha256:${createHash("sha256").update(spki).digest("hex")}`,
      activeFromUtc: "2020-01-01T00:00:00.000Z", activeUntilUtc: "2099-01-01T00:00:00.000Z",
    },
    maxAgeSeconds: 86_400 as const, maxRtoSeconds: 14_400 as const,
  };
  const policy = { ...policyUnsigned, policyChecksum: checksum(policyUnsigned) };
  const recoveryEvidenceChecksum = checksum(shutdownSeal.recoveryEvidence);
  const seal = {
    sealChecksum: shutdownSeal.sealChecksum, closedAtUtc: shutdownSeal.closedAtUtc,
    databaseSchemaVersion: shutdownSeal.databaseSchemaVersion, configFingerprint: shutdownSeal.configFingerprint,
    sourceReleaseDigest: shutdownSeal.sourceReleaseDigest, deploymentClaimChecksum: shutdownSeal.deploymentClaimChecksum,
    databaseBasename: shutdownSeal.databaseBasename, databaseByteLength: shutdownSeal.databaseByteLength,
    databaseSha256: shutdownSeal.databaseSha256, recoveryEvidenceChecksum,
    caseCount: shutdownSeal.recoveryEvidence.orderedHeads.length, outboxCursor: shutdownSeal.recoveryEvidence.outboxCursor,
    headsAggregateChecksum: shutdownSeal.recoveryEvidence.headsAggregateChecksum,
    publicProjectionChecksum: shutdownSeal.recoveryEvidence.publicProjectionChecksum,
  };
  const restoreReportUnsigned = {
    verifierReleaseDigest: policy.restoreVerifierReleaseDigest, restoredDatabaseByteLength: shutdownSeal.databaseByteLength,
    restoredDatabaseSha256: shutdownSeal.databaseSha256, integrity: "ok" as const, recoveryEvidenceChecksum,
    caseCount: shutdownSeal.recoveryEvidence.orderedHeads.length, outboxCursor: shutdownSeal.recoveryEvidence.outboxCursor,
    headsAggregateChecksum: shutdownSeal.recoveryEvidence.headsAggregateChecksum,
    publicProjectionChecksum: shutdownSeal.recoveryEvidence.publicProjectionChecksum, isolatedRestore: true as const,
    startedAtUtc: at(1), completedAtUtc: at(2), rtoSeconds: 60,
  };
  const restoreReport = { ...restoreReportUnsigned, restoreReportChecksum: checksum(restoreReportUnsigned) };
  const attestationUnsigned = {
    schemaVersion: "staging_case_recovery_attestation_v2" as const, deploymentEnvironment: "staging" as const,
    municipalityId: MUNICIPALITY_ID, storeId: "roebel-case-store", recoveryOperationId: "01983a00-0000-7000-8000-000000000001",
    policyChecksum: policy.policyChecksum, controlDeploymentBindingChecksum: targetClaim.controlDeploymentBindingChecksum,
    catalogLocatorChecksum: catalog.locatorChecksum, casGeneration: "7", backupId: "01983a00-0000-7000-8000-000000000002",
    completionReceipt, encryptedManifest, sourcePvcUid: sourceClaim.pvc.uid, targetPvcUid: targetClaim.pvc.uid,
    targetPvName: targetClaim.pvName, seal, restoreReport, issuedAtUtc: at(3), expiresAtUtc: at(1_440),
    signerKeyId: "recovery-attester", signerKeyVersion: "ed25519-v1", signatureAlgorithm: "Ed25519" as const,
  };
  const envelope = { ...attestationUnsigned, attestationChecksum: checksum(attestationUnsigned) };
  const attestation = {
    ...envelope,
    signature: sign(null, Buffer.from(`stadtstack:staging-case-recovery-attestation:v2\0${canonical(envelope)}`, "utf8"), pair.privateKey).toString("base64url"),
  };
  return Object.freeze({
    recoveryPolicySource: Object.freeze({ read: () => policy }),
    recoveryPolicyPinSource: Object.freeze({ read: () => policy.policyChecksum }),
    shutdownSealSource: Object.freeze({ read: () => shutdownSeal }),
    catalogLocatorSource: Object.freeze({ read: () => catalog }),
    recoveryAttestationSource: Object.freeze({ read: () => attestation }),
    clock: Object.freeze({ now: () => nowRef.value }),
  });
}

function reviewedSources(
  value: StagingCaseControlReviewedBindingV1,
  expectedBindingChecksum = value.bindingChecksum,
  reads?: string[],
) {
  return Object.freeze({
    reviewedBindingSource: Object.freeze({
      read: () => { reads?.push("binding"); return value; },
    }),
    bindingPinSource: Object.freeze({
      read: () => { reads?.push("pin"); return expectedBindingChecksum; },
    }),
  });
}

function request(port: number, path: string): Promise<Readonly<{ status: number; body: string }>> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ host: "127.0.0.1", port, path, headers: { host: "127.0.0.1", connection: "close" } }, (incoming) => {
      let body = "";
      incoming.setEncoding("utf8");
      incoming.on("data", (chunk: string) => { body += chunk; });
      incoming.once("end", () => resolve(Object.freeze({ status: incoming.statusCode ?? 0, body })));
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("reviewed Operations facts authorize only the exact control Pod-network listeners", async () => {
  const rootDir = root();
  const reviewedBinding = binding(rootDir);
  const observed = observation(reviewedBinding);
  const reads: string[] = [];
  const runtime = createOperationsBoundStagingCaseControlRuntime({
    ...reviewedSources(reviewedBinding, reviewedBinding.bindingChecksum, reads),
    storageObserver: Object.freeze({ observe: () => { reads.push("storage"); return observed; } }),
    application: application(),
  });
  assert.deepEqual(reads, ["binding", "pin", "storage"]);
  assert.equal(readdirSync(rootDir).includes(`stadtstack-${MUNICIPALITY_ID}-atomic-admission.sqlite`), true);
  assert.deepEqual(Reflect.ownKeys(runtime), ["start", "health", "close"]);
  await runtime.start();
  assert.deepEqual(runtime.health().ports, { probe: 18088, outbox: 18087, admission: 18085 });
  assert.deepEqual(await request(18088, "/readyz"), { status: 200, body: "ok\n" });
  await runtime.close();
  assert.equal(runtime.health().phase, "stopped");
});

test("a failed storage preflight creates neither SQLite nor a control listener", async () => {
  const rootDir = root();
  const reviewedBinding = binding(rootDir);
  const observed = observation(reviewedBinding, BigInt(reviewedBinding.storage.minAvailableBytes) - 1n);
  assert.throws(() => createOperationsBoundStagingCaseControlRuntime({
    ...reviewedSources(reviewedBinding),
    storageObserver: Object.freeze({ observe: () => observed }),
    application: application(),
  }), /staging_case_control_preflight_observation_mismatch/u);
  assert.deepEqual(readdirSync(rootDir), []);

  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(18085, "127.0.0.1", resolve);
  });
  await closeServer(server);
});

test("recovery evidence is read only under the durable owner lock and failure exposes no listener", async () => {
  const sourceRoot = root();
  const sourceBinding = binding(sourceRoot);
  const app = application();
  const sourceRuntime = createOperationsBoundStagingCaseControlRuntime({
    ...reviewedSources(sourceBinding),
    storageObserver: Object.freeze({ observe: () => observation(sourceBinding) }),
    application: app,
  });
  await sourceRuntime.close();
  assert.equal(existsSync(join(sourceRoot, CASE_SHUTDOWN_SEAL_FILENAME)), true);

  const targetRoot = copyRoot(sourceRoot);
  const copiedClaimText = readFileSync(join(targetRoot, CASE_DURABLE_DEPLOYMENT_CLAIM_FILENAME), "utf8");
  const copiedSealText = readFileSync(join(targetRoot, CASE_SHUTDOWN_SEAL_FILENAME), "utf8");
  const targetBinding = binding(targetRoot, {
    releaseDigest: `sha256:${"e".repeat(64)}`,
    pvcName: "roebel-case-steward-control-restored",
    pvcUid: "22222222-2222-4222-8222-222222222222",
    pvName: "pvc-22222222-2222-4222-8222-222222222222",
  });

  // A copied source volume is not a valid ordinary target deployment. The
  // durable claim check runs before servers or listener lifecycles exist.
  assert.throws(() => createOperationsBoundStagingCaseControlRuntime({
    ...reviewedSources(targetBinding),
    storageObserver: Object.freeze({ observe: () => observation(targetBinding) }),
    application: app,
  }), /atomic_admission_deployment_claim_mismatch/u);
  assert.equal(existsSync(join(targetRoot, CASE_SHUTDOWN_SEAL_FILENAME)), true);
  assert.equal(existsSync(join(targetRoot, CASE_RECOVERY_ACTIVATION_FILENAME)), false);

  const reads: string[] = [];

  assert.throws(() => createRecoveryActivatedOperationsBoundStagingCaseControlRuntime({
    ...reviewedSources(targetBinding),
    storageObserver: Object.freeze({ observe: () => observation(targetBinding) }),
    recovery: Object.freeze({
      recoveryPolicySource: Object.freeze({
        read: () => {
          reads.push("policy");
          assert.equal(existsSync(join(targetRoot, CASE_SHUTDOWN_SEAL_FILENAME)), true);
          assert.throws(
            () => createOperationsBoundStagingCaseControlRuntime({
              ...reviewedSources(targetBinding),
              storageObserver: Object.freeze({ observe: () => observation(targetBinding) }),
              application: app,
            }),
            /atomic_admission_owner_locked/u,
          );
          throw new Error("offline");
        },
      }),
      recoveryPolicyPinSource: Object.freeze({ read: () => { reads.push("pin"); return undefined; } }),
      shutdownSealSource: Object.freeze({ read: () => { reads.push("seal"); return undefined; } }),
      catalogLocatorSource: Object.freeze({ read: () => { reads.push("catalog"); return undefined; } }),
      recoveryAttestationSource: Object.freeze({ read: () => { reads.push("attestation"); return undefined; } }),
      clock: Object.freeze({ now: () => "2026-08-23T12:31:00.000Z" }),
    }),
    application: app,
  }), /atomic_admission_recovery_activation_unavailable/u);

  assert.deepEqual(reads, ["policy"]);
  assert.equal(existsSync(join(targetRoot, CASE_SHUTDOWN_SEAL_FILENAME)), true);
  assert.equal(existsSync(join(targetRoot, CASE_RECOVERY_ACTIVATION_FILENAME)), false);
  assert.equal(readFileSync(join(targetRoot, CASE_DURABLE_DEPLOYMENT_CLAIM_FILENAME), "utf8"), copiedClaimText);
  assert.equal(readFileSync(join(targetRoot, CASE_SHUTDOWN_SEAL_FILENAME), "utf8"), copiedSealText);

  // The failed recovery attempt must release the owner lock without changing
  // the copied source state. The next ordinary attempt reaches claim
  // validation (rather than being rejected as owner-locked).
  assert.throws(() => createOperationsBoundStagingCaseControlRuntime({
    ...reviewedSources(targetBinding),
    storageObserver: Object.freeze({ observe: () => observation(targetBinding) }),
    application: app,
  }), /atomic_admission_deployment_claim_mismatch/u);

  // A failed callback releases the lock and leaves a conventionally sealed
  // store recoverable through a later reviewed attempt.
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(18085, "127.0.0.1", resolve);
  });
  await closeServer(server);
});

test("a recovery freshness failure aborts without sealing and leaves the marker for a renewed reviewed activation", async () => {
  const sourceRoot = root();
  const sourceBinding = binding(sourceRoot);
  const app = application();
  const sourceRuntime = createOperationsBoundStagingCaseControlRuntime({
    ...reviewedSources(sourceBinding),
    storageObserver: Object.freeze({ observe: () => observation(sourceBinding) }),
    application: app,
  });
  await sourceRuntime.close();
  const sourceClaim = readCanonicalCaseDurableDeploymentClaim(sourceRoot);
  assert.ok(sourceClaim);
  const sourceSeal = verifyCaseShutdownSeal(JSON.parse(readFileSync(join(sourceRoot, CASE_SHUTDOWN_SEAL_FILENAME), "utf8")));

  const targetRoot = copyRoot(sourceRoot);
  const targetBinding = binding(targetRoot, {
    releaseDigest: `sha256:${"e".repeat(64)}`,
    pvcName: "roebel-case-steward-control-restored",
    pvcUid: "22222222-2222-4222-8222-222222222222",
    pvName: "pvc-22222222-2222-4222-8222-222222222222",
  });
  const initialNow = new Date(new Date(sourceSeal.closedAtUtc).getTime() + 4 * 60_000).toISOString();
  const expiresAt = new Date(new Date(sourceSeal.closedAtUtc).getTime() + 1_440 * 60_000).toISOString();
  const nowRef = { value: initialNow };
  const runtime = createRecoveryActivatedOperationsBoundStagingCaseControlRuntime({
    ...reviewedSources(targetBinding),
    storageObserver: Object.freeze({ observe: () => observation(targetBinding) }),
    recovery: recoveryGate(sourceClaim, claimFor(targetBinding), sourceSeal, nowRef),
    application: app,
  });
  const markerPath = join(targetRoot, CASE_RECOVERY_ACTIVATION_FILENAME);
  const markerText = readFileSync(markerPath, "utf8");
  assert.equal(existsSync(join(targetRoot, CASE_SHUTDOWN_SEAL_FILENAME)), false);
  const targetClaim = readCanonicalCaseDurableDeploymentClaim(targetRoot);
  assert.deepEqual(targetClaim, claimFor(targetBinding));

  // The constructor's reviewed gate was valid. The bind-time reread is not:
  // it reaches expiry before the very first listener can bind.
  nowRef.value = expiresAt;
  await assert.rejects(runtime.start(), /staging_case_process_start_failed/u);
  await runtime.close();
  assert.equal(readFileSync(markerPath, "utf8"), markerText);
  assert.deepEqual(readCanonicalCaseDurableDeploymentClaim(targetRoot), targetClaim);
  assert.equal(existsSync(join(targetRoot, CASE_SHUTDOWN_SEAL_FILENAME)), false);
  // The ordinary target composition has no recovery authority, so it cannot
  // consume this interrupted activation or manufacture a clean target epoch.
  assert.throws(() => createOperationsBoundStagingCaseControlRuntime({
    ...reviewedSources(targetBinding),
    storageObserver: Object.freeze({ observe: () => observation(targetBinding) }),
    application: app,
  }), /atomic_admission_recovery_marker_requires_activation/u);
});

test("a changed reviewed binding cannot replace its independently pinned checksum", () => {
  const rootDir = root();
  const original = binding(rootDir);
  const { bindingChecksum: originalChecksum, ...unsigned } = original;
  const changedUnsigned = { ...unsigned, releaseDigest: `sha256:${"e".repeat(64)}` };
  const changed = Object.freeze({
    ...changedUnsigned,
    bindingChecksum: checksum(changedUnsigned),
  }) as StagingCaseControlReviewedBindingV1;
  let observationReads = 0;
  assert.throws(() => createOperationsBoundStagingCaseControlRuntime({
    ...reviewedSources(changed, originalChecksum),
    storageObserver: Object.freeze({
      observe: () => { observationReads += 1; return observation(changed); },
    }),
    application: application(),
  }), /staging_case_control_preflight_binding_pin_mismatch/u);
  assert.equal(observationReads, 0);
  assert.deepEqual(readdirSync(rootDir), []);
});

test("callers cannot smuggle storage, release, host, port, or a different municipality through application config", () => {
  const rootDir = root();
  const reviewedBinding = binding(rootDir);
  const observed = observation(reviewedBinding);
  for (const extra of ["rootDir", "releaseDigest", "host", "port", "pvcUid"] as const) {
    assert.throws(() => createOperationsBoundStagingCaseControlRuntime({
      ...reviewedSources(reviewedBinding),
      storageObserver: Object.freeze({ observe: () => observed }),
      application: { ...application(), [extra]: "forbidden" } as never,
    }), /staging_case_control_runtime_config_invalid/u);
  }
  assert.throws(() => createOperationsBoundStagingCaseControlRuntime({
    ...reviewedSources(reviewedBinding),
    storageObserver: Object.freeze({ observe: () => observed }),
    application: { ...application(), municipalityId: "other-town" },
  }), /staging_case_control_runtime_config_invalid/u);
  assert.deepEqual(readdirSync(rootDir), []);
});
