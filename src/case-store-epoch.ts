import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { types as utilTypes } from "node:util";

import {
  verifyCaseDurableDeploymentClaim,
  type CaseDurableDeploymentClaim,
} from "./case-durable-deployment-claim.ts";
import {
  verifyCaseShutdownSeal,
  type CaseShutdownSealV2,
} from "./case-shutdown-seal.ts";

/** A durable root may have exactly one bootstrap receipt. */
export const CASE_STORE_BOOTSTRAP_FILENAME = "case-store-bootstrap-v1.json";
/** Present only while a process owns an open durable-store epoch. */
export const CASE_OPEN_EPOCH_FILENAME = "case-open-epoch-v1.json";

export type CaseStoreBootstrapV1 = Readonly<{
  schemaVersion: "case_store_bootstrap_v1";
  municipalityId: string;
  deploymentClaim: CaseDurableDeploymentClaim;
  configFingerprint: string;
  databaseBasename: string;
  bootstrapChecksum: string;
}>;

export type CaseStoreBootstrapInput = Readonly<Omit<CaseStoreBootstrapV1, "schemaVersion" | "bootstrapChecksum">>;

export type CaseOpenEpochV1 = Readonly<{
  schemaVersion: "case_open_epoch_v1";
  municipalityId: string;
  deploymentClaim: CaseDurableDeploymentClaim;
  configFingerprint: string;
  databaseBasename: string;
  baselineShutdownSeal: CaseShutdownSealV2;
  epochChecksum: string;
}>;

export type CaseOpenEpochInput = Readonly<Omit<CaseOpenEpochV1, "schemaVersion" | "epochChecksum">>;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const MUNICIPALITY = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

function fail(code: string): never { throw new Error(code); }

function plain(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    !utilTypes.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exact(value: unknown, fields: readonly string[], code: string): Record<string, unknown> {
  if (!plain(value)) fail(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" || !fields.includes(key))) fail(code);
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail(code);
  }
  return value;
}

/** Stable JSON used both for receipt bytes and their content-addressed checksum. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0))) return JSON.stringify(value);
  fail("case_store_epoch_invalid");
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function expectedDatabaseBasename(municipalityId: string): string {
  return `stadtstack-${municipalityId}-atomic-admission.sqlite`;
}

function bootstrapBody(value: Omit<CaseStoreBootstrapV1, "bootstrapChecksum">): Record<string, unknown> {
  return {
    schemaVersion: value.schemaVersion,
    municipalityId: value.municipalityId,
    deploymentClaim: value.deploymentClaim,
    configFingerprint: value.configFingerprint,
    databaseBasename: value.databaseBasename,
  };
}

function epochBody(value: Omit<CaseOpenEpochV1, "epochChecksum">): Record<string, unknown> {
  return {
    schemaVersion: value.schemaVersion,
    municipalityId: value.municipalityId,
    deploymentClaim: value.deploymentClaim,
    configFingerprint: value.configFingerprint,
    databaseBasename: value.databaseBasename,
    baselineShutdownSeal: value.baselineShutdownSeal,
  };
}

/** Create a self-checking bootstrap receipt without accepting a caller-provided checksum. */
export function createCaseStoreBootstrap(value: CaseStoreBootstrapInput): CaseStoreBootstrapV1 {
  const parsed = exact(value, [
    "configFingerprint", "databaseBasename", "deploymentClaim", "municipalityId",
  ], "case_store_bootstrap_invalid");
  let deploymentClaim: CaseDurableDeploymentClaim;
  try { deploymentClaim = verifyCaseDurableDeploymentClaim(parsed.deploymentClaim); }
  catch { fail("case_store_bootstrap_invalid"); }
  const unsigned = {
    schemaVersion: "case_store_bootstrap_v1" as const,
    municipalityId: parsed.municipalityId,
    deploymentClaim,
    configFingerprint: parsed.configFingerprint,
    databaseBasename: parsed.databaseBasename,
  };
  return verifyCaseStoreBootstrap({ ...unsigned, bootstrapChecksum: digest(unsigned) });
}

export function verifyCaseStoreBootstrap(value: unknown): CaseStoreBootstrapV1 {
  const parsed = exact(value, [
    "bootstrapChecksum", "configFingerprint", "databaseBasename", "deploymentClaim", "municipalityId", "schemaVersion",
  ], "case_store_bootstrap_invalid");
  let deploymentClaim: CaseDurableDeploymentClaim;
  try { deploymentClaim = verifyCaseDurableDeploymentClaim(parsed.deploymentClaim); }
  catch { fail("case_store_bootstrap_invalid"); }
  if (parsed.schemaVersion !== "case_store_bootstrap_v1" || typeof parsed.municipalityId !== "string" || !MUNICIPALITY.test(parsed.municipalityId) ||
    typeof parsed.configFingerprint !== "string" || !SHA256.test(parsed.configFingerprint) ||
    parsed.databaseBasename !== expectedDatabaseBasename(parsed.municipalityId) ||
    typeof parsed.bootstrapChecksum !== "string" || !SHA256.test(parsed.bootstrapChecksum) ||
    deploymentClaim.municipalityId !== parsed.municipalityId) {
    fail("case_store_bootstrap_invalid");
  }
  const receipt = {
    schemaVersion: "case_store_bootstrap_v1" as const,
    municipalityId: parsed.municipalityId,
    deploymentClaim,
    configFingerprint: parsed.configFingerprint,
    databaseBasename: parsed.databaseBasename,
    bootstrapChecksum: parsed.bootstrapChecksum,
  };
  if (digest(bootstrapBody(receipt)) !== receipt.bootstrapChecksum) fail("case_store_bootstrap_invalid");
  return deepFreeze(receipt);
}

export function verifyCaseOpenEpoch(value: unknown): CaseOpenEpochV1 {
  const parsed = exact(value, [
    "baselineShutdownSeal", "configFingerprint", "databaseBasename", "deploymentClaim", "epochChecksum", "municipalityId", "schemaVersion",
  ], "case_open_epoch_invalid");
  let deploymentClaim: CaseDurableDeploymentClaim;
  let baselineShutdownSeal: CaseShutdownSealV2;
  try {
    deploymentClaim = verifyCaseDurableDeploymentClaim(parsed.deploymentClaim);
    baselineShutdownSeal = verifyCaseShutdownSeal(parsed.baselineShutdownSeal);
  } catch { fail("case_open_epoch_invalid"); }
  if (parsed.schemaVersion !== "case_open_epoch_v1" || typeof parsed.municipalityId !== "string" || !MUNICIPALITY.test(parsed.municipalityId) ||
    typeof parsed.configFingerprint !== "string" || !SHA256.test(parsed.configFingerprint) ||
    parsed.databaseBasename !== expectedDatabaseBasename(parsed.municipalityId) ||
    typeof parsed.epochChecksum !== "string" || !SHA256.test(parsed.epochChecksum) ||
    deploymentClaim.municipalityId !== parsed.municipalityId ||
    baselineShutdownSeal.municipalityId !== parsed.municipalityId ||
    baselineShutdownSeal.configFingerprint !== parsed.configFingerprint ||
    baselineShutdownSeal.databaseBasename !== parsed.databaseBasename ||
    baselineShutdownSeal.deploymentClaimChecksum !== deploymentClaim.claimChecksum ||
    baselineShutdownSeal.sourceReleaseDigest !== deploymentClaim.releaseDigest) {
    fail("case_open_epoch_invalid");
  }
  const receipt = {
    schemaVersion: "case_open_epoch_v1" as const,
    municipalityId: parsed.municipalityId,
    deploymentClaim,
    configFingerprint: parsed.configFingerprint,
    databaseBasename: parsed.databaseBasename,
    baselineShutdownSeal,
    epochChecksum: parsed.epochChecksum,
  };
  if (digest(epochBody(receipt)) !== receipt.epochChecksum) fail("case_open_epoch_invalid");
  return deepFreeze(receipt);
}

/** Create a self-checking ordinary open-epoch receipt from its closed baseline. */
export function createCaseOpenEpoch(value: CaseOpenEpochInput): CaseOpenEpochV1 {
  const parsed = exact(value, [
    "baselineShutdownSeal", "configFingerprint", "databaseBasename", "deploymentClaim", "municipalityId",
  ], "case_open_epoch_invalid");
  let deploymentClaim: CaseDurableDeploymentClaim;
  let baselineShutdownSeal: CaseShutdownSealV2;
  try {
    deploymentClaim = verifyCaseDurableDeploymentClaim(parsed.deploymentClaim);
    baselineShutdownSeal = verifyCaseShutdownSeal(parsed.baselineShutdownSeal);
  } catch { fail("case_open_epoch_invalid"); }
  const unsigned = {
    schemaVersion: "case_open_epoch_v1" as const,
    municipalityId: parsed.municipalityId,
    deploymentClaim,
    configFingerprint: parsed.configFingerprint,
    databaseBasename: parsed.databaseBasename,
    baselineShutdownSeal,
  };
  return verifyCaseOpenEpoch({ ...unsigned, epochChecksum: digest(unsigned) });
}

function assertRootDir(rootDir: unknown, code: string): string {
  if (typeof rootDir !== "string" || rootDir.length === 0) fail(code);
  let link: ReturnType<typeof lstatSync>;
  try { link = lstatSync(rootDir); } catch { fail(code); }
  if (link.isSymbolicLink() || !link.isDirectory()) fail(code);
  let target: ReturnType<typeof statSync>;
  try { target = statSync(rootDir); } catch { fail(code); }
  if (!target.isDirectory() || target.dev !== link.dev || target.ino !== link.ino) fail(code);
  return rootDir;
}

function receiptPath(rootDir: string, filename: string, code: string): string {
  return join(assertRootDir(rootDir, code), filename);
}

function existing(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function assertRegular0600(path: string, code: string) {
  let link: ReturnType<typeof lstatSync>;
  try { link = lstatSync(path); } catch { fail(code); }
  if (link.isSymbolicLink() || !link.isFile() || (link.mode & 0o7777) !== 0o600) fail(code);
  let target: ReturnType<typeof statSync>;
  try { target = statSync(path); } catch { fail(code); }
  if (!target.isFile() || (target.mode & 0o7777) !== 0o600 || target.dev !== link.dev || target.ino !== link.ino) fail(code);
  return link;
}

/** Read a receipt only from the exact 0600 inode observed before it is opened. */
function readCanonicalText(path: string, code: string): string {
  const link = assertRegular0600(path, code);
  const descriptor = openSync(path, "r");
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || (opened.mode & 0o7777) !== 0o600 || opened.dev !== link.dev || opened.ino !== link.ino) fail(code);
    const encoded = readFileSync(descriptor, "utf8");
    const after = fstatSync(descriptor);
    if (!after.isFile() || (after.mode & 0o7777) !== 0o600 || after.dev !== opened.dev || after.ino !== opened.ino) fail(code);
    return encoded;
  } finally {
    closeSync(descriptor);
  }
}

function fsyncDirectory(rootDir: string, code: string): void {
  const verifiedRoot = assertRootDir(rootDir, code);
  const descriptor = openSync(verifiedRoot, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function removeTemporary(path: string): void {
  try {
    const link = lstatSync(path);
    if (link.isFile() && !link.isSymbolicLink()) unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function writeNewCanonicalReceipt(
  rootDir: string,
  filename: string,
  encoded: string,
  code: string,
  existsCode: string,
): void {
  const target = receiptPath(rootDir, filename, code);
  if (existing(target)) {
    assertRegular0600(target, code);
    fail(existsCode);
  }
  const temporary = join(rootDir, `.${filename}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    const temporaryStat = fstatSync(descriptor);
    if (!temporaryStat.isFile() || (temporaryStat.mode & 0o7777) !== 0o600) fail(code);
    const bytes = Buffer.from(encoded, "utf8");
    for (let offset = 0; offset < bytes.length;) offset += writeSync(descriptor, bytes, offset);
    fsyncSync(descriptor);
    closeSync(descriptor); descriptor = undefined;
    if (existing(target)) {
      assertRegular0600(target, code);
      fail(existsCode);
    }
    renameSync(temporary, target);
    assertRegular0600(target, code);
    fsyncDirectory(rootDir, code);
  } catch (error) {
    if (descriptor !== undefined) try { closeSync(descriptor); } catch { /* best effort */ }
    removeTemporary(temporary);
    throw error;
  }
}

function removeCanonicalReceipt(
  rootDir: string,
  filename: string,
  code: string,
  read: () => unknown,
): void {
  const target = receiptPath(rootDir, filename, code);
  if (!existing(target)) return;
  // Never let cleanup erase malformed or substituted evidence.
  read();
  assertRegular0600(target, code);
  unlinkSync(target);
  fsyncDirectory(rootDir, code);
}

export function readCanonicalCaseStoreBootstrap(rootDir: string): CaseStoreBootstrapV1 | undefined {
  const target = receiptPath(rootDir, CASE_STORE_BOOTSTRAP_FILENAME, "case_store_bootstrap_invalid");
  if (!existing(target)) return undefined;
  let receipt: CaseStoreBootstrapV1;
  const encoded = readCanonicalText(target, "case_store_bootstrap_invalid");
  try { receipt = verifyCaseStoreBootstrap(JSON.parse(encoded)); }
  catch { fail("case_store_bootstrap_invalid"); }
  if (encoded !== `${canonical(receipt)}\n`) fail("case_store_bootstrap_invalid");
  return receipt;
}

export function writeCanonicalCaseStoreBootstrap(rootDir: string, value: CaseStoreBootstrapV1): void {
  const receipt = verifyCaseStoreBootstrap(value);
  writeNewCanonicalReceipt(
    rootDir,
    CASE_STORE_BOOTSTRAP_FILENAME,
    `${canonical(receipt)}\n`,
    "case_store_bootstrap_invalid",
    "case_store_bootstrap_exists",
  );
}

export function removeCanonicalCaseStoreBootstrap(rootDir: string): void {
  removeCanonicalReceipt(
    rootDir,
    CASE_STORE_BOOTSTRAP_FILENAME,
    "case_store_bootstrap_invalid",
    () => readCanonicalCaseStoreBootstrap(rootDir),
  );
}

export function readCanonicalCaseOpenEpoch(rootDir: string): CaseOpenEpochV1 | undefined {
  const target = receiptPath(rootDir, CASE_OPEN_EPOCH_FILENAME, "case_open_epoch_invalid");
  if (!existing(target)) return undefined;
  let receipt: CaseOpenEpochV1;
  const encoded = readCanonicalText(target, "case_open_epoch_invalid");
  try { receipt = verifyCaseOpenEpoch(JSON.parse(encoded)); }
  catch { fail("case_open_epoch_invalid"); }
  if (encoded !== `${canonical(receipt)}\n`) fail("case_open_epoch_invalid");
  return receipt;
}

export function writeCanonicalCaseOpenEpoch(rootDir: string, value: CaseOpenEpochV1): void {
  const receipt = verifyCaseOpenEpoch(value);
  writeNewCanonicalReceipt(
    rootDir,
    CASE_OPEN_EPOCH_FILENAME,
    `${canonical(receipt)}\n`,
    "case_open_epoch_invalid",
    "case_open_epoch_exists",
  );
}

export function removeCanonicalCaseOpenEpoch(rootDir: string): void {
  removeCanonicalReceipt(
    rootDir,
    CASE_OPEN_EPOCH_FILENAME,
    "case_open_epoch_invalid",
    () => readCanonicalCaseOpenEpoch(rootDir),
  );
}
