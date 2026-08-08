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

export type ActorClass =
  | "citizen"
  | "public"
  | "administration"
  | "council"
  | "case_steward"
  | "department_agent"
  | "department_reviewer";

export type ActorBinding = {
  actorId: string;
  actorClass: ActorClass;
};

/** Private registry metadata; department scope never crosses the envelope seam. */
export type ActorRegistration = ActorBinding & {
  departmentId?: string;
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

type CommandEnvelopeBase = {
  schemaVersion: "command_envelope_v1";
  caseId: string;
  actorBinding: ActorBinding;
  expectedCaseVersion: number;
  idempotencyKey: string;
  visibility: "private_case";
  policyVersion: string;
  [key: string]: unknown;
};

export type IntakeDiscussionCommand = CommandEnvelopeBase & {
  commandType: "intake_discussion_v1";
  payload: {
    discussion: DiscussionArtifact;
  };
};

export type AssignDepartmentPackageCommand = CommandEnvelopeBase & {
  commandType: "assign_department_package_v1";
  payload: {
    departmentPackage: DepartmentPackageInput;
  };
};

export type RecordDepartmentDraftCommand = CommandEnvelopeBase & {
  commandType: "record_department_draft_v1";
  payload: {
    packageId: string;
    packageChecksum: string;
    draft: DepartmentDraftInput;
  };
};

export type AttestDepartmentReviewCommand = CommandEnvelopeBase & {
  commandType: "attest_department_review_v1";
  payload: {
    review: DepartmentReviewInput;
  };
};

export type CommandEnvelope =
  | IntakeDiscussionCommand
  | AssignDepartmentPackageCommand
  | RecordDepartmentDraftCommand
  | AttestDepartmentReviewCommand;

export type DepartmentPackageInput = {
  id: string;
  departmentId: string;
  suggestionId: string;
  request: string;
  assignedAgentActorId: string;
  assignedReviewerActorId: string;
  authorityBinding: AuthorityBinding;
};

export type DepartmentDraftInput = {
  schemaVersion: "department_draft_v1";
  id: string;
  publicSummary: string;
  publicCitations: string[];
  privateEvidenceRefs: string[];
  authorityBinding: AuthorityBinding;
};

export type DepartmentReviewInput = {
  packageId: string;
  draftArtifactChecksum: string;
  decision: "accepted" | "rejected";
  reviewedAt: string;
};

export type QueryEnvelope = {
  schemaVersion: "query_envelope_v1";
  queryType: "case_projection_v1";
  caseId: string;
  actorBinding: ActorBinding;
  visibility: "public" | "administration" | "council";
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
  eventType:
    | "case_created_v1"
    | "discussion_recorded_v1"
    | "department_package_assigned_v1"
    | "department_draft_recorded_v1"
    | "department_review_attested_v1";
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
  /** One bounded package for Issue #3, visible only to administration until accepted. */
  departmentPackage?: DepartmentPackageProjection;
};

export type ProjectionEnvelope = {
  schemaVersion: "projection_envelope_v1";
  caseId: string;
  caseVersion: number;
  journalHeadChecksum: string;
  visibility: "public" | "administration" | "council";
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
  actors?: readonly ActorRegistration[];
  actorRegistry?: readonly ActorRegistration[] | Readonly<Record<string, ActorRegistration>>;
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
  actors: ReadonlyMap<string, ActorRegistration>;
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

type DepartmentPackagePayload = {
  departmentPackage: DepartmentPackageInput;
  packageChecksum: string;
  authorityBinding: AuthorityBinding;
};

type DepartmentDraftPayload = {
  packageId: string;
  packageChecksum: string;
  draft: DepartmentDraftInput;
  draftArtifactChecksum: string;
  authorityBinding: AuthorityBinding;
};

type DepartmentReviewPayload = {
  review: DepartmentReviewInput;
  policyVersion: string;
  attestationChecksum: string;
  authorityBinding: AuthorityBinding;
};

type StoredCaseEvent = CaseEventV1 & {
  /** Immutable payload retained only behind the coordinator seam. */
  payload:
    | CaseCreatedPayload
    | DiscussionRecordedPayload
    | DepartmentPackagePayload
    | DepartmentDraftPayload
    | DepartmentReviewPayload;
};

export type DepartmentPackageProjection = {
  schemaVersion: "department_package_projection_v1";
  id: string;
  departmentId: string;
  suggestionId: string;
  request: string;
  packageChecksum: string;
  assignedAgentActorId?: string;
  assignedReviewerActorId?: string;
  draft?: {
    schemaVersion: "department_draft_projection_v1";
    id: string;
    publicSummary: string;
    publicCitations: string[];
    privateEvidenceRefs?: string[];
    artifactChecksum: string;
    actorId?: string;
  };
  reviewState: "assigned" | "draft_pending_review" | "accepted" | "rejected";
  review?: {
    decision: "accepted" | "rejected";
    draftArtifactChecksum: string;
    reviewedAt: string;
    policyVersion: string;
    reviewerActorId?: string;
  };
  artifactChecksum?: string;
  reviewedAt?: string;
  policyVersion?: string;
  publicSummary?: string;
  publicCitations?: string[];
  authorityBinding: AuthorityBinding;
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
const PACKAGE_PAYLOAD_KEYS = new Set(["departmentPackage"]);
const DRAFT_PAYLOAD_KEYS = new Set(["packageId", "packageChecksum", "draft"]);
const REVIEW_PAYLOAD_KEYS = new Set(["review"]);
const ACTOR_KEYS = new Set(["actorId", "actorClass"]);
const ACTOR_REGISTRATION_KEYS = new Set(["actorId", "actorClass", "departmentId"]);
const DEPARTMENT_PACKAGE_KEYS = new Set([
  "id",
  "departmentId",
  "suggestionId",
  "request",
  "assignedAgentActorId",
  "assignedReviewerActorId",
  "authorityBinding",
]);
const DEPARTMENT_DRAFT_KEYS = new Set([
  "schemaVersion",
  "id",
  "publicSummary",
  "publicCitations",
  "privateEvidenceRefs",
  "authorityBinding",
]);
const DEPARTMENT_REVIEW_KEYS = new Set(["packageId", "draftArtifactChecksum", "decision", "reviewedAt"]);
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
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

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
  if (
    actorClass !== "citizen" &&
    actorClass !== "public" &&
    actorClass !== "administration" &&
    actorClass !== "council" &&
    actorClass !== "case_steward" &&
    actorClass !== "department_agent" &&
    actorClass !== "department_reviewer"
  ) {
    fail("actor_role_self_assertion");
  }
  return { actorId, actorClass: actorClass as ActorClass };
}

function normalizeActorRegistration(value: unknown): ActorRegistration {
  ownKeys(value, ACTOR_REGISTRATION_KEYS, "actorRegistry");
  if (!isRecord(value)) fail("actor_registry_invalid");
  const actor = normalizeActor({ actorId: value.actorId, actorClass: value.actorClass }, "actor_registry_invalid");
  const departmentId = value.departmentId;
  if (actor.actorClass === "department_agent" || actor.actorClass === "department_reviewer") {
    if (departmentId === undefined) fail("actor_registry_invalid");
    return { ...actor, departmentId: nonEmptyString(departmentId, "actor_registry_invalid") };
  }
  if (departmentId !== undefined) fail("actor_registry_invalid");
  return actor;
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
    { actorId: "synthetic:council-1", actorClass: "council" },
  ];
  const actorList = Array.isArray(actorValues) ? actorValues : Object.values(actorValues);
  if (actorList.length === 0) fail("actor_registry_required");
  const actors = new Map<string, ActorRegistration>();
  for (const actor of actorList) {
    const normalized = normalizeActorRegistration(actor);
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
    payload: clone(payload) as StoredCaseEvent["payload"],
  };
  state.events.push(event);
  state.headChecksum = event.eventChecksum;
  return clone(event);
}

const PRIVATE_DEPARTMENT_VALUE_MARKER = /(?:\bnsec1[a-z0-9-]{8,}\b|\bnpub1[a-z0-9-]{8,}\b|\b0x[a-f0-9]{40,}\b|private[_ -]?key|secret[_ -]?key|password|credential|wallet|ballot|participant[_ -]?id|employee|prompt|reasoning|tool[_ -]?trace|user[_ -]?id)/i;
export const DETERMINISTIC_REVIEWED_AT = "2026-08-08T00:00:05.000Z";

function departmentSafeString(value: unknown, code: string): string {
  const result = nonEmptyString(value, code);
  if (PRIVATE_DEPARTMENT_VALUE_MARKER.test(result)) fail(`private_field_forbidden:${code}`);
  return result;
}

function boundedDepartmentString(value: unknown, code: string, limit: number): string {
  const result = departmentSafeString(value, code);
  if (result.length > limit) fail(`department_value_too_large:${code}`);
  return result;
}

function normalizeDepartmentPackage(value: unknown): DepartmentPackageInput {
  ownKeys(value, DEPARTMENT_PACKAGE_KEYS, "departmentPackage");
  if (!isRecord(value)) fail("department_package_invalid");
  const result: DepartmentPackageInput = {
    id: boundedDepartmentString(value.id, "department_package_invalid", 512),
    departmentId: boundedDepartmentString(value.departmentId, "department_package_invalid", 256),
    suggestionId: boundedDepartmentString(value.suggestionId, "department_package_invalid", 512),
    request: boundedDepartmentString(value.request, "department_package_invalid", 4000),
    assignedAgentActorId: boundedDepartmentString(value.assignedAgentActorId, "department_package_invalid", 256),
    assignedReviewerActorId: boundedDepartmentString(value.assignedReviewerActorId, "department_package_invalid", 256),
    authorityBinding: value.authorityBinding === "none" ? "none" : fail("authority_field_forbidden:departmentPackage.authorityBinding"),
  };
  if (!result.suggestionId.startsWith("urn:stadtstack:suggestion:")) fail("department_suggestion_invalid");
  if (result.assignedAgentActorId === result.assignedReviewerActorId) fail("department_reviewer_not_distinct");
  return result;
}

function normalizeDepartmentDraft(value: unknown): DepartmentDraftInput {
  ownKeys(value, DEPARTMENT_DRAFT_KEYS, "draft");
  if (!isRecord(value)) fail("department_draft_invalid");
  if (value.schemaVersion !== "department_draft_v1") fail("department_draft_schema_invalid");
  if (value.authorityBinding !== "none") fail("authority_field_forbidden:draft.authorityBinding");
  const citations = value.publicCitations;
  const privateRefs = value.privateEvidenceRefs;
  if (!Array.isArray(citations) || citations.some((item) => typeof item !== "string")) fail("department_draft_invalid");
  if (!Array.isArray(privateRefs) || privateRefs.some((item) => typeof item !== "string")) fail("department_draft_invalid");
  if (citations.length > 64 || privateRefs.length > 64) fail("department_draft_too_large");
  const publicCitations = citations.map((item) => boundedDepartmentString(item, "department_draft_invalid", 2048));
  const privateEvidenceRefs = privateRefs.map((item) => boundedDepartmentString(item, "department_draft_invalid", 2048));
  if (publicCitations.some((item) => item.trim() === "") || privateEvidenceRefs.some((item) => item.trim() === "")) {
    fail("department_draft_invalid");
  }
  const referencePattern = /^synthetic:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]{1,2040}$/;
  if (publicCitations.some((item) => !referencePattern.test(item)) || privateEvidenceRefs.some((item) => !referencePattern.test(item))) {
    fail("department_reference_invalid");
  }
  return {
    schemaVersion: "department_draft_v1",
    id: boundedDepartmentString(value.id, "department_draft_invalid", 512),
    publicSummary: boundedDepartmentString(value.publicSummary, "department_draft_invalid", 4000),
    publicCitations,
    privateEvidenceRefs,
    authorityBinding: "none",
  };
}

function normalizeDepartmentReview(value: unknown): DepartmentReviewInput {
  ownKeys(value, DEPARTMENT_REVIEW_KEYS, "review");
  if (!isRecord(value)) fail("department_review_invalid");
  const reviewedAt = value.reviewedAt;
  if (typeof reviewedAt !== "string" || !RFC3339_UTC.test(reviewedAt) || reviewedAt !== DETERMINISTIC_REVIEWED_AT) {
    fail("department_review_time_invalid");
  }
  if (value.decision !== "accepted" && value.decision !== "rejected") fail("department_review_decision_invalid");
  const draftArtifactChecksum = nonEmptyString(value.draftArtifactChecksum, "department_review_invalid");
  if (!SHA256.test(draftArtifactChecksum)) fail("department_review_checksum_invalid");
  return {
    packageId: nonEmptyString(value.packageId, "department_review_invalid"),
    draftArtifactChecksum,
    decision: value.decision,
    reviewedAt,
  };
}

type ReplayedDepartmentState = {
  departmentPackage: DepartmentPackageInput;
  packageChecksum: string;
  draft?: {
    draft: DepartmentDraftInput;
    draftArtifactChecksum: string;
    actorBinding: ActorBinding;
  };
  review?: {
    review: DepartmentReviewInput;
    policyVersion: string;
    actorBinding: ActorBinding;
  };
};

type ReplayedCaseState = {
  discussion: DiscussionArtifact;
  suggestion: DiscussionRecordedPayload["suggestion"];
  department?: ReplayedDepartmentState;
};

function replayJournal(
  state: JournalState,
  options: InternalCoordinatorOptions,
): ReplayedCaseState | undefined {
  let prior = genesisChecksum(options.caseId);
  let discussion: DiscussionArtifact | undefined;
  let suggestion: DiscussionRecordedPayload["suggestion"] | undefined;
  let department: ReplayedDepartmentState | undefined;
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
    } else if (event.eventType === "department_package_assigned_v1") {
      if (index < 2 || !discussion || !suggestion || department) fail("journal_chain_invalid");
      const packagePayload = payload as DepartmentPackagePayload;
      const departmentPackage = normalizeDepartmentPackage(packagePayload.departmentPackage);
      const stewardRegistration = options.actors.get(event.actorBinding.actorId);
      if (
        packagePayload.authorityBinding !== "none" ||
        packagePayload.packageChecksum !== sha256(departmentPackage) ||
        departmentPackage.suggestionId !== suggestion.id ||
        event.actorBinding.actorClass !== "case_steward" ||
        !stewardRegistration ||
        stewardRegistration.actorClass !== "case_steward"
      ) fail("journal_chain_invalid");
      department = {
        departmentPackage,
        packageChecksum: packagePayload.packageChecksum,
      };
    } else if (event.eventType === "department_draft_recorded_v1") {
      if (!department || department.draft) fail("journal_chain_invalid");
      const draftPayload = payload as DepartmentDraftPayload;
      const draft = normalizeDepartmentDraft(draftPayload.draft);
      const registration = options.actors.get(event.actorBinding.actorId);
      if (
        draftPayload.authorityBinding !== "none" ||
        draftPayload.packageId !== department.departmentPackage.id ||
        draftPayload.packageChecksum !== department.packageChecksum ||
        draftPayload.draftArtifactChecksum !== sha256(draft) ||
        event.actorBinding.actorClass !== "department_agent" ||
        !registration ||
        registration.actorClass !== "department_agent" ||
        registration.departmentId !== department.departmentPackage.departmentId ||
        event.actorBinding.actorId !== department.departmentPackage.assignedAgentActorId
      ) fail("journal_chain_invalid");
      department.draft = {
        draft,
        draftArtifactChecksum: draftPayload.draftArtifactChecksum,
        actorBinding: clone(event.actorBinding),
      };
    } else if (event.eventType === "department_review_attested_v1") {
      if (!department?.draft || department.review) fail("journal_chain_invalid");
      const reviewPayload = payload as DepartmentReviewPayload;
      const review = normalizeDepartmentReview(reviewPayload.review);
      const registration = options.actors.get(event.actorBinding.actorId);
      if (
        reviewPayload.authorityBinding !== "none" ||
        reviewPayload.policyVersion !== options.policyVersion ||
        reviewPayload.attestationChecksum !== sha256({
          review,
          policyVersion: reviewPayload.policyVersion,
          actorBinding: event.actorBinding,
        }) ||
        review.packageId !== department.departmentPackage.id ||
        review.draftArtifactChecksum !== department.draft.draftArtifactChecksum ||
        event.actorBinding.actorClass !== "department_reviewer" ||
        !registration ||
        registration.actorClass !== "department_reviewer" ||
        registration.departmentId !== department.departmentPackage.departmentId ||
        event.actorBinding.actorId === department.draft.actorBinding.actorId ||
        event.actorBinding.actorId !== department.departmentPackage.assignedReviewerActorId
      ) fail("journal_chain_invalid");
      department.review = {
        review,
        policyVersion: reviewPayload.policyVersion,
        actorBinding: clone(event.actorBinding),
      };
    } else {
      fail("journal_chain_invalid");
    }
    prior = eventChecksum;
  }
  if (state.headChecksum !== prior) fail("journal_chain_invalid");
  return discussion && suggestion ? { discussion, suggestion, department } : undefined;
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

function departmentPackageProjection(
  department: ReplayedDepartmentState,
  visibility: QueryEnvelope["visibility"],
): DepartmentPackageProjection | undefined {
  const review = department.review;
  if (visibility !== "administration" && (!review || review.review.decision !== "accepted")) return undefined;
  if (visibility !== "administration" && review) {
    const draft = department.draft;
    if (!draft) return undefined;
    return {
      schemaVersion: "department_package_projection_v1",
      id: department.departmentPackage.id,
      departmentId: department.departmentPackage.departmentId,
      suggestionId: department.departmentPackage.suggestionId,
      request: department.departmentPackage.request,
      packageChecksum: department.packageChecksum,
      reviewState: "accepted",
      artifactChecksum: review.review.draftArtifactChecksum,
      reviewedAt: review.review.reviewedAt,
      policyVersion: review.policyVersion,
      publicSummary: draft.draft.publicSummary,
      publicCitations: clone(draft.draft.publicCitations),
      authorityBinding: "none",
    };
  }
  const result: DepartmentPackageProjection = {
    schemaVersion: "department_package_projection_v1",
    id: department.departmentPackage.id,
    departmentId: department.departmentPackage.departmentId,
    suggestionId: department.departmentPackage.suggestionId,
    request: department.departmentPackage.request,
    packageChecksum: department.packageChecksum,
    assignedAgentActorId: department.departmentPackage.assignedAgentActorId,
    assignedReviewerActorId: department.departmentPackage.assignedReviewerActorId,
    reviewState: department.review?.review.decision ?? (department.draft ? "draft_pending_review" : "assigned"),
    authorityBinding: "none",
  };
  if (department.draft) {
    result.draft = {
      schemaVersion: "department_draft_projection_v1",
      id: department.draft.draft.id,
      publicSummary: department.draft.draft.publicSummary,
      publicCitations: clone(department.draft.draft.publicCitations),
      privateEvidenceRefs: clone(department.draft.draft.privateEvidenceRefs),
      artifactChecksum: department.draft.draftArtifactChecksum,
      actorId: department.draft.actorBinding.actorId,
    };
  }
  if (department.review) {
    result.review = {
      decision: department.review.review.decision,
      draftArtifactChecksum: department.review.review.draftArtifactChecksum,
      reviewedAt: department.review.review.reviewedAt,
      policyVersion: department.review.policyVersion,
      reviewerActorId: department.review.actorBinding.actorId,
    };
  }
  return result;
}

function buildProjection(
  options: InternalCoordinatorOptions,
  replayed: ReplayedCaseState,
  visibility: QueryEnvelope["visibility"],
): CaseProjection {
  const { discussion } = replayed;
  const projectedDiscussion = discussionProjection(discussion);
  const projectedSuggestion = suggestionProjection(discussion, replayed.suggestion);
  const result: CaseProjection = {
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
  if ("department" in replayed && replayed.department) {
    const departmentProjection = departmentPackageProjection(replayed.department, visibility);
    if (departmentProjection) result.departmentPackage = departmentProjection;
  }
  return result;
}

type NormalizedCommand = {
  actor: ActorBinding;
  expectedCaseVersion: number;
  idempotencyKey: string;
  caseId: string;
  policyVersion: string;
  commandType: CommandEnvelope["commandType"];
  discussion?: DiscussionArtifact;
  departmentPackage?: DepartmentPackageInput;
  packageId?: string;
  packageChecksum?: string;
  draft?: DepartmentDraftInput;
  review?: DepartmentReviewInput;
};

function normalizeCommand(command: CommandEnvelope): NormalizedCommand {
  ownKeys(command, COMMAND_KEYS, "envelope");
  if (!isRecord(command) || command.schemaVersion !== COMMAND_ENVELOPE_SCHEMA_VERSION) fail("schema_version_unsupported");
  const commandType = command.commandType;
  if (
    commandType !== "intake_discussion_v1" &&
    commandType !== "assign_department_package_v1" &&
    commandType !== "record_department_draft_v1" &&
    commandType !== "attest_department_review_v1"
  ) fail("command_type_invalid");
  const caseId = nonEmptyString(command.caseId, "case_id_required");
  const actor = normalizeActor(command.actorBinding);
  const expectedCaseVersion = safeInteger(command.expectedCaseVersion, "expected_case_version_invalid");
  if (expectedCaseVersion < 0) fail("expected_case_version_invalid");
  const idempotencyKey = nonEmptyString(command.idempotencyKey, "idempotency_key_required");
  if (idempotencyKey.length > 256) fail("idempotency_key_invalid");
  if (command.visibility !== "private_case") fail("visibility_invalid");
  const policyVersion = nonEmptyString(command.policyVersion, "policy_version_invalid");
  if (!isRecord(command.payload)) fail("payload_invalid");
  const result: NormalizedCommand = {
    actor,
    expectedCaseVersion,
    idempotencyKey,
    caseId,
    policyVersion,
    commandType,
  };
  if (commandType === "intake_discussion_v1") {
    ownKeys(command.payload, PAYLOAD_KEYS, "payload");
    result.discussion = normalizeArtifactShape(command.payload.discussion);
  } else if (commandType === "assign_department_package_v1") {
    ownKeys(command.payload, PACKAGE_PAYLOAD_KEYS, "payload");
    result.departmentPackage = normalizeDepartmentPackage(command.payload.departmentPackage);
  } else if (commandType === "record_department_draft_v1") {
    ownKeys(command.payload, DRAFT_PAYLOAD_KEYS, "payload");
    const packageId = nonEmptyString(command.payload.packageId, "department_package_invalid");
    const packageChecksum = nonEmptyString(command.payload.packageChecksum, "department_package_checksum_invalid");
    if (!SHA256.test(packageChecksum)) fail("department_package_checksum_invalid");
    result.packageId = packageId;
    result.packageChecksum = packageChecksum;
    result.draft = normalizeDepartmentDraft(command.payload.draft);
  } else {
    ownKeys(command.payload, REVIEW_PAYLOAD_KEYS, "payload");
    result.review = normalizeDepartmentReview(command.payload.review);
  }
  return result;
}

function normalizeQuery(query: QueryEnvelope): {
  query: Record<string, unknown>;
  actor: ActorBinding;
  caseId: string;
  visibility: "public" | "administration" | "council";
  policyVersion: string;
  atCaseVersion: number | null;
} {
  ownKeys(query, QUERY_KEYS, "query");
  if (!isRecord(query) || query.schemaVersion !== QUERY_ENVELOPE_SCHEMA_VERSION) fail("schema_version_unsupported");
  if (query.queryType !== "case_projection_v1") fail("query_type_invalid");
  const caseId = nonEmptyString(query.caseId, "case_id_required");
  const actor = normalizeActor(query.actorBinding);
  const visibility = query.visibility;
  if (visibility !== "public" && visibility !== "administration" && visibility !== "council") fail("visibility_invalid");
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

  const handle = (command: CommandEnvelope): CommandReceipt => {
    const normalized = normalizeCommand(command);
    if (normalized.caseId !== options.caseId) fail("case_id_invalid");
    if (normalized.policyVersion !== options.policyVersion) fail("policy_version_invalid");
    const registeredActor = options.actors.get(normalized.actor.actorId);
    if (!registeredActor) fail("actor_not_registered");
    if (registeredActor.actorClass !== normalized.actor.actorClass) fail("actor_binding_mismatch");
    const discussion = normalized.commandType === "intake_discussion_v1"
      ? normalizeAndVerifyDiscussion(normalized.discussion, options)
      : undefined;
    const fingerprint = sha256({
      schemaVersion: COMMAND_ENVELOPE_SCHEMA_VERSION,
      commandType: normalized.commandType,
      caseId: normalized.caseId,
      actorBinding: normalized.actor,
      expectedCaseVersion: normalized.expectedCaseVersion,
      visibility: "private_case",
      policyVersion: normalized.policyVersion,
      payload: normalized.commandType === "intake_discussion_v1"
        ? { discussion }
        : normalized.commandType === "assign_department_package_v1"
          ? { departmentPackage: normalized.departmentPackage }
          : normalized.commandType === "record_department_draft_v1"
            ? { packageId: normalized.packageId, packageChecksum: normalized.packageChecksum, draft: normalized.draft }
            : { review: normalized.review },
    });
    const previous = idempotency.get(normalized.idempotencyKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint) fail("idempotency_conflict");
      return cloneReceipt(previous.receipt);
    }
    if (normalized.expectedCaseVersion !== state.events.length) fail("case_version_conflict");
    const existing = replayJournal(state, options);
    if (normalized.commandType === "intake_discussion_v1") {
      if (registeredActor.actorClass !== "citizen") fail("actor_role_forbidden");
      if (!discussion) fail("discussion_proof_invalid");
      if (existing) {
        if (canonicalJson(existing.discussion) === canonicalJson(discussion)) fail("discussion_already_recorded");
        fail("discussion_conflict");
      }
      if (state.events.length !== 0) fail("case_version_conflict");
    } else if (normalized.commandType === "assign_department_package_v1") {
      if (registeredActor.actorClass !== "case_steward") fail("actor_role_forbidden");
      if (!existing || !normalized.departmentPackage) fail("case_not_found");
      if (existing.department) fail("department_package_already_recorded");
      const departmentPackage = normalized.departmentPackage;
      if (departmentPackage.suggestionId !== existing.suggestion.id) fail("department_suggestion_mismatch");
      const agent = options.actors.get(departmentPackage.assignedAgentActorId);
      const reviewer = options.actors.get(departmentPackage.assignedReviewerActorId);
      if (
        !agent ||
        agent.actorClass !== "department_agent" ||
        agent.departmentId !== departmentPackage.departmentId ||
        !reviewer ||
        reviewer.actorClass !== "department_reviewer" ||
        reviewer.departmentId !== departmentPackage.departmentId
      ) fail("department_actor_scope_mismatch");
    } else if (normalized.commandType === "record_department_draft_v1") {
      if (registeredActor.actorClass !== "department_agent") fail("actor_role_forbidden");
      if (!existing?.department || !normalized.draft || !normalized.packageId || !normalized.packageChecksum) {
        fail("department_package_not_assigned");
      }
      if (existing.department.draft) fail("department_draft_already_recorded");
      if (normalized.packageId !== existing.department.departmentPackage.id) fail("department_package_mismatch");
      if (normalized.packageChecksum !== existing.department.packageChecksum) fail("department_package_checksum_invalid");
      if (normalized.actor.actorId !== existing.department.departmentPackage.assignedAgentActorId) {
        fail("department_agent_not_assigned");
      }
      if (registeredActor.departmentId !== existing.department.departmentPackage.departmentId) {
        fail("department_actor_scope_mismatch");
      }
    } else {
      if (registeredActor.actorClass !== "department_reviewer") fail("actor_role_forbidden");
      if (!existing?.department?.draft || !normalized.review) fail("department_draft_not_recorded");
      const department = existing.department;
      const draft = department.draft;
      if (!draft) fail("department_draft_not_recorded");
      if (department.review) fail("department_review_already_recorded");
      if (normalized.review.packageId !== department.departmentPackage.id) fail("department_package_mismatch");
      if (normalized.review.draftArtifactChecksum !== draft.draftArtifactChecksum) fail("department_draft_checksum_invalid");
      if (registeredActor.departmentId !== department.departmentPackage.departmentId) fail("department_actor_scope_mismatch");
      if (normalized.actor.actorId !== department.departmentPackage.assignedReviewerActorId) fail("department_reviewer_not_assigned");
      if (normalized.actor.actorId === draft.actorBinding.actorId) fail("department_reviewer_not_distinct");
    }

    // Build the complete append on a temporary clone so a later validation
    // failure cannot leave a partial journal behind.
    const nextState: JournalState = {
      events: state.events.map((event) => clone(event)),
      headChecksum: state.headChecksum,
    };
    const appended: StoredCaseEvent[] = [];
    if (normalized.commandType === "intake_discussion_v1") {
      if (!discussion) fail("discussion_proof_invalid");
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
      appended.push(appendEvent(nextState, options, normalized.actor, "case_created_v1", payloadCase));
      appended.push(appendEvent(nextState, options, normalized.actor, "discussion_recorded_v1", payloadDiscussion));
    } else if (normalized.commandType === "assign_department_package_v1") {
      if (!normalized.departmentPackage) fail("department_package_invalid");
      const departmentPackage = clone(normalized.departmentPackage);
      appended.push(appendEvent(nextState, options, normalized.actor, "department_package_assigned_v1", {
        departmentPackage,
        packageChecksum: sha256(departmentPackage),
        authorityBinding: "none" as const,
      } satisfies DepartmentPackagePayload));
    } else if (normalized.commandType === "record_department_draft_v1") {
      if (!normalized.packageId || !normalized.packageChecksum || !normalized.draft) fail("department_draft_invalid");
      appended.push(appendEvent(nextState, options, normalized.actor, "department_draft_recorded_v1", {
        packageId: normalized.packageId,
        packageChecksum: normalized.packageChecksum,
        draft: clone(normalized.draft),
        draftArtifactChecksum: sha256(normalized.draft),
        authorityBinding: "none" as const,
      } satisfies DepartmentDraftPayload));
    } else {
      if (!normalized.review) fail("department_review_invalid");
      appended.push(appendEvent(nextState, options, normalized.actor, "department_review_attested_v1", {
        review: clone(normalized.review),
        policyVersion: normalized.policyVersion,
        attestationChecksum: sha256({
          review: normalized.review,
          policyVersion: normalized.policyVersion,
          actorBinding: normalized.actor,
        }),
        authorityBinding: "none" as const,
      } satisfies DepartmentReviewPayload));
    }
    const receipt: CommandReceipt = {
      caseVersion: nextState.events.length,
      eventIds: appended.map((event) => event.eventId),
      journalHeadChecksum: nextState.headChecksum,
    };
    state.events = nextState.events;
    state.headChecksum = nextState.headChecksum;
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
    if (normalized.visibility === "council" && registeredActor.actorClass !== "council") fail("projection_visibility_forbidden");
    const caseVersion = state.events.length;
    const replayed = replayJournal(state, options);
    if (caseVersion === 0 || !replayed) fail("case_not_found");
    if (normalized.atCaseVersion !== null && normalized.atCaseVersion !== caseVersion) fail("case_version_not_found");
    const projection = buildProjection(options, replayed, normalized.visibility);
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
