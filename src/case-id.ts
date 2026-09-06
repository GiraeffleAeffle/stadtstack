import { createHash } from "node:crypto";

/**
 * Durable Case identity v1. Deployment environment is intentionally absent:
 * a Case survives a staging restore or a later production deployment without
 * acquiring a second identity.
 */
export const MUNICIPAL_CASE_ID_PREFIX = "urn:stadtstack:case:municipality:";
export const LEGACY_TEST_CASE_ID_PREFIX = "urn:stadtstack:case:test:";
export const SYNTHETIC_CASE_ID_PREFIX = "urn:stadtstack:synthetic-case:municipality:";

export const MUNICIPALITY_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
export const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const MUNICIPAL_CASE_ID = /^urn:stadtstack:case:municipality:([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?):([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
export const SYNTHETIC_CASE_ID = new RegExp(MUNICIPAL_CASE_ID.source.replace("stadtstack:case:", "stadtstack:synthetic-case:"), "u");

export type MunicipalCaseIdentity = Readonly<{
  municipalityId: string;
  uuidV7: string;
  caseId: string;
}>;

export function canonicalMunicipalCaseId(municipalityId: string, uuidV7: string): string | null {
  if (!MUNICIPALITY_ID.test(municipalityId) || !UUID_V7.test(uuidV7)) return null;
  return `${MUNICIPAL_CASE_ID_PREFIX}${municipalityId}:${uuidV7}`;
}

export function parseMunicipalCaseId(caseId: unknown): MunicipalCaseIdentity | null {
  if (typeof caseId !== "string") return null;
  const match = MUNICIPAL_CASE_ID.exec(caseId);
  if (!match) return null;
  return Object.freeze({ municipalityId: match[1]!, uuidV7: match[2]!, caseId });
}

/** Explicit rehearsal identity; never accepted by the municipal parser. */
export function canonicalSyntheticCaseId(municipalityId: string, uuidV7: string): string | null {
  if (!MUNICIPALITY_ID.test(municipalityId) || !UUID_V7.test(uuidV7)) return null;
  return `${SYNTHETIC_CASE_ID_PREFIX}${municipalityId}:${uuidV7}`;
}

export function parseSyntheticCaseId(caseId: unknown): MunicipalCaseIdentity | null {
  if (typeof caseId !== "string") return null;
  const match = SYNTHETIC_CASE_ID.exec(caseId);
  return match ? Object.freeze({ municipalityId: match[1]!, uuidV7: match[2]!, caseId }) : null;
}

/** Legacy IDs are never rewritten: a durable store containing one is unsafe
 * to activate until an explicit, separately reviewed migration exists. */
export function isLegacyTestCaseId(caseId: unknown): boolean {
  return typeof caseId === "string" && caseId.startsWith(LEGACY_TEST_CASE_ID_PREFIX);
}

/** Called only after the source event signature and scope have been verified. */
export function deriveCaseUuidV7(event: Readonly<{ id: string; created_at: number }>): string {
  if (!Number.isSafeInteger(event.created_at) || event.created_at < 0) {
    throw new Error("topic_case_timestamp_invalid");
  }
  const timestampMs = event.created_at * 1_000;
  if (!Number.isSafeInteger(timestampMs) || timestampMs > 0xffffffffffff) {
    throw new Error("topic_case_timestamp_invalid");
  }
  const time = timestampMs.toString(16).padStart(12, "0");
  const entropy = createHash("sha256").update(event.id, "utf8").digest("hex");
  const variant = ((Number.parseInt(entropy[3]!, 16) & 0x3) | 0x8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8)}-7${entropy.slice(0, 3)}-${variant}${entropy.slice(4, 7)}-${entropy.slice(7, 19)}`;
}
