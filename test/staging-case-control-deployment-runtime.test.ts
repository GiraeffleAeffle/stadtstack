import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { join } from "node:path";
import test, { after } from "node:test";

import {
  createOperationsBoundStagingCaseControlRuntime,
  type OperationsBoundStagingCaseControlApplicationConfig,
} from "../src/staging-case-control-runtime.ts";
import type {
  StagingCaseControlReviewedBindingV1,
  StagingCaseControlStorageObservation,
} from "../src/staging-case-control-preflight.ts";

const MUNICIPALITY_ID = "roebel-mueritz";
const ROOTS = new Set<string>();

after(() => { for (const root of ROOTS) rmSync(root, { recursive: true, force: true }); });

function root(): string {
  const parent = process.env.STADTSTACK_TEST_DURABLE_PARENT ?? process.cwd();
  const value = mkdtempSync(join(parent, ".stadtstack-deployment-control-"));
  ROOTS.add(value);
  return value;
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

function binding(rootDir: string): StagingCaseControlReviewedBindingV1 {
  const unsigned = {
    schemaVersion: "staging_case_control_deployment_binding_v1" as const,
    deploymentEnvironment: "staging" as const,
    municipalityId: MUNICIPALITY_ID,
    workloadName: "roebel-case-steward-control",
    workload: {
      serviceAccountName: "roebel-case-steward-control",
      automountServiceAccountToken: false as const,
    },
    releaseDigest: `sha256:${"a".repeat(64)}`,
    operationsTopologyChecksum: `sha256:${"b".repeat(64)}`,
    deployment: { replicas: 1 as const, strategy: "Recreate" as const, noOverlappingPods: true as const },
    storage: {
      rootDir,
      pvcNamespace: "stadtstack-roebel-staging-lab",
      pvcName: "roebel-case-steward-control-state",
      pvcUid: "12345678-1234-4234-9234-123456789abc",
      pvName: "pvc-12345678-1234-4234-9234-123456789abc",
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
