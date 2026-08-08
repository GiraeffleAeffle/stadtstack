import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createCivicCaseCoordinator,
  type CivicCaseCoordinatorOptions,
  type CommandEnvelope,
} from "../src/civic-case-coordinator.ts";
import { createNostrDiscussionAdapter, type DiscussionArtifact } from "../src/adapters/discussion-adapter.ts";

const scope = { municipalityId: "sample-municipality", caseId: "sample-case" };
const caseId = "urn:stadtstack:case:test:sample-municipality:018f0000-0000-7000-8000-000000000001";
const fixturePubkey = "7190b3fcc08cd9c4edb5ef541e8a578089cb8727ba93c4cfb0583e2287d57bd2";
const discussionId = "44ac22db49995e6ec96344b624d3ee01eb50ad814cf80f51af05959bb305412c";
const departments = ["planning", "traffic", "environment", "finance", "legal", "public-order", "social-affairs", "public-works"] as const;
const reviewedAt = "2026-08-08T00:00:05.000Z";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

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
    { actorId: "synthetic:participation-reviewer-1", actorClass: "participation_reviewer" as never },
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
  });
}

function project(coordinator: ReturnType<typeof configuredCoordinator>, actorId: string, actorClass: "public" | "administration" | "council", visibility: "public" | "administration" | "council") {
  return coordinator.project({
    schemaVersion: "query_envelope_v1",
    queryType: "case_projection_v1",
    caseId,
    actorBinding: { actorId, actorClass },
    visibility,
    policyVersion: "case-intake-v1",
    atCaseVersion: null,
  });
}

function recordDraftAndReview(coordinator: ReturnType<typeof configuredCoordinator>, departmentId: string, expectedCaseVersion: number) {
  const packageProjection = (project(coordinator, "synthetic:administration-1", "administration", "administration").projection as any).departmentPackages.find((item: any) => item.departmentId === departmentId);
  const draft = coordinator.handle({
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
  const draftedPackage = (project(coordinator, "synthetic:administration-1", "administration", "administration").projection as any).departmentPackages.find((item: any) => item.departmentId === departmentId);
  return coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "attest_department_review_v1",
    caseId,
    actorBinding: { actorId: `synthetic:${departmentId}-reviewer`, actorClass: "department_reviewer" },
    expectedCaseVersion: draft.caseVersion,
    idempotencyKey: `synthetic:idem:review-${departmentId}`,
    visibility: "private_case",
    policyVersion: "case-intake-v1",
    payload: {
      review: {
        packageId: draftedPackage.id,
        draftArtifactChecksum: draftedPackage.draft.artifactChecksum,
        decision: "accepted",
        reviewedAt,
      },
    },
  });
}

function acceptedCase() {
  const coordinator = configuredCoordinator();
  let version = intake(coordinator).caseVersion;
  for (const departmentId of departments) version = assign(coordinator, departmentId, version).caseVersion;
  for (const departmentId of departments) version = recordDraftAndReview(coordinator, departmentId, version).caseVersion;
  const admin = project(coordinator, "synthetic:administration-1", "administration", "administration");
  const sourceBindings = admin.projection.departmentPackages!.map((item: any) => ({
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
    policyVersion: "case-intake-v1",
    payload: {
      brief: {
        id: `urn:stadtstack:citizen-brief:${caseId}:1`,
        sourceBindings,
        authorityBinding: "none",
      },
    },
  });
  const publicProjection = project(coordinator, "synthetic:public-1", "public", "public");
  return { coordinator, derive, brief: (publicProjection.projection as any).reviewedCitizenBrief, version: derive.caseVersion };
}

function participationInput(brief: any, briefEventId: string) {
  const sourceBrief = { id: brief.id, briefChecksum: brief.briefChecksum, briefEventId };
  const aggregate = {
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
    reviewedAt,
    resultArtifactRef: "synthetic://participation/result-1",
    minorityReportRef: null,
    correctionState: "current",
  };
  const checksum = sha256({ participation: aggregate, sourceBrief, policyVersion: "case-intake-v1", actorBinding: { actorId: "synthetic:participation-reviewer-1", actorClass: "participation_reviewer" }, reviewedAt });
  return { ...aggregate, checksum };
}

function recordParticipation(
  coordinator: ReturnType<typeof configuredCoordinator>,
  brief: any,
  briefEventId: string,
  expectedCaseVersion: number,
  idempotencyKey = "synthetic:idem:participation-1",
) {
  const participation = participationInput(brief, briefEventId);
  return {
    participation,
    receipt: coordinator.handle({
      schemaVersion: "command_envelope_v1",
      commandType: "record_advisory_participation_v1",
      caseId,
      actorBinding: { actorId: "synthetic:participation-reviewer-1", actorClass: "participation_reviewer" },
      expectedCaseVersion,
      idempotencyKey,
      visibility: "private_case",
      policyVersion: "case-intake-v1",
      payload: {
        participation,
        sourceBrief: { id: brief.id, briefChecksum: brief.briefChecksum },
      },
    } as unknown as CommandEnvelope),
  };
}

function acceptedSourceBindings(coordinator: ReturnType<typeof configuredCoordinator>) {
  const admin = project(coordinator, "synthetic:administration-1", "administration", "administration").projection as any;
  return admin.departmentPackages.map((item: any) => ({
    packageId: item.id,
    packageChecksum: item.packageChecksum,
    draftArtifactChecksum: item.draft.artifactChecksum,
    reviewAttestationChecksum: item.review.attestationChecksum,
  }));
}

function correctPlanningDraft(
  coordinator: ReturnType<typeof configuredCoordinator>,
  expectedCaseVersion: number,
  id: string,
  suffix: string,
) {
  const planning = (project(coordinator, "synthetic:administration-1", "administration", "administration").projection as any)
    .departmentPackages.find((item: any) => item.departmentId === "planning");
  assert.ok(planning?.draft?.artifactChecksum);
  return coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "correct_department_draft_v1",
    caseId,
    actorBinding: { actorId: "synthetic:planning-agent", actorClass: "department_agent" },
    expectedCaseVersion,
    idempotencyKey: `synthetic:idem:participation-correction-${suffix}`,
    visibility: "private_case",
    policyVersion: "case-intake-v1",
    payload: {
      packageId: planning.id,
      packageChecksum: planning.packageChecksum,
      priorDraftArtifactChecksum: planning.draft.artifactChecksum,
      draft: {
        schemaVersion: "department_draft_v1",
        id,
        publicSummary: suffix === "identical" ? "Reviewed planning response." : `Updated planning response ${suffix}.`,
        publicCitations: [`synthetic://planning/evidence-${suffix === "identical" ? "1" : suffix}`],
        privateEvidenceRefs: [`synthetic://planning/private-evidence-${suffix === "identical" ? "1" : suffix}`],
        authorityBinding: "none",
      },
    },
  });
}

function reviewPlanningDraft(
  coordinator: ReturnType<typeof configuredCoordinator>,
  expectedCaseVersion: number,
  suffix: string,
) {
  const planning = (project(coordinator, "synthetic:administration-1", "administration", "administration").projection as any)
    .departmentPackages.find((item: any) => item.departmentId === "planning");
  assert.ok(planning?.draft?.artifactChecksum);
  return coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "attest_department_review_v1",
    caseId,
    actorBinding: { actorId: "synthetic:planning-reviewer", actorClass: "department_reviewer" },
    expectedCaseVersion,
    idempotencyKey: `synthetic:idem:participation-review-${suffix}`,
    visibility: "private_case",
    policyVersion: "case-intake-v1",
    payload: {
      review: {
        packageId: planning.id,
        draftArtifactChecksum: planning.draft.artifactChecksum,
        decision: "accepted",
        reviewedAt,
      },
    },
  });
}

function deriveFreshBrief(
  coordinator: ReturnType<typeof configuredCoordinator>,
  expectedCaseVersion: number,
  suffix: string,
) {
  return coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "derive_citizen_brief_v1",
    caseId,
    actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
    expectedCaseVersion,
    idempotencyKey: `synthetic:idem:participation-brief-${suffix}`,
    visibility: "private_case",
    policyVersion: "case-intake-v1",
    payload: {
      brief: {
        id: `urn:stadtstack:citizen-brief:${caseId}:${suffix}`,
        sourceBindings: acceptedSourceBindings(coordinator),
        authorityBinding: "none",
      },
    },
  });
}

test("a reviewed aggregate crosses as advisory and council remains a dry run", () => {
  const { coordinator, derive, brief, version } = acceptedCase();
  const { receipt } = recordParticipation(coordinator, brief, derive.eventIds[0]!, version);
  assert.equal(receipt.caseVersion, version + 1);
  const publicProjection = project(coordinator, "synthetic:public-1", "public", "public").projection as any;
  assert.equal(publicProjection.participationResult.advisory, true);
  assert.equal(publicProjection.participationResult.totalAccepted, 8);
  assert.equal(publicProjection.participationResult.authorityBinding, "none");
  assert.equal(publicProjection.formalDecision, null);
  const councilProjection = project(coordinator, "synthetic:council-1", "council", "council").projection as any;
  assert.equal(councilProjection.councilDryRunBrief.state, "dry_run_not_submitted");
  assert.equal(councilProjection.councilDryRunBrief.citizenSignal.totalAccepted, 8);
  assert.equal(councilProjection.councilDryRunBrief.councilSubmissionCreated, false);
  assert.equal(councilProjection.councilDryRunBrief.formalVoteStarted, false);
});

test("retraction is steward-only, checksum-bound, and suppresses public and council participation", () => {
  const { coordinator, derive, brief, version } = acceptedCase();
  const recorded = recordParticipation(coordinator, brief, derive.eventIds[0]!, version);
  const retraction = {
    schemaVersion: "command_envelope_v1" as const,
    commandType: "retract_advisory_participation_v1" as const,
    caseId,
    actorBinding: { actorId: "synthetic:steward-1" as const, actorClass: "case_steward" as const },
    expectedCaseVersion: recorded.receipt.caseVersion,
    idempotencyKey: "synthetic:idem:participation-retract-1",
    visibility: "private_case" as const,
    policyVersion: "case-intake-v1",
    payload: {
      retraction: {
        participationId: recorded.participation.id,
        participationChecksum: recorded.participation.checksum,
      },
    },
  };
  assert.throws(
    () => coordinator.handle({ ...retraction, actorBinding: { actorId: "synthetic:participation-reviewer-1", actorClass: "participation_reviewer" }, idempotencyKey: "synthetic:idem:participation-retract-reviewer" }),
    /actor_role_forbidden/,
  );
  assert.throws(
    () => coordinator.handle({
      ...retraction,
      idempotencyKey: "synthetic:idem:participation-retract-wrong-checksum",
      payload: { retraction: { ...retraction.payload.retraction, participationChecksum: `sha256:${"0".repeat(64)}` } },
    }),
    /participation_retraction_checksum_invalid/,
  );
  const receipt = coordinator.handle(retraction);
  assert.equal(receipt.caseVersion, recorded.receipt.caseVersion + 1);
  assert.deepEqual(coordinator.handle(retraction), receipt);
  const publicProjection = project(coordinator, "synthetic:public-1", "public", "public").projection as any;
  assert.equal(publicProjection.participationResult, undefined);
  const councilProjection = project(coordinator, "synthetic:council-1", "council", "council").projection as any;
  assert.equal(councilProjection.councilDryRunBrief.citizenSignal, null);
  const adminProjection = project(coordinator, "synthetic:administration-1", "administration", "administration").projection as any;
  assert.equal(adminProjection.participationResult.correctionState, "retracted");
  assert.equal(JSON.stringify(adminProjection.participationResult).includes("ballot"), false);
  assert.throws(
    () => coordinator.handle({ ...retraction, expectedCaseVersion: receipt.caseVersion, idempotencyKey: "synthetic:idem:participation-retract-2" }),
    /participation_already_retracted|participation_not_found/,
  );
});

test("aggregate boundary rejects raw, unknown, stale, and non-reconciling inputs without mutation", () => {
  const { coordinator, derive, brief, version } = acceptedCase();
  const participation = participationInput(brief, derive.eventIds[0]!);
  const base = {
    schemaVersion: "command_envelope_v1" as const,
    commandType: "record_advisory_participation_v1" as const,
    caseId,
    actorBinding: { actorId: "synthetic:participation-reviewer-1" as const, actorClass: "participation_reviewer" as const },
    expectedCaseVersion: version,
    idempotencyKey: "synthetic:idem:participation-negative-base",
    visibility: "private_case" as const,
    policyVersion: "case-intake-v1",
    payload: {
      participation,
      sourceBrief: { id: brief.id, briefChecksum: brief.briefChecksum },
    },
  };
  assert.throws(
    () => coordinator.handle({ ...base, idempotencyKey: "synthetic:idem:participation-unknown", payload: { ...base.payload, participation: { ...base.payload.participation, metadata: {} } } } as unknown as CommandEnvelope),
    /unknown_field:participation.metadata/,
  );
  assert.throws(
    () => coordinator.handle({ ...base, idempotencyKey: "synthetic:idem:participation-source-event", payload: { ...base.payload, sourceBrief: { ...base.payload.sourceBrief, briefEventId: "forged" } } } as unknown as CommandEnvelope),
    /unknown_field:sourceBrief.briefEventId/,
  );
  assert.throws(
    () => coordinator.handle({ ...base, idempotencyKey: "synthetic:idem:participation-raw", payload: { ...base.payload, participation: { ...base.payload.participation, resultSummary: "wallet=0xraw" } } } as unknown as CommandEnvelope),
    /raw_participation_data_forbidden|secret_material_forbidden/,
  );
  assert.throws(
    () => coordinator.handle({ ...base, idempotencyKey: "synthetic:idem:participation-reference", payload: { ...base.payload, participation: { ...base.payload.participation, resultArtifactRef: "https://outside.invalid/result" } } } as unknown as CommandEnvelope),
    /participation_reference_invalid/,
  );
  assert.throws(
    () => coordinator.handle({ ...base, idempotencyKey: "synthetic:idem:participation-count", payload: { ...base.payload, participation: { ...base.payload.participation, options: [{ ...base.payload.participation.options[0], aggregateCount: 1 }, base.payload.participation.options[1]] } } } as unknown as CommandEnvelope),
    /participation_option_count_inconsistent/,
  );
  assert.throws(
    () => coordinator.handle({ ...base, idempotencyKey: "synthetic:idem:participation-version", payload: { ...base.payload, participation: { ...base.payload.participation, contractVersion: 0 } } } as unknown as CommandEnvelope),
    /participation_version_invalid:contractVersion|participation_checksum_invalid/,
  );
  assert.throws(
    () => coordinator.handle({ ...base, idempotencyKey: "synthetic:idem:participation-time", payload: { ...base.payload, participation: { ...base.payload.participation, reviewedAt: "2026-08-08T00:00:06.000Z" } } } as unknown as CommandEnvelope),
    /participation_review_time_invalid|participation_checksum_invalid/,
  );
  assert.throws(
    () => coordinator.handle({ ...base, idempotencyKey: "synthetic:idem:participation-invalid-date", payload: { ...base.payload, participation: { ...base.payload.participation, openedAt: "2026-99-99T00:00:00Z" } } } as unknown as CommandEnvelope),
    /participation_timestamp_invalid/,
  );
  assert.throws(
    () => coordinator.handle({ ...base, idempotencyKey: "synthetic:idem:participation-eligibility", payload: { ...base.payload, participation: { ...base.payload.participation, resultSummary: "eligibility proof was supplied" } } } as unknown as CommandEnvelope),
    /raw_participation_data_forbidden|secret_material_forbidden/,
  );
  assert.throws(
    () => coordinator.handle({ ...base, actorBinding: { actorId: "synthetic:public-1", actorClass: "public" }, idempotencyKey: "synthetic:idem:participation-public" } as unknown as CommandEnvelope),
    /actor_role_forbidden/,
  );
  assert.equal(project(coordinator, "synthetic:administration-1", "administration", "administration").caseVersion, version);
  const recorded = coordinator.handle(base as unknown as CommandEnvelope);
  assert.equal(recorded.caseVersion, version + 1);
  assert.deepEqual(coordinator.handle(base as unknown as CommandEnvelope), recorded);
  assert.throws(
    () => coordinator.handle({ ...base, expectedCaseVersion: recorded.caseVersion, idempotencyKey: "synthetic:idem:participation-conflict", payload: { ...base.payload, participation: { ...base.payload.participation, resultSummary: "Changed content" } } } as unknown as CommandEnvelope),
    /participation_checksum_invalid|participation_already_recorded/,
  );
});

test("a corrected department response invalidates the bound advisory result", () => {
  const { coordinator, derive, brief, version } = acceptedCase();
  const recorded = recordParticipation(coordinator, brief, derive.eventIds[0]!, version);
  const correction = correctPlanningDraft(coordinator, recorded.receipt.caseVersion, "draft-planning-2", "changed");
  assert.equal(correction.caseVersion, recorded.receipt.caseVersion + 1);

  const publicProjection = project(coordinator, "synthetic:public-1", "public", "public").projection as any;
  assert.equal(publicProjection.participationResult, undefined);
  const councilProjection = project(coordinator, "synthetic:council-1", "council", "council").projection as any;
  assert.equal(councilProjection.councilDryRunBrief, undefined);
  const adminProjection = project(coordinator, "synthetic:administration-1", "administration", "administration").projection as any;
  assert.equal(adminProjection.participationResult.correctionState, "invalidated");
  assert.equal(adminProjection.participationResult.sourceBrief.briefEventId, derive.eventIds[0]);
});

test("a fresh checksum-identical brief event cannot revive an old participation review", () => {
  const { coordinator, derive, brief, version } = acceptedCase();
  const recorded = recordParticipation(coordinator, brief, derive.eventIds[0]!, version);
  const correction = correctPlanningDraft(coordinator, recorded.receipt.caseVersion, "draft-planning-1", "identical");
  const review = reviewPlanningDraft(coordinator, correction.caseVersion, "identical");
  const freshBrief = deriveFreshBrief(coordinator, review.caseVersion, "1");
  assert.equal(freshBrief.caseVersion, review.caseVersion + 1);

  const publicProjection = project(coordinator, "synthetic:public-1", "public", "public").projection as any;
  assert.equal(publicProjection.participationResult, undefined);
  assert.equal(publicProjection.reviewedCitizenBrief.briefChecksum, brief.briefChecksum);
  const councilProjection = project(coordinator, "synthetic:council-1", "council", "council").projection as any;
  assert.equal(councilProjection.councilDryRunBrief.citizenSignal, null);
  const adminProjection = project(coordinator, "synthetic:administration-1", "administration", "administration").projection as any;
  assert.equal(adminProjection.participationResult.correctionState, "invalidated");
  assert.notEqual(adminProjection.participationResult.sourceBrief.briefEventId, freshBrief.eventIds[0]);
});
