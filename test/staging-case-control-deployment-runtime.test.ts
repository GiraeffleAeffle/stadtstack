import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, statfsSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import test, { after, type TestContext } from "node:test";

import {
  createRecoveryActivatedOperationsBoundStagingCaseControlRuntime,
  createOperationsBoundStagingCaseControlRuntime,
  activateOperationsBoundSyntheticReviewMigration,
  type OperationsBoundStagingCaseControlApplicationConfig,
} from "../src/staging-case-control-runtime.ts";
import {
  createSqliteAtomicTopicCaseAdmission,
  prepareSyntheticDepartmentReviewMigration,
  activateSyntheticDepartmentReviewMigration,
  SYNTHETIC_REVIEW_MIGRATION_INTENT_FILENAME,
  SYNTHETIC_REVIEW_MIGRATION_ACTIVATION_FILENAME,
  type SyntheticReviewMigrationSourceConfig,
  CASE_RECOVERY_ACTIVATION_FILENAME,
  CASE_SHUTDOWN_SEAL_FILENAME,
  verifyCaseShutdownSeal,
} from "../src/adapters/sqlite-atomic-topic-case-admission.ts";
import {
  createCaseDurableDeploymentClaimToken,
  CASE_DURABLE_DEPLOYMENT_CLAIM_FILENAME,
  readCanonicalCaseDurableDeploymentClaim,
  verifyCaseDurableDeploymentClaim,
  type CaseDurableDeploymentClaim,
} from "../src/case-durable-deployment-claim.ts";
import {
  createStagingCaseControlDeploymentProof,
  type StagingCaseControlReviewedBinding,
  type StagingCaseControlReviewedBindingV1,
  type StagingCaseControlStorageObservation,
} from "../src/staging-case-control-preflight.ts";
import type { ActorRegistration } from "../src/civic-case-coordinator.ts";
import type { SyntheticAdoptionEvidenceBundle, SyntheticAdoptionEvidencePolicy } from "../src/citizen-adoption-evidence.ts";
import type { CaseShutdownSealV2 } from "../src/case-shutdown-seal.ts";
import type { StagingCaseRecoveryGateInput } from "../src/staging-case-recovery-attestation.ts";
import { createStagingSyntheticReviewMigrationAuthorization, type StagingSyntheticReviewMigrationPlanV1 } from "../src/staging-synthetic-review-migration-authority.ts";

const MUNICIPALITY_ID = "roebel-mueritz";
const ROOTS = new Set<string>();

// The SIGKILL worker cannot run finally cleanup. Keep all its candidate files
// in this test process's temporary namespace and reclaim them from the parent.
const previousTemporaryRoot = process.env.TMPDIR;
const testTemporaryRoot = realpathSync(mkdtempSync(join(tmpdir(), "stadtstack-deployment-test-")));
process.env.TMPDIR = testTemporaryRoot;
after(() => {
  for (const root of ROOTS) rmSync(root, { recursive: true, force: true });
  if (previousTemporaryRoot === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTemporaryRoot;
  rmSync(testTemporaryRoot, { recursive: true, force: true });
});

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

function markerBody(binding: Omit<StagingCaseControlReviewedBinding, "bindingChecksum">): Record<string, unknown> {
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
  municipalityId?: string;
  releaseDigest?: string;
  pvcName?: string;
  pvcUid?: string;
  pvName?: string;
  realMount?: boolean;
}> = {}): StagingCaseControlReviewedBindingV1 {
  const unsigned = {
    schemaVersion: "staging_case_control_deployment_binding_v1" as const,
    deploymentEnvironment: "staging" as const,
    municipalityId: overrides.municipalityId ?? MUNICIPALITY_ID,
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
  if (overrides.realMount) {
    chmodSync(rootDir, 0o700);
    const actual = statSync(rootDir);
    unsigned.storage.uid = actual.uid;
    unsigned.storage.gid = actual.gid;
    unsigned.storage.filesystemType = `0x${statfsSync(rootDir, { bigint: true }).type.toString(16)}`;
    unsigned.storage.marker.uid = actual.uid;
    unsigned.storage.marker.gid = actual.gid;
  }
  unsigned.storage.marker.checksum = `sha256:${createHash("sha256").update(`${canonical(markerBody(unsigned))}\n`, "utf8").digest("hex")}`;
  if (overrides.realMount) {
    writeFileSync(join(rootDir, unsigned.storage.marker.fileName), `${canonical(markerBody(unsigned))}\n`, { mode: 0o600 });
  }
  return Object.freeze({ ...unsigned, bindingChecksum: checksum(unsigned) }) as StagingCaseControlReviewedBindingV1;
}

function observation(value: StagingCaseControlReviewedBinding, availableBytes = BigInt(value.storage.minAvailableBytes)): StagingCaseControlStorageObservation {
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
  value: StagingCaseControlReviewedBinding,
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

test("mounted control entrypoint uses the real storage observer, authenticates staff and seals on shutdown", async () => {
  const rootDir = root();
  const reviewedBinding = binding(rootDir, { realMount: true });
  const files = root();
  const applicationPath = join(files, "application.json");
  const bindingPath = join(files, "binding.json");
  const config = application();
  writeFileSync(applicationPath, JSON.stringify(config), { mode: 0o600 });
  writeFileSync(bindingPath, JSON.stringify(reviewedBinding), { mode: 0o600 });
  const child = spawn(process.execPath, ["--experimental-strip-types", "containers/case-runtime/case-steward-control-entrypoint.mjs"], {
    env: { PATH: process.env.PATH, NODE_NO_WARNINGS: "1",
      STADTSTACK_CASE_CONTROL_CONFIG_PATH: applicationPath,
      STADTSTACK_CASE_CONTROL_REVIEWED_BINDING_PATH: bindingPath,
      STADTSTACK_CASE_CONTROL_BINDING_SHA256: reviewedBinding.bindingChecksum },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let diagnostics = "";
  child.stderr.on("data", (chunk) => { diagnostics += String(chunk); });
  const exited = once(child, "exit");
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("control entrypoint did not become ready")), 8_000);
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("exit", () => { clearTimeout(timeout); reject(new Error("control entrypoint exited before readiness")); });
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
        if (output === "stadtstack_case_steward_control_reviewed_control_ready\n") {
          clearTimeout(timeout); resolve();
        }
      });
    });
    assert.deepEqual(await request(18088, "/readyz"), { status: 200, body: "ok\n" });
    const body = JSON.stringify({ schemaVersion: "not-an-admission" });
    const attempt = (authorization?: string) => new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port: 18085, method: "POST", path: "/v1/nostr/suggestions/admit",
        headers: { host: "127.0.0.1", "content-type": "application/json", "content-length": Buffer.byteLength(body),
          ...(authorization ? { authorization } : {}) } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode!)); });
      req.on("error", reject); req.end(body);
    });
    assert.equal(await attempt(), 400);
    assert.equal(await attempt(`Bearer ${Buffer.alloc(32, 12).toString("base64url")}`), 401);
    assert.equal(await attempt(`Bearer ${config.credentials[0]!.token}`), 400);
    child.kill("SIGTERM");
    assert.deepEqual(await exited, [0, null]);
    assert.equal(diagnostics, "");
    const seal = verifyCaseShutdownSeal(JSON.parse(readFileSync(join(rootDir, CASE_SHUTDOWN_SEAL_FILENAME), "utf8")));
    assert.equal(seal.recoveryEvidence.orderedHeads.length, 0);
    const claim = readCanonicalCaseDurableDeploymentClaim(rootDir);
    assert.ok(claim);
    assert.equal(claim.controlDeploymentBindingChecksum, reviewedBinding.bindingChecksum);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
  }
});

test("mounted control entrypoint rejects partial pins, drift and exposed credentials before database creation", () => {
  const rootDir = root();
  const reviewedBinding = binding(rootDir, { realMount: true });
  const files = root();
  const applicationPath = join(files, "application.json");
  const bindingPath = join(files, "binding.json");
  writeFileSync(applicationPath, JSON.stringify(application()), { mode: 0o600 });
  writeFileSync(bindingPath, JSON.stringify(reviewedBinding), { mode: 0o600 });
  const base = { PATH: process.env.PATH, NODE_NO_WARNINGS: "1", STADTSTACK_CASE_CONTROL_CONFIG_PATH: applicationPath,
    STADTSTACK_CASE_CONTROL_REVIEWED_BINDING_PATH: bindingPath,
    STADTSTACK_CASE_CONTROL_BINDING_SHA256: reviewedBinding.bindingChecksum };
  const before = readdirSync(rootDir);
  const reject = (env: NodeJS.ProcessEnv, entrypoint = "case-steward-control-entrypoint.mjs") => {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", `containers/case-runtime/${entrypoint}`],
      { env, encoding: "utf8", timeout: 5_000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 78);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^stadtstack_case_(?:steward_control|public_binding)_start_failed\n$/u);
    assert.deepEqual(readdirSync(rootDir), before);
  };
  const partial: NodeJS.ProcessEnv = { ...base }; delete partial.STADTSTACK_CASE_CONTROL_BINDING_SHA256;
  reject(partial);
  reject({ ...base, STADTSTACK_CASE_CONTROL_BINDING_SHA256: `sha256:${"f".repeat(64)}` });
  reject({ ...base, STADTSTACK_CASE_PUBLIC_CONFIG_PATH: applicationPath }, "case-public-binding-entrypoint.mjs");
  chmodSync(applicationPath, 0o644); reject(base); chmodSync(applicationPath, 0o600);
  writeFileSync(applicationPath, JSON.stringify({ ...application(), storageObserver: {} })); reject(base);
  writeFileSync(applicationPath, JSON.stringify(application()));
  writeFileSync(join(rootDir, reviewedBinding.storage.marker.fileName), "changed marker"); reject(base);
});

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


test("review deployment requires matching v2 binding and application, then opens only the pinned fourth listener", async (t) => {
  const rootDir = root();
  const vector = JSON.parse(readFileSync(new URL("./fixtures/synthetic-adoption-roebel-v1.json", import.meta.url), "utf8")) as {
    policy: SyntheticAdoptionEvidencePolicy; bundle: SyntheticAdoptionEvidenceBundle; verifiedAt: number; projection: Record<string, unknown>;
  };
  const old = binding(rootDir, { municipalityId: vector.policy.municipalityId });
  const { bindingChecksum: oldChecksum, ...oldBody } = old;
  const body = { ...oldBody, schemaVersion: "staging_case_control_deployment_binding_v2" as const,
    listeners: [...old.listeners, { id: "administration-review" as const, port: 18090 as const, bindScope: "pod_network" as const }] };
  const reviewed = { ...body, bindingChecksum: checksum(body) };
  const observed = observation(reviewed);
  const sources = { ...reviewedSources(reviewed), storageObserver: { observe: () => observed } };
  assert.notEqual(reviewed.bindingChecksum, oldChecksum);
  assert.throws(() => createOperationsBoundStagingCaseControlRuntime({ ...sources, application: { ...application(), municipalityId: vector.policy.municipalityId } }), /config_invalid/);
  assert.equal(readdirSync(rootDir).length, 0);
  const departmentIds = ["planning", "traffic", "environment", "finance", "legal", "public-order", "social-affairs", "public-works"];
  const registry: ActorRegistration[] = [
    { actorId: "example:steward", actorClass: "case_steward" },
    { actorId: "example:admin", actorClass: "administration" }, { actorId: "example:public", actorClass: "public" },
    ...departmentIds.flatMap((departmentId): ActorRegistration[] => [
      { actorId: `example:${departmentId}:agent`, actorClass: "department_agent", departmentId },
      { actorId: `example:${departmentId}:reviewer`, actorClass: "department_reviewer", departmentId },
    ]),
  ];
  const policy = vector.policy;
  // Seed a fresh bound synthetic fixture under the exact v2 proof, close it,
  // then test the real Operations runtime against that same durable owner.
  // Existing-store migration activation is a separate Operations transition.
  const proof = createStagingCaseControlDeploymentProof({ reviewedBinding: reviewed,
    expectedBindingChecksum: reviewed.bindingChecksum, storageObserver: { observe: () => observed } });
  const seed = createSqliteAtomicTopicCaseAdmission({ rootDir, municipalityId: policy.municipalityId, policyVersion: policy.policyVersion,
    actorRegistry: registry, allowedSignerPubkeys: [], allowedAgentPubkeys: policy.allowedAgentPubkeys,
    requiredDepartmentIds: departmentIds, syntheticDepartmentReview: true,
    syntheticAdoption: { policy, now: () => new Date(vector.verifiedAt * 1000), acceptance: { resolve: async () => vector.projection } },
    durableState: { mode: "durable_single_writer", sourceReleaseDigest: reviewed.releaseDigest },
    deploymentClaimToken: createCaseDurableDeploymentClaimToken(proof),
  });
  t.after(() => seed.close());
  const principal = { actorId: "example:steward", actorClass: "case_steward" as const };
  const admitted = await seed.admission.admitSyntheticAdoption!({ schemaVersion: "atomic_synthetic_adoption_admission_v1",
    municipalityId: policy.municipalityId, policyVersion: policy.policyVersion, actorBinding: principal,
    expectedCaseVersion: 0, bundle: vector.bundle });
  seed.sealAndClose();
  const grant = { token: randomBytes(32).toString("base64url"), caseId: admitted.caseId, actor: principal,
    notBefore: Date.now() - 1000, expiresAt: Date.now() + 120_000 };
  const reviewApplication: OperationsBoundStagingCaseControlApplicationConfig = {
    ...application(), municipalityId: policy.municipalityId, policyVersion: policy.policyVersion,
    actorRegistry: registry, allowedSignerPubkeys: [], allowedAgentPubkeys: policy.allowedAgentPubkeys,
    requiredDepartmentIds: departmentIds, syntheticAdoption: { policy, acceptanceBaseUrl: "https://ledger.example/acceptance" },
    credentials: [{ token: randomBytes(32).toString("base64url"), principal: { ...principal, municipalityIds: [policy.municipalityId] } }],
    administrationReview: { caseId: admitted.caseId, grants: [grant], allowedHosts: ["127.0.0.1"] },
  };
  const before = readFileSync(join(rootDir, CASE_SHUTDOWN_SEAL_FILENAME));
  assert.throws(() => createOperationsBoundStagingCaseControlRuntime({ ...reviewedSources(old),
    storageObserver: { observe: () => observation(old) }, application: reviewApplication }), /config_invalid/);
  assert.deepEqual(readFileSync(join(rootDir, CASE_SHUTDOWN_SEAL_FILENAME)), before);
  const runtime = createOperationsBoundStagingCaseControlRuntime({ ...sources, application: reviewApplication });
  t.after(() => runtime.close());
  await runtime.start();
  assert.deepEqual(runtime.health().ports, { probe: 18088, outbox: 18087, admission: 18085, "administration-review": 18090 });
  assert.equal((await request(18090, "/v1/staging/administration/review")).status, 401);
  await runtime.close();
});

const directoryBytes = (path: string) => Object.fromEntries(readdirSync(path).sort().map((name) =>
  [name, createHash("sha256").update(readFileSync(join(path, name))).digest("hex")]));

async function reviewMigration(t: TestContext) {
  const vector = JSON.parse(readFileSync(new URL("./fixtures/synthetic-adoption-roebel-v1.json", import.meta.url), "utf8")) as {
    policy: SyntheticAdoptionEvidencePolicy; bundle: SyntheticAdoptionEvidenceBundle; verifiedAt: number; projection: Record<string, unknown>;
  };
  const sourceRoot = root(), targetRoot = root();
  const sourceBinding = binding(sourceRoot, { municipalityId: vector.policy.municipalityId });
  const principal = { actorId: "example:steward", actorClass: "case_steward" as const };
  const sourceConfig: SyntheticReviewMigrationSourceConfig = {
    municipalityId: vector.policy.municipalityId, policyVersion: vector.policy.policyVersion,
    actorRegistry: [principal], allowedSignerPubkeys: [], allowedAgentPubkeys: vector.policy.allowedAgentPubkeys,
    syntheticAdoption: { policy: vector.policy, now: () => new Date(vector.verifiedAt * 1000), acceptance: { resolve: async () => vector.projection } },
  };
  const sourceProof = createStagingCaseControlDeploymentProof({ reviewedBinding: sourceBinding,
    expectedBindingChecksum: sourceBinding.bindingChecksum, storageObserver: { observe: () => observation(sourceBinding) } });
  const seed = createSqliteAtomicTopicCaseAdmission({ ...sourceConfig, rootDir: sourceRoot,
    durableState: { mode: "durable_single_writer", sourceReleaseDigest: sourceBinding.releaseDigest },
    deploymentClaimToken: createCaseDurableDeploymentClaimToken(sourceProof) });
  t.after(() => seed.close());
  const admitted = await seed.admission.admitSyntheticAdoption!({ schemaVersion: "atomic_synthetic_adoption_admission_v1",
    municipalityId: sourceConfig.municipalityId, policyVersion: sourceConfig.policyVersion, actorBinding: principal,
    expectedCaseVersion: 0, bundle: vector.bundle });
  const sourceSeal = seed.sealAndClose();
  const sourceBytes = directoryBytes(sourceRoot);
  const requiredDepartmentIds = ["planning", "traffic", "environment", "finance", "legal", "public-order", "social-affairs", "public-works"];
  const additionalActors: ActorRegistration[] = [
    { actorId: "example:admin", actorClass: "administration" }, { actorId: "example:public", actorClass: "public" },
    ...requiredDepartmentIds.flatMap((departmentId): ActorRegistration[] => [
      { actorId: `example:${departmentId}:agent`, actorClass: "department_agent", departmentId },
      { actorId: `example:${departmentId}:reviewer`, actorClass: "department_reviewer", departmentId },
    ]),
  ];
  const preparation = { sourceRootDir: sourceRoot, expectedSourceSealChecksum: sourceSeal.sealChecksum,
    expectedCaseId: admitted.caseId, expectedAdmissionReceiptChecksum: admitted.receiptChecksum,
    sourceConfig, requiredDepartmentIds, additionalActors };
  const candidate = prepareSyntheticDepartmentReviewMigration(preparation);
  t.after(() => rmSync(candidate.candidateRootDir, { recursive: true, force: true }));
  const targetV1 = binding(targetRoot, { municipalityId: vector.policy.municipalityId, releaseDigest: `sha256:${"e".repeat(64)}`,
    pvcName: "review-state", pvcUid: "23456789-2345-4234-9234-23456789abcd", pvName: "pvc-review-state" });
  const { bindingChecksum: oldChecksum, ...oldBody } = targetV1;
  const body = { ...oldBody, schemaVersion: "staging_case_control_deployment_binding_v2" as const,
    listeners: [...targetV1.listeners, { id: "administration-review" as const, port: 18090 as const, bindScope: "pod_network" as const }] };
  const targetBinding = { ...body, bindingChecksum: checksum(body) };
  assert.notEqual(targetBinding.bindingChecksum, oldChecksum);
  const targetProof = createStagingCaseControlDeploymentProof({ reviewedBinding: targetBinding,
    expectedBindingChecksum: targetBinding.bindingChecksum, storageObserver: { observe: () => observation(targetBinding) } });
  const claimBody = { schemaVersion: "case_durable_deployment_claim_v1", municipalityId: sourceConfig.municipalityId,
    releaseDigest: targetBinding.releaseDigest, controlDeploymentBindingChecksum: targetBinding.bindingChecksum,
    pvc: { namespace: targetBinding.storage.pvcNamespace, name: targetBinding.storage.pvcName, uid: targetBinding.storage.pvcUid }, pvName: targetBinding.storage.pvName };
  const now = { value: new Date(Date.now() + 1000).toISOString() };
  const planBody = { schemaVersion: "staging_synthetic_review_migration_plan_v1" as const, deploymentEnvironment: "staging" as const,
    municipalityId: sourceConfig.municipalityId, caseId: admitted.caseId,
    sourceDeploymentClaimChecksum: sourceSeal.deploymentClaimChecksum!, targetDeploymentClaimChecksum: checksum(claimBody),
    candidateChecksum: candidate.receipt.candidateChecksum, notBeforeUtc: now.value,
    expiresAtUtc: new Date(Date.parse(now.value) + 60_000).toISOString() };
  const plan = { value: { ...planBody, planChecksum: checksum(planBody) } as StagingSyntheticReviewMigrationPlanV1 };
  const pin = { value: plan.value.planChecksum };
  const migration = { reviewedMigrationSource: { read: () => plan.value }, migrationPinSource: { read: () => pin.value }, clock: { now: () => now.value } };
  const bound = { ...reviewedSources(targetBinding), storageObserver: { observe: () => observation(targetBinding) } };
  const adapterInput = () => ({ preparation, targetRootDir: targetRoot,
    targetDeploymentClaimToken: createCaseDurableDeploymentClaimToken(targetProof),
    authorization: createStagingSyntheticReviewMigrationAuthorization(migration) });
  const activate = () => activateOperationsBoundSyntheticReviewMigration({ ...bound, migration, preparation });
  const grants = [principal, ...additionalActors.filter((actor) => actor.actorClass === "department_agent" || actor.actorClass === "department_reviewer")]
    .map(({ actorId, actorClass }) => ({ token: randomBytes(32).toString("base64url"), caseId: admitted.caseId,
      actor: { actorId, actorClass }, notBefore: Date.now() - 1000, expiresAt: Date.now() + 120_000 }));
  const reviewApplication: OperationsBoundStagingCaseControlApplicationConfig = { ...application(),
    municipalityId: sourceConfig.municipalityId, policyVersion: sourceConfig.policyVersion,
    actorRegistry: [...sourceConfig.actorRegistry, ...additionalActors], allowedSignerPubkeys: [], allowedAgentPubkeys: sourceConfig.allowedAgentPubkeys,
    requiredDepartmentIds, syntheticAdoption: { policy: vector.policy, acceptanceBaseUrl: "https://ledger.example/acceptance" },
    credentials: [{ token: randomBytes(32).toString("base64url"), principal: { ...principal, municipalityIds: [sourceConfig.municipalityId] } }],
    administrationReview: { caseId: admitted.caseId, grants, allowedHosts: ["127.0.0.1"] } };
  const runtime = () => createOperationsBoundStagingCaseControlRuntime({ ...bound, application: reviewApplication });
  return { sourceRoot, targetRoot, sourceBytes, sourceSeal, sourceBinding, targetBinding, targetV1, admitted, preparation, candidate,
    adapterInput, activate, migration, plan, pin, now, runtime, grants };
}

test("reviewed migration activates the existing Case on a new deployment and serves it through the ordinary review runtime", async (t) => {
  const h = await reviewMigration(t);
  const receipt = h.activate();
  assert.equal(receipt.targetSeal.configFingerprint, h.candidate.receipt.targetConfigFingerprint);
  assert.equal(receipt.targetSeal.recoveryEvidence.orderedHeads[0]!.caseVersion, 3);
  assert.equal(receipt.targetSeal.recoveryEvidence.orderedBindingEvidence[0]!.receiptChecksum, h.admitted.receiptChecksum);
  assert.notEqual(receipt.sourceClaim.claimChecksum, receipt.targetClaim.claimChecksum);
  assert.deepEqual(directoryBytes(h.sourceRoot), h.sourceBytes);
  assert.deepEqual(h.activate(), receipt, "exact retry returns the persisted result");
  assert.equal(existsSync(join(h.targetRoot, SYNTHETIC_REVIEW_MIGRATION_INTENT_FILENAME)), false);
  const sealedTarget = directoryBytes(h.targetRoot);
  assert.throws(() => createSqliteAtomicTopicCaseAdmission({ ...h.preparation.sourceConfig, rootDir: h.targetRoot,
    durableState: { mode: "durable_single_writer", sourceReleaseDigest: h.targetBinding.releaseDigest },
    deploymentClaimToken: h.adapterInput().targetDeploymentClaimToken }), /config_mismatch/);
  assert.deepEqual(directoryBytes(h.targetRoot), sealedTarget);
  const call = (body?: unknown, actorId = "example:steward") => new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const request = httpRequest({ host: "127.0.0.1", port: 18090, path: "/v1/staging/administration/review", method: data ? "POST" : "GET",
      headers: { host: "127.0.0.1", authorization: `Bearer ${h.grants.find((grant) => grant.actor.actorId === actorId)!.token}`,
        ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } }, (response) => {
      let text = ""; response.on("data", (chunk) => { text += String(chunk); });
      response.on("end", () => resolve({ status: response.statusCode!, body: JSON.parse(text) }));
    });
    request.on("error", reject); request.end(data);
  });
  let runtime = h.runtime(); t.after(() => runtime.close());
  await runtime.start();
  assert.throws(() => h.activate(), /migration_activation_invalid/, "a running target retains its sole owner");
  const before = await call();
  assert.equal(before.status, 200);
  const view = before.body as { suggestion: { id: string }; caseVersion: number };
  assert.equal(view.caseVersion, 3);
  const command = { schemaVersion: "administration_review_request_v1", operation: "assign", expectedCaseVersion: 3, payload: { departmentPackage: { id: "package:planning", departmentId: "planning",
    suggestionId: view.suggestion.id, request: "Assess crossing options.", assignedAgentActorId: "example:planning:agent",
    assignedReviewerActorId: "example:planning:reviewer", authorityBinding: "none" } } };
  const assigned = await call(command);
  assert.equal(assigned.status, 200);
  const assignedView = (await call()).body as { departmentPackages: { packageChecksum: string }[] };
  const draft = { schemaVersion: "administration_review_request_v1", operation: "draft", expectedCaseVersion: 4,
    payload: { packageId: "package:planning", packageChecksum: assignedView.departmentPackages[0]!.packageChecksum,
      draft: { schemaVersion: "department_draft_v1", id: "draft:planning", publicSummary: "Compare crossing options.",
        publicCitations: ["synthetic://planning/evidence"], privateEvidenceRefs: ["synthetic://planning/private"], authorityBinding: "none" } } };
  assert.equal((await call(draft, "example:planning:agent")).status, 200);
  const drafted = (await call()).body as { departmentPackages: { draft: { artifactChecksum: string } }[] };
  const review = { schemaVersion: "administration_review_request_v1", operation: "review", expectedCaseVersion: 5,
    payload: { review: { packageId: "package:planning", draftArtifactChecksum: drafted.departmentPackages[0]!.draft.artifactChecksum,
      decision: "accepted", reviewedAt: new Date().toISOString() } } };
  const reviewed = await call(review, "example:planning:reviewer");
  assert.equal(reviewed.status, 200);
  await runtime.close(); runtime = h.runtime(); await runtime.start();
  assert.deepEqual(await call(command), assigned);
  assert.deepEqual(await call(review, "example:planning:reviewer"), reviewed);
  assert.equal((await call()).body.caseVersion, 6);
  await runtime.close();
  const after = directoryBytes(h.targetRoot);
  assert.throws(() => h.activate(), /migration_activation_invalid/, "retired activation never rewinds a progressed Case");
  assert.deepEqual(directoryBytes(h.targetRoot), after);
  assert.deepEqual(directoryBytes(h.sourceRoot), h.sourceBytes);
});

test("every durable migration interruption blocks ordinary startup and resumes only the same import", async (t) => {
  for (const point of ["intent", "database", "claim", "seal", "receipt"] as const) {
    const h = await reviewMigration(t);
    assert.throws(() => activateSyntheticDepartmentReviewMigration({ ...h.adapterInput(), failpoint: (at) => { if (at === point) throw new Error("interrupted"); } }), /migration_activation_invalid/);
    const interrupted = directoryBytes(h.targetRoot);
    assert.throws(() => h.runtime(), /migration_requires_activation/);
    assert.deepEqual(directoryBytes(h.targetRoot), interrupted);
    h.now.value = new Date(Date.parse(h.plan.value.notBeforeUtc) - 1).toISOString();
    assert.throws(() => h.activate(), /migration_activation_invalid/);
    assert.deepEqual(directoryBytes(h.targetRoot), interrupted);
    h.now.value = h.plan.value.notBeforeUtc;
    assert.equal(h.activate().targetSeal.recoveryEvidence.orderedHeads[0]!.caseVersion, 3);
    const runtime = h.runtime(); await runtime.close();
    assert.deepEqual(directoryBytes(h.sourceRoot), h.sourceBytes);
  }
});

test("migration rejects unreviewed pins, changed candidates, forged authority and occupied stores", async (t) => {
  const h = await reviewMigration(t);
  const originalPlan = h.plan.value;
  const changed = (patch: Partial<StagingSyntheticReviewMigrationPlanV1>) => {
    const { planChecksum: unused, ...body } = { ...originalPlan, ...patch }; void unused;
    h.plan.value = { ...body, planChecksum: checksum(body) }; h.pin.value = h.plan.value.planChecksum;
  };
  h.pin.value = `sha256:${"0".repeat(64)}`;
  assert.throws(() => h.activate(), /migration_activation_invalid/);
  h.pin.value = originalPlan.planChecksum;
  for (const patch of [
    { candidateChecksum: `sha256:${"0".repeat(64)}` }, { sourceDeploymentClaimChecksum: `sha256:${"0".repeat(64)}` },
    { targetDeploymentClaimChecksum: `sha256:${"0".repeat(64)}` }, { expiresAtUtc: originalPlan.notBeforeUtc },
  ]) { changed(patch); assert.throws(() => h.activate(), /migration_activation_invalid/); }
  h.plan.value = originalPlan; h.pin.value = originalPlan.planChecksum;
  const reusedVolume = binding(h.targetRoot, { municipalityId: h.sourceBinding.municipalityId, releaseDigest: `sha256:${"e".repeat(64)}` });
  const reusedProof = createStagingCaseControlDeploymentProof({ reviewedBinding: reusedVolume,
    expectedBindingChecksum: reusedVolume.bindingChecksum, storageObserver: { observe: () => observation(reusedVolume) } });
  changed({ targetDeploymentClaimChecksum: claimFor(reusedVolume).claimChecksum });
  assert.throws(() => activateSyntheticDepartmentReviewMigration({ ...h.adapterInput(), targetDeploymentClaimToken: createCaseDurableDeploymentClaimToken(reusedProof) }), /migration_activation_invalid/);
  h.plan.value = originalPlan; h.pin.value = originalPlan.planChecksum;
  assert.throws(() => activateSyntheticDepartmentReviewMigration({ ...h.adapterInput(), authorization: structuredClone(h.adapterInput().authorization) }), /migration_activation_invalid/);
  assert.throws(() => activateOperationsBoundSyntheticReviewMigration({ ...reviewedSources(h.targetV1), storageObserver: { observe: () => observation(h.targetV1) },
    preparation: h.preparation, migration: h.migration }), /config_invalid/);
  const seedCopy = readFileSync(join(h.sourceRoot, h.sourceSeal.databaseBasename));
  writeFileSync(join(h.targetRoot, h.sourceSeal.databaseBasename), seedCopy, { mode: 0o600 });
  const occupied = directoryBytes(h.targetRoot);
  assert.throws(() => h.activate(), /migration_activation_invalid/);
  assert.deepEqual(directoryBytes(h.targetRoot), occupied);
  assert.equal(existsSync(join(h.targetRoot, SYNTHETIC_REVIEW_MIGRATION_ACTIVATION_FILENAME)), false);
  assert.deepEqual(directoryBytes(h.sourceRoot), h.sourceBytes);
});

test("an interrupted migration never replaces a changed imported database or loses its linked receipt", async (t) => {
  const h = await reviewMigration(t);
  assert.throws(() => activateSyntheticDepartmentReviewMigration({ ...h.adapterInput(), failpoint: (at) => { if (at === "database") throw new Error("interrupted"); } }));
  const path = join(h.targetRoot, h.sourceSeal.databaseBasename);
  const original = readFileSync(path);
  writeFileSync(path, Buffer.concat([original, Buffer.from("drift")]), { mode: 0o600 });
  const drifted = directoryBytes(h.targetRoot);
  assert.throws(() => h.activate(), /migration_activation_invalid/);
  assert.deepEqual(directoryBytes(h.targetRoot), drifted);
  writeFileSync(path, original, { mode: 0o600 });
  assert.equal(h.activate().candidate.candidateChecksum, h.candidate.receipt.candidateChecksum);
  assert.deepEqual(directoryBytes(h.sourceRoot), h.sourceBytes);
});

test("process death releases migration owners and a new process can finish its durable import", async (t) => {
  const h = await reviewMigration(t);

  const child = spawnSync(process.execPath, [fileURLToPath(new URL("./fixtures/synthetic-review-migration-kill-worker.mjs", import.meta.url))], {
    input: JSON.stringify({ binding: h.targetBinding, observation: observation(h.targetBinding), preparation: h.preparation, plan: h.plan.value },
      (_key, value: unknown) => typeof value === "bigint" ? String(value) : value), encoding: "utf8", timeout: 10_000,
  });
  assert.equal(child.signal, "SIGKILL", child.stderr);
  assert.throws(() => h.runtime(), /migration_requires_activation/);
  assert.equal(h.activate().candidate.candidateChecksum, h.candidate.receipt.candidateChecksum);
  assert.deepEqual(directoryBytes(h.sourceRoot), h.sourceBytes);
});

test("changed Operations evidence during activation leaves an exact resumable intent", async (t) => {
  const h = await reviewMigration(t);
  assert.throws(() => activateSyntheticDepartmentReviewMigration({ ...h.adapterInput(), failpoint: (point) => {
    if (point === "claim") h.pin.value = `sha256:${"0".repeat(64)}`;
  } }), /migration_activation_invalid/);
  assert.equal(existsSync(join(h.targetRoot, CASE_SHUTDOWN_SEAL_FILENAME)), false);
  assert.throws(() => h.runtime(), /migration_requires_activation/);
  h.pin.value = h.plan.value.planChecksum;
  assert.equal(h.activate().targetSeal.recoveryEvidence.orderedHeads[0]!.caseVersion, 3);
  assert.deepEqual(directoryBytes(h.sourceRoot), h.sourceBytes);
});
