import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { types as utilTypes } from "node:util";

import {
  assertStagingCaseControlDeploymentProof,
  consumeStagingCaseControlDeploymentProofForRuntime,
  type StagingCaseControlDeploymentProof,
} from "./staging-case-control-preflight.ts";

export const CASE_DURABLE_DEPLOYMENT_CLAIM_FILENAME = "case-durable-deployment-claim-v1.json";

export type CaseDurableDeploymentClaim = Readonly<{
  schemaVersion: "case_durable_deployment_claim_v1";
  municipalityId: string;
  releaseDigest: string;
  controlDeploymentBindingChecksum: string;
  pvc: Readonly<{ namespace: string; name: string; uid: string }>;
  pvName: string;
  claimChecksum: string;
}>;

/** Opaque proof-derived capability.  A structural copy has no authority. */
export type CaseDurableDeploymentClaimToken = Readonly<{
  readonly schemaVersion: "case_durable_deployment_claim_token_v1";
}>;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const MUNICIPALITY = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const KUBE_NAME = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u;
const KUBE_UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const tokenFacts = new WeakMap<object, CaseDurableDeploymentClaim>();

function fail(code: string): never { throw new Error(code); }
function plain(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !utilTypes.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype;
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
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0))) return JSON.stringify(value);
  fail("case_durable_deployment_claim_invalid");
}
function checksum(value: unknown): string { return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`; }
function freeze<T>(value: T): T { return Object.freeze(value); }
function ensureRegular0600(path: string, code: string): void {
  const link = lstatSync(path);
  if (link.isSymbolicLink() || !link.isFile() || (link.mode & 0o7777) !== 0o600) fail(code);
  const target = statSync(path);
  if (!target.isFile() || target.dev !== link.dev || target.ino !== link.ino) fail(code);
}
function present(path: string): boolean {
  try { lstatSync(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function body(claim: Omit<CaseDurableDeploymentClaim, "claimChecksum">): Record<string, unknown> {
  return {
    schemaVersion: claim.schemaVersion, municipalityId: claim.municipalityId, releaseDigest: claim.releaseDigest,
    controlDeploymentBindingChecksum: claim.controlDeploymentBindingChecksum, pvc: claim.pvc, pvName: claim.pvName,
  };
}

export function verifyCaseDurableDeploymentClaim(value: unknown): CaseDurableDeploymentClaim {
  const record = exact(value, ["claimChecksum", "controlDeploymentBindingChecksum", "municipalityId", "pvName", "pvc", "releaseDigest", "schemaVersion"], "case_durable_deployment_claim_invalid");
  const pvc = exact(record.pvc, ["name", "namespace", "uid"], "case_durable_deployment_claim_invalid");
  if (record.schemaVersion !== "case_durable_deployment_claim_v1" || typeof record.municipalityId !== "string" || !MUNICIPALITY.test(record.municipalityId) ||
    typeof record.releaseDigest !== "string" || !SHA256.test(record.releaseDigest) || typeof record.controlDeploymentBindingChecksum !== "string" || !SHA256.test(record.controlDeploymentBindingChecksum) ||
    typeof pvc.namespace !== "string" || !KUBE_NAME.test(pvc.namespace) || typeof pvc.name !== "string" || !KUBE_NAME.test(pvc.name) || typeof pvc.uid !== "string" || !KUBE_UID.test(pvc.uid) ||
    typeof record.pvName !== "string" || !KUBE_NAME.test(record.pvName) || typeof record.claimChecksum !== "string" || !SHA256.test(record.claimChecksum)) fail("case_durable_deployment_claim_invalid");
  const claim = freeze({ schemaVersion: "case_durable_deployment_claim_v1" as const, municipalityId: record.municipalityId, releaseDigest: record.releaseDigest,
    controlDeploymentBindingChecksum: record.controlDeploymentBindingChecksum, pvc: freeze({ namespace: pvc.namespace, name: pvc.name, uid: pvc.uid }), pvName: record.pvName, claimChecksum: record.claimChecksum });
  if (checksum(body(claim)) !== claim.claimChecksum) fail("case_durable_deployment_claim_invalid");
  return claim;
}

export function createCaseDurableDeploymentClaimToken(value: unknown): CaseDurableDeploymentClaimToken {
  const proof = assertStagingCaseControlDeploymentProof(value);
  const facts = consumeStagingCaseControlDeploymentProofForRuntime(proof);
  const unsigned = { schemaVersion: "case_durable_deployment_claim_v1" as const, municipalityId: facts.municipalityId, releaseDigest: facts.releaseDigest,
    controlDeploymentBindingChecksum: facts.bindingChecksum, pvc: freeze({ namespace: facts.pvcNamespace, name: facts.pvcName, uid: facts.pvcUid }), pvName: facts.pvName };
  const claim = verifyCaseDurableDeploymentClaim({ ...unsigned, claimChecksum: checksum(unsigned) });
  const token: CaseDurableDeploymentClaimToken = freeze({ schemaVersion: "case_durable_deployment_claim_token_v1" });
  tokenFacts.set(token, claim);
  return token;
}

/** @internal: only the durable adapter consumes the token. */
export function consumeCaseDurableDeploymentClaimToken(value: unknown): CaseDurableDeploymentClaim {
  if (!value || typeof value !== "object") fail("case_durable_deployment_claim_token_invalid");
  const claim = tokenFacts.get(value);
  if (!claim) fail("case_durable_deployment_claim_token_invalid");
  return claim;
}

export function sameCaseDurableDeploymentClaim(left: CaseDurableDeploymentClaim, right: CaseDurableDeploymentClaim): boolean {
  return left.claimChecksum === right.claimChecksum;
}

export function readCanonicalCaseDurableDeploymentClaim(rootDir: string): CaseDurableDeploymentClaim | undefined {
  const target = join(rootDir, CASE_DURABLE_DEPLOYMENT_CLAIM_FILENAME);
  if (!present(target)) return undefined;
  ensureRegular0600(target, "case_durable_deployment_claim_invalid");
  let claim: CaseDurableDeploymentClaim;
  let encoded: string;
  try { encoded = readFileSync(target, "utf8"); claim = verifyCaseDurableDeploymentClaim(JSON.parse(encoded)); }
  catch { fail("case_durable_deployment_claim_invalid"); }
  if (encoded !== `${canonical(claim)}\n`) fail("case_durable_deployment_claim_invalid");
  return claim;
}

export function writeCanonicalCaseDurableDeploymentClaim(rootDir: string, claim: CaseDurableDeploymentClaim): void {
  const verifiedClaim = verifyCaseDurableDeploymentClaim(claim);
  const target = join(rootDir, CASE_DURABLE_DEPLOYMENT_CLAIM_FILENAME);
  if (present(target)) {
    ensureRegular0600(target, "case_durable_deployment_claim_invalid");
    fail("case_durable_deployment_claim_exists");
  }
  const temporary = join(rootDir, `.${CASE_DURABLE_DEPLOYMENT_CLAIM_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    const bytes = Buffer.from(`${canonical(verifiedClaim)}\n`, "utf8");
    for (let offset = 0; offset < bytes.length;) offset += writeSync(descriptor, bytes, offset);
    fsyncSync(descriptor); closeSync(descriptor); descriptor = undefined;
    if (present(target)) { ensureRegular0600(target, "case_durable_deployment_claim_invalid"); fail("case_durable_deployment_claim_exists"); }
    renameSync(temporary, target);
    const directory = openSync(rootDir, "r"); try { fsyncSync(directory); } finally { closeSync(directory); }
  } catch (error) {
    if (descriptor !== undefined) try { closeSync(descriptor); } catch { /* best effort */ }
    if (existsSync(temporary)) try { unlinkSync(temporary); } catch { /* best effort */ }
    throw error;
  }
}

/** Atomic/fsync'd transition after a recovery marker is durable. */
export function replaceCanonicalCaseDurableDeploymentClaim(
  rootDir: string,
  source: CaseDurableDeploymentClaim,
  targetClaim: CaseDurableDeploymentClaim,
): void {
  const verifiedSource = verifyCaseDurableDeploymentClaim(source);
  const verifiedTarget = verifyCaseDurableDeploymentClaim(targetClaim);
  const current = readCanonicalCaseDurableDeploymentClaim(rootDir);
  if (!current || !sameCaseDurableDeploymentClaim(current, verifiedSource)) fail("case_durable_deployment_claim_mismatch");
  const target = join(rootDir, CASE_DURABLE_DEPLOYMENT_CLAIM_FILENAME);
  ensureRegular0600(target, "case_durable_deployment_claim_invalid");
  const temporary = join(rootDir, `.${CASE_DURABLE_DEPLOYMENT_CLAIM_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    const bytes = Buffer.from(`${canonical(verifiedTarget)}\n`, "utf8");
    for (let offset = 0; offset < bytes.length;) offset += writeSync(descriptor, bytes, offset);
    fsyncSync(descriptor); closeSync(descriptor); descriptor = undefined;
    const rechecked = readCanonicalCaseDurableDeploymentClaim(rootDir);
    if (!rechecked || !sameCaseDurableDeploymentClaim(rechecked, verifiedSource)) fail("case_durable_deployment_claim_mismatch");
    renameSync(temporary, target);
    const directory = openSync(rootDir, "r"); try { fsyncSync(directory); } finally { closeSync(directory); }
  } catch (error) {
    if (descriptor !== undefined) try { closeSync(descriptor); } catch { /* best effort */ }
    if (existsSync(temporary)) try { unlinkSync(temporary); } catch { /* best effort */ }
    throw error;
  }
}
