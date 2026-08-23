import { createHash, timingSafeEqual } from "node:crypto";
import { types as utilTypes } from "node:util";

import type {
  CaseStewardAuthenticator,
  CaseStewardPrincipal,
} from "./roebel-control-service.ts";

/** The only admission route understood by this staging credential adapter. */
export const CASE_STEWARD_ADMISSION_PATH = "/v1/nostr/suggestions/admit" as const;

const MIN_CREDENTIALS = 1;
const MAX_CREDENTIALS = 16;
const MAX_MUNICIPALITIES_PER_PRINCIPAL = 16;
const MAX_ACTOR_ID_BYTES = 256;
const MAX_MUNICIPALITY_ID_BYTES = 63;
const TOKEN_BYTES = 32;
const TOKEN_TEXT_BYTES = 43;
const AUTHORIZATION_PREFIX = "Bearer ";
const AUTHORIZATION_BYTES = Buffer.byteLength(AUTHORIZATION_PREFIX, "utf8") + TOKEN_TEXT_BYTES;
const ACTOR_ID = /^[A-Za-z0-9:._-]+$/u;
const MUNICIPALITY_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const TOKEN = /^[A-Za-z0-9_-]{43}$/u;

/** A staging secret plus the exact principal it is allowed to authenticate. */
export type StagingCaseStewardCredential = {
  principal: {
    actorId: string;
    actorClass: "case_steward";
    municipalityIds: readonly string[];
  };
  token: string;
};

export type StagingCaseStewardTokenAuthenticatorConfig = {
  /** Explicit accidental-production-use guard; Operations CI must also reject
   * this Adapter from every production composition. */
  deploymentEnvironment: "staging";
  credentials: readonly StagingCaseStewardCredential[];
};

export type StagingCaseStewardTokenAuthenticator = CaseStewardAuthenticator;

type Digest = Buffer & { readonly length: 32 };
type Entry = {
  readonly digest: Digest;
  readonly principal: {
    readonly actorId: string;
    readonly actorClass: "case_steward";
    readonly municipalityIds: readonly string[];
  };
};

function fail(): never {
  throw new Error("staging_case_steward_authenticator_config_invalid");
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    !utilTypes.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!plainObject(value)) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some((key) =>
    typeof key !== "string" || !fields.includes(key))) fail();
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail();
  }
  return value;
}

function exactArray(value: unknown, minLength: number, maxLength: number): readonly unknown[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype) fail();
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || lengthDescriptor.get || lengthDescriptor.set ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < minLength || lengthDescriptor.value > maxLength) fail();
  const length = lengthDescriptor.value;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || keys.some((key) => key !== "length" &&
    (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)))) fail();
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail();
  }
  return value;
}

function strictText(value: unknown, expression: RegExp, maxBytes: number): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value ||
    Buffer.byteLength(value, "utf8") > maxBytes || !expression.test(value)) fail();
  return value;
}

function strictToken(value: unknown): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") !== TOKEN_TEXT_BYTES ||
    !TOKEN.test(value)) fail();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== TOKEN_BYTES || decoded.toString("base64url") !== value) fail();
  return value;
}

function strictPrincipal(value: unknown): Entry["principal"] {
  const parsed = exactObject(value, ["actorClass", "actorId", "municipalityIds"]);
  if (parsed.actorClass !== "case_steward") fail();
  const actorId = strictText(parsed.actorId, ACTOR_ID, MAX_ACTOR_ID_BYTES);
  const configuredMunicipalities = exactArray(
    parsed.municipalityIds,
    1,
    MAX_MUNICIPALITIES_PER_PRINCIPAL,
  );
  const municipalityIds: string[] = [];
  for (let index = 0; index < configuredMunicipalities.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(configuredMunicipalities, String(index));
    if (!descriptor) fail();
    municipalityIds.push(strictText(descriptor.value, MUNICIPALITY_ID, MAX_MUNICIPALITY_ID_BYTES));
  }
  if (new Set(municipalityIds).size !== municipalityIds.length) fail();
  return Object.freeze({
    actorId,
    actorClass: "case_steward" as const,
    municipalityIds: Object.freeze(municipalityIds),
  });
}

function digestToken(token: string): Digest {
  const digest = createHash("sha256").update(token, "utf8").digest();
  if (digest.length !== TOKEN_BYTES) fail();
  return digest as Digest;
}

function clonePrincipal(principal: Entry["principal"]): CaseStewardPrincipal {
  return Object.freeze({
    actorId: principal.actorId,
    actorClass: "case_steward" as const,
    municipalityIds: Object.freeze([...principal.municipalityIds]),
  });
}

function requestParts(value: unknown): {
  authorization: unknown;
  method: unknown;
  path: unknown;
} | null {
  if (!plainObject(value)) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 3 || keys.some((key) =>
    typeof key !== "string" || !["authorization", "method", "path"].includes(key))) return null;
  const parts: Record<string, unknown> = {};
  for (const field of ["authorization", "method", "path"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) return null;
    parts[field] = descriptor.value;
  }
  return parts as { authorization: unknown; method: unknown; path: unknown };
}

function bearerToken(value: unknown): string | null {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") !== AUTHORIZATION_BYTES ||
    !value.startsWith(AUTHORIZATION_PREFIX)) return null;
  const token = value.slice(AUTHORIZATION_PREFIX.length);
  if (!TOKEN.test(token)) return null;
  try {
    const decoded = Buffer.from(token, "base64url");
    if (decoded.length !== TOKEN_BYTES || decoded.toString("base64url") !== token) return null;
  } catch {
    return null;
  }
  return token;
}

function validatedEntries(value: unknown): readonly Entry[] {
  const config = exactObject(value, ["deploymentEnvironment", "credentials"]);
  if (config.deploymentEnvironment !== "staging") fail();
  const credentials = exactArray(config.credentials, MIN_CREDENTIALS, MAX_CREDENTIALS);
  const entries: Entry[] = [];
  const actorIds = new Set<string>();
  const digests: Buffer[] = [];
  for (let index = 0; index < credentials.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(credentials, String(index));
    if (!descriptor) fail();
    const credential = exactObject(descriptor.value, ["principal", "token"]);
    const principal = strictPrincipal(credential.principal);
    const token = strictToken(credential.token);
    const digest = digestToken(token);
    if (actorIds.has(principal.actorId) || digests.some((candidate) =>
      timingSafeEqual(candidate, digest))) fail();
    actorIds.add(principal.actorId);
    digests.push(digest);
    entries.push(Object.freeze({ digest, principal }));
  }
  return Object.freeze(entries);
}

/**
 * Creates the staging-only human Case Steward credential seam.
 *
 * The returned authenticator closes over fixed-size SHA-256 digests, not the
 * configured plaintext token values. JavaScript cannot guarantee zeroization:
 * the caller still owns its configuration and transient heap copies may exist.
 * The returned object deliberately exposes no rotation, lookup, token, digest,
 * registry, or deployment capability.
 */
export function createStagingCaseStewardTokenAuthenticator(
  config: StagingCaseStewardTokenAuthenticatorConfig,
): StagingCaseStewardTokenAuthenticator {
  const entries = validatedEntries(config);
  const authenticator = {
    async authenticate(input: Parameters<CaseStewardAuthenticator["authenticate"]>[0]): Promise<CaseStewardPrincipal | null> {
      const parts = requestParts(input);
      if (!parts || parts.method !== "POST" || parts.path !== CASE_STEWARD_ADMISSION_PATH) return null;
      const token = bearerToken(parts.authorization);
      if (token === null) return null;
      const candidate = digestToken(token);
      let matched: Entry | null = null;
      for (const entry of entries) {
        const equal = timingSafeEqual(candidate, entry.digest);
        if (equal) matched = entry;
      }
      return matched === null ? null : clonePrincipal(matched.principal);
    },
  } satisfies CaseStewardAuthenticator;
  return Object.freeze(authenticator);
}

/** Short alias for deployment composition sites. */
export const createStagingCaseStewardAuthenticator = createStagingCaseStewardTokenAuthenticator;
