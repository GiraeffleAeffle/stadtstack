import { createHash } from "node:crypto";

import {
  STADTSTACK_E2E_FIXTURE_TAG,
  createNostrDiscussionAdapter,
  type DiscussionArtifact,
  type DiscussionScope,
} from "./adapters/discussion-adapter.ts";
import type { Event as NostrEvent } from "nostr-tools/pure";

/** The only authority binding admitted by the municipality-neutral tracer. */
export type AuthorityBinding = "none";

export type ActorClass = "citizen" | "public" | "administration";

export type ActorBinding = {
  actorId: string;
  actorClass: ActorClass;
};

export type CaseJurisdiction = {
  scheme: "test";
  value: string;
};

export type SourceReference = {
  type: "nostr_event";
  id: string;
  ref: string;
};

export type CommandEnvelope = {
  schemaVersion: "command_envelope_v1";
  commandType: "intake_discussion_v1";
  caseId: string;
  actorBinding: ActorBinding;
  expectedCaseVersion: number;
  idempotencyKey: string;
  visibility: "private_case";
  policyVersion: string;
  payload: {
    discussion: DiscussionArtifact;
  };
  [key: string]: unknown;
};

export type QueryEnvelope = {
  schemaVersion: "query_envelope_v1";
  queryType: "case_projection_v1";
  caseId: string;
  actorBinding: ActorBinding;
  visibility: "public" | "administration";
  policyVersion: string;
  atCaseVersion: number | null;
  [key: string]: unknown;
};

export type CommandReceipt = {
  caseVersion: number;
  eventIds: string[];
  journalHeadChecksum: string;
};

export type CaseEventV1 = {
  schemaVersion: "case_event_v1";
  eventId: string;
  caseId: string;
  caseVersion: number;
  eventType: "case_created_v1" | "discussion_recorded_v1";
  priorEventChecksum: string;
  actorBinding: ActorBinding;
  payloadChecksum: string;
  correctionOf: null;
  eventChecksum: string;
};

export type DiscussionProjection = {
  schemaVersion: "discussion_projection_v1";
  id: string;
  source: "nostr";
  sourceRef: string;
  sourceReference: SourceReference;
  scope: DiscussionScope;
  content: string;
  event: DiscussionArtifact["event"];
  verificationProof: DiscussionArtifact["verificationProof"];
  authorityBinding: AuthorityBinding;
  provenance: DiscussionArtifact;
};

export type SuggestionProjection = {
  schemaVersion: "suggestion_projection_v1";
  id: string;
  discussionId: string;
  discussionRef: SourceReference;
  title: string;
  status: "draft";
  authorityBinding: AuthorityBinding;
  provenance: SourceReference;
};

export type CaseProjection = {
  schemaVersion: "case_projection_v1";
  caseId: string;
  jurisdiction: CaseJurisdiction;
  municipalityId: string;
  sourceScope: DiscussionScope;
  authorityBinding: AuthorityBinding;
  formalDecision: null;
  discussion: DiscussionProjection;
  discussions: DiscussionProjection[];
  suggestion: SuggestionProjection;
  suggestions: SuggestionProjection[];
  provenance: DiscussionArtifact;
};

export type ProjectionEnvelope = {
  schemaVersion: "projection_envelope_v1";
  caseId: string;
  caseVersion: number;
  journalHeadChecksum: string;
  visibility: "public" | "administration";
  policyVersion: string;
  projection: CaseProjection;
};

export type CivicCaseCoordinator = {
  handle(command: CommandEnvelope): CommandReceipt;
  project(query: QueryEnvelope): ProjectionEnvelope;
};

export type CivicCaseCoordinatorOptions = {
  /** Source scope used to bind municipality/case tags on the NIP-01 event. */
  scope?: DiscussionScope;
  municipalityId?: string;
  sourceCaseId?: string;
  /** Alias for canonicalCaseId; retained for callers that name the Case ID directly. */
  caseId?: string;
  /** Fixed test jurisdiction value used in the canonical Case ID. */
  jurisdictionValue?: string;
  jurisdiction?: Partial<CaseJurisdiction> & { value?: string };
  /** A pinned UUID-v7. Random UUID generation is deliberately unavailable. */
  uuidV7?: string;
  caseUuidV7?: string;
  canonicalCaseId?: string;
  /** The first release uses one policy version for all commands/queries. */
  policyVersion?: string;
  actors?: readonly ActorBinding[];
  actorRegistry?: readonly ActorBinding[] | Readonly<Record<string, ActorBinding>>;
  syntheticFixtureOnly?: boolean;
  allowedKinds?: readonly number[];
  allowedSignerPubkeys?: readonly string[];
  fixturePubkey?: string;
  fixtureSignerPubkey?: string;
  [key: string]: unknown;
};

export type CivicCaseCoordinatorConfig = CivicCaseCoordinatorOptions;
export type CaseEvent = CaseEventV1;

type InternalCoordinatorOptions = {
  scope?: DiscussionScope;
  jurisdiction: CaseJurisdiction;
  caseId: string;
  policyVersion: string;
  actors: ReadonlyMap<string, ActorBinding>;
  syntheticFixtureOnly: boolean;
  allowedKinds: readonly number[];
  allowedSignerPubkeys?: ReadonlySet<string>;
};

type JournalState = {
  events: StoredCaseEvent[];
  headChecksum: string;
};

type CaseCreatedPayload = {
  caseId: string;
  jurisdiction: CaseJurisdiction;
  authorityBinding: AuthorityBinding;
};

type DiscussionRecordedPayload = {
  discussion: DiscussionArtifact;
  suggestion: {
    id: string;
    discussionId: string;
    title: string;
    authorityBinding: AuthorityBinding;
  };
  authorityBinding: AuthorityBinding;
};

type StoredCaseEvent = CaseEventV1 & {
  /** Immutable payload retained only behind the coordinator seam. */
  payload: CaseCreatedPayload | DiscussionRecordedPayload;
};

const COMMAND_KEYS = new Set([
  "schemaVersion",
  "commandType",
  "caseId",
  "actorBinding",
  "expectedCaseVersion",
  "idempotencyKey",
  "visibility",
  "policyVersion",
  "payload",
]);
const QUERY_KEYS = new Set([
  "schemaVersion",
  "queryType",
  "caseId",
  "actorBinding",
  "visibility",
  "policyVersion",
  "atCaseVersion",
]);
const PAYLOAD_KEYS = new Set(["discussion"]);
const ACTOR_KEYS = new Set(["actorId", "actorClass"]);
const ARTIFACT_KEYS = new Set([
  "schemaVersion",
  "id",
  "source",
  "sourceRef",
  "municipalityId",
  "caseId",
  "authorityBinding",
  "verificationProof",
  "event",
]);
const PROOF_KEYS = new Set(["kind", "verified", "signature"]);
const EVENT_KEYS = new Set([
  "id",
  "pubkey",
  "createdAt",
  "kind",
  "content",
  "tags",
  "relayRefs",
]);
const SCOPE_KEYS = new Set(["municipalityId", "caseId"]);

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CASE_ID = /^urn:stadtstack:case:test:([A-Za-z0-9._~-]+):([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SECRET_MARKER = /(?:nsec1|private[_ -]?key|secret[_ -]?key|password|credential|token|wallet|ballot|participant[_ -]?id|user[_ -]?id)/i;
const SECRET_VALUE_MARKER = /(?:\bnsec1[a-z0-9-]{8,}\b|private[_ -]?key|secret[_ -]?key|password\s*[:=]|credential\s*[:=]|wallet\s*[:=]|ballot\s*[:=])/i;

/** Deterministic fixture UUID-v7. It is intentionally not generated at runtime. */
export const DEFAULT_SYNTHETIC_UUID_V7 = "018f0000-0000-7000-8000-000000000001";
export const CASE_EVENT_SCHEMA_VERSION = "case_event_v1" as const;
export const COMMAND_ENVELOPE_SCHEMA_VERSION = "command_envelope_v1" as const;
export const QUERY_ENVELOPE_SCHEMA_VERSION = "query_envelope_v1" as const;
export const PROJECTION_ENVELOPE_SCHEMA_VERSION = "projection_envelope_v1" as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(code: string): never {
  throw new Error(code);
}

function ownKeys(value: unknown, allowed: ReadonlySet<string>, path: string): void {
  if (!isRecord(value)) fail(`${path}_invalid`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      fail(`unknown_field:${path}.${String(key)}`);
    }
    if (SECRET_MARKER.test(key)) {
      fail(`private_field_forbidden:${path}.${key}`);
    }
  }
}

function nonEmptyString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(code);
  if (SECRET_MARKER.test(value)) fail(`secret_material_forbidden:${code}`);
  return value.trim();
}

function safeInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail(code);
  return value as number;
}

function canonicalize(value: unknown, path = "value"): unknown {
  if (value === undefined) fail(`canonical_value_invalid:${path}`);
  if (typeof value === "symbol" || typeof value === "function") {
    fail(`canonical_value_invalid:${path}`);
  }
  if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) {
    fail(`canonical_value_invalid:${path}`);
  }
  if (typeof value === "bigint") fail(`canonical_value_invalid:${path}`);
  if (Array.isArray(value)) return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail(`canonical_value_invalid:${path}.[symbol]`);
    result[key] = canonicalize(value[key], `${path}.${key}`);
  }
  return Object.fromEntries(Object.keys(result).sort().map((key) => [key, result[key]]));
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function scopesEqual(left: DiscussionScope, right: DiscussionScope): boolean {
  return left.municipalityId === right.municipalityId && left.caseId === right.caseId;
}

function normalizeScope(value: unknown, code = "discussion_scope_missing"): DiscussionScope {
  ownKeys(value, SCOPE_KEYS, "scope");
  const municipalityId = nonEmptyString((value as Record<string, unknown>).municipalityId, code);
  const caseId = nonEmptyString((value as Record<string, unknown>).caseId, code);
  return { municipalityId, caseId };
}

function normalizeActor(value: unknown, code = "actor_binding_required"): ActorBinding {
  ownKeys(value, ACTOR_KEYS, "actorBinding");
  const actor = value as Record<string, unknown>;
  const actorId = nonEmptyString(actor.actorId, code);
  const actorClass = actor.actorClass;
  if (actorClass !== "citizen" && actorClass !== "public" && actorClass !== "administration") {
    fail("actor_role_self_assertion");
  }
  return { actorId, actorClass };
}

function normalizeArtifactShape(value: unknown): DiscussionArtifact {
  ownKeys(value, ARTIFACT_KEYS, "discussion");
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== "discussion_artifact_v1") fail("discussion_proof_invalid");
  if (input.source !== "nostr") fail("discussion_proof_invalid");
  if (input.authorityBinding !== "none") fail("authority_field_forbidden:discussion.authorityBinding");
  const id = nonEmptyString(input.id, "discussion_proof_invalid");
  const sourceRef = nonEmptyString(input.sourceRef, "discussion_proof_invalid");
  const municipalityId = nonEmptyString(input.municipalityId, "discussion_scope_missing");
  const caseId = nonEmptyString(input.caseId, "discussion_scope_missing");
  if (!isRecord(input.verificationProof)) fail("discussion_proof_invalid");
  ownKeys(input.verificationProof, PROOF_KEYS, "discussion.verificationProof");
  const proof = input.verificationProof;
  if (proof.kind !== "nostr_nip01" || proof.verified !== true) fail("discussion_proof_invalid");
  const signature = nonEmptyString(proof.signature, "discussion_signature_required");
  if (!isRecord(input.event)) fail("discussion_event_invalid");
  ownKeys(input.event, EVENT_KEYS, "discussion.event");
  const event = input.event;
  const eventId = nonEmptyString(event.id, "discussion_event_invalid");
  const pubkey = nonEmptyString(event.pubkey, "discussion_event_invalid");
  const createdAt = safeInteger(event.createdAt, "discussion_event_invalid");
  const kind = safeInteger(event.kind, "discussion_event_invalid");
  const content = nonEmptyString(event.content, "discussion_event_invalid");
  if (SECRET_VALUE_MARKER.test(content)) fail("secret_material_forbidden:discussion.event.content");
  if (!Array.isArray(event.tags) || event.tags.some((tag) => !Array.isArray(tag) || (tag as unknown[]).some((part: unknown) => typeof part !== "string"))) {
    fail("discussion_event_invalid");
  }
  if (event.tags.some((tag) => (tag as unknown[]).some((part: unknown) => typeof part === "string" && SECRET_VALUE_MARKER.test(part)))) {
    fail("secret_material_forbidden:discussion.event.tags");
  }
  if (!Array.isArray(event.relayRefs) || event.relayRefs.some((ref) => typeof ref !== "string")) {
    fail("discussion_event_invalid");
  }
  if (event.relayRefs.some((ref) => SECRET_VALUE_MARKER.test(ref))) {
    fail("secret_material_forbidden:discussion.event.relayRefs");
  }
  if (eventId !== id) fail("discussion_proof_invalid");
  if (!sourceRef.startsWith("nostr://event/")) fail("discussion_proof_invalid");
  return {
    schemaVersion: "discussion_artifact_v1",
    id,
    source: "nostr",
    sourceRef,
    municipalityId,
    caseId,
    authorityBinding: "none",
    verificationProof: {
      kind: "nostr_nip01",
      verified: true,
      signature,
    },
    event: {
      id: eventId,
      pubkey,
      createdAt,
      kind,
      content,
      tags: event.tags.map((tag) => [...tag] as string[]),
      relayRefs: [...event.relayRefs],
    },
  };
}

function artifactToNip01Event(artifact: DiscussionArtifact): Record<string, unknown> {
  const event = artifact.event;
  if (artifact.verificationProof.kind !== "nostr_nip01") fail("discussion_proof_invalid");
  return {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.createdAt,
    kind: event.kind,
    tags: event.tags.map((tag) => [...tag]),
    content: event.content,
    sig: artifact.verificationProof.signature,
  };
}

function normalizeOptions(options: CivicCaseCoordinatorOptions = {}): InternalCoordinatorOptions {
  ownKeys(options, new Set([
    "scope",
    "municipalityId",
    "sourceCaseId",
    "caseId",
    "jurisdictionValue",
    "jurisdiction",
    "uuidV7",
    "caseUuidV7",
    "canonicalCaseId",
    "policyVersion",
    "actors",
    "actorRegistry",
    "syntheticFixtureOnly",
    "allowedKinds",
    "allowedSignerPubkeys",
    "fixturePubkey",
    "fixtureSignerPubkey",
  ]), "options");

  const rawScope = options.scope ?? (
    options.municipalityId !== undefined || options.sourceCaseId !== undefined
      ? {
          municipalityId: options.municipalityId,
          caseId: options.sourceCaseId,
        }
      : undefined
  );
  const scope = rawScope === undefined ? undefined : normalizeScope(rawScope, "scope_required");
  if (options.municipalityId !== undefined && scope && options.municipalityId !== scope.municipalityId) fail("scope_invalid");
  const jurisdictionObject = options.jurisdiction;
  if (jurisdictionObject !== undefined) {
    if (!isRecord(jurisdictionObject)) fail("jurisdiction_invalid");
    ownKeys(jurisdictionObject, new Set(["scheme", "value"]), "jurisdiction");
    if (jurisdictionObject.scheme !== undefined && jurisdictionObject.scheme !== "test") fail("synthetic_case_namespace_forbidden");
  }
  const jurisdictionValue = nonEmptyString(
    options.jurisdictionValue ?? jurisdictionObject?.value ?? scope?.municipalityId ?? "synthetic",
    "jurisdiction_value_required",
  );
  if (!/^[A-Za-z0-9._~-]+$/.test(jurisdictionValue)) fail("jurisdiction_value_invalid");
  const jurisdiction: CaseJurisdiction = { scheme: "test", value: jurisdictionValue };
  const configuredUuid = options.uuidV7 ?? options.caseUuidV7 ?? DEFAULT_SYNTHETIC_UUID_V7;
  if (typeof configuredUuid !== "string" || !UUID_V7.test(configuredUuid)) fail("case_id_invalid");
  const derivedCaseId = `urn:stadtstack:case:test:${jurisdiction.value}:${configuredUuid}`;
  const configuredCaseId = options.canonicalCaseId ?? options.caseId ?? derivedCaseId;
  if (typeof configuredCaseId !== "string" || !CASE_ID.test(configuredCaseId) || configuredCaseId !== derivedCaseId) {
    fail("case_id_invalid");
  }
  const policyVersion = nonEmptyString(options.policyVersion ?? "case-intake-v1", "policy_version_invalid");
  const actorValues = options.actors ?? options.actorRegistry ?? [
    { actorId: "synthetic:citizen-1", actorClass: "citizen" },
    { actorId: "synthetic:public-1", actorClass: "public" },
    { actorId: "synthetic:administration-1", actorClass: "administration" },
  ];
  const actorList = Array.isArray(actorValues) ? actorValues : Object.values(actorValues);
  if (actorList.length === 0) fail("actor_registry_required");
  const actors = new Map<string, ActorBinding>();
  for (const actor of actorList) {
    const normalized = normalizeActor(actor, "actor_registry_invalid");
    if (actors.has(normalized.actorId)) fail("actor_registry_unique");
    actors.set(normalized.actorId, normalized);
  }
  if (options.syntheticFixtureOnly === false) fail("synthetic_fixture_required");
  const allowedKinds = options.allowedKinds ?? [1];
  if (!Array.isArray(allowedKinds) || allowedKinds.length !== 1 || allowedKinds[0] !== 1) fail("discussion_kind_forbidden");
  const configuredPubkeys = options.allowedSignerPubkeys ?? (
    options.fixturePubkey === undefined && options.fixtureSignerPubkey === undefined
      ? undefined
      : [options.fixturePubkey ?? options.fixtureSignerPubkey!]
  );
  let allowedSignerPubkeys: ReadonlySet<string> | undefined;
  if (configuredPubkeys !== undefined) {
    if (!Array.isArray(configuredPubkeys) || configuredPubkeys.length === 0) fail("discussion_signer_not_allowed");
    const normalizedPubkeys = configuredPubkeys.map((pubkey) => nonEmptyString(pubkey, "discussion_signer_not_allowed"));
    if (normalizedPubkeys.some((pubkey) => !/^[0-9a-f]{64}$/.test(pubkey))) fail("discussion_signer_not_allowed");
    allowedSignerPubkeys = new Set(normalizedPubkeys);
  }
  return {
    scope,
    jurisdiction,
    caseId: configuredCaseId,
    policyVersion,
    actors,
    syntheticFixtureOnly: true,
    allowedKinds: [...allowedKinds],
    allowedSignerPubkeys,
  };
}

function genesisChecksum(caseId: string): string {
  return sha256({ schemaVersion: "case_genesis_v1", caseId });
}

function appendEvent(
  state: JournalState,
  options: InternalCoordinatorOptions,
  actorBinding: ActorBinding,
  eventType: CaseEventV1["eventType"],
  payload: unknown,
): StoredCaseEvent {
  const caseVersion = state.events.length + 1;
  const priorEventChecksum = state.events.length === 0
    ? genesisChecksum(options.caseId)
    : state.headChecksum;
  const payloadChecksum = sha256(payload);
  const eventWithoutChecksum = {
    schemaVersion: CASE_EVENT_SCHEMA_VERSION,
    eventId: `urn:stadtstack:case-event:${options.caseId}:${caseVersion}`,
    caseId: options.caseId,
    caseVersion,
    eventType,
    priorEventChecksum,
    actorBinding,
    payloadChecksum,
    correctionOf: null,
  } as const;
  const event: StoredCaseEvent = {
    ...eventWithoutChecksum,
    eventChecksum: sha256(eventWithoutChecksum),
    payload: clone(payload) as CaseCreatedPayload | DiscussionRecordedPayload,
  };
  state.events.push(event);
  state.headChecksum = event.eventChecksum;
  return clone(event);
}

function replayJournal(
  state: JournalState,
  options: InternalCoordinatorOptions,
): { discussion: DiscussionArtifact; suggestion: DiscussionRecordedPayload["suggestion"] } | undefined {
  let prior = genesisChecksum(options.caseId);
  let discussion: DiscussionArtifact | undefined;
  let suggestion: DiscussionRecordedPayload["suggestion"] | undefined;
  for (const [index, event] of state.events.entries()) {
    const expectedVersion = index + 1;
    if (
      event.schemaVersion !== CASE_EVENT_SCHEMA_VERSION ||
      event.caseId !== options.caseId ||
      event.caseVersion !== expectedVersion ||
      event.priorEventChecksum !== prior ||
      !SHA256.test(event.payloadChecksum) ||
      !SHA256.test(event.eventChecksum) ||
      event.correctionOf !== null ||
      event.eventId !== `urn:stadtstack:case-event:${options.caseId}:${expectedVersion}`
    ) {
      fail("journal_chain_invalid");
    }
    const { payload, eventChecksum, ...eventWithoutChecksum } = event;
    if (sha256(eventWithoutChecksum) !== eventChecksum) fail("event_checksum_invalid");
    if (sha256(payload) !== event.payloadChecksum) fail("payload_checksum_invalid");
    if (event.eventType === "case_created_v1") {
      const casePayload = payload as CaseCreatedPayload;
      if (index !== 0 || casePayload.caseId !== options.caseId || casePayload.authorityBinding !== "none") {
        fail("journal_chain_invalid");
      }
    } else if (event.eventType === "discussion_recorded_v1") {
      const discussionPayload = payload as DiscussionRecordedPayload;
      if (index !== 1 || discussionPayload.authorityBinding !== "none") fail("journal_chain_invalid");
      const candidate = normalizeArtifactShape(discussionPayload.discussion);
      if (!candidate || candidate.id !== candidate.event.id) fail("journal_chain_invalid");
      if (
        !isRecord(discussionPayload.suggestion) ||
        typeof discussionPayload.suggestion.id !== "string" ||
        typeof discussionPayload.suggestion.discussionId !== "string" ||
        typeof discussionPayload.suggestion.title !== "string" ||
        discussionPayload.suggestion.authorityBinding !== "none" ||
        discussionPayload.suggestion.discussionId !== candidate.id
      ) {
        fail("journal_chain_invalid");
      }
      discussion = clone(candidate);
      suggestion = clone(discussionPayload.suggestion);
    } else {
      fail("journal_chain_invalid");
    }
    prior = eventChecksum;
  }
  if (state.headChecksum !== prior) fail("journal_chain_invalid");
  return discussion && suggestion ? { discussion, suggestion } : undefined;
}

function normalizeAndVerifyDiscussion(
  artifactInput: unknown,
  options: InternalCoordinatorOptions,
): DiscussionArtifact {
  const artifact = normalizeArtifactShape(artifactInput);
  const artifactScope = { municipalityId: artifact.municipalityId, caseId: artifact.caseId };
  if (options.scope && !scopesEqual(artifactScope, options.scope)) fail("discussion_scope_mismatch");
  const municipalityTags = artifact.event.tags.filter((tag) => tag[0] === "municipality");
  const caseTags = artifact.event.tags.filter((tag) => tag[0] === "case");
  if (artifact.event.tags.some((tag) => (tag[0] === "municipality" || tag[0] === "case") && tag.length !== 2)) {
    fail("discussion_scope_invalid");
  }
  if (municipalityTags.length !== 1 || municipalityTags[0]?.[1] !== artifact.municipalityId || caseTags.length !== 1 || caseTags[0]?.[1] !== artifact.caseId) {
    fail("discussion_scope_mismatch");
  }
  if (artifact.event.tags.some((tag) => (tag[0] === "municipality_id" || tag[0] === "municipalityId" || tag[0] === "case_id" || tag[0] === "caseId"))) {
    fail("discussion_scope_invalid");
  }
  const fixtureMarkers = artifact.event.tags.filter((tag) => tag[0] === STADTSTACK_E2E_FIXTURE_TAG[0]);
  if (fixtureMarkers.length !== 1 || fixtureMarkers[0]?.length !== 2 || fixtureMarkers[0]?.[1] !== STADTSTACK_E2E_FIXTURE_TAG[1]) {
    fail("discussion_fixture_marker_required");
  }
  if (options.allowedSignerPubkeys && !options.allowedSignerPubkeys.has(artifact.event.pubkey)) {
    fail("discussion_signer_not_allowed");
  }
  if (!options.allowedSignerPubkeys) {
    fail("discussion_signer_not_allowed");
  }
  const adapter = createNostrDiscussionAdapter({
    scope: options.scope,
    allowedKinds: options.allowedKinds,
    syntheticFixtureOnly: options.syntheticFixtureOnly,
  });
  let normalized: DiscussionArtifact;
  try {
    normalized = adapter.normalize(artifactToNip01Event(artifact) as NostrEvent);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("discussion_event_invalid");
  }
  if (canonicalJson(normalized) !== canonicalJson(artifact)) fail("discussion_proof_invalid");
  return clone(normalized);
}

function discussionProjection(artifact: DiscussionArtifact): DiscussionProjection {
  const sourceReference: SourceReference = {
    type: "nostr_event",
    id: artifact.event.id,
    ref: artifact.sourceRef,
  };
  return {
    schemaVersion: "discussion_projection_v1",
    id: artifact.id,
    source: "nostr",
    sourceRef: artifact.sourceRef,
    sourceReference,
    scope: { municipalityId: artifact.municipalityId, caseId: artifact.caseId },
    content: artifact.event.content,
    event: clone(artifact.event),
    verificationProof: clone(artifact.verificationProof),
    authorityBinding: "none",
    provenance: clone(artifact),
  };
}

function suggestionProjection(
  artifact: DiscussionArtifact,
  payload?: DiscussionRecordedPayload["suggestion"],
): SuggestionProjection {
  const discussionReference: SourceReference = {
    type: "nostr_event",
    id: artifact.event.id,
    ref: artifact.sourceRef,
  };
  const id = payload?.id ?? `urn:stadtstack:suggestion:${artifact.event.id}`;
  return {
    schemaVersion: "suggestion_projection_v1",
    id,
    discussionId: artifact.id,
    discussionRef: discussionReference,
    title: payload?.title ?? artifact.event.content,
    status: "draft",
    authorityBinding: "none",
    provenance: discussionReference,
  };
}

function suggestionPayload(artifact: DiscussionArtifact): DiscussionRecordedPayload["suggestion"] {
  return {
    id: `urn:stadtstack:suggestion:${artifact.event.id}`,
    discussionId: artifact.id,
    title: artifact.event.content,
    authorityBinding: "none",
  };
}

function buildProjection(
  options: InternalCoordinatorOptions,
  replayed: { discussion: DiscussionArtifact; suggestion: DiscussionRecordedPayload["suggestion"] },
): CaseProjection {
  const { discussion } = replayed;
  const projectedDiscussion = discussionProjection(discussion);
  const projectedSuggestion = suggestionProjection(discussion, replayed.suggestion);
  return {
    schemaVersion: "case_projection_v1",
    caseId: options.caseId,
    jurisdiction: clone(options.jurisdiction),
    municipalityId: discussion.municipalityId,
    sourceScope: { municipalityId: discussion.municipalityId, caseId: discussion.caseId },
    authorityBinding: "none",
    formalDecision: null,
    discussion: projectedDiscussion,
    discussions: [clone(projectedDiscussion)],
    suggestion: projectedSuggestion,
    suggestions: [clone(projectedSuggestion)],
    provenance: clone(discussion),
  };
}

function normalizeCommand(command: CommandEnvelope): {
  actor: ActorBinding;
  discussion: DiscussionArtifact;
  expectedCaseVersion: number;
  idempotencyKey: string;
  caseId: string;
  policyVersion: string;
} {
  ownKeys(command, COMMAND_KEYS, "envelope");
  if (!isRecord(command) || command.schemaVersion !== COMMAND_ENVELOPE_SCHEMA_VERSION) fail("schema_version_unsupported");
  if (command.commandType !== "intake_discussion_v1") fail("command_type_invalid");
  const caseId = nonEmptyString(command.caseId, "case_id_required");
  const actor = normalizeActor(command.actorBinding);
  const expectedCaseVersion = safeInteger(command.expectedCaseVersion, "expected_case_version_invalid");
  if (expectedCaseVersion < 0) fail("expected_case_version_invalid");
  const idempotencyKey = nonEmptyString(command.idempotencyKey, "idempotency_key_required");
  if (idempotencyKey.length > 256) fail("idempotency_key_invalid");
  if (command.visibility !== "private_case") fail("visibility_invalid");
  const policyVersion = nonEmptyString(command.policyVersion, "policy_version_invalid");
  if (!isRecord(command.payload)) fail("payload_invalid");
  ownKeys(command.payload, PAYLOAD_KEYS, "payload");
  const discussion = normalizeArtifactShape(command.payload.discussion);
  return {
    actor,
    discussion,
    expectedCaseVersion,
    idempotencyKey,
    caseId,
    policyVersion,
  };
}

function normalizeQuery(query: QueryEnvelope): {
  query: Record<string, unknown>;
  actor: ActorBinding;
  caseId: string;
  visibility: "public" | "administration";
  policyVersion: string;
  atCaseVersion: number | null;
} {
  ownKeys(query, QUERY_KEYS, "query");
  if (!isRecord(query) || query.schemaVersion !== QUERY_ENVELOPE_SCHEMA_VERSION) fail("schema_version_unsupported");
  if (query.queryType !== "case_projection_v1") fail("query_type_invalid");
  const caseId = nonEmptyString(query.caseId, "case_id_required");
  const actor = normalizeActor(query.actorBinding);
  const visibility = query.visibility;
  if (visibility !== "public" && visibility !== "administration") fail("visibility_invalid");
  const policyVersion = nonEmptyString(query.policyVersion, "policy_version_invalid");
  if (query.atCaseVersion !== null && query.atCaseVersion !== undefined) {
    const atCaseVersion = safeInteger(query.atCaseVersion, "expected_case_version_invalid");
    if (atCaseVersion < 0) fail("expected_case_version_invalid");
    return {
      query: clone(query),
      actor,
      caseId,
      visibility,
      policyVersion,
      atCaseVersion,
    };
  }
  if (query.atCaseVersion === undefined) fail("at_case_version_required");
  return {
    query: clone(query),
    actor,
    caseId,
    visibility,
    policyVersion,
    atCaseVersion: null,
  };
}

function cloneReceipt(receipt: CommandReceipt): CommandReceipt {
  return { caseVersion: receipt.caseVersion, eventIds: [...receipt.eventIds], journalHeadChecksum: receipt.journalHeadChecksum };
}

export function createCivicCaseCoordinator(
  input: CivicCaseCoordinatorOptions = {},
): CivicCaseCoordinator {
  const options = normalizeOptions(input);
  const state: JournalState = {
    events: [],
    headChecksum: genesisChecksum(options.caseId),
  };
  const idempotency = new Map<string, { fingerprint: string; receipt: CommandReceipt }>();
  let initialAppendDone = false;

  const handle = (command: CommandEnvelope): CommandReceipt => {
    const normalized = normalizeCommand(command);
    if (normalized.caseId !== options.caseId) fail("case_id_invalid");
    if (normalized.policyVersion !== options.policyVersion) fail("policy_version_invalid");
    const registeredActor = options.actors.get(normalized.actor.actorId);
    if (!registeredActor) fail("actor_not_registered");
    if (registeredActor.actorClass !== normalized.actor.actorClass) fail("actor_binding_mismatch");
    if (registeredActor.actorClass !== "citizen") fail("actor_role_forbidden");
    const discussion = normalizeAndVerifyDiscussion(normalized.discussion, options);
    const fingerprint = sha256({
      schemaVersion: COMMAND_ENVELOPE_SCHEMA_VERSION,
      commandType: "intake_discussion_v1",
      caseId: normalized.caseId,
      actorBinding: normalized.actor,
      expectedCaseVersion: normalized.expectedCaseVersion,
      visibility: "private_case",
      policyVersion: normalized.policyVersion,
      payload: { discussion },
    });
    const previous = idempotency.get(normalized.idempotencyKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint) fail("idempotency_conflict");
      return cloneReceipt(previous.receipt);
    }
    if (normalized.expectedCaseVersion !== state.events.length) fail("case_version_conflict");
    const existingDiscussion = replayJournal(state, options);
    if (existingDiscussion) {
      if (canonicalJson(existingDiscussion.discussion) === canonicalJson(discussion)) fail("discussion_already_recorded");
      fail("discussion_conflict");
    }
    if (initialAppendDone) fail("case_version_conflict");

    // Build the complete append on a temporary clone so a later validation
    // failure cannot leave a partial journal behind.
    const nextState: JournalState = {
      events: state.events.map((event) => clone(event)),
      headChecksum: state.headChecksum,
    };
    const payloadCase = {
      caseId: options.caseId,
      jurisdiction: options.jurisdiction,
      authorityBinding: "none" as const,
    };
    const payloadDiscussion = {
      discussion: clone(discussion),
      suggestion: suggestionPayload(discussion),
      authorityBinding: "none" as const,
    };
    const appended = [
      appendEvent(nextState, options, normalized.actor, "case_created_v1", payloadCase),
      appendEvent(nextState, options, normalized.actor, "discussion_recorded_v1", payloadDiscussion),
    ];
    const receipt: CommandReceipt = {
      caseVersion: nextState.events.length,
      eventIds: appended.map((event) => event.eventId),
      journalHeadChecksum: nextState.headChecksum,
    };
    state.events = nextState.events;
    state.headChecksum = nextState.headChecksum;
    initialAppendDone = true;
    idempotency.set(normalized.idempotencyKey, { fingerprint, receipt: cloneReceipt(receipt) });
    return cloneReceipt(receipt);
  };

  const project = (query: QueryEnvelope): ProjectionEnvelope => {
    const normalized = normalizeQuery(query);
    if (normalized.caseId !== options.caseId) fail("case_id_invalid");
    if (normalized.policyVersion !== options.policyVersion) fail("policy_version_invalid");
    const registeredActor = options.actors.get(normalized.actor.actorId);
    if (!registeredActor) fail("actor_not_registered");
    if (registeredActor.actorClass !== normalized.actor.actorClass) fail("actor_binding_mismatch");
    if (normalized.visibility === "public" && registeredActor.actorClass !== "public") fail("projection_visibility_forbidden");
    if (normalized.visibility === "administration" && registeredActor.actorClass !== "administration") fail("projection_visibility_forbidden");
    const caseVersion = state.events.length;
    const replayed = replayJournal(state, options);
    if (caseVersion === 0 || !replayed) fail("case_not_found");
    if (normalized.atCaseVersion !== null && normalized.atCaseVersion !== caseVersion) fail("case_version_not_found");
    const projection = buildProjection(options, replayed);
    return {
      schemaVersion: PROJECTION_ENVELOPE_SCHEMA_VERSION,
      caseId: options.caseId,
      caseVersion,
      journalHeadChecksum: state.headChecksum,
      visibility: normalized.visibility,
      policyVersion: options.policyVersion,
      projection: clone(projection),
    };
  };

  // Keep the deep Module seam closed: callers can only issue commands or
  // role-bound queries. The journal, adapter, and registries remain private.
  return Object.freeze({ handle, project });
}

export const createCaseCoordinator = createCivicCaseCoordinator;
export const createInMemoryCivicCaseCoordinator = createCivicCaseCoordinator;
