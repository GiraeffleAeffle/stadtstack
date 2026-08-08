export type AuthorityBinding = "none";

export type CivicActor = {
  id: string;
  role:
    | "citizen"
    | "case_steward"
    | "department_agent"
    | "department_reviewer"
    | "participation_reviewer"
    | "publisher";
  /** Required for department agents/reviewers; never projected publicly. */
  departmentId?: string;
};

export type CivicKernelConfig = {
  municipalityId: string;
  caseId: string;
  departments: readonly string[];
  /** Immutable registry used to bind every dispatch envelope to an actor. */
  actors: readonly CivicActor[];
};

export type ParticipationOptionAggregate = {
  optionId: string;
  label: string;
  aggregateCount: number;
};

export type RepresentationAudit = {
  targetPopulationDescription: string;
  recruitmentMethod: string;
  samplingMethod: string | null;
  totalInvited: number | null;
  totalStarted: number;
  totalCompleted: number;
  limitations: readonly string[];
};

/**
 * Provider-neutral, reviewed participation output.  Deliberation systems
 * may differ internally, but only this aggregate crosses the civic boundary.
 * Ballots, wallet/user identifiers and eligibility proofs have no fields in
 * this contract and are rejected by the kernel when supplied at runtime.
 */
export type ParticipationResult = {
  schemaVersion: "participation_result_v1";
  id: string;
  contractId: string;
  contractVersion: number;
  methodKind: string;
  methodVersion: string;
  ruleId: string;
  ruleVersion: string;
  authorityBinding: AuthorityBinding;
  question: string;
  options: readonly ParticipationOptionAggregate[];
  totalAccepted: number;
  resultSummary: string;
  unresolvedDissent: readonly string[];
  representationAudit: RepresentationAudit;
  limitations: readonly string[];
  openedAt: string;
  closedAt: string;
  reviewedAt: string;
  resultArtifactRef: string;
  minorityReportRef: string | null;
  correctionState: "current" | "corrected" | "retracted";
  checksum: string;
};

export type CouncilDryRunBrief = {
  schemaVersion: "council_dry_run_brief_v1";
  municipalityId: string;
  caseId: string;
  authorityBinding: AuthorityBinding;
  state: "dry_run_not_submitted";
  summary: string;
  citizenSignal: ParticipationResult | null;
  reviewedDepartmentResponseCount: number;
  formalDecision: null;
  councilSubmissionCreated: false;
  formalVoteStarted: false;
  publicWrite: false;
};

export type Suggestion = {
  id: string;
  discussionId: string;
  title: string;
  status: "draft" | "submitted_for_administration_review";
};

export type DiscussionVerificationProof =
  | {
      kind: "nostr_nip01";
      verified: true;
      signature: string;
    }
  | {
      kind: "synthetic_fixture";
      deterministic: true;
      fixtureId: string;
    };

/**
 * Public, non-secret provenance retained for a source-normalized discussion.
 * The optional top-level scope fields accept a DiscussionArtifact directly;
 * the kernel normalizes them into `scope` before storing or projecting.
 */
export type DiscussionProvenance = {
  schemaVersion?: "discussion_artifact_v1";
  id?: string;
  artifactId?: string;
  source: "synthetic_fixture" | "nostr";
  sourceRef: string;
  municipalityId?: string;
  caseId?: string;
  scope?: {
    municipalityId: string;
    caseId: string;
  };
  authorityBinding: AuthorityBinding;
  verificationProof: DiscussionVerificationProof;
  event: {
    id: string;
    pubkey: string;
  };
};

export type CivicDiscussion = {
  id: string;
  content: string;
  transport: "synthetic_nostr_fixture";
  signature: string;
  provenance?: DiscussionProvenance;
};

export type DepartmentWorkPackage = {
  id: string;
  departmentId: string;
  suggestionId: string;
  status: "awaiting_review";
  response?: {
    summary: string;
    citations: string[];
    status: "pending_review" | "reviewed";
  };
};

export type CivicProjection = {
  municipalityId: string;
  caseId: string;
  authorityBinding: AuthorityBinding;
  formalDecision: null;
  discussions: CivicDiscussion[];
  suggestions: Suggestion[];
  reviewedCitizenBrief?: {
    summary: string;
    citations: string[];
    /** Present only in the administration projection; public views use a role label. */
    publishedBy?: string;
  };
  participationResult?: ParticipationResult;
  councilDryRunBrief?: CouncilDryRunBrief;
  departmentWorkPackages?: DepartmentWorkPackage[];
};

export type CivicCommand =
  | {
      type: "record_discussion";
      actor: CivicActor;
      discussion: {
        id: string;
        content: string;
        transport: "synthetic_nostr_fixture";
        signature: string;
        provenance?: DiscussionProvenance;
      };
    }
  | {
      type: "craft_suggestion";
      actor: CivicActor;
      suggestion: {
        id: string;
        discussionId: string;
        title: string;
      };
    }
  | {
      type: "submit_suggestion_for_administration";
      actor: CivicActor;
      suggestionId: string;
    }
  | {
      type: "record_department_response";
      actor: CivicActor;
      workPackageId: string;
      response: {
        summary: string;
        citations: string[];
      };
    }
  | {
      type: "review_department_response";
      actor: CivicActor;
      workPackageId: string;
    }
  | {
      type: "publish_reviewed_citizen_brief";
      actor: CivicActor;
      summary: string;
    }
  | {
      type: "record_participation_result" | "record_reviewed_participation_result";
      actor: CivicActor;
      result: ParticipationResult;
    };

const RAW_PARTICIPATION_FIELD =
  /(ballot|wallet|npub|participant[_-]?id|user[_-]?id|eligibility[_-]?proof|social[_-]?graph|identity)/i;

// Bootstrap guard only: these patterns block obvious credential/identity
// markers at the aggregate boundary. Production admission still requires a
// reviewed PII/DLP policy and must not rely on substring matching alone.
const RAW_PARTICIPATION_VALUE_MARKERS: readonly RegExp[] = [
  /\bnpub1[0-9a-z][0-9a-z-]{7,}\b/i,
  /\bnsec1[0-9a-z][0-9a-z-]{7,}\b/i,
  /\b0x[a-f0-9]{40}\b/i,
  /\b(?:participant(?:id|[_-]?id)|user(?:id|[_-]?id)|identity|ballot|wallet)\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/i,
];

const DISCUSSION_PROVENANCE_KEYS = new Set([
  "schemaVersion",
  "id",
  "artifactId",
  "source",
  "sourceRef",
  "municipalityId",
  "caseId",
  "scope",
  "authorityBinding",
  "verificationProof",
  "event",
]);
const DISCUSSION_SCOPE_KEYS = new Set(["municipalityId", "caseId"]);
const DISCUSSION_PROOF_KEYS = new Set(["kind", "verified", "signature", "deterministic", "fixtureId"]);
const DISCUSSION_EVENT_KEYS = new Set([
  "id",
  "pubkey",
  "createdAt",
  "kind",
  "content",
  "tags",
  "relayRefs",
]);
const DISCUSSION_PRIVATE_MARKER = /(?:private|secret|nsec|wallet|credential|token|password|raw[_-]?citizen|participant|user[_-]?id)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const CIVIC_ACTOR_ROLES = new Set<CivicActor["role"]>([
  "citizen",
  "case_steward",
  "department_agent",
  "department_reviewer",
  "participation_reviewer",
  "publisher",
]);
const CIVIC_ACTOR_KEYS = new Set(["id", "role", "departmentId"]);

/**
 * Normalize and authenticate the actor envelope at the kernel boundary.
 *
 * The control plane normally supplies actors from its registry, but the
 * kernel is also exported for local callers.  Keeping this check here makes a
 * direct dispatch unable to smuggle role/department fields or claim a
 * department it does not carry in its normalized identity.
 */
function normalizeCivicActor(value: unknown): CivicActor {
  if (!isRecord(value)) throw new Error("civic_actor_invalid");
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !CIVIC_ACTOR_KEYS.has(key)) {
      throw new Error(`civic_actor_field_forbidden:${String(key)}`);
    }
  }
  if (typeof value.id !== "string" || value.id.trim() === "") {
    throw new Error("civic_actor_id_required");
  }
  if (typeof value.role !== "string" || !CIVIC_ACTOR_ROLES.has(value.role as CivicActor["role"])) {
    throw new Error("civic_actor_role_invalid");
  }
  const role = value.role as CivicActor["role"];
  const hasDepartmentId = Object.prototype.hasOwnProperty.call(value, "departmentId");
  if (role === "department_agent" || role === "department_reviewer") {
    if (typeof value.departmentId !== "string" || value.departmentId.trim() === "") {
      throw new Error("civic_actor_department_required");
    }
    return { id: value.id.trim(), role, departmentId: value.departmentId.trim() };
  }
  if (hasDepartmentId) {
    throw new Error("civic_actor_department_forbidden");
  }
  return { id: value.id.trim(), role };
}

function requireDiscussionString(value: unknown, error: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(error);
  }
  return value.trim();
}

function assertDiscussionKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (DISCUSSION_PRIVATE_MARKER.test(key)) {
      throw new Error(`discussion_provenance_private_field_forbidden:${path}.${key}`);
    }
    if (!allowed.has(key)) {
      throw new Error(`discussion_provenance_field_forbidden:${path}.${key}`);
    }
  }
}

function normalizeDiscussionScope(
  input: unknown,
  fallback: CivicKernelConfig,
): { municipalityId: string; caseId: string } {
  if (input === undefined) {
    return {
      municipalityId: fallback.municipalityId,
      caseId: fallback.caseId,
    };
  }
  if (!isRecord(input)) {
    throw new Error("discussion_provenance_scope_invalid");
  }
  assertDiscussionKeys(input, DISCUSSION_SCOPE_KEYS, "scope");
  const municipalityId = requireDiscussionString(
    input.municipalityId,
    "discussion_provenance_scope_invalid",
  );
  const caseId = requireDiscussionString(input.caseId, "discussion_provenance_scope_invalid");
  if (
    municipalityId !== fallback.municipalityId ||
    caseId !== fallback.caseId
  ) {
    throw new Error("discussion_provenance_scope_mismatch");
  }
  return { municipalityId, caseId };
}

function normalizeDiscussionProof(input: unknown): DiscussionVerificationProof {
  if (!isRecord(input)) {
    throw new Error("discussion_provenance_proof_invalid");
  }
  assertDiscussionKeys(input, DISCUSSION_PROOF_KEYS, "verificationProof");
  if (input.kind === "nostr_nip01") {
    if (input.verified !== true) {
      throw new Error("discussion_provenance_proof_invalid");
    }
    return {
      kind: "nostr_nip01",
      verified: true,
      signature: requireDiscussionString(
        input.signature,
        "discussion_provenance_proof_invalid",
      ),
    };
  }
  if (input.kind === "synthetic_fixture") {
    if (input.deterministic !== true) {
      throw new Error("discussion_provenance_proof_invalid");
    }
    return {
      kind: "synthetic_fixture",
      deterministic: true,
      fixtureId: requireDiscussionString(
        input.fixtureId,
        "discussion_provenance_proof_invalid",
      ),
    };
  }
  throw new Error("discussion_provenance_proof_invalid");
}

function normalizeDiscussionProvenance(
  input: unknown,
  config: CivicKernelConfig,
): DiscussionProvenance {
  if (!isRecord(input)) {
    throw new Error("discussion_provenance_invalid");
  }
  assertDiscussionKeys(input, DISCUSSION_PROVENANCE_KEYS, "provenance");
  if (
    input.schemaVersion !== undefined &&
    input.schemaVersion !== "discussion_artifact_v1"
  ) {
    throw new Error("discussion_provenance_schema_invalid");
  }
  const id = requireDiscussionString(
    input.id ?? input.artifactId,
    "discussion_provenance_id_required",
  );
  if (
    input.id !== undefined &&
    input.artifactId !== undefined &&
    input.id !== input.artifactId
  ) {
    throw new Error("discussion_provenance_id_mismatch");
  }
  if (input.source !== "nostr" && input.source !== "synthetic_fixture") {
    throw new Error("discussion_provenance_source_invalid");
  }
  const sourceRef = requireDiscussionString(
    input.sourceRef,
    "discussion_provenance_source_ref_required",
  );
  if (input.authorityBinding !== "none") {
    throw new Error("discussion_provenance_authority_invalid");
  }
  const topLevelScope =
    input.municipalityId === undefined && input.caseId === undefined
      ? undefined
      : normalizeDiscussionScope(
          {
            municipalityId: input.municipalityId,
            caseId: input.caseId,
          },
          config,
        );
  const nestedScope = normalizeDiscussionScope(input.scope, config);
  if (
    topLevelScope &&
    (topLevelScope.municipalityId !== nestedScope.municipalityId ||
      topLevelScope.caseId !== nestedScope.caseId)
  ) {
    throw new Error("discussion_provenance_scope_mismatch");
  }
  if (!isRecord(input.event)) {
    throw new Error("discussion_provenance_event_invalid");
  }
  assertDiscussionKeys(input.event, DISCUSSION_EVENT_KEYS, "event");
  const eventId = requireDiscussionString(
    input.event.id,
    "discussion_provenance_event_invalid",
  );
  const pubkey = requireDiscussionString(
    input.event.pubkey,
    "discussion_provenance_event_invalid",
  );
  if (eventId !== id) {
    throw new Error("discussion_provenance_event_id_mismatch");
  }
  const verificationProof = normalizeDiscussionProof(input.verificationProof);
  if (
    (input.source === "nostr" && verificationProof.kind !== "nostr_nip01") ||
    (input.source === "synthetic_fixture" && verificationProof.kind !== "synthetic_fixture")
  ) {
    throw new Error("discussion_provenance_source_proof_mismatch");
  }
  return {
    schemaVersion: "discussion_artifact_v1",
    id,
    artifactId: id,
    source: input.source,
    sourceRef,
    scope: nestedScope,
    authorityBinding: "none",
    verificationProof,
    event: {
      id: eventId,
      pubkey,
    },
  };
}

function cloneDiscussionProvenance(
  provenance: DiscussionProvenance,
): DiscussionProvenance {
  return {
    ...provenance,
    scope: { ...provenance.scope! },
    verificationProof: { ...provenance.verificationProof },
    event: { ...provenance.event },
  };
}

function cloneCivicDiscussion(discussion: CivicDiscussion): CivicDiscussion {
  return {
    ...discussion,
    provenance: discussion.provenance
      ? cloneDiscussionProvenance(discussion.provenance)
      : undefined,
  };
}

const PARTICIPATION_RESULT_KEYS = new Set([
  "schemaVersion",
  "id",
  "contractId",
  "contractVersion",
  "methodKind",
  "methodVersion",
  "ruleId",
  "ruleVersion",
  "authorityBinding",
  "question",
  "options",
  "totalAccepted",
  "resultSummary",
  "unresolvedDissent",
  "representationAudit",
  "limitations",
  "openedAt",
  "closedAt",
  "reviewedAt",
  "resultArtifactRef",
  "minorityReportRef",
  "correctionState",
  "checksum",
]);
const PARTICIPATION_OPTION_KEYS = new Set(["optionId", "label", "aggregateCount"]);
const REPRESENTATION_AUDIT_KEYS = new Set([
  "targetPopulationDescription",
  "recruitmentMethod",
  "samplingMethod",
  "totalInvited",
  "totalStarted",
  "totalCompleted",
  "limitations",
]);

function assertAllowedParticipationObject(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  path: string,
  ancestors: Set<object>,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`participation_result_shape_invalid:${path}`);
  }
  if (ancestors.has(value)) {
    throw new Error(`participation_result_cycle:${path}`);
  }
  ancestors.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new Error(`participation_result_field_forbidden:${path}.[symbol]`);
    }
    if (RAW_PARTICIPATION_FIELD.test(key)) {
      throw new Error(`raw_participation_data_forbidden:${path}.${key}`);
    }
    if (!allowedKeys.has(key)) {
      throw new Error(`participation_result_field_forbidden:${path}.${key}`);
    }
  }
  ancestors.delete(value);
}

function assertStringArray(value: unknown, path: string): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`participation_result_shape_invalid:${path}`);
  }
}

function assertParticipationResultShape(input: unknown): asserts input is ParticipationResult {
  const ancestors = new Set<object>();
  assertAllowedParticipationObject(input, PARTICIPATION_RESULT_KEYS, "result", ancestors);
  if (!Array.isArray(input.options)) {
    throw new Error("participation_result_shape_invalid:result.options");
  }
  input.options.forEach((option, index) => {
    assertAllowedParticipationObject(
      option,
      PARTICIPATION_OPTION_KEYS,
      `result.options[${index}]`,
      ancestors,
    );
  });
  assertStringArray(input.unresolvedDissent, "result.unresolvedDissent");
  assertStringArray(input.limitations, "result.limitations");
  assertAllowedParticipationObject(
    input.representationAudit,
    REPRESENTATION_AUDIT_KEYS,
    "result.representationAudit",
    ancestors,
  );
  assertStringArray(
    input.representationAudit.limitations,
    "result.representationAudit.limitations",
  );
}

function assertNoRawParticipationValues(
  value: unknown,
  path = "result",
  ancestors = new Set<object>(),
): void {
  if (typeof value === "string") {
    if (RAW_PARTICIPATION_VALUE_MARKERS.some((marker) => marker.test(value))) {
      throw new Error(`raw_participation_value_forbidden:${path}`);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  if (ancestors.has(value)) {
    throw new Error(`participation_result_cycle:${path}`);
  }
  ancestors.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const childPath =
      typeof key === "string" ? `${path}.${key}` : `${path}.[symbol]`;
    assertNoRawParticipationValues(Reflect.get(value, key), childPath, ancestors);
  }
  ancestors.delete(value);
}

function cloneParticipationResult(result: ParticipationResult): ParticipationResult {
  return {
    schemaVersion: result.schemaVersion,
    id: result.id,
    contractId: result.contractId,
    contractVersion: result.contractVersion,
    methodKind: result.methodKind,
    methodVersion: result.methodVersion,
    ruleId: result.ruleId,
    ruleVersion: result.ruleVersion,
    authorityBinding: result.authorityBinding,
    question: result.question,
    options: result.options.map((option) => ({
      optionId: option.optionId,
      label: option.label,
      aggregateCount: option.aggregateCount,
    })),
    totalAccepted: result.totalAccepted,
    resultSummary: result.resultSummary,
    unresolvedDissent: [...result.unresolvedDissent],
    representationAudit: {
      targetPopulationDescription: result.representationAudit.targetPopulationDescription,
      recruitmentMethod: result.representationAudit.recruitmentMethod,
      samplingMethod: result.representationAudit.samplingMethod,
      totalInvited: result.representationAudit.totalInvited,
      totalStarted: result.representationAudit.totalStarted,
      totalCompleted: result.representationAudit.totalCompleted,
      limitations: [...result.representationAudit.limitations],
    },
    limitations: [...result.limitations],
    openedAt: result.openedAt,
    closedAt: result.closedAt,
    reviewedAt: result.reviewedAt,
    resultArtifactRef: result.resultArtifactRef,
    minorityReportRef: result.minorityReportRef,
    correctionState: result.correctionState,
    checksum: result.checksum,
  };
}

function cloneDepartmentWorkPackage(
  item: DepartmentWorkPackage,
): DepartmentWorkPackage {
  return {
    ...item,
    response: item.response
      ? {
          ...item.response,
          citations: [...item.response.citations],
        }
      : undefined,
  };
}

function normalizeParticipationResult(
  input: ParticipationResult,
): ParticipationResult {
  assertParticipationResultShape(input);
  assertNoRawParticipationValues(input);
  if (input.schemaVersion !== "participation_result_v1") {
    throw new Error("participation_result_schema_invalid");
  }
  if (input.authorityBinding !== "none") {
    throw new Error("participation_result_authority_invalid");
  }
  if (!input.id.trim() || !input.contractId.trim() || !input.resultArtifactRef.trim()) {
    throw new Error("participation_result_reference_required");
  }
  if (typeof input.checksum !== "string" || input.checksum.trim() === "") {
    throw new Error("participation_checksum_required");
  }
  if (
    !/^sha256:(?:[a-f0-9]{64}|synthetic-[A-Za-z0-9_-]+)$/.test(
      input.checksum.trim(),
    )
  ) {
    throw new Error("participation_checksum_invalid");
  }
  if (!Number.isInteger(input.totalAccepted) || input.totalAccepted < 0) {
    throw new Error("participation_result_count_invalid");
  }
  const timestampValues = [input.openedAt, input.closedAt, input.reviewedAt];
  if (
    timestampValues.some(
      (timestamp) => typeof timestamp !== "string" || timestamp.trim() === "",
    )
  ) {
    throw new Error("participation_timestamp_required");
  }
  const timestampMillis = timestampValues.map((timestamp) => Date.parse(timestamp));
  if (timestampMillis.some((timestamp) => Number.isNaN(timestamp))) {
    throw new Error("participation_timestamp_invalid");
  }
  if (
    timestampMillis[0]! > timestampMillis[1]! ||
    timestampMillis[1]! > timestampMillis[2]!
  ) {
    throw new Error("participation_timestamp_order_invalid");
  }
  const audit = input.representationAudit;
  const auditCounts = [audit.totalStarted, audit.totalCompleted];
  if (
    audit.totalInvited !== null &&
    (!Number.isInteger(audit.totalInvited) || audit.totalInvited < 0)
  ) {
    throw new Error("representation_count_invalid");
  }
  if (auditCounts.some((count) => !Number.isInteger(count) || count < 0)) {
    throw new Error("representation_count_invalid");
  }
  if (
    (audit.totalInvited !== null && audit.totalStarted > audit.totalInvited) ||
    audit.totalCompleted > audit.totalStarted ||
    input.totalAccepted > audit.totalCompleted
  ) {
    throw new Error("representation_count_inconsistent");
  }
  if (
    input.options.some(
      (option) =>
        !option.optionId.trim() ||
        !option.label.trim() ||
        !Number.isInteger(option.aggregateCount) ||
        option.aggregateCount < 0,
    )
  ) {
    throw new Error("participation_result_option_invalid");
  }
  if (new Set(input.options.map((option) => option.optionId)).size !== input.options.length) {
    throw new Error("participation_option_duplicate");
  }
  const aggregateTotal = input.options.reduce(
    (total, option) => total + option.aggregateCount,
    0,
  );
  if (aggregateTotal !== input.totalAccepted) {
    throw new Error("participation_option_count_inconsistent");
  }
  return cloneParticipationResult(input);
}

function cloneCouncilDryRunBrief(brief: CouncilDryRunBrief): CouncilDryRunBrief {
  return {
    ...brief,
    citizenSignal: brief.citizenSignal
      ? cloneParticipationResult(brief.citizenSignal)
      : null,
  };
}

function snapshotCivicKernelConfig(input: CivicKernelConfig): CivicKernelConfig {
  if (typeof input.municipalityId !== "string" || input.municipalityId.trim() === "") {
    throw new Error("municipality_id_required");
  }
  if (typeof input.caseId !== "string" || input.caseId.trim() === "") {
    throw new Error("case_id_required");
  }

  const departments = Array.from(input.departments ?? [], (department) => {
    if (typeof department !== "string" || department.trim() === "") {
      throw new Error("department_id_required");
    }
    return department.trim();
  });
  if (departments.length === 0) {
    throw new Error("departments_required");
  }
  if (new Set(departments).size !== departments.length) {
    throw new Error("departments_unique");
  }

  if (!Array.isArray(input.actors) || input.actors.length === 0) {
    throw new Error("civic_actor_registry_required");
  }
  const actors = input.actors.map((value) => normalizeCivicActor(value));
  if (new Set(actors.map((actor) => actor.id)).size !== actors.length) {
    throw new Error("civic_actor_registry_unique");
  }

  return {
    municipalityId: input.municipalityId.trim(),
    caseId: input.caseId.trim(),
    departments,
    actors,
  };
}

export function createCivicKernel(input: CivicKernelConfig) {
  const config = snapshotCivicKernelConfig(input);
  const actorRegistry = new Map(config.actors.map((actor) => [actor.id, actor] as const));
  const discussions = new Map<string, CivicDiscussion>();
  const suggestions = new Map<string, Suggestion>();
  const departmentWorkPackages: DepartmentWorkPackage[] = [];
  // Internal provenance only: never add authorship to a civic projection.
  const responseAuthors = new Map<string, string>();
  let reviewedCitizenBrief:
    | {
        summary: string;
        citations: string[];
        publishedBy: string;
      }
    | undefined;
  let participationResult: ParticipationResult | undefined;

  const buildCouncilDryRunBrief = (): CouncilDryRunBrief => {
    if (!reviewedCitizenBrief) {
      throw new Error("reviewed_citizen_brief_required");
    }
    return {
      schemaVersion: "council_dry_run_brief_v1",
      municipalityId: config.municipalityId,
      caseId: config.caseId,
      authorityBinding: "none",
      state: "dry_run_not_submitted",
      summary: reviewedCitizenBrief.summary,
      citizenSignal: participationResult
        ? cloneParticipationResult(participationResult)
        : null,
      reviewedDepartmentResponseCount: departmentWorkPackages.filter(
        (item) => item.response?.status === "reviewed",
      ).length,
      formalDecision: null,
      councilSubmissionCreated: false,
      formalVoteStarted: false,
      publicWrite: false,
    };
  };

  return {
    dispatch(command: CivicCommand): void {
      if (
        !command.actor &&
        (command.type === "record_participation_result" ||
          command.type === "record_reviewed_participation_result")
      ) {
        throw new Error("participation_reviewer_required");
      }
      const actorEnvelope = normalizeCivicActor(command.actor);
      const registeredActor = actorRegistry.get(actorEnvelope.id);
      if (!registeredActor) {
        throw new Error("civic_actor_not_registered");
      }
      if (
        registeredActor.role !== actorEnvelope.role ||
        registeredActor.departmentId !== actorEnvelope.departmentId
      ) {
        throw new Error("civic_actor_binding_mismatch");
      }
      const actor = registeredActor;
      switch (command.type) {
        case "record_discussion": {
          if (actor.role !== "citizen") {
            throw new Error("citizen_required");
          }
          if (!command.discussion.signature.trim()) {
            throw new Error("discussion_signature_required");
          }
          const provenance = command.discussion.provenance
            ? normalizeDiscussionProvenance(command.discussion.provenance, config)
            : undefined;
          const existingDiscussion = discussions.get(command.discussion.id);
          if (existingDiscussion) {
            if (
              existingDiscussion.content === command.discussion.content &&
              existingDiscussion.transport === command.discussion.transport &&
              existingDiscussion.signature === command.discussion.signature &&
              JSON.stringify(existingDiscussion.provenance) === JSON.stringify(provenance)
            ) {
              return;
            }
            throw new Error("discussion_conflict");
          }
          discussions.set(command.discussion.id, {
            ...command.discussion,
            provenance: provenance ? cloneDiscussionProvenance(provenance) : undefined,
          });
          return;
        }
        case "craft_suggestion": {
          if (actor.role !== "citizen") {
            throw new Error("citizen_required");
          }
          const existingSuggestion = suggestions.get(command.suggestion.id);
          if (existingSuggestion) {
            if (
              existingSuggestion.discussionId === command.suggestion.discussionId &&
              existingSuggestion.title === command.suggestion.title
            ) {
              return;
            }
            throw new Error("suggestion_conflict");
          }
          if (!discussions.has(command.suggestion.discussionId)) {
            throw new Error("discussion_not_found");
          }
          suggestions.set(command.suggestion.id, {
            ...command.suggestion,
            status: "draft",
          });
          return;
        }
        case "submit_suggestion_for_administration": {
          if (actor.role !== "case_steward") {
            throw new Error("case_steward_required");
          }
          const suggestion = suggestions.get(command.suggestionId);
          if (!suggestion) {
            throw new Error("suggestion_not_found");
          }
          if (suggestion.status === "submitted_for_administration_review") {
            return;
          }
          suggestion.status = "submitted_for_administration_review";
          for (const departmentId of config.departments) {
            departmentWorkPackages.push({
              id: `${suggestion.id}:${departmentId}`,
              departmentId,
              suggestionId: suggestion.id,
              status: "awaiting_review",
            });
          }
          return;
        }
        case "record_department_response": {
          if (actor.role !== "department_agent") {
            throw new Error("department_agent_required");
          }
          const workPackage = departmentWorkPackages.find(
            (item) => item.id === command.workPackageId,
          );
          if (!workPackage) {
            throw new Error("department_work_package_not_found");
          }
          if (actor.departmentId !== workPackage.departmentId) {
            throw new Error("department_actor_scope_mismatch");
          }
          if (command.response.citations.length === 0) {
            throw new Error("department_response_citation_required");
          }
          if (reviewedCitizenBrief) {
            // A new response changes the reviewed input set.  Fail closed
            // until the replacement is independently reviewed and published.
            reviewedCitizenBrief = undefined;
          }
          workPackage.response = {
            summary: command.response.summary,
            citations: [...command.response.citations],
            status: "pending_review",
          };
          responseAuthors.set(workPackage.id, actor.id);
          return;
        }
        case "review_department_response": {
          if (actor.role !== "department_reviewer") {
            throw new Error("department_reviewer_required");
          }
          const workPackage = departmentWorkPackages.find(
            (item) => item.id === command.workPackageId,
          );
          if (!workPackage) {
            throw new Error("department_work_package_not_found");
          }
          if (actor.departmentId !== workPackage.departmentId) {
            throw new Error("department_reviewer_scope_mismatch");
          }
          if (!workPackage.response) {
            throw new Error("department_response_not_found");
          }
          const responseAuthor = responseAuthors.get(workPackage.id);
          if (!responseAuthor) {
            throw new Error("department_response_author_required");
          }
          if (responseAuthor === actor.id) {
            throw new Error("department_reviewer_independence");
          }
          workPackage.response.status = "reviewed";
          return;
        }
        case "publish_reviewed_citizen_brief": {
          if (actor.role !== "publisher") {
            throw new Error("publisher_required");
          }
          if (
            departmentWorkPackages.length !== config.departments.length ||
            departmentWorkPackages.some(
              (item) => item.response?.status !== "reviewed",
            )
          ) {
            throw new Error("all_department_responses_must_be_reviewed");
          }
          reviewedCitizenBrief = {
            summary: command.summary,
            citations: departmentWorkPackages.flatMap(
              (item) => item.response?.citations ?? [],
            ),
            publishedBy: actor.id,
          };
          return;
        }
        case "record_participation_result":
        case "record_reviewed_participation_result": {
          if (actor.role !== "participation_reviewer") {
            throw new Error("participation_reviewer_required");
          }
          const normalized = normalizeParticipationResult(command.result);
          if (participationResult) {
            // The bootstrap kernel has no append-only correction ledger yet:
            // only an identical replay is idempotent; every replacement,
            // including a correction-state change, fails closed.
            if (
              participationResult.id === normalized.id &&
              JSON.stringify(participationResult) === JSON.stringify(normalized)
            ) {
              return;
            }
            throw new Error("participation_result_conflict");
          }
          participationResult = normalized;
          return;
        }
      }
    },

    prepareCouncilDryRunBrief(): CouncilDryRunBrief {
      return cloneCouncilDryRunBrief(buildCouncilDryRunBrief());
    },

    project(viewer: { role: "administration" | "council" | "public" }): CivicProjection {
      if (
        !viewer ||
        !["administration", "council", "public"].includes(viewer.role)
      ) {
        throw new Error("viewer_role_invalid");
      }
      const reviewedBriefForViewer = reviewedCitizenBrief
        ? {
            summary: reviewedCitizenBrief.summary,
            citations: [...reviewedCitizenBrief.citations],
            ...(viewer.role === "administration"
              ? { publishedBy: reviewedCitizenBrief.publishedBy }
              : {}),
          }
        : undefined;
      const shared = {
        municipalityId: config.municipalityId,
        caseId: config.caseId,
        authorityBinding: "none" as const,
        formalDecision: null,
        discussions: Array.from(discussions.values(), cloneCivicDiscussion),
        suggestions: Array.from(suggestions.values(), (item) => ({ ...item })),
        reviewedCitizenBrief: reviewedBriefForViewer,
        participationResult:
          participationResult &&
          !(viewer.role === "public" && participationResult.correctionState === "retracted")
            ? cloneParticipationResult(participationResult)
            : undefined,
        councilDryRunBrief:
          viewer.role === "council" && reviewedCitizenBrief
            ? cloneCouncilDryRunBrief(buildCouncilDryRunBrief())
            : undefined,
      };

      if (viewer.role === "administration") {
        return {
          ...shared,
          departmentWorkPackages: departmentWorkPackages.map(
            cloneDepartmentWorkPackage,
          ),
        };
      }

      return shared;
    },
  };
}
