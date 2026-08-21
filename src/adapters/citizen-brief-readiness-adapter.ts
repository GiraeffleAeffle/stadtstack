import { createHash } from "node:crypto";

import type {
  ActorBinding,
  BriefSourceBinding,
  DepartmentPackageProjection,
  DeriveCitizenBriefCommand,
  ProjectionEnvelope,
} from "../civic-case-coordinator.ts";

export const CITIZEN_BRIEF_READINESS_SCHEMA_VERSION =
  "citizen_brief_readiness_v1" as const;
export const CITIZEN_BRIEF_DERIVATION_PREPARATION_SCHEMA_VERSION =
  "citizen_brief_derivation_preparation_v1" as const;

export type CitizenBriefReadinessStatus =
  | "waiting_for_department_review"
  | "ready_for_case_steward"
  | "citizen_brief_current";

export type CitizenBriefBlockerReason =
  | "package_missing"
  | "response_not_recorded"
  | "review_pending"
  | "review_rejected"
  | "response_corrected"
  | "response_retracted";

export type CitizenBriefPreparationEffects = {
  networkRequest: false;
  credentialUse: false;
  externalWrite: false;
  civicCaseMutation: false;
  publication: false;
  formalSubmission: false;
  voting: false;
  treasuryEffect: false;
};

export const CITIZEN_BRIEF_PREPARATION_NO_EFFECTS: Readonly<CitizenBriefPreparationEffects> =
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

export type CitizenBriefReadinessV1 = {
  schemaVersion: typeof CITIZEN_BRIEF_READINESS_SCHEMA_VERSION;
  status: CitizenBriefReadinessStatus;
  caseBinding: {
    caseId: string;
    caseVersion: number;
    journalHeadChecksum: string;
    projectionChecksum: string;
    policyVersion: string;
  };
  requiredDepartmentIds: string[];
  acceptedDepartmentIds: string[];
  blockers: Array<{
    departmentId: string;
    reason: CitizenBriefBlockerReason;
  }>;
  sourceBindings: BriefSourceBinding[];
  currentBrief: {
    id: string;
    briefChecksum: string;
  } | null;
  authorityBinding: "none";
  effects: CitizenBriefPreparationEffects;
  readinessChecksum: string;
};

export type AssessCitizenBriefReadinessInput = {
  projection: ProjectionEnvelope;
  requiredDepartmentIds: readonly string[];
};

export type PrepareCitizenBriefDerivationInput = AssessCitizenBriefReadinessInput & {
  briefId: string;
  preparedBy: ActorBinding;
};

export type CitizenBriefDerivationPreparationV1 = {
  schemaVersion: typeof CITIZEN_BRIEF_DERIVATION_PREPARATION_SCHEMA_VERSION;
  state: "prepared_not_applied";
  readinessChecksum: string;
  command: DeriveCitizenBriefCommand;
  authorityBinding: "none";
  effects: CitizenBriefPreparationEffects;
  preparationChecksum: string;
};

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,511}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const SECRET_MARKER = /(?:^|[._:/-])(?:api[_-]?key|authorization|credential|password|secret|token)(?:$|[._:/-])/iu;

function fail(code: string): never {
  throw new Error(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: unknown,
  expected: readonly string[],
  code: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) fail(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
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

function identifier(value: unknown, code: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    CONTROL.test(value) ||
    !SAFE_IDENTIFIER.test(value) ||
    SECRET_MARKER.test(value)
  ) {
    fail(code);
  }
  return value;
}

function sha(value: unknown, code: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) fail(code);
  return value;
}

function packageMap(
  projection: ProjectionEnvelope,
  requiredDepartmentIds: readonly string[],
): Map<string, DepartmentPackageProjection> {
  const packages = projection.projection.departmentPackages ?? [];
  if (!Array.isArray(packages)) fail("citizen_brief_readiness_packages_invalid");
  const required = new Set(requiredDepartmentIds);
  const byDepartment = new Map<string, DepartmentPackageProjection>();
  const packageIds = new Set<string>();
  for (const item of packages) {
    if (!isRecord(item)) fail("citizen_brief_readiness_package_invalid");
    const departmentId = identifier(
      item.departmentId,
      "citizen_brief_readiness_package_invalid",
    );
    const packageId = identifier(item.id, "citizen_brief_readiness_package_invalid");
    if (
      item.schemaVersion !== "department_package_projection_v1" ||
      item.authorityBinding !== "none" ||
      !required.has(departmentId) ||
      byDepartment.has(departmentId) ||
      packageIds.has(packageId)
    ) {
      fail("citizen_brief_readiness_department_set_invalid");
    }
    sha(item.packageChecksum, "citizen_brief_readiness_package_invalid");
    byDepartment.set(departmentId, item as DepartmentPackageProjection);
    packageIds.add(packageId);
  }
  return byDepartment;
}

function acceptedBinding(
  item: DepartmentPackageProjection,
): BriefSourceBinding | null {
  if (item.correctionState !== "current" || item.reviewState !== "accepted") {
    return null;
  }
  if (!isRecord(item.draft) || !isRecord(item.review)) {
    fail("citizen_brief_readiness_accepted_response_invalid");
  }
  const draftArtifactChecksum = sha(
    item.draft.artifactChecksum,
    "citizen_brief_readiness_accepted_response_invalid",
  );
  const reviewAttestationChecksum = sha(
    item.review.attestationChecksum,
    "citizen_brief_readiness_accepted_response_invalid",
  );
  if (
    item.review.decision !== "accepted" ||
    item.review.draftArtifactChecksum !== draftArtifactChecksum ||
    item.review.policyVersion === undefined
  ) {
    fail("citizen_brief_readiness_accepted_response_invalid");
  }
  return {
    packageId: identifier(item.id, "citizen_brief_readiness_package_invalid"),
    packageChecksum: sha(
      item.packageChecksum,
      "citizen_brief_readiness_package_invalid",
    ),
    draftArtifactChecksum,
    reviewAttestationChecksum,
  };
}

function blockerFor(item: DepartmentPackageProjection): CitizenBriefBlockerReason {
  if (item.correctionState === "corrected") return "response_corrected";
  if (item.correctionState === "retracted") return "response_retracted";
  if (item.reviewState === "rejected") return "review_rejected";
  if (item.reviewState === "draft_pending_review") return "review_pending";
  return "response_not_recorded";
}

function assertProjection(input: AssessCitizenBriefReadinessInput): string[] {
  const projection = input.projection;
  exactKeys(
    projection,
    [
      "schemaVersion",
      "caseId",
      "caseVersion",
      "journalHeadChecksum",
      "projectionChecksum",
      "visibility",
      "policyVersion",
      "projection",
    ],
    "citizen_brief_readiness_projection_invalid",
  );
  if (
    projection.schemaVersion !== "projection_envelope_v1" ||
    projection.visibility !== "administration" ||
    projection.caseId !== projection.projection.caseId ||
    (projection.projection.reviewedCitizenBrief !== undefined &&
      projection.policyVersion !== projection.projection.reviewedCitizenBrief.policyVersion) ||
    projection.projection.schemaVersion !== "case_projection_v1" ||
    projection.projection.authorityBinding !== "none" ||
    projection.projection.formalDecision !== null ||
    projection.projection.suggestion.status !== "admitted" ||
    !Number.isSafeInteger(projection.caseVersion) ||
    projection.caseVersion < 1
  ) {
    fail("citizen_brief_readiness_projection_invalid");
  }
  identifier(projection.caseId, "citizen_brief_readiness_projection_invalid");
  identifier(projection.policyVersion, "citizen_brief_readiness_projection_invalid");
  sha(projection.journalHeadChecksum, "citizen_brief_readiness_projection_invalid");
  sha(projection.projectionChecksum, "citizen_brief_readiness_projection_invalid");
  if (
    !Array.isArray(input.requiredDepartmentIds) ||
    input.requiredDepartmentIds.length !== 8
  ) {
    fail("citizen_brief_readiness_required_departments_invalid");
  }
  const required = input.requiredDepartmentIds.map((departmentId) =>
    identifier(departmentId, "citizen_brief_readiness_required_departments_invalid"),
  );
  if (new Set(required).size !== required.length) {
    fail("citizen_brief_readiness_required_departments_invalid");
  }
  return [...required].sort();
}

export function assessCitizenBriefReadiness(
  input: AssessCitizenBriefReadinessInput,
): CitizenBriefReadinessV1 {
  const requiredDepartmentIds = assertProjection(input);
  const byDepartment = packageMap(input.projection, requiredDepartmentIds);
  const acceptedDepartmentIds: string[] = [];
  const blockers: CitizenBriefReadinessV1["blockers"] = [];
  const sourceBindings: BriefSourceBinding[] = [];

  for (const departmentId of requiredDepartmentIds) {
    const item = byDepartment.get(departmentId);
    if (!item) {
      blockers.push({ departmentId, reason: "package_missing" });
      continue;
    }
    const binding = acceptedBinding(item);
    if (!binding) {
      blockers.push({ departmentId, reason: blockerFor(item) });
      continue;
    }
    if (item.review?.policyVersion !== input.projection.policyVersion) {
      fail("citizen_brief_readiness_review_policy_mismatch");
    }
    acceptedDepartmentIds.push(departmentId);
    sourceBindings.push(binding);
  }

  const brief = input.projection.projection.reviewedCitizenBrief;
  let currentBrief: CitizenBriefReadinessV1["currentBrief"] = null;
  if (brief?.correctionState === "current") {
    const responseDepartmentIds = brief.responses
      .map((response) =>
        identifier(
          response.departmentId,
          "citizen_brief_readiness_current_brief_inconsistent",
        ),
      )
      .sort();
    if (
      brief.schemaVersion !== "citizen_brief_projection_v1" ||
      brief.authorityBinding !== "none" ||
      blockers.length !== 0 ||
      responseDepartmentIds.length !== requiredDepartmentIds.length ||
      responseDepartmentIds.some(
        (departmentId, index) => departmentId !== requiredDepartmentIds[index],
      )
    ) {
      fail("citizen_brief_readiness_current_brief_inconsistent");
    }
    currentBrief = {
      id: identifier(brief.id, "citizen_brief_readiness_current_brief_invalid"),
      briefChecksum: sha(
        brief.briefChecksum,
        "citizen_brief_readiness_current_brief_invalid",
      ),
    };
  }

  const status: CitizenBriefReadinessStatus = currentBrief
    ? "citizen_brief_current"
    : blockers.length === 0
      ? "ready_for_case_steward"
      : "waiting_for_department_review";
  const base: Omit<CitizenBriefReadinessV1, "readinessChecksum"> = {
    schemaVersion: CITIZEN_BRIEF_READINESS_SCHEMA_VERSION,
    status,
    caseBinding: {
      caseId: input.projection.caseId,
      caseVersion: input.projection.caseVersion,
      journalHeadChecksum: input.projection.journalHeadChecksum,
      projectionChecksum: input.projection.projectionChecksum,
      policyVersion: input.projection.policyVersion,
    },
    requiredDepartmentIds,
    acceptedDepartmentIds,
    blockers,
    sourceBindings,
    currentBrief,
    authorityBinding: "none",
    effects: { ...CITIZEN_BRIEF_PREPARATION_NO_EFFECTS },
  };
  return structuredClone({ ...base, readinessChecksum: checksum(base) });
}

export function prepareCitizenBriefDerivation(
  input: PrepareCitizenBriefDerivationInput,
): CitizenBriefDerivationPreparationV1 {
  const readiness = assessCitizenBriefReadiness(input);
  if (readiness.status === "citizen_brief_current") {
    fail("citizen_brief_already_current");
  }
  if (readiness.status !== "ready_for_case_steward") {
    fail("citizen_brief_not_ready");
  }
  exactKeys(input.preparedBy, ["actorId", "actorClass"], "citizen_brief_steward_invalid");
  const actorId = identifier(
    input.preparedBy.actorId,
    "citizen_brief_steward_invalid",
  );
  if (input.preparedBy.actorClass !== "case_steward") {
    fail("citizen_brief_steward_forbidden");
  }
  const briefId = identifier(input.briefId, "citizen_brief_id_invalid");
  const identityHex = checksum({
    caseBinding: readiness.caseBinding,
    readinessChecksum: readiness.readinessChecksum,
    briefId,
    actorId,
  }).slice(7);
  const command: DeriveCitizenBriefCommand = {
    schemaVersion: "command_envelope_v1",
    commandType: "derive_citizen_brief_v1",
    caseId: readiness.caseBinding.caseId,
    actorBinding: { actorId, actorClass: "case_steward" },
    expectedCaseVersion: readiness.caseBinding.caseVersion,
    idempotencyKey: `citizen-brief-derivation:${identityHex}`,
    visibility: "private_case",
    policyVersion: readiness.caseBinding.policyVersion,
    payload: {
      brief: {
        id: briefId,
        sourceBindings: structuredClone(readiness.sourceBindings),
        authorityBinding: "none",
      },
    },
  };
  const base: Omit<CitizenBriefDerivationPreparationV1, "preparationChecksum"> = {
    schemaVersion: CITIZEN_BRIEF_DERIVATION_PREPARATION_SCHEMA_VERSION,
    state: "prepared_not_applied",
    readinessChecksum: readiness.readinessChecksum,
    command,
    authorityBinding: "none",
    effects: { ...CITIZEN_BRIEF_PREPARATION_NO_EFFECTS },
  };
  const result = { ...base, preparationChecksum: checksum(base) };
  if (checksum(without(result, "preparationChecksum")) !== result.preparationChecksum) {
    fail("citizen_brief_preparation_checksum_invalid");
  }
  return structuredClone(result);
}
