import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";
import { parseSyntheticCaseId } from "./case-id.ts";

/** Operations supplies the document and its independently reviewed pin through
 * separate sources, as it does for the deployment binding. Neither a candidate
 * receipt nor a caller-shaped object is an activation capability. */
export type StagingSyntheticReviewMigrationPlanV1 = Readonly<{
  schemaVersion: "staging_synthetic_review_migration_plan_v1";
  deploymentEnvironment: "staging";
  municipalityId: string;
  caseId: string;
  sourceDeploymentClaimChecksum: string;
  targetDeploymentClaimChecksum: string;
  candidateChecksum: string;
  notBeforeUtc: string;
  expiresAtUtc: string;
  planChecksum: string;
}>;
export type StagingSyntheticReviewMigrationSources = Readonly<{
  reviewedMigrationSource: Readonly<{ read(): unknown }>;
  migrationPinSource: Readonly<{ read(): unknown }>;
  clock: Readonly<{ now(): unknown }>;
}>;
export type StagingSyntheticReviewMigrationAuthorization = Readonly<{
  schemaVersion: "staging_synthetic_review_migration_authorization_v1";
}>;
const states = new WeakMap<object, {
  sources: StagingSyntheticReviewMigrationSources;
  plan?: StagingSyntheticReviewMigrationPlanV1;
  verifiedAtUtc?: string;
}>();
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
function fail(): never { throw new Error("staging_synthetic_review_migration_authorization_invalid"); }
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" || !fields.includes(key))) fail();
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail();
  }
  return value as Record<string, unknown>;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !UTC.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail();
  return value;
}
function captureMethod(value: unknown, name: "read" | "now"): () => unknown {
  const parsed = record(value, [name]);
  const method = parsed[name];
  if (typeof method !== "function") fail();
  return () => Reflect.apply(method, value, []);
}

/** Only the Operations composition root constructs this opaque capability.
 * Evidence is read under the durable owner lock, then before each commit. */
export function createStagingSyntheticReviewMigrationAuthorization(
  input: StagingSyntheticReviewMigrationSources,
): StagingSyntheticReviewMigrationAuthorization {
  const parsed = record(input, ["reviewedMigrationSource", "migrationPinSource", "clock"]);
  const sources = Object.freeze({
    reviewedMigrationSource: Object.freeze({ read: captureMethod(parsed.reviewedMigrationSource, "read") }),
    migrationPinSource: Object.freeze({ read: captureMethod(parsed.migrationPinSource, "read") }),
    clock: Object.freeze({ now: captureMethod(parsed.clock, "now") }),
  });
  const authorization = Object.freeze({ schemaVersion: "staging_synthetic_review_migration_authorization_v1" as const });
  states.set(authorization, { sources });
  return authorization;
}

/** @internal: consumed only by the locked SQLite migration Implementation. */
export function consumeStagingSyntheticReviewMigrationAuthorization(
  authorization: unknown,
): Readonly<{ plan: StagingSyntheticReviewMigrationPlanV1; verifiedAtUtc: string }> {
  if (!authorization || typeof authorization !== "object") fail();
  const state = states.get(authorization);
  if (!state) fail();
  try {
    const parsed = record(state.sources.reviewedMigrationSource.read(), ["schemaVersion", "deploymentEnvironment", "municipalityId", "caseId",
      "sourceDeploymentClaimChecksum", "targetDeploymentClaimChecksum", "candidateChecksum", "notBeforeUtc", "expiresAtUtc", "planChecksum"]);
    const identity = typeof parsed.caseId === "string" ? parseSyntheticCaseId(parsed.caseId) : undefined;
    if (parsed.schemaVersion !== "staging_synthetic_review_migration_plan_v1" || parsed.deploymentEnvironment !== "staging" ||
      !identity || parsed.municipalityId !== identity.municipalityId) fail();
    for (const key of ["sourceDeploymentClaimChecksum", "targetDeploymentClaimChecksum", "candidateChecksum", "planChecksum"]) {
      if (typeof parsed[key] !== "string" || !SHA256.test(parsed[key])) fail();
    }
    if (parsed.sourceDeploymentClaimChecksum === parsed.targetDeploymentClaimChecksum) fail();
    const notBeforeUtc = timestamp(parsed.notBeforeUtc), expiresAtUtc = timestamp(parsed.expiresAtUtc);
    const verifiedAtUtc = timestamp(state.sources.clock.now());
    const duration = Date.parse(expiresAtUtc) - Date.parse(notBeforeUtc);
    if (duration <= 0 || duration > 86_400_000 || verifiedAtUtc < notBeforeUtc || verifiedAtUtc >= expiresAtUtc) fail();
    const unsigned = Object.fromEntries(Object.keys(parsed).filter((key) => key !== "planChecksum").sort().map((key) => [key, parsed[key]]));
    const expected = `sha256:${createHash("sha256").update(JSON.stringify(unsigned)).digest("hex")}`;
    if (expected !== parsed.planChecksum || state.sources.migrationPinSource.read() !== expected ||
      (state.plan && state.plan.planChecksum !== expected) || (state.verifiedAtUtc && verifiedAtUtc < state.verifiedAtUtc)) fail();
    const plan = Object.freeze({ ...parsed }) as StagingSyntheticReviewMigrationPlanV1;
    state.plan = plan; state.verifiedAtUtc = verifiedAtUtc;
    return Object.freeze({ plan, verifiedAtUtc });
  } catch { fail(); }
}
