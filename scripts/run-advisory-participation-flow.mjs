#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createCivicCaseCoordinator, DETERMINISTIC_REVIEWED_AT } from "../src/civic-case-coordinator.ts";
import { createNostrDiscussionAdapter } from "../src/adapters/discussion-adapter.ts";

const scope = { municipalityId: "sample-municipality", caseId: "sample-case" };
const caseId = "urn:stadtstack:case:test:sample-municipality:018f0000-0000-7000-8000-000000000001";
const fixturePubkey = "7190b3fcc08cd9c4edb5ef541e8a578089cb8727ba93c4cfb0583e2287d57bd2";
const discussionId = "44ac22db49995e6ec96344b624d3ee01eb50ad814cf80f51af05959bb305412c";
const signature = "4db87c0f4d8d36de728c086bbec21a19224b639f29bf3334d032cc9584b39db4d4f41180a3485c440c83583a61937b53e9de4fe13d375b4635d23590917cf80e";
const departments = ["planning", "traffic", "environment", "finance", "legal", "public-order", "social-affairs", "public-works"];
const policyVersion = "case-intake-v1";
const participationReviewedAt = "2026-08-08T00:00:05.000Z";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function project(coordinator, actorId, actorClass, visibility) {
  return coordinator.project({
    schemaVersion: "query_envelope_v1",
    queryType: "case_projection_v1",
    caseId,
    actorBinding: { actorId, actorClass },
    visibility,
    policyVersion,
    atCaseVersion: null,
  });
}

const event = {
  kind: 1,
  created_at: 1_754_035_200,
  tags: [["municipality", scope.municipalityId], ["case", scope.caseId], ["t", "stadtstack-e2e-fixture"]],
  content: "Could the crossing be made safer?",
  pubkey: fixturePubkey,
  id: discussionId,
  sig: signature,
};
const discussion = createNostrDiscussionAdapter({ scope, syntheticFixtureOnly: true }).normalize(event);
const actors = [
  { actorId: "synthetic:citizen-1", actorClass: "citizen" },
  { actorId: "synthetic:public-1", actorClass: "public" },
  { actorId: "synthetic:administration-1", actorClass: "administration" },
  { actorId: "synthetic:council-1", actorClass: "council" },
  { actorId: "synthetic:steward-1", actorClass: "case_steward" },
  { actorId: "synthetic:participation-reviewer-1", actorClass: "participation_reviewer" },
  ...departments.flatMap((departmentId) => [
    { actorId: `synthetic:${departmentId}-agent`, actorClass: "department_agent", departmentId },
    { actorId: `synthetic:${departmentId}-reviewer`, actorClass: "department_reviewer", departmentId },
  ]),
];
const coordinator = createCivicCaseCoordinator({
  scope,
  syntheticFixtureOnly: true,
  allowedSignerPubkeys: [fixturePubkey],
  requiredDepartmentIds: [...departments].reverse(),
  actors,
});

const intake = coordinator.handle({
  schemaVersion: "command_envelope_v1",
  commandType: "intake_discussion_v1",
  caseId,
  actorBinding: { actorId: "synthetic:citizen-1", actorClass: "citizen" },
  expectedCaseVersion: 0,
  idempotencyKey: "synthetic:idem:discussion-1",
  visibility: "private_case",
  policyVersion,
  payload: { discussion },
});

let version = intake.caseVersion;
const assignmentReceipts = [];
for (const departmentId of departments) {
  const receipt = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "assign_department_package_v1",
    caseId,
    actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
    expectedCaseVersion: version,
    idempotencyKey: `synthetic:idem:package-${departmentId}`,
    visibility: "private_case",
    policyVersion,
    payload: {
      departmentPackage: {
        id: `package-${departmentId}`,
        departmentId,
        suggestionId: `urn:stadtstack:suggestion:${discussionId}`,
        request: `Review a bounded ${departmentId} response.`,
        assignedAgentActorId: `synthetic:${departmentId}-agent`,
        assignedReviewerActorId: `synthetic:${departmentId}-reviewer`,
        authorityBinding: "none",
      },
    },
  });
  assignmentReceipts.push(receipt);
  version = receipt.caseVersion;
}

const reviewReceipts = [];
for (const departmentId of departments) {
  const packageProjection = project(coordinator, "synthetic:administration-1", "administration", "administration")
    .projection.departmentPackages.find((item) => item.departmentId === departmentId);
  const draftReceipt = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "record_department_draft_v1",
    caseId,
    actorBinding: { actorId: `synthetic:${departmentId}-agent`, actorClass: "department_agent" },
    expectedCaseVersion: version,
    idempotencyKey: `synthetic:idem:draft-${departmentId}`,
    visibility: "private_case",
    policyVersion,
    payload: {
      packageId: packageProjection.id,
      packageChecksum: packageProjection.packageChecksum,
      draft: {
        schemaVersion: "department_draft_v1",
        id: `draft-${departmentId}-1`,
        publicSummary: `Reviewed ${departmentId} response.`,
        publicCitations: [`synthetic://${departmentId}/evidence-1`],
        privateEvidenceRefs: [`synthetic://${departmentId}/private-evidence-1`],
        authorityBinding: "none",
      },
    },
  });
  const draftedPackage = project(coordinator, "synthetic:administration-1", "administration", "administration")
    .projection.departmentPackages.find((item) => item.departmentId === departmentId);
  const reviewReceipt = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "attest_department_review_v1",
    caseId,
    actorBinding: { actorId: `synthetic:${departmentId}-reviewer`, actorClass: "department_reviewer" },
    expectedCaseVersion: draftReceipt.caseVersion,
    idempotencyKey: `synthetic:idem:review-${departmentId}`,
    visibility: "private_case",
    policyVersion,
    payload: {
      review: {
        packageId: draftedPackage.id,
        draftArtifactChecksum: draftedPackage.draft.artifactChecksum,
        decision: "accepted",
        reviewedAt: DETERMINISTIC_REVIEWED_AT,
      },
    },
  });
  reviewReceipts.push(reviewReceipt);
  version = reviewReceipt.caseVersion;
}

const administration = project(coordinator, "synthetic:administration-1", "administration", "administration");
const sourceBindings = administration.projection.departmentPackages.map((item) => ({
  packageId: item.id,
  packageChecksum: item.packageChecksum,
  draftArtifactChecksum: item.draft.artifactChecksum,
  reviewAttestationChecksum: item.review.attestationChecksum,
}));
const derive = coordinator.handle({
  schemaVersion: "command_envelope_v1",
  commandType: "derive_citizen_brief_v1",
  caseId,
  actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
  expectedCaseVersion: version,
  idempotencyKey: "synthetic:idem:citizen-brief-1",
  visibility: "private_case",
  policyVersion,
  payload: {
    brief: {
      id: `urn:stadtstack:citizen-brief:${caseId}:1`,
      sourceBindings,
      authorityBinding: "none",
    },
  },
});

const brief = project(coordinator, "synthetic:public-1", "public", "public").projection.reviewedCitizenBrief;
const briefEventId = derive.eventIds[0];
const participationBase = {
  schemaVersion: "participation_result_v1",
  id: "participation-result-1",
  contractId: "synthetic:crossing-advisory",
  contractVersion: 1,
  methodKind: "survey",
  methodVersion: "synthetic-survey-v1",
  ruleId: "advisory-signal",
  ruleVersion: "1",
  authorityBinding: "none",
  question: "Which safety improvement should be reviewed first?",
  options: [
    { optionId: "better-lighting", label: "Better lighting", aggregateCount: 2 },
    { optionId: "safer-crossing", label: "Safer crossing", aggregateCount: 6 },
  ],
  totalAccepted: 8,
  resultSummary: "A safer crossing was the strongest advisory signal.",
  unresolvedDissent: ["Lighting remains important to some participants."],
  representationAudit: {
    targetPopulationDescription: "Residents near the crossing",
    recruitmentMethod: "Synthetic opt-in",
    samplingMethod: "Voluntary response",
    totalInvited: null,
    totalStarted: 8,
    totalCompleted: 8,
    limitations: ["Synthetic data; not representative."],
  },
  limitations: ["Advisory signal only."],
  openedAt: "2026-08-01T00:00:00Z",
  closedAt: "2026-08-02T00:00:00Z",
  reviewedAt: participationReviewedAt,
  resultArtifactRef: "synthetic://participation/result-1",
  minorityReportRef: null,
  correctionState: "current",
};
const sourceBrief = { id: brief.id, briefChecksum: brief.briefChecksum, briefEventId };
const participation = {
  ...participationBase,
  checksum: sha256({
    participation: participationBase,
    sourceBrief,
    policyVersion,
    actorBinding: { actorId: "synthetic:participation-reviewer-1", actorClass: "participation_reviewer" },
    reviewedAt: participationReviewedAt,
  }),
};
const record = coordinator.handle({
  schemaVersion: "command_envelope_v1",
  commandType: "record_advisory_participation_v1",
  caseId,
  actorBinding: { actorId: "synthetic:participation-reviewer-1", actorClass: "participation_reviewer" },
  expectedCaseVersion: derive.caseVersion,
  idempotencyKey: "synthetic:idem:participation-1",
  visibility: "private_case",
  policyVersion,
  payload: {
    participation,
    sourceBrief: { id: brief.id, briefChecksum: brief.briefChecksum },
  },
});

const publicProjection = project(coordinator, "synthetic:public-1", "public", "public");
const councilProjection = project(coordinator, "synthetic:council-1", "council", "council");
const adminProjection = project(coordinator, "synthetic:administration-1", "administration", "administration");
process.stdout.write(`${JSON.stringify({
  schemaVersion: "stadtstack.advisory_participation_receipt.v1",
  status: "completed",
  mode: "offline_synthetic_only",
  receipts: { intake, assignments: assignmentReceipts, reviews: reviewReceipts, derive, record },
  public: {
    caseVersion: publicProjection.caseVersion,
    projectionChecksum: publicProjection.projectionChecksum,
    participationChecksum: publicProjection.projection.participationResult?.checksum,
    advisory: publicProjection.projection.participationResult?.advisory === true,
    authorityBinding: publicProjection.projection.participationResult?.authorityBinding,
    privateEvidenceVisible: JSON.stringify(publicProjection.projection).includes("privateEvidenceRefs"),
  },
  council: {
    state: councilProjection.projection.councilDryRunBrief?.state,
    citizenSignal: councilProjection.projection.councilDryRunBrief?.citizenSignal?.checksum,
    formalDecision: councilProjection.projection.councilDryRunBrief?.formalDecision,
    councilSubmissionCreated: councilProjection.projection.councilDryRunBrief?.councilSubmissionCreated,
    formalVoteStarted: councilProjection.projection.councilDryRunBrief?.formalVoteStarted,
    publicWrite: councilProjection.projection.councilDryRunBrief?.publicWrite,
  },
  administration: {
    packageCount: adminProjection.projection.departmentPackages?.length,
    participationState: adminProjection.projection.participationResult?.correctionState,
    privateEvidenceVisible: JSON.stringify(adminProjection.projection).includes("privateEvidenceRefs"),
  },
  authorityBinding: "none",
  externalNetworkCalled: false,
  publicPublication: false,
  formalVote: false,
})}\n`);
