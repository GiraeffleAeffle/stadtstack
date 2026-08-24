import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import { MUNICIPAL_CASE_ID_PREFIX } from "./case-id.ts";

import type { CaseStateRecoveryEvidenceV1 } from "./case-state-recovery-evidence.ts";
import { verifyCaseStateRecoveryEvidence } from "./case-state-recovery-evidence.ts";

const SCHEMA_VERSION = "sqlite_atomic_topic_case_admission_v1";
const MUNICIPALITY_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** The fixed, basename-only seal written by a clean durable-owner shutdown. */
export const CASE_SHUTDOWN_SEAL_FILENAME = "case-shutdown-seal-v2.json";

export type CaseShutdownSealV2 = Readonly<{
  schemaVersion: "case_shutdown_seal_v2";
  municipalityId: string;
  databaseSchemaVersion: typeof SCHEMA_VERSION;
  configFingerprint: string;
  sourceReleaseDigest: string;
  /** Null only for an intentionally unbound legacy durable root. */
  deploymentClaimChecksum: string | null;
  databaseBasename: string;
  databaseByteLength: number;
  databaseSha256: string;
  closedAtUtc: string;
  walCheckpoint: Readonly<{
    mode: "TRUNCATE";
    busy: number;
    log: number;
    checkpointed: number;
  }>;
  recoveryEvidence: CaseStateRecoveryEvidenceV1;
  sealChecksum: string;
}>;

function fail(code: string): never { throw new Error(code); }

function plain(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    !utilTypes.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function ownKeys(value: unknown, fields: readonly string[], code: string): Record<string, unknown> {
  if (!plain(value)) fail(code);
  const reflected = Reflect.ownKeys(value);
  if (reflected.some((key) => typeof key !== "string")) fail(code);
  const keys = (reflected as string[]).sort();
  const expected = [...fields].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) fail(code);
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail(code);
  }
  return value;
}

function canonicalize(value: unknown): unknown {
  if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") fail("atomic_canonical_invalid");
  if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) fail("atomic_canonical_invalid");
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!plain(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function canonicalJson(value: unknown): string { return JSON.stringify(canonicalize(value)); }
function checksum(value: unknown): string { return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`; }

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function requireUtcTimestamp(value: unknown, code: string): string {
  if (typeof value !== "string" || !UTC_TIMESTAMP.test(value)) fail(code);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail(code);
  return value;
}

/** Strict, canonical verifier for a durable owner shutdown receipt.  It is
 * intentionally a narrow public API: callers can validate archive material
 * without gaining any database-opening capability. */
export function verifyCaseShutdownSeal(value: unknown): CaseShutdownSealV2 {
  const parsed = ownKeys(value, [
    "closedAtUtc", "configFingerprint", "databaseBasename", "databaseByteLength", "databaseSchemaVersion", "deploymentClaimChecksum",
    "databaseSha256", "municipalityId", "recoveryEvidence", "schemaVersion", "sealChecksum", "sourceReleaseDigest", "walCheckpoint",
  ], "atomic_admission_seal_invalid");
  if (parsed.schemaVersion !== "case_shutdown_seal_v2" || typeof parsed.municipalityId !== "string" || !MUNICIPALITY_ID.test(parsed.municipalityId) ||
    parsed.databaseSchemaVersion !== SCHEMA_VERSION || typeof parsed.configFingerprint !== "string" || !SHA256.test(parsed.configFingerprint) ||
    typeof parsed.sourceReleaseDigest !== "string" || !SHA256.test(parsed.sourceReleaseDigest) ||
    (parsed.deploymentClaimChecksum !== null && (typeof parsed.deploymentClaimChecksum !== "string" || !SHA256.test(parsed.deploymentClaimChecksum))) ||
    parsed.databaseBasename !== `stadtstack-${parsed.municipalityId}-atomic-admission.sqlite` ||
    typeof parsed.databaseByteLength !== "number" || !Number.isSafeInteger(parsed.databaseByteLength) || parsed.databaseByteLength < 1 ||
    typeof parsed.databaseSha256 !== "string" || !SHA256.test(parsed.databaseSha256) ||
    typeof parsed.sealChecksum !== "string" || !SHA256.test(parsed.sealChecksum)) fail("atomic_admission_seal_invalid");
  const closedAtUtc = requireUtcTimestamp(parsed.closedAtUtc, "atomic_admission_seal_invalid");
  const walCheckpoint = ownKeys(parsed.walCheckpoint, ["busy", "checkpointed", "log", "mode"], "atomic_admission_seal_invalid");
  const checkpointBusy = walCheckpoint.busy;
  const checkpointLog = walCheckpoint.log;
  const checkpointed = walCheckpoint.checkpointed;
  if (walCheckpoint.mode !== "TRUNCATE" || typeof checkpointBusy !== "number" || typeof checkpointLog !== "number" ||
    typeof checkpointed !== "number" || !Number.isSafeInteger(checkpointBusy) || !Number.isSafeInteger(checkpointLog) ||
    !Number.isSafeInteger(checkpointed) || checkpointBusy !== 0 || checkpointLog < 0 || checkpointed < 0 ||
    checkpointLog !== checkpointed) {
    fail("atomic_admission_seal_invalid");
  }
  const recoveryEvidence = verifyCaseStateRecoveryEvidence(parsed.recoveryEvidence);
  const municipalityCasePrefix = `${MUNICIPAL_CASE_ID_PREFIX}${parsed.municipalityId}:`;
  if (recoveryEvidence.orderedHeads.some((head) => !head.caseId.startsWith(municipalityCasePrefix))) {
    fail("atomic_admission_seal_invalid");
  }
  const { sealChecksum, ...withoutChecksum } = parsed;
  if (checksum(withoutChecksum) !== sealChecksum) fail("atomic_admission_seal_invalid");
  return deepFreeze({
    schemaVersion: "case_shutdown_seal_v2" as const,
    municipalityId: parsed.municipalityId,
    databaseSchemaVersion: SCHEMA_VERSION,
    configFingerprint: parsed.configFingerprint,
    sourceReleaseDigest: parsed.sourceReleaseDigest,
    deploymentClaimChecksum: parsed.deploymentClaimChecksum as string | null,
    databaseBasename: parsed.databaseBasename,
    databaseByteLength: parsed.databaseByteLength,
    databaseSha256: parsed.databaseSha256,
    closedAtUtc,
    walCheckpoint: Object.freeze({
      mode: "TRUNCATE" as const,
      busy: checkpointBusy,
      log: checkpointLog,
      checkpointed,
    }),
    recoveryEvidence,
    sealChecksum,
  });
}
