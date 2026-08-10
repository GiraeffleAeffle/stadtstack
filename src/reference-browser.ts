import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type {
  ActorBinding,
  CivicCaseCoordinator,
  ProjectionEnvelope,
} from "./civic-case-coordinator.ts";
import {
  createCoordinatorCompanionRuntime,
  type CompanionProfile,
  type CoordinatorCompanionActor,
} from "./companion-runtime.ts";
import {
  createCompanionIdentityPolicy,
  createDeterministicLocalCompanionAdapter,
  type WorkerResultV1,
} from "./adapters/companion-harness.ts";

export type ReferenceRoute = "public" | "administration" | "council";
export type CoordinatorProjectionReader = Pick<CivicCaseCoordinator, "project">;

export type ReferenceBrowserConfig = {
  coordinator: CoordinatorProjectionReader;
  caseId: string;
  policyVersion: string;
  actors: Readonly<Record<ReferenceRoute, ActorBinding>>;
  identities: Readonly<Record<ReferenceRoute, string>>;
  sessions: Readonly<Record<ReferenceRoute, string>>;
};

export type ReferenceDepartmentView = {
  departmentId: string;
  packageChecksum: string;
  artifactChecksum: string;
  reviewedAt: string;
  publicSummary: string;
  publicCitations: readonly string[];
};

export type ReferenceSourceBinding = {
  packageId: string;
  packageChecksum: string;
  draftArtifactChecksum: string;
  reviewAttestationChecksum: string;
  departmentId: string;
  reviewedAt: string;
};

export type ReferenceAdministrationPackage = {
  id: string;
  departmentId: string;
  suggestionId: string;
  request: string;
  packageChecksum: string;
  assignedAgentActorId: string;
  assignedReviewerActorId: string;
  draft: {
    id: string;
    publicSummary: string;
    publicCitations: readonly string[];
    privateEvidenceRefs: readonly string[];
    artifactChecksum: string;
    actorId: string;
  };
  review: {
    decision: "accepted" | "rejected";
    draftArtifactChecksum: string;
    reviewedAt: string;
    policyVersion: string;
    attestationChecksum: string;
    reviewerActorId: string;
  };
  reviewState: string;
  correctionState: string;
};

export type ReferenceMeckyView = {
  profile: ReferenceRoute;
  workerIdentityId: string;
  sessionKey: string;
  contextChecksum: string;
  answer: string;
  citations: readonly { ref: string; label?: string; excerpt?: string }[];
  artifactBindings: readonly { ref: string; checksum: string }[];
  aiAttribution: {
    schemaVersion: "ai_attribution_v1";
    kind: "agent_contribution";
    workerIdentityId: string;
    profile: ReferenceRoute;
    adapterKind: "deterministic-local";
    authorityBinding: "none";
  };
  limits: { maxOutputTokens: number; timeoutMs: number; maxCostUsd: number };
  tools: { mode: "default-deny"; allow: readonly []; deny: readonly ["*"] };
  prohibitedEffects: readonly string[];
};

export type ReferenceViewV1 = {
  schemaVersion: "reference_view_v1";
  route: ReferenceRoute;
  status: "available" | "unavailable";
  caseId: string;
  municipalityId: string;
  visibility: ReferenceRoute;
  policyVersion: string;
  caseVersion: number;
  journalHeadChecksum: string;
  projectionChecksum: string;
  authorityBinding: "none";
  flow: {
    discussion: { id: string; sourceRef: string; verified: true; content: string };
    suggestion: { id: string; title: string; status: "draft" | "admitted" };
    reviewedDepartments: readonly ReferenceDepartmentView[];
    reviewedCitizenBrief: {
      id: string;
      briefChecksum: string;
      sourceDiscussionRef: string;
      sourceBindings: readonly ReferenceSourceBinding[];
    } | null;
    participation: { checksum: string; totalAccepted: number; advisory: true } | null;
    council: { state: "dry_run_not_submitted"; reviewedDepartmentResponseCount: number } | null;
    /** Present only for the administration route; never sent to public/council. */
    administrationPackages?: readonly ReferenceAdministrationPackage[];
  };
  mecky: ReferenceMeckyView | null;
  unavailableCode?: "projection_unavailable_v1" | "mecky_unavailable_v1";
};

export type ReferenceBrowserServer = {
  readonly server: Server;
  listen(port?: number): Promise<{ port: number; host: string }>;
  close(): Promise<void>;
  render(pathname: string): Promise<ReferenceViewV1>;
};

export type BrowserAcceptanceEvidence = {
  schemaVersion: "stadtstack.browser_acceptance_evidence.v1";
  status: "completed" | "failed_closed";
  mode: "offline_synthetic_only";
  source: "CivicCaseCoordinator.project";
  caseId: string;
  policyVersion: string;
  flow: {
    discussionId: string;
    suggestionId: string;
    reviewedDepartmentCount: 8;
    briefChecksum: string;
    participationChecksum: string;
    councilState: "dry_run_not_submitted";
  };
  routes: readonly {
    route: `/${ReferenceRoute}`;
    status: 200;
    visibility: ReferenceRoute;
    caseVersion: number;
    journalHeadChecksum: string;
    projectionChecksum: string;
    contentChecksum: string;
    consoleErrors: 0;
    externalRequests: 0;
    destinations: readonly [`loopback:/${ReferenceRoute}`];
    accessibility: {
      keyboard: true;
      headings: true;
      landmarks: true;
      labels: true;
      focus: true;
      contrast: true;
      readable: true;
    };
  }[];
  rolePrivacy: {
    publicPrivateEvidenceVisible: false;
    publicReviewerMetadataVisible: false;
    councilPrivateEvidenceVisible: false;
    administrationPrivateEvidenceVisible: true;
  };
  continuity: {
    sameCaseId: true;
    samePolicyVersion: true;
    sameJournalHead: true;
    sourceBoundBrief: true;
    sourceBoundParticipation: true;
  };
  authority: {
    authorityBinding: "none";
    publicWrite: false;
    publication: false;
    formalVote: false;
    councilSubmissionCreated: false;
    formalVoteStarted: false;
    externalNetworkCalled: false;
    paidProviderCalled: false;
    hiddenState: false;
  };
  provenance: {
    localProofOnly: true;
    deploymentReady: false;
    civicReadiness: false;
    browserTool: "playwright" | "contract-harness";
  };
};

const PROFILES: readonly ReferenceRoute[] = ["public", "administration", "council"];
const QUESTION_BY_PROFILE: Readonly<Record<ReferenceRoute, string>> = {
  public: "What has been reviewed for this case?",
  administration: "What still needs administration attention?",
  council: "What is ready for a council dry run?",
};
const EXPECTED_CONFIG_KEYS = ["actors", "caseId", "coordinator", "identities", "policyVersion", "sessions"];
const PRIVATE_KEY = /(?:privateEvidenceRefs|assignedAgentActorId|assignedReviewerActorId|reviewerActorId|reviewAttestationChecksum|departmentWorkPackages|employee|credential|password|secret|nsec1|raw[_ -]?(?:ballot|citizen|participant)|prompt|reasoning|chain[_ -]?of[_ -]?thought|unreviewed|internal)/i;
const RAW_MARKER = /(?:nsec1[a-z0-9-]{8,}|0x[a-f0-9]{40}|private\s+(?:key|evidence|draft|payload)|secret\s+(?:key|material)|credential|chain[_ -]?of[_ -]?thought|prompt|reasoning|departmentWorkPackages)/i;
const ADMIN_PRIVATE_KEYS = new Set(["privateEvidenceRefs", "assignedAgentActorId", "assignedReviewerActorId", "reviewerActorId", "reviewAttestationChecksum"]);

class ReferenceBrowserError extends Error {
  readonly code: "projection_unavailable_v1" | "mecky_unavailable_v1";
  constructor(code: "projection_unavailable_v1" | "mecky_unavailable_v1") {
    super(code);
    this.name = "ReferenceBrowserError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function canonicalReferenceJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Reference(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalReferenceJson(value), "utf8").digest("hex")}`;
}

function requireString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new ReferenceBrowserError(code as "projection_unavailable_v1");
  return value.trim();
}

function failProjection(): never {
  throw new ReferenceBrowserError("projection_unavailable_v1");
}

function failMecky(): never {
  throw new ReferenceBrowserError("mecky_unavailable_v1");
}

function assertNoForbidden(value: unknown, path: string, allowReviewedAttestation = false, allowAdministrationPrivate = false): void {
  if (typeof value === "string") {
    if (RAW_MARKER.test(value)) throw new ReferenceBrowserError("projection_unavailable_v1");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbidden(item, `${path}[${index}]`, allowReviewedAttestation, allowAdministrationPrivate));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (allowReviewedAttestation && key === "reviewAttestationChecksum") {
      if (typeof child !== "string") throw new ReferenceBrowserError("projection_unavailable_v1");
    } else if (PRIVATE_KEY.test(key) && !(allowAdministrationPrivate && ADMIN_PRIVATE_KEYS.has(key))) {
      throw new ReferenceBrowserError("projection_unavailable_v1");
    }
    assertNoForbidden(child, `${path}.${key}`, allowReviewedAttestation, allowAdministrationPrivate);
  }
}

function assertChecksum(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) failProjection();
  return value;
}

function assertClosedKeys(value: unknown, expected: readonly string[], path: string): void {
  if (!isRecord(value)) throw new Error(`reference_view_shape_invalid:${path}`);
  const allowed = new Set(expected);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`reference_view_field_forbidden:${path}.${key}`);
  }
}

function assertClosedReferenceView(value: unknown): asserts value is ReferenceViewV1 {
  assertClosedKeys(value, ["schemaVersion", "route", "status", "caseId", "municipalityId", "visibility", "policyVersion", "caseVersion", "journalHeadChecksum", "projectionChecksum", "authorityBinding", "flow", "mecky", "unavailableCode"], "view");
  if (!isRecord(value) || !isRecord(value.flow)) throw new Error("reference_view_shape_invalid:flow");
  assertClosedKeys(value.flow, ["discussion", "suggestion", "reviewedDepartments", "reviewedCitizenBrief", "participation", "council", "administrationPackages"], "view.flow");
  if (!isRecord(value.flow.discussion)) throw new Error("reference_view_shape_invalid:discussion");
  assertClosedKeys(value.flow.discussion, ["id", "sourceRef", "verified", "content"], "view.flow.discussion");
  if (!isRecord(value.flow.suggestion)) throw new Error("reference_view_shape_invalid:suggestion");
  assertClosedKeys(value.flow.suggestion, ["id", "title", "status"], "view.flow.suggestion");
  if (!Array.isArray(value.flow.reviewedDepartments)) throw new Error("reference_view_shape_invalid:reviewedDepartments");
  value.flow.reviewedDepartments.forEach((department, index) => assertClosedKeys(department, ["departmentId", "packageChecksum", "artifactChecksum", "reviewedAt", "publicSummary", "publicCitations"], `view.flow.reviewedDepartments[${index}]`));
  if (value.flow.reviewedCitizenBrief !== null) {
    if (!isRecord(value.flow.reviewedCitizenBrief)) throw new Error("reference_view_shape_invalid:reviewedCitizenBrief");
    assertClosedKeys(value.flow.reviewedCitizenBrief, ["id", "briefChecksum", "sourceDiscussionRef", "sourceBindings"], "view.flow.reviewedCitizenBrief");
    if (!Array.isArray(value.flow.reviewedCitizenBrief.sourceBindings)) throw new Error("reference_view_shape_invalid:sourceBindings");
    value.flow.reviewedCitizenBrief.sourceBindings.forEach((binding, index) => assertClosedKeys(binding, ["packageId", "packageChecksum", "draftArtifactChecksum", "reviewAttestationChecksum", "departmentId", "reviewedAt"], `view.flow.reviewedCitizenBrief.sourceBindings[${index}]`));
  }
  if (value.flow.participation !== null) assertClosedKeys(value.flow.participation, ["checksum", "totalAccepted", "advisory"], "view.flow.participation");
  if (value.flow.council !== null) assertClosedKeys(value.flow.council, ["state", "reviewedDepartmentResponseCount"], "view.flow.council");
  if (value.flow.administrationPackages !== undefined) {
    if (!Array.isArray(value.flow.administrationPackages)) throw new Error("reference_view_shape_invalid:administrationPackages");
    value.flow.administrationPackages.forEach((pkg, index) => {
      assertClosedKeys(pkg, ["id", "departmentId", "suggestionId", "request", "packageChecksum", "assignedAgentActorId", "assignedReviewerActorId", "draft", "review", "reviewState", "correctionState"], `view.flow.administrationPackages[${index}]`);
      if (!isRecord(pkg.draft) || !isRecord(pkg.review)) throw new Error(`reference_view_shape_invalid:administrationPackages[${index}]`);
      assertClosedKeys(pkg.draft, ["id", "publicSummary", "publicCitations", "privateEvidenceRefs", "artifactChecksum", "actorId"], `view.flow.administrationPackages[${index}].draft`);
      assertClosedKeys(pkg.review, ["decision", "draftArtifactChecksum", "reviewedAt", "policyVersion", "attestationChecksum", "reviewerActorId"], `view.flow.administrationPackages[${index}].review`);
    });
  }
  if (value.mecky !== null) {
    if (!isRecord(value.mecky)) throw new Error("reference_view_shape_invalid:mecky");
    assertClosedKeys(value.mecky, ["profile", "workerIdentityId", "sessionKey", "contextChecksum", "answer", "citations", "artifactBindings", "aiAttribution", "limits", "tools", "prohibitedEffects"], "view.mecky");
    if (!isRecord(value.mecky.aiAttribution) || !isRecord(value.mecky.limits) || !isRecord(value.mecky.tools)) throw new Error("reference_view_shape_invalid:mecky_nested");
    assertClosedKeys(value.mecky.aiAttribution, ["schemaVersion", "kind", "workerIdentityId", "profile", "adapterKind", "authorityBinding"], "view.mecky.aiAttribution");
    assertClosedKeys(value.mecky.limits, ["maxOutputTokens", "timeoutMs", "maxCostUsd"], "view.mecky.limits");
    assertClosedKeys(value.mecky.tools, ["mode", "allow", "deny"], "view.mecky.tools");
    if (!Array.isArray(value.mecky.citations) || !Array.isArray(value.mecky.artifactBindings) || !Array.isArray(value.mecky.prohibitedEffects)) throw new Error("reference_view_shape_invalid:mecky_arrays");
    value.mecky.citations.forEach((citation, index) => assertClosedKeys(citation, ["ref", "label", "excerpt"], `view.mecky.citations[${index}]`));
    value.mecky.artifactBindings.forEach((binding, index) => assertClosedKeys(binding, ["ref", "checksum"], `view.mecky.artifactBindings[${index}]`));
  }
}

function mapDepartments(projection: Record<string, unknown>, route: ReferenceRoute): {
  safe: ReferenceDepartmentView[];
  administration: ReferenceAdministrationPackage[];
} {
  const raw = projection.departmentPackages;
  if (!Array.isArray(raw) || raw.length !== 8) failProjection();
  const safe: ReferenceDepartmentView[] = [];
  const administration: ReferenceAdministrationPackage[] = [];
  const departments = new Set<string>();
  const packageIds = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item)) failProjection();
    const departmentId = requireString(item.departmentId, "projection_unavailable_v1");
    const id = requireString(item.id, "projection_unavailable_v1");
    if (departments.has(departmentId) || packageIds.has(id)) failProjection();
    departments.add(departmentId);
    packageIds.add(id);
    if (item.reviewState !== "accepted" || item.correctionState !== "current") failProjection();
    const packageChecksum = assertChecksum(item.packageChecksum);
    const draft = item.draft;
    const review = item.review;
    const artifactChecksum = route === "administration"
      ? isRecord(review) ? assertChecksum(review.draftArtifactChecksum) : failProjection()
      : assertChecksum(item.artifactChecksum);
    const reviewedAt = route === "administration"
      ? isRecord(review) ? requireString(review.reviewedAt, "projection_unavailable_v1") : failProjection()
      : requireString(item.reviewedAt, "projection_unavailable_v1");
    const publicSummary = route === "administration"
      ? isRecord(draft) ? requireString(draft.publicSummary, "projection_unavailable_v1") : failProjection()
      : requireString(item.publicSummary, "projection_unavailable_v1");
    const citations = route === "administration" ? (isRecord(draft) ? draft.publicCitations : failProjection()) : item.publicCitations;
    if (!Array.isArray(citations) || citations.length === 0 || citations.some((ref) => typeof ref !== "string" || !/^synthetic:\/\//.test(ref))) failProjection();
    safe.push({ departmentId, packageChecksum, artifactChecksum, reviewedAt, publicSummary, publicCitations: clone(citations) as string[] });

    if (isRecord(draft) && isRecord(review)) {
      const admin: ReferenceAdministrationPackage = {
        id,
        departmentId,
        suggestionId: requireString(item.suggestionId, "projection_unavailable_v1"),
        request: requireString(item.request, "projection_unavailable_v1"),
        packageChecksum,
        assignedAgentActorId: requireString(item.assignedAgentActorId, "projection_unavailable_v1"),
        assignedReviewerActorId: requireString(item.assignedReviewerActorId, "projection_unavailable_v1"),
        draft: {
          id: requireString(draft.id, "projection_unavailable_v1"),
          publicSummary: requireString(draft.publicSummary, "projection_unavailable_v1"),
          publicCitations: clone(draft.publicCitations) as string[],
          privateEvidenceRefs: clone(draft.privateEvidenceRefs) as string[],
          artifactChecksum: assertChecksum(draft.artifactChecksum),
          actorId: requireString(draft.actorId, "projection_unavailable_v1"),
        },
        review: {
          decision: review.decision === "accepted" || review.decision === "rejected" ? review.decision : failProjection(),
          draftArtifactChecksum: assertChecksum(review.draftArtifactChecksum),
          reviewedAt: requireString(review.reviewedAt, "projection_unavailable_v1"),
          policyVersion: requireString(review.policyVersion, "projection_unavailable_v1"),
          attestationChecksum: assertChecksum(review.attestationChecksum),
          reviewerActorId: requireString(review.reviewerActorId, "projection_unavailable_v1"),
        },
        reviewState: requireString(item.reviewState, "projection_unavailable_v1"),
        correctionState: requireString(item.correctionState, "projection_unavailable_v1"),
      };
      if (!Array.isArray(draft.publicCitations) || !Array.isArray(draft.privateEvidenceRefs)) failProjection();
      if (admin.review.draftArtifactChecksum !== admin.draft.artifactChecksum || admin.draft.artifactChecksum !== artifactChecksum) failProjection();
      administration.push(admin);
    }
  }
  safe.sort((left, right) => left.departmentId.localeCompare(right.departmentId));
  administration.sort((left, right) => left.departmentId.localeCompare(right.departmentId));
  return { safe, administration };
}

function mapBrief(projection: Record<string, unknown>): ReferenceViewV1["flow"]["reviewedCitizenBrief"] {
  const raw = projection.reviewedCitizenBrief;
  if (!isRecord(raw) || raw.correctionState !== "current") failProjection();
  const provenance = raw.provenance;
  if (!isRecord(provenance) || !isRecord(provenance.sourceDiscussionRef) || !Array.isArray(provenance.packageBindings) || provenance.packageBindings.length !== 8) failProjection();
  const sourceDiscussionRef = requireString(provenance.sourceDiscussionRef.ref, "projection_unavailable_v1");
  const responses = raw.responses;
  if (!Array.isArray(responses) || responses.length !== 8) failProjection();
  const responseDepartments = new Set<string>();
  for (const response of responses) {
    if (!isRecord(response)) failProjection();
    const departmentId = requireString(response.departmentId, "projection_unavailable_v1");
    if (responseDepartments.has(departmentId) || typeof response.publicSummary !== "string" || !Array.isArray(response.publicCitations)) failProjection();
    responseDepartments.add(departmentId);
  }
  const currentPackages = Array.isArray(projection.departmentPackages) ? projection.departmentPackages : [];
  const packageById = new Map<string, Record<string, unknown>>();
  for (const packageValue of currentPackages) {
    if (isRecord(packageValue) && typeof packageValue.id === "string") packageById.set(packageValue.id, packageValue);
  }
  const bindings: ReferenceSourceBinding[] = [];
  const packageIds = new Set<string>();
  const departments = new Set<string>();
  for (const item of provenance.packageBindings) {
    if (!isRecord(item)) failProjection();
    const packageId = requireString(item.packageId, "projection_unavailable_v1");
    const departmentId = requireString(item.departmentId, "projection_unavailable_v1");
    if (packageIds.has(packageId) || departments.has(departmentId)) failProjection();
    packageIds.add(packageId);
    departments.add(departmentId);
    const currentPackage = packageById.get(packageId);
    if (!currentPackage || currentPackage.departmentId !== departmentId || currentPackage.correctionState !== "current" || currentPackage.reviewState !== "accepted") failProjection();
    const currentArtifact = isRecord(currentPackage.draft) ? currentPackage.draft.artifactChecksum : currentPackage.artifactChecksum;
    const currentReviewedAt = currentPackage.reviewedAt ?? (isRecord(currentPackage.review) ? currentPackage.review.reviewedAt : undefined);
    if (currentPackage.packageChecksum !== item.packageChecksum || currentArtifact !== item.draftArtifactChecksum || currentReviewedAt !== item.reviewedAt) failProjection();
    bindings.push({
      packageId,
      packageChecksum: assertChecksum(item.packageChecksum),
      draftArtifactChecksum: assertChecksum(item.draftArtifactChecksum),
      reviewAttestationChecksum: assertChecksum(item.reviewAttestationChecksum),
      departmentId,
      reviewedAt: requireString(item.reviewedAt, "projection_unavailable_v1"),
    });
  }
  bindings.sort((left, right) => left.departmentId.localeCompare(right.departmentId));
  return {
    id: requireString(raw.id, "projection_unavailable_v1"),
    briefChecksum: assertChecksum(raw.briefChecksum),
    sourceDiscussionRef,
    sourceBindings: bindings,
  };
}

function mapParticipation(projection: Record<string, unknown>): ReferenceViewV1["flow"]["participation"] {
  const raw = projection.participationResult;
  if (!isRecord(raw) || raw.correctionState !== "current" || raw.advisory !== true) failProjection();
  return {
    checksum: assertChecksum(raw.checksum),
    totalAccepted: typeof raw.totalAccepted === "number" && Number.isInteger(raw.totalAccepted) && raw.totalAccepted >= 0 ? raw.totalAccepted : failProjection(),
    advisory: true,
  };
}

function mapCouncil(projection: Record<string, unknown>): ReferenceViewV1["flow"]["council"] {
  const raw = projection.councilDryRunBrief;
  if (!isRecord(raw) || raw.state !== "dry_run_not_submitted" || raw.authorityBinding !== "none" || raw.formalDecision !== null || raw.councilSubmissionCreated !== false || raw.formalVoteStarted !== false || raw.publicWrite !== false) failProjection();
  if (typeof raw.reviewedDepartmentResponseCount !== "number" || raw.reviewedDepartmentResponseCount !== 8) failProjection();
  return { state: "dry_run_not_submitted", reviewedDepartmentResponseCount: 8 };
}

function mapMecky(result: WorkerResultV1, route: ReferenceRoute, config: ReferenceBrowserConfig): ReferenceMeckyView {
  if (result.profile !== route || result.identity.profile !== route || result.identity.id !== config.identities[route] || result.sessionKey !== config.sessions[route] || result.aiAttribution.adapterKind !== "deterministic-local" || result.aiAttribution.authorityBinding !== "none") failMecky();
  if (result.aiAttribution.workerIdentityId !== result.identity.id || result.aiAttribution.profile !== route) failMecky();
  if (result.allowedTools.length !== 0 || result.tools.mode !== "default-deny" || result.tools.allow.length !== 0 || result.tools.deny.length !== 1 || result.tools.deny[0] !== "*") failMecky();
  if (result.prohibitedEffects.length === 0 || result.prohibitedEffects.some((effect) => typeof effect !== "string")) failMecky();
  if (RAW_MARKER.test(result.answer) || result.citations.some((citation) => RAW_MARKER.test(`${citation.ref} ${citation.label ?? ""} ${citation.excerpt ?? ""}`))) failMecky();
  return {
    profile: route,
    workerIdentityId: result.identity.id,
    sessionKey: result.sessionKey,
    contextChecksum: result.contextChecksum,
    answer: result.answer,
    citations: clone(result.citations),
    artifactBindings: clone(result.artifactBindings),
    aiAttribution: {
      schemaVersion: "ai_attribution_v1",
      kind: "agent_contribution",
      workerIdentityId: result.aiAttribution.workerIdentityId,
      profile: route,
      adapterKind: "deterministic-local",
      authorityBinding: "none",
    },
    limits: clone(result.limits),
    tools: clone(result.tools),
    prohibitedEffects: clone(result.prohibitedEffects),
  };
}

function buildReferenceViewFromTask(
  route: ReferenceRoute,
  envelope: ProjectionEnvelope,
  result: WorkerResultV1,
  config: ReferenceBrowserConfig,
): ReferenceViewV1 {
  const projection = envelope.projection as unknown as Record<string, unknown>;
  if (projection.caseId !== config.caseId || projection.authorityBinding !== "none") failProjection();
  const discussion = projection.discussion;
  const suggestion = projection.suggestion;
  if (!isRecord(discussion) || !isRecord(suggestion)) failProjection();
  const verificationProof = discussion.verificationProof;
  if (!isRecord(verificationProof) || verificationProof.verified !== true) failProjection();
  const departments = mapDepartments(projection, route);
  const brief = mapBrief(projection);
  const participation = mapParticipation(projection);
  const council = route === "council" ? mapCouncil(projection) : null;
  const mecky = mapMecky(result, route, config);
  const view: ReferenceViewV1 = {
    schemaVersion: "reference_view_v1",
    route,
    status: "available",
    caseId: config.caseId,
    municipalityId: requireString(projection.municipalityId, "projection_unavailable_v1"),
    visibility: route,
    policyVersion: config.policyVersion,
    caseVersion: envelope.caseVersion,
    journalHeadChecksum: requireString(envelope.journalHeadChecksum, "projection_unavailable_v1"),
    projectionChecksum: envelope.projectionChecksum,
    authorityBinding: "none",
    flow: {
      discussion: {
        id: requireString(discussion.id, "projection_unavailable_v1"),
        sourceRef: requireString(discussion.sourceRef, "projection_unavailable_v1"),
        verified: true,
        content: requireString(discussion.content, "projection_unavailable_v1"),
      },
      suggestion: {
        id: requireString(suggestion.id, "projection_unavailable_v1"),
        title: requireString(suggestion.title, "projection_unavailable_v1"),
        status: suggestion.status === "draft" || suggestion.status === "admitted" ? suggestion.status : failProjection(),
      },
      reviewedDepartments: departments.safe,
      reviewedCitizenBrief: brief,
      participation,
      council,
      ...(route === "administration" ? { administrationPackages: departments.administration } : {}),
    },
    mecky,
  };
  assertNoForbidden(view, "view", true, route === "administration");
  return clone(view);
}

function assertReferenceConfig(config: ReferenceBrowserConfig): void {
  if (!config || typeof config !== "object") throw new Error("reference_config_required");
  const keys = Object.keys(config).sort();
  const expected = [...EXPECTED_CONFIG_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new Error("reference_config_unknown_field");
  if (!config.coordinator || typeof config.coordinator.project !== "function") throw new Error("reference_coordinator_required");
  const coordinatorKeys = Object.keys(config.coordinator).sort();
  if (coordinatorKeys.length !== 1 || coordinatorKeys[0] !== "project") throw new Error("reference_coordinator_handle_forbidden");
  if (typeof config.caseId !== "string" || config.caseId.trim() === "" || typeof config.policyVersion !== "string" || config.policyVersion.trim() === "") throw new Error("reference_config_identity_required");
}

function routeFromPath(pathname: string): ReferenceRoute {
  if (pathname === "/public") return "public";
  if (pathname === "/administration") return "administration";
  if (pathname === "/council") return "council";
  throw new Error("reference_route_not_found");
}

function genericPage(title: string, code: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>${escapeHtml(title)}</title><style>${CSS}</style></head><body><header><nav aria-label="Primary"><a href="/public">Public</a><a href="/administration">Administration</a><a href="/council">Council</a></nav></header><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(code)}</p></main><footer>Offline synthetic reference surface</footer></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

const CSS = "body{background:#fff;color:#17202a;font:16px/1.5 system-ui,sans-serif;margin:0}header,main,footer{max-width:72rem;margin:auto;padding:1rem}nav{display:flex;gap:1rem;flex-wrap:wrap}a{color:#005a9c;text-decoration:underline;padding:.25rem}a:focus-visible{outline:3px solid #005fcc;outline-offset:2px}h1{font-size:2rem}h2{font-size:1.35rem}dl{display:grid;grid-template-columns:minmax(10rem,20rem) 1fr;gap:.35rem 1rem}dt{font-weight:700}dd{margin:0;min-width:0;overflow-wrap:anywhere}.private{border-left:.3rem solid #a33;padding-left:.8rem}ul{padding-left:1.3rem}@media(max-width:640px){header,main,footer{padding:.8rem}nav{gap:.5rem}dl{grid-template-columns:1fr;gap:.2rem .5rem}dt{margin-top:.5rem}dd{min-width:0;overflow-wrap:anywhere}}";

function list(values: readonly string[]): string {
  return `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`;
}

export function renderReferenceView(view: ReferenceViewV1): string {
  assertClosedReferenceView(view);
  if (view.schemaVersion !== "reference_view_v1" || view.status !== "available") throw new Error("reference_view_invalid");
  if (!PROFILES.includes(view.route) || view.visibility !== view.route || view.authorityBinding !== "none") throw new Error("reference_view_invalid");
  if (view.route !== "administration" && view.flow.administrationPackages !== undefined) throw new Error("reference_view_private_field_forbidden");
  assertNoForbidden(view, "view", true, view.route === "administration");
  const departments = view.flow.reviewedDepartments.map((department) => `<li><strong>${escapeHtml(department.departmentId)}</strong>: ${escapeHtml(department.publicSummary)} (${escapeHtml(department.artifactChecksum)})${list(department.publicCitations)}</li>`).join("");
  const brief = view.flow.reviewedCitizenBrief;
  const participation = view.flow.participation;
  const council = view.flow.council;
  const adminPackages = view.flow.administrationPackages ?? [];
  const adminMarkup = view.route === "administration" ? `<section class="private"><h2>Administration package details</h2>${adminPackages.map((pkg) => `<article><h3>${escapeHtml(pkg.departmentId)}</h3><dl><dt>Assigned agent</dt><dd>${escapeHtml(pkg.assignedAgentActorId)}</dd><dt>Assigned reviewer</dt><dd>${escapeHtml(pkg.assignedReviewerActorId)}</dd><dt>Private evidence</dt><dd>${list(pkg.draft.privateEvidenceRefs)}</dd><dt>Review attestation</dt><dd>${escapeHtml(pkg.review.attestationChecksum)}</dd></dl></article>`).join("")}</section>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>${escapeHtml(view.route)} reference surface</title><style>${CSS}</style></head><body><header><nav aria-label="Primary"><a href="/public">Public</a><a href="/administration">Administration</a><a href="/council">Council</a></nav></header><main><h1>${escapeHtml(view.route)} reference surface</h1><section><h2>Case metadata</h2><dl><dt>Case</dt><dd>${escapeHtml(view.caseId)}</dd><dt>Municipality</dt><dd>${escapeHtml(view.municipalityId)}</dd><dt>Visibility</dt><dd>${escapeHtml(view.visibility)}</dd><dt>Case version</dt><dd>${view.caseVersion}</dd><dt>Journal head checksum</dt><dd>${escapeHtml(view.journalHeadChecksum)}</dd><dt>Projection checksum</dt><dd>${escapeHtml(view.projectionChecksum)}</dd><dt>Policy</dt><dd>${escapeHtml(view.policyVersion)}</dd><dt>Authority binding</dt><dd>none</dd></dl></section><section><h2>Discussion and suggestion</h2><dl><dt>Discussion</dt><dd>${escapeHtml(view.flow.discussion.content)}</dd><dt>Discussion source</dt><dd>${escapeHtml(view.flow.discussion.sourceRef)}</dd><dt>Signature verified</dt><dd>yes</dd><dt>Suggestion</dt><dd>${escapeHtml(view.flow.suggestion.title)} (${escapeHtml(view.flow.suggestion.status)})</dd></dl></section><section><h2>Reviewed departments</h2><ol>${departments}</ol></section><section><h2>Reviewed citizen brief</h2><dl><dt>Brief</dt><dd>${escapeHtml(brief?.id ?? "unavailable")}</dd><dt>Brief checksum</dt><dd>${escapeHtml(brief?.briefChecksum ?? "unavailable")}</dd><dt>Source discussion</dt><dd>${escapeHtml(brief?.sourceDiscussionRef ?? "unavailable")}</dd><dt>Source binding count</dt><dd>${brief?.sourceBindings.length ?? 0}</dd></dl></section><section><h2>Advisory participation</h2><dl><dt>Participation checksum</dt><dd>${escapeHtml(participation?.checksum ?? "unavailable")}</dd><dt>Total accepted</dt><dd>${participation?.totalAccepted ?? 0}</dd><dt>Advisory only</dt><dd>${participation?.advisory === true ? "yes" : "no"}</dd></dl></section>${council ? `<section><h2>Council rehearsal</h2><dl><dt>State</dt><dd>${escapeHtml(council.state)}</dd><dt>Reviewed department responses</dt><dd>${council.reviewedDepartmentResponseCount}</dd></dl></section>` : ""}${adminMarkup}<section><h2>Mecky</h2><dl><dt>Profile</dt><dd>${escapeHtml(view.mecky?.profile ?? "unavailable")}</dd><dt>Worker identity</dt><dd>${escapeHtml(view.mecky?.workerIdentityId ?? "unavailable")}</dd><dt>Session</dt><dd>${escapeHtml(view.mecky?.sessionKey ?? "unavailable")}</dd><dt>Context checksum</dt><dd>${escapeHtml(view.mecky?.contextChecksum ?? "unavailable")}</dd><dt>Answer</dt><dd>${escapeHtml(view.mecky?.answer ?? "unavailable")}</dd><dt>Tools</dt><dd>default-deny</dd><dt>Prohibited effects</dt><dd>${list(view.mecky?.prohibitedEffects ?? [])}</dd></dl></section></main><footer>Offline synthetic reference surface · authority binding none</footer></body></html>`;
}

function loopbackHost(value: string | undefined): boolean {
  if (!value) return false;
  const host = value.trim().toLowerCase();
  if (host.startsWith("[::1]")) return /^\[::1\](?::\d+)?$/.test(host);
  const hostname = host.split(":")[0];
  return (hostname === "127.0.0.1" || hostname === "localhost") && /^\S+(?::\d+)?$/.test(host);
}

function sendHtml(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(body);
}

export function createReferenceBrowserServer(config: ReferenceBrowserConfig): ReferenceBrowserServer {
  assertReferenceConfig(config);
  const runtime = createCoordinatorCompanionRuntime({
    coordinator: config.coordinator,
    caseId: config.caseId,
    policyVersion: config.policyVersion,
    actors: config.actors as Readonly<Record<CompanionProfile, CoordinatorCompanionActor>>,
    identities: config.identities,
    sessions: config.sessions,
  });
  const identityPolicy = createCompanionIdentityPolicy(config.identities);
  const adapter = createDeterministicLocalCompanionAdapter({ identityPolicy });

  const render = async (pathname: string): Promise<ReferenceViewV1> => {
    const route = routeFromPath(pathname);
    let task;
    try {
      task = runtime.prepareTask({ profile: route, question: QUESTION_BY_PROFILE[route] });
    } catch {
      failProjection();
    }
    let result: WorkerResultV1;
    try {
      result = await adapter.run(task!, { identityPolicy });
    } catch {
      failMecky();
    }
    const context = task!.context as unknown as { projection?: unknown; caseVersion?: number; journalHeadChecksum?: string; projectionChecksum?: string; policyVersion?: string };
    if (!isRecord(context.projection)) failProjection();
    const envelope: ProjectionEnvelope = {
      schemaVersion: "projection_envelope_v1",
      caseId: config.caseId,
      caseVersion: typeof context.caseVersion === "number" ? context.caseVersion : failProjection(),
      journalHeadChecksum: requireString(context.journalHeadChecksum, "projection_unavailable_v1"),
      projectionChecksum: requireString(context.projectionChecksum, "projection_unavailable_v1"),
      visibility: route,
      policyVersion: requireString(context.policyVersion, "projection_unavailable_v1"),
      projection: context.projection as never,
    };
    return buildReferenceViewFromTask(route, envelope, result!, config);
  };

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      if (!loopbackHost(request.headers.host)) {
        sendHtml(response, 400, genericPage("Reference surface unavailable", "invalid_host"));
        return;
      }
      if (request.method !== "GET") {
        sendHtml(response, 405, genericPage("Method not allowed", "method_not_allowed"));
        return;
      }
      const rawUrl = request.url ?? "";
      if (!rawUrl.startsWith("/") || rawUrl.includes("?") || rawUrl.includes("#")) {
        sendHtml(response, 400, genericPage("Reference surface unavailable", "invalid_request"));
        return;
      }
      try {
        const view = await render(rawUrl);
        sendHtml(response, 200, renderReferenceView(view));
      } catch (error) {
        if (error instanceof Error && error.message === "reference_route_not_found") {
          sendHtml(response, 404, genericPage("Not found", "route_not_found"));
        } else if (error instanceof ReferenceBrowserError) {
          sendHtml(response, 503, genericPage("Reference surface unavailable", error.code));
        } else {
          sendHtml(response, 503, genericPage("Reference surface unavailable", "projection_unavailable_v1"));
        }
      }
    })().catch(() => sendHtml(response, 503, genericPage("Reference surface unavailable", "projection_unavailable_v1")));
  });

  return {
    server,
    listen(port = 0): Promise<{ port: number; host: string }> {
      return new Promise((resolve, reject) => {
        const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
        const onListening = () => {
          server.off("error", onError);
          const address = server.address();
          if (!address || typeof address === "string") { reject(new Error("reference_server_address_invalid")); return; }
          resolve({ port: address.port, host: "127.0.0.1" });
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, "127.0.0.1");
      });
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        if (!server.listening) { resolve(); return; }
        server.close((error) => error ? reject(error) : resolve());
      });
    },
    render,
  };
}

export function buildBrowserAcceptanceEvidence(input: Omit<BrowserAcceptanceEvidence, "schemaVersion">): BrowserAcceptanceEvidence {
  const evidence = {
    schemaVersion: "stadtstack.browser_acceptance_evidence.v1" as const,
    ...clone(input),
  };
  return clone(evidence);
}
