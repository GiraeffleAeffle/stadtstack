#!/usr/bin/env node

import { createCivicCaseCoordinator, DETERMINISTIC_REVIEWED_AT } from "../src/civic-case-coordinator.ts";
import { createNostrDiscussionAdapter } from "../src/adapters/discussion-adapter.ts";

const scope = { municipalityId: "sample-municipality", caseId: "sample-case" };
const caseId = "urn:stadtstack:case:test:sample-municipality:018f0000-0000-7000-8000-000000000001";
const fixturePubkey = "7190b3fcc08cd9c4edb5ef541e8a578089cb8727ba93c4cfb0583e2287d57bd2";
const event = {
  kind: 1,
  created_at: 1_754_035_200,
  tags: [["municipality", scope.municipalityId], ["case", scope.caseId], ["t", "stadtstack-e2e-fixture"]],
  content: "Could the crossing be made safer?",
  pubkey: fixturePubkey,
  id: "44ac22db49995e6ec96344b624d3ee01eb50ad814cf80f51af05959bb305412c",
  sig: "4db87c0f4d8d36de728c086bbec21a19224b639f29bf3334d032cc9584b39db4d4f41180a3485c440c83583a61937b53e9de4fe13d375b4635d23590917cf80e",
};
const departments = ["planning", "traffic", "environment", "finance", "legal", "public-order", "social-affairs", "public-works"];
const policyVersion = "case-intake-v1";
const discussion = createNostrDiscussionAdapter({ scope, syntheticFixtureOnly: true }).normalize(event);

const actors = [
  { actorId: "synthetic:citizen-1", actorClass: "citizen" },
  { actorId: "synthetic:public-1", actorClass: "public" },
  { actorId: "synthetic:administration-1", actorClass: "administration" },
  { actorId: "synthetic:council-1", actorClass: "council" },
  { actorId: "synthetic:steward-1", actorClass: "case_steward" },
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

const assignmentReceipts = [];
let version = intake.caseVersion;
for (const departmentId of departments) {
  const assignment = coordinator.handle({
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
        suggestionId: `urn:stadtstack:suggestion:${event.id}`,
        request: `Review a bounded ${departmentId} response.`,
        assignedAgentActorId: `synthetic:${departmentId}-agent`,
        assignedReviewerActorId: `synthetic:${departmentId}-reviewer`,
        authorityBinding: "none",
      },
    },
  });
  assignmentReceipts.push(assignment);
  version = assignment.caseVersion;
}

const reviewReceipts = [];
for (const departmentId of departments) {
  const packageProjection = coordinator.project({
    schemaVersion: "query_envelope_v1",
    queryType: "case_projection_v1",
    caseId,
    actorBinding: { actorId: "synthetic:administration-1", actorClass: "administration" },
    visibility: "administration",
    policyVersion,
    atCaseVersion: null,
  }).projection.departmentPackages.find((item) => item.departmentId === departmentId);
  const draft = coordinator.handle({
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
  const draftedPackage = coordinator.project({
    schemaVersion: "query_envelope_v1",
    queryType: "case_projection_v1",
    caseId,
    actorBinding: { actorId: "synthetic:administration-1", actorClass: "administration" },
    visibility: "administration",
    policyVersion,
    atCaseVersion: null,
  }).projection.departmentPackages.find((item) => item.departmentId === departmentId);
  const review = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "attest_department_review_v1",
    caseId,
    actorBinding: { actorId: `synthetic:${departmentId}-reviewer`, actorClass: "department_reviewer" },
    expectedCaseVersion: draft.caseVersion,
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
  reviewReceipts.push(review);
  version = review.caseVersion;
}

const administrationQuery = () => coordinator.project({
  schemaVersion: "query_envelope_v1",
  queryType: "case_projection_v1",
  caseId,
  actorBinding: { actorId: "synthetic:administration-1", actorClass: "administration" },
  visibility: "administration",
  policyVersion,
  atCaseVersion: null,
});
const publicQuery = () => coordinator.project({
  schemaVersion: "query_envelope_v1",
  queryType: "case_projection_v1",
  caseId,
  actorBinding: { actorId: "synthetic:public-1", actorClass: "public" },
  visibility: "public",
  policyVersion,
  atCaseVersion: null,
});
const administration = administrationQuery();
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
const publicProjection = publicQuery();
const brief = publicProjection.projection.reviewedCitizenBrief;
process.stdout.write(`${JSON.stringify({
  schemaVersion: "stadtstack.citizen_brief_receipt.v1",
  status: "completed",
  mode: "offline_synthetic_only",
  receipts: {
    intake,
    assignments: assignmentReceipts,
    reviews: reviewReceipts,
    derive,
  },
  public: {
    caseVersion: publicProjection.caseVersion,
    projectionChecksum: publicProjection.projectionChecksum,
    briefChecksum: brief?.briefChecksum,
    correctionState: brief?.correctionState,
    responseDepartments: brief?.responses.map((response) => response.departmentId),
    privateEvidenceVisible: JSON.stringify(publicProjection.projection).includes("privateEvidenceRefs"),
  },
  administration: {
    packageCount: administration.projection.departmentPackages.length,
    privateEvidenceVisible: JSON.stringify(administration.projection).includes("privateEvidenceRefs"),
  },
  authorityBinding: "none",
  externalNetworkCalled: false,
  publicPublication: false,
  formalVote: false,
})}\n`);
