import assert from "node:assert/strict";
import test from "node:test";

import {
  createCivicCaseCoordinator,
  type CivicCaseCoordinatorOptions,
  type CommandEnvelope,
} from "../src/civic-case-coordinator.ts";
import { createNostrDiscussionAdapter, type DiscussionArtifact } from "../src/adapters/discussion-adapter.ts";

const scope = { municipalityId: "sample-municipality", caseId: "sample-case" };
const caseId = "urn:stadtstack:case:municipality:sample-municipality:018f0000-0000-7000-8000-000000000001";
const fixturePubkey = "7190b3fcc08cd9c4edb5ef541e8a578089cb8727ba93c4cfb0583e2287d57bd2";
const discussionId = "44ac22db49995e6ec96344b624d3ee01eb50ad814cf80f51af05959bb305412c";
const departments = ["planning", "traffic", "environment", "finance", "legal", "public-order", "social-affairs", "public-works"] as const;

test("Issue #4 requires exactly eight unique configured departments and scoped actor coverage", () => {
  assert.throws(
    () => createCivicCaseCoordinator({ requiredDepartmentIds: ["planning"] }),
    /required_departments_invalid/,
  );
  assert.throws(
    () => createCivicCaseCoordinator({ requiredDepartmentIds: [...departments.slice(0, 7), "planning"] }),
    /required_departments_unique/,
  );
  assert.throws(
    () => createCivicCaseCoordinator({
      requiredDepartmentIds: departments,
      syntheticFixtureOnly: true,
      allowedSignerPubkeys: [fixturePubkey],
      actors: [{ actorId: "synthetic:citizen-1", actorClass: "citizen" }],
    }),
    /department_registry_incomplete/,
  );
});

function signedDiscussion(): DiscussionArtifact {
  return createNostrDiscussionAdapter({ scope, syntheticFixtureOnly: true }).normalize({
    kind: 1,
    created_at: 1_754_035_200,
    tags: [["municipality", scope.municipalityId], ["case", scope.caseId], ["t", "stadtstack-e2e-fixture"]],
    content: "Could the crossing be made safer?",
    pubkey: fixturePubkey,
    id: discussionId,
    sig: "4db87c0f4d8d36de728c086bbec21a19224b639f29bf3334d032cc9584b39db4d4f41180a3485c440c83583a61937b53e9de4fe13d375b4635d23590917cf80e",
  });
}

function configuredCoordinator() {
  const actors: CivicCaseCoordinatorOptions["actors"] = [
    { actorId: "synthetic:citizen-1", actorClass: "citizen" },
    { actorId: "synthetic:public-1", actorClass: "public" },
    { actorId: "synthetic:administration-1", actorClass: "administration" },
    { actorId: "synthetic:council-1", actorClass: "council" },
    { actorId: "synthetic:steward-1", actorClass: "case_steward" },
    ...departments.flatMap((departmentId) => [
      { actorId: `synthetic:${departmentId}-agent`, actorClass: "department_agent" as const, departmentId },
      { actorId: `synthetic:${departmentId}-reviewer`, actorClass: "department_reviewer" as const, departmentId },
    ]),
  ];
  return createCivicCaseCoordinator({
    scope,
    syntheticFixtureOnly: true,
    allowedSignerPubkeys: [fixturePubkey],
    requiredDepartmentIds: [...departments].reverse(),
    actors,
  });
}

function intake(coordinator: ReturnType<typeof configuredCoordinator>) {
  return coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "intake_discussion_v1",
    caseId,
    actorBinding: { actorId: "synthetic:citizen-1", actorClass: "citizen" },
    expectedCaseVersion: 0,
    idempotencyKey: "synthetic:idem:discussion-1",
    visibility: "private_case",
    policyVersion: "case-intake-v1",
    payload: { discussion: signedDiscussion() },
  });
}

function assign(coordinator: ReturnType<typeof configuredCoordinator>, departmentId: string, expectedCaseVersion: number) {
  return coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "assign_department_package_v1",
    caseId,
    actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
    expectedCaseVersion,
    idempotencyKey: `synthetic:idem:package-${departmentId}`,
    visibility: "private_case",
    policyVersion: "case-intake-v1",
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
  } satisfies CommandEnvelope);
}

function projectAdministration(coordinator: ReturnType<typeof configuredCoordinator>) {
  return coordinator.project({
    schemaVersion: "query_envelope_v1",
    queryType: "case_projection_v1",
    caseId,
    actorBinding: { actorId: "synthetic:administration-1", actorClass: "administration" },
    visibility: "administration",
    policyVersion: "case-intake-v1",
    atCaseVersion: null,
  });
}

function projectPublic(coordinator: ReturnType<typeof configuredCoordinator>) {
  return coordinator.project({
    schemaVersion: "query_envelope_v1",
    queryType: "case_projection_v1",
    caseId,
    actorBinding: { actorId: "synthetic:public-1", actorClass: "public" },
    visibility: "public",
    policyVersion: "case-intake-v1",
    atCaseVersion: null,
  });
}

function projectCouncil(coordinator: ReturnType<typeof configuredCoordinator>) {
  return coordinator.project({
    schemaVersion: "query_envelope_v1",
    queryType: "case_projection_v1",
    caseId,
    actorBinding: { actorId: "synthetic:council-1", actorClass: "council" },
    visibility: "council",
    policyVersion: "case-intake-v1",
    atCaseVersion: null,
  });
}

function recordDraftAndReview(coordinator: ReturnType<typeof configuredCoordinator>, departmentId: string, expectedCaseVersion: number) {
  const packageProjection = projectAdministration(coordinator).projection.departmentPackages?.find((item) => item.departmentId === departmentId);
  assert.ok(packageProjection);
  const draftReceipt = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "record_department_draft_v1",
    caseId,
    actorBinding: { actorId: `synthetic:${departmentId}-agent`, actorClass: "department_agent" },
    expectedCaseVersion,
    idempotencyKey: `synthetic:idem:draft-${departmentId}`,
    visibility: "private_case",
    policyVersion: "case-intake-v1",
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
  const draftProjection = projectAdministration(coordinator).projection.departmentPackages?.find((item) => item.departmentId === departmentId);
  assert.ok(draftProjection?.draft);
  return coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "attest_department_review_v1",
    caseId,
    actorBinding: { actorId: `synthetic:${departmentId}-reviewer`, actorClass: "department_reviewer" },
    expectedCaseVersion: draftReceipt.caseVersion,
    idempotencyKey: `synthetic:idem:review-${departmentId}`,
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
}

function acceptedSourceBindings(coordinator: ReturnType<typeof configuredCoordinator>) {
  const packages = projectAdministration(coordinator).projection.departmentPackages;
  assert.ok(packages);
  return packages.map((item) => {
    assert.ok(item.draft?.artifactChecksum);
    assert.ok(item.review?.attestationChecksum);
    return {
      packageId: item.id,
      packageChecksum: item.packageChecksum,
      draftArtifactChecksum: item.draft!.artifactChecksum!,
      reviewAttestationChecksum: item.review!.attestationChecksum!,
    };
  });
}

function deriveBrief(
  coordinator: ReturnType<typeof configuredCoordinator>,
  expectedCaseVersion: number,
  id = `urn:stadtstack:citizen-brief:${caseId}:1`,
  idempotencyKey = "synthetic:idem:citizen-brief-1",
  sourceBindings = acceptedSourceBindings(coordinator),
) {
  return coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "derive_citizen_brief_v1",
    caseId,
    actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
    expectedCaseVersion,
    idempotencyKey,
    visibility: "private_case",
    policyVersion: "case-intake-v1",
    payload: {
      brief: {
        id,
        sourceBindings,
        authorityBinding: "none",
      },
    },
  });
}

function prepareAcceptedCase() {
  const coordinator = configuredCoordinator();
  let version = intake(coordinator).caseVersion;
  for (const departmentId of departments) version = assign(coordinator, departmentId, version).caseVersion;
  for (const departmentId of departments) version = recordDraftAndReview(coordinator, departmentId, version).caseVersion;
  assert.equal(version, 26);
  version = deriveBrief(coordinator, version).caseVersion;
  assert.equal(version, 27);
  return { coordinator, version };
}

test("the configured fixture accepts exactly eight unique department assignments", () => {
  const coordinator = configuredCoordinator();
  const first = intake(coordinator);
  assert.equal(first.caseVersion, 2);
  let version = first.caseVersion;
  for (const departmentId of departments) version = assign(coordinator, departmentId, version).caseVersion;
  assert.equal(version, 10);
  const administration = projectAdministration(coordinator);
  assert.equal(administration.projection.departmentPackages?.length, 8);
  assert.deepEqual(
    administration.projection.departmentPackages?.map((item) => item.departmentId),
    [...departments].sort(),
  );
  assert.equal("reviewedCitizenBrief" in administration.projection, false);
});

test("a citizen brief derives only from eight current accepted checksum bindings and stays redacted", () => {
  const coordinator = configuredCoordinator();
  const first = intake(coordinator);
  let version = first.caseVersion;
  for (const departmentId of departments) version = assign(coordinator, departmentId, version).caseVersion;
  assert.equal(version, 10);
  for (const departmentId of departments) version = recordDraftAndReview(coordinator, departmentId, version).caseVersion;
  assert.equal(version, 26);
  const beforeDerive = projectPublic(coordinator);
  assert.equal(beforeDerive.projection.reviewedCitizenBrief, undefined);
  assert.equal(beforeDerive.projection.departmentPackages?.length, 8);
  const derive = deriveBrief(coordinator, version);
  assert.equal(derive.caseVersion, 27);
  const publicProjection = projectPublic(coordinator);
  const brief = publicProjection.projection.reviewedCitizenBrief;
  assert.ok(brief);
  assert.equal(brief.correctionState, "current");
  assert.equal(brief.responses.length, 8);
  assert.deepEqual(brief.responses.map((response) => response.departmentId), [...departments].sort());
  assert.equal(brief.authorityBinding, "none");
  assert.equal("privateEvidenceRefs" in brief, false);
  assert.equal(JSON.stringify(brief).includes("reviewerActorId"), false);
  assert.match(publicProjection.projectionChecksum, /^sha256:[0-9a-f]{64}$/);
  const councilBrief = projectCouncil(coordinator).projection.reviewedCitizenBrief;
  assert.deepEqual(councilBrief, brief);
  assert.equal(JSON.stringify(councilBrief).includes("privateEvidenceRefs"), false);
});

test("brief bindings are canonicalized, closed, and checksum-bound before append", () => {
  const coordinator = configuredCoordinator();
  let version = intake(coordinator).caseVersion;
  for (const departmentId of departments) version = assign(coordinator, departmentId, version).caseVersion;
  for (const departmentId of departments) version = recordDraftAndReview(coordinator, departmentId, version).caseVersion;
  const bindings = acceptedSourceBindings(coordinator);
  const reordered = [...bindings].reverse();
  const first = deriveBrief(coordinator, version, `urn:stadtstack:citizen-brief:${caseId}:1`, "synthetic:idem:citizen-brief-order", reordered);
  assert.equal(first.caseVersion, version + 1);
  const replay = deriveBrief(coordinator, version, `urn:stadtstack:citizen-brief:${caseId}:1`, "synthetic:idem:citizen-brief-order", bindings);
  assert.deepEqual(replay, first);

  const staleCoordinator = configuredCoordinator();
  let staleVersion = intake(staleCoordinator).caseVersion;
  for (const departmentId of departments) staleVersion = assign(staleCoordinator, departmentId, staleVersion).caseVersion;
  for (const departmentId of departments) staleVersion = recordDraftAndReview(staleCoordinator, departmentId, staleVersion).caseVersion;
  const staleBindings = acceptedSourceBindings(staleCoordinator);
  staleBindings[0] = { ...staleBindings[0]!, packageChecksum: `sha256:${"0".repeat(64)}` };
  assert.throws(
    () => deriveBrief(staleCoordinator, staleVersion, `urn:stadtstack:citizen-brief:${caseId}:1`, "synthetic:idem:citizen-brief-stale-checksum", staleBindings),
    /citizen_brief_binding_stale/,
  );
  assert.equal(projectAdministration(staleCoordinator).caseVersion, staleVersion);

  assert.throws(
    () => staleCoordinator.handle({
      schemaVersion: "command_envelope_v1",
      commandType: "derive_citizen_brief_v1",
      caseId,
      actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
      expectedCaseVersion: staleVersion,
      idempotencyKey: "synthetic:idem:citizen-brief-private",
      visibility: "private_case",
      policyVersion: "case-intake-v1",
      payload: {
        brief: {
          id: `urn:stadtstack:citizen-brief:${caseId}:1`,
          sourceBindings: acceptedSourceBindings(staleCoordinator),
          authorityBinding: "none",
          summary: "caller supplied content",
        },
      },
    } as unknown as CommandEnvelope),
    /unknown_field:brief.summary/,
  );
});

test("correction clears the accepted response, invalidates the old brief, and requires a fresh review and derivation", () => {
  const { coordinator, version } = prepareAcceptedCase();
  const oldBindings = acceptedSourceBindings(coordinator);
  const before = projectAdministration(coordinator).projection.departmentPackages?.find((item) => item.departmentId === "planning");
  assert.ok(before?.draft?.artifactChecksum);
  assert.ok(before?.review?.attestationChecksum);
  const correction = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "correct_department_draft_v1",
    caseId,
    actorBinding: { actorId: "synthetic:planning-agent", actorClass: "department_agent" },
    expectedCaseVersion: version,
    idempotencyKey: "synthetic:idem:correction-planning-1",
    visibility: "private_case",
    policyVersion: "case-intake-v1",
    payload: {
      packageId: before.id,
      packageChecksum: before.packageChecksum,
      priorDraftArtifactChecksum: before.draft.artifactChecksum,
      draft: {
        schemaVersion: "department_draft_v1",
        id: "draft-planning-2",
        publicSummary: "A raised crossing and clearer markings could reduce risk.",
        publicCitations: ["synthetic://planning/evidence-2"],
        privateEvidenceRefs: ["synthetic://planning/private-evidence-2"],
        authorityBinding: "none",
      },
    },
  });
  assert.equal(correction.caseVersion, version + 1);
  const adminAfterCorrection = projectAdministration(coordinator).projection.departmentPackages?.find((item) => item.departmentId === "planning");
  assert.equal(adminAfterCorrection?.correctionState, "corrected");
  assert.equal(adminAfterCorrection?.reviewState, "draft_pending_review");
  assert.equal(adminAfterCorrection?.review, undefined);
  const publicAfterCorrection = projectPublic(coordinator);
  assert.equal(publicAfterCorrection.projection.reviewedCitizenBrief?.correctionState, "invalidated");
  assert.equal(publicAfterCorrection.projection.reviewedCitizenBrief?.responses.length, 0);
  assert.equal(JSON.stringify(publicAfterCorrection.projection.reviewedCitizenBrief).includes("evidence-1"), false);

  assert.throws(
    () => deriveBrief(coordinator, correction.caseVersion, `urn:stadtstack:citizen-brief:${caseId}:2`, "synthetic:idem:citizen-brief-stale", oldBindings),
    /citizen_brief_review_incomplete|citizen_brief_binding_stale/,
  );

  const corrected = projectAdministration(coordinator).projection.departmentPackages?.find((item) => item.departmentId === "planning");
  assert.ok(corrected?.draft?.artifactChecksum);
  const review = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "attest_department_review_v1",
    caseId,
    actorBinding: { actorId: "synthetic:planning-reviewer", actorClass: "department_reviewer" },
    expectedCaseVersion: correction.caseVersion,
    idempotencyKey: "synthetic:idem:review-planning-2",
    visibility: "private_case",
    policyVersion: "case-intake-v1",
    payload: {
      review: {
        packageId: corrected.id,
        draftArtifactChecksum: corrected.draft.artifactChecksum,
        decision: "accepted",
        reviewedAt: "2026-08-08T00:00:05.000Z",
      },
    },
  });
  assert.equal(projectPublic(coordinator).projection.reviewedCitizenBrief?.correctionState, "invalidated");
  const freshBrief = deriveBrief(coordinator, review.caseVersion, `urn:stadtstack:citizen-brief:${caseId}:2`, "synthetic:idem:citizen-brief-2");
  assert.equal(freshBrief.caseVersion, review.caseVersion + 1);
  const current = projectPublic(coordinator).projection.reviewedCitizenBrief;
  assert.equal(current?.correctionState, "current");
  assert.equal(current?.responses.find((response) => response.departmentId === "planning")?.publicCitations[0], "synthetic://planning/evidence-2");
});

test("a checksum-identical correction still cannot revive an old brief after a fresh review", () => {
  const { coordinator, version } = prepareAcceptedCase();
  const before = projectAdministration(coordinator).projection.departmentPackages?.find((item) => item.departmentId === "planning");
  assert.ok(before?.draft?.artifactChecksum);
  const correction = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "correct_department_draft_v1",
    caseId,
    actorBinding: { actorId: "synthetic:planning-agent", actorClass: "department_agent" },
    expectedCaseVersion: version,
    idempotencyKey: "synthetic:idem:correction-planning-identical",
    visibility: "private_case",
    policyVersion: "case-intake-v1",
    payload: {
      packageId: before.id,
      packageChecksum: before.packageChecksum,
      priorDraftArtifactChecksum: before.draft.artifactChecksum,
      draft: {
        schemaVersion: "department_draft_v1",
        id: "draft-planning-1",
        publicSummary: "Reviewed planning response.",
        publicCitations: ["synthetic://planning/evidence-1"],
        privateEvidenceRefs: ["synthetic://planning/private-evidence-1"],
        authorityBinding: "none",
      },
    },
  });
  const corrected = projectAdministration(coordinator).projection.departmentPackages?.find((item) => item.departmentId === "planning");
  assert.ok(corrected?.draft?.artifactChecksum);
  const review = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "attest_department_review_v1",
    caseId,
    actorBinding: { actorId: "synthetic:planning-reviewer", actorClass: "department_reviewer" },
    expectedCaseVersion: correction.caseVersion,
    idempotencyKey: "synthetic:idem:review-planning-identical",
    visibility: "private_case",
    policyVersion: "case-intake-v1",
    payload: {
      review: {
        packageId: corrected.id,
        draftArtifactChecksum: corrected.draft.artifactChecksum,
        decision: "accepted",
        reviewedAt: "2026-08-08T00:00:05.000Z",
      },
    },
  });
  assert.equal(review.caseVersion, correction.caseVersion + 1);
  assert.equal(projectPublic(coordinator).projection.reviewedCitizenBrief?.correctionState, "invalidated");
});

test("retraction is steward-bound, checksum-bound, and leaves only an invalidated public brief skeleton", () => {
  const { coordinator, version } = prepareAcceptedCase();
  const planning = projectAdministration(coordinator).projection.departmentPackages?.find((item) => item.departmentId === "planning");
  assert.ok(planning?.draft?.artifactChecksum);
  assert.ok(planning?.review?.attestationChecksum);
  const command = {
    schemaVersion: "command_envelope_v1" as const,
    commandType: "retract_department_response_v1" as const,
    caseId,
    actorBinding: { actorId: "synthetic:steward-1" as const, actorClass: "case_steward" as const },
    expectedCaseVersion: version,
    idempotencyKey: "synthetic:idem:retract-planning-1",
    visibility: "private_case" as const,
    policyVersion: "case-intake-v1",
    payload: {
      retraction: {
        packageId: planning.id,
        packageChecksum: planning.packageChecksum,
        targetDraftArtifactChecksum: planning.draft.artifactChecksum,
        targetReviewAttestationChecksum: planning.review.attestationChecksum,
      },
    },
  };
  assert.throws(
    () => coordinator.handle({ ...command, actorBinding: { actorId: "synthetic:planning-agent", actorClass: "department_agent" }, idempotencyKey: "synthetic:idem:retract-agent" }),
    /actor_role_forbidden/,
  );
  assert.throws(
    () => coordinator.handle({
      ...command,
      idempotencyKey: "synthetic:idem:retract-wrong-target",
      payload: { retraction: { ...command.payload.retraction, targetDraftArtifactChecksum: "sha256:" + "0".repeat(64) } },
    }),
    /department_response_checksum_invalid/,
  );
  const receipt = coordinator.handle(command);
  assert.equal(receipt.caseVersion, version + 1);
  const admin = projectAdministration(coordinator).projection.departmentPackages?.find((item) => item.departmentId === "planning");
  assert.equal(admin?.correctionState, "retracted");
  assert.equal(admin?.draft, undefined);
  assert.equal(admin?.review, undefined);
  const publicProjection = projectPublic(coordinator);
  assert.equal(publicProjection.projection.reviewedCitizenBrief?.correctionState, "invalidated");
  assert.equal(publicProjection.projection.reviewedCitizenBrief?.responses.length, 0);
  assert.equal(JSON.stringify(publicProjection.projection.reviewedCitizenBrief).includes("private-evidence"), false);
  assert.equal(publicProjection.projection.departmentPackages?.some((item) => item.departmentId === "planning"), false);
});
