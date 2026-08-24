/**
 * Durable Case identity v1. Deployment environment is intentionally absent:
 * a Case survives a staging restore or a later production deployment without
 * acquiring a second identity.
 */
export const MUNICIPAL_CASE_ID_PREFIX = "urn:stadtstack:case:municipality:";
export const LEGACY_TEST_CASE_ID_PREFIX = "urn:stadtstack:case:test:";

export const MUNICIPALITY_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
export const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const MUNICIPAL_CASE_ID = /^urn:stadtstack:case:municipality:([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?):([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;

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

/** Legacy IDs are never rewritten: a durable store containing one is unsafe
 * to activate until an explicit, separately reviewed migration exists. */
export function isLegacyTestCaseId(caseId: unknown): boolean {
  return typeof caseId === "string" && caseId.startsWith(LEGACY_TEST_CASE_ID_PREFIX);
}
