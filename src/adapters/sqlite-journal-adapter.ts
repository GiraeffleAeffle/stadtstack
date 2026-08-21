import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  CASE_EVENT_SCHEMA_VERSION,
  type ActorBinding,
  type CommandReceipt,
  type CoordinatorJournalAppend,
  type CoordinatorJournalEvent,
  type CoordinatorJournalIdempotency,
  type CoordinatorJournalPort,
  type CoordinatorJournalRecovery,
} from "../civic-case-coordinator.ts";
import { existsSync, lstatSync, realpathSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const JOURNAL_SCHEMA_VERSION = "durable_case_journal_v1";
const CHECKSUM = /^sha256:[0-9a-f]{64}$/;
const NAMESPACE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const META_COLUMNS = ["namespace", "schema_version", "case_id", "options_fingerprint", "case_version", "head_checksum"];
const EVENT_COLUMNS = [
  "namespace",
  "case_version",
  "event_id",
  "case_id",
  "event_type",
  "prior_event_checksum",
  "actor_json",
  "payload_json",
  "payload_checksum",
  "correction_of",
  "event_checksum",
];
const IDEMPOTENCY_COLUMNS = ["namespace", "idempotency_key", "fingerprint", "receipt_json", "case_version", "head_checksum"];
const EVENT_TYPES = new Set([
  "case_created_v1",
  "discussion_recorded_v1",
  "signed_suggestion_admitted_v1",
  "signed_topic_suggestion_admitted_v1",
  "department_package_assigned_v1",
  "department_draft_recorded_v1",
  "department_review_attested_v1",
  "department_draft_corrected_v1",
  "department_response_retracted_v1",
  "citizen_brief_derived_v1",
  "advisory_participation_recorded_v1",
  "advisory_participation_retracted_v1",
  "reviewed_outcome_recorded_v1",
]);

export type SqliteJournalStoreOptions = {
  rootDir: string;
  namespace: string;
};

type MetaRow = {
  namespace: string;
  schema_version: string;
  case_id: string;
  options_fingerprint: string;
  case_version: number;
  head_checksum: string;
};

type EventRow = {
  namespace: string;
  case_version: number;
  event_id: string;
  case_id: string;
  event_type: string;
  prior_event_checksum: string;
  actor_json: string;
  payload_json: string;
  payload_checksum: string;
  correction_of: string | null;
  event_checksum: string;
};

type IdempotencyRow = {
  namespace: string;
  idempotency_key: string;
  fingerprint: string;
  receipt_json: string;
  case_version: number;
  head_checksum: string;
};

function fail(code: string): never {
  throw new Error(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    fail("journal_canonical_invalid");
  }
  if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) fail("journal_canonical_invalid");
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key]);
  return result;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: unknown): string {
  // Keep hashing delegated to the coordinator's canonical event checksums. The
  // adapter computes no cryptographic state of its own; this helper is only
  // used for genesis/validation where the same canonical form is required.
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function genesisChecksum(caseId: string): string {
  return sha256({ schemaVersion: "case_genesis_v1", caseId });
}

function ownKeys(value: unknown, keys: readonly string[], code: string): void {
  if (!isRecord(value)) fail(code);
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
}

function parseCanonicalJson(value: string, code: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    fail(code);
  }
  if (canonicalJson(parsed) !== value) fail(code);
  return parsed;
}

function asString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) fail(code);
  return value;
}

function asChecksum(value: unknown, code: string): string {
  const result = asString(value, code);
  if (!CHECKSUM.test(result)) fail(code);
  return result;
}

function validateReceipt(value: unknown, code = "journal_receipt_invalid"): CommandReceipt {
  ownKeys(value, ["caseVersion", "eventIds", "journalHeadChecksum"], code);
  const input = value as Record<string, unknown>;
  if (!Number.isSafeInteger(input.caseVersion) || (input.caseVersion as number) < 1) fail(code);
  if (!Array.isArray(input.eventIds) || input.eventIds.length === 0 || input.eventIds.some((id) => typeof id !== "string")) fail(code);
  const eventIds = input.eventIds as string[];
  if (new Set(eventIds).size !== eventIds.length) fail(code);
  const journalHeadChecksum = asChecksum(input.journalHeadChecksum, code);
  return { caseVersion: input.caseVersion as number, eventIds: [...eventIds], journalHeadChecksum };
}

function parseActor(value: unknown, code: string): ActorBinding {
  ownKeys(value, ["actorClass", "actorId"], code);
  const actor = value as Record<string, unknown>;
  return {
    actorId: asString(actor.actorId, code),
    actorClass: asString(actor.actorClass, code) as ActorBinding["actorClass"],
  };
}

function rowToEvent(row: EventRow): CoordinatorJournalEvent {
  const actorBinding = parseActor(parseCanonicalJson(row.actor_json, "journal_event_actor_invalid"), "journal_event_actor_invalid");
  const payload = parseCanonicalJson(row.payload_json, "journal_event_payload_invalid");
  const event: CoordinatorJournalEvent = {
    schemaVersion: CASE_EVENT_SCHEMA_VERSION,
    eventId: asString(row.event_id, "journal_event_invalid"),
    caseId: asString(row.case_id, "journal_event_invalid"),
    caseVersion: row.case_version,
    eventType: row.event_type as CoordinatorJournalEvent["eventType"],
    priorEventChecksum: asChecksum(row.prior_event_checksum, "journal_event_invalid"),
    actorBinding,
    payloadChecksum: asChecksum(row.payload_checksum, "journal_event_invalid"),
    correctionOf: row.correction_of,
    eventChecksum: asChecksum(row.event_checksum, "journal_event_invalid"),
    payload,
  };
  if (!EVENT_TYPES.has(event.eventType)) fail("journal_event_invalid");
  if (row.correction_of !== null && typeof row.correction_of !== "string") fail("journal_event_invalid");
  const { payload: ignoredPayload, eventChecksum, ...eventWithoutChecksum } = event;
  void ignoredPayload;
  if (sha256(payload) !== event.payloadChecksum) fail("journal_payload_checksum_invalid");
  if (sha256(eventWithoutChecksum) !== eventChecksum) fail("journal_event_checksum_invalid");
  return event;
}

function ensureSafeRoot(rootDir: string): string {
  if (typeof rootDir !== "string" || !isAbsolute(rootDir)) fail("journal_root_invalid");
  if (rootDir.split(/[\\/]/).some((segment) => segment === "..")) fail("journal_root_invalid");
  const resolvedRoot = resolve(rootDir);
  const systemTmp = resolve(tmpdir());
  const relativeRoot = relative(systemTmp, resolvedRoot);
  if (resolvedRoot === systemTmp || relativeRoot.startsWith("..") || isAbsolute(relativeRoot)) fail("journal_root_invalid");
  if (!existsSync(resolvedRoot)) fail("journal_root_invalid");
  const rootStat = lstatSync(resolvedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("journal_root_invalid");
  let realRoot: string;
  let realTmp: string;
  try {
    realRoot = realpathSync(resolvedRoot);
    realTmp = realpathSync(systemTmp);
  } catch {
    fail("journal_root_invalid");
  }
  const realRelativeRoot = relative(realTmp, realRoot);
  if (realRoot === realTmp || realRelativeRoot.startsWith("..") || isAbsolute(realRelativeRoot)) fail("journal_root_invalid");
  return resolvedRoot;
}

function ensureNamespace(namespace: string): void {
  if (typeof namespace !== "string" || !NAMESPACE.test(namespace) || namespace.includes("..") || namespace.includes("/") || namespace.includes("\\")) {
    fail("journal_namespace_invalid");
  }
}

function ensurePathNotSymlink(path: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) fail("journal_path_symlink_forbidden");
}

function readColumnNames(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<Record<string, unknown>>)
    .map((row) => row.name)
    .filter((name): name is string => typeof name === "string");
}

function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS journal_meta (
      namespace TEXT PRIMARY KEY,
      schema_version TEXT NOT NULL,
      case_id TEXT NOT NULL,
      options_fingerprint TEXT NOT NULL,
      case_version INTEGER NOT NULL CHECK (case_version >= 0),
      head_checksum TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS case_events (
      namespace TEXT NOT NULL,
      case_version INTEGER NOT NULL CHECK (case_version >= 1),
      event_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      prior_event_checksum TEXT NOT NULL,
      actor_json TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_checksum TEXT NOT NULL,
      correction_of TEXT,
      event_checksum TEXT NOT NULL,
      PRIMARY KEY (namespace, case_version),
      UNIQUE (namespace, event_id),
      FOREIGN KEY (namespace) REFERENCES journal_meta(namespace)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS command_idempotency (
      namespace TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      receipt_json TEXT NOT NULL,
      case_version INTEGER NOT NULL CHECK (case_version >= 1),
      head_checksum TEXT NOT NULL,
      PRIMARY KEY (namespace, idempotency_key),
      FOREIGN KEY (namespace) REFERENCES journal_meta(namespace)
    ) STRICT;
  `);
  const tableNames = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<Record<string, unknown>>)
    .map((row) => row.name)
    .filter((name): name is string => typeof name === "string")
    .sort();
  const expectedTables = ["case_events", "command_idempotency", "journal_meta"];
  if (tableNames.length !== expectedTables.length || tableNames.some((name, index) => name !== expectedTables[index])) fail("journal_schema_invalid");
  for (const [table, columns] of [["journal_meta", META_COLUMNS], ["case_events", EVENT_COLUMNS], ["command_idempotency", IDEMPOTENCY_COLUMNS] ] as const) {
    const actual = readColumnNames(db, table);
    if (actual.length !== columns.length || actual.some((column, index) => column !== columns[index])) fail("journal_schema_invalid");
  }
}

type SqlParam = string | number | null;

function queryOne<T extends Record<string, unknown>>(db: DatabaseSync, sql: string, params: SqlParam[] = []): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

function queryAll<T extends Record<string, unknown>>(db: DatabaseSync, sql: string, params: SqlParam[] = []): T[] {
  return db.prepare(sql).all(...params) as T[];
}

function validateChain(events: CoordinatorJournalEvent[], caseId: string): string {
  let prior = genesisChecksum(caseId);
  const seen = new Set<string>();
  for (const [index, event] of events.entries()) {
    const expectedVersion = index + 1;
    if (
      event.schemaVersion !== CASE_EVENT_SCHEMA_VERSION ||
      event.caseId !== caseId ||
      event.caseVersion !== expectedVersion ||
      event.eventId !== `urn:stadtstack:case-event:${caseId}:${expectedVersion}` ||
      event.priorEventChecksum !== prior
    ) fail("journal_chain_invalid");
    if (seen.has(event.eventId) || (event.correctionOf !== null && !seen.has(event.correctionOf))) fail("journal_correction_invalid");
    seen.add(event.eventId);
    prior = event.eventChecksum;
  }
  return prior;
}

function idempotencyReferencesEvents(entry: CoordinatorJournalIdempotency, eventsById: ReadonlyMap<string, CoordinatorJournalEvent>): void {
  const receipt = validateReceipt(entry.receipt);
  const firstVersion = receipt.caseVersion - receipt.eventIds.length + 1;
  for (const [index, eventId] of receipt.eventIds.entries()) {
    const event = eventsById.get(eventId);
    if (!event || event.caseVersion !== firstVersion + index) fail("journal_idempotency_invalid");
  }
  const last = eventsById.get(receipt.eventIds[receipt.eventIds.length - 1]!);
  if (!last || last.caseVersion !== receipt.caseVersion || last.eventChecksum !== receipt.journalHeadChecksum) fail("journal_idempotency_invalid");
}

function readState(db: DatabaseSync, namespace: string, caseId: string, optionsFingerprint: string): CoordinatorJournalRecovery {
  const metaNamespaces = queryAll<Record<string, unknown>>(db, "SELECT DISTINCT namespace FROM journal_meta ORDER BY namespace").map((row) => row.namespace);
  const eventNamespaces = queryAll<Record<string, unknown>>(db, "SELECT DISTINCT namespace FROM case_events ORDER BY namespace").map((row) => row.namespace);
  const idempotencyNamespaces = queryAll<Record<string, unknown>>(db, "SELECT DISTINCT namespace FROM command_idempotency ORDER BY namespace").map((row) => row.namespace);
  for (const candidate of [...metaNamespaces, ...eventNamespaces, ...idempotencyNamespaces]) {
    if (candidate !== namespace) fail("journal_namespace_contamination");
  }
  const meta = queryOne<MetaRow>(db, "SELECT namespace,schema_version,case_id,options_fingerprint,case_version,head_checksum FROM journal_meta WHERE namespace=?", [namespace]);
  const eventRows = queryAll<EventRow>(db, "SELECT namespace,case_version,event_id,case_id,event_type,prior_event_checksum,actor_json,payload_json,payload_checksum,correction_of,event_checksum FROM case_events WHERE namespace=? ORDER BY case_version", [namespace]);
  const idempotencyRows = queryAll<IdempotencyRow>(db, "SELECT namespace,idempotency_key,fingerprint,receipt_json,case_version,head_checksum FROM command_idempotency WHERE namespace=? ORDER BY idempotency_key", [namespace]);
  if (!meta) {
    if (eventRows.length !== 0 || idempotencyRows.length !== 0) fail("journal_meta_invalid");
    db.prepare("INSERT INTO journal_meta(namespace,schema_version,case_id,options_fingerprint,case_version,head_checksum) VALUES(?,?,?,?,?,?)")
      .run(namespace, JOURNAL_SCHEMA_VERSION, caseId, optionsFingerprint, 0, genesisChecksum(caseId));
    return { events: [], idempotency: [] };
  }
  if (
    meta.namespace !== namespace ||
    meta.schema_version !== JOURNAL_SCHEMA_VERSION ||
    meta.case_id !== caseId ||
    meta.options_fingerprint !== optionsFingerprint ||
    !Number.isSafeInteger(meta.case_version) ||
    meta.case_version !== eventRows.length
  ) fail("journal_meta_invalid");
  const events = eventRows.map(rowToEvent);
  const headChecksum = events.length > 0 ? validateChain(events, caseId) : genesisChecksum(caseId);
  if (meta.head_checksum !== headChecksum || meta.case_version !== (events.length > 0 ? events[events.length - 1]!.caseVersion : 0)) fail("journal_meta_invalid");
  const eventsById = new Map(events.map((event) => [event.eventId, event]));
  const idempotency: CoordinatorJournalIdempotency[] = idempotencyRows.map((row) => {
    const receiptValue = parseCanonicalJson(row.receipt_json, "journal_idempotency_invalid");
    const receipt = validateReceipt(receiptValue, "journal_idempotency_invalid");
    if (row.namespace !== namespace || typeof row.idempotency_key !== "string" || row.fingerprint.length === 0 || row.case_version !== receipt.caseVersion || row.head_checksum !== receipt.journalHeadChecksum) {
      fail("journal_idempotency_invalid");
    }
    const entry = { idempotencyKey: row.idempotency_key, fingerprint: row.fingerprint, receipt };
    idempotencyReferencesEvents(entry, eventsById);
    return entry;
  });
  return { events, idempotency };
}

function validateAppendEvents(input: CoordinatorJournalAppend, currentEvents: CoordinatorJournalEvent[], currentHead: string): void {
  if (input.events.length === 0 || input.namespace.length === 0 || input.caseId.length === 0 || input.idempotencyKey.length === 0 || input.fingerprint.length === 0) fail("journal_append_invalid");
  if (!Number.isSafeInteger(input.expectedCaseVersion) || input.expectedCaseVersion !== currentEvents.length) fail("case_version_conflict");
  if (input.events[0]!.caseVersion !== input.expectedCaseVersion + 1) fail("journal_chain_invalid");
  if (input.events[0]!.priorEventChecksum !== currentHead) fail("journal_chain_invalid");
  const combined = [...currentEvents, ...input.events];
  const finalHead = validateChain(combined, input.caseId);
  const receipt = validateReceipt(input.receipt, "journal_receipt_invalid");
  if (
    receipt.caseVersion !== combined.length ||
    receipt.journalHeadChecksum !== finalHead ||
    receipt.eventIds.length !== input.events.length ||
    receipt.eventIds.some((id, index) => id !== input.events[index]!.eventId)
  ) fail("journal_receipt_invalid");
}

/**
 * SQLite WAL-backed journal port. The adapter intentionally exposes storage
 * operations only to the constructor seam; callers receive handle/project from
 * the coordinator and cannot query SQLite directly.
 */
export function createSqliteJournalStore(input: SqliteJournalStoreOptions): CoordinatorJournalPort {
  if (!isRecord(input)) fail("journal_options_invalid");
  ownKeys(input, ["namespace", "rootDir"], "journal_options_invalid");
  const rootDir = ensureSafeRoot(input.rootDir);
  ensureNamespace(input.namespace);
  const databasePath = join(rootDir, `${input.namespace}.sqlite`);
  const walPath = `${databasePath}-wal`;
  const shmPath = `${databasePath}-shm`;
  ensurePathNotSymlink(databasePath);
  ensurePathNotSymlink(walPath);
  ensurePathNotSymlink(shmPath);
  const db = new DatabaseSync(databasePath, { timeout: 5000, enableForeignKeyConstraints: true });
  let closed = false;
  const ensureOpen = (): void => {
    if (closed) fail("journal_closed");
  };
  try {
    db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    const modeRow = queryOne<Record<string, unknown>>(db, "PRAGMA journal_mode");
    const syncRow = queryOne<Record<string, unknown>>(db, "PRAGMA synchronous");
    const foreignKeysRow = queryOne<Record<string, unknown>>(db, "PRAGMA foreign_keys");
    const timeoutRow = queryOne<Record<string, unknown>>(db, "PRAGMA busy_timeout");
    if (
      String(modeRow?.journal_mode ?? "").toLowerCase() !== "wal" ||
      Number(syncRow?.synchronous) !== 2 ||
      Number(foreignKeysRow?.foreign_keys) !== 1 ||
      Number(timeoutRow?.timeout) !== 5000
    ) fail("journal_pragmas_invalid");
    ensureSchema(db);
  } catch (error) {
    db.close();
    throw error;
  }

  const recover = (inputValue: { namespace: string; caseId: string; optionsFingerprint: string }): CoordinatorJournalRecovery => {
    ensureOpen();
    if (inputValue.namespace !== input.namespace) fail("journal_namespace_invalid");
    if (inputValue.caseId.length === 0 || inputValue.optionsFingerprint.length === 0) fail("journal_recovery_invalid");
    try {
      db.exec("BEGIN IMMEDIATE");
      const recovered = readState(db, input.namespace, inputValue.caseId, inputValue.optionsFingerprint);
      db.exec("COMMIT");
      return clone(recovered);
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* best effort rollback */ }
      throw error;
    }
  };

  const appendAtomic = (append: CoordinatorJournalAppend): { status: "appended" | "duplicate"; receipt: CommandReceipt } => {
    ensureOpen();
    if (append.namespace !== input.namespace) fail("journal_namespace_invalid");
    try {
      db.exec("BEGIN IMMEDIATE");
      const meta = queryOne<MetaRow>(db, "SELECT namespace,schema_version,case_id,options_fingerprint,case_version,head_checksum FROM journal_meta WHERE namespace=?", [input.namespace]);
      if (!meta || meta.case_id !== append.caseId || meta.schema_version !== JOURNAL_SCHEMA_VERSION) fail("journal_meta_invalid");
      const recovered = readState(db, input.namespace, append.caseId, meta.options_fingerprint);
      const currentEvents = recovered.events;
      const currentHead = currentEvents.length > 0 ? currentEvents[currentEvents.length - 1]!.eventChecksum : genesisChecksum(append.caseId);
      const existing = recovered.idempotency.find((entry) => entry.idempotencyKey === append.idempotencyKey);
      if (existing) {
        if (existing.fingerprint !== append.fingerprint) fail("idempotency_conflict");
        db.exec("COMMIT");
        return { status: "duplicate", receipt: clone(existing.receipt) };
      }
      validateAppendEvents(append, currentEvents, currentHead);
      const insertEvent = db.prepare("INSERT INTO case_events(namespace,case_version,event_id,case_id,event_type,prior_event_checksum,actor_json,payload_json,payload_checksum,correction_of,event_checksum) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
      for (const event of append.events) {
        insertEvent.run(
          input.namespace,
          event.caseVersion,
          event.eventId,
          event.caseId,
          event.eventType,
          event.priorEventChecksum,
          canonicalJson(event.actorBinding),
          canonicalJson(event.payload),
          event.payloadChecksum,
          event.correctionOf,
          event.eventChecksum,
        );
      }
      db.prepare("INSERT INTO command_idempotency(namespace,idempotency_key,fingerprint,receipt_json,case_version,head_checksum) VALUES(?,?,?,?,?,?)")
        .run(input.namespace, append.idempotencyKey, append.fingerprint, canonicalJson(append.receipt), append.receipt.caseVersion, append.receipt.journalHeadChecksum);
      db.prepare("UPDATE journal_meta SET case_version=?,head_checksum=? WHERE namespace=?")
        .run(append.receipt.caseVersion, append.receipt.journalHeadChecksum, input.namespace);
      db.exec("COMMIT");
      return { status: "appended", receipt: clone(append.receipt) };
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* best effort rollback */ }
      throw error;
    }
  };

  const close = (): void => {
    if (closed) return;
    db.close();
    closed = true;
  };

  const deleteExactSynthetic = (): void => {
    close();
    const paths = [databasePath, walPath, shmPath];
    // Preflight every target before removing any file so a symlink or other
    // unsafe sidecar cannot cause a partial deletion of the scoped store.
    for (const path of paths) ensurePathNotSymlink(path);
    for (const path of paths) if (existsSync(path)) unlinkSync(path);
  };

  return Object.freeze({ namespace: input.namespace, recover, appendAtomic, close, deleteExactSynthetic });
}
