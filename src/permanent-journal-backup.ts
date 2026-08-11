import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, open, realpath, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const NAMESPACE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CHECKSUM = /^sha256:[0-9a-f]{64}$/;

export type PermanentJournalSnapshotReceipt = {
  schemaVersion: "stadtstack_permanent_journal_snapshot_v1";
  namespace: string;
  caseId: string;
  caseVersion: number;
  journalHeadChecksum: string;
  eventCount: number;
  idempotencyCount: number;
  snapshotSha256: string;
  snapshotBytes: number;
};

type SnapshotInput = {
  rootDir: string;
  namespace: string;
  snapshotPath: string;
};

type RestoreInput = SnapshotInput & {
  expectedSnapshotSha256: string;
};

function fail(code: string): never {
  throw new Error(code);
}

async function status(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function beneath(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

async function ownedDirectory(path: string): Promise<string> {
  if (typeof path !== "string" || !isAbsolute(path) || path.split(/[\\/]/).includes("..")) fail("journal_snapshot_path_invalid");
  const resolved = resolve(path);
  const base = await realpath(tmpdir());
  const metadata = await status(resolved);
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) fail("journal_snapshot_path_invalid");
  const actual = await realpath(resolved);
  if (!beneath(base, actual)) fail("journal_snapshot_path_invalid");
  return actual;
}

async function regularFile(path: string): Promise<void> {
  const metadata = await status(path);
  if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size < 1) fail("journal_snapshot_path_invalid");
}

async function sha256File(path: string): Promise<{ digest: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.byteLength;
    hash.update(value);
  }
  return { digest: `sha256:${hash.digest("hex")}`, bytes };
}

function snapshotState(path: string): Omit<PermanentJournalSnapshotReceipt, "snapshotSha256" | "snapshotBytes"> {
  const db = new DatabaseSync(path, { readOnly: true, timeout: 5_000 });
  try {
    const integrity = db.prepare("PRAGMA quick_check").get() as Record<string, unknown> | undefined;
    if (!integrity || Object.values(integrity)[0] !== "ok") fail("journal_snapshot_integrity_invalid");
    const meta = db.prepare("SELECT namespace,schema_version,case_id,case_version,head_checksum FROM journal_meta").all() as Record<string, unknown>[];
    if (
      meta.length !== 1 || meta[0]?.schema_version !== "durable_case_journal_v1" ||
      typeof meta[0]?.namespace !== "string" || typeof meta[0]?.case_id !== "string" ||
      !Number.isSafeInteger(meta[0]?.case_version) || !CHECKSUM.test(String(meta[0]?.head_checksum ?? ""))
    ) fail("journal_snapshot_meta_invalid");
    const events = db.prepare("SELECT COUNT(*) AS count FROM case_events WHERE namespace=?").get(meta[0].namespace) as Record<string, unknown>;
    const idempotency = db.prepare("SELECT COUNT(*) AS count FROM command_idempotency WHERE namespace=?").get(meta[0].namespace) as Record<string, unknown>;
    const eventCount = Number(events.count);
    const idempotencyCount = Number(idempotency.count);
    if (!Number.isSafeInteger(eventCount) || !Number.isSafeInteger(idempotencyCount) || eventCount !== meta[0].case_version) fail("journal_snapshot_counts_invalid");
    return {
      schemaVersion: "stadtstack_permanent_journal_snapshot_v1",
      namespace: meta[0].namespace,
      caseId: meta[0].case_id,
      caseVersion: meta[0].case_version as number,
      journalHeadChecksum: meta[0].head_checksum as string,
      eventCount,
      idempotencyCount,
    };
  } finally {
    db.close();
  }
}

export async function inspectPermanentJournalSnapshot(snapshotPath: string): Promise<PermanentJournalSnapshotReceipt> {
  if (typeof snapshotPath !== "string" || !isAbsolute(snapshotPath)) fail("journal_snapshot_path_invalid");
  await ownedDirectory(dirname(snapshotPath));
  await regularFile(snapshotPath);
  const state = snapshotState(snapshotPath);
  const { digest, bytes } = await sha256File(snapshotPath);
  return { ...state, snapshotSha256: digest, snapshotBytes: bytes };
}

function validateNamespace(namespace: string): void {
  if (typeof namespace !== "string" || !NAMESPACE.test(namespace) || namespace.includes("..")) fail("journal_snapshot_namespace_invalid");
}

export async function createPermanentJournalSnapshot(input: SnapshotInput): Promise<PermanentJournalSnapshotReceipt> {
  if (!input || typeof input !== "object" || Object.keys(input).sort().join(",") !== "namespace,rootDir,snapshotPath") fail("journal_snapshot_input_invalid");
  validateNamespace(input.namespace);
  const rootDir = await ownedDirectory(input.rootDir);
  const destinationDir = await ownedDirectory(dirname(input.snapshotPath));
  const snapshotName = basename(input.snapshotPath);
  if (!snapshotName || snapshotName === "." || snapshotName === "..") fail("journal_snapshot_target_invalid");
  const snapshotPath = join(destinationDir, snapshotName);
  if (await status(snapshotPath)) fail("journal_snapshot_target_invalid");
  const databasePath = join(rootDir, `${input.namespace}.sqlite`);
  await regularFile(databasePath);
  const sourceState = snapshotState(databasePath);
  if (sourceState.namespace !== input.namespace) fail("journal_snapshot_namespace_mismatch");
  const db = new DatabaseSync(databasePath, { readOnly: true, timeout: 5_000 });
  try {
    await backup(db, snapshotPath);
  } catch (error) {
    try { await unlink(snapshotPath); } catch { /* destination may not exist */ }
    throw error;
  } finally {
    db.close();
  }
  const receipt = await inspectPermanentJournalSnapshot(snapshotPath);
  if (
    receipt.namespace !== sourceState.namespace || receipt.caseId !== sourceState.caseId ||
    receipt.caseVersion !== sourceState.caseVersion || receipt.journalHeadChecksum !== sourceState.journalHeadChecksum ||
    receipt.eventCount !== sourceState.eventCount || receipt.idempotencyCount !== sourceState.idempotencyCount
  ) fail("journal_snapshot_state_mismatch");
  return receipt;
}

export async function restorePermanentJournalSnapshot(input: RestoreInput): Promise<PermanentJournalSnapshotReceipt> {
  if (!input || typeof input !== "object" || Object.keys(input).sort().join(",") !== "expectedSnapshotSha256,namespace,rootDir,snapshotPath") fail("journal_restore_input_invalid");
  validateNamespace(input.namespace);
  if (!CHECKSUM.test(input.expectedSnapshotSha256)) fail("journal_snapshot_checksum_invalid");
  const rootDir = await ownedDirectory(input.rootDir);
  const receipt = await inspectPermanentJournalSnapshot(input.snapshotPath);
  if (receipt.snapshotSha256 !== input.expectedSnapshotSha256) fail("journal_snapshot_checksum_mismatch");
  if (receipt.namespace !== input.namespace) fail("journal_snapshot_namespace_mismatch");
  const databasePath = join(rootDir, `${input.namespace}.sqlite`);
  const targetPaths = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
  if ((await Promise.all(targetPaths.map(status))).some(Boolean)) fail("journal_restore_target_not_empty");
  try {
    await copyFile(input.snapshotPath, databasePath, 1);
    const handle = await open(databasePath, "r");
    try { await handle.sync(); } finally { await handle.close(); }
    const restored = await inspectPermanentJournalSnapshot(databasePath);
    if (restored.snapshotSha256 !== receipt.snapshotSha256) fail("journal_restore_checksum_mismatch");
    return receipt;
  } catch (error) {
    try { await unlink(databasePath); } catch { /* exact target may not exist */ }
    throw error;
  }
}
