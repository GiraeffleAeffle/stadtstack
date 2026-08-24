import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, statfsSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertStagingCaseControlDeploymentProof,
  assertStagingCaseControlListenerBindPlan,
  createStagingCaseControlDeploymentProof,
  createStagingCaseControlDeploymentProofFromReviewedSources,
  createStagingCaseControlListenerBindPlans,
  createNodeStagingCaseControlStorageObserver,
  consumeStagingCaseControlDeploymentProofForRuntime,
  verifyStagingCaseControlReviewedBinding,
  type StagingCaseControlReviewedBindingV1,
  type StagingCaseControlStorageObservation,
} from "../src/staging-case-control-preflight.ts";
import {
  captureStagingCaseRuntimeDeploymentListener,
  type StagingCaseRuntimeDeploymentListenerCapability,
} from "../src/staging-case-runtime-listener-capability.ts";
import { createStagingCaseRuntimeLifecycle } from "../src/staging-case-runtime-lifecycle.ts";

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

function bindingChecksumBody(binding: Omit<StagingCaseControlReviewedBindingV1, "bindingChecksum">): Record<string, unknown> {
  return {
    schemaVersion: binding.schemaVersion,
    deploymentEnvironment: binding.deploymentEnvironment,
    municipalityId: binding.municipalityId,
    workloadName: binding.workloadName,
    workload: binding.workload,
    releaseDigest: binding.releaseDigest,
    operationsTopologyChecksum: binding.operationsTopologyChecksum,
    deployment: binding.deployment,
    storage: binding.storage,
    listeners: binding.listeners,
  };
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

function binding(): StagingCaseControlReviewedBindingV1 {
  const unsigned = {
    schemaVersion: "staging_case_control_deployment_binding_v1" as const,
    deploymentEnvironment: "staging" as const,
    municipalityId: "roebel-mueritz",
    workloadName: "stadtstack-case-control",
    workload: {
      serviceAccountName: "stadtstack-case-control",
      automountServiceAccountToken: false as const,
    },
    releaseDigest: `sha256:${"a".repeat(64)}`,
    operationsTopologyChecksum: `sha256:${"b".repeat(64)}`,
    deployment: { replicas: 1 as const, strategy: "Recreate" as const, noOverlappingPods: true as const },
    storage: {
      rootDir: "/var/lib/stadtstack/case-store",
      pvcNamespace: "roebel-staging",
      pvcName: "stadtstack-case-store",
      pvcUid: "12345678-1234-4234-9234-123456789abc",
      pvName: "pvc-12345678-1234-4234-9234-123456789abc",
      storageClass: "hcloud-volumes",
      // Prefer RWOP. RWO is only accepted with these same replica/recreate/no-overlap facts.
      accessMode: "ReadWriteOncePod" as const,
      volumeMode: "Filesystem" as const,
      requestedBytes: "10737418240",
      uid: 10001,
      gid: 10001,
      mode: "0700",
      filesystemType: "0xef53",
      minAvailableBytes: "1073741824",
      marker: {
        fileName: ".stadtstack-control-storage-v1.json",
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
  return Object.freeze({ ...unsigned, bindingChecksum: checksum(bindingChecksumBody(unsigned)) }) as StagingCaseControlReviewedBindingV1;
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

function preflight(value = binding(), observed = observation(value), expectedBindingChecksum = value.bindingChecksum) {
  return createStagingCaseControlDeploymentProof({
    reviewedBinding: value,
    expectedBindingChecksum,
    storageObserver: Object.freeze({ observe: () => observed }),
  });
}

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function implementationFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return implementationFiles(path);
    return entry.isFile() && /\.(?:[cm]?js|ts)$/u.test(entry.name) ? [path] : [];
  });
}

function repositoryPath(path: string): string {
  return relative(repositoryRoot, path).replaceAll("\\", "/");
}

function publishedCaseRuntimeImplementationPaths(): readonly string[] {
  const contract = JSON.parse(readFileSync(
    join(repositoryRoot, "containers/case-runtime/publisher-contract.json"),
    "utf8",
  )) as Readonly<{
    componentSourceClosures: Readonly<Record<string, string | null>>;
    componentBuildContexts: Readonly<Record<string, readonly string[]>>;
  }>;
  const paths = new Set<string>();
  for (const closurePath of Object.values(contract.componentSourceClosures)) {
    if (closurePath === null) continue;
    for (const path of readFileSync(join(repositoryRoot, closurePath), "utf8").trim().split("\n")) {
      paths.add(path);
    }
  }
  for (const context of Object.values(contract.componentBuildContexts)) {
    for (const path of context) if (/\.(?:[cm]?js|ts)$/u.test(path)) paths.add(path);
  }
  return Object.freeze([...paths].sort());
}

test("the supported Interface boundary restricts internal proof imports to control composition", () => {
  const boundaries = new Map<string, Readonly<{ definition: string; consumers: ReadonlySet<string> }>>([
    ["consumeStagingCaseControlDeploymentProofForRuntime", { definition: "src/staging-case-control-preflight.ts", consumers: new Set(["src/staging-case-control-runtime.ts", "src/case-durable-deployment-claim.ts"]) }],
    ["createStagingCaseControlDeploymentProofFromReviewedSources", { definition: "src/staging-case-control-preflight.ts", consumers: new Set(["src/staging-case-control-runtime.ts"]) }],
    ["createStagingCaseControlListenerBindPlans", { definition: "src/staging-case-control-preflight.ts", consumers: new Set(["src/staging-case-control-runtime.ts"]) }],
    ["assertStagingCaseControlListenerBindPlan", { definition: "src/staging-case-control-preflight.ts", consumers: new Set([
      "src/staging-case-control-runtime.ts", "src/staging-case-process-lifecycle.ts",
    ]) }],
    ["registerStagingCaseRuntimeDeploymentListenerCapability", { definition: "src/staging-case-runtime-listener-capability.ts", consumers: new Set([
      "src/staging-case-control-preflight.ts",
    ]) }],
    ["createCaseDurableDeploymentClaimToken", { definition: "src/case-durable-deployment-claim.ts", consumers: new Set(["src/staging-case-control-runtime.ts"]) }],
    ["consumeCaseDurableDeploymentClaimToken", { definition: "src/case-durable-deployment-claim.ts", consumers: new Set(["src/adapters/sqlite-atomic-topic-case-admission.ts", "src/staging-case-recovery-activation-authority.ts"]) }],
    ["readCanonicalCaseDurableDeploymentClaim", { definition: "src/case-durable-deployment-claim.ts", consumers: new Set(["src/adapters/sqlite-atomic-topic-case-admission.ts"]) }],
    ["writeCanonicalCaseDurableDeploymentClaim", { definition: "src/case-durable-deployment-claim.ts", consumers: new Set(["src/adapters/sqlite-atomic-topic-case-admission.ts"]) }],
    ["replaceCanonicalCaseDurableDeploymentClaim", { definition: "src/case-durable-deployment-claim.ts", consumers: new Set(["src/adapters/sqlite-atomic-topic-case-admission.ts"]) }],
    ["createStagingCaseRecoveryActivationAuthorization", { definition: "src/staging-case-recovery-activation-authority.ts", consumers: new Set(["src/staging-case-control-runtime.ts"]) }],
    ["consumeStagingCaseRecoveryActivationAuthorization", { definition: "src/staging-case-recovery-activation-authority.ts", consumers: new Set(["src/adapters/sqlite-atomic-topic-case-admission.ts"]) }],
    ["consumeStagingCaseRecoveryActivationLease", { definition: "src/staging-case-recovery-activation-authority.ts", consumers: new Set(["src/adapters/sqlite-atomic-topic-case-admission.ts"]) }],
    ["assertStagingCaseRecoveryActivationAuthorizationFresh", { definition: "src/staging-case-recovery-activation-authority.ts", consumers: new Set(["src/staging-case-control-runtime.ts"]) }],
    ["createStagingCaseRecoveryGateFromReviewedSources", { definition: "src/staging-case-recovery-attestation.ts", consumers: new Set(["src/staging-case-recovery-activation-authority.ts"]) }],
    ["consumeStagingCaseRecoveryGateForRuntime", { definition: "src/staging-case-recovery-attestation.ts", consumers: new Set(["src/staging-case-recovery-activation-authority.ts"]) }],
  ]);
  const guardedFiles = [
    ...implementationFiles(join(repositoryRoot, "src")),
    ...implementationFiles(join(repositoryRoot, "containers/case-runtime")),
  ].map(repositoryPath).sort();
  const guardedPaths = new Set(guardedFiles);
  for (const path of publishedCaseRuntimeImplementationPaths()) {
    assert.equal(guardedPaths.has(path), true, `${path} must be covered by the Interface guard`);
  }

  const assertSource = (path: string, source: string): void => {
    for (const [symbol, boundary] of boundaries) {
      if (path !== boundary.definition && source.includes(symbol)) {
        assert.equal(boundary.consumers.has(path), true, `${path} must not import ${symbol}`);
      }
    }
  };
  for (const path of guardedFiles) {
    const absolutePath = join(repositoryRoot, path);
    assertSource(path, readFileSync(absolutePath, "utf8"));
  }
  assert.throws(
    () => assertSource(
      "src/forged/staging-case-control-preflight.ts",
      "registerStagingCaseRuntimeDeploymentListenerCapability();",
    ),
    /must not import registerStagingCaseRuntimeDeploymentListenerCapability/u,
  );
  assert.throws(
    () => assertSource(
      "containers/case-runtime/runtime-entrypoint-common.mjs",
      "registerStagingCaseRuntimeDeploymentListenerCapability();",
    ),
    /must not import registerStagingCaseRuntimeDeploymentListenerCapability/u,
  );
});

test("a canonical reviewed binding plus exact local observation yields an opaque pod-network proof", () => {
  const value = binding();
  const proof = preflight(value);
  const resolved = consumeStagingCaseControlDeploymentProofForRuntime(proof);

  assert.deepEqual(Reflect.ownKeys(proof), ["schemaVersion"]);
  assert.equal(proof.schemaVersion, "staging_case_control_deployment_proof_v1");
  assert.equal(resolved.durableRootDir, value.storage.rootDir);
  assert.equal(resolved.municipalityId, "roebel-mueritz");
  assert.equal(resolved.releaseDigest, value.releaseDigest);
  assert.equal(resolved.pvcNamespace, value.storage.pvcNamespace);
  assert.equal(resolved.pvcName, value.storage.pvcName);
  assert.equal(resolved.pvcUid, value.storage.pvcUid);
  assert.equal(resolved.pvName, value.storage.pvName);
  assert.deepEqual(resolved.listeners, [
    { id: "admission", port: 18085, bindScope: "pod_network" },
    { id: "private-outbox", port: 18087, bindScope: "pod_network" },
    { id: "probe", port: 18088, bindScope: "pod_network" },
  ]);
  assert.equal(Object.isFrozen(proof), true);
  assert.equal(Object.isFrozen(resolved.listeners), true);
  assert.equal(resolved.bindingChecksum, value.bindingChecksum);

  const plans = createStagingCaseControlListenerBindPlans(proof);
  assert.equal(Object.isFrozen(plans), true);
  assert.deepEqual(plans.map(assertStagingCaseControlListenerBindPlan), [
    { id: "admission", host: "0.0.0.0", port: 18085 },
    { id: "private-outbox", host: "0.0.0.0", port: 18087 },
    { id: "probe", host: "0.0.0.0", port: 18088 },
  ]);
  assert.deepEqual(plans.map(captureStagingCaseRuntimeDeploymentListener), [
    { host: "0.0.0.0", port: 18_085 },
    { host: "0.0.0.0", port: 18_087 },
    { host: "0.0.0.0", port: 18_088 },
  ]);
  assert.equal(captureStagingCaseRuntimeDeploymentListener(structuredClone(plans[0]!)), undefined);
  assert.throws(() => assertStagingCaseControlListenerBindPlan(structuredClone(plans[0]!)), /staging_case_control_preflight_bind_plan_invalid/u);
});

test("only an exact proof-derived bind plan crosses the runtime listener seam", async () => {
  const proof = preflight();
  const plan = createStagingCaseControlListenerBindPlans(proof)[0]!;
  const lifecycle = createStagingCaseRuntimeLifecycle({
    server: createServer(),
    // The runtime brand is intentionally module-private and represented only
    // by the WeakMap registration performed during preflight. Cross that
    // compile-time seam explicitly; the executable assertion below proves a
    // structural clone or forged object still cannot cross it.
    listener: plan as unknown as StagingCaseRuntimeDeploymentListenerCapability,
    release: () => undefined,
    drainTimeoutMs: 100,
  });
  await lifecycle.close();

  for (const listener of [
    { id: "admission", host: "0.0.0.0", port: 18_085 },
    { host: "0.0.0.0", port: 18_085 },
    structuredClone(plan),
  ]) {
    assert.throws(() => createStagingCaseRuntimeLifecycle({
      server: createServer(),
      listener: listener as never,
      release: () => undefined,
      drainTimeoutMs: 100,
    }), /staging_case_runtime_config_invalid/u);
  }
});

test("reviewed binding rejects checksum drift, unknown structure, accessors, proxies, and changed listener identity", () => {
  const value = binding();
  assert.deepEqual(verifyStagingCaseControlReviewedBinding(value), value);

  assert.throws(() => verifyStagingCaseControlReviewedBinding({ ...value, bindingChecksum: `sha256:${"0".repeat(64)}` }), /staging_case_control_preflight_binding_checksum_invalid/u);
  assert.throws(() => verifyStagingCaseControlReviewedBinding({ ...value, unexpected: true }), /staging_case_control_preflight_binding_invalid/u);
  assert.throws(() => verifyStagingCaseControlReviewedBinding({ ...value, listeners: [
    { id: "admission", port: 18086, bindScope: "pod_network" },
    ...value.listeners.slice(1),
  ] }), /staging_case_control_preflight_binding_invalid/u);

  const accessor = { ...value } as Record<string, unknown>;
  Object.defineProperty(accessor, "municipalityId", { enumerable: true, get() { throw new Error("must_not_run"); } });
  assert.throws(() => verifyStagingCaseControlReviewedBinding(accessor), /staging_case_control_preflight_binding_invalid/u);
  assert.throws(() => verifyStagingCaseControlReviewedBinding(new Proxy(value, {})), /staging_case_control_preflight_binding_invalid/u);
});

test("preflight requires an independently pinned binding checksum and single-writer deployment facts", () => {
  const value = binding();
  assert.doesNotThrow(() => preflight(value));
  assert.throws(() => preflight(value, observation(value), `sha256:${"0".repeat(64)}`), /staging_case_control_preflight_binding_pin_mismatch/u);
  assert.throws(() => verifyStagingCaseControlReviewedBinding({
    ...value,
    deployment: { ...value.deployment, replicas: 2 },
  }), /staging_case_control_preflight_binding_invalid/u);
  assert.throws(() => verifyStagingCaseControlReviewedBinding({
    ...value,
    storage: { ...value.storage, requestedBytes: "1073741823" },
  }), /staging_case_control_preflight_binding_invalid/u);
  assert.throws(() => verifyStagingCaseControlReviewedBinding({
    ...value,
    deployment: { ...value.deployment, strategy: "RollingUpdate" },
  }), /staging_case_control_preflight_binding_invalid/u);
  assert.throws(() => verifyStagingCaseControlReviewedBinding({
    ...value,
    deployment: { ...value.deployment, noOverlappingPods: false },
  }), /staging_case_control_preflight_binding_invalid/u);
  assert.throws(() => verifyStagingCaseControlReviewedBinding({
    ...value,
    workload: { ...value.workload, automountServiceAccountToken: true },
  }), /staging_case_control_preflight_binding_invalid/u);

  const rwo = structuredClone(value) as unknown as Record<string, unknown>;
  (rwo.storage as Record<string, unknown>).accessMode = "ReadWriteOnce";
  rwo.bindingChecksum = checksum({
    schemaVersion: rwo.schemaVersion, deploymentEnvironment: rwo.deploymentEnvironment, municipalityId: rwo.municipalityId,
    workloadName: rwo.workloadName, workload: rwo.workload, releaseDigest: rwo.releaseDigest,
    operationsTopologyChecksum: rwo.operationsTopologyChecksum, deployment: rwo.deployment, storage: rwo.storage, listeners: rwo.listeners,
  });
  assert.doesNotThrow(() => verifyStagingCaseControlReviewedBinding(rwo));
});

test("reviewed binding and independent pin sources are distinct, read once, and reject a modified rechecksummed binding", () => {
  const value = binding();
  let bindingReads = 0;
  let pinReads = 0;
  const proof = createStagingCaseControlDeploymentProofFromReviewedSources({
    reviewedBindingSource: Object.freeze({ read: () => { bindingReads += 1; return value; } }),
    bindingPinSource: Object.freeze({ read: () => { pinReads += 1; return value.bindingChecksum; } }),
    storageObserver: Object.freeze({ observe: () => observation(value) }),
  });
  assert.equal(bindingReads, 1);
  assert.equal(pinReads, 1);
  assert.equal(consumeStagingCaseControlDeploymentProofForRuntime(proof).bindingChecksum, value.bindingChecksum);

  const modified = structuredClone(value) as unknown as Record<string, unknown>;
  modified.workloadName = "other-control";
  modified.bindingChecksum = checksum(bindingChecksumBody(modified as unknown as Omit<StagingCaseControlReviewedBindingV1, "bindingChecksum">));
  assert.throws(() => createStagingCaseControlDeploymentProofFromReviewedSources({
    reviewedBindingSource: Object.freeze({ read: () => modified }),
    bindingPinSource: Object.freeze({ read: () => value.bindingChecksum }),
    storageObserver: Object.freeze({ observe: () => observation(modified as unknown as StagingCaseControlReviewedBindingV1) }),
  }), /staging_case_control_preflight_binding_pin_mismatch/u);

  const same = Object.freeze({ read: () => value });
  assert.throws(() => createStagingCaseControlDeploymentProofFromReviewedSources({
    reviewedBindingSource: same,
    bindingPinSource: same,
    storageObserver: Object.freeze({ observe: () => observation(value) }),
  }), /staging_case_control_preflight_source_identity_invalid/u);
  assert.throws(() => createStagingCaseControlDeploymentProofFromReviewedSources({
    reviewedBindingSource: Object.freeze({ read: () => { throw new Error("offline"); } }),
    bindingPinSource: Object.freeze({ read: () => value.bindingChecksum }),
    storageObserver: Object.freeze({ observe: () => observation(value) }),
  }), /staging_case_control_preflight_binding_source_unavailable/u);
  assert.throws(() => createStagingCaseControlDeploymentProofFromReviewedSources({
    reviewedBindingSource: Object.freeze({ read: () => value }),
    bindingPinSource: Object.freeze({ read: () => { throw new Error("offline"); } }),
    storageObserver: Object.freeze({ observe: () => observation(value) }),
  }), /staging_case_control_preflight_pin_source_unavailable/u);
});

test("the tokenless Node observer verifies a real private mount and fails closed on marker symlink or malformed UTF-8", () => {
  const root = mkdtempSync(join(tmpdir(), "stadtstack-control-preflight-"));
  try {
    chmodSync(root, 0o700);
    const canonicalRoot = realpathSync(root);
    const rootStat = statSync(canonicalRoot);
    const filesystem = statfsSync(canonicalRoot, { bigint: true });
    const value = structuredClone(binding()) as unknown as Record<string, unknown>;
    const storage = value.storage as Record<string, unknown>;
    const marker = storage.marker as Record<string, unknown>;
    storage.rootDir = canonicalRoot;
    storage.uid = rootStat.uid;
    storage.gid = rootStat.gid;
    storage.mode = "0700";
    storage.filesystemType = `0x${filesystem.type.toString(16)}`;
    storage.requestedBytes = "1024";
    storage.minAvailableBytes = "1";
    marker.uid = rootStat.uid;
    marker.gid = rootStat.gid;
    marker.mode = "0600";
    const typed = value as unknown as StagingCaseControlReviewedBindingV1;
    const markerText = `${canonical(markerBody(typed))}\n`;
    marker.checksum = `sha256:${createHash("sha256").update(markerText, "utf8").digest("hex")}`;
    value.bindingChecksum = checksum(bindingChecksumBody(value as unknown as Omit<StagingCaseControlReviewedBindingV1, "bindingChecksum">));
    const markerPath = join(canonicalRoot, typed.storage.marker.fileName);
    writeFileSync(markerPath, markerText, { mode: 0o600 });
    chmodSync(markerPath, 0o600);
    const observer = createNodeStagingCaseControlStorageObserver();
    assert.doesNotThrow(() => createStagingCaseControlDeploymentProof({
      reviewedBinding: value as unknown as StagingCaseControlReviewedBindingV1,
      expectedBindingChecksum: value.bindingChecksum as string,
      storageObserver: observer,
    }));

    const target = join(canonicalRoot, "marker-target.json");
    writeFileSync(target, markerText, { mode: 0o600 });
    chmodSync(target, 0o600);
    unlinkSync(markerPath);
    symlinkSync(target, markerPath);
    assert.throws(() => createStagingCaseControlDeploymentProof({
      reviewedBinding: value as unknown as StagingCaseControlReviewedBindingV1,
      expectedBindingChecksum: value.bindingChecksum as string,
      storageObserver: observer,
    }), /staging_case_control_preflight_observation_mismatch/u);

    unlinkSync(markerPath);
    writeFileSync(markerPath, Buffer.from([0xff]));
    chmodSync(markerPath, 0o600);
    assert.throws(() => createStagingCaseControlDeploymentProof({
      reviewedBinding: value as unknown as StagingCaseControlReviewedBindingV1,
      expectedBindingChecksum: value.bindingChecksum as string,
      storageObserver: observer,
    }), /staging_case_control_preflight_observation_unavailable/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("preflight fails closed on every observed mount, filesystem, ownership, marker, and capacity mismatch", () => {
  const value = binding();
  const exact = observation(value);
  assert.doesNotThrow(() => preflight(value, exact));

  for (const wrong of [
    { ...exact, rootDir: "/other" },
    { ...exact, rootKind: "other" as const },
    { ...exact, rootIsSymbolicLink: true },
    { ...exact, rootUid: exact.rootUid + 1 },
    { ...exact, rootGid: exact.rootGid + 1 },
    { ...exact, rootMode: 0o755 },
    { ...exact, filesystemType: 0x0102n },
    { ...exact, markerPath: "/other/.marker" },
    { ...exact, markerKind: "other" as const },
    { ...exact, markerIsSymbolicLink: true },
    { ...exact, markerUid: exact.markerUid + 1 },
    { ...exact, markerGid: exact.markerGid + 1 },
    { ...exact, markerMode: 0o644 },
  ]) {
    assert.throws(() => preflight(value, wrong), /staging_case_control_preflight_observation_mismatch/u);
  }
  assert.throws(() => preflight(value, { ...exact, markerText: "{}\n" }), /staging_case_control_preflight_marker_mismatch/u);
  assert.throws(() => preflight(value, observation(value, BigInt(value.storage.minAvailableBytes) - 1n)), /staging_case_control_preflight_observation_mismatch/u);
  assert.throws(() => preflight(value, { ...exact, availableBytes: 1 } as unknown as StagingCaseControlStorageObservation), /staging_case_control_preflight_observation_invalid/u);
  assert.throws(() => preflight(value, { ...exact, extra: true } as unknown as StagingCaseControlStorageObservation), /staging_case_control_preflight_observation_invalid/u);
});

test("the proof cannot be supplied by a type assertion or structured clone", () => {
  const proof = preflight();
  const forged = {
    schemaVersion: proof.schemaVersion,
  };
  assert.throws(() => assertStagingCaseControlDeploymentProof(forged), /staging_case_control_preflight_proof_invalid/u);
  assert.throws(() => assertStagingCaseControlDeploymentProof(structuredClone(proof)), /staging_case_control_preflight_proof_invalid/u);
  assert.throws(() => consumeStagingCaseControlDeploymentProofForRuntime(forged), /staging_case_control_preflight_proof_invalid/u);
  assert.throws(() => consumeStagingCaseControlDeploymentProofForRuntime(structuredClone(proof)), /staging_case_control_preflight_proof_invalid/u);
  assert.throws(() => createStagingCaseControlListenerBindPlans(forged), /staging_case_control_preflight_proof_invalid/u);
  assert.throws(() => createStagingCaseControlListenerBindPlans(structuredClone(proof)), /staging_case_control_preflight_proof_invalid/u);
});

test("observation adapter failures, proxies, accessors, and surplus fields fail before any capability is returned", () => {
  const value = binding();
  assert.throws(() => createStagingCaseControlDeploymentProof({
    reviewedBinding: value,
    expectedBindingChecksum: value.bindingChecksum,
    storageObserver: Object.freeze({ observe: () => { throw new Error("unavailable"); } }),
  }), /staging_case_control_preflight_observation_unavailable/u);

  const observed = observation(value);
  const accessor = { ...observed } as Record<string, unknown>;
  Object.defineProperty(accessor, "rootDir", { enumerable: true, get() { throw new Error("must_not_run"); } });
  assert.throws(() => preflight(value, accessor as unknown as StagingCaseControlStorageObservation), /staging_case_control_preflight_observation_invalid/u);
  assert.throws(() => preflight(value, new Proxy(observed, {})), /staging_case_control_preflight_observation_invalid/u);
  assert.throws(() => preflight(value, { ...observed, extra: true } as unknown as StagingCaseControlStorageObservation), /staging_case_control_preflight_observation_invalid/u);
});
