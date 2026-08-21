import assert from "node:assert/strict";
import test from "node:test";

import {
  CITIZEN_BRIEF_PREPARATION_NO_EFFECTS,
  assessCitizenBriefReadiness,
  prepareCitizenBriefDerivation,
} from "../../src/adapters/citizen-brief-readiness-adapter.ts";
import type {
  DepartmentPackageProjection,
  ProjectionEnvelope,
} from "../../src/civic-case-coordinator.ts";

const caseId =
  "urn:stadtstack:case:test:sample-municipality:018f0000-0000-7000-8000-000000000001";
const departments = [
  "planning",
  "traffic",
  "environment",
  "finance",
  "legal",
  "public-order",
  "social-affairs",
  "public-works",
] as const;

function digest(seed: number): string {
  return `sha256:${seed.toString(16).padStart(64, "0")}`;
}

function acceptedPackage(
  departmentId: string,
  index: number,
): DepartmentPackageProjection {
  const draftArtifactChecksum = digest(100 + index);
  return {
    schemaVersion: "department_package_projection_v1",
    id: `package-${departmentId}`,
    departmentId,
    suggestionId: "urn:stadtstack:suggestion:fixture",
    request: `Review ${departmentId}.`,
    packageChecksum: digest(10 + index),
    assignedAgentActorId: `private:${departmentId}-agent`,
    assignedReviewerActorId: `private:${departmentId}-reviewer`,
    draft: {
      schemaVersion: "department_draft_projection_v1",
      id: `draft-${departmentId}`,
      publicSummary: `Reviewed ${departmentId} response.`,
      publicCitations: [`https://stadt.example/review/${departmentId}`],
      privateEvidenceRefs: [`dms:${departmentId}:private-evidence`],
      artifactChecksum: draftArtifactChecksum,
      actorId: `private:${departmentId}-agent`,
    },
    reviewState: "accepted",
    correctionState: "current",
    review: {
      decision: "accepted",
      draftArtifactChecksum,
      reviewedAt: "2026-08-22T08:00:00.000Z",
      policyVersion: "case-intake-v1",
      attestationChecksum: digest(200 + index),
      reviewerActorId: `private:${departmentId}-reviewer`,
    },
    authorityBinding: "none",
  };
}

function projection(
  packages: DepartmentPackageProjection[] = departments.map(acceptedPackage),
): ProjectionEnvelope {
  return {
    schemaVersion: "projection_envelope_v1",
    caseId,
    caseVersion: 26,
    journalHeadChecksum: digest(300),
    projectionChecksum: digest(301),
    visibility: "administration",
    policyVersion: "case-intake-v1",
    projection: {
      schemaVersion: "case_projection_v1",
      caseId,
      jurisdiction: {
        scheme: "test",
        value: "sample-municipality",
      },
      municipalityId: "sample-municipality",
      sourceScope: {
        municipalityId: "sample-municipality",
        caseId: "sample-case",
      },
      authorityBinding: "none",
      formalDecision: null,
      discussion: {} as never,
      discussions: [],
      suggestion: {
        schemaVersion: "suggestion_projection_v1",
        id: "urn:stadtstack:suggestion:fixture",
        discussionId: "discussion-fixture",
        discussionRef: {
          type: "nostr_event",
          id: "discussion-fixture",
          ref: "nostr://event/discussion-fixture",
        },
        title: "Safer crossing",
        status: "admitted",
        admission: {
          candidateId: "candidate-fixture",
          signedEventId: "signed-fixture",
          sourceAnswerReceiptId: "receipt-fixture",
          admissionChecksum: digest(302),
          admittedByActorClass: "case_steward",
        },
        authorityBinding: "none",
        provenance: {
          type: "nostr_event",
          id: "discussion-fixture",
          ref: "nostr://event/discussion-fixture",
        },
      },
      suggestions: [],
      provenance: {} as never,
      departmentPackages: structuredClone(packages),
    },
  };
}

test("eight current accepted responses produce one redacted readiness projection", () => {
  const first = assessCitizenBriefReadiness({
    projection: projection(),
    requiredDepartmentIds: [...departments].reverse(),
  });
  const replay = assessCitizenBriefReadiness({
    projection: projection(),
    requiredDepartmentIds: [...departments].reverse(),
  });

  assert.deepEqual(replay, first);
  assert.equal(first.status, "ready_for_case_steward");
  assert.deepEqual(first.requiredDepartmentIds, [...departments].sort());
  assert.deepEqual(first.acceptedDepartmentIds, [...departments].sort());
  assert.equal(first.sourceBindings.length, 8);
  assert.deepEqual(first.effects, CITIZEN_BRIEF_PREPARATION_NO_EFFECTS);
  assert.match(first.readinessChecksum, /^sha256:[0-9a-f]{64}$/);
  assert.doesNotMatch(
    JSON.stringify(first),
    /privateEvidenceRefs|private-evidence|assignedAgentActorId|reviewerActorId/,
  );
});

test("the steward receives one deterministic command but preparation has no effects", () => {
  const input = {
    projection: projection(),
    requiredDepartmentIds: departments,
    briefId: "urn:stadtstack:citizen-brief:sample-case:1",
    preparedBy: {
      actorId: "human:case-steward-1",
      actorClass: "case_steward" as const,
    },
  };
  const first = prepareCitizenBriefDerivation(input);
  const replay = prepareCitizenBriefDerivation(structuredClone(input));

  assert.deepEqual(replay, first);
  assert.equal(first.state, "prepared_not_applied");
  assert.deepEqual(first.effects, CITIZEN_BRIEF_PREPARATION_NO_EFFECTS);
  assert.equal(first.command.commandType, "derive_citizen_brief_v1");
  assert.equal(first.command.expectedCaseVersion, 26);
  assert.equal(first.command.payload.brief.sourceBindings.length, 8);
  assert.equal(first.command.payload.brief.authorityBinding, "none");
  assert.match(first.preparationChecksum, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first.effects.publication, false);
  assert.equal(first.effects.treasuryEffect, false);
  assert.equal(input.projection.caseVersion, 26);
});

test("missing, pending and rejected departments remain explicit blockers", () => {
  const packages = departments.map(acceptedPackage);
  packages.splice(
    packages.findIndex((item) => item.departmentId === "environment"),
    1,
  );
  const planning = packages.find((item) => item.departmentId === "planning")!;
  planning.reviewState = "draft_pending_review";
  planning.review = undefined;
  const traffic = packages.find((item) => item.departmentId === "traffic")!;
  traffic.reviewState = "rejected";
  traffic.review!.decision = "rejected";
  const result = assessCitizenBriefReadiness({
    projection: projection(packages),
    requiredDepartmentIds: departments,
  });

  assert.equal(result.status, "waiting_for_department_review");
  assert.deepEqual(result.blockers, [
    { departmentId: "environment", reason: "package_missing" },
    { departmentId: "planning", reason: "review_pending" },
    { departmentId: "traffic", reason: "review_rejected" },
  ]);
  assert.equal(result.acceptedDepartmentIds.length, 5);
  assert.throws(
    () =>
      prepareCitizenBriefDerivation({
        projection: projection(packages),
        requiredDepartmentIds: departments,
        briefId: "urn:stadtstack:citizen-brief:sample-case:1",
        preparedBy: {
          actorId: "human:case-steward-1",
          actorClass: "case_steward",
        },
      }),
    /citizen_brief_not_ready/,
  );
});

test("a current brief is visible as current and cannot be prepared again", () => {
  const value = projection();
  value.projection.reviewedCitizenBrief = {
    schemaVersion: "citizen_brief_projection_v1",
    id: "urn:stadtstack:citizen-brief:sample-case:1",
    title: "Safer crossing",
    summary: "Eight reviewed responses.",
    responses: departments.map((departmentId) => ({
      departmentId,
      publicSummary: `Reviewed ${departmentId} response.`,
      publicCitations: [`https://stadt.example/review/${departmentId}`],
    })),
    provenance: {
      sourceDiscussionRef: {
        type: "nostr_event",
        id: "discussion-fixture",
        ref: "nostr://event/discussion-fixture",
      },
      suggestionId: "urn:stadtstack:suggestion:fixture",
      packageBindings: [],
    },
    briefChecksum: digest(303),
    policyVersion: "case-intake-v1",
    correctionState: "current",
    authorityBinding: "none",
  };
  const result = assessCitizenBriefReadiness({
    projection: value,
    requiredDepartmentIds: departments,
  });

  assert.equal(result.status, "citizen_brief_current");
  assert.equal(result.currentBrief?.briefChecksum, digest(303));
  assert.throws(
    () =>
      prepareCitizenBriefDerivation({
        projection: value,
        requiredDepartmentIds: departments,
        briefId: "urn:stadtstack:citizen-brief:sample-case:2",
        preparedBy: {
          actorId: "human:case-steward-1",
          actorClass: "case_steward",
        },
      }),
    /citizen_brief_already_current/,
  );
});

test("a current brief must cover the exact configured department set", () => {
  const value = projection();
  value.projection.reviewedCitizenBrief = {
    schemaVersion: "citizen_brief_projection_v1",
    id: "urn:stadtstack:citizen-brief:sample-case:1",
    title: "Safer crossing",
    summary: "Eight reviewed responses.",
    responses: departments.map((departmentId, index) => ({
      departmentId: index === departments.length - 1 ? departments[0] : departmentId,
      publicSummary: `Reviewed ${departmentId} response.`,
      publicCitations: [`https://stadt.example/review/${departmentId}`],
    })),
    provenance: {
      sourceDiscussionRef: {
        type: "nostr_event",
        id: "discussion-fixture",
        ref: "nostr://event/discussion-fixture",
      },
      suggestionId: "urn:stadtstack:suggestion:fixture",
      packageBindings: [],
    },
    briefChecksum: digest(303),
    policyVersion: "case-intake-v1",
    correctionState: "current",
    authorityBinding: "none",
  };

  assert.throws(
    () =>
      assessCitizenBriefReadiness({
        projection: value,
        requiredDepartmentIds: departments,
      }),
    /citizen_brief_readiness_current_brief_inconsistent/,
  );
});

test("unadmitted, stale-policy and unknown-field inputs fail closed", () => {
  const unadmitted = projection();
  unadmitted.projection.suggestion.status = "draft";
  assert.throws(
    () =>
      assessCitizenBriefReadiness({
        projection: unadmitted,
        requiredDepartmentIds: departments,
      }),
    /citizen_brief_readiness_projection_invalid/,
  );

  const stale = projection();
  stale.projection.departmentPackages![0]!.review!.policyVersion = "old-policy";
  assert.throws(
    () =>
      assessCitizenBriefReadiness({
        projection: stale,
        requiredDepartmentIds: departments,
      }),
    /citizen_brief_readiness_review_policy_mismatch/,
  );

  const unknown = {
    ...projection(),
    unexpected: true,
  } as unknown as ProjectionEnvelope;
  assert.throws(
    () =>
      assessCitizenBriefReadiness({
        projection: unknown,
        requiredDepartmentIds: departments,
      }),
    /citizen_brief_readiness_projection_invalid/,
  );

  assert.throws(
    () =>
      prepareCitizenBriefDerivation({
        projection: projection(),
        requiredDepartmentIds: departments,
        briefId: "urn:stadtstack:citizen-brief:sample-case:1",
        preparedBy: {
          actorId: "human:administrator-1",
          actorClass: "administration",
        },
      }),
    /citizen_brief_steward_forbidden/,
  );
});
