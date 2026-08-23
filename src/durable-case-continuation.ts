import { types as utilTypes } from "node:util";

import {
  acceptAdministrationWorkspaceResponseAsDraft,
  prepareAdministrationWorkRequest,
  recordAdministrationWorkspaceHandoff,
  type AdministrationWorkspaceHandoffObservationV1,
  type AdministrationWorkspaceHandoffReceiptV1,
  type AdministrationWorkspaceResponseV1,
  type AdministrationWorkspaceTarget,
  type AdministrationWorkRequestV1,
} from "./adapters/administration-workspace-adapter.ts";
import {
  assessCitizenBriefReadiness,
  prepareCitizenBriefDerivation,
  type CitizenBriefDerivationPreparationV1,
  type CitizenBriefReadinessV1,
} from "./adapters/citizen-brief-readiness-adapter.ts";
import { createPublicKnowledge, type PublicKnowledgeProjectionV1 } from "./public-knowledge.ts";
import type {
  ActorBinding,
  CivicCaseCoordinator,
  CommandReceipt,
  DepartmentPackageInput,
  DepartmentReviewInput,
  ParticipationResultInput,
  ProjectionEnvelope,
  ReviewedOutcomeInput,
} from "./civic-case-coordinator.ts";

const CASE_ID = /^urn:stadtstack:case:test:([a-z0-9-]+):[0-9a-f-]{36}$/u;
const MUNICIPALITY = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const POLICY = /^[A-Za-z0-9:._-]{1,256}$/u;
const ACTOR_ID = /^[A-Za-z0-9:._-]{1,256}$/u;
const DEPARTMENT_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const MAX_DATA_DEPTH = 64;
const MAX_DATA_NODES = 10_000;
const MAX_DATA_ARRAY_LENGTH = 2_048;
const MAX_DATA_OBJECT_KEYS = 512;

export type DurableCaseCoordinatorSource = { open(caseId: string): CivicCaseCoordinator };
export type DurableContinuationRoleAuthenticator = {
  authenticate(input: { authorization: unknown; caseId: string }): Promise<ActorBinding | null>;
};
export type DurableContinuationDepartment = { departmentId: string; agent: ActorBinding; reviewer: ActorBinding };
export type DurableCaseContinuationConfig = {
  caseCoordinators: DurableCaseCoordinatorSource;
  roleAuthenticator: DurableContinuationRoleAuthenticator;
  municipalityId: string;
  policyVersion: string;
  actors: {
    caseSteward: ActorBinding;
    administrationReader: ActorBinding;
    publicReader: ActorBinding;
    participationReviewer: ActorBinding;
  };
  departments: readonly DurableContinuationDepartment[];
};

type AuthorizedInput = { authorization: unknown; caseId: string };
export type DurableCaseContinuation = {
  assignDepartmentPackage(input: AuthorizedInput & { departmentPackage: DepartmentPackageInput }): Promise<CommandReceipt>;
  prepareAdministrationWork(input: AuthorizedInput & { packageId: string; targetSystem: AdministrationWorkspaceTarget }): Promise<AdministrationWorkRequestV1>;
  acceptAdministrationHandoff(input: AuthorizedInput & {
    packageId: string;
    targetSystem: AdministrationWorkspaceTarget;
    observation: Omit<AdministrationWorkspaceHandoffObservationV1, "observedBy">;
  }): Promise<AdministrationWorkspaceHandoffReceiptV1>;
  acceptAdministrationResponse(input: AuthorizedInput & {
    administrationAuthorization: unknown;
    packageId: string;
    targetSystem: AdministrationWorkspaceTarget;
    observation: Omit<AdministrationWorkspaceHandoffObservationV1, "observedBy">;
    response: AdministrationWorkspaceResponseV1;
  }): Promise<CommandReceipt>;
  attestDepartmentReview(input: AuthorizedInput & { review: DepartmentReviewInput }): Promise<CommandReceipt>;
  assessCitizenBrief(input: AuthorizedInput): Promise<CitizenBriefReadinessV1>;
  prepareCitizenBrief(input: AuthorizedInput & { briefId: string }): Promise<CitizenBriefDerivationPreparationV1>;
  applyCitizenBrief(input: AuthorizedInput & { briefId: string; preparationChecksum: string }): Promise<CommandReceipt>;
  recordAdvisoryParticipation(input: AuthorizedInput & {
    participation: ParticipationResultInput;
    sourceBrief: { id: string; briefChecksum: string };
  }): Promise<CommandReceipt>;
  recordReviewedOutcome(input: AuthorizedInput & { outcome: ReviewedOutcomeInput }): Promise<CommandReceipt>;
  currentPublicKnowledge(input: { caseId: string }): PublicKnowledgeProjectionV1;
};

type ValidatedConfig = {
  source: DurableCaseCoordinatorSource;
  authenticator: DurableContinuationRoleAuthenticator;
  municipalityId: string;
  policyVersion: string;
  actors: DurableCaseContinuationConfig["actors"];
  departments: ReadonlyMap<string, DurableContinuationDepartment>;
};

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
function exactMethod(value: unknown, name: string, code: string): void {
  const parsed = exact(value, [name], code);
  const descriptor = Object.getOwnPropertyDescriptor(parsed, name);
  if (!descriptor || typeof descriptor.value !== "function") fail(code);
}

type PlainDataCloneState = { seen: WeakSet<object>; nodes: number };

function clonePlainData<T>(
  value: T,
  code: string,
  state: PlainDataCloneState = { seen: new WeakSet<object>(), nodes: 0 },
  depth = 0,
): T {
  state.nodes += 1;
  if (state.nodes > MAX_DATA_NODES || depth > MAX_DATA_DEPTH) fail(code);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail(code);
    return value;
  }
  if (typeof value !== "object" || utilTypes.isProxy(value)) fail(code);
  if (state.seen.has(value)) fail(code);
  state.seen.add(value);

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail(code);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (!lengthDescriptor || typeof lengthDescriptor.value !== "number" ||
      !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
      lengthDescriptor.value > MAX_DATA_ARRAY_LENGTH) fail(code);
    const length = lengthDescriptor.value;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || keys.some((key) => {
      if (key === "length") return false;
      if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)) return true;
      const index = Number(key);
      return !Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key;
    })) fail(code);
    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail(code);
      result.push(clonePlainData(descriptor.value, code, state, depth + 1));
    }
    return result as T;
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const result: Record<string, unknown> = {};
  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_DATA_OBJECT_KEYS) fail(code);
  for (const key of keys) {
    if (typeof key !== "string") fail(code);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail(code);
    Object.defineProperty(result, key, {
      value: clonePlainData(descriptor.value, code, state, depth + 1),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result as T;
}

function identifier(value: unknown, code: string, expression?: RegExp): string {
  if (typeof value !== "string" || value !== value.trim() || value.length === 0 || value.length > 512 ||
    (expression && !expression.test(value))) fail(code);
  return value;
}
function checkedCaseId(value: unknown): string {
  return identifier(value, "durable_continuation_case_invalid", CASE_ID);
}
function actor(value: unknown, expected: ActorBinding["actorClass"] | null, code: string): ActorBinding {
  const parsed = exact(value, ["actorId", "actorClass"], code);
  const actorId = identifier(parsed.actorId, code, ACTOR_ID);
  const classes: ActorBinding["actorClass"][] = [
    "citizen", "public", "administration", "council", "case_steward",
    "department_agent", "department_reviewer", "participation_reviewer",
  ];
  if (typeof parsed.actorClass !== "string" || !classes.includes(parsed.actorClass as ActorBinding["actorClass"]) ||
    (expected !== null && parsed.actorClass !== expected)) fail(code);
  return Object.freeze({ actorId, actorClass: parsed.actorClass as ActorBinding["actorClass"] });
}
function sameActor(left: ActorBinding, right: ActorBinding): boolean {
  return left.actorId === right.actorId && left.actorClass === right.actorClass;
}

function validateConfig(input: DurableCaseContinuationConfig): ValidatedConfig {
  const parsed = exact(input, ["actors", "caseCoordinators", "departments", "municipalityId", "policyVersion", "roleAuthenticator"], "durable_continuation_config_invalid");
  const municipalityId = identifier(parsed.municipalityId, "durable_continuation_config_invalid", MUNICIPALITY);
  const policyVersion = identifier(parsed.policyVersion, "durable_continuation_config_invalid", POLICY);
  exactMethod(parsed.caseCoordinators, "open", "durable_continuation_config_invalid");
  exactMethod(parsed.roleAuthenticator, "authenticate", "durable_continuation_config_invalid");
  const source = parsed.caseCoordinators as DurableCaseCoordinatorSource;
  const authenticator = parsed.roleAuthenticator as DurableContinuationRoleAuthenticator;
  const configuredActors = exact(parsed.actors, ["administrationReader", "caseSteward", "participationReviewer", "publicReader"], "durable_continuation_config_invalid");
  const actors = Object.freeze({
    caseSteward: actor(configuredActors.caseSteward, "case_steward", "durable_continuation_config_invalid"),
    administrationReader: actor(configuredActors.administrationReader, "administration", "durable_continuation_config_invalid"),
    publicReader: actor(configuredActors.publicReader, "public", "durable_continuation_config_invalid"),
    participationReviewer: actor(configuredActors.participationReviewer, "participation_reviewer", "durable_continuation_config_invalid"),
  });
  const configuredDepartments = clonePlainData(parsed.departments, "durable_continuation_config_invalid");
  if (!Array.isArray(configuredDepartments) || configuredDepartments.length !== 8) fail("durable_continuation_config_invalid");
  const departments = new Map<string, DurableContinuationDepartment>();
  const usedActorIds = new Set(Object.values(actors).map((entry) => entry.actorId));
  if (usedActorIds.size !== 4) fail("durable_continuation_config_invalid");
  for (const value of configuredDepartments) {
    const item = exact(value, ["agent", "departmentId", "reviewer"], "durable_continuation_config_invalid");
    const departmentId = identifier(item.departmentId, "durable_continuation_config_invalid", DEPARTMENT_ID);
    const agent = actor(item.agent, "department_agent", "durable_continuation_config_invalid");
    const reviewer = actor(item.reviewer, "department_reviewer", "durable_continuation_config_invalid");
    if (departments.has(departmentId) || usedActorIds.has(agent.actorId) || usedActorIds.has(reviewer.actorId) || agent.actorId === reviewer.actorId) fail("durable_continuation_config_invalid");
    usedActorIds.add(agent.actorId); usedActorIds.add(reviewer.actorId);
    departments.set(departmentId, Object.freeze({ departmentId, agent, reviewer }));
  }
  return Object.freeze({
    source: Object.freeze({ open: source.open.bind(source) }),
    authenticator: Object.freeze({ authenticate: authenticator.authenticate.bind(authenticator) }),
    municipalityId, policyVersion, actors, departments,
  });
}

async function authenticate(config: ValidatedConfig, authorization: unknown, rawCaseId: unknown): Promise<{ caseId: string; principal: ActorBinding }> {
  const caseId = checkedCaseId(rawCaseId);
  const match = CASE_ID.exec(caseId);
  if (!match || match[1] !== config.municipalityId) fail("durable_continuation_municipality_mismatch");
  let candidate: ActorBinding | null;
  try { candidate = await config.authenticator.authenticate({ authorization, caseId }); }
  catch { fail("durable_continuation_authentication_required"); }
  let principal: ActorBinding;
  try { principal = actor(candidate, null, "durable_continuation_authentication_required"); }
  catch { fail("durable_continuation_authentication_required"); }
  return { caseId, principal };
}
function requireActor(principal: ActorBinding, required: ActorBinding): void {
  if (!sameActor(principal, required)) fail("durable_continuation_actor_forbidden");
}

function configuredDepartmentForActor(
  config: ValidatedConfig,
  principal: ActorBinding,
  role: "agent" | "reviewer",
): DurableContinuationDepartment {
  const expectedClass = role === "agent" ? "department_agent" : "department_reviewer";
  if (principal.actorClass !== expectedClass) fail("durable_continuation_actor_forbidden");
  const match = [...config.departments.values()].find((department) =>
    sameActor(principal, role === "agent" ? department.agent : department.reviewer));
  if (!match) fail("durable_continuation_actor_forbidden");
  return match;
}

function checkedProjection(config: ValidatedConfig, rawCaseId: unknown, visibility: "administration" | "public") {
  const requestedCaseId = checkedCaseId(rawCaseId);
  const match = CASE_ID.exec(requestedCaseId);
  if (!match || match[1] !== config.municipalityId) fail("durable_continuation_municipality_mismatch");
  const coordinator = config.source.open(requestedCaseId);
  const projection = coordinator.project({
    schemaVersion: "query_envelope_v1", queryType: "case_projection_v1", caseId: requestedCaseId,
    actorBinding: visibility === "administration" ? config.actors.administrationReader : config.actors.publicReader,
    visibility, policyVersion: config.policyVersion, atCaseVersion: null,
  });
  if (projection.caseId !== requestedCaseId || projection.projection.caseId !== requestedCaseId ||
    projection.projection.municipalityId !== config.municipalityId || projection.policyVersion !== config.policyVersion ||
    projection.visibility !== visibility || projection.caseVersion < 3 || projection.projection.authorityBinding !== "none") {
    fail("durable_continuation_projection_invalid");
  }
  return { coordinator, projection };
}
function packageFromProjection(projection: ProjectionEnvelope, packageId: string) {
  return projection.projection.departmentPackages?.find((entry) => entry.id === packageId) ??
    (projection.projection.departmentPackage?.id === packageId ? projection.projection.departmentPackage : undefined);
}
function preparation(config: ValidatedConfig, caseId: string, packageIdValue: unknown, targetSystem: AdministrationWorkspaceTarget) {
  const packageId = identifier(packageIdValue, "durable_continuation_package_invalid");
  const current = checkedProjection(config, caseId, "administration");
  const request = prepareAdministrationWorkRequest({ projection: current.projection, packageId, targetSystem });
  const department = config.departments.get(request.packageBinding.departmentId);
  if (!department || !sameActor(department.agent, { actorId: request.packageBinding.assignedAgentActorId, actorClass: "department_agent" }) ||
    !sameActor(department.reviewer, { actorId: request.packageBinding.assignedReviewerActorId, actorClass: "department_reviewer" })) {
    fail("durable_continuation_package_not_pinned");
  }
  return { ...current, request, department };
}
function handoff(value: unknown, request: AdministrationWorkRequestV1, observedBy: ActorBinding): AdministrationWorkspaceHandoffReceiptV1 {
  const parsed = exact(value, ["acknowledgedAt", "authorityBinding", "externalTaskRef", "externalWorkspaceRef", "requestChecksum", "requestId", "schemaVersion", "targetSystem"], "durable_continuation_handoff_invalid");
  return recordAdministrationWorkspaceHandoff(request, { ...parsed, observedBy } as AdministrationWorkspaceHandoffObservationV1);
}

/** Authenticated continuation over one already-admitted durable Case. */
export function createDurableCaseContinuation(input: DurableCaseContinuationConfig): DurableCaseContinuation {
  const config = validateConfig(input);
  const requiredDepartmentIds = Object.freeze([...config.departments.keys()].sort());
  return Object.freeze({
    async assignDepartmentPackage(value) {
      const parsed = exact(value, ["authorization", "caseId", "departmentPackage"], "durable_continuation_assignment_invalid");
      const authenticated = await authenticate(config, parsed.authorization, parsed.caseId);
      requireActor(authenticated.principal, config.actors.caseSteward);
      const current = checkedProjection(config, authenticated.caseId, "administration");
      const candidate = clonePlainData(parsed.departmentPackage, "durable_continuation_assignment_invalid") as DepartmentPackageInput;
      const department = config.departments.get(candidate.departmentId);
      if (!department || candidate.assignedAgentActorId !== department.agent.actorId || candidate.assignedReviewerActorId !== department.reviewer.actorId) fail("durable_continuation_package_not_pinned");
      return current.coordinator.handle({
        schemaVersion: "command_envelope_v1", commandType: "assign_department_package_v1", caseId: authenticated.caseId,
        actorBinding: authenticated.principal, expectedCaseVersion: current.projection.caseVersion,
        idempotencyKey: `durable-assignment:${candidate.id}`, visibility: "private_case", policyVersion: config.policyVersion,
        payload: { departmentPackage: candidate },
      });
    },
    async prepareAdministrationWork(value) {
      const parsed = exact(value, ["authorization", "caseId", "packageId", "targetSystem"], "durable_continuation_work_request_invalid");
      const authenticated = await authenticate(config, parsed.authorization, parsed.caseId);
      requireActor(authenticated.principal, config.actors.administrationReader);
      return preparation(config, authenticated.caseId, parsed.packageId, parsed.targetSystem as AdministrationWorkspaceTarget).request;
    },
    async acceptAdministrationHandoff(value) {
      const parsed = exact(value, ["authorization", "caseId", "observation", "packageId", "targetSystem"], "durable_continuation_handoff_invalid");
      const authenticated = await authenticate(config, parsed.authorization, parsed.caseId);
      requireActor(authenticated.principal, config.actors.administrationReader);
      const prepared = preparation(config, authenticated.caseId, parsed.packageId, parsed.targetSystem as AdministrationWorkspaceTarget);
      return handoff(parsed.observation, prepared.request, authenticated.principal);
    },
    async acceptAdministrationResponse(value) {
      const parsed = exact(value, ["administrationAuthorization", "authorization", "caseId", "observation", "packageId", "response", "targetSystem"], "durable_continuation_response_invalid");
      const authenticated = await authenticate(config, parsed.authorization, parsed.caseId);
      const respondingDepartment = configuredDepartmentForActor(config, authenticated.principal, "agent");
      const administration = await authenticate(config, parsed.administrationAuthorization, parsed.caseId);
      requireActor(administration.principal, config.actors.administrationReader);
      const prepared = preparation(config, authenticated.caseId, parsed.packageId, parsed.targetSystem as AdministrationWorkspaceTarget);
      if (prepared.department.departmentId !== respondingDepartment.departmentId) fail("durable_continuation_actor_forbidden");
      const receipt = handoff(parsed.observation, prepared.request, administration.principal);
      const command = acceptAdministrationWorkspaceResponseAsDraft({ request: prepared.request, handoff: receipt,
        response: clonePlainData(parsed.response, "durable_continuation_response_invalid") as AdministrationWorkspaceResponseV1, acceptedBy: authenticated.principal,
        expectedCaseVersion: prepared.projection.caseVersion, policyVersion: config.policyVersion });
      return prepared.coordinator.handle(command);
    },
    async attestDepartmentReview(value) {
      const parsed = exact(value, ["authorization", "caseId", "review"], "durable_continuation_review_invalid");
      const authenticated = await authenticate(config, parsed.authorization, parsed.caseId);
      const reviewingDepartment = configuredDepartmentForActor(config, authenticated.principal, "reviewer");
      const current = checkedProjection(config, authenticated.caseId, "administration");
      const review = clonePlainData(parsed.review, "durable_continuation_review_invalid") as DepartmentReviewInput;
      const packageProjection = packageFromProjection(current.projection, review.packageId);
      const department = packageProjection ? config.departments.get(packageProjection.departmentId) : undefined;
      if (!department) fail("durable_continuation_package_not_pinned");
      if (department.departmentId !== reviewingDepartment.departmentId) fail("durable_continuation_actor_forbidden");
      return current.coordinator.handle({ schemaVersion: "command_envelope_v1", commandType: "attest_department_review_v1",
        caseId: authenticated.caseId, actorBinding: authenticated.principal, expectedCaseVersion: current.projection.caseVersion,
        idempotencyKey: `durable-review:${review.packageId}:${review.draftArtifactChecksum}:${review.decision}`,
        visibility: "private_case", policyVersion: config.policyVersion, payload: { review } });
    },
    async assessCitizenBrief(value) {
      const parsed = exact(value, ["authorization", "caseId"], "durable_continuation_readiness_invalid");
      const authenticated = await authenticate(config, parsed.authorization, parsed.caseId);
      requireActor(authenticated.principal, config.actors.administrationReader);
      return assessCitizenBriefReadiness({ projection: checkedProjection(config, authenticated.caseId, "administration").projection, requiredDepartmentIds });
    },
    async prepareCitizenBrief(value) {
      const parsed = exact(value, ["authorization", "briefId", "caseId"], "durable_continuation_brief_invalid");
      const authenticated = await authenticate(config, parsed.authorization, parsed.caseId);
      requireActor(authenticated.principal, config.actors.caseSteward);
      return prepareCitizenBriefDerivation({ projection: checkedProjection(config, authenticated.caseId, "administration").projection,
        requiredDepartmentIds, briefId: identifier(parsed.briefId, "durable_continuation_brief_invalid"), preparedBy: authenticated.principal });
    },
    async applyCitizenBrief(value) {
      const parsed = exact(value, ["authorization", "briefId", "caseId", "preparationChecksum"], "durable_continuation_brief_invalid");
      const authenticated = await authenticate(config, parsed.authorization, parsed.caseId);
      requireActor(authenticated.principal, config.actors.caseSteward);
      const current = checkedProjection(config, authenticated.caseId, "administration");
      const expected = prepareCitizenBriefDerivation({ projection: current.projection, requiredDepartmentIds,
        briefId: identifier(parsed.briefId, "durable_continuation_brief_invalid"), preparedBy: authenticated.principal });
      if (identifier(parsed.preparationChecksum, "durable_continuation_brief_invalid", SHA256) !== expected.preparationChecksum) fail("durable_continuation_brief_stale");
      return current.coordinator.handle(expected.command);
    },
    async recordAdvisoryParticipation(value) {
      const parsed = exact(value, ["authorization", "caseId", "participation", "sourceBrief"], "durable_continuation_participation_invalid");
      const authenticated = await authenticate(config, parsed.authorization, parsed.caseId);
      requireActor(authenticated.principal, config.actors.participationReviewer);
      const current = checkedProjection(config, authenticated.caseId, "administration");
      const sourceBrief = exact(parsed.sourceBrief, ["briefChecksum", "id"], "durable_continuation_participation_binding_invalid");
      const brief = current.projection.projection.reviewedCitizenBrief;
      if (!brief || brief.correctionState !== "current" || sourceBrief.id !== brief.id || sourceBrief.briefChecksum !== brief.briefChecksum) fail("durable_continuation_participation_binding_invalid");
      const participation = clonePlainData(parsed.participation, "durable_continuation_participation_invalid") as ParticipationResultInput;
      return current.coordinator.handle({ schemaVersion: "command_envelope_v1", commandType: "record_advisory_participation_v1",
        caseId: authenticated.caseId, actorBinding: authenticated.principal, expectedCaseVersion: current.projection.caseVersion,
        idempotencyKey: `durable-participation:${participation.id}:${participation.checksum}`, visibility: "private_case",
        policyVersion: config.policyVersion, payload: { participation,
          sourceBrief: { id: sourceBrief.id as string, briefChecksum: sourceBrief.briefChecksum as string } } });
    },
    async recordReviewedOutcome(value) {
      const parsed = exact(value, ["authorization", "caseId", "outcome"], "durable_continuation_outcome_invalid");
      const authenticated = await authenticate(config, parsed.authorization, parsed.caseId);
      requireActor(authenticated.principal, config.actors.caseSteward);
      const current = checkedProjection(config, authenticated.caseId, "administration");
      const outcome = clonePlainData(parsed.outcome, "durable_continuation_outcome_invalid") as ReviewedOutcomeInput;
      const brief = current.projection.projection.reviewedCitizenBrief;
      const participation = current.projection.projection.participationResult;
      if (!brief || brief.correctionState !== "current" || !participation || participation.correctionState !== "current" ||
        outcome.sourceBrief.id !== brief.id || outcome.sourceBrief.briefChecksum !== brief.briefChecksum ||
        outcome.sourceParticipation.id !== participation.id || outcome.sourceParticipation.participationChecksum !== participation.checksum) fail("durable_continuation_outcome_binding_invalid");
      return current.coordinator.handle({ schemaVersion: "command_envelope_v1", commandType: "record_reviewed_outcome_v1",
        caseId: authenticated.caseId, actorBinding: authenticated.principal, expectedCaseVersion: current.projection.caseVersion,
        idempotencyKey: `durable-outcome:${outcome.id}:${outcome.sourceParticipation.participationChecksum}`,
        visibility: "private_case", policyVersion: config.policyVersion, payload: { outcome } });
    },
    currentPublicKnowledge(value) {
      const parsed = exact(value, ["caseId"], "durable_continuation_public_request_invalid");
      const current = checkedProjection(config, parsed.caseId, "public");
      return createPublicKnowledge({ coordinator: { project: current.coordinator.project }, caseId: current.projection.caseId,
        policyVersion: config.policyVersion, actorBinding: config.actors.publicReader as ActorBinding & { actorClass: "public" } }).project();
    },
  });
}
