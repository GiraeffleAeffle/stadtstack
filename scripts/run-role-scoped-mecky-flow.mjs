#!/usr/bin/env node

import { createCivicCaseCoordinator, DETERMINISTIC_REVIEWED_AT } from "../src/civic-case-coordinator.ts";
import { createNostrDiscussionAdapter } from "../src/adapters/discussion-adapter.ts";
import { createCoordinatorCompanionRuntime } from "../src/companion-runtime.ts";
import {
  createCompanionIdentityPolicy,
  createDeterministicLocalCompanionAdapter,
  createOpenClawCompanionAdapter,
} from "../src/adapters/companion-harness.ts";

const scope = { municipalityId: "sample-municipality", caseId: "sample-case" };
const caseId = "urn:stadtstack:case:municipality:sample-municipality:018f0000-0000-7000-8000-000000000001";
const fixturePubkey = "7190b3fcc08cd9c4edb5ef541e8a578089cb8727ba93c4cfb0583e2287d57bd2";
const discussionId = "44ac22db49995e6ec96344b624d3ee01eb50ad814cf80f51af05959bb305412c";
const signature = "4db87c0f4d8d36de728c086bbec21a19224b639f29bf3334d032cc9584b39db4d4f41180a3485c440c83583a61937b53e9de4fe13d375b4635d23590917cf80e";
const departments = ["planning", "traffic", "environment", "finance", "legal", "public-order", "social-affairs", "public-works"];
const policyVersion = "case-intake-v1";
const actors = {
  public: { actorId: "synthetic:public-1", actorClass: "public" },
  administration: { actorId: "synthetic:administration-1", actorClass: "administration" },
  council: { actorId: "synthetic:council-1", actorClass: "council" },
};
const identities = {
  public: "did:stadtstack:sample:mecky-public",
  administration: "did:stadtstack:sample:mecky-administration",
  council: "did:stadtstack:sample:mecky-council",
};
const sessions = {
  public: "session:public:sample-case",
  administration: "session:administration:sample-case",
  council: "session:council:sample-case",
};

function project(coordinator, actor, visibility) {
  return coordinator.project({
    schemaVersion: "query_envelope_v1",
    queryType: "case_projection_v1",
    caseId,
    actorBinding: actor,
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
const coordinator = createCivicCaseCoordinator({
  scope,
  syntheticFixtureOnly: true,
  allowedSignerPubkeys: [fixturePubkey],
  requiredDepartmentIds: departments,
  actors: [
    { actorId: "synthetic:citizen-1", actorClass: "citizen" },
    actors.public,
    actors.administration,
    actors.council,
    { actorId: "synthetic:steward-1", actorClass: "case_steward" },
    ...departments.flatMap((departmentId) => [
      { actorId: `synthetic:${departmentId}-agent`, actorClass: "department_agent", departmentId },
      { actorId: `synthetic:${departmentId}-reviewer`, actorClass: "department_reviewer", departmentId },
    ]),
  ],
});

let version = coordinator.handle({
  schemaVersion: "command_envelope_v1",
  commandType: "intake_discussion_v1",
  caseId,
  actorBinding: { actorId: "synthetic:citizen-1", actorClass: "citizen" },
  expectedCaseVersion: 0,
  idempotencyKey: "synthetic:idem:issue6-discussion",
  visibility: "private_case",
  policyVersion,
  payload: { discussion },
}).caseVersion;

for (const departmentId of departments) {
  version = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "assign_department_package_v1",
    caseId,
    actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
    expectedCaseVersion: version,
    idempotencyKey: `synthetic:idem:issue6-package-${departmentId}`,
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
  }).caseVersion;
}

for (const departmentId of departments) {
  const admin = project(coordinator, actors.administration, "administration").projection.departmentPackages.find((item) => item.departmentId === departmentId);
  const draftReceipt = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "record_department_draft_v1",
    caseId,
    actorBinding: { actorId: `synthetic:${departmentId}-agent`, actorClass: "department_agent" },
    expectedCaseVersion: version,
    idempotencyKey: `synthetic:idem:issue6-draft-${departmentId}`,
    visibility: "private_case",
    policyVersion,
    payload: {
      packageId: admin.id,
      packageChecksum: admin.packageChecksum,
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
  const drafted = project(coordinator, actors.administration, "administration").projection.departmentPackages.find((item) => item.departmentId === departmentId);
  version = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "attest_department_review_v1",
    caseId,
    actorBinding: { actorId: `synthetic:${departmentId}-reviewer`, actorClass: "department_reviewer" },
    expectedCaseVersion: draftReceipt.caseVersion,
    idempotencyKey: `synthetic:idem:issue6-review-${departmentId}`,
    visibility: "private_case",
    policyVersion,
    payload: {
      review: {
        packageId: drafted.id,
        draftArtifactChecksum: drafted.draft.artifactChecksum,
        decision: "accepted",
        reviewedAt: DETERMINISTIC_REVIEWED_AT,
      },
    },
  }).caseVersion;
}

const admin = project(coordinator, actors.administration, "administration").projection;
const sourceBindings = admin.departmentPackages.map((item) => ({
  packageId: item.id,
  packageChecksum: item.packageChecksum,
  draftArtifactChecksum: item.draft.artifactChecksum,
  reviewAttestationChecksum: item.review.attestationChecksum,
}));
coordinator.handle({
  schemaVersion: "command_envelope_v1",
  commandType: "derive_citizen_brief_v1",
  caseId,
  actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
  expectedCaseVersion: version,
  idempotencyKey: "synthetic:idem:issue6-brief",
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

const runtime = createCoordinatorCompanionRuntime({
  coordinator: { project: coordinator.project },
  caseId,
  policyVersion,
  actors,
  identities,
  sessions,
});
const identityPolicy = createCompanionIdentityPolicy(identities);
const local = createDeterministicLocalCompanionAdapter({ identityPolicy });
const openclaw = createOpenClawCompanionAdapter({
  send(request) {
    return local.resultFor(request);
  },
}, { identityPolicy });

const profiles = ["administration", "council", "public"];
const rows = [];
for (const profile of profiles) {
  const task = runtime.prepareTask({ profile, question: "Summarize the reviewed case context." });
  const result = await (profile === "council" ? openclaw : local).run(task);
  rows.push({
    profile,
    workerIdentity: result.aiAttribution.workerIdentityId,
    sessionKey: result.sessionKey,
    taskId: result.taskId,
    contextChecksum: result.contextChecksum,
    adapterKind: result.aiAttribution.adapterKind,
    citationRefs: result.citations.map((citation) => citation.ref),
    artifactBindings: result.artifactBindings,
    authorityBinding: result.aiAttribution.authorityBinding,
    tools: result.tools,
    prohibitedEffects: result.prohibitedEffects,
  });
}

const publicProjection = project(coordinator, actors.public, "public");
const councilProjection = project(coordinator, actors.council, "council");
process.stdout.write(`${JSON.stringify({
  schemaVersion: "stadtstack.role_scoped_mecky_receipt.v1",
  status: "completed",
  mode: "offline_synthetic_only",
  coordinator: {
    caseId,
    caseVersion: publicProjection.caseVersion,
    journalHeadChecksum: publicProjection.journalHeadChecksum,
    reviewedBriefChecksum: publicProjection.projection.reviewedCitizenBrief?.briefChecksum,
  },
  workers: rows,
  roles: {
    publicVisibility: publicProjection.visibility,
    councilVisibility: councilProjection.visibility,
    publicPrivateEvidenceVisible: JSON.stringify(publicProjection.projection).includes("privateEvidenceRefs"),
    councilPrivateEvidenceVisible: JSON.stringify(councilProjection.projection).includes("privateEvidenceRefs"),
    councilDryRunState: councilProjection.projection.councilDryRunBrief?.state,
  },
  authorityBinding: "none",
  externalNetworkCalled: false,
  providerFallback: false,
  requestedEffects: false,
})}\n`);
