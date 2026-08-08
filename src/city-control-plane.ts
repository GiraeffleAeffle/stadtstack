import type { Event as NostrEvent } from "nostr-tools/pure";

import {
  createCivicKernel,
  type CivicActor,
  type CivicProjection,
  type CouncilDryRunBrief,
  type ParticipationResult,
} from "./civic-kernel.ts";
import {
  COMPANION_PROFILES,
  createCompanionRuntime,
  type CompanionProfile,
  type CompanionRuntime,
} from "./companion-runtime.ts";
import {
  createCompanionIdentityPolicy,
  type CompanionHarnessAdapter,
  type CompanionHarnessRunOptions,
  type WorkerResultV1,
} from "./adapters/companion-harness.ts";
import {
  createNostrDiscussionAdapter,
  STADTSTACK_E2E_FIXTURE_TAG,
  type DiscussionArtifact,
  type DiscussionScope,
} from "./adapters/discussion-adapter.ts";
import {
  isAllowedNostrRelayUrl,
  type NostrRelayPublishAndQueryReceipt,
  type NostrRelayTransport,
} from "./adapters/nostr-relay-transport.ts";

/**
 * The roles which may be bound to an actor in this local control-plane
 * Implementation.  `council_member` and `public_viewer` are read-only
 * surface roles; all mutation is still performed by the civic kernel's
 * narrower CivicActor roles.
 */
export type CityControlActorRole =
  | CivicActor["role"]
  | "council_member"
  | "public_viewer";

export type CityControlPlaneConfig = {
  municipalityId: string;
  caseId: string;
  departments: readonly string[];
  /** The exact synthetic/internal relay endpoint expected by the Adapter. */
  relayUrl: string;
  allowedSignerPubkeys: readonly string[];
  fixtureMarker: readonly [string, string];
  /** Exact profile-to-worker identity mapping. */
  companionIdentities: Readonly<Record<CompanionProfile, string>>;
  actors: readonly {
    id: string;
    role: CityControlActorRole;
    departmentId?: string;
  }[];
};

export type CityControlPlaneDependencies = {
  relay: NostrRelayTransport;
  harness: CompanionHarnessAdapter;
};

export type CityCallerRequest = { callerId: string };
export type CityIngestDiscussionRequest = CityCallerRequest & {
  event: NostrEvent;
  relayRefs?: readonly string[];
  discussionId?: string;
};
export type CityCraftSuggestionRequest = CityCallerRequest & {
  suggestion: { id: string; discussionId: string; title: string };
};
export type CitySubmitSuggestionRequest = CityCallerRequest & { suggestionId: string };
export type CityDepartmentResponseRequest = CityCallerRequest & {
  workPackageId: string;
  response: { summary: string; citations: readonly string[] };
};
export type CityDepartmentReviewRequest = CityCallerRequest & { workPackageId: string };
export type CityPublishReviewedBriefRequest = CityCallerRequest & { summary: string };
export type CityRecordReviewedParticipationRequest = CityCallerRequest & { result: ParticipationResult };
export type CityProjectRequest = CityCallerRequest & { profile: "administration" | "council" | "public" };
export type CityCouncilDryRunRequest = CityCallerRequest;
export type CityCompanionRequest = CityCallerRequest & {
  profile: CompanionProfile;
  question: string;
  sessionKey?: string;
  limits?: CompanionHarnessRunOptions["limits"];
};

export type CityControlPlane = {
  readonly kind: "city-control-plane";
  readonly municipalityId: string;
  readonly caseId: string;
  readonly relayUrl: string;
  readonly departments: readonly string[];
  readonly runtime: CompanionRuntime;
  ingestDiscussion(request: CityIngestDiscussionRequest): Promise<CityDiscussionReceipt>;
  craftSuggestion(request: CityCraftSuggestionRequest): CitySuggestionReceipt;
  submitSuggestion(request: CitySubmitSuggestionRequest): CitySubmissionReceipt;
  recordDepartmentResponse(request: CityDepartmentResponseRequest): CityDepartmentResponseReceipt;
  reviewDepartmentResponse(request: CityDepartmentReviewRequest): CityDepartmentReviewReceipt;
  publishReviewedBrief(request: CityPublishReviewedBriefRequest): CityPublishedBriefReceipt;
  recordReviewedParticipation(request: CityRecordReviewedParticipationRequest): CityParticipationReceipt;
  project(request: CityProjectRequest): CivicProjection;
  prepareCouncilDryRunBrief(request: CityCouncilDryRunRequest): CouncilDryRunBrief;
  askCompanion(request: CityCompanionRequest): Promise<CityCompanionReceipt>;
};

export type CityAuthorityReceipt = {
  authorityBinding: "none";
  formalDecision: null;
  publicWrite: false;
};

export type CityDiscussionReceipt = CityAuthorityReceipt & {
  artifact: DiscussionArtifact;
  discussion: DiscussionArtifact;
  event: NostrEvent;
  relay: NostrRelayPublishAndQueryReceipt;
  discussionId: string;
};

export type CitySuggestionReceipt = CityAuthorityReceipt & {
  suggestion: CivicProjection["suggestions"][number];
};

export type CitySubmissionReceipt = CityAuthorityReceipt & {
  suggestion: CivicProjection["suggestions"][number];
  departmentWorkPackages: NonNullable<CivicProjection["departmentWorkPackages"]>;
};

export type CityDepartmentResponseReceipt = CityAuthorityReceipt & {
  workPackage: NonNullable<CivicProjection["departmentWorkPackages"]>[number];
};

export type CityDepartmentReviewReceipt = CityDepartmentResponseReceipt;

export type CityPublishedBriefReceipt = CityAuthorityReceipt & {
  brief: NonNullable<CivicProjection["reviewedCitizenBrief"]>;
  administration: CivicProjection;
  public: CivicProjection;
};

export type CityParticipationReceipt = CityAuthorityReceipt & {
  result: ParticipationResult;
};

export type CityCompanionReceipt = CityAuthorityReceipt &
  WorkerResultV1 & {
    workerResult: WorkerResultV1;
    prohibitedEffects: readonly string[];
  };

type ActorRecord = {
  id: string;
  role: CityControlActorRole;
  departmentId?: string;
};

type NormalizedCityConfig = {
  municipalityId: string;
  caseId: string;
  departments: readonly string[];
  scope: DiscussionScope;
  relayUrl: string;
  fixtureMarker: readonly [string, string];
  allowedSignerPubkeys: ReadonlySet<string>;
  actors: ReadonlyMap<string, ActorRecord>;
  departmentAgents: ReadonlyMap<string, string>;
  departmentReviewers: ReadonlyMap<string, string>;
  companionIdentities: Readonly<Record<CompanionProfile, string>>;
};

const ACTOR_ROLES = new Set<CityControlActorRole>([
  "citizen",
  "case_steward",
  "department_agent",
  "department_reviewer",
  "participation_reviewer",
  "publisher",
  "council_member",
  "public_viewer",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function requiredString(value: unknown, error: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(error);
  return value.trim();
}

function optionalRequiredString(value: unknown, error: string): string | undefined {
  return value === undefined ? undefined : requiredString(value, error);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function readRequest(request: unknown): Record<string, unknown> {
  if (!isObject(request)) throw new Error("city_control_request_invalid");
  return request;
}

function actorIdFromRequest(request: Record<string, unknown>): string {
  if (hasOwn(request, "actorId") || hasOwn(request, "caller")) throw new Error("caller_field_forbidden");
  return requiredString(request.callerId, "actor_id_required");
}

function assertNoSelfAssertedRole(request: Record<string, unknown>): void {
  if (hasOwn(request, "role") || hasOwn(request, "actorRole") || hasOwn(request, "callerRole")) {
    throw new Error("actor_role_self_assertion");
  }
}

function assertRequestKeys(
  request: Record<string, unknown>,
  allowed: readonly string[],
): void {
  assertNoSelfAssertedRole(request);
  const allowedKeys = new Set(allowed);
  for (const key of Reflect.ownKeys(request)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) throw new Error(`city_control_request_field_forbidden:${String(key)}`);
  }
}

function assertNestedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) throw new Error(`city_control_request_field_forbidden:${path}.${String(key)}`);
  }
}

function canonical(value: unknown): string {
  return JSON.stringify(value);
}

function addActor(
  actors: Map<string, ActorRecord>,
  actor: ActorRecord,
): void {
  const previous = actors.get(actor.id);
  if (previous) throw new Error(`actor_duplicate:${actor.id}`);
  actors.set(actor.id, actor);
}

function resolveDepartmentActors(
  actors: Map<string, ActorRecord>,
  departments: readonly string[],
  role: "department_agent" | "department_reviewer",
): Map<string, string> {
  const output = new Map<string, string>();
  for (const departmentId of departments) {
    const matches = [...actors.values()].filter(
      (actor) => actor.role === role && actor.departmentId === departmentId,
    );
    if (matches.length !== 1) {
      throw new Error(`department_actor_required:${role}:${departmentId}`);
    }
    const candidate = matches[0]!.id;
    if (output.has(departmentId) || [...output.values()].includes(candidate)) {
      throw new Error(`department_actor_not_unique:${role}:${departmentId}`);
    }
    output.set(departmentId, candidate);
  }
  return output;
}

function normalizeConfig(config: CityControlPlaneConfig): NormalizedCityConfig {
  if (!config || typeof config !== "object") throw new Error("city_control_config_required");
  const municipalityId = requiredString(config.municipalityId, "municipality_id_required");
  const caseId = requiredString(config.caseId, "case_id_required");
  const departments = Array.from(config.departments ?? [], (department) => requiredString(department, "department_id_required"));
  if (departments.length === 0) throw new Error("departments_required");
  if (new Set(departments).size !== departments.length) throw new Error("departments_unique");
  const relayUrlInput = requiredString(config.relayUrl, "nostr_relay_url_required");
  if (!isAllowedNostrRelayUrl(relayUrlInput)) throw new Error("nostr_relay_external_url_forbidden");
  const relayUrl = new URL(relayUrlInput).toString().replace(/\/$/, "");
  const fixtureMarker = config.fixtureMarker;
  if (!Array.isArray(fixtureMarker) || fixtureMarker.length !== 2 || fixtureMarker[0] !== STADTSTACK_E2E_FIXTURE_TAG[0] || fixtureMarker[1] !== STADTSTACK_E2E_FIXTURE_TAG[1]) {
    throw new Error("nostr_relay_fixture_marker_invalid");
  }
  if (!Array.isArray(config.allowedSignerPubkeys)) throw new Error("nostr_relay_signer_allowlist_required");
  const signerValues = config.allowedSignerPubkeys.map((value) => requiredString(value, "nostr_relay_signer_invalid"));
  if (signerValues.length === 0 || signerValues.some((value) => !/^[0-9a-f]{64}$/.test(value))) {
    throw new Error("nostr_relay_signer_allowlist_required");
  }

  const actors = new Map<string, ActorRecord>();
  if (!Array.isArray(config.actors) || config.actors.length === 0) throw new Error("actors_required");
  for (const entry of config.actors) {
    if (!isObject(entry)) throw new Error("actor_invalid");
    if (Object.keys(entry).some((key) => !["id", "role", "departmentId"].includes(key))) throw new Error("actor_field_forbidden");
    const id = requiredString(entry.id, "actor_id_required");
    const role = entry.role;
    if (typeof role !== "string" || !ACTOR_ROLES.has(role as CityControlActorRole)) throw new Error("actor_role_invalid");
    const departmentId = entry.departmentId === undefined ? undefined : requiredString(entry.departmentId, "actor_department_invalid");
    if ((role === "department_agent" || role === "department_reviewer") && !departmentId) throw new Error("actor_department_required");
    if (role !== "department_agent" && role !== "department_reviewer" && departmentId !== undefined) throw new Error("actor_department_forbidden");
    addActor(actors, { id, role: role as CityControlActorRole, ...(departmentId ? { departmentId } : {}) });
  }
  const departmentAgents = resolveDepartmentActors(actors, departments, "department_agent");
  const departmentReviewers = resolveDepartmentActors(actors, departments, "department_reviewer");
  for (const departmentId of departments) {
    if (departmentAgents.get(departmentId) === departmentReviewers.get(departmentId)) {
      throw new Error(`department_reviewer_independence:${departmentId}`);
    }
  }
  if (!isObject(config.companionIdentities)) throw new Error("companion_identities_required");
  const normalizedIdentities = {
    administration: requiredString(config.companionIdentities.administration, "worker_identity_required:administration"),
    council: requiredString(config.companionIdentities.council, "worker_identity_required:council"),
    public: requiredString(config.companionIdentities.public, "worker_identity_required:public"),
  } as const;
  if (new Set(Object.values(normalizedIdentities)).size !== COMPANION_PROFILES.length) throw new Error("worker_identity_unique");

  return {
    municipalityId,
    caseId,
    departments,
    scope: { municipalityId, caseId },
    relayUrl,
    fixtureMarker: [fixtureMarker[0]!, fixtureMarker[1]!] as const,
    allowedSignerPubkeys: new Set(signerValues),
    actors,
    departmentAgents,
    departmentReviewers,
    companionIdentities: normalizedIdentities,
  };
}

function roleActor(
  id: string,
  role: CivicActor["role"],
  departmentId?: string,
): CivicActor {
  return {
    id,
    role,
    ...(departmentId === undefined ? {} : { departmentId }),
  };
}

function field(request: Record<string, unknown>, name: string): unknown {
  return request[name];
}

function responseFromProjection(
  projection: CivicProjection,
  workPackageId: string,
): NonNullable<CivicProjection["departmentWorkPackages"]>[number] {
  const packageItem = projection.departmentWorkPackages?.find((item) => item.id === workPackageId);
  if (!packageItem) throw new Error("department_work_package_not_found");
  return packageItem;
}

function normalizeResponse(value: unknown): { summary: string; citations: string[] } {
  if (!isObject(value)) throw new Error("department_response_invalid");
  assertNestedKeys(value, ["summary", "citations"], "response");
  const summary = requiredString(value.summary, "department_response_summary_required");
  if (!Array.isArray(value.citations) || value.citations.length === 0 || value.citations.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error("department_response_citation_required");
  }
  return { summary, citations: value.citations.map((item) => item.trim()) };
}

function assertProfileCaller(
  config: NormalizedCityConfig,
  request: Record<string, unknown>,
  allowedRoles: readonly CityControlActorRole[],
): ActorRecord {
  assertNoSelfAssertedRole(request);
  const id = actorIdFromRequest(request);
  const actor = config.actors.get(id);
  if (!actor) throw new Error("actor_not_registered");
  if (!allowedRoles.includes(actor.role)) throw new Error("actor_role_forbidden");
  return actor;
}

function profileRoles(profile: CompanionProfile | "administration" | "council" | "public"): readonly CityControlActorRole[] {
  if (profile === "administration") {
    return ["case_steward", "department_agent", "department_reviewer", "participation_reviewer", "publisher"];
  }
  if (profile === "council") return ["council_member"];
  return ["citizen", "public_viewer"];
}

function assertProfileAccess(
  config: NormalizedCityConfig,
  request: Record<string, unknown>,
  profile: CompanionProfile | "administration" | "council" | "public",
): ActorRecord {
  assertNoSelfAssertedRole(request);
  const id = actorIdFromRequest(request);
  const actor = config.actors.get(id);
  if (!actor) throw new Error("actor_not_registered");
  if (!profileRoles(profile).includes(actor.role)) throw new Error("actor_profile_forbidden");
  return actor;
}

function authority(): CityAuthorityReceipt {
  return { authorityBinding: "none", formalDecision: null, publicWrite: false };
}

function projectionSuggestion(projection: CivicProjection, suggestionId: string): CivicProjection["suggestions"][number] {
  const suggestion = projection.suggestions.find((item) => item.id === suggestionId);
  if (!suggestion) throw new Error("suggestion_not_found");
  return clone(suggestion);
}

/**
 * Assemble the city-local vertical slice.  Dependencies are injected at both
 * external seams: no relay socket, worker runtime, model, filesystem, or
 * civic authority is created by this factory.
 */
export function createCityControlPlane(
  configInput: CityControlPlaneConfig,
  dependencies: CityControlPlaneDependencies,
): CityControlPlane {
  const config = normalizeConfig(configInput);
  const relay = dependencies?.relay;
  const harness = dependencies?.harness;
  if (!relay) throw new Error("nostr_relay_transport_required");
  if (!harness) throw new Error("companion_harness_required");
  if (typeof relay.publishAndQuery !== "function" || typeof relay.publish !== "function" || typeof relay.query !== "function") {
    throw new Error("nostr_relay_transport_invalid");
  }
  if (relay.relayUrl !== config.relayUrl) throw new Error("nostr_relay_url_mismatch");
  const kernel = createCivicKernel({
    municipalityId: config.municipalityId,
    caseId: config.caseId,
    departments: config.departments,
    actors: [...config.actors.values()]
      .filter((actor) => actor.role !== "council_member" && actor.role !== "public_viewer")
      .map((actor) => ({
        id: actor.id,
        role: actor.role as CivicActor["role"],
        ...(actor.departmentId === undefined ? {} : { departmentId: actor.departmentId }),
      })),
  });
  const discussionAdapter = createNostrDiscussionAdapter({
    scope: config.scope,
    allowedKinds: [1],
    syntheticFixtureOnly: true,
  });
  const runtime = createCompanionRuntime({ caseReader: kernel, identities: config.companionIdentities });
  const identityPolicy = createCompanionIdentityPolicy(config.companionIdentities);
  const responseInputs = new Map<string, { actorId: string; response: { summary: string; citations: string[] } }>();
  const responseReviews = new Set<string>();
  let publishedBrief: { summary: string; publisherId: string } | undefined;
  let participation: ParticipationResult | undefined;

  const ingestDiscussion = async (rawRequest: CityIngestDiscussionRequest): Promise<CityDiscussionReceipt> => {
    const request = readRequest(rawRequest);
    assertRequestKeys(request, ["callerId", "event", "relayRefs", "discussionId"]);
    const actor = assertProfileCaller(config, request, ["citizen"]);
    const event = (field(request, "event") ?? request) as NostrEvent;
    if (!isObject(event)) throw new Error("nostr_relay_event_invalid");
    if (typeof event.pubkey !== "string" || !config.allowedSignerPubkeys.has(event.pubkey)) throw new Error("nostr_relay_signer_not_allowed");
    const requestedDiscussionId = optionalRequiredString(field(request, "discussionId"), "discussion_id_invalid");
    if (requestedDiscussionId && requestedDiscussionId !== event.id) throw new Error("discussion_id_mismatch");
    const relayRefsValue = field(request, "relayRefs");
    const relayRefs = relayRefsValue === undefined
      ? undefined
      : Array.isArray(relayRefsValue) && relayRefsValue.every((value): value is string => typeof value === "string")
        ? relayRefsValue
        : (() => { throw new Error("discussion_relay_invalid"); })();
    const filter = {
      eventId: requiredString(event.id, "nostr_relay_query_event_id_required"),
      scope: { ...config.scope },
      fixtureMarker: config.fixtureMarker,
    } as const;
    const relayReceipt = await relay.publishAndQuery(event, filter);
    if (relayReceipt.query.events.length !== 1 || relayReceipt.query.events[0]!.id !== event.id) throw new Error("nostr_relay_event_id_mismatch");
    const artifact = discussionAdapter.normalize({
      event: relayReceipt.event,
      ...(relayRefs === undefined ? {} : { relayRefs }),
    }, config.scope);
    kernel.dispatch({
      type: "record_discussion",
      actor: roleActor(actor.id, "citizen"),
      discussion: {
        id: artifact.id,
        content: artifact.event.content,
        transport: "synthetic_nostr_fixture",
        signature: artifact.verificationProof.kind === "nostr_nip01" ? artifact.verificationProof.signature : "",
        provenance: artifact,
      },
    });
    return {
      ...authority(),
      artifact: clone(artifact),
      discussion: clone(artifact),
      event: clone(relayReceipt.event),
      relay: clone(relayReceipt),
      discussionId: artifact.id,
    };
  };

  const craftSuggestion = (rawRequest: CityCraftSuggestionRequest): CitySuggestionReceipt => {
    const request = readRequest(rawRequest);
    assertRequestKeys(request, ["callerId", "suggestion"]);
    const actor = assertProfileCaller(config, request, ["citizen"]);
    if (!isObject(field(request, "suggestion"))) throw new Error("suggestion_required");
    const source = field(request, "suggestion") as Record<string, unknown>;
    assertNestedKeys(source, ["id", "discussionId", "title"], "suggestion");
    const id = requiredString(source.id, "suggestion_id_required");
    const discussionId = requiredString(source.discussionId, "suggestion_discussion_required");
    const title = requiredString(source.title, "suggestion_title_required");
    kernel.dispatch({ type: "craft_suggestion", actor: roleActor(actor.id, "citizen"), suggestion: { id, discussionId, title } });
    return { ...authority(), suggestion: projectionSuggestion(kernel.project({ role: "administration" }), id) };
  };

  const submitSuggestion = (rawRequest: CitySubmitSuggestionRequest): CitySubmissionReceipt => {
    const request = readRequest(rawRequest);
    assertRequestKeys(request, ["callerId", "suggestionId"]);
    const actor = assertProfileCaller(config, request, ["case_steward"]);
    const suggestionId = requiredString(field(request, "suggestionId"), "suggestion_id_required");
    kernel.dispatch({ type: "submit_suggestion_for_administration", actor: roleActor(actor.id, "case_steward"), suggestionId });
    const administration = kernel.project({ role: "administration" });
    return {
      ...authority(),
      suggestion: projectionSuggestion(administration, suggestionId),
      departmentWorkPackages: clone(administration.departmentWorkPackages ?? []),
    };
  };

  const recordDepartmentResponse = (rawRequest: CityDepartmentResponseRequest): CityDepartmentResponseReceipt => {
    const request = readRequest(rawRequest);
    assertRequestKeys(request, ["callerId", "workPackageId", "response"]);
    const actor = assertProfileCaller(config, request, ["department_agent"]);
    const workPackageId = requiredString(field(request, "workPackageId"), "department_work_package_required");
    const workPackage = responseFromProjection(kernel.project({ role: "administration" }), workPackageId);
    if (
      actor.departmentId !== workPackage.departmentId ||
      config.departmentAgents.get(workPackage.departmentId) !== actor.id
    ) {
      throw new Error("department_agent_scope_mismatch");
    }
    const response = normalizeResponse(field(request, "response"));
    const existingInput = responseInputs.get(workPackageId);
    if (existingInput) {
      if (existingInput.actorId !== actor.id) throw new Error("department_response_conflict");
      if (canonical(existingInput.response) !== canonical(response)) {
        // A replacement response is a new reviewed input set.  The kernel
        // clears its published brief; clear the local replay ledger as well
        // so the publisher must perform a fresh reviewed publication.
        publishedBrief = undefined;
        for (const key of responseReviews) {
          if (key.startsWith(`${workPackageId}:`)) responseReviews.delete(key);
        }
        kernel.dispatch({ type: "record_department_response", actor: roleActor(actor.id, "department_agent", actor.departmentId), workPackageId, response });
        responseInputs.set(workPackageId, { actorId: actor.id, response: clone(response) });
      }
    } else {
      publishedBrief = undefined;
      kernel.dispatch({ type: "record_department_response", actor: roleActor(actor.id, "department_agent", actor.departmentId), workPackageId, response });
      responseInputs.set(workPackageId, { actorId: actor.id, response: clone(response) });
    }
    return { ...authority(), workPackage: responseFromProjection(kernel.project({ role: "administration" }), workPackageId) };
  };

  const reviewDepartmentResponse = (rawRequest: CityDepartmentReviewRequest): CityDepartmentReviewReceipt => {
    const request = readRequest(rawRequest);
    assertRequestKeys(request, ["callerId", "workPackageId"]);
    const actor = assertProfileCaller(config, request, ["department_reviewer"]);
    const workPackageId = requiredString(field(request, "workPackageId"), "department_work_package_required");
    const workPackage = responseFromProjection(kernel.project({ role: "administration" }), workPackageId);
    if (
      actor.departmentId !== workPackage.departmentId ||
      config.departmentReviewers.get(workPackage.departmentId) !== actor.id
    ) {
      throw new Error("department_reviewer_scope_mismatch");
    }
    const responseInput = responseInputs.get(workPackageId);
    if (responseInput?.actorId === actor.id) throw new Error("department_reviewer_independence");
    const key = `${workPackageId}:${actor.id}`;
    if (!responseReviews.has(key)) {
      kernel.dispatch({ type: "review_department_response", actor: roleActor(actor.id, "department_reviewer", actor.departmentId), workPackageId });
      responseReviews.add(key);
    }
    return { ...authority(), workPackage: responseFromProjection(kernel.project({ role: "administration" }), workPackageId) };
  };

  const publishReviewedBrief = (rawRequest: CityPublishReviewedBriefRequest): CityPublishedBriefReceipt => {
    const request = readRequest(rawRequest);
    assertRequestKeys(request, ["callerId", "summary"]);
    const actor = assertProfileCaller(config, request, ["publisher"]);
    const summary = requiredString(field(request, "summary"), "brief_summary_required");
    if (publishedBrief) {
      if (publishedBrief.publisherId !== actor.id || publishedBrief.summary !== summary) throw new Error("brief_conflict");
    } else {
      kernel.dispatch({ type: "publish_reviewed_citizen_brief", actor: roleActor(actor.id, "publisher"), summary });
      publishedBrief = { summary, publisherId: actor.id };
    }
    const administration = kernel.project({ role: "administration" });
    const publicProjection = kernel.project({ role: "public" });
    if (!administration.reviewedCitizenBrief || !publicProjection.reviewedCitizenBrief) throw new Error("reviewed_brief_missing");
    return { ...authority(), brief: clone(publicProjection.reviewedCitizenBrief), administration, public: publicProjection };
  };

  const recordReviewedParticipation = (rawRequest: CityRecordReviewedParticipationRequest): CityParticipationReceipt => {
    const request = readRequest(rawRequest);
    assertRequestKeys(request, ["callerId", "result"]);
    const actor = assertProfileCaller(config, request, ["participation_reviewer"]);
    const result = field(request, "result") as ParticipationResult;
    if (!isObject(result)) throw new Error("participation_result_required");
    if (!kernel.project({ role: "public" }).reviewedCitizenBrief) throw new Error("reviewed_citizen_brief_required");
    if (participation) {
      if (canonical(participation) !== canonical(result)) throw new Error("participation_result_conflict");
    } else {
      kernel.dispatch({ type: "record_reviewed_participation_result", actor: roleActor(actor.id, "participation_reviewer"), result });
      participation = clone(result);
    }
    const projected = kernel.project({ role: "public" }).participationResult;
    if (!projected) throw new Error("participation_result_missing");
    return { ...authority(), result: clone(projected) };
  };

  const project = (rawRequest: CityProjectRequest): CivicProjection => {
    const request = readRequest(rawRequest);
    assertRequestKeys(request, ["callerId", "profile"]);
    const profile = requiredString(request.profile, "viewer_profile_invalid");
    if (!["administration", "council", "public"].includes(profile)) throw new Error("viewer_profile_invalid");
    assertProfileAccess(config, request, profile as "administration" | "council" | "public");
    return clone(kernel.project({ role: profile as "administration" | "council" | "public" }));
  };

  const prepareCouncilDryRunBrief = (rawRequest: CityCouncilDryRunRequest): CouncilDryRunBrief => {
    const request = readRequest(rawRequest);
    assertRequestKeys(request, ["callerId"]);
    assertProfileAccess(config, request, "council");
    return clone(kernel.prepareCouncilDryRunBrief());
  };

  const askCompanion = async (rawRequest: CityCompanionRequest): Promise<CityCompanionReceipt> => {
    const request = readRequest(rawRequest);
    assertRequestKeys(request, ["callerId", "profile", "question", "sessionKey", "limits"]);
    const profile = requiredString(request.profile, "companion_profile_invalid") as CompanionProfile;
    if (!(COMPANION_PROFILES as readonly string[]).includes(profile)) throw new Error("companion_profile_invalid");
    assertProfileAccess(config, request, profile);
    const question = requiredString(request.question, "companion_question_required");
    if (request.limits !== undefined && !isObject(request.limits)) throw new Error("companion_limits_invalid");
    if (isObject(request.limits)) assertNestedKeys(request.limits, ["maxOutputTokens", "timeoutMs", "maxCostUsd"], "limits");
    const task = runtime.prepareTask({ profile, question });
    const options: CompanionHarnessRunOptions = {
      sessionKey: optionalRequiredString(request.sessionKey, "worker_session_key_required"),
      limits: isObject(request.limits) ? request.limits as CompanionHarnessRunOptions["limits"] : undefined,
      identityPolicy,
    };
    const result = await harness.run(task, options);
    return {
      ...authority(),
      ...clone(result),
      prohibitedEffects: [...task.prohibitedEffects],
      workerResult: clone(result),
    };
  };

  return {
    kind: "city-control-plane",
    municipalityId: config.municipalityId,
    caseId: config.caseId,
    relayUrl: config.relayUrl,
    departments: [...config.departments],
    runtime,
    ingestDiscussion,
    craftSuggestion,
    submitSuggestion,
    recordDepartmentResponse,
    reviewDepartmentResponse,
    publishReviewedBrief,
    recordReviewedParticipation,
    project,
    prepareCouncilDryRunBrief,
    askCompanion,
  };
}
