import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statfsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { types as utilTypes } from "node:util";

import { registerStagingCaseRuntimeDeploymentListenerCapability } from "./staging-case-runtime-listener-capability.ts";

/**
 * This module is the deployment-boundary seam for the private Case owner.
 * It deliberately has no Kubernetes client: Operations reviews and pins the
 * Kubernetes facts, while this module checks the corresponding local mount
 * before any durable adapter or non-loopback listener may be composed.
 */

export type StagingCaseControlListenerIdentity = Readonly<{
  id: "admission" | "private-outbox" | "probe";
  port: 18085 | 18087 | 18088;
  bindScope: "pod_network";
}>;

export type StagingCaseControlReviewedBindingV1 = Readonly<{
  schemaVersion: "staging_case_control_deployment_binding_v1";
  deploymentEnvironment: "staging";
  municipalityId: string;
  workloadName: string;
  workload: Readonly<{
    serviceAccountName: string;
    automountServiceAccountToken: false;
  }>;
  releaseDigest: string;
  operationsTopologyChecksum: string;
  deployment: Readonly<{
    replicas: 1;
    strategy: "Recreate";
    noOverlappingPods: true;
  }>;
  storage: Readonly<{
    rootDir: string;
    pvcNamespace: string;
    pvcName: string;
    pvcUid: string;
    pvName: string;
    storageClass: string;
    accessMode: "ReadWriteOncePod" | "ReadWriteOnce";
    volumeMode: "Filesystem";
    requestedBytes: string;
    uid: number;
    gid: number;
    mode: string;
    filesystemType: string;
    minAvailableBytes: string;
    marker: Readonly<{
      fileName: string;
      checksum: string;
      uid: number;
      gid: number;
      mode: string;
    }>;
  }>;
  listeners: readonly StagingCaseControlListenerIdentity[];
  bindingChecksum: string;
}>;

/** A local-only observation adapter; test fakes never need a filesystem. */
export type StagingCaseControlStorageObserver = Readonly<{
  observe(storage: Readonly<{ rootDir: string; markerFileName: string }>): StagingCaseControlStorageObservation;
}>;

export type StagingCaseControlStorageObservation = Readonly<{
  rootDir: string;
  rootKind: "directory" | "other";
  rootIsSymbolicLink: boolean;
  rootUid: number;
  rootGid: number;
  rootMode: number;
  filesystemType: bigint;
  availableBytes: bigint;
  markerPath: string;
  markerKind: "file" | "other";
  markerIsSymbolicLink: boolean;
  markerUid: number;
  markerGid: number;
  markerMode: number;
  markerText: string;
}>;

/**
 * A runtime-unforgeable capability. Its data is intentionally unavailable
 * until `assertStagingCaseControlDeploymentProof` checks module-private
 * provenance; an object merely shaped like this is not authorization.
 */
export type StagingCaseControlDeploymentProof = Readonly<{
  readonly schemaVersion: "staging_case_control_deployment_proof_v1";
}>;

/** Facts are released only by consuming a module-proven proof. */
export type StagingCaseControlDeploymentRuntimeFacts = Readonly<{
  readonly municipalityId: string;
  readonly releaseDigest: string;
  readonly bindingChecksum: string;
  readonly durableRootDir: string;
  readonly pvcNamespace: string;
  readonly pvcName: string;
  readonly pvcUid: string;
  readonly pvName: string;
  readonly listeners: readonly StagingCaseControlListenerIdentity[];
}>;

export type StagingCaseControlDeploymentPreflightInput = Readonly<{
  reviewedBinding: StagingCaseControlReviewedBindingV1;
  /** Independently pinned by the reviewed deployment configuration. */
  expectedBindingChecksum: string;
  storageObserver: StagingCaseControlStorageObserver;
}>;

/** Port intended for the protected reviewed-Operations record Adapter. */
export type StagingCaseControlReviewedBindingSource = Readonly<{ read(): unknown }>;
/** Port intended for the separately protected immutable deployment-pin Adapter. */
export type StagingCaseControlBindingPinSource = Readonly<{ read(): unknown }>;

export type StagingCaseControlDeploymentProofSourceInput = Readonly<{
  reviewedBindingSource: StagingCaseControlReviewedBindingSource;
  bindingPinSource: StagingCaseControlBindingPinSource;
  storageObserver: StagingCaseControlStorageObserver;
}>;

/** Opaque, per-listener capability accepted by the deployment lifecycle. */
export type StagingCaseControlListenerBindPlan = Readonly<{
  readonly schemaVersion: "staging_case_control_listener_bind_plan_v1";
}>;

/** The only resolved form: it comes from a module-proven bind plan. */
export type VerifiedStagingCaseControlPodNetworkBind = Readonly<{
  readonly id: "admission" | "private-outbox" | "probe";
  readonly host: "0.0.0.0";
  readonly port: 18085 | 18087 | 18088;
}>;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const MUNICIPALITY = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const KUBE_NAME = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u;
const KUBE_UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const MODE = /^0[0-7]{3}$/u;
const FS_MAGIC = /^0x[0-9a-f]{1,16}$/u;
const DECIMAL_BYTES = /^[1-9][0-9]{0,18}$/u;
const proofFacts = new WeakMap<object, StagingCaseControlDeploymentRuntimeFacts>();
const bindPlanFacts = new WeakMap<object, StagingCaseControlListenerIdentity>();

function fail(code: string): never { throw new Error(code); }

function exactRecord(value: unknown, fields: readonly string[], code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" || !fields.includes(key))) fail(code);
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail(code);
  }
  return value as Record<string, unknown>;
}

function exactArray(value: unknown, length: number, code: string): readonly unknown[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== length) fail(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || keys.some((key) => key !== "length" &&
    (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)))) fail(code);
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail(code);
  }
  return value;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype && !utilTypes.isProxy(value)) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0))) return JSON.stringify(value);
  fail("staging_case_control_preflight_value_invalid");
}

function checksum(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function string(value: unknown, expression: RegExp, maxBytes: number, code: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value ||
    Buffer.byteLength(value, "utf8") > maxBytes || !expression.test(value)) fail(code);
  return value;
}

function identifier(value: unknown, code: string): string {
  return string(value, KUBE_NAME, 253, code);
}

function unixId(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 2_147_483_647) fail(code);
  return value as number;
}

function mode(value: unknown, code: string): string {
  return string(value, MODE, 4, code);
}

function modeNumber(value: string): number { return Number.parseInt(value, 8); }

function absolutePath(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value ||
    Buffer.byteLength(value, "utf8") > 1024 || !value.startsWith("/") || value !== resolve(value) || value.includes("\0")) fail(code);
  return value;
}

function markerName(value: unknown, code: string): string {
  if (typeof value !== "string" || !/^\.?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value) || basename(value) !== value) fail(code);
  return value;
}

function bytes(value: unknown, code: string): string {
  return string(value, DECIMAL_BYTES, 19, code);
}

function fsMagic(value: unknown, code: string): string {
  return string(value, FS_MAGIC, 18, code);
}

function parseStorage(value: unknown): StagingCaseControlReviewedBindingV1["storage"] {
  const record = exactRecord(value, [
    "rootDir", "pvcNamespace", "pvcName", "pvcUid", "pvName", "storageClass", "accessMode", "volumeMode",
    "requestedBytes", "uid", "gid", "mode", "filesystemType", "minAvailableBytes", "marker",
  ], "staging_case_control_preflight_binding_invalid");
  const marker = exactRecord(record.marker, ["fileName", "checksum", "uid", "gid", "mode"], "staging_case_control_preflight_binding_invalid");
  if ((record.accessMode !== "ReadWriteOncePod" && record.accessMode !== "ReadWriteOnce") || record.volumeMode !== "Filesystem" ||
    typeof record.pvcUid !== "string" || !KUBE_UID.test(record.pvcUid) ||
    typeof marker.checksum !== "string" || !SHA256.test(marker.checksum)) fail("staging_case_control_preflight_binding_invalid");
  const parsed = Object.freeze({
    rootDir: absolutePath(record.rootDir, "staging_case_control_preflight_binding_invalid"),
    pvcNamespace: identifier(record.pvcNamespace, "staging_case_control_preflight_binding_invalid"),
    pvcName: identifier(record.pvcName, "staging_case_control_preflight_binding_invalid"),
    pvcUid: record.pvcUid,
    pvName: identifier(record.pvName, "staging_case_control_preflight_binding_invalid"),
    storageClass: identifier(record.storageClass, "staging_case_control_preflight_binding_invalid"),
    accessMode: record.accessMode as "ReadWriteOncePod" | "ReadWriteOnce",
    volumeMode: "Filesystem",
    requestedBytes: bytes(record.requestedBytes, "staging_case_control_preflight_binding_invalid"),
    uid: unixId(record.uid, "staging_case_control_preflight_binding_invalid"),
    gid: unixId(record.gid, "staging_case_control_preflight_binding_invalid"),
    mode: mode(record.mode, "staging_case_control_preflight_binding_invalid"),
    filesystemType: fsMagic(record.filesystemType, "staging_case_control_preflight_binding_invalid"),
    minAvailableBytes: bytes(record.minAvailableBytes, "staging_case_control_preflight_binding_invalid"),
    marker: Object.freeze({
      fileName: markerName(marker.fileName, "staging_case_control_preflight_binding_invalid"),
      checksum: marker.checksum,
      uid: unixId(marker.uid, "staging_case_control_preflight_binding_invalid"),
      gid: unixId(marker.gid, "staging_case_control_preflight_binding_invalid"),
      mode: mode(marker.mode, "staging_case_control_preflight_binding_invalid"),
    }),
  });
  if (BigInt(parsed.minAvailableBytes) > BigInt(parsed.requestedBytes)) {
    fail("staging_case_control_preflight_binding_invalid");
  }
  return parsed;
}

const EXPECTED_LISTENERS: readonly StagingCaseControlListenerIdentity[] = Object.freeze([
  Object.freeze({ id: "admission", port: 18085, bindScope: "pod_network" }),
  Object.freeze({ id: "private-outbox", port: 18087, bindScope: "pod_network" }),
  Object.freeze({ id: "probe", port: 18088, bindScope: "pod_network" }),
]);

function parseDeployment(value: unknown): StagingCaseControlReviewedBindingV1["deployment"] {
  const record = exactRecord(value, ["replicas", "strategy", "noOverlappingPods"], "staging_case_control_preflight_binding_invalid");
  if (record.replicas !== 1 || record.strategy !== "Recreate" || record.noOverlappingPods !== true) {
    fail("staging_case_control_preflight_binding_invalid");
  }
  return Object.freeze({ replicas: 1, strategy: "Recreate" as const, noOverlappingPods: true });
}

function parseWorkload(value: unknown): StagingCaseControlReviewedBindingV1["workload"] {
  const record = exactRecord(value, ["serviceAccountName", "automountServiceAccountToken"], "staging_case_control_preflight_binding_invalid");
  if (record.automountServiceAccountToken !== false) fail("staging_case_control_preflight_binding_invalid");
  return Object.freeze({
    serviceAccountName: identifier(record.serviceAccountName, "staging_case_control_preflight_binding_invalid"),
    automountServiceAccountToken: false,
  });
}

function parseListeners(value: unknown): readonly StagingCaseControlListenerIdentity[] {
  const raw = exactArray(value, EXPECTED_LISTENERS.length, "staging_case_control_preflight_binding_invalid");
  const listeners = raw.map((entry, index) => {
    const record = exactRecord(entry, ["id", "port", "bindScope"], "staging_case_control_preflight_binding_invalid");
    const expected = EXPECTED_LISTENERS[index]!;
    if (record.id !== expected.id || record.port !== expected.port || record.bindScope !== expected.bindScope) fail("staging_case_control_preflight_binding_invalid");
    return expected;
  });
  return Object.freeze(listeners);
}

function bindingBody(binding: Omit<StagingCaseControlReviewedBindingV1, "bindingChecksum">): Record<string, unknown> {
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

/** Validates the closed-world Operations fact record and its canonical digest. */
export function verifyStagingCaseControlReviewedBinding(value: unknown): StagingCaseControlReviewedBindingV1 {
  const record = exactRecord(value, [
    "schemaVersion", "deploymentEnvironment", "municipalityId", "releaseDigest", "operationsTopologyChecksum",
    "workloadName", "workload", "deployment", "storage", "listeners", "bindingChecksum",
  ], "staging_case_control_preflight_binding_invalid");
  if (record.schemaVersion !== "staging_case_control_deployment_binding_v1" || record.deploymentEnvironment !== "staging" ||
    typeof record.releaseDigest !== "string" || !SHA256.test(record.releaseDigest) ||
    typeof record.operationsTopologyChecksum !== "string" || !SHA256.test(record.operationsTopologyChecksum) ||
    typeof record.bindingChecksum !== "string" || !SHA256.test(record.bindingChecksum)) fail("staging_case_control_preflight_binding_invalid");
  const parsed = Object.freeze({
    schemaVersion: "staging_case_control_deployment_binding_v1" as const,
    deploymentEnvironment: "staging" as const,
    municipalityId: string(record.municipalityId, MUNICIPALITY, 63, "staging_case_control_preflight_binding_invalid"),
    workloadName: identifier(record.workloadName, "staging_case_control_preflight_binding_invalid"),
    workload: parseWorkload(record.workload),
    releaseDigest: record.releaseDigest,
    operationsTopologyChecksum: record.operationsTopologyChecksum,
    deployment: parseDeployment(record.deployment),
    storage: parseStorage(record.storage),
    listeners: parseListeners(record.listeners),
    bindingChecksum: record.bindingChecksum,
  });
  if (checksum(bindingBody(parsed)) !== parsed.bindingChecksum) fail("staging_case_control_preflight_binding_checksum_invalid");
  return parsed;
}

function markerBody(binding: StagingCaseControlReviewedBindingV1): Record<string, unknown> {
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

function captureObserver(value: unknown): StagingCaseControlStorageObserver {
  const record = exactRecord(value, ["observe"], "staging_case_control_preflight_observer_invalid");
  if (typeof record.observe !== "function" || utilTypes.isProxy(record.observe)) fail("staging_case_control_preflight_observer_invalid");
  return Object.freeze({ observe: record.observe as StagingCaseControlStorageObserver["observe"] });
}

function captureSource(value: unknown, code: string): Readonly<{ read(): unknown }> {
  const record = exactRecord(value, ["read"], code);
  if (typeof record.read !== "function" || utilTypes.isProxy(record.read)) fail(code);
  return Object.freeze({ read: record.read as () => unknown });
}

function captureObservation(value: unknown): StagingCaseControlStorageObservation {
  const record = exactRecord(value, [
    "rootDir", "rootKind", "rootIsSymbolicLink", "rootUid", "rootGid", "rootMode", "filesystemType", "availableBytes",
    "markerPath", "markerKind", "markerIsSymbolicLink", "markerUid", "markerGid", "markerMode", "markerText",
  ], "staging_case_control_preflight_observation_invalid");
  if (typeof record.rootDir !== "string" || typeof record.markerPath !== "string" ||
    (record.rootKind !== "directory" && record.rootKind !== "other") ||
    (record.markerKind !== "file" && record.markerKind !== "other") ||
    typeof record.rootIsSymbolicLink !== "boolean" || typeof record.markerIsSymbolicLink !== "boolean" ||
    !Number.isSafeInteger(record.rootUid) || !Number.isSafeInteger(record.rootGid) || !Number.isSafeInteger(record.rootMode) ||
    !Number.isSafeInteger(record.markerUid) || !Number.isSafeInteger(record.markerGid) || !Number.isSafeInteger(record.markerMode) ||
    typeof record.filesystemType !== "bigint" || typeof record.availableBytes !== "bigint" || typeof record.markerText !== "string") {
    fail("staging_case_control_preflight_observation_invalid");
  }
  return Object.freeze({
    rootDir: record.rootDir, rootKind: record.rootKind, rootIsSymbolicLink: record.rootIsSymbolicLink,
    rootUid: record.rootUid as number, rootGid: record.rootGid as number, rootMode: record.rootMode as number,
    filesystemType: record.filesystemType as bigint, availableBytes: record.availableBytes as bigint,
    markerPath: record.markerPath, markerKind: record.markerKind, markerIsSymbolicLink: record.markerIsSymbolicLink,
    markerUid: record.markerUid as number, markerGid: record.markerGid as number, markerMode: record.markerMode as number,
    markerText: record.markerText,
  });
}

function verifyObservation(binding: StagingCaseControlReviewedBindingV1, observed: StagingCaseControlStorageObservation): void {
  const expectedMarkerPath = join(binding.storage.rootDir, binding.storage.marker.fileName);
  if (observed.rootDir !== binding.storage.rootDir || observed.markerPath !== expectedMarkerPath ||
    observed.rootKind !== "directory" || observed.rootIsSymbolicLink || observed.markerKind !== "file" || observed.markerIsSymbolicLink ||
    observed.rootUid !== binding.storage.uid || observed.rootGid !== binding.storage.gid || observed.rootMode !== modeNumber(binding.storage.mode) ||
    observed.markerUid !== binding.storage.marker.uid || observed.markerGid !== binding.storage.marker.gid || observed.markerMode !== modeNumber(binding.storage.marker.mode) ||
    observed.filesystemType !== BigInt(binding.storage.filesystemType) || observed.availableBytes < BigInt(binding.storage.minAvailableBytes)) {
    fail("staging_case_control_preflight_observation_mismatch");
  }
  const expectedMarker = `${canonical(markerBody(binding))}\n`;
  if (observed.markerText !== expectedMarker ||
    `sha256:${createHash("sha256").update(observed.markerText, "utf8").digest("hex")}` !== binding.storage.marker.checksum) {
    fail("staging_case_control_preflight_marker_mismatch");
  }
}

/**
 * Checks all reviewed deployment facts before the caller receives a durable
 * root or pod-network listener capability. It performs no bind, DB access,
 * Kubernetes call, write, or civic action.
 */
/** @internal Raw verifier for tests and reviewed-source adapters only. CI restricts imports. */
export function createStagingCaseControlDeploymentProof(
  input: StagingCaseControlDeploymentPreflightInput,
): StagingCaseControlDeploymentProof {
  const record = exactRecord(input, ["reviewedBinding", "expectedBindingChecksum", "storageObserver"], "staging_case_control_preflight_input_invalid");
  const binding = verifyStagingCaseControlReviewedBinding(record.reviewedBinding);
  if (typeof record.expectedBindingChecksum !== "string" || !SHA256.test(record.expectedBindingChecksum) ||
    record.expectedBindingChecksum !== binding.bindingChecksum) {
    fail("staging_case_control_preflight_binding_pin_mismatch");
  }
  const observer = captureObserver(record.storageObserver);
  let raw: unknown;
  try {
    raw = observer.observe(Object.freeze({ rootDir: binding.storage.rootDir, markerFileName: binding.storage.marker.fileName }));
  } catch {
    fail("staging_case_control_preflight_observation_unavailable");
  }
  verifyObservation(binding, captureObservation(raw));
  const proof: StagingCaseControlDeploymentProof = Object.freeze({
    schemaVersion: "staging_case_control_deployment_proof_v1",
  });
  const facts: StagingCaseControlDeploymentRuntimeFacts = Object.freeze({
    municipalityId: binding.municipalityId,
    releaseDigest: binding.releaseDigest,
    bindingChecksum: binding.bindingChecksum,
    durableRootDir: binding.storage.rootDir,
    pvcNamespace: binding.storage.pvcNamespace,
    pvcName: binding.storage.pvcName,
    pvcUid: binding.storage.pvcUid,
    pvName: binding.storage.pvName,
    listeners: Object.freeze([...binding.listeners]),
  });
  proofFacts.set(proof, facts);
  return proof;
}

/** @internal Runtime provenance assertion. CI restricts imports. */
export function assertStagingCaseControlDeploymentProof(value: unknown): StagingCaseControlDeploymentProof {
  if (!value || typeof value !== "object" || !proofFacts.has(value)) fail("staging_case_control_preflight_proof_invalid");
  return value as StagingCaseControlDeploymentProof;
}

/**
 * @internal
 * The sole proof-consumption seam for control runtime composition. CI limits
 * imports to the three control/lifecycle modules named in the supported
 * Interface boundary, so no public runtime may consume storage facts.
 */
export function consumeStagingCaseControlDeploymentProofForRuntime(
  value: unknown,
): StagingCaseControlDeploymentRuntimeFacts {
  const proof = assertStagingCaseControlDeploymentProof(value);
  const facts = proofFacts.get(proof);
  if (!facts) fail("staging_case_control_preflight_proof_invalid");
  return facts;
}

/**
 * @internal
 * Reads distinct reviewed-binding and immutable-pin source ports exactly once,
 * then invokes the raw verifier. Their independent operational ownership is a
 * deployment-composition obligation, not something object identity can prove.
 * CI restricts creation to the control runtime; public code cannot supply a
 * durable deployment configuration.
 */
export function createStagingCaseControlDeploymentProofFromReviewedSources(
  input: StagingCaseControlDeploymentProofSourceInput,
): StagingCaseControlDeploymentProof {
  const record = exactRecord(input, ["reviewedBindingSource", "bindingPinSource", "storageObserver"], "staging_case_control_preflight_source_input_invalid");
  if (record.reviewedBindingSource === record.bindingPinSource) fail("staging_case_control_preflight_source_identity_invalid");
  const reviewedBindingSource = captureSource(record.reviewedBindingSource, "staging_case_control_preflight_binding_source_invalid");
  const bindingPinSource = captureSource(record.bindingPinSource, "staging_case_control_preflight_pin_source_invalid");
  let reviewedBinding: unknown;
  let expectedBindingChecksum: unknown;
  try { reviewedBinding = reviewedBindingSource.read(); } catch { fail("staging_case_control_preflight_binding_source_unavailable"); }
  try { expectedBindingChecksum = bindingPinSource.read(); } catch { fail("staging_case_control_preflight_pin_source_unavailable"); }
  return createStagingCaseControlDeploymentProof({
    reviewedBinding: reviewedBinding as StagingCaseControlReviewedBindingV1,
    expectedBindingChecksum: expectedBindingChecksum as string,
    storageObserver: record.storageObserver as StagingCaseControlStorageObserver,
  });
}

/**
 * Derives three independent listener capabilities from a verified proof. The
 * value intentionally has no host or port: code may only resolve it through
 * the assertion below, which checks module-private provenance first.
 */
/** @internal Derives opaque bind plans; CI restricts imports. */
export function createStagingCaseControlListenerBindPlans(
  value: unknown,
): readonly StagingCaseControlListenerBindPlan[] {
  const facts = consumeStagingCaseControlDeploymentProofForRuntime(value);
  const plans = facts.listeners.map((listener) => {
    const plan: StagingCaseControlListenerBindPlan = Object.freeze({ schemaVersion: "staging_case_control_listener_bind_plan_v1" });
    bindPlanFacts.set(plan, listener);
    registerStagingCaseRuntimeDeploymentListenerCapability(plan, {
      id: listener.id,
      host: "0.0.0.0",
      port: listener.port,
    });
    return plan;
  });
  return Object.freeze(plans);
}

/**
 * Resolves only a module-proven plan to the exact pod-network bind tuple.
 * Lifecycles must call this verifier rather than accepting a host/port from
 * deployment configuration; casts and clones never enter `bindPlanFacts`.
 */
/** @internal Resolves a module-proven plan; CI restricts imports. */
export function assertStagingCaseControlListenerBindPlan(
  value: unknown,
): VerifiedStagingCaseControlPodNetworkBind {
  if (!value || typeof value !== "object") fail("staging_case_control_preflight_bind_plan_invalid");
  const listener = bindPlanFacts.get(value);
  if (!listener) fail("staging_case_control_preflight_bind_plan_invalid");
  return Object.freeze({ id: listener.id, host: "0.0.0.0", port: listener.port });
}

/** Production local filesystem adapter. It holds no Kubernetes credential. */
export function createNodeStagingCaseControlStorageObserver(): StagingCaseControlStorageObserver {
  const observe = (target: Readonly<{ rootDir: string; markerFileName: string }>): StagingCaseControlStorageObservation => {
    const rootDir = target.rootDir;
    const markerPath = join(rootDir, target.markerFileName);
    const root = lstatSync(rootDir, { bigint: true });
    const marker = lstatSync(markerPath, { bigint: true });
    const canonicalRoot = realpathSync(rootDir);
    const canonicalMarker = realpathSync(markerPath);
    const fs = statfsSync(rootDir, { bigint: true });
    const markerBytes = readFileSync(markerPath);
    const markerText = new TextDecoder("utf-8", { fatal: true }).decode(markerBytes);
    return Object.freeze({
      rootDir: canonicalRoot,
      rootKind: root.isDirectory() ? "directory" : "other",
      rootIsSymbolicLink: root.isSymbolicLink(),
      rootUid: Number(root.uid), rootGid: Number(root.gid), rootMode: Number(root.mode & BigInt(0o7777)),
      filesystemType: fs.type, availableBytes: fs.bavail * fs.bsize,
      markerPath: canonicalMarker,
      markerKind: marker.isFile() ? "file" : "other",
      markerIsSymbolicLink: marker.isSymbolicLink(),
      markerUid: Number(marker.uid), markerGid: Number(marker.gid), markerMode: Number(marker.mode & BigInt(0o7777)),
      markerText,
    });
  };
  return Object.freeze({ observe });
}
