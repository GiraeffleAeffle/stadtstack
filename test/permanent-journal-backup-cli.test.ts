import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSqliteJournalStore } from "../src/adapters/sqlite-journal-adapter.ts";
import {
  parsePermanentJournalBackupArgs,
  runPermanentJournalBackup,
} from "../src/permanent-journal-backup-cli.ts";

test("backup CLI exposes only exact snapshot and restore commands", () => {
  assert.deepEqual(parsePermanentJournalBackupArgs([
    "snapshot", "--root-dir", "/tmp/stadtstack-cases", "--namespace", "roebel-workflow",
    "--snapshot-path", "/tmp/stadtstack-backup/latest.sqlite",
  ]), {
    command: "snapshot",
    rootDir: "/tmp/stadtstack-cases",
    namespace: "roebel-workflow",
    snapshotPath: "/tmp/stadtstack-backup/latest.sqlite",
  });
  assert.deepEqual(parsePermanentJournalBackupArgs([
    "restore", "--root-dir", "/tmp/stadtstack-cases", "--namespace", "roebel-workflow",
    "--snapshot-path", "/tmp/stadtstack-backup/latest.sqlite", "--expected-sha256", `sha256:${"a".repeat(64)}`,
  ]), {
    command: "restore",
    rootDir: "/tmp/stadtstack-cases",
    namespace: "roebel-workflow",
    snapshotPath: "/tmp/stadtstack-backup/latest.sqlite",
    expectedSnapshotSha256: `sha256:${"a".repeat(64)}`,
  });
  assert.throws(() => parsePermanentJournalBackupArgs(["snapshot"]), /journal_backup_cli_args_invalid/);
  assert.throws(() => parsePermanentJournalBackupArgs([
    "restore", "--root-dir", "/tmp/a", "--namespace", "x", "--snapshot-path", "/tmp/b.sqlite", "--expected-sha256", "latest",
  ]), /journal_backup_cli_checksum_invalid/);
});

test("backup CLI strips its command discriminator before calling the closed snapshot API", async () => {
  const root = mkdtempSync(join(tmpdir(), "stadtstack-journal-backup-cli-"));
  const journal = join(root, "journal");
  const snapshots = join(root, "snapshots");
  mkdirSync(journal);
  mkdirSync(snapshots);
  try {
    const namespace = "roebel-workflow";
    const caseId = "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001";
    const store = createSqliteJournalStore({ rootDir: journal, namespace });
    store.recover({ namespace, caseId, optionsFingerprint: `sha256:${"1".repeat(64)}` });
    store.close();
    const snapshotPath = join(snapshots, "latest.sqlite");
    const parsed = parsePermanentJournalBackupArgs([
      "snapshot", "--root-dir", journal, "--namespace", namespace,
      "--snapshot-path", snapshotPath,
    ]);

    const receipt = await runPermanentJournalBackup(parsed);
    assert.equal(receipt.namespace, namespace);
    assert.equal(receipt.caseId, caseId);
    assert.match(receipt.snapshotSha256, /^sha256:[0-9a-f]{64}$/);
    await assert.rejects(
      runPermanentJournalBackup({ ...parsed, extra: true } as typeof parsed),
      /journal_backup_cli_args_invalid/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
