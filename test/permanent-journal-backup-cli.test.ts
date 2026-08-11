import assert from "node:assert/strict";
import test from "node:test";

import { parsePermanentJournalBackupArgs } from "../src/permanent-journal-backup-cli.ts";

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
