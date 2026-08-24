#!/usr/bin/env node

import { createCivicCaseCoordinator, DETERMINISTIC_REVIEWED_AT } from "../src/civic-case-coordinator.ts";
import { createNostrDiscussionAdapter } from "../src/adapters/discussion-adapter.ts";

const scope = {
  municipalityId: "sample-municipality",
  caseId: "sample-case",
};
const caseId = "urn:stadtstack:case:municipality:sample-municipality:018f0000-0000-7000-8000-000000000001";
const fixturePubkey = "7190b3fcc08cd9c4edb5ef541e8a578089cb8727ba93c4cfb0583e2287d57bd2";
const event = {
  kind: 1,
  created_at: 1_754_035_200,
  tags: [
    ["municipality", scope.municipalityId],
    ["case", scope.caseId],
    ["t", "stadtstack-e2e-fixture"],
  ],
  content: "Could the crossing be made safer?",
  pubkey: fixturePubkey,
  id: "44ac22db49995e6ec96344b624d3ee01eb50ad814cf80f51af05959bb305412c",
  sig: "4db87c0f4d8d36de728c086bbec21a19224b639f29bf3334d032cc9584b39db4d4f41180a3485c440c83583a61937b53e9de4fe13d375b4635d23590917cf80e",
};
const discussion = createNostrDiscussionAdapter({ scope, syntheticFixtureOnly: true }).normalize(event);
const coordinator = createCivicCaseCoordinator({
  scope,
  syntheticFixtureOnly: true,
  allowedSignerPubkeys: [fixturePubkey],
  actors: [
    { actorId: "synthetic:citizen-1", actorClass: "citizen" },
    { actorId: "synthetic:public-1", actorClass: "public" },
    { actorId: "synthetic:administration-1", actorClass: "administration" },
    { actorId: "synthetic:council-1", actorClass: "council" },
    { actorId: "synthetic:steward-1", actorClass: "case_steward" },
    { actorId: "synthetic:planning-agent-1", actorClass: "department_agent", departmentId: "planning" },
    { actorId: "synthetic:planning-reviewer-1", actorClass: "department_reviewer", departmentId: "planning" },
  ],
});
const intake = coordinator.handle({
  schemaVersion: "command_envelope_v1",
  commandType: "intake_discussion_v1",
  caseId,
  actorBinding: { actorId: "synthetic:citizen-1", actorClass: "citizen" },
  expectedCaseVersion: 0,
  idempotencyKey: "synthetic:idem:discussion-1",
  visibility: "private_case",
  policyVersion: "case-intake-v1",
  payload: { discussion },
});
const assignment = coordinator.handle({
  schemaVersion: "command_envelope_v1",
  commandType: "assign_department_package_v1",
  caseId,
  actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
  expectedCaseVersion: intake.caseVersion,
  idempotencyKey: "synthetic:idem:package-1",
  visibility: "private_case",
  policyVersion: "case-intake-v1",
  payload: {
    departmentPackage: {
      id: "package-planning-1",
      departmentId: "planning",
      suggestionId: `urn:stadtstack:suggestion:${event.id}`,
      request: "Which low-cost changes can make the crossing safer?",
      assignedAgentActorId: "synthetic:planning-agent-1",
      assignedReviewerActorId: "synthetic:planning-reviewer-1",
      authorityBinding: "none",
    },
  },
});
const adminQuery = (atCaseVersion = null) => coordinator.project({
  schemaVersion: "query_envelope_v1",
  queryType: "case_projection_v1",
  caseId,
  actorBinding: { actorId: "synthetic:administration-1", actorClass: "administration" },
  visibility: "administration",
  policyVersion: "case-intake-v1",
  atCaseVersion,
});
const assignedPackage = adminQuery(assignment.caseVersion).projection.departmentPackage;
const draft = coordinator.handle({
  schemaVersion: "command_envelope_v1",
  commandType: "record_department_draft_v1",
  caseId,
  actorBinding: { actorId: "synthetic:planning-agent-1", actorClass: "department_agent" },
  expectedCaseVersion: assignment.caseVersion,
  idempotencyKey: "synthetic:idem:draft-1",
  visibility: "private_case",
  policyVersion: "case-intake-v1",
  payload: {
    packageId: assignedPackage.id,
    packageChecksum: assignedPackage.packageChecksum,
    draft: {
      schemaVersion: "department_draft_v1",
      id: "draft-planning-1",
      publicSummary: "A raised crossing and clearer markings could reduce risk.",
      publicCitations: ["synthetic://planning/evidence-1"],
      privateEvidenceRefs: ["synthetic://planning/private-evidence-1"],
      authorityBinding: "none",
    },
  },
});
const draftedPackage = adminQuery(draft.caseVersion).projection.departmentPackage;
const review = coordinator.handle({
  schemaVersion: "command_envelope_v1",
  commandType: "attest_department_review_v1",
  caseId,
  actorBinding: { actorId: "synthetic:planning-reviewer-1", actorClass: "department_reviewer" },
  expectedCaseVersion: draft.caseVersion,
  idempotencyKey: "synthetic:idem:review-1",
  visibility: "private_case",
  policyVersion: "case-intake-v1",
  payload: {
    review: {
      packageId: draftedPackage.id,
      draftArtifactChecksum: draftedPackage.draft.artifactChecksum,
      decision: "accepted",
      reviewedAt: DETERMINISTIC_REVIEWED_AT,
    },
  },
});
const query = (actorId, actorClass, visibility) => coordinator.project({
  schemaVersion: "query_envelope_v1",
  queryType: "case_projection_v1",
  caseId,
  actorBinding: { actorId, actorClass },
  visibility,
  policyVersion: "case-intake-v1",
  atCaseVersion: null,
});
process.stdout.write(`${JSON.stringify({
  schemaVersion: "stadtstack.department_review_receipt.v1",
  status: "completed",
  mode: "offline_synthetic_only",
  receipts: { intake, assignment, draft, review },
  administrationProjection: query("synthetic:administration-1", "administration", "administration"),
  publicProjection: query("synthetic:public-1", "public", "public"),
  councilProjection: query("synthetic:council-1", "council", "council"),
  authorityBinding: "none",
  externalNetworkCalled: false,
  publicPublication: false,
  formalVote: false,
})}\n`);
