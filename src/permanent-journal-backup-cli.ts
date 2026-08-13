#!/usr/bin/env node

import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createPermanentJournalSnapshot,
  restorePermanentJournalSnapshot,
} from "./permanent-journal-backup.ts";

const CHECKSUM = /^sha256:[0-9a-f]{64}$/;
const NAMESPACE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type PermanentJournalBackupArgs = {
  command: "snapshot" | "restore";
  rootDir: string;
  namespace: string;
  snapshotPath: string;
  expectedSnapshotSha256?: string;
};

function fail(code: string): never {
  throw new Error(`journal_backup_cli_${code}`);
}

function absolute(value: string | undefined): string {
  if (!value || !isAbsolute(value) || value.includes("\u0000")) fail("path_invalid");
  return resolve(value);
}

export function parsePermanentJournalBackupArgs(argv: readonly string[]): PermanentJournalBackupArgs {
  if (!Array.isArray(argv) || (argv[0] !== "snapshot" && argv[0] !== "restore")) fail("args_invalid");
  const restore = argv[0] === "restore";
  if (
    argv.length !== (restore ? 9 : 7) || argv[1] !== "--root-dir" || argv[3] !== "--namespace" ||
    argv[5] !== "--snapshot-path" || (restore && argv[7] !== "--expected-sha256")
  ) fail("args_invalid");
  const namespace = argv[4];
  if (!namespace || !NAMESPACE.test(namespace) || namespace.includes("..")) fail("namespace_invalid");
  const common = {
    command: argv[0],
    rootDir: absolute(argv[2]),
    namespace,
    snapshotPath: absolute(argv[6]),
  } as const;
  if (!restore) return common;
  const expectedSnapshotSha256 = argv[8];
  if (!expectedSnapshotSha256 || !CHECKSUM.test(expectedSnapshotSha256)) fail("checksum_invalid");
  return { ...common, command: "restore", expectedSnapshotSha256 };
}

export async function runPermanentJournalBackup(args: PermanentJournalBackupArgs) {
  const keys = Object.keys(args).sort().join(",");
  const expectedKeys = args.command === "snapshot"
    ? "command,namespace,rootDir,snapshotPath"
    : "command,expectedSnapshotSha256,namespace,rootDir,snapshotPath";
  if (keys !== expectedKeys) fail("args_invalid");
  const input = {
    rootDir: args.rootDir,
    namespace: args.namespace,
    snapshotPath: args.snapshotPath,
  };
  return args.command === "snapshot"
    ? createPermanentJournalSnapshot(input)
    : restorePermanentJournalSnapshot({
        ...input,
        expectedSnapshotSha256: args.expectedSnapshotSha256!,
      });
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const args = parsePermanentJournalBackupArgs(argv);
    const receipt = await runPermanentJournalBackup(args);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "journal_backup_cli_failed"}\n`);
    return 2;
  }
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invoked) process.exitCode = await main();
