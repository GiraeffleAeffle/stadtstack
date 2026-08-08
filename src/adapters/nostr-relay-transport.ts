import {
  getEventHash,
  validateEvent,
  verifyEvent,
  type Event as NostrEvent,
} from "nostr-tools/pure";

export const NOSTR_RELAY_TRANSPORT_SCHEMA_VERSION = "nostr_relay_transport_v1" as const;

/** Shared limits and exact fixture identity from the accepted relay policy. */
export const NOSTR_RELAY_MAX_FRAME_BYTES = 131_072;
export const NOSTR_RELAY_MAX_CONTENT_BYTES = 65_536;
export const NOSTR_RELAY_MAX_TAGS = 2_000;
export const NOSTR_RELAY_MAX_TAG_PART_BYTES = 1_024;
export const NOSTR_RELAY_MAX_SCOPE_PART_BYTES = 256;
export const NOSTR_RELAY_ALLOWED_KIND = 1 as const;
export const NOSTR_RELAY_MUNICIPALITY_ID = "sample-municipality" as const;
export const NOSTR_RELAY_CASE_ID = "sample-case" as const;
export const NOSTR_RELAY_FIXTURE_MARKER = [
  "t",
  "stadtstack-e2e-fixture",
] as const;

export type NostrRelayScope = {
  municipalityId: string;
  caseId: string;
};

export type NostrRelayQuery = {
  eventId: string;
  scope: NostrRelayScope;
  fixtureMarker?: readonly [string, string];
};

export type NostrRelayPublishReceipt = {
  schemaVersion: typeof NOSTR_RELAY_TRANSPORT_SCHEMA_VERSION;
  relayUrl: string;
  eventId: string;
  ok: true;
};

export type NostrRelayQueryReceipt = {
  schemaVersion: typeof NOSTR_RELAY_TRANSPORT_SCHEMA_VERSION;
  relayUrl: string;
  eventId: string;
  scope: NostrRelayScope;
  fixtureMarker: readonly [string, string];
  eose: true;
  events: readonly [NostrEvent];
};

export type NostrRelayPublishAndQueryReceipt = {
  publish: NostrRelayPublishReceipt;
  query: NostrRelayQueryReceipt;
  event: NostrEvent;
};

/**
 * Low-level replaceable Seam. Implementations may use a WebSocket client in a
 * later deployment, but this Interface deliberately exposes no URL dialer or
 * credential reader. A publish must resolve to an explicit OK and a query must
 * resolve to an EOSE-equivalent completion marker.
 */
export type NostrRelayClient = {
  publish(event: NostrEvent): Promise<unknown> | unknown;
  query(filter: NostrRelayQuery): Promise<unknown> | unknown;
};

/** The validated, network-neutral Relay Adapter used by the control plane. */
export interface NostrRelayTransport {
  readonly kind: "nostr-relay" | "nostr-relay-memory";
  readonly relayUrl: string;
  publish(event: NostrEvent): Promise<NostrRelayPublishReceipt>;
  query(filter: NostrRelayQuery): Promise<NostrRelayQueryReceipt>;
  publishAndQuery(
    event: NostrEvent,
    filter: NostrRelayQuery,
  ): Promise<NostrRelayPublishAndQueryReceipt>;
}

export type NostrRelayTransportOptions = {
  relayUrl: string;
  scope?: NostrRelayScope;
  fixtureMarker?: readonly [string, string];
  allowedKinds?: readonly number[];
  allowedSignerPubkeys?: readonly string[];
  fixtureSignerPubkey?: string;
  client: NostrRelayClient;
};

export type InMemoryNostrRelayTransportOptions = Omit<
  NostrRelayTransportOptions,
  "client"
>;

const EVENT_KEYS = new Set([
  "content",
  "created_at",
  "id",
  "kind",
  "pubkey",
  "sig",
  "tags",
]);
const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;
const DEFAULT_FIXTURE_MARKER = [...NOSTR_RELAY_FIXTURE_MARKER] as readonly [string, string];
const FORBIDDEN_SCOPE_TAG_NAMES = new Set([
  "municipality_id",
  "municipalityId",
  "case_id",
  "caseId",
  "scope",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function requireString(value: unknown, error: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(error);
  return value.trim();
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertJsonFrame(value: unknown): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error("nostr_relay_frame_invalid");
  }
  if (typeof serialized !== "string" || utf8Bytes(serialized) > NOSTR_RELAY_MAX_FRAME_BYTES) {
    throw new Error("nostr_relay_frame_too_large");
  }
}

function assertExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>, error: string): void {
  const ownKeys = Reflect.ownKeys(value);
  for (const key of ownKeys) {
    if (typeof key === "symbol" && key.description === "verified" && Reflect.get(value, key) === true) continue;
    if (typeof key !== "string") throw new Error(error);
  }
  const actual = ownKeys.filter((key): key is string => typeof key === "string");
  actual.sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(error);
  }
}

function normalizeScope(value: unknown, error = "nostr_relay_scope_invalid"): NostrRelayScope {
  if (!isObject(value)) throw new Error(error);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || key !== "municipalityId" && key !== "caseId") throw new Error(error);
  }
  const municipalityId = requireString(value.municipalityId, error);
  const caseId = requireString(value.caseId, error);
  if (
    utf8Bytes(municipalityId) > NOSTR_RELAY_MAX_SCOPE_PART_BYTES ||
    utf8Bytes(caseId) > NOSTR_RELAY_MAX_SCOPE_PART_BYTES
  ) {
    throw new Error("nostr_relay_scope_too_large");
  }
  if (
    municipalityId !== NOSTR_RELAY_MUNICIPALITY_ID ||
    caseId !== NOSTR_RELAY_CASE_ID
  ) {
    throw new Error("nostr_relay_scope_invalid");
  }
  return {
    municipalityId,
    caseId,
  };
}

function normalizeMarker(value: unknown): readonly [string, string] {
  if (!Array.isArray(value) || value.length !== 2 || value.some((part) => typeof part !== "string" || part.trim() === "")) {
    throw new Error("nostr_relay_fixture_marker_invalid");
  }
  return [value[0]!.trim(), value[1]!.trim()] as const;
}

function markerEquals(left: readonly [string, string], right: readonly [string, string]): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function normalizeRelayUrl(value: unknown): string {
  const input = requireString(value, "nostr_relay_url_required");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("nostr_relay_url_invalid");
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("nostr_relay_url_invalid");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("nostr_relay_url_invalid");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isLoopback =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "::1";
  const isPrivateIpv4 = (() => {
    const parts = host.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    return parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31;
  })();
  const isSyntheticName =
    host.endsWith(".invalid") ||
    host.endsWith(".test") ||
    host.endsWith(".internal") ||
    host.endsWith(".svc.cluster.local") ||
    host.endsWith(".cluster.local");
  if (!isLoopback && !isPrivateIpv4 && !isSyntheticName) {
    throw new Error("nostr_relay_external_url_forbidden");
  }
  return url.toString().replace(/\/$/, "");
}

export function isAllowedNostrRelayUrl(value: string): boolean {
  try {
    normalizeRelayUrl(value);
    return true;
  } catch {
    return false;
  }
}

function normalizeAllowedSigners(options: NostrRelayTransportOptions | InMemoryNostrRelayTransportOptions): ReadonlySet<string> {
  const candidates = [
    ...(options.allowedSignerPubkeys ?? []),
    ...(options.fixtureSignerPubkey === undefined ? [] : [options.fixtureSignerPubkey]),
  ];
  if (candidates.length === 0) throw new Error("nostr_relay_signer_allowlist_required");
  const signers = candidates.map((value) => requireString(value, "nostr_relay_signer_invalid"));
  if (signers.some((value) => !HEX_64.test(value))) throw new Error("nostr_relay_signer_invalid");
  const unique = [...new Set(signers)];
  if (unique.length !== 1) throw new Error("nostr_relay_signer_allowlist_exactly_one");
  return new Set(unique);
}

function exactTag(tag: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(tag) &&
    tag.length === expected.length &&
    expected.every((part, index) => tag[index] === part)
  );
}

function validateFixtureTags(value: unknown): asserts value is readonly (readonly string[])[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (tag) =>
        !Array.isArray(tag) ||
        tag.some((part) => typeof part !== "string"),
    )
  ) {
    throw new Error("nostr_relay_event_tags_invalid");
  }
  if (value.length > NOSTR_RELAY_MAX_TAGS) {
    throw new Error("nostr_relay_event_tags_too_many");
  }
  for (const tag of value) {
    if (tag.some((part: string) => utf8Bytes(part) > NOSTR_RELAY_MAX_TAG_PART_BYTES)) {
      throw new Error("nostr_relay_event_tag_value_too_large");
    }
  }

  const markerTags = value.filter((tag) => tag[0] === DEFAULT_FIXTURE_MARKER[0]);
  if (markerTags.length !== 1 || !exactTag(markerTags[0], DEFAULT_FIXTURE_MARKER)) {
    throw new Error("nostr_relay_fixture_marker_invalid");
  }
  for (const tag of value) {
    if (tag[0] === DEFAULT_FIXTURE_MARKER[0] && !exactTag(tag, DEFAULT_FIXTURE_MARKER)) {
      throw new Error("nostr_relay_fixture_marker_invalid");
    }
    if (typeof tag[0] === "string" && FORBIDDEN_SCOPE_TAG_NAMES.has(tag[0])) {
      throw new Error("nostr_relay_scope_tag_forbidden");
    }
  }

  const municipalityTags = value.filter((tag) => tag[0] === "municipality");
  const caseTags = value.filter((tag) => tag[0] === "case");
  if (
    municipalityTags.length !== 1 ||
    !exactTag(municipalityTags[0], ["municipality", NOSTR_RELAY_MUNICIPALITY_ID])
  ) {
    throw new Error("nostr_relay_municipality_scope_invalid");
  }
  if (
    caseTags.length !== 1 ||
    !exactTag(caseTags[0], ["case", NOSTR_RELAY_CASE_ID])
  ) {
    throw new Error("nostr_relay_case_scope_invalid");
  }
}

function validateSignedEvent(
  value: unknown,
  expectedScope: NostrRelayScope | undefined,
  allowedSigners: ReadonlySet<string>,
  allowedKinds: ReadonlySet<number>,
): NostrEvent {
  if (!isObject(value)) throw new Error("nostr_relay_event_invalid");
  assertExactKeys(value, EVENT_KEYS, "nostr_relay_event_extra_field");
  if (typeof value.id !== "string" || !HEX_64.test(value.id)) throw new Error("nostr_relay_event_id_invalid");
  if (typeof value.pubkey !== "string" || !HEX_64.test(value.pubkey)) throw new Error("nostr_relay_event_pubkey_invalid");
  if (!allowedSigners.has(value.pubkey)) throw new Error("nostr_relay_signer_not_allowed");
  if (typeof value.sig !== "string" || !HEX_128.test(value.sig)) throw new Error("nostr_relay_event_signature_invalid");
  if (typeof value.content !== "string") throw new Error("nostr_relay_event_content_invalid");
  if (utf8Bytes(value.content) > NOSTR_RELAY_MAX_CONTENT_BYTES) {
    throw new Error("nostr_relay_event_content_too_large");
  }
  validateFixtureTags(value.tags);
  const candidate = {
    id: value.id,
    pubkey: value.pubkey,
    created_at: value.created_at,
    kind: value.kind,
    tags: value.tags,
    content: value.content,
    sig: value.sig,
  } as NostrEvent;
  if (!validateEvent(candidate)) throw new Error("nostr_relay_event_invalid");
  let hash: string;
  try {
    hash = getEventHash(candidate);
  } catch {
    throw new Error("nostr_relay_event_id_invalid");
  }
  if (hash !== candidate.id) throw new Error("nostr_relay_event_id_invalid");
  let signatureValid = false;
  try {
    signatureValid = verifyEvent(candidate);
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) throw new Error("nostr_relay_event_signature_invalid");
  if (!allowedKinds.has(candidate.kind)) throw new Error("nostr_relay_event_kind_forbidden");
  if (expectedScope) {
    if (
      expectedScope.municipalityId !== NOSTR_RELAY_MUNICIPALITY_ID ||
      expectedScope.caseId !== NOSTR_RELAY_CASE_ID
    ) {
      throw new Error("nostr_relay_scope_invalid");
    }
  }
  assertJsonFrame(["EVENT", candidate]);
  return clone(candidate);
}

function canonicalEvent(value: NostrEvent): string {
  return JSON.stringify(value);
}

function assertExplicitOk(value: unknown, eventId: string): void {
  assertJsonFrame(value);
  if (Array.isArray(value)) {
    if (value[0] === "OK" && value[1] === eventId && value[2] === true) return;
    throw new Error("nostr_relay_ok_required");
  }
  if (!isObject(value)) throw new Error("nostr_relay_ok_required");
  const accepted = value.ok === true || value.accepted === true || value.type === "OK" && value.ok === true;
  const returnedIds = [value.eventId, value.id].filter((candidate) => candidate !== undefined);
  if (!accepted || returnedIds.length === 0 || returnedIds.some((candidate) => typeof candidate !== "string" || candidate !== eventId)) {
    throw new Error("nostr_relay_ok_required");
  }
}

function extractQuery(value: unknown): { events: unknown[]; eose: boolean } {
  assertJsonFrame(value);
  if (!isObject(value)) throw new Error("nostr_relay_query_response_invalid");
  if (!Array.isArray(value.events)) throw new Error("nostr_relay_query_events_invalid");
  const eose = value.eose === true || value.completed === true || value.status === "eose" || value.type === "EOSE";
  return { events: value.events, eose };
}

function normalizeQuery(value: NostrRelayQuery, defaultScope?: NostrRelayScope, defaultMarker = DEFAULT_FIXTURE_MARKER): NostrRelayQuery {
  if (!isObject(value)) throw new Error("nostr_relay_query_invalid");
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !["eventId", "scope", "fixtureMarker"].includes(key)) throw new Error("nostr_relay_query_field_forbidden");
  }
  const eventId = requireString(value.eventId, "nostr_relay_query_event_id_required");
  if (!HEX_64.test(eventId)) throw new Error("nostr_relay_query_event_id_invalid");
  const scope = normalizeScope(value.scope === undefined ? defaultScope : value.scope, "nostr_relay_query_scope_required");
  const fixtureMarker = normalizeMarker(value.fixtureMarker === undefined ? defaultMarker : value.fixtureMarker);
  if (!markerEquals(fixtureMarker, defaultMarker)) throw new Error("nostr_relay_fixture_marker_invalid");
  return { eventId, scope, fixtureMarker };
}

function createValidatedTransport(
  options: NostrRelayTransportOptions,
  kind: NostrRelayTransport["kind"],
): NostrRelayTransport {
  if (!options?.client || typeof options.client.publish !== "function" || typeof options.client.query !== "function") {
    throw new Error("nostr_relay_client_required");
  }
  const relayUrl = normalizeRelayUrl(options.relayUrl);
  const allowedSigners = normalizeAllowedSigners(options);
  const rawAllowedKinds = options.allowedKinds ?? [1];
  if (
    !Array.isArray(rawAllowedKinds) ||
    rawAllowedKinds.length !== 1 ||
    rawAllowedKinds[0] !== NOSTR_RELAY_ALLOWED_KIND
  ) {
    throw new Error("nostr_relay_allowed_kinds_invalid");
  }
  const allowedKinds = new Set(rawAllowedKinds);
  const scope = options.scope === undefined ? undefined : normalizeScope(options.scope);
  const marker = normalizeMarker(options.fixtureMarker ?? DEFAULT_FIXTURE_MARKER);
  if (!markerEquals(marker, DEFAULT_FIXTURE_MARKER)) throw new Error("nostr_relay_fixture_marker_invalid");
  const published = new Map<string, NostrEvent>();
  const publishReceipts = new Map<string, NostrRelayPublishReceipt>();

  return {
    kind,
    relayUrl,
    async publish(event: NostrEvent): Promise<NostrRelayPublishReceipt> {
      const validated = validateSignedEvent(event, scope, allowedSigners, allowedKinds);
      const existing = published.get(validated.id);
      if (existing) {
        if (canonicalEvent(existing) !== canonicalEvent(validated)) throw new Error("nostr_relay_publish_conflict");
        return { ...publishReceipts.get(validated.id)! };
      }
      const ack = await options.client.publish(clone(validated));
      assertExplicitOk(ack, validated.id);
      const receipt: NostrRelayPublishReceipt = {
        schemaVersion: NOSTR_RELAY_TRANSPORT_SCHEMA_VERSION,
        relayUrl,
        eventId: validated.id,
        ok: true,
      };
      published.set(validated.id, validated);
      publishReceipts.set(validated.id, receipt);
      return { ...receipt };
    },
    async query(filter: NostrRelayQuery): Promise<NostrRelayQueryReceipt> {
      const normalized = normalizeQuery(filter, scope, marker);
      const result = extractQuery(await options.client.query({ ...normalized }));
      if (!result.eose) throw new Error("nostr_relay_eose_required");
      if (result.events.length === 0) throw new Error("nostr_relay_event_missing");
      if (result.events.length !== 1) throw new Error("nostr_relay_extra_events");
      const returned = validateSignedEvent(result.events[0], normalized.scope, allowedSigners, allowedKinds);
      if (returned.id !== normalized.eventId) throw new Error("nostr_relay_event_id_mismatch");
      const expected = published.get(returned.id);
      if (expected && canonicalEvent(expected) !== canonicalEvent(returned)) throw new Error("nostr_relay_event_conflict");
      return {
        schemaVersion: NOSTR_RELAY_TRANSPORT_SCHEMA_VERSION,
        relayUrl,
        eventId: normalized.eventId,
        scope: { ...normalized.scope },
        fixtureMarker: [...marker] as readonly [string, string],
        eose: true,
        events: [returned],
      };
    },
    async publishAndQuery(event: NostrEvent, filter: NostrRelayQuery): Promise<NostrRelayPublishAndQueryReceipt> {
      const validated = validateSignedEvent(event, scope, allowedSigners, allowedKinds);
      const normalized = normalizeQuery(filter, scope, marker);
      if (normalized.eventId !== validated.id) throw new Error("nostr_relay_event_id_mismatch");
      const publish = await this.publish(validated);
      const query = await this.query(normalized);
      return { publish, query, event: clone(query.events[0]!) };
    },
  };
}

/** Build a validated Relay Adapter over an injected client Seam. */
export function createNostrRelayTransport(options: NostrRelayTransportOptions): NostrRelayTransport {
  return createValidatedTransport(options, "nostr-relay");
}

/**
 * Deterministic local Relay Implementation. It models NIP-01 OK/EOSE
 * acknowledgements without opening a socket and is intended for tests only.
 */
export function createInMemoryNostrRelayTransport(
  options: InMemoryNostrRelayTransportOptions,
): NostrRelayTransport & { readonly publishCount: number; readonly queryCount: number } {
  let publishCount = 0;
  let queryCount = 0;
  const events = new Map<string, NostrEvent>();
  const relay = createValidatedTransport({
    ...options,
    client: {
      publish(event) {
        publishCount += 1;
        const existing = events.get(event.id);
        if (existing && canonicalEvent(existing) !== canonicalEvent(event)) return { ok: false, eventId: event.id };
        events.set(event.id, clone(event));
        return { ok: true, eventId: event.id };
      },
      query(filter) {
        queryCount += 1;
        const event = events.get(filter.eventId);
        return { events: event ? [clone(event)] : [], eose: true };
      },
    },
  }, "nostr-relay-memory") as NostrRelayTransport & { readonly publishCount: number; readonly queryCount: number };
  Object.defineProperties(relay, {
    publishCount: { enumerable: true, get: () => publishCount },
    queryCount: { enumerable: true, get: () => queryCount },
  });
  return relay;
}

export const createMemoryNostrRelayTransport = createInMemoryNostrRelayTransport;
export const createNostrRelayAdapter = createNostrRelayTransport;
