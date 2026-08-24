import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { types as utilTypes } from "node:util";

import {
  CASE_STATE_RECOVERY_MAX_CASES,
  createCaseStateRecoveryEvidence,
  verifyCaseStateRecoveryEvidence,
  type CaseStateRecoveryEvidenceV1,
} from "../case-state-recovery-evidence.ts";

import {
  createPublicCaseBindingReceipt,
  verifyPublicCaseBindingReceipt,
  type PublicCaseBindingReceiptV1,
} from "../case-binding-projection.ts";
import type {
  SynchronousCredentialFreeCaseBindingOutboxReader,
} from "../case-binding-outbox.ts";
export type {
  CaseBindingOutboxEntryV1,
  CredentialFreeCaseBindingOutboxReader,
  SynchronousCredentialFreeCaseBindingOutboxReader,
} from "../case-binding-outbox.ts";
import {
  createCivicCaseCoordinator,
  type ActorBinding,
  type ActorRegistration,
  type CivicCaseCoordinator,
  type CommandReceipt,
  type CoordinatorJournalAppend,
  type CoordinatorJournalEvent,
  type CoordinatorJournalIdempotency,
  type CoordinatorJournalPort,
  type CoordinatorJournalRecovery,
} from "../civic-case-coordinator.ts";
import {
  verifyTopicCaseAdmission,
  type VerifiedTopicCaseAdmissionV1,
} from "../topic-case-admission.ts";
import type { AtomicCaseAdmissionPort, AtomicTopicCaseAdmissionV1 } from "../roebel-control-service.ts";
import {
  CASE_SHUTDOWN_SEAL_FILENAME,
  verifyCaseShutdownSeal,
} from "../case-shutdown-seal.ts";
import type { CaseShutdownSealV2 } from "../case-shutdown-seal.ts";
export { CASE_SHUTDOWN_SEAL_FILENAME, verifyCaseShutdownSeal } from "../case-shutdown-seal.ts";
export type { CaseShutdownSealV2 } from "../case-shutdown-seal.ts";
import {
  consumeCaseDurableDeploymentClaimToken,
  readCanonicalCaseDurableDeploymentClaim,
  replaceCanonicalCaseDurableDeploymentClaim,
  sameCaseDurableDeploymentClaim,
  verifyCaseDurableDeploymentClaim,
  writeCanonicalCaseDurableDeploymentClaim,
  type CaseDurableDeploymentClaim,
  type CaseDurableDeploymentClaimToken,
} from "../case-durable-deployment-claim.ts";
import {
  consumeStagingCaseRecoveryActivationAuthorization,
  consumeStagingCaseRecoveryActivationLease,
  type StagingCaseRecoveryActivationAuthorization,
} from "../staging-case-recovery-activation-authority.ts";
import {
  createCaseOpenEpoch,
  createCaseStoreBootstrap,
  readCanonicalCaseOpenEpoch,
  readCanonicalCaseStoreBootstrap,
  removeCanonicalCaseOpenEpoch,
  removeCanonicalCaseStoreBootstrap,
  writeCanonicalCaseOpenEpoch,
  writeCanonicalCaseStoreBootstrap,
  type CaseStoreBootstrapV1,
} from "../case-store-epoch.ts";
import {
  LEGACY_TEST_CASE_ID_PREFIX,
  isLegacyTestCaseId,
  parseMunicipalCaseId,
} from "../case-id.ts";

const SCHEMA_VERSION = "sqlite_atomic_topic_case_admission_v1";
const MUNICIPALITY_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const HEX64 = /^[0-9a-f]{64}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const NAMESPACE = /^case-[0-9a-f]{32}$/u;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const KUBERNETES_NAME = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u;
const KUBERNETES_UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** A recovery startup writes this once, before opening the restored municipal
 * database.  It is deliberately a basename-only, canonical receipt. */
export const CASE_RECOVERY_ACTIVATION_FILENAME = "case-recovery-activation-v2.json";
const CASE_STATE_OWNER_DATABASE_FILENAME = "stadtstack-case-state-owner.sqlite";
const CASE_STATE_OWNER_SCHEMA = "CREATE TABLE durable_store_binding(singleton INTEGER NOT NULL PRIMARY KEY CHECK(singleton=1),municipality_id TEXT NOT NULL) STRICT";

export type DurableSingleWriterState = Readonly<{
  mode: "durable_single_writer";
  sourceReleaseDigest: string;
}>;

/** Canonical crash/restart receipt for one reviewed recovery transition. */
type CaseRecoveryActivationMarkerV2 = Readonly<{
  schemaVersion: "case_recovery_activation_v2";
  municipalityId: string;
  sourceDeploymentClaimChecksum: string;
  targetDeploymentClaimChecksum: string;
  sourceDeploymentClaim: CaseDurableDeploymentClaim;
  targetDeploymentClaim: CaseDurableDeploymentClaim;
  sourceSeal: CaseShutdownSealV2;
  sourceReleaseDigest: string;
  sourcePvc: Readonly<{ namespace: string; name: string; uid: string }>;
  targetPvc: Readonly<{ namespace: string; name: string; uid: string }>;
  targetPvName: string;
  recoveryOperationId: string;
  recoveryAttestationChecksum: string;
  shutdownSealChecksum: string;
  databaseBasename: string;
  databaseByteLength: number;
  databaseSha256: string;
  expiresAtUtc: string;
  activatedAtUtc: string;
  markerChecksum: string;
}>;

export type SqliteAtomicTopicCaseAdmissionOptions = {
  rootDir: string;
  municipalityId: string;
  policyVersion: string;
  /** Deployment-pinned municipal actor registry.  Requests only name an actor
   * that is already in this immutable registry; they cannot select a role. */
  actorRegistry: readonly ActorRegistration[];
  allowedSignerPubkeys: readonly string[];
  allowedAgentPubkeys: readonly string[];
  /** Optional policy pin carried into every reopened Case coordinator. */
  requiredDepartmentIds?: readonly string[];
  /** Test-only rollback seam. It is never an admission capability. */
  failpoint?: "after_root_claim" | "after_case_events" | "after_binding_receipt";
  /** Opt-in persistent state. Legacy adapters remain tmp-only and can retain
   * their existing multi-connection test behavior. */
  durableState?: DurableSingleWriterState;
  /** Private, reviewed recovery composition seam. It is invalid without
   * durableState and is never part of the public Case admission interface. */
  deploymentClaimToken?: CaseDurableDeploymentClaimToken;
  recoveryActivationAuthorization?: StagingCaseRecoveryActivationAuthorization;
};

export type SqliteAtomicTopicCaseAdmission = {
  admission: AtomicCaseAdmissionPort;
  outbox: SynchronousCredentialFreeCaseBindingOutboxReader;
  /** Private composition-root seam.  It never creates Cases: only an already
   * atomically admitted Case can be reopened with its pinned journal/config. */
  caseCoordinators: Readonly<{ open(caseId: string): CivicCaseCoordinator }>;
  /** A legacy tmp-only adapter has no durable state to seal and rejects this
   * call with `atomic_admission_seal_unavailable`. */
  sealAndClose(): CaseShutdownSealV2;
  /** Legacy close, or an explicit emergency abandonment after a failed seal.
   * It never writes a durable success seal and must not be used as the normal
   * shutdown path by a durable runtime. */
  close(): void;
};

type CaseMetaRow = {
  case_id: string;
  municipality_id: string;
  namespace: string;
  options_fingerprint: string;
  case_version: number;
  head_checksum: string;
};

type EventRow = {
  case_version: number;
  event_id: string;
  event_type: string;
  prior_event_checksum: string;
  actor_json: string;
  payload_json: string;
  payload_checksum: string;
  correction_of: string | null;
  event_checksum: string;
};

type IdempotencyRow = {
  idempotency_key: string;
  fingerprint: string;
  receipt_json: string;
};

type ReceiptRow = { receipt_json: string };

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

function allowedKeys(value: unknown, fields: readonly string[], code: string): Record<string, unknown> {
  if (!plain(value)) fail(code);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !fields.includes(key)) fail(code);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
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
function clone<T>(value: T): T { return structuredClone(value); }

function parseJson(value: string, code: string): unknown {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { fail(code); }
  if (canonicalJson(parsed) !== value && JSON.stringify(parsed) !== value) fail(code);
  return parsed;
}

function genesisChecksum(caseId: string): string {
  return checksum({ schemaVersion: "case_genesis_v1", caseId });
}

function safeRoot(rootDir: string): string {
  if (typeof rootDir !== "string" || !isAbsolute(rootDir) || rootDir.split(/[\\/]/u).includes("..")) fail("atomic_admission_root_invalid");
  const resolved = resolve(rootDir);
  const systemTmp = resolve(tmpdir());
  const inside = relative(systemTmp, resolved);
  if (resolved === systemTmp || inside.startsWith("..") || isAbsolute(inside) || !existsSync(resolved)) fail("atomic_admission_root_invalid");
  const stat = lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("atomic_admission_root_invalid");
  const realInside = relative(realpathSync(systemTmp), realpathSync(resolved));
  if (realInside.startsWith("..") || isAbsolute(realInside)) fail("atomic_admission_root_invalid");
  return resolved;
}

/** Durable state has a deliberately narrower path contract than the legacy
 * tmp-only test adapter: the caller must name the exact existing directory,
 * without a normalising alias or a symlink at either end. */
function safeDurableRoot(rootDir: string): string {
  if (typeof rootDir !== "string" || !isAbsolute(rootDir) || rootDir !== resolve(rootDir) || rootDir.split(/[\\/]/u).includes("..") || !existsSync(rootDir)) {
    fail("atomic_admission_root_invalid");
  }
  const stat = lstatSync(rootDir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(rootDir) !== rootDir) fail("atomic_admission_root_invalid");
  return rootDir;
}

function ensureNotSymlink(path: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) fail("atomic_admission_path_symlink_forbidden");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

function canonicalReceiptPresent(path: string, code: string): boolean {
  let link: ReturnType<typeof lstatSync>;
  try { link = lstatSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (link.isSymbolicLink()) fail("atomic_admission_path_symlink_forbidden");
  if (!link.isFile() || (link.mode & 0o7777) !== 0o600) fail(code);
  const target = statSync(path);
  if (!target.isFile() || target.dev !== link.dev || target.ino !== link.ino) fail(code);
  return true;
}

function frozenStringSet(value: unknown, code: string): readonly string[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length === 0 ||
    value.some((entry) => typeof entry !== "string" || !HEX64.test(entry)) || new Set(value).size !== value.length) fail(code);
  return Object.freeze([...value] as string[]);
}

function actor(value: unknown, code: string, allowRole = false): ActorBinding {
  const parsed = ownKeys(value, ["actorClass", "actorId"], code);
  const actorClasses = ["citizen", "public", "administration", "council", "case_steward", "department_agent", "department_reviewer", "participation_reviewer"] as const;
  if (typeof parsed.actorId !== "string" || !/^[A-Za-z0-9:._-]{1,256}$/u.test(parsed.actorId) ||
    typeof parsed.actorClass !== "string" || !actorClasses.includes(parsed.actorClass as typeof actorClasses[number]) ||
    (!allowRole && parsed.actorClass !== "case_steward")) fail(code);
  return Object.freeze({ actorId: parsed.actorId, actorClass: parsed.actorClass as ActorBinding["actorClass"] });
}

function actorRegistry(value: unknown, code: string): readonly ActorRegistration[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length === 0) fail(code);
  const parsed = value.map((entry) => {
    const record = allowedKeys(entry, ["actorClass", "actorId", "departmentId"], code);
    const binding = actor({ actorId: record.actorId, actorClass: record.actorClass }, code, true);
    if (record.departmentId !== undefined && (typeof record.departmentId !== "string" ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(record.departmentId))) fail(code);
    if ((binding.actorClass === "department_agent" || binding.actorClass === "department_reviewer") !== (record.departmentId !== undefined)) fail(code);
    return Object.freeze(record.departmentId === undefined ? binding : { ...binding, departmentId: record.departmentId }) as ActorRegistration;
  });
  if (new Set(parsed.map((entry) => entry.actorId)).size !== parsed.length ||
    !parsed.some((entry) => entry.actorClass === "case_steward")) fail(code);
  return Object.freeze(parsed);
}

function requiredDepartments(value: unknown, code: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== 8 ||
    value.some((entry) => typeof entry !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(entry)) ||
    new Set(value).size !== value.length) fail(code);
  return Object.freeze([...value] as string[]);
}

function durableState(value: unknown, code: string): DurableSingleWriterState | undefined {
  if (value === undefined) return undefined;
  const parsed = ownKeys(value, ["mode", "sourceReleaseDigest"], code);
  if (parsed.mode !== "durable_single_writer" || typeof parsed.sourceReleaseDigest !== "string" || !SHA256.test(parsed.sourceReleaseDigest)) fail(code);
  return Object.freeze({ mode: "durable_single_writer" as const, sourceReleaseDigest: parsed.sourceReleaseDigest });
}

function claimToken(value: unknown, code: string): CaseDurableDeploymentClaimToken | undefined {
  if (value === undefined) return undefined;
  try { consumeCaseDurableDeploymentClaimToken(value); } catch { fail(code); }
  return value as CaseDurableDeploymentClaimToken;
}

function recoveryAuthorization(value: unknown, code: string): StagingCaseRecoveryActivationAuthorization | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || utilTypes.isProxy(value)) fail(code);
  return value as StagingCaseRecoveryActivationAuthorization;
}

function validateOptions(input: SqliteAtomicTopicCaseAdmissionOptions): Required<Omit<SqliteAtomicTopicCaseAdmissionOptions, "failpoint" | "requiredDepartmentIds" | "durableState" | "deploymentClaimToken" | "recoveryActivationAuthorization">> & Pick<SqliteAtomicTopicCaseAdmissionOptions, "failpoint" | "requiredDepartmentIds" | "durableState" | "deploymentClaimToken" | "recoveryActivationAuthorization"> {
  const parsed = allowedKeys(input, ["actorRegistry", "allowedAgentPubkeys", "allowedSignerPubkeys", "deploymentClaimToken", "durableState", "failpoint", "municipalityId", "policyVersion", "recoveryActivationAuthorization", "requiredDepartmentIds", "rootDir"], "atomic_admission_options_invalid");
  if (typeof parsed.municipalityId !== "string" || !MUNICIPALITY_ID.test(parsed.municipalityId) ||
    typeof parsed.policyVersion !== "string" || !/^[A-Za-z0-9:._-]{1,256}$/u.test(parsed.policyVersion) ||
    (parsed.failpoint !== undefined && parsed.failpoint !== "after_root_claim" && parsed.failpoint !== "after_case_events" && parsed.failpoint !== "after_binding_receipt")) fail("atomic_admission_options_invalid");
  const resolvedDurableState = durableState(parsed.durableState, "atomic_admission_options_invalid");
  const resolvedClaimToken = claimToken(parsed.deploymentClaimToken, "atomic_admission_options_invalid");
  const resolvedRecoveryAuthorization = recoveryAuthorization(parsed.recoveryActivationAuthorization, "atomic_admission_options_invalid");
  if ((resolvedClaimToken || resolvedRecoveryAuthorization) && !resolvedDurableState) fail("atomic_admission_options_invalid");
  if (resolvedRecoveryAuthorization && !resolvedClaimToken) fail("atomic_admission_options_invalid");
  if (resolvedClaimToken) {
    const claim = consumeCaseDurableDeploymentClaimToken(resolvedClaimToken);
    if (claim.municipalityId !== parsed.municipalityId || claim.releaseDigest !== resolvedDurableState?.sourceReleaseDigest) {
      fail("atomic_admission_options_invalid");
    }
  }
  return Object.freeze({
    rootDir: resolvedDurableState ? safeDurableRoot(parsed.rootDir as string) : safeRoot(parsed.rootDir as string), municipalityId: parsed.municipalityId,
    policyVersion: parsed.policyVersion, actorRegistry: actorRegistry(parsed.actorRegistry, "atomic_admission_options_invalid"),
    allowedSignerPubkeys: frozenStringSet(parsed.allowedSignerPubkeys, "atomic_admission_options_invalid"),
    allowedAgentPubkeys: frozenStringSet(parsed.allowedAgentPubkeys, "atomic_admission_options_invalid"),
    requiredDepartmentIds: requiredDepartments(parsed.requiredDepartmentIds, "atomic_admission_options_invalid"),
    failpoint: parsed.failpoint as SqliteAtomicTopicCaseAdmissionOptions["failpoint"],
    durableState: resolvedDurableState,
    deploymentClaimToken: resolvedClaimToken,
    recoveryActivationAuthorization: resolvedRecoveryAuthorization,
  });
}

/** Stable basename helper: seals contain only this name, never a host path. */
export function caseShutdownSealFilename(): typeof CASE_SHUTDOWN_SEAL_FILENAME { return CASE_SHUTDOWN_SEAL_FILENAME; }
export function caseRecoveryActivationFilename(): typeof CASE_RECOVERY_ACTIVATION_FILENAME { return CASE_RECOVERY_ACTIVATION_FILENAME; }

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function sha256File(path: string): string {
  // Hash the closed database in bounded memory; a legitimate persistent
  // volume must never force the control process to allocate the whole file.
  const descriptor = openSync(path, "r");
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytesRead = readSync(descriptor, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      hash.update(chunk.subarray(0, bytesRead));
    }
  } finally {
    closeSync(descriptor);
  }
  return `sha256:${hash.digest("hex")}`;
}

function requireUtcTimestamp(value: unknown, code: string): string {
  if (typeof value !== "string" || !UTC_TIMESTAMP.test(value)) fail(code);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail(code);
  return value;
}

function writeCanonicalSeal(rootDir: string, seal: CaseShutdownSealV2): void {
  const target = join(rootDir, CASE_SHUTDOWN_SEAL_FILENAME);
  canonicalReceiptPresent(target, "atomic_admission_seal_invalid");
  const temporary = join(rootDir, `.${CASE_SHUTDOWN_SEAL_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    const bytes = Buffer.from(`${canonicalJson(seal)}\n`, "utf8");
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset);
    fsyncSync(descriptor);
    closeSync(descriptor); descriptor = undefined;
    canonicalReceiptPresent(target, "atomic_admission_seal_invalid");
    renameSync(temporary, target);
    if (!canonicalReceiptPresent(target, "atomic_admission_seal_invalid")) fail("atomic_admission_seal_invalid");
    const directoryDescriptor = openSync(rootDir, "r");
    try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
  } catch (error) {
    if (descriptor !== undefined) try { closeSync(descriptor); } catch { /* best effort */ }
    if (existsSync(temporary)) try { unlinkSync(temporary); } catch { /* best effort */ }
    throw error;
  }
}

/** A prior seal certifies the preceding closed epoch only.  Once a new live
 * owner acquires the state, remove that certificate before opening municipal
 * state so a failed later shutdown can never leave a stale success behind. */
function readCanonicalPriorSeal(rootDir: string): CaseShutdownSealV2 | undefined {
  const target = join(rootDir, CASE_SHUTDOWN_SEAL_FILENAME);
  if (!canonicalReceiptPresent(target, "atomic_admission_seal_invalid")) return undefined;
  let previous: CaseShutdownSealV2;
  const encoded = readFileSync(target, "utf8");
  try { previous = verifyCaseShutdownSeal(JSON.parse(encoded)); }
  catch { fail("atomic_admission_seal_invalid"); }
  if (encoded !== `${canonicalJson(previous)}\n`) fail("atomic_admission_seal_invalid");
  return previous;
}

function existingDatabaseMunicipality(rootDir: string): string | undefined {
  const databaseName = /^stadtstack-([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)-atomic-admission\.sqlite$/u;
  const matches = readdirSync(rootDir).flatMap((entry) => {
    const match = databaseName.exec(entry);
    if (!match) return [];
    ensureNotSymlink(join(rootDir, entry));
    return [match[1]!];
  });
  if (matches.length > 1) fail("atomic_admission_store_binding_mismatch");
  return matches[0];
}

function invalidatePriorSeal(rootDir: string, municipalityId: string): void {
  const target = join(rootDir, CASE_SHUTDOWN_SEAL_FILENAME);
  const previous = readCanonicalPriorSeal(rootDir);
  if (!previous) return;
  if (previous.municipalityId !== municipalityId) fail("atomic_admission_seal_invalid");
  const databasePath = join(rootDir, previous.databaseBasename);
  ensureNotSymlink(databasePath);
  if (!existsSync(databasePath)) fail("atomic_admission_seal_invalid");
  const databaseStat = statSync(databasePath);
  if (!databaseStat.isFile() || databaseStat.size !== previous.databaseByteLength ||
    sha256File(databasePath) !== previous.databaseSha256) fail("atomic_admission_seal_invalid");
  unlinkSync(target);
  const directoryDescriptor = openSync(rootDir, "r");
  try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
}

function closedDatabaseIdentity(rootDir: string, seal: CaseShutdownSealV2): Readonly<{ basename: string; byteLength: number; sha256: string }> {
  if (seal.municipalityId === "") fail("atomic_admission_recovery_seal_invalid");
  const databasePath = join(rootDir, seal.databaseBasename);
  for (const suffix of ["", "-wal", "-shm"] as const) {
    const candidate = `${databasePath}${suffix}`;
    ensureNotSymlink(candidate);
    if (suffix !== "" && existsSync(candidate) && statSync(candidate).size !== 0) {
      fail("atomic_admission_recovery_sidecar_nonempty");
    }
  }
  if (!existsSync(databasePath)) fail("atomic_admission_recovery_seal_invalid");
  const databaseStat = statSync(databasePath);
  if (!databaseStat.isFile() || databaseStat.size !== seal.databaseByteLength || sha256File(databasePath) !== seal.databaseSha256) {
    fail("atomic_admission_recovery_seal_invalid");
  }
  return Object.freeze({ basename: seal.databaseBasename, byteLength: databaseStat.size, sha256: seal.databaseSha256 });
}

function requireExistingRecoveryDatabase(databasePath: string): Readonly<{ dev: number; ino: number }> {
  ensureNotSymlink(databasePath);
  if (!existsSync(databasePath)) fail("atomic_admission_recovery_database_required");
  const databaseStat = statSync(databasePath);
  if (!databaseStat.isFile() || databaseStat.size < 1) fail("atomic_admission_recovery_database_required");
  return Object.freeze({ dev: databaseStat.dev, ino: databaseStat.ino });
}

function activationMarkerBody(marker: Omit<CaseRecoveryActivationMarkerV2, "markerChecksum">): Record<string, unknown> {
  return {
    schemaVersion: marker.schemaVersion, municipalityId: marker.municipalityId, sourceReleaseDigest: marker.sourceReleaseDigest,
    sourceDeploymentClaimChecksum: marker.sourceDeploymentClaimChecksum, targetDeploymentClaimChecksum: marker.targetDeploymentClaimChecksum,
    sourceDeploymentClaim: marker.sourceDeploymentClaim, targetDeploymentClaim: marker.targetDeploymentClaim,
    sourceSeal: marker.sourceSeal,
    sourcePvc: marker.sourcePvc, targetPvc: marker.targetPvc, targetPvName: marker.targetPvName,
    recoveryOperationId: marker.recoveryOperationId, recoveryAttestationChecksum: marker.recoveryAttestationChecksum,
    shutdownSealChecksum: marker.shutdownSealChecksum, databaseBasename: marker.databaseBasename,
    databaseByteLength: marker.databaseByteLength, databaseSha256: marker.databaseSha256,
    expiresAtUtc: marker.expiresAtUtc, activatedAtUtc: marker.activatedAtUtc,
  };
}

function verifyRecoveryActivationMarker(value: unknown): CaseRecoveryActivationMarkerV2 {
  const parsed = ownKeys(value, [
    "activatedAtUtc", "databaseBasename", "databaseByteLength", "databaseSha256", "expiresAtUtc",
    "markerChecksum", "municipalityId", "recoveryAttestationChecksum", "recoveryOperationId", "schemaVersion", "shutdownSealChecksum",
    "sourceDeploymentClaim", "sourceDeploymentClaimChecksum", "sourcePvc", "sourceReleaseDigest", "sourceSeal", "targetDeploymentClaim", "targetDeploymentClaimChecksum", "targetPvName", "targetPvc",
  ], "atomic_admission_recovery_marker_invalid");
  if (parsed.schemaVersion !== "case_recovery_activation_v2" || typeof parsed.markerChecksum !== "string" || !SHA256.test(parsed.markerChecksum)) {
    fail("atomic_admission_recovery_marker_invalid");
  }
  const sourcePvc = ownKeys(parsed.sourcePvc, ["name", "namespace", "uid"], "atomic_admission_recovery_marker_invalid");
  const targetPvc = ownKeys(parsed.targetPvc, ["name", "namespace", "uid"], "atomic_admission_recovery_marker_invalid");
  let sourceDeploymentClaim: CaseDurableDeploymentClaim;
  let targetDeploymentClaim: CaseDurableDeploymentClaim;
  let sourceSeal: CaseShutdownSealV2;
  try { sourceDeploymentClaim = verifyCaseDurableDeploymentClaim(parsed.sourceDeploymentClaim); targetDeploymentClaim = verifyCaseDurableDeploymentClaim(parsed.targetDeploymentClaim); sourceSeal = verifyCaseShutdownSeal(parsed.sourceSeal); }
  catch { fail("atomic_admission_recovery_marker_invalid"); }
  if (typeof parsed.municipalityId !== "string" || !MUNICIPALITY_ID.test(parsed.municipalityId) || typeof parsed.sourceReleaseDigest !== "string" || !SHA256.test(parsed.sourceReleaseDigest) ||
    typeof parsed.sourceDeploymentClaimChecksum !== "string" || !SHA256.test(parsed.sourceDeploymentClaimChecksum) || typeof parsed.targetDeploymentClaimChecksum !== "string" || !SHA256.test(parsed.targetDeploymentClaimChecksum) ||
    typeof sourcePvc.namespace !== "string" || !KUBERNETES_NAME.test(sourcePvc.namespace) || typeof sourcePvc.name !== "string" || !KUBERNETES_NAME.test(sourcePvc.name) || typeof sourcePvc.uid !== "string" || !KUBERNETES_UID.test(sourcePvc.uid) ||
    typeof targetPvc.namespace !== "string" || !KUBERNETES_NAME.test(targetPvc.namespace) || typeof targetPvc.name !== "string" || !KUBERNETES_NAME.test(targetPvc.name) || typeof targetPvc.uid !== "string" || !KUBERNETES_UID.test(targetPvc.uid) ||
    typeof parsed.targetPvName !== "string" || !KUBERNETES_NAME.test(parsed.targetPvName) || typeof parsed.recoveryOperationId !== "string" || !UUID_V7.test(parsed.recoveryOperationId) || typeof parsed.recoveryAttestationChecksum !== "string" || !SHA256.test(parsed.recoveryAttestationChecksum) || typeof parsed.shutdownSealChecksum !== "string" || !SHA256.test(parsed.shutdownSealChecksum) ||
    typeof parsed.databaseBasename !== "string" || !/^[A-Za-z0-9._-]{1,256}$/u.test(parsed.databaseBasename) ||
    typeof parsed.databaseByteLength !== "number" || !Number.isSafeInteger(parsed.databaseByteLength) || parsed.databaseByteLength < 1 ||
    typeof parsed.databaseSha256 !== "string" || !SHA256.test(parsed.databaseSha256)) fail("atomic_admission_recovery_marker_invalid");
  const marker = Object.freeze({
    schemaVersion: "case_recovery_activation_v2" as const,
    municipalityId: parsed.municipalityId, sourceReleaseDigest: parsed.sourceReleaseDigest,
    sourceDeploymentClaimChecksum: parsed.sourceDeploymentClaimChecksum, targetDeploymentClaimChecksum: parsed.targetDeploymentClaimChecksum,
    sourceDeploymentClaim, targetDeploymentClaim,
    sourceSeal,
    sourcePvc: Object.freeze({ namespace: sourcePvc.namespace, name: sourcePvc.name, uid: sourcePvc.uid }), targetPvc: Object.freeze({ namespace: targetPvc.namespace, name: targetPvc.name, uid: targetPvc.uid }),
    targetPvName: parsed.targetPvName, recoveryOperationId: parsed.recoveryOperationId,
    recoveryAttestationChecksum: parsed.recoveryAttestationChecksum,
    shutdownSealChecksum: parsed.shutdownSealChecksum, databaseBasename: parsed.databaseBasename,
    databaseByteLength: parsed.databaseByteLength, databaseSha256: parsed.databaseSha256,
    expiresAtUtc: requireUtcTimestamp(parsed.expiresAtUtc, "atomic_admission_recovery_marker_invalid"),
    activatedAtUtc: requireUtcTimestamp(parsed.activatedAtUtc, "atomic_admission_recovery_marker_invalid"),
    markerChecksum: parsed.markerChecksum,
  });
  if (checksum(activationMarkerBody(marker)) !== marker.markerChecksum ||
    new Date(marker.activatedAtUtc).getTime() >= new Date(marker.expiresAtUtc).getTime() ||
    marker.sourceDeploymentClaim.claimChecksum !== marker.sourceDeploymentClaimChecksum || marker.targetDeploymentClaim.claimChecksum !== marker.targetDeploymentClaimChecksum ||
    marker.sourceDeploymentClaim.municipalityId !== marker.municipalityId || marker.sourceDeploymentClaim.releaseDigest !== marker.sourceReleaseDigest ||
    marker.targetDeploymentClaim.municipalityId !== marker.municipalityId || marker.sourceDeploymentClaimChecksum === marker.targetDeploymentClaimChecksum ||
    marker.sourceDeploymentClaim.pvc.namespace !== marker.sourcePvc.namespace || marker.sourceDeploymentClaim.pvc.name !== marker.sourcePvc.name || marker.sourceDeploymentClaim.pvc.uid !== marker.sourcePvc.uid ||
    marker.targetDeploymentClaim.pvc.namespace !== marker.targetPvc.namespace || marker.targetDeploymentClaim.pvc.name !== marker.targetPvc.name || marker.targetDeploymentClaim.pvc.uid !== marker.targetPvc.uid || marker.targetDeploymentClaim.pvName !== marker.targetPvName || marker.sourcePvc.uid === marker.targetPvc.uid ||
    marker.sourceSeal.sealChecksum !== marker.shutdownSealChecksum || marker.sourceSeal.deploymentClaimChecksum !== marker.sourceDeploymentClaimChecksum ||
    marker.sourceSeal.municipalityId !== marker.municipalityId || marker.sourceSeal.sourceReleaseDigest !== marker.sourceReleaseDigest ||
    marker.sourceSeal.databaseBasename !== marker.databaseBasename || marker.sourceSeal.databaseByteLength !== marker.databaseByteLength || marker.sourceSeal.databaseSha256 !== marker.databaseSha256) {
    fail("atomic_admission_recovery_marker_invalid");
  }
  return deepFreeze(marker);
}

function readCanonicalRecoveryActivationMarker(rootDir: string): CaseRecoveryActivationMarkerV2 | undefined {
  const target = join(rootDir, CASE_RECOVERY_ACTIVATION_FILENAME);
  if (!canonicalReceiptPresent(target, "atomic_admission_recovery_marker_invalid")) return undefined;
  let marker: CaseRecoveryActivationMarkerV2;
  const encoded = readFileSync(target, "utf8");
  try { marker = verifyRecoveryActivationMarker(JSON.parse(encoded)); }
  catch { fail("atomic_admission_recovery_marker_invalid"); }
  if (encoded !== `${canonicalJson(marker)}\n`) fail("atomic_admission_recovery_marker_invalid");
  return marker;
}

function writeCanonicalRecoveryActivationMarker(rootDir: string, marker: CaseRecoveryActivationMarkerV2): void {
  const target = join(rootDir, CASE_RECOVERY_ACTIVATION_FILENAME);
  if (canonicalReceiptPresent(target, "atomic_admission_recovery_marker_invalid")) fail("atomic_admission_recovery_marker_exists");
  const temporary = join(rootDir, `.${CASE_RECOVERY_ACTIVATION_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    const bytes = Buffer.from(`${canonicalJson(marker)}\n`, "utf8");
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset);
    fsyncSync(descriptor);
    closeSync(descriptor); descriptor = undefined;
    if (canonicalReceiptPresent(target, "atomic_admission_recovery_marker_invalid")) fail("atomic_admission_recovery_marker_exists");
    renameSync(temporary, target);
    if (!canonicalReceiptPresent(target, "atomic_admission_recovery_marker_invalid")) fail("atomic_admission_recovery_marker_invalid");
    const directoryDescriptor = openSync(rootDir, "r");
    try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
  } catch (error) {
    if (descriptor !== undefined) try { closeSync(descriptor); } catch { /* best effort */ }
    if (existsSync(temporary)) try { unlinkSync(temporary); } catch { /* best effort */ }
    throw error;
  }
}

function removeRecoveryActivationMarker(rootDir: string): void {
  const target = join(rootDir, CASE_RECOVERY_ACTIVATION_FILENAME);
  if (!canonicalReceiptPresent(target, "atomic_admission_recovery_marker_invalid")) return;
  // Parsing first prevents cleanup from hiding a corrupted recovery receipt.
  readCanonicalRecoveryActivationMarker(rootDir);
  unlinkSync(target);
  const directoryDescriptor = openSync(rootDir, "r");
  try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
}

function createRecoveryActivationMarker(
  seal: CaseShutdownSealV2,
  database: Readonly<{ basename: string; byteLength: number; sha256: string }>,
  sourceClaim: CaseDurableDeploymentClaim,
  lease: ReturnType<typeof consumeStagingCaseRecoveryActivationLease>,
): CaseRecoveryActivationMarkerV2 {
  const { gate, targetClaim } = lease;
  if (gate.municipalityId !== seal.municipalityId || gate.sourceReleaseDigest !== seal.sourceReleaseDigest ||
    gate.shutdownSealChecksum !== seal.sealChecksum || gate.sourceDeploymentClaimChecksum !== sourceClaim.claimChecksum ||
    new Date(gate.expiresAtUtc).getTime() <= new Date(gate.verifiedAtUtc).getTime()) {
    fail("atomic_admission_recovery_activation_mismatch");
  }
  const unsigned = {
    schemaVersion: "case_recovery_activation_v2" as const,
    municipalityId: gate.municipalityId, sourceReleaseDigest: gate.sourceReleaseDigest,
    sourceDeploymentClaimChecksum: sourceClaim.claimChecksum, targetDeploymentClaimChecksum: targetClaim.claimChecksum,
    sourceDeploymentClaim: sourceClaim, targetDeploymentClaim: targetClaim,
    sourceSeal: seal,
    sourcePvc: Object.freeze({ namespace: sourceClaim.pvc.namespace, name: sourceClaim.pvc.name, uid: sourceClaim.pvc.uid }),
    targetPvc: Object.freeze({ namespace: targetClaim.pvc.namespace, name: targetClaim.pvc.name, uid: targetClaim.pvc.uid }), targetPvName: targetClaim.pvName,
    recoveryOperationId: gate.recoveryOperationId, recoveryAttestationChecksum: gate.recoveryAttestationChecksum, shutdownSealChecksum: gate.shutdownSealChecksum,
    databaseBasename: database.basename, databaseByteLength: database.byteLength, databaseSha256: database.sha256,
    expiresAtUtc: gate.expiresAtUtc, activatedAtUtc: gate.verifiedAtUtc,
  };
  return verifyRecoveryActivationMarker({ ...unsigned, markerChecksum: checksum(unsigned) });
}

function sameRecoveryActivation(left: CaseRecoveryActivationMarkerV2, right: CaseRecoveryActivationMarkerV2): boolean {
  return left.schemaVersion === right.schemaVersion && left.municipalityId === right.municipalityId &&
    left.sourceReleaseDigest === right.sourceReleaseDigest &&
    left.sourceDeploymentClaimChecksum === right.sourceDeploymentClaimChecksum && left.targetDeploymentClaimChecksum === right.targetDeploymentClaimChecksum &&
    left.sourceDeploymentClaim.claimChecksum === right.sourceDeploymentClaim.claimChecksum && left.targetDeploymentClaim.claimChecksum === right.targetDeploymentClaim.claimChecksum &&
    left.sourcePvc.namespace === right.sourcePvc.namespace && left.sourcePvc.name === right.sourcePvc.name && left.sourcePvc.uid === right.sourcePvc.uid &&
    left.targetPvc.namespace === right.targetPvc.namespace && left.targetPvc.name === right.targetPvc.name &&
    left.targetPvc.uid === right.targetPvc.uid && left.targetPvName === right.targetPvName &&
    left.recoveryOperationId === right.recoveryOperationId && left.recoveryAttestationChecksum === right.recoveryAttestationChecksum &&
    left.shutdownSealChecksum === right.shutdownSealChecksum && left.databaseBasename === right.databaseBasename &&
    left.databaseByteLength === right.databaseByteLength && left.databaseSha256 === right.databaseSha256 &&
    left.expiresAtUtc === right.expiresAtUtc;
}

/**
 * A marker is durable across processes, while an activation authorization is
 * deliberately process-local.  Do not let a fresh process turn its clock
 * backwards and replay an older signed gate merely because its in-memory
 * authorization watermark is empty.  Equality is allowed: an exact retry of
 * the gate that created the marker is still a valid recovery continuation.
 */
function assertRecoveryGateNotOlderThanMarker(
  marker: CaseRecoveryActivationMarkerV2,
  verifiedAtUtc: string,
): void {
  const markerTime = new Date(marker.activatedAtUtc).getTime();
  const verifiedTime = new Date(verifiedAtUtc).getTime();
  if (!Number.isFinite(markerTime) || !Number.isFinite(verifiedTime) || verifiedTime < markerTime) {
    fail("atomic_admission_recovery_activation_stale");
  }
}

function prepareRecoveryActivation(
  rootDir: string,
  municipalityId: string,
  authorization: StagingCaseRecoveryActivationAuthorization,
  expectedTargetClaim: CaseDurableDeploymentClaim,
): void {
  const marker = readCanonicalRecoveryActivationMarker(rootDir);
  const persistedSeal = readCanonicalPriorSeal(rootDir);
  const seal = persistedSeal ?? marker?.sourceSeal;
  if (!seal || seal.municipalityId !== municipalityId) fail("atomic_admission_recovery_seal_required");
  if (seal.deploymentClaimChecksum === null) fail("atomic_admission_recovery_source_claim_required");
  const currentClaim = readCanonicalCaseDurableDeploymentClaim(rootDir);
  if (marker) {
    if (persistedSeal) {
      if (persistedSeal.sealChecksum !== marker.sourceSeal.sealChecksum || !currentClaim ||
        (!sameCaseDurableDeploymentClaim(currentClaim, marker.sourceDeploymentClaim) &&
          !sameCaseDurableDeploymentClaim(currentClaim, marker.targetDeploymentClaim))) {
        fail("atomic_admission_recovery_marker_mismatch");
      }
    } else if (!currentClaim || !sameCaseDurableDeploymentClaim(currentClaim, marker.targetDeploymentClaim)) {
      // Marker -> claim rotation -> source-seal invalidation is the only legal
      // order. A source claim with no local source seal cannot be an honest
      // crash state and must never be repaired by guessing.
      fail("atomic_admission_recovery_claim_mismatch");
    }
  }
  const database = persistedSeal ? closedDatabaseIdentity(rootDir, seal) : Object.freeze({ basename: seal.databaseBasename, byteLength: seal.databaseByteLength, sha256: seal.databaseSha256 });
  const sourceClaim = marker ? marker.sourceDeploymentClaim : currentClaim;
  // A renewed signed Operations workflow must still reproduce the marker's
  // exact source and target claims; the receipt itself grants no authority.
  if (!sourceClaim || sourceClaim.claimChecksum !== seal.deploymentClaimChecksum) fail("atomic_admission_recovery_source_claim_required");
  let lease: ReturnType<typeof consumeStagingCaseRecoveryActivationLease>;
  try { lease = consumeStagingCaseRecoveryActivationLease(consumeStagingCaseRecoveryActivationAuthorization(authorization, sourceClaim, seal, database)); }
  catch { fail("atomic_admission_recovery_activation_unavailable"); }
  if (!sameCaseDurableDeploymentClaim(lease.targetClaim, expectedTargetClaim)) {
    fail("atomic_admission_recovery_activation_unavailable");
  }
  const expected = createRecoveryActivationMarker(seal, database, sourceClaim, lease);
  if (marker) {
    assertRecoveryGateNotOlderThanMarker(marker, lease.gate.verifiedAtUtc);
    if (!sameRecoveryActivation(marker, expected)) {
      fail("atomic_admission_recovery_marker_mismatch");
    }
    const targetClaim = lease.targetClaim;
    if (!currentClaim || (!sameCaseDurableDeploymentClaim(currentClaim, sourceClaim) && !sameCaseDurableDeploymentClaim(currentClaim, targetClaim))) fail("atomic_admission_recovery_claim_mismatch");
    if (sameCaseDurableDeploymentClaim(currentClaim, sourceClaim)) replaceCanonicalCaseDurableDeploymentClaim(rootDir, sourceClaim, targetClaim);
    return;
  }
  writeCanonicalRecoveryActivationMarker(rootDir, expected);
  replaceCanonicalCaseDurableDeploymentClaim(rootDir, sourceClaim, lease.targetClaim);
}

function refreshRecoveryActivationAgainstMarker(
  authorization: StagingCaseRecoveryActivationAuthorization,
  marker: CaseRecoveryActivationMarkerV2,
  expectedTargetClaim: CaseDurableDeploymentClaim,
): void {
  const database = Object.freeze({
    basename: marker.databaseBasename,
    byteLength: marker.databaseByteLength,
    sha256: marker.databaseSha256,
  });
  let lease: ReturnType<typeof consumeStagingCaseRecoveryActivationLease>;
  try {
    lease = consumeStagingCaseRecoveryActivationLease(consumeStagingCaseRecoveryActivationAuthorization(
      authorization,
      marker.sourceDeploymentClaim,
      marker.sourceSeal,
      database,
    ));
  } catch { fail("atomic_admission_recovery_activation_unavailable"); }
  if (!sameCaseDurableDeploymentClaim(lease.targetClaim, expectedTargetClaim)) {
    fail("atomic_admission_recovery_activation_unavailable");
  }
  assertRecoveryGateNotOlderThanMarker(marker, lease.gate.verifiedAtUtc);
  if (!sameRecoveryActivation(marker, createRecoveryActivationMarker(
    marker.sourceSeal,
    database,
    marker.sourceDeploymentClaim,
    lease,
  ))) fail("atomic_admission_recovery_marker_mismatch");
}

type DurableOwnerLock = Readonly<{ release(): void }>;

type OwnerBindingState = Readonly<{ schemaPresent: boolean; municipalityId?: string }>;

function readValidatedOwnerBinding(lockDb: DatabaseSync): OwnerBindingState {
  const integrity = lockDb.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check?: string }>;
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") fail("atomic_admission_owner_store_invalid");
  const schema = lockDb.prepare(`
    SELECT type,name,tbl_name,sql
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type,name
  `).all() as Array<{ type?: string; name?: string; tbl_name?: string; sql?: string }>;
  if (schema.length === 0) return Object.freeze({ schemaPresent: false });
  const version = lockDb.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
  if (version?.user_version !== 1 || schema.length !== 1 || schema[0]?.type !== "table" ||
    schema[0]?.name !== "durable_store_binding" || schema[0]?.tbl_name !== "durable_store_binding" ||
    schema[0]?.sql !== CASE_STATE_OWNER_SCHEMA) fail("atomic_admission_owner_store_invalid");
  const columns = lockDb.prepare("PRAGMA table_info(durable_store_binding)").all() as Array<{
    cid?: number; name?: string; type?: string; notnull?: number; dflt_value?: unknown; pk?: number;
  }>;
  if (columns.length !== 2 ||
    columns[0]?.cid !== 0 || columns[0]?.name !== "singleton" || columns[0]?.type !== "INTEGER" ||
    columns[0]?.notnull !== 1 || columns[0]?.dflt_value !== null || columns[0]?.pk !== 1 ||
    columns[1]?.cid !== 1 || columns[1]?.name !== "municipality_id" || columns[1]?.type !== "TEXT" ||
    columns[1]?.notnull !== 1 || columns[1]?.dflt_value !== null || columns[1]?.pk !== 0) {
    fail("atomic_admission_owner_store_invalid");
  }
  const indexes = lockDb.prepare("PRAGMA index_list(durable_store_binding)").all();
  const foreignKeys = lockDb.prepare("PRAGMA foreign_key_list(durable_store_binding)").all();
  if (indexes.length !== 0 || foreignKeys.length !== 0) fail("atomic_admission_owner_store_invalid");
  const bindings = lockDb.prepare("SELECT singleton,municipality_id FROM durable_store_binding ORDER BY singleton").all() as Array<{
    singleton?: number; municipality_id?: string;
  }>;
  if (bindings.length > 1 || (bindings.length === 1 &&
    (bindings[0]?.singleton !== 1 || typeof bindings[0]?.municipality_id !== "string" ||
      !MUNICIPALITY_ID.test(bindings[0].municipality_id)))) fail("atomic_admission_owner_store_invalid");
  return Object.freeze(bindings.length === 0
    ? { schemaPresent: true }
    : { schemaPresent: true, municipalityId: bindings[0]!.municipality_id! });
}

/** SQLite owns the liveness semantics here.  There is no sentinel file to
 * clean up: a process death releases its BEGIN EXCLUSIVE transaction. The
 * tiny persistent database records store identity, never owner liveness. */
function acquireDurableOwnerLock(rootDir: string, municipalityId: string): DurableOwnerLock {
  const lockPath = join(rootDir, CASE_STATE_OWNER_DATABASE_FILENAME);
  ensureNotSymlink(lockPath); ensureNotSymlink(`${lockPath}-journal`); ensureNotSymlink(`${lockPath}-wal`); ensureNotSymlink(`${lockPath}-shm`);
  let lockDb: DatabaseSync | undefined;
  try {
    lockDb = new DatabaseSync(lockPath, { timeout: 0, enableForeignKeyConstraints: true });
    lockDb.exec(`
      PRAGMA journal_mode=DELETE;
      PRAGMA busy_timeout=0;
      BEGIN EXCLUSIVE;
    `);
    let ownerState = readValidatedOwnerBinding(lockDb);
    if (!ownerState.schemaPresent) {
      const objects = lockDb.prepare("SELECT COUNT(*) AS object_count FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").get() as {
        object_count?: number;
      } | undefined;
      if (objects?.object_count !== 0) fail("atomic_admission_owner_store_invalid");
      lockDb.exec(`${CASE_STATE_OWNER_SCHEMA}; PRAGMA user_version=1;`);
      ownerState = readValidatedOwnerBinding(lockDb);
      if (!ownerState.schemaPresent) fail("atomic_admission_owner_store_invalid");
    }
    const binding = ownerState.municipalityId;
    const priorSeal = readCanonicalPriorSeal(rootDir);
    const databaseMunicipality = existingDatabaseMunicipality(rootDir);
    const priorClaim = readCanonicalCaseDurableDeploymentClaim(rootDir);
    const recoveryMarker = readCanonicalRecoveryActivationMarker(rootDir);
    if (priorSeal && databaseMunicipality && priorSeal.municipalityId !== databaseMunicipality) {
      fail("atomic_admission_seal_invalid");
    }
    const recordedMunicipalities = [
      priorSeal?.municipalityId,
      databaseMunicipality,
      priorClaim?.municipalityId,
      recoveryMarker?.municipalityId,
    ].filter((value): value is string => value !== undefined);
    if (new Set(recordedMunicipalities).size > 1 || recordedMunicipalities.some((value) => value !== municipalityId)) {
      fail("atomic_admission_store_binding_mismatch");
    }
    if (binding && binding !== municipalityId) fail("atomic_admission_store_binding_mismatch");
    if (!binding) {
      lockDb.prepare("INSERT INTO durable_store_binding(singleton,municipality_id) VALUES(1,?)").run(municipalityId);
      if (readValidatedOwnerBinding(lockDb).municipalityId !== municipalityId) fail("atomic_admission_owner_store_invalid");
      lockDb.exec("COMMIT; BEGIN EXCLUSIVE");
    }
    const journal = lockDb.prepare("PRAGMA journal_mode").get() as { journal_mode?: string } | undefined;
    const busy = lockDb.prepare("PRAGMA busy_timeout").get() as { timeout?: number } | undefined;
    if (journal?.journal_mode?.toLowerCase() !== "delete" || busy?.timeout !== 0) fail("atomic_admission_owner_locked");
  } catch (error) {
    try { lockDb?.close(); } catch { /* best effort after lock denial */ }
    if (error instanceof Error && [
      "atomic_admission_path_symlink_forbidden",
      "atomic_admission_owner_store_invalid",
      "atomic_admission_seal_invalid",
      "atomic_admission_recovery_marker_invalid",
      "case_durable_deployment_claim_invalid",
      "atomic_admission_store_binding_mismatch",
    ].includes(error.message)) throw error;
    fail("atomic_admission_owner_locked");
  }
  let released = false;
  return Object.freeze({
    release() {
      if (released) return;
      released = true;
      try { lockDb?.exec("ROLLBACK"); } catch { /* close also rolls back */ }
      try { lockDb?.close(); } catch { /* no live sentinel remains */ }
      lockDb = undefined;
    },
  });
}

function caseNamespace(uuid: string): string {
  if (!UUID_V7.test(uuid)) fail("atomic_admission_case_invalid");
  return `case-${uuid.replaceAll("-", "")}`;
}

function responseReceipt(row: ReceiptRow | undefined): PublicCaseBindingReceiptV1 {
  if (!row || typeof row.receipt_json !== "string") fail("atomic_admission_receipt_missing");
  return verifyPublicCaseBindingReceipt(parseJson(row.receipt_json, "atomic_admission_receipt_invalid"));
}

function commandReceipt(value: unknown): CommandReceipt {
  const parsed = ownKeys(value, ["caseVersion", "eventIds", "journalHeadChecksum"], "atomic_admission_journal_corrupt");
  const caseVersion = typeof parsed.caseVersion === "number" ? parsed.caseVersion : Number.NaN;
  if (!Number.isSafeInteger(caseVersion) || caseVersion < 1 || !Array.isArray(parsed.eventIds) || parsed.eventIds.length < 1 ||
    utilTypes.isProxy(parsed.eventIds) || parsed.eventIds.some((entry) => typeof entry !== "string" || entry.length < 1) ||
    new Set(parsed.eventIds).size !== parsed.eventIds.length || typeof parsed.journalHeadChecksum !== "string" ||
    !SHA256.test(parsed.journalHeadChecksum)) fail("atomic_admission_journal_corrupt");
  return { caseVersion, eventIds: [...parsed.eventIds] as string[], journalHeadChecksum: parsed.journalHeadChecksum };
}

function eventFromRow(caseId: string, row: EventRow): CoordinatorJournalEvent {
  if (!Number.isSafeInteger(row.case_version) || row.case_version < 1 || typeof row.event_id !== "string" ||
    typeof row.event_type !== "string" || !SHA256.test(row.prior_event_checksum) || !SHA256.test(row.payload_checksum) || !SHA256.test(row.event_checksum)) fail("atomic_admission_journal_corrupt");
  const actorBinding = actor(parseJson(row.actor_json, "atomic_admission_journal_corrupt"), "atomic_admission_journal_corrupt", true);
  const payload = parseJson(row.payload_json, "atomic_admission_journal_corrupt");
  if (checksum(payload) !== row.payload_checksum) fail("atomic_admission_journal_corrupt");
  const event = {
    schemaVersion: "case_event_v1" as const, eventId: row.event_id, caseId, caseVersion: row.case_version,
    eventType: row.event_type as CoordinatorJournalEvent["eventType"], priorEventChecksum: row.prior_event_checksum,
    actorBinding, payloadChecksum: row.payload_checksum, correctionOf: row.correction_of, eventChecksum: row.event_checksum, payload,
  };
  const { payload: _payload, eventChecksum, ...withoutChecksum } = event;
  void _payload;
  if (checksum(withoutChecksum) !== eventChecksum) fail("atomic_admission_journal_corrupt");
  return event;
}

const ATOMIC_SCHEMA_SQL = Object.freeze({
  atomic_municipality_meta: `CREATE TABLE atomic_municipality_meta (
      municipality_id TEXT PRIMARY KEY, schema_version TEXT NOT NULL, config_fingerprint TEXT NOT NULL
    ) STRICT`,
  atomic_case_meta: `CREATE TABLE atomic_case_meta (
      case_id TEXT PRIMARY KEY, municipality_id TEXT NOT NULL, namespace TEXT NOT NULL UNIQUE,
      options_fingerprint TEXT NOT NULL, case_version INTEGER NOT NULL CHECK(case_version >= 0), head_checksum TEXT NOT NULL,
      FOREIGN KEY(municipality_id) REFERENCES atomic_municipality_meta(municipality_id)
    ) STRICT`,
  atomic_case_events: `CREATE TABLE atomic_case_events (
      case_id TEXT NOT NULL, case_version INTEGER NOT NULL CHECK(case_version >= 1), event_id TEXT NOT NULL,
      event_type TEXT NOT NULL, prior_event_checksum TEXT NOT NULL, actor_json TEXT NOT NULL, payload_json TEXT NOT NULL,
      payload_checksum TEXT NOT NULL, correction_of TEXT, event_checksum TEXT NOT NULL,
      PRIMARY KEY(case_id, case_version), UNIQUE(case_id, event_id), FOREIGN KEY(case_id) REFERENCES atomic_case_meta(case_id)
    ) STRICT`,
  atomic_case_idempotency: `CREATE TABLE atomic_case_idempotency (
      case_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, fingerprint TEXT NOT NULL, receipt_json TEXT NOT NULL,
      PRIMARY KEY(case_id, idempotency_key), FOREIGN KEY(case_id) REFERENCES atomic_case_meta(case_id)
    ) STRICT`,
  atomic_root_claims: `CREATE TABLE atomic_root_claims (
      municipality_id TEXT NOT NULL, root_event_id TEXT NOT NULL, candidate_event_id TEXT NOT NULL, case_id TEXT NOT NULL,
      PRIMARY KEY(municipality_id, root_event_id), UNIQUE(municipality_id, candidate_event_id), FOREIGN KEY(case_id) REFERENCES atomic_case_meta(case_id)
    ) STRICT`,
  atomic_binding_receipts: `CREATE TABLE atomic_binding_receipts (
      case_id TEXT PRIMARY KEY, municipality_id TEXT NOT NULL, root_event_id TEXT NOT NULL UNIQUE, receipt_json TEXT NOT NULL,
      FOREIGN KEY(case_id) REFERENCES atomic_case_meta(case_id)
    ) STRICT`,
  atomic_binding_outbox: `CREATE TABLE atomic_binding_outbox (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL UNIQUE, receipt_json TEXT NOT NULL,
      receipt_checksum TEXT NOT NULL, FOREIGN KEY(case_id) REFERENCES atomic_case_meta(case_id)
    ) STRICT`,
});

function ensureSchema(db: DatabaseSync, createIfMissing = true): void {
  if (createIfMissing) db.exec(`
    CREATE TABLE IF NOT EXISTS atomic_municipality_meta (
      municipality_id TEXT PRIMARY KEY, schema_version TEXT NOT NULL, config_fingerprint TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS atomic_case_meta (
      case_id TEXT PRIMARY KEY, municipality_id TEXT NOT NULL, namespace TEXT NOT NULL UNIQUE,
      options_fingerprint TEXT NOT NULL, case_version INTEGER NOT NULL CHECK(case_version >= 0), head_checksum TEXT NOT NULL,
      FOREIGN KEY(municipality_id) REFERENCES atomic_municipality_meta(municipality_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS atomic_case_events (
      case_id TEXT NOT NULL, case_version INTEGER NOT NULL CHECK(case_version >= 1), event_id TEXT NOT NULL,
      event_type TEXT NOT NULL, prior_event_checksum TEXT NOT NULL, actor_json TEXT NOT NULL, payload_json TEXT NOT NULL,
      payload_checksum TEXT NOT NULL, correction_of TEXT, event_checksum TEXT NOT NULL,
      PRIMARY KEY(case_id, case_version), UNIQUE(case_id, event_id), FOREIGN KEY(case_id) REFERENCES atomic_case_meta(case_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS atomic_case_idempotency (
      case_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, fingerprint TEXT NOT NULL, receipt_json TEXT NOT NULL,
      PRIMARY KEY(case_id, idempotency_key), FOREIGN KEY(case_id) REFERENCES atomic_case_meta(case_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS atomic_root_claims (
      municipality_id TEXT NOT NULL, root_event_id TEXT NOT NULL, candidate_event_id TEXT NOT NULL, case_id TEXT NOT NULL,
      PRIMARY KEY(municipality_id, root_event_id), UNIQUE(municipality_id, candidate_event_id), FOREIGN KEY(case_id) REFERENCES atomic_case_meta(case_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS atomic_binding_receipts (
      case_id TEXT PRIMARY KEY, municipality_id TEXT NOT NULL, root_event_id TEXT NOT NULL UNIQUE, receipt_json TEXT NOT NULL,
      FOREIGN KEY(case_id) REFERENCES atomic_case_meta(case_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS atomic_binding_outbox (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL UNIQUE, receipt_json TEXT NOT NULL,
      receipt_checksum TEXT NOT NULL, FOREIGN KEY(case_id) REFERENCES atomic_case_meta(case_id)
    ) STRICT;
  `);
  const schemaRows = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all() as Array<{
    type?: string; name?: string; tbl_name?: string; sql?: string;
  }>;
  const names = schemaRows.map((row) => row.name);
  const expected = ["atomic_binding_outbox", "atomic_binding_receipts", "atomic_case_events", "atomic_case_idempotency", "atomic_case_meta", "atomic_municipality_meta", "atomic_root_claims"];
  if (names.length !== expected.length || names.some((name, index) => name !== expected[index]) ||
    schemaRows.some((row) => row.type !== "table" || row.tbl_name !== row.name || typeof row.name !== "string" ||
      row.sql !== ATOMIC_SCHEMA_SQL[row.name as keyof typeof ATOMIC_SCHEMA_SQL])) fail("atomic_admission_schema_invalid");
  const columns: Readonly<Record<string, readonly string[]>> = {
    atomic_municipality_meta: ["municipality_id", "schema_version", "config_fingerprint"],
    atomic_case_meta: ["case_id", "municipality_id", "namespace", "options_fingerprint", "case_version", "head_checksum"],
    atomic_case_events: ["case_id", "case_version", "event_id", "event_type", "prior_event_checksum", "actor_json", "payload_json", "payload_checksum", "correction_of", "event_checksum"],
    atomic_case_idempotency: ["case_id", "idempotency_key", "fingerprint", "receipt_json"],
    atomic_root_claims: ["municipality_id", "root_event_id", "candidate_event_id", "case_id"],
    atomic_binding_receipts: ["case_id", "municipality_id", "root_event_id", "receipt_json"],
    atomic_binding_outbox: ["sequence", "case_id", "receipt_json", "receipt_checksum"],
  };
  for (const [table, expectedColumns] of Object.entries(columns)) {
    const actual = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
    if (actual.length !== expectedColumns.length || actual.some((name, index) => name !== expectedColumns[index])) fail("atomic_admission_schema_invalid");
  }
}

/**
 * A durable store is never rewritten from the retired staging identity.  The
 * caller must create a fresh store or use a separately reviewed migration;
 * accepting a legacy row here would silently fork its receipt/journal chain.
 */
function rejectLegacyDurableCaseRecords(db: DatabaseSync): void {
  const tables = [
    "atomic_case_meta",
    "atomic_case_events",
    "atomic_case_idempotency",
    "atomic_root_claims",
    "atomic_binding_receipts",
    "atomic_binding_outbox",
  ] as const;
  for (const table of tables) {
    const row = db.prepare(`SELECT case_id FROM ${table} WHERE case_id GLOB ? LIMIT 1`)
      .get(`${LEGACY_TEST_CASE_ID_PREFIX}*`) as { case_id?: unknown } | undefined;
    if (row && isLegacyTestCaseId(row.case_id)) {
      fail("atomic_admission_legacy_case_id_present");
    }
  }
}

/** Read-only preflight for a durable volume. It runs before recovery metadata
 * can be rotated or a prior shutdown seal can be invalidated. */
function preflightRejectLegacyDurableCaseRecords(databasePath: string): void {
  if (!existsSync(databasePath)) return;
  const database = new DatabaseSync(databasePath, {
    readOnly: true,
    enableForeignKeyConstraints: true,
  });
  try {
    // Validate the complete read-only schema first. A partial schema must not
    // bypass a table scan and continue far enough to consume a seal or epoch.
    ensureSchema(database, false);
    rejectLegacyDurableCaseRecords(database);
  } finally {
    database.close();
  }
}

function captureCaseStateRecoveryEvidence(db: DatabaseSync): CaseStateRecoveryEvidenceV1 {
  const caseJournalHeads = (db.prepare("SELECT case_id,case_version,head_checksum FROM atomic_case_meta ORDER BY case_id").all() as Array<{
    case_id: string; case_version: number; head_checksum: string;
  }>).map((row) => {
    if (typeof row.case_id !== "string" || !Number.isSafeInteger(row.case_version) || row.case_version < 3 || !SHA256.test(row.head_checksum)) {
      fail("atomic_admission_seal_integrity_invalid");
    }
    return Object.freeze({ caseId: row.case_id, caseVersion: row.case_version, journalHeadChecksum: row.head_checksum });
  });
  const outboxEntries = (db.prepare("SELECT sequence,receipt_json,receipt_checksum FROM atomic_binding_outbox ORDER BY sequence").all() as Array<{
    sequence: number; receipt_json: string; receipt_checksum: string;
  }>).map((row) => {
    if (!Number.isSafeInteger(row.sequence) || row.sequence < 1 || !SHA256.test(row.receipt_checksum)) fail("atomic_admission_seal_integrity_invalid");
    const receipt = verifyPublicCaseBindingReceipt(parseJson(row.receipt_json, "atomic_admission_seal_integrity_invalid"));
    if (receipt.receiptChecksum !== row.receipt_checksum) fail("atomic_admission_seal_integrity_invalid");
    return Object.freeze({ sequence: row.sequence, receipt: clone(receipt) });
  });
  return verifyCaseStateRecoveryEvidence(createCaseStateRecoveryEvidence({ caseJournalHeads, outboxEntries }));
}

function truncateWalCheckpoint(db: DatabaseSync): Readonly<{ mode: "TRUNCATE"; busy: number; log: number; checkpointed: number }> {
  const checkpoint = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as { busy?: number; log?: number; checkpointed?: number } | undefined;
  const busy = checkpoint?.busy;
  const log = checkpoint?.log;
  const checkpointed = checkpoint?.checkpointed;
  if (typeof busy !== "number" || typeof log !== "number" || typeof checkpointed !== "number" ||
    !Number.isSafeInteger(busy) || !Number.isSafeInteger(log) || !Number.isSafeInteger(checkpointed) ||
    busy !== 0 || log < 0 || checkpointed < 0 || log !== checkpointed) fail("atomic_admission_seal_checkpoint_invalid");
  return Object.freeze({ mode: "TRUNCATE" as const, busy, log, checkpointed });
}

function sameActor(left: ActorBinding, right: ActorBinding): boolean { return left.actorId === right.actorId && left.actorClass === right.actorClass; }

function registryHas(registry: readonly ActorRegistration[], value: ActorBinding): boolean {
  return registry.some((registered) => sameActor(registered, value));
}

function validateAppendChain(append: CoordinatorJournalAppend, caseId: string, expectedVersion: number, expectedHead = genesisChecksum(caseId)): void {
  ownKeys(append, ["caseId", "events", "expectedCaseVersion", "fingerprint", "idempotencyKey", "namespace", "optionsFingerprint", "receipt"], "atomic_admission_append_invalid");
  if (append.caseId !== caseId || !Number.isSafeInteger(append.expectedCaseVersion) ||
    append.expectedCaseVersion !== expectedVersion || !SHA256.test(append.optionsFingerprint) ||
    typeof append.idempotencyKey !== "string" || append.idempotencyKey.length < 1 ||
    !SHA256.test(append.fingerprint) || !Array.isArray(append.events) || utilTypes.isProxy(append.events) ||
    append.events.length < 1 || !plain(append.receipt) || !SHA256.test(expectedHead)) fail("atomic_admission_append_invalid");
  let prior = expectedHead;
  const knownEventIds = new Set(Array.from({ length: expectedVersion }, (_, index) =>
    `urn:stadtstack:case-event:${caseId}:${index + 1}`));
  const eventIds: string[] = [];
  for (const [index, event] of append.events.entries()) {
    ownKeys(event, ["actorBinding", "caseId", "caseVersion", "correctionOf", "eventChecksum", "eventId", "eventType", "payload", "payloadChecksum", "priorEventChecksum", "schemaVersion"], "atomic_admission_append_invalid");
    const expectedEventId = `urn:stadtstack:case-event:${caseId}:${expectedVersion + index + 1}`;
    if (event.schemaVersion !== "case_event_v1" || event.caseId !== caseId || event.caseVersion !== expectedVersion + index + 1 ||
      event.priorEventChecksum !== prior || !SHA256.test(event.payloadChecksum) || !SHA256.test(event.eventChecksum) ||
      event.eventId !== expectedEventId || typeof event.eventType !== "string" ||
      event.eventType.length < 1 || !Object.hasOwn(event, "payload") ||
      (event.correctionOf !== null && (typeof event.correctionOf !== "string" || !knownEventIds.has(event.correctionOf)))) fail("atomic_admission_append_invalid");
    const boundActor = actor(event.actorBinding, "atomic_admission_append_invalid", true);
    if (checksum(event.payload) !== event.payloadChecksum) fail("atomic_admission_append_invalid");
    const { payload: _payload, eventChecksum, ...withoutChecksum } = event;
    void _payload;
    if (checksum(withoutChecksum) !== eventChecksum || !sameActor(boundActor, event.actorBinding)) fail("atomic_admission_append_invalid");
    prior = event.eventChecksum;
    eventIds.push(event.eventId);
    knownEventIds.add(event.eventId);
  }
  const receipt = commandReceipt(append.receipt);
  if (receipt.caseVersion !== expectedVersion + append.events.length || receipt.journalHeadChecksum !== prior ||
    receipt.eventIds.length !== eventIds.length || receipt.eventIds.some((id, index) => id !== eventIds[index])) fail("atomic_admission_append_invalid");
}

function initialAdmissionAppend(append: CoordinatorJournalAppend, caseId: string): void {
  validateAppendChain(append, caseId, 0);
  if (append.events.length !== 3 || append.receipt.caseVersion !== 3 || append.receipt.eventIds.length !== 3) {
    fail("atomic_admission_append_invalid");
  }
}

/**
 * Staging-only municipal SQLite adapter. The exposed admission interface is
 * intentionally one method; claiming a root, writing the first three Case
 * events/idempotency record, binding receipt, and outbox entry are hidden in
 * the same BEGIN IMMEDIATE transaction.
 */
export function createSqliteAtomicTopicCaseAdmission(
  input: SqliteAtomicTopicCaseAdmissionOptions,
): SqliteAtomicTopicCaseAdmission {
  const config = validateOptions(input);
  if (config.requiredDepartmentIds) {
    for (const departmentId of config.requiredDepartmentIds) {
      const hasAgent = config.actorRegistry.some((entry) => entry.actorClass === "department_agent" && entry.departmentId === departmentId);
      const hasReviewer = config.actorRegistry.some((entry) => entry.actorClass === "department_reviewer" && entry.departmentId === departmentId);
      if (!hasAgent || !hasReviewer) fail("atomic_admission_options_invalid");
    }
  }
  const configFingerprint = checksum({
    schemaVersion: SCHEMA_VERSION, municipalityId: config.municipalityId, policyVersion: config.policyVersion,
    actorRegistry: [...config.actorRegistry].sort((left, right) => `${left.actorClass}:${left.actorId}`.localeCompare(`${right.actorClass}:${right.actorId}`)),
    requiredDepartmentIds: config.requiredDepartmentIds ? [...config.requiredDepartmentIds].sort() : [],
    allowedSignerPubkeys: [...config.allowedSignerPubkeys].sort(),
    allowedAgentPubkeys: [...config.allowedAgentPubkeys].sort(),
  });
  const databaseBasename = `stadtstack-${config.municipalityId}-atomic-admission.sqlite`;
  const databasePath = join(config.rootDir, databaseBasename);
  ensureNotSymlink(databasePath); ensureNotSymlink(`${databasePath}-wal`); ensureNotSymlink(`${databasePath}-shm`);
  // Acquire before opening the municipal database.  This ensures a second
  // durable process is rejected without observing or migrating municipal
  // state, while legacy tmp-only callers retain their multi-connection seam.
  const durableOwner = config.durableState ? acquireDurableOwnerLock(config.rootDir, config.municipalityId) : undefined;
  let activeDeploymentClaim: CaseDurableDeploymentClaim | undefined;
  let recoveryBaseline: CaseStateRecoveryEvidenceV1 | undefined;
  let existingDatabaseIdentity: Readonly<{ dev: number; ino: number }> | undefined;
  let bootstrapReceiptForTransition: CaseStoreBootstrapV1 | undefined;
  try {
    if (durableOwner) {
      preflightRejectLegacyDurableCaseRecords(databasePath);
      const expectedTargetClaim = config.deploymentClaimToken
        ? consumeCaseDurableDeploymentClaimToken(config.deploymentClaimToken)
        : undefined;
      const marker = readCanonicalRecoveryActivationMarker(config.rootDir);
      const cleanSeal = readCanonicalPriorSeal(config.rootDir);
      const claimedAtStart = readCanonicalCaseDurableDeploymentClaim(config.rootDir);
      let bootstrap = readCanonicalCaseStoreBootstrap(config.rootDir);
      let openEpoch = readCanonicalCaseOpenEpoch(config.rootDir);
      if ((marker && (bootstrap || openEpoch)) || (bootstrap && cleanSeal)) {
        fail("atomic_admission_epoch_state_invalid");
      }
      if (bootstrap && openEpoch) {
        if (!expectedTargetClaim || !claimedAtStart ||
          !sameCaseDurableDeploymentClaim(bootstrap.deploymentClaim, expectedTargetClaim) ||
          !sameCaseDurableDeploymentClaim(openEpoch.deploymentClaim, expectedTargetClaim) ||
          !sameCaseDurableDeploymentClaim(claimedAtStart, expectedTargetClaim) ||
          bootstrap.configFingerprint !== configFingerprint || openEpoch.configFingerprint !== configFingerprint) {
          fail("atomic_admission_epoch_state_invalid");
        }
        removeCanonicalCaseStoreBootstrap(config.rootDir);
        bootstrap = undefined;
      }
      if (bootstrap && (!expectedTargetClaim || !sameCaseDurableDeploymentClaim(bootstrap.deploymentClaim, expectedTargetClaim) ||
        bootstrap.configFingerprint !== configFingerprint || bootstrap.databaseBasename !== databaseBasename)) {
        fail("atomic_admission_deployment_claim_mismatch");
      }
      if (openEpoch && (!expectedTargetClaim || !claimedAtStart ||
        !sameCaseDurableDeploymentClaim(openEpoch.deploymentClaim, expectedTargetClaim) ||
        !sameCaseDurableDeploymentClaim(claimedAtStart, expectedTargetClaim) || openEpoch.configFingerprint !== configFingerprint)) {
        fail("atomic_admission_deployment_claim_mismatch");
      }
      // Configuration drift is checked before reconciliation, marker writes,
      // claim rotation, or seal invalidation. A wrong application policy must
      // leave every recovery receipt byte-for-byte available for inspection
      // and for a subsequent exact retry.
      const initialEpochSeal = cleanSeal ?? marker?.sourceSeal;
      if (initialEpochSeal && initialEpochSeal.configFingerprint !== configFingerprint) {
        fail("atomic_admission_config_mismatch");
      }
      // A clean seal written before an old ordinary epoch receipt was removed
      // is a completed shutdown. Only the exact deployment token may consume
      // the stale epoch receipt; then the new seal becomes the next baseline.
      if (openEpoch && cleanSeal && claimedAtStart) {
        if (!expectedTargetClaim || !sameCaseDurableDeploymentClaim(expectedTargetClaim, claimedAtStart) ||
          cleanSeal.deploymentClaimChecksum !== expectedTargetClaim.claimChecksum ||
          cleanSeal.sourceReleaseDigest !== expectedTargetClaim.releaseDigest) {
          fail("atomic_admission_deployment_claim_mismatch");
        }
        closedDatabaseIdentity(config.rootDir, cleanSeal);
        removeCanonicalCaseOpenEpoch(config.rootDir);
        openEpoch = undefined;
      }
      if (!claimedAtStart && expectedTargetClaim && !marker && !cleanSeal && !bootstrap && !openEpoch) {
        if (existingDatabaseMunicipality(config.rootDir)) fail("atomic_admission_deployment_claim_bootstrap_not_empty");
        bootstrap = createCaseStoreBootstrap({
          municipalityId: config.municipalityId,
          deploymentClaim: expectedTargetClaim,
          configFingerprint,
          databaseBasename,
        });
        writeCanonicalCaseStoreBootstrap(config.rootDir, bootstrap);
      }
      // Crash after writing the new target seal but before marker cleanup is a
      // completed clean shutdown, not a recovery retry. Reconcile only the
      // exact target claim/seal/database combination.
      let reconciledCompletedRecovery = false;
      if (marker && cleanSeal && claimedAtStart && expectedTargetClaim &&
        sameCaseDurableDeploymentClaim(expectedTargetClaim, marker.targetDeploymentClaim) &&
        cleanSeal.deploymentClaimChecksum === marker.targetDeploymentClaimChecksum &&
        sameCaseDurableDeploymentClaim(claimedAtStart, marker.targetDeploymentClaim) && cleanSeal.municipalityId === marker.municipalityId &&
        cleanSeal.sourceReleaseDigest === marker.targetDeploymentClaim.releaseDigest && cleanSeal.sourceReleaseDigest === config.durableState?.sourceReleaseDigest &&
        cleanSeal.databaseBasename === marker.databaseBasename) {
        closedDatabaseIdentity(config.rootDir, cleanSeal);
        if (config.recoveryActivationAuthorization) {
          if (!expectedTargetClaim) fail("atomic_admission_options_invalid");
          refreshRecoveryActivationAgainstMarker(config.recoveryActivationAuthorization, marker, expectedTargetClaim);
        }
        removeRecoveryActivationMarker(config.rootDir);
        reconciledCompletedRecovery = true;
      }
      const remainingMarker = readCanonicalRecoveryActivationMarker(config.rootDir);
      if (remainingMarker && !config.recoveryActivationAuthorization) fail("atomic_admission_recovery_marker_requires_activation");
      if (config.recoveryActivationAuthorization && !reconciledCompletedRecovery) {
        if (!expectedTargetClaim) fail("atomic_admission_options_invalid");
        prepareRecoveryActivation(config.rootDir, config.municipalityId, config.recoveryActivationAuthorization, expectedTargetClaim);
      }
      const existingClaim = readCanonicalCaseDurableDeploymentClaim(config.rootDir);
      if (existingClaim) {
        if (!expectedTargetClaim || !sameCaseDurableDeploymentClaim(existingClaim, expectedTargetClaim)) {
          // Exact identity intentionally rejects ordinary in-place image/binding
          // changes; a separately reviewed upgrade transition is required.
          fail("atomic_admission_deployment_claim_mismatch");
        }
      } else if (expectedTargetClaim) {
        const currentBootstrap = readCanonicalCaseStoreBootstrap(config.rootDir);
        if (!currentBootstrap || !sameCaseDurableDeploymentClaim(currentBootstrap.deploymentClaim, expectedTargetClaim) ||
          existingDatabaseMunicipality(config.rootDir) || readCanonicalPriorSeal(config.rootDir) || remainingMarker || readCanonicalCaseOpenEpoch(config.rootDir)) {
          fail("atomic_admission_deployment_claim_bootstrap_not_empty");
        }
        writeCanonicalCaseDurableDeploymentClaim(config.rootDir, expectedTargetClaim);
      }
      const claimBeforeOpen = readCanonicalCaseDurableDeploymentClaim(config.rootDir);
      const sealBeforeOpen = readCanonicalPriorSeal(config.rootDir);
      const markerBeforeOpen = readCanonicalRecoveryActivationMarker(config.rootDir);
      const bootstrapBeforeOpen = readCanonicalCaseStoreBootstrap(config.rootDir);
      let openEpochBeforeOpen = readCanonicalCaseOpenEpoch(config.rootDir);
      if ((markerBeforeOpen && (bootstrapBeforeOpen || openEpochBeforeOpen)) ||
        (bootstrapBeforeOpen && (openEpochBeforeOpen || sealBeforeOpen))) fail("atomic_admission_epoch_state_invalid");
      const epochSeal = sealBeforeOpen ?? markerBeforeOpen?.sourceSeal;
      if (epochSeal && epochSeal.configFingerprint !== configFingerprint) fail("atomic_admission_config_mismatch");
      if (sealBeforeOpen) {
        if (markerBeforeOpen) {
          if (!claimBeforeOpen || !sameCaseDurableDeploymentClaim(claimBeforeOpen, markerBeforeOpen.targetDeploymentClaim) ||
            sealBeforeOpen.sealChecksum !== markerBeforeOpen.sourceSeal.sealChecksum) {
            fail("atomic_admission_recovery_marker_mismatch");
          }
        } else if (claimBeforeOpen
          ? sealBeforeOpen.deploymentClaimChecksum !== claimBeforeOpen.claimChecksum
          : sealBeforeOpen.deploymentClaimChecksum !== null) {
          fail("atomic_admission_deployment_claim_mismatch");
        }
      }
      if (sealBeforeOpen && !markerBeforeOpen && expectedTargetClaim) {
        if (!claimBeforeOpen || !sameCaseDurableDeploymentClaim(claimBeforeOpen, expectedTargetClaim) || openEpochBeforeOpen) {
          fail("atomic_admission_deployment_claim_mismatch");
        }
        openEpochBeforeOpen = createCaseOpenEpoch({
          municipalityId: config.municipalityId,
          deploymentClaim: expectedTargetClaim,
          configFingerprint,
          databaseBasename: sealBeforeOpen.databaseBasename,
          baselineShutdownSeal: sealBeforeOpen,
        });
        writeCanonicalCaseOpenEpoch(config.rootDir, openEpochBeforeOpen);
      }
      if (markerBeforeOpen) {
        existingDatabaseIdentity = requireExistingRecoveryDatabase(databasePath);
        recoveryBaseline = verifyCaseStateRecoveryEvidence(markerBeforeOpen.sourceSeal.recoveryEvidence);
      } else if (openEpochBeforeOpen) {
        if (!claimBeforeOpen || !sameCaseDurableDeploymentClaim(claimBeforeOpen, openEpochBeforeOpen.deploymentClaim)) {
          fail("atomic_admission_deployment_claim_mismatch");
        }
        existingDatabaseIdentity = requireExistingRecoveryDatabase(databasePath);
        recoveryBaseline = verifyCaseStateRecoveryEvidence(openEpochBeforeOpen.baselineShutdownSeal.recoveryEvidence);
      } else if (bootstrapBeforeOpen) {
        if (!claimBeforeOpen || !sameCaseDurableDeploymentClaim(claimBeforeOpen, bootstrapBeforeOpen.deploymentClaim)) {
          fail("atomic_admission_epoch_state_invalid");
        }
        bootstrapReceiptForTransition = bootstrapBeforeOpen;
      } else if (expectedTargetClaim) {
        fail("atomic_admission_unclean_epoch_requires_recovery");
      }
      invalidatePriorSeal(config.rootDir, config.municipalityId);
      activeDeploymentClaim = readCanonicalCaseDurableDeploymentClaim(config.rootDir);
    }
  }
  catch (error) { durableOwner?.release(); throw error; }
  const openMunicipalDatabase = (
    expectedIdentity: Readonly<{ dev: number; ino: number }> | undefined,
    createSchema: boolean,
  ): DatabaseSync => {
    const databaseLocation = expectedIdentity ? pathToFileURL(databasePath) : databasePath;
    if (databaseLocation instanceof URL) databaseLocation.searchParams.set("mode", "rw");
    const openedDatabase = new DatabaseSync(databaseLocation, { timeout: 5000, enableForeignKeyConstraints: true });
    try {
      if (expectedIdentity) {
        const opened = statSync(databasePath);
        if (!opened.isFile() || opened.dev !== expectedIdentity.dev || opened.ino !== expectedIdentity.ino) {
          fail("atomic_admission_recovery_database_required");
        }
      }
      openedDatabase.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
      const pragmas = {
        journal: openedDatabase.prepare("PRAGMA journal_mode").get() as { journal_mode: string },
        sync: openedDatabase.prepare("PRAGMA synchronous").get() as { synchronous: number },
        foreign: openedDatabase.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number },
      };
      if (pragmas.journal.journal_mode.toLowerCase() !== "wal" || pragmas.sync.synchronous !== 2 || pragmas.foreign.foreign_keys !== 1) fail("atomic_admission_pragmas_invalid");
      ensureSchema(openedDatabase, createSchema);
      rejectLegacyDurableCaseRecords(openedDatabase);
      openedDatabase.exec("BEGIN IMMEDIATE");
      const prior = openedDatabase.prepare("SELECT schema_version,config_fingerprint FROM atomic_municipality_meta WHERE municipality_id=?")
        .get(config.municipalityId) as { schema_version: string; config_fingerprint: string } | undefined;
      if (prior) {
        if (prior.schema_version !== SCHEMA_VERSION || prior.config_fingerprint !== configFingerprint) fail("atomic_admission_config_mismatch");
      } else if (!createSchema) {
        fail("atomic_admission_recovery_database_below_baseline");
      } else {
        openedDatabase.prepare("INSERT INTO atomic_municipality_meta(municipality_id,schema_version,config_fingerprint) VALUES(?,?,?)")
          .run(config.municipalityId, SCHEMA_VERSION, configFingerprint);
      }
      openedDatabase.exec("COMMIT");
      return openedDatabase;
    } catch (error) {
      try { openedDatabase.exec("ROLLBACK"); } catch { /* best-effort after failed bootstrap */ }
      openedDatabase.close();
      throw error;
    }
  };
  let db: DatabaseSync;
  try { db = openMunicipalDatabase(existingDatabaseIdentity, recoveryBaseline === undefined); }
  catch (error) { durableOwner?.release(); throw error; }
  let closed = false;
  let shutdownSeal: CaseShutdownSealV2 | undefined;
  const ensureOpen = (): void => { if (closed) fail("atomic_admission_closed"); };
  const withReadSnapshot = <T>(operation: () => T): T => {
    ensureOpen();
    // Recovery is also invoked while an adapter-owned write/read transaction
    // is already active.  Reuse that snapshot instead of nesting BEGIN.  A
    // standalone recovery must establish its own snapshot so metadata, events,
    // and idempotency rows cannot straddle a concurrent continuation commit.
    if (db.isTransaction) return operation();
    db.exec("BEGIN");
    try {
      const result = operation();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* best effort */ }
      throw error;
    }
  };

  const readRecovery = (request: { namespace: string; caseId: string; optionsFingerprint: string }): CoordinatorJournalRecovery => {
    ensureOpen();
    if (!NAMESPACE.test(request.namespace) || typeof request.caseId !== "string" || typeof request.optionsFingerprint !== "string") fail("atomic_admission_recovery_invalid");
    return withReadSnapshot(() => {
      // Deliberately read-only: an unknown Case is not a claim and creates no row.
      const meta = db.prepare("SELECT case_id,municipality_id,namespace,options_fingerprint,case_version,head_checksum FROM atomic_case_meta WHERE case_id=?").get(request.caseId) as CaseMetaRow | undefined;
      if (!meta) return { events: [], idempotency: [] };
      if (meta.municipality_id !== config.municipalityId || meta.namespace !== request.namespace || meta.options_fingerprint !== request.optionsFingerprint || !Number.isSafeInteger(meta.case_version) || meta.case_version < 0 || !SHA256.test(meta.head_checksum)) fail("atomic_admission_journal_corrupt");
      const rows = db.prepare("SELECT case_version,event_id,event_type,prior_event_checksum,actor_json,payload_json,payload_checksum,correction_of,event_checksum FROM atomic_case_events WHERE case_id=? ORDER BY case_version").all(request.caseId) as EventRow[];
      if (rows.length !== meta.case_version) fail("atomic_admission_journal_corrupt");
      const events = rows.map((row) => eventFromRow(request.caseId, row));
      const head = events.length ? events[events.length - 1]!.eventChecksum : genesisChecksum(request.caseId);
      if (head !== meta.head_checksum) fail("atomic_admission_journal_corrupt");
      const idempotency = (db.prepare("SELECT idempotency_key,fingerprint,receipt_json FROM atomic_case_idempotency WHERE case_id=? ORDER BY idempotency_key").all(request.caseId) as IdempotencyRow[]).map((row): CoordinatorJournalIdempotency => {
        if (typeof row.idempotency_key !== "string" || typeof row.fingerprint !== "string" || row.fingerprint.length === 0) fail("atomic_admission_journal_corrupt");
        return { idempotencyKey: row.idempotency_key, fingerprint: row.fingerprint, receipt: commandReceipt(parseJson(row.receipt_json, "atomic_admission_journal_corrupt")) };
      });
      return clone({ events, idempotency });
    });
  };

  const readCaseMeta = (caseId: string): CaseMetaRow | undefined =>
    db.prepare("SELECT case_id,municipality_id,namespace,options_fingerprint,case_version,head_checksum FROM atomic_case_meta WHERE case_id=?")
      .get(caseId) as CaseMetaRow | undefined;

  const pinnedCoordinator = (caseId: string, uuidV7: string, journal: CoordinatorJournalPort): CivicCaseCoordinator =>
    createCivicCaseCoordinator({
      jurisdictionValue: config.municipalityId, uuidV7, canonicalCaseId: caseId,
      policyVersion: config.policyVersion, syntheticFixtureOnly: true,
      requireSignedSuggestionAdmission: true, allowedSignerPubkeys: [...config.allowedSignerPubkeys],
      allowedAgentPubkeys: [...config.allowedAgentPubkeys], actors: config.actorRegistry,
      requiredDepartmentIds: config.requiredDepartmentIds, journalPort: journal, journalNamespace: journal.namespace,
    });

  const validateCaseUnit = (meta: CaseMetaRow): PublicCaseBindingReceiptV1 => {
    if (!meta || typeof meta.case_id !== "string" || meta.municipality_id !== config.municipalityId || !NAMESPACE.test(meta.namespace) ||
      typeof meta.options_fingerprint !== "string" || meta.options_fingerprint.length < 1 ||
      !Number.isSafeInteger(meta.case_version) || meta.case_version < 3 || !SHA256.test(meta.head_checksum)) {
      fail("atomic_admission_unit_corrupt");
    }
    const events = (db.prepare("SELECT case_version,event_id,event_type,prior_event_checksum,actor_json,payload_json,payload_checksum,correction_of,event_checksum FROM atomic_case_events WHERE case_id=? ORDER BY case_version")
      .all(meta.case_id) as EventRow[]).map((row) => eventFromRow(meta.case_id, row));
    if (events.length !== meta.case_version) fail("atomic_admission_unit_corrupt");
    let prior = genesisChecksum(meta.case_id);
    for (const [index, event] of events.entries()) {
      if (event.caseVersion !== index + 1 || event.priorEventChecksum !== prior) fail("atomic_admission_unit_corrupt");
      prior = event.eventChecksum;
    }
    if (prior !== meta.head_checksum) fail("atomic_admission_unit_corrupt");
    const idempotency = db.prepare("SELECT idempotency_key,fingerprint,receipt_json FROM atomic_case_idempotency WHERE case_id=? ORDER BY idempotency_key")
      .all(meta.case_id) as IdempotencyRow[];
    if (idempotency.length < 1) fail("atomic_admission_unit_corrupt");
    for (const entry of idempotency) {
      if (typeof entry.idempotency_key !== "string" || entry.idempotency_key.length < 1 || typeof entry.fingerprint !== "string" || entry.fingerprint.length < 1) fail("atomic_admission_unit_corrupt");
      const command = commandReceipt(parseJson(entry.receipt_json, "atomic_admission_unit_corrupt"));
      const commandHead = events[command.caseVersion - 1];
      if (command.caseVersion < 1 || command.caseVersion > meta.case_version || !commandHead ||
        command.journalHeadChecksum !== commandHead.eventChecksum || command.eventIds.length < 1 ||
        command.eventIds.some((eventId, index) => events[command.caseVersion - command.eventIds.length + index]?.eventId !== eventId)) {
        fail("atomic_admission_unit_corrupt");
      }
    }
    const receiptRow = db.prepare("SELECT receipt_json FROM atomic_binding_receipts WHERE case_id=? AND municipality_id=?").get(meta.case_id, config.municipalityId) as ReceiptRow | undefined;
    const receipt = responseReceipt(receiptRow);
    const discussionPayload = events[1]?.payload;
    const admissionPayload = events[2]?.payload;
    if (!plain(discussionPayload) || !plain(admissionPayload) ||
      !plain(discussionPayload.discussion) || !plain(admissionPayload.signedSuggestion) ||
      !plain(admissionPayload.signedSuggestion.draft) || !plain(admissionPayload.signedSuggestion.event) ||
      !plain(admissionPayload.sourceAnswer)) fail("atomic_admission_unit_corrupt");
    const journalBinding = {
      rootEventId: discussionPayload.discussion.id,
      topicId: admissionPayload.signedSuggestion.draft.topicId,
      candidateId: admissionPayload.signedSuggestion.candidateId,
      candidateEventId: admissionPayload.signedSuggestion.event.id,
      sourceAnswerEventId: admissionPayload.sourceAnswer.id,
    };
    if (Object.values(journalBinding).some((value) => typeof value !== "string") ||
      receipt.rootEventId !== journalBinding.rootEventId || receipt.topicId !== journalBinding.topicId ||
      receipt.candidateId !== journalBinding.candidateId || receipt.candidateEventId !== journalBinding.candidateEventId ||
      receipt.sourceAnswerEventId !== journalBinding.sourceAnswerEventId) fail("atomic_admission_unit_corrupt");
    const claim = db.prepare("SELECT root_event_id,candidate_event_id,case_id FROM atomic_root_claims WHERE municipality_id=? AND case_id=?")
      .get(config.municipalityId, meta.case_id) as { root_event_id: string; candidate_event_id: string; case_id: string } | undefined;
    if (!claim || claim.case_id !== meta.case_id || receipt.caseId !== meta.case_id || receipt.caseVersion !== 3 ||
      receipt.rootEventId !== claim.root_event_id || receipt.candidateEventId !== claim.candidate_event_id ||
      receipt.caseEventIds.length !== 3 || receipt.caseEventIds.some((eventId, index) => events[index]?.eventId !== eventId) ||
      receipt.journalHeadChecksum !== events[2]?.eventChecksum || receipt.admissionEventChecksum !== events[2]?.eventChecksum) {
      fail("atomic_admission_unit_corrupt");
    }
    const initialKey = `roebel:admit-signed-topic-suggestion:${claim.candidate_event_id}`;
    const initial = idempotency.find((entry) => entry.idempotency_key === initialKey);
    if (!initial || typeof initial.fingerprint !== "string" || initial.fingerprint.length < 1) fail("atomic_admission_unit_corrupt");
    const initialReceipt = commandReceipt(parseJson(initial.receipt_json, "atomic_admission_unit_corrupt"));
    if (initialReceipt.caseVersion !== 3 || initialReceipt.journalHeadChecksum !== receipt.journalHeadChecksum ||
      initialReceipt.eventIds.length !== 3 || initialReceipt.eventIds.some((eventId, index) => eventId !== receipt.caseEventIds[index])) {
      fail("atomic_admission_unit_corrupt");
    }
    const outbox = db.prepare("SELECT receipt_json,receipt_checksum FROM atomic_binding_outbox WHERE case_id=?").get(meta.case_id) as { receipt_json: string; receipt_checksum: string } | undefined;
    if (!outbox || outbox.receipt_checksum !== receipt.receiptChecksum ||
      JSON.stringify(responseReceipt({ receipt_json: outbox.receipt_json })) !== JSON.stringify(receipt)) fail("atomic_admission_unit_corrupt");
    const parsedCaseId = parseMunicipalCaseId(meta.case_id);
    const uuidV7 = parsedCaseId?.municipalityId === config.municipalityId ? parsedCaseId.uuidV7 : "";
    if (!UUID_V7.test(uuidV7) || meta.namespace !== caseNamespace(uuidV7)) fail("atomic_admission_unit_corrupt");
    // Constructor recovery replays the entire journal with the exact pinned
    // policy, actor registry, signer registry, and options fingerprint.
    // Thus syntactically valid but semantically forged event payloads fail at
    // startup before either the outbox or an admission is usable.
    try {
      pinnedCoordinator(meta.case_id, uuidV7, Object.freeze({
        namespace: meta.namespace,
        recover: readRecovery,
        appendAtomic() { fail("atomic_admission_readonly_replay"); },
        close() {},
        deleteExactSynthetic() { fail("atomic_admission_delete_forbidden"); },
      }));
    } catch { fail("atomic_admission_unit_corrupt"); }
    return receipt;
  };

  const validateDatabase = (): void => {
    const integrity = db.prepare("PRAGMA quick_check").get() as { quick_check?: string } | undefined;
    const municipalityRows = db.prepare("SELECT municipality_id FROM atomic_municipality_meta ORDER BY municipality_id")
      .all() as Array<{ municipality_id: string }>;
    if (integrity?.quick_check !== "ok" || municipalityRows.length !== 1 ||
      municipalityRows[0]?.municipality_id !== config.municipalityId) fail("atomic_admission_unit_corrupt");
    const metaRows = db.prepare("SELECT case_id,municipality_id,namespace,options_fingerprint,case_version,head_checksum FROM atomic_case_meta ORDER BY case_id").all() as CaseMetaRow[];
    const sets = [
      db.prepare("SELECT case_id FROM atomic_root_claims ORDER BY case_id").all() as Array<{ case_id: string }>,
      db.prepare("SELECT case_id FROM atomic_binding_receipts ORDER BY case_id").all() as Array<{ case_id: string }>,
      db.prepare("SELECT case_id FROM atomic_binding_outbox ORDER BY case_id").all() as Array<{ case_id: string }>,
      db.prepare("SELECT DISTINCT case_id FROM atomic_case_events ORDER BY case_id").all() as Array<{ case_id: string }>,
      db.prepare("SELECT DISTINCT case_id FROM atomic_case_idempotency ORDER BY case_id").all() as Array<{ case_id: string }>,
    ];
    const ids = metaRows.map((row) => row.case_id);
    if (new Set(ids).size !== ids.length || sets.some((rows) => rows.length !== ids.length || rows.some((row, index) => row.case_id !== ids[index]))) {
      fail("atomic_admission_unit_corrupt");
    }
    for (const meta of metaRows) validateCaseUnit(meta);
  };

  const assertRecoveryEvidenceDominated = (baselineValue: CaseStateRecoveryEvidenceV1): void => {
    let baseline: CaseStateRecoveryEvidenceV1;
    try { baseline = verifyCaseStateRecoveryEvidence(baselineValue); }
    catch { fail("atomic_admission_recovery_database_below_baseline"); }
    const caseJournalHeads = baseline.orderedHeads.map((head) => {
      const current = db.prepare("SELECT case_version FROM atomic_case_meta WHERE case_id=?").get(head.caseId) as { case_version?: number } | undefined;
      const baselineEvent = db.prepare("SELECT event_checksum FROM atomic_case_events WHERE case_id=? AND case_version=?")
        .get(head.caseId, head.caseVersion) as { event_checksum?: string } | undefined;
      if (!current || !Number.isSafeInteger(current.case_version) || (current.case_version as number) < head.caseVersion ||
        baselineEvent?.event_checksum !== head.journalHeadChecksum) {
        fail("atomic_admission_recovery_database_below_baseline");
      }
      return head;
    });
    const outboxEntries = baseline.orderedBindingEvidence.map((binding) => {
      const row = db.prepare("SELECT case_id,receipt_json,receipt_checksum FROM atomic_binding_outbox WHERE sequence=?")
        .get(binding.sequence) as { case_id?: string; receipt_json?: string; receipt_checksum?: string } | undefined;
      if (!row || row.case_id !== binding.caseId || row.receipt_checksum !== binding.receiptChecksum || typeof row.receipt_json !== "string") {
        fail("atomic_admission_recovery_database_below_baseline");
      }
      let receipt: PublicCaseBindingReceiptV1;
      try { receipt = verifyPublicCaseBindingReceipt(parseJson(row.receipt_json, "atomic_admission_recovery_database_below_baseline")); }
      catch { fail("atomic_admission_recovery_database_below_baseline"); }
      if (receipt.caseId !== binding.caseId || receipt.rootEventId !== binding.rootEventId || receipt.receiptChecksum !== binding.receiptChecksum) {
        fail("atomic_admission_recovery_database_below_baseline");
      }
      return Object.freeze({ sequence: binding.sequence, receipt });
    });
    let rebuilt: CaseStateRecoveryEvidenceV1;
    try { rebuilt = createCaseStateRecoveryEvidence({ caseJournalHeads, outboxEntries }); }
    catch { fail("atomic_admission_recovery_database_below_baseline"); }
    if (canonicalJson(rebuilt) !== canonicalJson(baseline)) fail("atomic_admission_recovery_database_below_baseline");
  };

  const readCaseCount = (): number => {
    const row = db.prepare("SELECT COUNT(*) AS case_count FROM atomic_case_meta").get() as { case_count?: number } | undefined;
    if (!row || !Number.isSafeInteger(row.case_count) || (row.case_count as number) < 0) fail("atomic_admission_unit_corrupt");
    return row.case_count as number;
  };

  try {
    withReadSnapshot(() => {
      validateDatabase();
      if (recoveryBaseline) assertRecoveryEvidenceDominated(recoveryBaseline);
      if (config.durableState && readCaseCount() > CASE_STATE_RECOVERY_MAX_CASES) {
        fail("atomic_admission_capacity_exhausted");
      }
    });
  }
  catch (error) { db.close(); closed = true; durableOwner?.release(); throw error; }

  if (bootstrapReceiptForTransition) {
    try {
      if (!config.durableState || !activeDeploymentClaim ||
        !sameCaseDurableDeploymentClaim(activeDeploymentClaim, bootstrapReceiptForTransition.deploymentClaim)) {
        fail("atomic_admission_epoch_state_invalid");
      }
      validateDatabase();
      const integrityRows = db.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check?: string }>;
      if (integrityRows.length !== 1 || integrityRows[0]?.integrity_check !== "ok") fail("atomic_admission_seal_integrity_invalid");
      const baselineEvidence = captureCaseStateRecoveryEvidence(db);
      const walCheckpoint = truncateWalCheckpoint(db);
      db.close();
      closed = true;
      for (const suffix of ["-wal", "-shm"] as const) {
        const sidecar = `${databasePath}${suffix}`;
        ensureNotSymlink(sidecar);
        if (existsSync(sidecar) && statSync(sidecar).size !== 0) fail("atomic_admission_seal_sidecar_nonempty");
      }
      ensureNotSymlink(databasePath);
      const databaseStat = statSync(databasePath);
      if (!databaseStat.isFile() || databaseStat.size < 1) fail("atomic_admission_seal_database_invalid");
      const unsignedBaselineSeal = {
        schemaVersion: "case_shutdown_seal_v2" as const,
        municipalityId: config.municipalityId,
        databaseSchemaVersion: SCHEMA_VERSION,
        configFingerprint,
        sourceReleaseDigest: config.durableState.sourceReleaseDigest,
        deploymentClaimChecksum: activeDeploymentClaim.claimChecksum,
        databaseBasename,
        databaseByteLength: databaseStat.size,
        databaseSha256: sha256File(databasePath),
        closedAtUtc: new Date().toISOString(),
        walCheckpoint,
        recoveryEvidence: baselineEvidence,
      };
      const baselineSeal = verifyCaseShutdownSeal({
        ...unsignedBaselineSeal,
        sealChecksum: checksum(unsignedBaselineSeal),
      });
      writeCanonicalCaseOpenEpoch(config.rootDir, createCaseOpenEpoch({
        municipalityId: config.municipalityId,
        deploymentClaim: activeDeploymentClaim,
        configFingerprint,
        databaseBasename,
        baselineShutdownSeal: baselineSeal,
      }));
      removeCanonicalCaseStoreBootstrap(config.rootDir);
      const identity = requireExistingRecoveryDatabase(databasePath);
      db = openMunicipalDatabase(identity, false);
      closed = false;
      recoveryBaseline = baselineEvidence;
      withReadSnapshot(() => {
        validateDatabase();
        assertRecoveryEvidenceDominated(baselineEvidence);
      });
    } catch (error) {
      if (!closed) { db.close(); closed = true; }
      durableOwner?.release();
      throw error;
    }
  }

  const admit = async (callerInput: AtomicTopicCaseAdmissionV1): Promise<PublicCaseBindingReceiptV1> => {
    ensureOpen();
    const raw = ownKeys(callerInput, ["actorBinding", "caseId", "expectedCaseVersion", "idempotencyKey", "municipalityId", "policyVersion", "rootEventId", "schemaVersion", "sourceDiscussion", "verifiedAdmission"], "atomic_admission_input_invalid");
    const authenticatedActor = actor(raw.actorBinding, "atomic_admission_input_invalid");
    if (raw.schemaVersion !== "atomic_topic_case_admission_v1" || raw.municipalityId !== config.municipalityId || raw.policyVersion !== config.policyVersion || raw.expectedCaseVersion !== 0 ||
      !registryHas(config.actorRegistry, authenticatedActor)) fail("atomic_admission_input_invalid");
    const supplied = raw.verifiedAdmission as VerifiedTopicCaseAdmissionV1;
    let verified: VerifiedTopicCaseAdmissionV1;
    try {
      verified = verifyTopicCaseAdmission({
        sourceDiscussion: raw.sourceDiscussion as AtomicTopicCaseAdmissionV1["sourceDiscussion"],
        sourceAnswer: supplied?.sourceAnswer,
        signedSuggestion: supplied?.signedSuggestion,
        allowedAgentPubkeys: [...config.allowedAgentPubkeys],
      });
    } catch { fail("atomic_admission_artifact_invalid"); }
    if (!config.allowedSignerPubkeys.includes(verified.signedSuggestion.signerPubkey) ||
      raw.rootEventId !== verified.discussion.id || raw.caseId !== verified.identity.caseId ||
      verified.identity.municipalityId !== config.municipalityId ||
      raw.idempotencyKey !== `roebel:admit-signed-topic-suggestion:${verified.signedSuggestion.event.id}`) fail("atomic_admission_binding_invalid");
    const namespace = caseNamespace(verified.identity.caseUuidV7);
    let pending: { verified: VerifiedTopicCaseAdmissionV1; rootEventId: string; caseId: string } | null = {
      verified, rootEventId: verified.discussion.id, caseId: verified.identity.caseId,
    };
    const journal: CoordinatorJournalPort = {
      namespace,
      recover: readRecovery,
      appendAtomic(append: CoordinatorJournalAppend) {
        if (!pending || append.namespace !== namespace || append.caseId !== pending.caseId || append.expectedCaseVersion !== 0 ||
          append.idempotencyKey !== `roebel:admit-signed-topic-suggestion:${pending.verified.signedSuggestion.event.id}` ||
          append.events.length !== 3 || append.receipt.caseVersion !== 3 || append.receipt.eventIds.length !== 3) fail("atomic_admission_append_invalid");
        initialAdmissionAppend(append, pending.caseId);
        db.exec("BEGIN IMMEDIATE");
        try {
          rejectLegacyDurableCaseRecords(db);
          const claim = db.prepare("SELECT candidate_event_id,case_id FROM atomic_root_claims WHERE municipality_id=? AND root_event_id=?").get(config.municipalityId, pending.rootEventId) as { candidate_event_id: string; case_id: string } | undefined;
          if (claim && (claim.candidate_event_id !== pending.verified.signedSuggestion.event.id || claim.case_id !== pending.caseId)) fail("case_binding_root_conflict");
          const meta = db.prepare("SELECT case_id,municipality_id,namespace,options_fingerprint,case_version,head_checksum FROM atomic_case_meta WHERE case_id=?").get(pending.caseId) as CaseMetaRow | undefined;
          if (meta) {
            if (meta.namespace !== namespace || meta.options_fingerprint !== append.optionsFingerprint) fail("atomic_admission_journal_corrupt");
            const receipt = validateCaseUnit(meta);
            if (receipt.candidateEventId !== pending.verified.signedSuggestion.event.id) fail("case_binding_root_conflict");
            db.exec("COMMIT");
            return { status: "duplicate" as const, receipt: { caseVersion: receipt.caseVersion, eventIds: [...receipt.caseEventIds], journalHeadChecksum: receipt.journalHeadChecksum } };
          }
          // This is an explicit staging storage-safety limit, not a civic
          // eligibility decision. Reject before the first Case row so every
          // successfully committed durable store remains sealable.
          if (config.durableState && readCaseCount() >= CASE_STATE_RECOVERY_MAX_CASES) {
            fail("atomic_admission_capacity_exhausted");
          }
          db.prepare("INSERT INTO atomic_case_meta(case_id,municipality_id,namespace,options_fingerprint,case_version,head_checksum) VALUES(?,?,?,?,?,?)")
            .run(pending.caseId, config.municipalityId, namespace, append.optionsFingerprint, 0, genesisChecksum(pending.caseId));
          db.prepare("INSERT INTO atomic_root_claims(municipality_id,root_event_id,candidate_event_id,case_id) VALUES(?,?,?,?)")
            .run(config.municipalityId, pending.rootEventId, pending.verified.signedSuggestion.event.id, pending.caseId);
          if (config.failpoint === "after_root_claim") fail("atomic_admission_failpoint");
          const insertEvent = db.prepare("INSERT INTO atomic_case_events(case_id,case_version,event_id,event_type,prior_event_checksum,actor_json,payload_json,payload_checksum,correction_of,event_checksum) VALUES(?,?,?,?,?,?,?,?,?,?)");
          for (const event of append.events) insertEvent.run(pending.caseId, event.caseVersion, event.eventId, event.eventType, event.priorEventChecksum, canonicalJson(event.actorBinding), canonicalJson(event.payload), event.payloadChecksum, event.correctionOf, event.eventChecksum);
          db.prepare("INSERT INTO atomic_case_idempotency(case_id,idempotency_key,fingerprint,receipt_json) VALUES(?,?,?,?)")
            .run(pending.caseId, append.idempotencyKey, append.fingerprint, JSON.stringify(append.receipt));
          db.prepare("UPDATE atomic_case_meta SET case_version=?,head_checksum=? WHERE case_id=?").run(append.receipt.caseVersion, append.receipt.journalHeadChecksum, pending.caseId);
          if (config.failpoint === "after_case_events") fail("atomic_admission_failpoint");
          const receipt = createPublicCaseBindingReceipt({
            rootEventId: pending.rootEventId, topicId: pending.verified.identity.topicId,
            candidateId: pending.verified.signedSuggestion.candidateId, candidateEventId: pending.verified.signedSuggestion.event.id,
            sourceAnswerEventId: pending.verified.sourceAnswer.id, caseId: pending.caseId, caseVersion: 3,
            caseEventIds: [append.receipt.eventIds[0]!, append.receipt.eventIds[1]!, append.receipt.eventIds[2]!],
            journalHeadChecksum: append.receipt.journalHeadChecksum, admissionEventChecksum: append.receipt.journalHeadChecksum,
          });
          const receiptJson = JSON.stringify(receipt);
          db.prepare("INSERT INTO atomic_binding_receipts(case_id,municipality_id,root_event_id,receipt_json) VALUES(?,?,?,?)").run(pending.caseId, config.municipalityId, pending.rootEventId, receiptJson);
          db.prepare("INSERT INTO atomic_binding_outbox(case_id,receipt_json,receipt_checksum) VALUES(?,?,?)").run(pending.caseId, receiptJson, receipt.receiptChecksum);
          if (config.failpoint === "after_binding_receipt") fail("atomic_admission_failpoint");
          db.exec("COMMIT");
          return { status: "appended" as const, receipt: clone(append.receipt) };
        } catch (error) { try { db.exec("ROLLBACK"); } catch { /* best effort */ } throw error; }
      },
      close() { /* The owning adapter closes the municipal DB. */ },
      deleteExactSynthetic() { fail("atomic_admission_delete_forbidden"); },
    };
    try {
      const coordinator = createCivicCaseCoordinator({
        jurisdictionValue: config.municipalityId, uuidV7: verified.identity.caseUuidV7, canonicalCaseId: verified.identity.caseId,
        policyVersion: config.policyVersion, syntheticFixtureOnly: true, requireSignedSuggestionAdmission: true,
        allowedSignerPubkeys: [...config.allowedSignerPubkeys], allowedAgentPubkeys: [...config.allowedAgentPubkeys],
        actors: config.actorRegistry, requiredDepartmentIds: config.requiredDepartmentIds, journalPort: journal, journalNamespace: namespace,
      });
      coordinator.handle({
        schemaVersion: "command_envelope_v1", commandType: "admit_signed_topic_suggestion_v1", caseId: verified.identity.caseId,
        actorBinding: authenticatedActor, expectedCaseVersion: 0,
        idempotencyKey: `roebel:admit-signed-topic-suggestion:${verified.signedSuggestion.event.id}`,
        visibility: "private_case", policyVersion: config.policyVersion,
        payload: { sourceDiscussion: raw.sourceDiscussion as AtomicTopicCaseAdmissionV1["sourceDiscussion"], sourceAnswer: verified.sourceAnswer, signedSuggestion: verified.signedSuggestion },
      });
      const result = withReadSnapshot(() => {
        const meta = readCaseMeta(verified.identity.caseId);
        if (!meta) fail("atomic_admission_unit_corrupt");
        const receipt = validateCaseUnit(meta);
        if (receipt.rootEventId !== verified.discussion.id || receipt.topicId !== verified.identity.topicId ||
          receipt.candidateId !== verified.signedSuggestion.candidateId ||
          receipt.candidateEventId !== verified.signedSuggestion.event.id ||
          receipt.sourceAnswerEventId !== verified.sourceAnswer.id) fail("case_binding_root_conflict");
        return receipt;
      });
      return clone(result);
    } finally { pending = null; }
  };

  const continuationJournal = (caseId: string, namespace: string): CoordinatorJournalPort => Object.freeze({
    namespace,
    recover: readRecovery,
    appendAtomic(append: CoordinatorJournalAppend) {
      ensureOpen();
      if (append.namespace !== namespace || append.caseId !== caseId) fail("atomic_admission_append_invalid");
      db.exec("BEGIN IMMEDIATE");
      try {
        const meta = readCaseMeta(caseId);
        if (!meta || meta.namespace !== namespace) fail("atomic_admission_case_not_admitted");
        validateCaseUnit(meta);
        if (meta.options_fingerprint !== append.optionsFingerprint) fail("atomic_admission_journal_corrupt");
        const prior = db.prepare("SELECT fingerprint,receipt_json FROM atomic_case_idempotency WHERE case_id=? AND idempotency_key=?")
          .get(caseId, append.idempotencyKey) as { fingerprint: string; receipt_json: string } | undefined;
        if (prior) {
          if (prior.fingerprint !== append.fingerprint) fail("idempotency_conflict");
          const receipt = commandReceipt(parseJson(prior.receipt_json, "atomic_admission_unit_corrupt"));
          db.exec("COMMIT");
          return { status: "duplicate" as const, receipt };
        }
        if (meta.case_version !== append.expectedCaseVersion) {
          fail("case_version_conflict");
        }
        validateAppendChain(append, caseId, meta.case_version, meta.head_checksum);
        const insertEvent = db.prepare("INSERT INTO atomic_case_events(case_id,case_version,event_id,event_type,prior_event_checksum,actor_json,payload_json,payload_checksum,correction_of,event_checksum) VALUES(?,?,?,?,?,?,?,?,?,?)");
        for (const event of append.events) {
          if (!registryHas(config.actorRegistry, actor(event.actorBinding, "atomic_admission_append_invalid", true))) fail("atomic_admission_append_invalid");
          insertEvent.run(caseId, event.caseVersion, event.eventId, event.eventType, event.priorEventChecksum, canonicalJson(event.actorBinding), canonicalJson(event.payload), event.payloadChecksum, event.correctionOf, event.eventChecksum);
        }
        db.prepare("INSERT INTO atomic_case_idempotency(case_id,idempotency_key,fingerprint,receipt_json) VALUES(?,?,?,?)")
          .run(caseId, append.idempotencyKey, append.fingerprint, JSON.stringify(append.receipt));
        db.prepare("UPDATE atomic_case_meta SET case_version=?,head_checksum=? WHERE case_id=?")
          .run(append.receipt.caseVersion, append.receipt.journalHeadChecksum, caseId);
        db.exec("COMMIT");
        return { status: "appended" as const, receipt: clone(append.receipt) };
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch { /* best effort */ }
        throw error;
      }
    },
    close() { /* owned municipal connection */ },
    deleteExactSynthetic() { fail("atomic_admission_delete_forbidden"); },
  });

  const openCaseCoordinator = (caseId: string): CivicCaseCoordinator => {
    ensureOpen();
    const parsedCaseId = parseMunicipalCaseId(caseId);
    if (!parsedCaseId || parsedCaseId.municipalityId !== config.municipalityId) fail("atomic_admission_case_not_admitted");
    return withReadSnapshot(() => {
      const meta = readCaseMeta(caseId);
      if (!meta) fail("atomic_admission_case_not_admitted");
      validateCaseUnit(meta);
      const uuidV7 = parsedCaseId.uuidV7;
      if (!UUID_V7.test(uuidV7) || meta.namespace !== caseNamespace(uuidV7)) fail("atomic_admission_unit_corrupt");
      return pinnedCoordinator(caseId, uuidV7, continuationJournal(caseId, meta.namespace));
    });
  };

  const outbox: SynchronousCredentialFreeCaseBindingOutboxReader = Object.freeze({
    replay(inputValue = {}) {
      ensureOpen();
      const parsed = allowedKeys(inputValue, ["afterSequence", "limit"], "atomic_admission_outbox_request_invalid");
      const afterSequence: number = parsed.afterSequence === undefined ? 0 : typeof parsed.afterSequence === "number" ? parsed.afterSequence : Number.NaN;
      const limit: number = parsed.limit === undefined ? 100 : typeof parsed.limit === "number" ? parsed.limit : Number.NaN;
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) fail("atomic_admission_outbox_request_invalid");
      return withReadSnapshot(() => {
        // The validation and page read share one SQLite snapshot, so a reader
        // cannot emit a receipt from a different cross-table state.
        validateDatabase();
        const rows = db.prepare("SELECT sequence,receipt_json,receipt_checksum FROM atomic_binding_outbox WHERE sequence>? ORDER BY sequence LIMIT ?").all(afterSequence, limit) as Array<{ sequence: number; receipt_json: string; receipt_checksum: string }>;
        return Object.freeze(rows.map((row) => {
          if (!Number.isSafeInteger(row.sequence) || row.sequence < 1 || !SHA256.test(row.receipt_checksum)) fail("atomic_admission_outbox_corrupt");
          const receipt = verifyPublicCaseBindingReceipt(parseJson(row.receipt_json, "atomic_admission_outbox_corrupt"));
          if (receipt.receiptChecksum !== row.receipt_checksum) fail("atomic_admission_outbox_corrupt");
          return Object.freeze({ sequence: row.sequence, receipt: clone(receipt) });
        }));
      });
    },
  });

  const sealAndClose = (): CaseShutdownSealV2 => {
    if (!config.durableState) fail("atomic_admission_seal_unavailable");
    if (shutdownSeal) return shutdownSeal;
    ensureOpen();
    const assertDeploymentClaimUnchanged = (): string | null => {
      const current = readCanonicalCaseDurableDeploymentClaim(config.rootDir);
      if ((activeDeploymentClaim === undefined) !== (current === undefined) ||
        (activeDeploymentClaim && current && !sameCaseDurableDeploymentClaim(activeDeploymentClaim, current))) {
        fail("atomic_admission_deployment_claim_mismatch");
      }
      return activeDeploymentClaim?.claimChecksum ?? null;
    };
    // Do every verification before the checkpoint and before touching the
    // previous seal.  A failed check leaves the live owner lock in place so a
    // human can inspect or explicitly invoke close() for emergency cleanup.
    let recoveryEvidence: CaseStateRecoveryEvidenceV1 | undefined;
    let walCheckpoint: Readonly<{ mode: "TRUNCATE"; busy: number; log: number; checkpointed: number }> | undefined;
    try {
      assertDeploymentClaimUnchanged();
      validateDatabase();
      const integrityRows = db.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check?: string }>;
      if (integrityRows.length !== 1 || integrityRows[0]?.integrity_check !== "ok") fail("atomic_admission_seal_integrity_invalid");

      recoveryEvidence = captureCaseStateRecoveryEvidence(db);
      walCheckpoint = truncateWalCheckpoint(db);
    } catch (error) {
      // The municipal DB and the durable owner transaction intentionally stay
      // open.  Do not create, replace, or release a successful seal on any
      // failed verification/checkpoint path.
      throw error;
    }

    // From here the database is closed but the owner lock remains live until
    // the canonical, fsync'd seal is present.  close() can still release it if
    // the post-close filesystem proof fails.
    db.close();
    closed = true;
    try {
      if (!recoveryEvidence || !walCheckpoint) fail("atomic_admission_seal_integrity_invalid");
      for (const suffix of ["-wal", "-shm"] as const) {
        const sidecar = `${databasePath}${suffix}`;
        ensureNotSymlink(sidecar);
        if (existsSync(sidecar) && statSync(sidecar).size !== 0) fail("atomic_admission_seal_sidecar_nonempty");
      }
      ensureNotSymlink(databasePath);
      const dbStat = statSync(databasePath);
      if (!dbStat.isFile() || dbStat.size < 1) fail("atomic_admission_seal_database_invalid");
      const deploymentClaimChecksum = assertDeploymentClaimUnchanged();
      const unsigned = {
        schemaVersion: "case_shutdown_seal_v2" as const,
        municipalityId: config.municipalityId,
        databaseSchemaVersion: SCHEMA_VERSION,
        configFingerprint,
        sourceReleaseDigest: config.durableState.sourceReleaseDigest,
        deploymentClaimChecksum,
        databaseBasename: `stadtstack-${config.municipalityId}-atomic-admission.sqlite`,
        databaseByteLength: dbStat.size,
        databaseSha256: sha256File(databasePath),
        closedAtUtc: new Date().toISOString(),
        walCheckpoint,
        recoveryEvidence,
      };
      const seal = verifyCaseShutdownSeal({ ...unsigned, sealChecksum: checksum(unsigned) });
      writeCanonicalSeal(config.rootDir, seal);
      // A fresh, fsync'd clean-shutdown seal supersedes the one-time recovery
      // activation receipt.  Never silently retain a marker after a normal
      // close; if cleanup fails, keep the owner lock and fail closed.
      removeRecoveryActivationMarker(config.rootDir);
      removeCanonicalCaseOpenEpoch(config.rootDir);
      shutdownSeal = seal;
      durableOwner?.release();
      return seal;
    } catch (error) {
      // Deliberately retain the live lock.  The closed DB cannot be silently
      // reopened or resealed after an incomplete durability proof.
      throw error;
    }
  };
  return Object.freeze({
    admission: Object.freeze({ admit }),
    outbox,
    caseCoordinators: Object.freeze({ open: openCaseCoordinator }),
    sealAndClose,
    close() {
      if (!closed) { db.close(); closed = true; }
      durableOwner?.release();
    },
  });
}
