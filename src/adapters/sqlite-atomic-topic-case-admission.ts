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

const SCHEMA_VERSION = "sqlite_atomic_topic_case_admission_v1";
const MUNICIPALITY_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const HEX64 = /^[0-9a-f]{64}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const NAMESPACE = /^case-[0-9a-f]{32}$/u;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** The fixed, basename-only seal written by a clean durable-owner shutdown. */
export const CASE_SHUTDOWN_SEAL_FILENAME = "case-shutdown-seal-v1.json";
const CASE_STATE_OWNER_DATABASE_FILENAME = "stadtstack-case-state-owner.sqlite";
const CASE_STATE_OWNER_SCHEMA = "CREATE TABLE durable_store_binding(singleton INTEGER NOT NULL PRIMARY KEY CHECK(singleton=1),municipality_id TEXT NOT NULL) STRICT";

export type DurableSingleWriterState = Readonly<{
  mode: "durable_single_writer";
  sourceReleaseDigest: string;
}>;

export type CaseShutdownSealV1 = Readonly<{
  schemaVersion: "case_shutdown_seal_v1";
  municipalityId: string;
  databaseSchemaVersion: typeof SCHEMA_VERSION;
  configFingerprint: string;
  sourceReleaseDigest: string;
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
};

export type SqliteAtomicTopicCaseAdmission = {
  admission: AtomicCaseAdmissionPort;
  outbox: SynchronousCredentialFreeCaseBindingOutboxReader;
  /** Private composition-root seam.  It never creates Cases: only an already
   * atomically admitted Case can be reopened with its pinned journal/config. */
  caseCoordinators: Readonly<{ open(caseId: string): CivicCaseCoordinator }>;
  /** A legacy tmp-only adapter has no durable state to seal and rejects this
   * call with `atomic_admission_seal_unavailable`. */
  sealAndClose(): CaseShutdownSealV1;
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

function validateOptions(input: SqliteAtomicTopicCaseAdmissionOptions): Required<Omit<SqliteAtomicTopicCaseAdmissionOptions, "failpoint" | "requiredDepartmentIds" | "durableState">> & Pick<SqliteAtomicTopicCaseAdmissionOptions, "failpoint" | "requiredDepartmentIds" | "durableState"> {
  const parsed = allowedKeys(input, ["actorRegistry", "allowedAgentPubkeys", "allowedSignerPubkeys", "durableState", "failpoint", "municipalityId", "policyVersion", "requiredDepartmentIds", "rootDir"], "atomic_admission_options_invalid");
  if (typeof parsed.municipalityId !== "string" || !MUNICIPALITY_ID.test(parsed.municipalityId) ||
    typeof parsed.policyVersion !== "string" || !/^[A-Za-z0-9:._-]{1,256}$/u.test(parsed.policyVersion) ||
    (parsed.failpoint !== undefined && parsed.failpoint !== "after_root_claim" && parsed.failpoint !== "after_case_events" && parsed.failpoint !== "after_binding_receipt")) fail("atomic_admission_options_invalid");
  const resolvedDurableState = durableState(parsed.durableState, "atomic_admission_options_invalid");
  return Object.freeze({
    rootDir: resolvedDurableState ? safeDurableRoot(parsed.rootDir as string) : safeRoot(parsed.rootDir as string), municipalityId: parsed.municipalityId,
    policyVersion: parsed.policyVersion, actorRegistry: actorRegistry(parsed.actorRegistry, "atomic_admission_options_invalid"),
    allowedSignerPubkeys: frozenStringSet(parsed.allowedSignerPubkeys, "atomic_admission_options_invalid"),
    allowedAgentPubkeys: frozenStringSet(parsed.allowedAgentPubkeys, "atomic_admission_options_invalid"),
    requiredDepartmentIds: requiredDepartments(parsed.requiredDepartmentIds, "atomic_admission_options_invalid"),
    failpoint: parsed.failpoint as SqliteAtomicTopicCaseAdmissionOptions["failpoint"],
    durableState: resolvedDurableState,
  });
}

/** Stable basename helper: seals contain only this name, never a host path. */
export function caseShutdownSealFilename(): typeof CASE_SHUTDOWN_SEAL_FILENAME { return CASE_SHUTDOWN_SEAL_FILENAME; }

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

/** Strict, canonical verifier for a durable owner shutdown receipt.  It is
 * intentionally a narrow public API: callers can validate archive material
 * without gaining any database-opening capability. */
export function verifyCaseShutdownSeal(value: unknown): CaseShutdownSealV1 {
  const parsed = ownKeys(value, [
    "closedAtUtc", "configFingerprint", "databaseBasename", "databaseByteLength", "databaseSchemaVersion",
    "databaseSha256", "municipalityId", "recoveryEvidence", "schemaVersion", "sealChecksum", "sourceReleaseDigest", "walCheckpoint",
  ], "atomic_admission_seal_invalid");
  if (parsed.schemaVersion !== "case_shutdown_seal_v1" || typeof parsed.municipalityId !== "string" || !MUNICIPALITY_ID.test(parsed.municipalityId) ||
    parsed.databaseSchemaVersion !== SCHEMA_VERSION || typeof parsed.configFingerprint !== "string" || !SHA256.test(parsed.configFingerprint) ||
    typeof parsed.sourceReleaseDigest !== "string" || !SHA256.test(parsed.sourceReleaseDigest) ||
    parsed.databaseBasename !== `stadtstack-${parsed.municipalityId}-atomic-admission.sqlite` ||
    typeof parsed.databaseByteLength !== "number" || !Number.isSafeInteger(parsed.databaseByteLength) || parsed.databaseByteLength < 1 ||
    typeof parsed.databaseSha256 !== "string" || !SHA256.test(parsed.databaseSha256) ||
    typeof parsed.sealChecksum !== "string" || !SHA256.test(parsed.sealChecksum)) fail("atomic_admission_seal_invalid");
  requireUtcTimestamp(parsed.closedAtUtc, "atomic_admission_seal_invalid");
  const walCheckpoint = ownKeys(parsed.walCheckpoint, ["busy", "checkpointed", "log", "mode"], "atomic_admission_seal_invalid");
  if (walCheckpoint.mode !== "TRUNCATE" || !Number.isSafeInteger(walCheckpoint.busy) || !Number.isSafeInteger(walCheckpoint.log) ||
    !Number.isSafeInteger(walCheckpoint.checkpointed) || walCheckpoint.busy !== 0 || walCheckpoint.log < 0 ||
    walCheckpoint.checkpointed < 0 || walCheckpoint.log !== walCheckpoint.checkpointed) {
    fail("atomic_admission_seal_invalid");
  }
  const recoveryEvidence = verifyCaseStateRecoveryEvidence(parsed.recoveryEvidence);
  const municipalityCasePrefix = `urn:stadtstack:case:test:${parsed.municipalityId}:`;
  if (recoveryEvidence.orderedHeads.some((head) => !head.caseId.startsWith(municipalityCasePrefix))) {
    fail("atomic_admission_seal_invalid");
  }
  const { sealChecksum, ...withoutChecksum } = parsed;
  if (checksum(withoutChecksum) !== sealChecksum) fail("atomic_admission_seal_invalid");
  return deepFreeze({
    schemaVersion: "case_shutdown_seal_v1" as const,
    municipalityId: parsed.municipalityId,
    databaseSchemaVersion: SCHEMA_VERSION,
    configFingerprint: parsed.configFingerprint,
    sourceReleaseDigest: parsed.sourceReleaseDigest,
    databaseBasename: parsed.databaseBasename,
    databaseByteLength: parsed.databaseByteLength,
    databaseSha256: parsed.databaseSha256,
    closedAtUtc: parsed.closedAtUtc,
    walCheckpoint: Object.freeze({
      mode: "TRUNCATE" as const,
      busy: walCheckpoint.busy as number,
      log: walCheckpoint.log as number,
      checkpointed: walCheckpoint.checkpointed as number,
    }),
    recoveryEvidence,
    sealChecksum,
  });
}

function writeCanonicalSeal(rootDir: string, seal: CaseShutdownSealV1): void {
  const target = join(rootDir, CASE_SHUTDOWN_SEAL_FILENAME);
  ensureNotSymlink(target);
  const temporary = join(rootDir, `.${CASE_SHUTDOWN_SEAL_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    const bytes = Buffer.from(`${canonicalJson(seal)}\n`, "utf8");
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset);
    fsyncSync(descriptor);
    closeSync(descriptor); descriptor = undefined;
    ensureNotSymlink(target);
    renameSync(temporary, target);
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
function readCanonicalPriorSeal(rootDir: string): CaseShutdownSealV1 | undefined {
  const target = join(rootDir, CASE_SHUTDOWN_SEAL_FILENAME);
  ensureNotSymlink(target);
  if (!existsSync(target)) return undefined;
  let previous: CaseShutdownSealV1;
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
    if (priorSeal && databaseMunicipality && priorSeal.municipalityId !== databaseMunicipality) {
      fail("atomic_admission_seal_invalid");
    }
    const existingMunicipality = priorSeal?.municipalityId ?? databaseMunicipality;
    if (existingMunicipality && existingMunicipality !== municipalityId) fail("atomic_admission_store_binding_mismatch");
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

function ensureSchema(db: DatabaseSync): void {
  db.exec(`
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
  const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name);
  const expected = ["atomic_binding_outbox", "atomic_binding_receipts", "atomic_case_events", "atomic_case_idempotency", "atomic_case_meta", "atomic_municipality_meta", "atomic_root_claims"];
  if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) fail("atomic_admission_schema_invalid");
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
  const databasePath = join(config.rootDir, `stadtstack-${config.municipalityId}-atomic-admission.sqlite`);
  ensureNotSymlink(databasePath); ensureNotSymlink(`${databasePath}-wal`); ensureNotSymlink(`${databasePath}-shm`);
  // Acquire before opening the municipal database.  This ensures a second
  // durable process is rejected without observing or migrating municipal
  // state, while legacy tmp-only callers retain their multi-connection seam.
  const durableOwner = config.durableState ? acquireDurableOwnerLock(config.rootDir, config.municipalityId) : undefined;
  try { if (durableOwner) invalidatePriorSeal(config.rootDir, config.municipalityId); }
  catch (error) { durableOwner?.release(); throw error; }
  let db: DatabaseSync;
  try { db = new DatabaseSync(databasePath, { timeout: 5000, enableForeignKeyConstraints: true }); }
  catch (error) { durableOwner?.release(); throw error; }
  let closed = false;
  let shutdownSeal: CaseShutdownSealV1 | undefined;
  const configFingerprint = checksum({
    schemaVersion: SCHEMA_VERSION, municipalityId: config.municipalityId, policyVersion: config.policyVersion,
    actorRegistry: [...config.actorRegistry].sort((left, right) => `${left.actorClass}:${left.actorId}`.localeCompare(`${right.actorClass}:${right.actorId}`)),
    requiredDepartmentIds: config.requiredDepartmentIds ? [...config.requiredDepartmentIds].sort() : [],
    allowedSignerPubkeys: [...config.allowedSignerPubkeys].sort(),
    allowedAgentPubkeys: [...config.allowedAgentPubkeys].sort(),
  });
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    const pragmas = {
      journal: db.prepare("PRAGMA journal_mode").get() as { journal_mode: string },
      sync: db.prepare("PRAGMA synchronous").get() as { synchronous: number },
      foreign: db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number },
    };
    if (pragmas.journal.journal_mode.toLowerCase() !== "wal" || pragmas.sync.synchronous !== 2 || pragmas.foreign.foreign_keys !== 1) fail("atomic_admission_pragmas_invalid");
    ensureSchema(db);
    db.exec("BEGIN IMMEDIATE");
    const prior = db.prepare("SELECT schema_version,config_fingerprint FROM atomic_municipality_meta WHERE municipality_id=?").get(config.municipalityId) as { schema_version: string; config_fingerprint: string } | undefined;
    if (prior) {
      if (prior.schema_version !== SCHEMA_VERSION || prior.config_fingerprint !== configFingerprint) fail("atomic_admission_config_mismatch");
    } else {
      db.prepare("INSERT INTO atomic_municipality_meta(municipality_id,schema_version,config_fingerprint) VALUES(?,?,?)").run(config.municipalityId, SCHEMA_VERSION, configFingerprint);
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* best-effort after failed bootstrap */ }
    db.close(); durableOwner?.release(); throw error;
  }
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
    const prefix = `urn:stadtstack:case:test:${config.municipalityId}:`;
    const uuidV7 = meta.case_id.startsWith(prefix) ? meta.case_id.slice(prefix.length) : "";
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

  const readCaseCount = (): number => {
    const row = db.prepare("SELECT COUNT(*) AS case_count FROM atomic_case_meta").get() as { case_count?: number } | undefined;
    if (!row || !Number.isSafeInteger(row.case_count) || (row.case_count as number) < 0) fail("atomic_admission_unit_corrupt");
    return row.case_count as number;
  };

  try {
    withReadSnapshot(() => {
      validateDatabase();
      if (config.durableState && readCaseCount() > CASE_STATE_RECOVERY_MAX_CASES) {
        fail("atomic_admission_capacity_exhausted");
      }
    });
  }
  catch (error) { db.close(); closed = true; durableOwner?.release(); throw error; }

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
    if (typeof caseId !== "string" || !caseId.startsWith(`urn:stadtstack:case:test:${config.municipalityId}:`)) fail("atomic_admission_case_not_admitted");
    return withReadSnapshot(() => {
      const meta = readCaseMeta(caseId);
      if (!meta) fail("atomic_admission_case_not_admitted");
      validateCaseUnit(meta);
      const uuidV7 = caseId.slice(`urn:stadtstack:case:test:${config.municipalityId}:`.length);
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

  const sealAndClose = (): CaseShutdownSealV1 => {
    if (!config.durableState) fail("atomic_admission_seal_unavailable");
    if (shutdownSeal) return shutdownSeal;
    ensureOpen();
    // Do every verification before the checkpoint and before touching the
    // previous seal.  A failed check leaves the live owner lock in place so a
    // human can inspect or explicitly invoke close() for emergency cleanup.
    let recoveryEvidence: CaseStateRecoveryEvidenceV1 | undefined;
    let walCheckpoint: Readonly<{ mode: "TRUNCATE"; busy: number; log: number; checkpointed: number }> | undefined;
    try {
      validateDatabase();
      const integrityRows = db.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check?: string }>;
      if (integrityRows.length !== 1 || integrityRows[0]?.integrity_check !== "ok") fail("atomic_admission_seal_integrity_invalid");

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
      recoveryEvidence = verifyCaseStateRecoveryEvidence(createCaseStateRecoveryEvidence({ caseJournalHeads, outboxEntries }));

      const checkpoint = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as { busy?: number; log?: number; checkpointed?: number } | undefined;
      if (!checkpoint || !Number.isSafeInteger(checkpoint.busy) || !Number.isSafeInteger(checkpoint.log) ||
        !Number.isSafeInteger(checkpoint.checkpointed) || checkpoint.busy !== 0 || checkpoint.log < 0 ||
        checkpoint.checkpointed < 0 || checkpoint.log !== checkpoint.checkpointed) {
        fail("atomic_admission_seal_checkpoint_invalid");
      }
      walCheckpoint = Object.freeze({
        mode: "TRUNCATE" as const,
        busy: checkpoint.busy as number,
        log: checkpoint.log as number,
        checkpointed: checkpoint.checkpointed as number,
      });
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
      const unsigned = {
        schemaVersion: "case_shutdown_seal_v1" as const,
        municipalityId: config.municipalityId,
        databaseSchemaVersion: SCHEMA_VERSION,
        configFingerprint,
        sourceReleaseDigest: config.durableState.sourceReleaseDigest,
        databaseBasename: `stadtstack-${config.municipalityId}-atomic-admission.sqlite`,
        databaseByteLength: dbStat.size,
        databaseSha256: sha256File(databasePath),
        closedAtUtc: new Date().toISOString(),
        walCheckpoint,
        recoveryEvidence,
      };
      const seal = verifyCaseShutdownSeal({ ...unsigned, sealChecksum: checksum(unsigned) });
      writeCanonicalSeal(config.rootDir, seal);
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
