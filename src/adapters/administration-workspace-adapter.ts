import { createHash } from "node:crypto";

import type {
  ActorBinding,
  DepartmentPackageProjection,
  ProjectionEnvelope,
  RecordDepartmentDraftCommand,
} from "../civic-case-coordinator.ts";

export const ADMINISTRATION_WORK_REQUEST_SCHEMA_VERSION =
  "administration_work_request_v1" as const;
export const ADMINISTRATION_HANDOFF_OBSERVATION_SCHEMA_VERSION =
  "administration_workspace_handoff_observation_v1" as const;
export const ADMINISTRATION_HANDOFF_RECEIPT_SCHEMA_VERSION =
  "administration_workspace_handoff_receipt_v1" as const;
export const ADMINISTRATION_RESPONSE_SCHEMA_VERSION =
  "administration_workspace_response_v1" as const;

export type AdministrationWorkspaceTarget =
  | "openDesk"
  | "openProject"
  | "municipal_workspace";

export type AdministrationPreparationEffects = {
  networkRequest: false;
  credentialUse: false;
  externalWrite: false;
  civicCaseMutation: false;
  publication: false;
  formalSubmission: false;
  voting: false;
  treasuryEffect: false;
};

export const ADMINISTRATION_PREPARATION_NO_EFFECTS: Readonly<AdministrationPreparationEffects> =
  Object.freeze({
    networkRequest: false,
    credentialUse: false,
    externalWrite: false,
    civicCaseMutation: false,
    publication: false,
    formalSubmission: false,
    voting: false,
    treasuryEffect: false,
  });

export type AdministrationCivicEffects = {
  civicCaseMutation: false;
  reviewAttestation: false;
  publication: false;
  formalSubmission: false;
  voting: false;
  treasuryEffect: false;
};

export const ADMINISTRATION_NO_CIVIC_EFFECTS: Readonly<AdministrationCivicEffects> =
  Object.freeze({
    civicCaseMutation: false,
    reviewAttestation: false,
    publication: false,
    formalSubmission: false,
    voting: false,
    treasuryEffect: false,
  });

export type AdministrationWorkRequestV1 = {
  schemaVersion: typeof ADMINISTRATION_WORK_REQUEST_SCHEMA_VERSION;
  requestId: string;
  contentChecksum: string;
  state: "prepared_not_sent";
  caseBinding: {
    caseId: string;
    caseVersion: number;
    projectionChecksum: string;
  };
  packageBinding: {
    packageId: string;
    departmentId: string;
    packageChecksum: string;
    suggestionId: string;
    assignedAgentActorId: string;
    assignedReviewerActorId: string;
  };
  target: {
    system: AdministrationWorkspaceTarget;
  };
  task: {
    title: string;
    request: string;
    returnContract: {
      responseSchemaVersion: typeof ADMINISTRATION_RESPONSE_SCHEMA_VERSION;
      publicSafeFields: ["publicSummary", "publicCitations"];
      withheldFields: [
        "privateEvidenceRefs",
        "externalWorkspaceRef",
        "externalTaskRef",
        "sourceSystemRecordRef",
      ];
    };
  };
  idempotencyKey: string;
  authorityBinding: "none";
  effects: AdministrationPreparationEffects;
};

export type AdministrationWorkspaceHandoffObservationV1 = {
  schemaVersion: typeof ADMINISTRATION_HANDOFF_OBSERVATION_SCHEMA_VERSION;
  requestId: string;
  requestChecksum: string;
  targetSystem: AdministrationWorkspaceTarget;
  externalWorkspaceRef: string;
  externalTaskRef: string;
  acknowledgedAt: string;
  observedBy: ActorBinding;
  authorityBinding: "none";
};

export type AdministrationWorkspaceHandoffReceiptV1 = {
  schemaVersion: typeof ADMINISTRATION_HANDOFF_RECEIPT_SCHEMA_VERSION;
  receiptId: string;
  requestId: string;
  requestChecksum: string;
  targetSystem: AdministrationWorkspaceTarget;
  externalWorkspaceRef: string;
  externalTaskRef: string;
  acknowledgedAt: string;
  observedBy: ActorBinding;
  state: "acknowledged";
  authorityBinding: "none";
  civicEffects: AdministrationCivicEffects;
  receiptChecksum: string;
};

export type AdministrationWorkspaceResponseV1 = {
  schemaVersion: typeof ADMINISTRATION_RESPONSE_SCHEMA_VERSION;
  responseId: string;
  contentChecksum: string;
  requestId: string;
  requestChecksum: string;
  handoffReceiptId: string;
  handoffReceiptChecksum: string;
  caseId: string;
  packageId: string;
  packageChecksum: string;
  returnedAt: string;
  sourceSystem: {
    kind: AdministrationWorkspaceTarget;
    recordRef: string;
  };
  draft: {
    publicSummary: string;
    publicCitations: string[];
    privateEvidenceRefs: string[];
  };
  authorityBinding: "none";
};

export type PrepareAdministrationWorkRequestInput = {
  projection: ProjectionEnvelope;
  packageId: string;
  targetSystem: AdministrationWorkspaceTarget;
};

export type AcceptAdministrationResponseInput = {
  request: AdministrationWorkRequestV1;
  handoff: AdministrationWorkspaceHandoffReceiptV1;
  response: AdministrationWorkspaceResponseV1;
  acceptedBy: ActorBinding;
  expectedCaseVersion: number;
  policyVersion: string;
};

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,511}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const CREDENTIAL_MARKER = /(?:^|[._:/-])(?:api[_-]?key|authorization|credential|password|secret|token)(?:$|[._:/-])/iu;
const TARGETS = new Set<AdministrationWorkspaceTarget>([
  "openDesk",
  "openProject",
  "municipal_workspace",
]);

function fail(code: string): never {
  throw new Error(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: unknown, expected: readonly string[], code: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) fail(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code);
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function checksum(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex")}`;
}

function without(value: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([candidate]) => candidate !== key));
}

function text(value: unknown, code: string, max = 2_000): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    value.length > max ||
    CONTROL.test(value)
  ) {
    fail(code);
  }
  return value;
}

function identifier(value: unknown, code: string): string {
  const result = text(value, code, 512);
  if (!SAFE_IDENTIFIER.test(result) || CREDENTIAL_MARKER.test(result)) fail(code);
  return result;
}

function sha(value: unknown, code: string): string {
  const result = text(value, code, 71);
  if (!SHA256.test(result)) fail(code);
  return result;
}

function target(value: unknown, code: string): AdministrationWorkspaceTarget {
  if (typeof value !== "string" || !TARGETS.has(value as AdministrationWorkspaceTarget)) {
    fail(code);
  }
  return value as AdministrationWorkspaceTarget;
}

function iso(value: unknown, code: string): string {
  const result = text(value, code, 64);
  if (Number.isNaN(Date.parse(result)) || new Date(result).toISOString() !== result) fail(code);
  return result;
}

function actor(value: unknown, code: string): ActorBinding {
  exactKeys(value, ["actorId", "actorClass"], code);
  const actorId = identifier(value.actorId, code);
  const actorClass = value.actorClass;
  if (
    actorClass !== "citizen" &&
    actorClass !== "public" &&
    actorClass !== "administration" &&
    actorClass !== "council" &&
    actorClass !== "case_steward" &&
    actorClass !== "department_agent" &&
    actorClass !== "department_reviewer" &&
    actorClass !== "participation_reviewer"
  ) {
    fail(code);
  }
  return { actorId, actorClass };
}

function assertHttpsCitation(value: unknown, code: string): string {
  const result = text(value, code, 2_048);
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    fail(code);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    CREDENTIAL_MARKER.test(parsed.search)
  ) {
    fail(code);
  }
  return result;
}

function stringArray(
  value: unknown,
  code: string,
  options: { min: number; max: number; item: (value: unknown, code: string) => string },
): string[] {
  if (!Array.isArray(value) || value.length < options.min || value.length > options.max) fail(code);
  const result = value.map((item) => options.item(item, code));
  if (new Set(result).size !== result.length) fail(code);
  return result;
}

function assertFalseRecord(value: unknown, expected: readonly string[], code: string): void {
  exactKeys(value, expected, code);
  if (expected.some((key) => value[key] !== false)) fail(code);
}

function packageCandidates(projection: ProjectionEnvelope): DepartmentPackageProjection[] {
  const result = projection.projection.departmentPackages
    ? [...projection.projection.departmentPackages]
    : projection.projection.departmentPackage
      ? [projection.projection.departmentPackage]
      : [];
  return result;
}

function assertWorkRequest(value: AdministrationWorkRequestV1): void {
  exactKeys(
    value,
    [
      "schemaVersion",
      "requestId",
      "contentChecksum",
      "state",
      "caseBinding",
      "packageBinding",
      "target",
      "task",
      "idempotencyKey",
      "authorityBinding",
      "effects",
    ],
    "administration_work_request_invalid",
  );
  if (
    value.schemaVersion !== ADMINISTRATION_WORK_REQUEST_SCHEMA_VERSION ||
    value.state !== "prepared_not_sent" ||
    value.authorityBinding !== "none"
  ) fail("administration_work_request_invalid");
  exactKeys(value.caseBinding, ["caseId", "caseVersion", "projectionChecksum"], "administration_case_binding_invalid");
  const caseId = identifier(value.caseBinding.caseId, "administration_case_binding_invalid");
  if (!Number.isSafeInteger(value.caseBinding.caseVersion) || value.caseBinding.caseVersion < 1) {
    fail("administration_case_binding_invalid");
  }
  sha(value.caseBinding.projectionChecksum, "administration_case_binding_invalid");
  exactKeys(
    value.packageBinding,
    [
      "packageId",
      "departmentId",
      "packageChecksum",
      "suggestionId",
      "assignedAgentActorId",
      "assignedReviewerActorId",
    ],
    "administration_package_binding_invalid",
  );
  const packageId = identifier(value.packageBinding.packageId, "administration_package_binding_invalid");
  identifier(value.packageBinding.departmentId, "administration_package_binding_invalid");
  const packageChecksum = sha(value.packageBinding.packageChecksum, "administration_package_binding_invalid");
  identifier(value.packageBinding.suggestionId, "administration_package_binding_invalid");
  identifier(value.packageBinding.assignedAgentActorId, "administration_package_binding_invalid");
  identifier(value.packageBinding.assignedReviewerActorId, "administration_package_binding_invalid");
  exactKeys(value.target, ["system"], "administration_target_invalid");
  const targetSystem = target(value.target.system, "administration_target_invalid");
  exactKeys(value.task, ["title", "request", "returnContract"], "administration_task_invalid");
  text(value.task.title, "administration_task_invalid", 500);
  text(value.task.request, "administration_task_invalid", 4_000);
  exactKeys(
    value.task.returnContract,
    ["responseSchemaVersion", "publicSafeFields", "withheldFields"],
    "administration_return_contract_invalid",
  );
  if (
    value.task.returnContract.responseSchemaVersion !== ADMINISTRATION_RESPONSE_SCHEMA_VERSION ||
    JSON.stringify(value.task.returnContract.publicSafeFields) !==
      JSON.stringify(["publicSummary", "publicCitations"]) ||
    JSON.stringify(value.task.returnContract.withheldFields) !==
      JSON.stringify([
        "privateEvidenceRefs",
        "externalWorkspaceRef",
        "externalTaskRef",
        "sourceSystemRecordRef",
      ])
  ) fail("administration_return_contract_invalid");
  assertFalseRecord(
    value.effects,
    [
      "networkRequest",
      "credentialUse",
      "externalWrite",
      "civicCaseMutation",
      "publication",
      "formalSubmission",
      "voting",
      "treasuryEffect",
    ],
    "administration_effects_invalid",
  );
  const identityHex = checksum({ caseId, packageId, packageChecksum, targetSystem }).slice(7);
  if (
    value.requestId !== `urn:stadtstack:administration-work-request:${identityHex}` ||
    value.idempotencyKey !== `administration-work-request:${identityHex}` ||
    !SHA256.test(value.contentChecksum) ||
    checksum(without(value, "contentChecksum")) !== value.contentChecksum
  ) fail("administration_work_request_checksum_invalid");
}

function assertHandoffReceipt(value: AdministrationWorkspaceHandoffReceiptV1): void {
  exactKeys(
    value,
    [
      "schemaVersion",
      "receiptId",
      "requestId",
      "requestChecksum",
      "targetSystem",
      "externalWorkspaceRef",
      "externalTaskRef",
      "acknowledgedAt",
      "observedBy",
      "state",
      "authorityBinding",
      "civicEffects",
      "receiptChecksum",
    ],
    "administration_handoff_receipt_invalid",
  );
  if (
    value.schemaVersion !== ADMINISTRATION_HANDOFF_RECEIPT_SCHEMA_VERSION ||
    value.state !== "acknowledged" ||
    value.authorityBinding !== "none"
  ) fail("administration_handoff_receipt_invalid");
  identifier(value.receiptId, "administration_handoff_receipt_invalid");
  identifier(value.requestId, "administration_handoff_receipt_invalid");
  sha(value.requestChecksum, "administration_handoff_receipt_invalid");
  target(value.targetSystem, "administration_handoff_receipt_invalid");
  identifier(value.externalWorkspaceRef, "administration_handoff_receipt_invalid");
  identifier(value.externalTaskRef, "administration_handoff_receipt_invalid");
  iso(value.acknowledgedAt, "administration_handoff_receipt_invalid");
  const observedBy = actor(value.observedBy, "administration_handoff_receipt_invalid");
  if (observedBy.actorClass !== "administration") fail("administration_handoff_observer_forbidden");
  assertFalseRecord(
    value.civicEffects,
    [
      "civicCaseMutation",
      "reviewAttestation",
      "publication",
      "formalSubmission",
      "voting",
      "treasuryEffect",
    ],
    "administration_handoff_effects_invalid",
  );
  const identityHex = checksum({
    requestChecksum: value.requestChecksum,
    targetSystem: value.targetSystem,
    externalWorkspaceRef: value.externalWorkspaceRef,
    externalTaskRef: value.externalTaskRef,
    acknowledgedAt: value.acknowledgedAt,
  }).slice(7);
  if (
    value.receiptId !== `urn:stadtstack:administration-handoff:${identityHex}` ||
    !SHA256.test(value.receiptChecksum) ||
    checksum(without(value, "receiptChecksum")) !== value.receiptChecksum
  ) fail("administration_handoff_receipt_checksum_invalid");
}

function assertResponse(value: AdministrationWorkspaceResponseV1): void {
  exactKeys(
    value,
    [
      "schemaVersion",
      "responseId",
      "contentChecksum",
      "requestId",
      "requestChecksum",
      "handoffReceiptId",
      "handoffReceiptChecksum",
      "caseId",
      "packageId",
      "packageChecksum",
      "returnedAt",
      "sourceSystem",
      "draft",
      "authorityBinding",
    ],
    "administration_response_invalid",
  );
  if (
    value.schemaVersion !== ADMINISTRATION_RESPONSE_SCHEMA_VERSION ||
    value.authorityBinding !== "none"
  ) fail("administration_response_invalid");
  identifier(value.responseId, "administration_response_invalid");
  identifier(value.requestId, "administration_response_invalid");
  sha(value.requestChecksum, "administration_response_invalid");
  identifier(value.handoffReceiptId, "administration_response_invalid");
  sha(value.handoffReceiptChecksum, "administration_response_invalid");
  identifier(value.caseId, "administration_response_invalid");
  identifier(value.packageId, "administration_response_invalid");
  sha(value.packageChecksum, "administration_response_invalid");
  iso(value.returnedAt, "administration_response_invalid");
  exactKeys(value.sourceSystem, ["kind", "recordRef"], "administration_response_source_invalid");
  target(value.sourceSystem.kind, "administration_response_source_invalid");
  identifier(value.sourceSystem.recordRef, "administration_response_source_invalid");
  exactKeys(
    value.draft,
    ["publicSummary", "publicCitations", "privateEvidenceRefs"],
    "administration_response_draft_invalid",
  );
  text(value.draft.publicSummary, "administration_response_draft_invalid", 4_000);
  stringArray(value.draft.publicCitations, "administration_response_citations_invalid", {
    min: 1,
    max: 16,
    item: assertHttpsCitation,
  });
  stringArray(value.draft.privateEvidenceRefs, "administration_response_private_refs_invalid", {
    min: 0,
    max: 32,
    item: identifier,
  });
  if (
    !SHA256.test(value.contentChecksum) ||
    checksum(without(value, "contentChecksum")) !== value.contentChecksum
  ) fail("administration_response_checksum_invalid");
}

export function prepareAdministrationWorkRequest(
  input: PrepareAdministrationWorkRequestInput,
): AdministrationWorkRequestV1 {
  if (
    input.projection.visibility !== "administration" ||
    input.projection.caseId !== input.projection.projection.caseId ||
    input.projection.projection.authorityBinding !== "none" ||
    input.projection.projection.formalDecision !== null ||
    !Number.isSafeInteger(input.projection.caseVersion) ||
    input.projection.caseVersion < 1 ||
    !SHA256.test(input.projection.projectionChecksum)
  ) fail("administration_projection_invalid");
  const packageId = identifier(input.packageId, "administration_package_invalid");
  const targetSystem = target(input.targetSystem, "administration_target_invalid");
  const matches = packageCandidates(input.projection).filter((item) => item.id === packageId);
  if (matches.length !== 1) fail("administration_package_not_found");
  const departmentPackage = matches[0]!;
  if (
    departmentPackage.schemaVersion !== "department_package_projection_v1" ||
    departmentPackage.reviewState !== "assigned" ||
    departmentPackage.correctionState !== "current" ||
    departmentPackage.authorityBinding !== "none" ||
    departmentPackage.draft !== undefined ||
    departmentPackage.review !== undefined
  ) fail("administration_package_not_assignable");
  const caseId = identifier(input.projection.caseId, "administration_case_binding_invalid");
  const packageChecksum = sha(
    departmentPackage.packageChecksum,
    "administration_package_binding_invalid",
  );
  const departmentId = identifier(
    departmentPackage.departmentId,
    "administration_package_binding_invalid",
  );
  const suggestionId = identifier(
    departmentPackage.suggestionId,
    "administration_package_binding_invalid",
  );
  const assignedAgentActorId = identifier(
    departmentPackage.assignedAgentActorId,
    "administration_package_binding_invalid",
  );
  const assignedReviewerActorId = identifier(
    departmentPackage.assignedReviewerActorId,
    "administration_package_binding_invalid",
  );
  const requestText = text(departmentPackage.request, "administration_task_invalid", 4_000);
  const identityHex = checksum({ caseId, packageId, packageChecksum, targetSystem }).slice(7);
  const base: Omit<AdministrationWorkRequestV1, "contentChecksum"> = {
    schemaVersion: ADMINISTRATION_WORK_REQUEST_SCHEMA_VERSION,
    requestId: `urn:stadtstack:administration-work-request:${identityHex}`,
    state: "prepared_not_sent",
    caseBinding: {
      caseId,
      caseVersion: input.projection.caseVersion,
      projectionChecksum: input.projection.projectionChecksum,
    },
    packageBinding: {
      packageId,
      departmentId,
      packageChecksum,
      suggestionId,
      assignedAgentActorId,
      assignedReviewerActorId,
    },
    target: { system: targetSystem },
    task: {
      title: `${departmentId}: ${requestText}`.slice(0, 500),
      request: requestText,
      returnContract: {
        responseSchemaVersion: ADMINISTRATION_RESPONSE_SCHEMA_VERSION,
        publicSafeFields: ["publicSummary", "publicCitations"],
        withheldFields: [
          "privateEvidenceRefs",
          "externalWorkspaceRef",
          "externalTaskRef",
          "sourceSystemRecordRef",
        ],
      },
    },
    idempotencyKey: `administration-work-request:${identityHex}`,
    authorityBinding: "none",
    effects: { ...ADMINISTRATION_PREPARATION_NO_EFFECTS },
  };
  const result: AdministrationWorkRequestV1 = {
    ...base,
    contentChecksum: checksum(base),
  };
  assertWorkRequest(result);
  return structuredClone(result);
}

export function recordAdministrationWorkspaceHandoff(
  request: AdministrationWorkRequestV1,
  observation: AdministrationWorkspaceHandoffObservationV1,
): AdministrationWorkspaceHandoffReceiptV1 {
  assertWorkRequest(request);
  exactKeys(
    observation,
    [
      "schemaVersion",
      "requestId",
      "requestChecksum",
      "targetSystem",
      "externalWorkspaceRef",
      "externalTaskRef",
      "acknowledgedAt",
      "observedBy",
      "authorityBinding",
    ],
    "administration_handoff_observation_invalid",
  );
  const observedBy = actor(observation.observedBy, "administration_handoff_observation_invalid");
  if (
    observation.schemaVersion !== ADMINISTRATION_HANDOFF_OBSERVATION_SCHEMA_VERSION ||
    observation.requestId !== request.requestId ||
    observation.requestChecksum !== request.contentChecksum ||
    observation.targetSystem !== request.target.system ||
    observation.authorityBinding !== "none" ||
    observedBy.actorClass !== "administration"
  ) fail("administration_handoff_binding_invalid");
  const externalWorkspaceRef = identifier(
    observation.externalWorkspaceRef,
    "administration_handoff_observation_invalid",
  );
  const externalTaskRef = identifier(
    observation.externalTaskRef,
    "administration_handoff_observation_invalid",
  );
  const acknowledgedAt = iso(
    observation.acknowledgedAt,
    "administration_handoff_observation_invalid",
  );
  const identityHex = checksum({
    requestChecksum: request.contentChecksum,
    targetSystem: request.target.system,
    externalWorkspaceRef,
    externalTaskRef,
    acknowledgedAt,
  }).slice(7);
  const base: Omit<AdministrationWorkspaceHandoffReceiptV1, "receiptChecksum"> = {
    schemaVersion: ADMINISTRATION_HANDOFF_RECEIPT_SCHEMA_VERSION,
    receiptId: `urn:stadtstack:administration-handoff:${identityHex}`,
    requestId: request.requestId,
    requestChecksum: request.contentChecksum,
    targetSystem: request.target.system,
    externalWorkspaceRef,
    externalTaskRef,
    acknowledgedAt,
    observedBy,
    state: "acknowledged",
    authorityBinding: "none",
    civicEffects: { ...ADMINISTRATION_NO_CIVIC_EFFECTS },
  };
  const result: AdministrationWorkspaceHandoffReceiptV1 = {
    ...base,
    receiptChecksum: checksum(base),
  };
  assertHandoffReceipt(result);
  return structuredClone(result);
}

export function acceptAdministrationWorkspaceResponseAsDraft(
  input: AcceptAdministrationResponseInput,
): RecordDepartmentDraftCommand {
  assertWorkRequest(input.request);
  assertHandoffReceipt(input.handoff);
  assertResponse(input.response);
  const acceptedBy = actor(input.acceptedBy, "administration_response_acceptor_invalid");
  if (
    acceptedBy.actorClass !== "department_agent" ||
    acceptedBy.actorId !== input.request.packageBinding.assignedAgentActorId
  ) fail("administration_response_acceptor_forbidden");
  if (
    input.handoff.requestId !== input.request.requestId ||
    input.handoff.requestChecksum !== input.request.contentChecksum ||
    input.handoff.targetSystem !== input.request.target.system ||
    input.response.requestId !== input.request.requestId ||
    input.response.requestChecksum !== input.request.contentChecksum ||
    input.response.handoffReceiptId !== input.handoff.receiptId ||
    input.response.handoffReceiptChecksum !== input.handoff.receiptChecksum ||
    input.response.caseId !== input.request.caseBinding.caseId ||
    input.response.packageId !== input.request.packageBinding.packageId ||
    input.response.packageChecksum !== input.request.packageBinding.packageChecksum ||
    input.response.sourceSystem.kind !== input.request.target.system ||
    input.response.sourceSystem.recordRef !== input.handoff.externalTaskRef
  ) fail("administration_response_binding_invalid");
  if (
    !Number.isSafeInteger(input.expectedCaseVersion) ||
    input.expectedCaseVersion < input.request.caseBinding.caseVersion
  ) fail("administration_response_case_version_invalid");
  const policyVersion = identifier(
    input.policyVersion,
    "administration_response_policy_invalid",
  );
  const responseHex = input.response.contentChecksum.slice(7);
  return {
    schemaVersion: "command_envelope_v1",
    commandType: "record_department_draft_v1",
    caseId: input.request.caseBinding.caseId,
    actorBinding: acceptedBy,
    expectedCaseVersion: input.expectedCaseVersion,
    idempotencyKey: `administration-response:${responseHex}`,
    visibility: "private_case",
    policyVersion,
    payload: {
      packageId: input.request.packageBinding.packageId,
      packageChecksum: input.request.packageBinding.packageChecksum,
      draft: {
        schemaVersion: "department_draft_v1",
        id: `urn:stadtstack:department-draft:${responseHex}`,
        publicSummary: input.response.draft.publicSummary,
        publicCitations: [...input.response.draft.publicCitations],
        privateEvidenceRefs: [...input.response.draft.privateEvidenceRefs],
        authorityBinding: "none",
      },
    },
  };
}

export function checksumAdministrationWorkspaceResponse(
  response: Omit<AdministrationWorkspaceResponseV1, "contentChecksum">,
): AdministrationWorkspaceResponseV1 {
  const result: AdministrationWorkspaceResponseV1 = {
    ...structuredClone(response),
    contentChecksum: checksum(response),
  };
  assertResponse(result);
  return result;
}
