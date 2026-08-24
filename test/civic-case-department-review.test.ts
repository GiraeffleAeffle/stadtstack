import assert from "node:assert/strict";
import test from "node:test";

import {
  createCivicCaseCoordinator,
  type CommandEnvelope,
  type CivicCaseCoordinatorOptions,
} from "../src/civic-case-coordinator.ts";
import {
  createNostrDiscussionAdapter,
  type DiscussionArtifact,
} from "../src/adapters/discussion-adapter.ts";

const scope = {
  municipalityId: "sample-municipality",
  caseId: "sample-case",
};
const caseId = "urn:stadtstack:case:municipality:sample-municipality:018f0000-0000-7000-8000-000000000001";
const fixturePubkey = "7190b3fcc08cd9c4edb5ef541e8a578089cb8727ba93c4cfb0583e2287d57bd2";

function signedDiscussion(): DiscussionArtifact {
  return createNostrDiscussionAdapter({ scope, syntheticFixtureOnly: true }).normalize({
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
  });
}

function configuredCoordinator() {
  const options: CivicCaseCoordinatorOptions = {
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
      { actorId: "synthetic:planning-agent-2", actorClass: "department_agent", departmentId: "planning" },
      { actorId: "synthetic:planning-reviewer-1", actorClass: "department_reviewer", departmentId: "planning" },
      { actorId: "synthetic:planning-reviewer-2", actorClass: "department_reviewer", departmentId: "planning" },
    ],
  };
  return createCivicCaseCoordinator(options);
}

function intakeCommand(discussion: DiscussionArtifact): CommandEnvelope {
  return {
    schemaVersion: "command_envelope_v1",
    commandType: "intake_discussion_v1",
    caseId,
    actorBinding: { actorId: "synthetic:citizen-1", actorClass: "citizen" },
    expectedCaseVersion: 0,
    idempotencyKey: "synthetic:idem:discussion-1",
    visibility: "private_case",
    policyVersion: "case-intake-v1",
    payload: { discussion },
  };
}

function projectionQuery(actorId: string, actorClass: "administration" | "public" | "council", visibility: "administration" | "public" | "council", atCaseVersion: number | null) {
  return {
    schemaVersion: "query_envelope_v1" as const,
    queryType: "case_projection_v1" as const,
    caseId,
    actorBinding: { actorId, actorClass },
    visibility,
    policyVersion: "case-intake-v1",
    atCaseVersion,
  };
}

function assignPackage(coordinator: ReturnType<typeof configuredCoordinator>) {
  coordinator.handle(intakeCommand(signedDiscussion()));
  return coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "assign_department_package_v1",
    caseId,
    actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
    expectedCaseVersion: 2,
    idempotencyKey: "synthetic:idem:package-1",
    visibility: "private_case",
    policyVersion: "case-intake-v1",
    payload: {
      departmentPackage: {
        id: "package-planning-1",
        departmentId: "planning",
        suggestionId: "urn:stadtstack:suggestion:44ac22db49995e6ec96344b624d3ee01eb50ad814cf80f51af05959bb305412c",
        request: "Which low-cost changes can make the crossing safer?",
        assignedAgentActorId: "synthetic:planning-agent-1",
        assignedReviewerActorId: "synthetic:planning-reviewer-1",
        authorityBinding: "none",
      },
    },
  });
}

test("a steward can create one bounded department package and administration can project its assignment", () => {
  const coordinator = configuredCoordinator();
  const receipt = assignPackage(coordinator);

  assert.equal(receipt.caseVersion, 3);
  assert.equal(receipt.eventIds.length, 1);
  const administration = coordinator.project(projectionQuery(
    "synthetic:administration-1",
    "administration",
    "administration",
    null,
  ));
  const departmentPackage = administration.projection.departmentPackage;
  assert.ok(departmentPackage);
  assert.equal(departmentPackage.id, "package-planning-1");
  assert.equal(departmentPackage.departmentId, "planning");
  assert.equal(departmentPackage.reviewState, "assigned");
});

test("the assigned department agent records one checksum-bound draft while public and council remain redacted", () => {
  const coordinator = configuredCoordinator();
  const assignment = assignPackage(coordinator);
  const assigned = coordinator.project(projectionQuery(
    "synthetic:administration-1",
    "administration",
    "administration",
    assignment.caseVersion,
  ));
  const packageProjection = assigned.projection.departmentPackage;
  assert.ok(packageProjection);

  const draftReceipt = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "record_department_draft_v1",
    caseId,
    actorBinding: { actorId: "synthetic:planning-agent-1", actorClass: "department_agent" },
    expectedCaseVersion: assignment.caseVersion,
    idempotencyKey: "synthetic:idem:draft-1",
    visibility: "private_case",
    policyVersion: "case-intake-v1",
    payload: {
      packageId: packageProjection.id,
      packageChecksum: packageProjection.packageChecksum,
      draft: {
        schemaVersion: "department_draft_v1",
        id: "draft-planning-1",
        publicSummary: "A raised crossing and clearer markings could reduce risk.",
        publicCitations: ["https://www.roebel-mueritz.de/rathaus/reviewed/planning-evidence-1"],
        privateEvidenceRefs: ["synthetic://planning/private-evidence-1"],
        authorityBinding: "none",
      },
    },
  });
  assert.equal(draftReceipt.caseVersion, 4);
  assert.equal(draftReceipt.eventIds.length, 1);

  const administration = coordinator.project(projectionQuery(
    "synthetic:administration-1",
    "administration",
    "administration",
    null,
  ));
  const adminPackage = administration.projection.departmentPackage;
  assert.ok(adminPackage?.draft);
  assert.equal(adminPackage.reviewState, "draft_pending_review");
  assert.deepEqual(adminPackage.draft.privateEvidenceRefs, ["synthetic://planning/private-evidence-1"]);
  assert.equal(adminPackage.draft.actorId, "synthetic:planning-agent-1");

  const publicProjection = coordinator.project(projectionQuery("synthetic:public-1", "public", "public", null));
  const councilProjection = coordinator.project(projectionQuery("synthetic:council-1", "council", "council", null));
  assert.equal("departmentPackage" in publicProjection.projection, false);
  assert.equal("departmentPackage" in councilProjection.projection, false);

  administration.projection.departmentPackage!.draft!.privateEvidenceRefs![0] = "mutated";
  const unchanged = coordinator.project(projectionQuery("synthetic:administration-1", "administration", "administration", null));
  assert.deepEqual(unchanged.projection.departmentPackage?.draft?.privateEvidenceRefs, ["synthetic://planning/private-evidence-1"]);
});

test("an independent reviewer accepts the current draft and only its public-safe result crosses the projection boundary", () => {
  const coordinator = configuredCoordinator();
  const assignment = assignPackage(coordinator);
  const assigned = coordinator.project(projectionQuery("synthetic:administration-1", "administration", "administration", assignment.caseVersion));
  const packageProjection = assigned.projection.departmentPackage;
  assert.ok(packageProjection);
  const draftReceipt = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "record_department_draft_v1",
    caseId,
    actorBinding: { actorId: "synthetic:planning-agent-1", actorClass: "department_agent" },
    expectedCaseVersion: assignment.caseVersion,
    idempotencyKey: "synthetic:idem:draft-1",
    visibility: "private_case",
    policyVersion: "case-intake-v1",
    payload: {
      packageId: packageProjection.id,
      packageChecksum: packageProjection.packageChecksum,
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
  const draftProjection = coordinator.project(projectionQuery("synthetic:administration-1", "administration", "administration", draftReceipt.caseVersion)).projection.departmentPackage;
  assert.ok(draftProjection?.draft);

  const reviewReceipt = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "attest_department_review_v1",
    caseId,
    actorBinding: { actorId: "synthetic:planning-reviewer-1", actorClass: "department_reviewer" },
    expectedCaseVersion: draftReceipt.caseVersion,
    idempotencyKey: "synthetic:idem:review-1",
    visibility: "private_case",
    policyVersion: "case-intake-v1",
    payload: {
      review: {
        packageId: draftProjection.id,
        draftArtifactChecksum: draftProjection.draft.artifactChecksum,
        decision: "accepted",
        reviewedAt: "2026-08-08T00:00:05.000Z",
      },
    },
  });
  assert.equal(reviewReceipt.caseVersion, 5);
  assert.equal(reviewReceipt.eventIds.length, 1);

  const administration = coordinator.project(projectionQuery("synthetic:administration-1", "administration", "administration", null));
  assert.equal(administration.projection.departmentPackage?.reviewState, "accepted");
  assert.equal(administration.projection.departmentPackage?.review?.reviewerActorId, "synthetic:planning-reviewer-1");
  const publicProjection = coordinator.project(projectionQuery("synthetic:public-1", "public", "public", null));
  const councilProjection = coordinator.project(projectionQuery("synthetic:council-1", "council", "council", null));
  const publicPackage = publicProjection.projection.departmentPackage;
  assert.ok(publicPackage);
  assert.equal(publicPackage.reviewState, "accepted");
  assert.equal(publicPackage.publicSummary, "A raised crossing and clearer markings could reduce risk.");
  assert.deepEqual(publicPackage.publicCitations, ["synthetic://planning/evidence-1"]);
  assert.equal("privateEvidenceRefs" in publicPackage, false);
  assert.equal("assignedAgentActorId" in publicPackage, false);
  assert.equal("review" in publicPackage, false);
  assert.equal("draft" in publicPackage, false);
  assert.equal("departmentPackage" in councilProjection.projection, true);
  assert.equal("privateEvidenceRefs" in (councilProjection.projection.departmentPackage ?? {}), false);
});

test("department assignment is steward-only, closed, and registry-scoped", () => {
  const coordinator = configuredCoordinator();
  coordinator.handle(intakeCommand(signedDiscussion()));
  const base = {
    schemaVersion: "command_envelope_v1" as const,
    commandType: "assign_department_package_v1" as const,
    caseId,
    actorBinding: { actorId: "synthetic:steward-1" as const, actorClass: "case_steward" as const },
    expectedCaseVersion: 2,
    idempotencyKey: "synthetic:idem:package-1",
    visibility: "private_case" as const,
    policyVersion: "case-intake-v1",
    payload: {
      departmentPackage: {
        id: "package-planning-1",
        departmentId: "planning",
        suggestionId: "urn:stadtstack:suggestion:44ac22db49995e6ec96344b624d3ee01eb50ad814cf80f51af05959bb305412c",
        request: "Which low-cost changes can make the crossing safer?",
        assignedAgentActorId: "synthetic:planning-agent-1",
        assignedReviewerActorId: "synthetic:planning-reviewer-1",
        authorityBinding: "none" as const,
      },
    },
  };
  assert.throws(
    () => coordinator.handle({ ...base, actorBinding: { actorId: "synthetic:citizen-1", actorClass: "citizen" }, idempotencyKey: "synthetic:idem:package-citizen" }),
    /actor_role_forbidden/,
  );
  assert.throws(
    () => coordinator.handle({
      ...base,
      idempotencyKey: "synthetic:idem:package-unknown",
      payload: { departmentPackage: { ...base.payload.departmentPackage, prompt: "private" } as unknown as typeof base.payload.departmentPackage },
    }),
    /unknown_field:departmentPackage.prompt/,
  );
  assert.throws(
    () => coordinator.handle({
      ...base,
      idempotencyKey: "synthetic:idem:package-cross-department",
      payload: { departmentPackage: { ...base.payload.departmentPackage, departmentId: "traffic" } },
    }),
    /department_actor_scope_mismatch/,
  );
  const receipt = coordinator.handle(base);
  assert.equal(receipt.caseVersion, 3);
  assert.deepEqual(coordinator.handle(base), receipt);
});

test("draft and review checks bind current checksums, versions, roles, and deterministic time", () => {
  const coordinator = configuredCoordinator();
  const assignment = assignPackage(coordinator);
  const packageProjection = coordinator.project(projectionQuery("synthetic:administration-1", "administration", "administration", assignment.caseVersion)).projection.departmentPackage;
  assert.ok(packageProjection);
  const draftCommand = {
    schemaVersion: "command_envelope_v1" as const,
    commandType: "record_department_draft_v1" as const,
    caseId,
    actorBinding: { actorId: "synthetic:planning-agent-1" as const, actorClass: "department_agent" as const },
    expectedCaseVersion: assignment.caseVersion,
    idempotencyKey: "synthetic:idem:draft-1",
    visibility: "private_case" as const,
    policyVersion: "case-intake-v1",
    payload: {
      packageId: packageProjection.id,
      packageChecksum: packageProjection.packageChecksum,
      draft: {
        schemaVersion: "department_draft_v1" as const,
        id: "draft-planning-1",
        publicSummary: "A raised crossing and clearer markings could reduce risk.",
        publicCitations: ["synthetic://planning/evidence-1"],
        privateEvidenceRefs: ["synthetic://planning/private-evidence-1"],
        authorityBinding: "none" as const,
      },
    },
  };
  assert.throws(
    () => coordinator.handle({ ...draftCommand, expectedCaseVersion: assignment.caseVersion + 1, idempotencyKey: "synthetic:idem:draft-stale" }),
    /case_version_conflict/,
  );
  assert.throws(
    () => coordinator.handle({
      ...draftCommand,
      idempotencyKey: "synthetic:idem:draft-wrong-checksum",
      payload: { ...draftCommand.payload, packageChecksum: "sha256:" + "0".repeat(64) },
    }),
    /department_package_checksum_invalid/,
  );
  assert.throws(
    () => coordinator.handle({
      ...draftCommand,
      idempotencyKey: "synthetic:idem:draft-unknown",
      payload: { ...draftCommand.payload, draft: { ...draftCommand.payload.draft, reasoning: "do not persist" } as unknown as typeof draftCommand.payload.draft },
    }),
    /unknown_field:draft.reasoning/,
  );
  assert.throws(
    () => coordinator.handle({
      ...draftCommand,
      idempotencyKey: "synthetic:idem:draft-external-citation",
      payload: {
        ...draftCommand.payload,
        draft: { ...draftCommand.payload.draft, publicCitations: ["https://example.invalid/evidence"] },
      },
    }),
    /department_reference_invalid/,
  );
  assert.throws(
    () => coordinator.handle({
      ...draftCommand,
      idempotencyKey: "synthetic:idem:draft-public-citation-query",
      payload: {
        ...draftCommand.payload,
        draft: { ...draftCommand.payload.draft, publicCitations: ["https://www.roebel-mueritz.de/evidence?token=secret"] },
      },
    }),
    /secret_material_forbidden:department_draft_invalid/,
  );
  assert.throws(
    () => coordinator.handle({
      ...draftCommand,
      idempotencyKey: "synthetic:idem:draft-external-evidence",
      payload: {
        ...draftCommand.payload,
        draft: { ...draftCommand.payload.draft, privateEvidenceRefs: ["file:///private/evidence"] },
      },
    }),
    /department_reference_invalid/,
  );
  assert.throws(
    () => coordinator.handle({
      ...draftCommand,
      actorBinding: { actorId: "synthetic:planning-agent-2", actorClass: "department_agent" },
      idempotencyKey: "synthetic:idem:draft-unassigned-agent",
    }),
    /department_agent_not_assigned/,
  );
  const draftReceipt = coordinator.handle(draftCommand);
  const draftProjection = coordinator.project(projectionQuery("synthetic:administration-1", "administration", "administration", draftReceipt.caseVersion)).projection.departmentPackage;
  assert.ok(draftProjection?.draft);

  const reviewCommand = {
    schemaVersion: "command_envelope_v1" as const,
    commandType: "attest_department_review_v1" as const,
    caseId,
    actorBinding: { actorId: "synthetic:planning-reviewer-1" as const, actorClass: "department_reviewer" as const },
    expectedCaseVersion: draftReceipt.caseVersion,
    idempotencyKey: "synthetic:idem:review-1",
    visibility: "private_case" as const,
    policyVersion: "case-intake-v1",
    payload: {
      review: {
        packageId: draftProjection.id,
        draftArtifactChecksum: draftProjection.draft.artifactChecksum,
        decision: "rejected" as const,
        reviewedAt: "2026-08-08T00:00:05.000Z",
      },
    },
  };
  assert.throws(
    () => coordinator.handle({ ...reviewCommand, actorBinding: { actorId: "synthetic:planning-agent-1", actorClass: "department_agent" }, idempotencyKey: "synthetic:idem:review-agent" }),
    /actor_role_forbidden|department_reviewer_not_distinct/,
  );
  assert.throws(
    () => coordinator.handle({ ...reviewCommand, actorBinding: { actorId: "synthetic:planning-reviewer-2", actorClass: "department_reviewer" }, idempotencyKey: "synthetic:idem:review-unassigned-reviewer" }),
    /department_reviewer_not_assigned/,
  );
  assert.throws(
    () => coordinator.handle({ ...reviewCommand, expectedCaseVersion: draftReceipt.caseVersion - 1, idempotencyKey: "synthetic:idem:review-stale" }),
    /case_version_conflict/,
  );
  assert.throws(
    () => coordinator.handle({
      ...reviewCommand,
      idempotencyKey: "synthetic:idem:review-wrong-checksum",
      payload: { review: { ...reviewCommand.payload.review, draftArtifactChecksum: "sha256:" + "0".repeat(64) } },
    }),
    /department_draft_checksum_invalid/,
  );
  assert.throws(
    () => coordinator.handle({
      ...reviewCommand,
      idempotencyKey: "synthetic:idem:review-arbitrary-time",
      payload: { review: { ...reviewCommand.payload.review, reviewedAt: "2026-08-08T00:00:06.000Z" } },
    }),
    /department_review_time_invalid/,
  );
  const rejectedReceipt = coordinator.handle(reviewCommand);
  assert.equal(rejectedReceipt.caseVersion, 5);
  assert.deepEqual(coordinator.handle(reviewCommand), rejectedReceipt);
  const rejectedPublic = coordinator.project(projectionQuery("synthetic:public-1", "public", "public", null));
  assert.equal("departmentPackage" in rejectedPublic.projection, false);
});
