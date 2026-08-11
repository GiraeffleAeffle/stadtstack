import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSqliteJournalStore } from "../src/adapters/sqlite-journal-adapter.ts";
import {
  createPermanentJournalSnapshot,
  inspectPermanentJournalSnapshot,
  restorePermanentJournalSnapshot,
} from "../src/permanent-journal-backup.ts";

const namespace = "roebel-workflow";
const caseId = "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001";

function seed(rootDir: string) {
  const store = createSqliteJournalStore({ rootDir, namespace });
  store.recover({ namespace, caseId, optionsFingerprint: `sha256:${"1".repeat(64)}` });
  store.close();
}

test("creates a checksum-bound online SQLite snapshot and restores it only into an empty owned root", async () => {
  const root = mkdtempSync(join(tmpdir(), "stadtstack-journal-backup-"));
  const journal = join(root, "journal");
  const snapshots = join(root, "snapshots");
  const restored = join(root, "restored");
  mkdirSync(journal);
  mkdirSync(snapshots);
  mkdirSync(restored);
  try {
    seed(journal);
    const snapshotPath = join(snapshots, "roebel-workflow.sqlite");
    const receipt = await createPermanentJournalSnapshot({ rootDir: journal, namespace, snapshotPath });
    assert.equal(receipt.schemaVersion, "stadtstack_permanent_journal_snapshot_v1");
    assert.equal(receipt.namespace, namespace);
    assert.equal(receipt.caseId, caseId);
    assert.equal(receipt.caseVersion, 0);
    assert.equal(receipt.eventCount, 0);
    assert.equal(receipt.idempotencyCount, 0);
    assert.match(receipt.snapshotSha256, /^sha256:[0-9a-f]{64}$/);
    assert.ok(receipt.snapshotBytes > 0);
    assert.deepEqual(await inspectPermanentJournalSnapshot(snapshotPath), receipt);

    const restoredReceipt = await restorePermanentJournalSnapshot({
      rootDir: restored,
      namespace,
      snapshotPath,
      expectedSnapshotSha256: receipt.snapshotSha256,
    });
    assert.deepEqual(restoredReceipt, receipt);
    const reopened = createSqliteJournalStore({ rootDir: restored, namespace });
    assert.deepEqual(reopened.recover({ namespace, caseId, optionsFingerprint: `sha256:${"1".repeat(64)}` }), {
      events: [],
      idempotency: [],
    });
    reopened.close();

    await assert.rejects(
      restorePermanentJournalSnapshot({ rootDir: restored, namespace, snapshotPath, expectedSnapshotSha256: receipt.snapshotSha256 }),
      /journal_restore_target_not_empty/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed on drift, symlinks, sidecars, namespace mismatch and non-owned paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "stadtstack-journal-backup-negative-"));
  const journal = join(root, "journal");
  const snapshots = join(root, "snapshots");
  const restored = join(root, "restored");
  mkdirSync(journal);
  mkdirSync(snapshots);
  mkdirSync(restored);
  try {
    seed(journal);
    const snapshotPath = join(snapshots, "snapshot.sqlite");
    const receipt = await createPermanentJournalSnapshot({ rootDir: journal, namespace, snapshotPath });
    const drifted = join(snapshots, "drifted.sqlite");
    copyFileSync(snapshotPath, drifted);
    const bytes = readFileSync(drifted);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    await import("node:fs/promises").then(({ writeFile }) => writeFile(drifted, bytes));
    await assert.rejects(
      restorePermanentJournalSnapshot({ rootDir: restored, namespace, snapshotPath: drifted, expectedSnapshotSha256: receipt.snapshotSha256 }),
      /journal_snapshot_checksum_mismatch/,
    );

    const link = join(snapshots, "link.sqlite");
    symlinkSync(snapshotPath, link);
    await assert.rejects(() => inspectPermanentJournalSnapshot(link), /journal_snapshot_path_invalid/);
    copyFileSync(join(journal, `${namespace}.sqlite`), join(journal, "wrong.sqlite"));
    await assert.rejects(
      createPermanentJournalSnapshot({ rootDir: journal, namespace: "wrong", snapshotPath: join(snapshots, "wrong.sqlite") }),
      /journal_snapshot_namespace_mismatch/,
    );
    await assert.rejects(
      createPermanentJournalSnapshot({ rootDir: journal, namespace, snapshotPath: "/var/tmp/stadtstack-forbidden.sqlite" }),
      /journal_snapshot_path_invalid/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
