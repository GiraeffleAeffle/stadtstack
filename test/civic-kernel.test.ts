import assert from "node:assert/strict";
import test from "node:test";

import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";

import {
  createCivicKernel as createRawCivicKernel,
  type CivicActor,
  type CivicKernelConfig,
} from "../src/civic-kernel.ts";
import {
  createNostrDiscussionAdapter,
  STADTSTACK_E2E_FIXTURE_TAG,
} from "../src/adapters/discussion-adapter.ts";

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

const defaultKernelActors: readonly CivicActor[] = [
  { id: "citizen-1", role: "citizen" },
  { id: "npub-citizen-1", role: "citizen" },
  { id: "case-steward-1", role: "case_steward" },
  { id: "publisher-1", role: "publisher" },
  { id: "participation-reviewer-1", role: "participation_reviewer" },
  ...departments.flatMap((departmentId) => [
    { id: `${departmentId}-agent`, role: "department_agent" as const, departmentId },
    { id: `${departmentId}-reviewer`, role: "department_reviewer" as const, departmentId },
  ]),
  { id: "private-author", role: "department_agent", departmentId: "planning" },
];

function createTestKernel(
  input: Omit<CivicKernelConfig, "actors"> & { actors?: readonly CivicActor[] },
) {
  return createRawCivicKernel({
    ...input,
    actors: input.actors ?? defaultKernelActors,
  });
}

// Keep the existing test bodies concise while every fixture now receives an
// explicit immutable actor registry through the wrapper above.
const createCivicKernel = createTestKernel;

function syntheticParticipationResult(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: "participation_result_v1",
    id: "participation-result-helper",
    contractId: "synthetic:participation",
    contractVersion: 1,
    methodKind: "survey",
    methodVersion: "synthetic-survey-v1",
    ruleId: "advisory-signal",
    ruleVersion: "1",
    authorityBinding: "none",
    question: "Synthetic question",
    options: [],
    totalAccepted: 0,
    resultSummary: "Synthetic result",
    unresolvedDissent: [],
    representationAudit: {
      targetPopulationDescription: "Synthetic",
      recruitmentMethod: "Synthetic",
      samplingMethod: null,
      totalInvited: 0,
      totalStarted: 0,
      totalCompleted: 0,
      limitations: [],
    },
    limitations: [],
    openedAt: "2026-08-01T00:00:00Z",
    closedAt: "2026-08-02T00:00:00Z",
    reviewedAt: "2026-08-03T00:00:00Z",
    resultArtifactRef: "synthetic://participation/helper",
    minorityReportRef: null,
    correctionState: "current",
    checksum: "sha256:synthetic-helper",
    ...overrides,
  };
}

test("the kernel preserves verified discussion provenance without private key material", () => {
  const scope = {
    municipalityId: "sample-municipality",
    caseId: "sample-case",
  };
  const event = finalizeEvent(
    {
      kind: 1,
      created_at: 1_754_035_200,
      tags: [
        ["municipality", scope.municipalityId],
        ["case", scope.caseId],
        [...STADTSTACK_E2E_FIXTURE_TAG],
      ],
      content: "Could the crossing be made safer?",
    },
    generateSecretKey(),
  );
  const artifact = createNostrDiscussionAdapter({
    scope,
    syntheticFixtureOnly: true,
  }).normalize(event);

  const kernel = createCivicKernel({
    ...scope,
    departments: ["planning"],
  });
  kernel.dispatch({
    type: "record_discussion",
    actor: { id: "citizen-1", role: "citizen" },
    discussion: {
      id: "discussion-provenance-1",
      content: artifact.event.content,
      transport: "synthetic_nostr_fixture",
      signature:
        artifact.verificationProof.kind === "nostr_nip01"
          ? artifact.verificationProof.signature
          : "",
      provenance: artifact,
    },
  });

  const projection = kernel.project({ role: "public" });
  const retained = projection.discussions[0];
  assert.ok(retained?.provenance);
  const retainedProvenance = retained.provenance;
  assert.equal(retainedProvenance.id, artifact.id);
  assert.equal(retainedProvenance.event.id, artifact.event.id);
  assert.equal(retainedProvenance.event.pubkey, artifact.event.pubkey);
  assert.equal(retainedProvenance.sourceRef, artifact.sourceRef);
  assert.deepEqual(retainedProvenance.scope, scope);
  assert.deepEqual(retainedProvenance.verificationProof, artifact.verificationProof);
  assert.equal(retainedProvenance.authorityBinding, "none");
  assert.doesNotMatch(JSON.stringify(retained), /privateKey|secretKey|nsec1/i);
});

test("discussion provenance replay is idempotent and conflicting provenance fails closed", () => {
  const provenance = {
    id: "synthetic:fixture-provenance-replay",
    source: "synthetic_fixture" as const,
    sourceRef: "synthetic://discussion/fixture-provenance-replay",
    scope: {
      municipalityId: "sample-municipality",
      caseId: "sample-case",
    },
    authorityBinding: "none" as const,
    verificationProof: {
      kind: "synthetic_fixture" as const,
      deterministic: true as const,
      fixtureId: "fixture-provenance-replay",
    },
    event: {
      id: "synthetic:fixture-provenance-replay",
      pubkey: "synthetic-pubkey",
    },
  };
  const kernel = createCivicKernel({
    municipalityId: provenance.scope.municipalityId,
    caseId: provenance.scope.caseId,
    departments: ["planning"],
  });
  const command = {
    type: "record_discussion" as const,
    actor: { id: "citizen-1", role: "citizen" as const },
    discussion: {
      id: "discussion-provenance-replay",
      content: "A deterministic synthetic discussion.",
      transport: "synthetic_nostr_fixture" as const,
      signature: "synthetic-signature",
      provenance,
    },
  };

  kernel.dispatch(command);
  kernel.dispatch({ ...command, discussion: { ...command.discussion } });
  assert.throws(
    () =>
      kernel.dispatch({
        ...command,
        discussion: {
          ...command.discussion,
          provenance: {
            ...provenance,
            sourceRef: "synthetic://discussion/conflicting",
          },
        },
      }),
    /discussion_conflict/,
  );
  assert.equal(kernel.project({ role: "public" }).discussions.length, 1);
});

test("human submission turns signed discussion into eight review packages without authority or private leakage", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments,
  });

  kernel.dispatch({
    type: "record_discussion",
    actor: { id: "npub-citizen-1", role: "citizen" },
    discussion: {
      id: "discussion-1",
      content: "Could the Example Straße crossing be made safer?",
      transport: "synthetic_nostr_fixture",
      signature: "synthetic-signature-1",
    },
  });

  kernel.dispatch({
    type: "craft_suggestion",
    actor: { id: "npub-citizen-1", role: "citizen" },
    suggestion: {
      id: "suggestion-1",
      discussionId: "discussion-1",
      title: "Review a safer Example Straße crossing",
    },
  });

  kernel.dispatch({
    type: "submit_suggestion_for_administration",
    actor: { id: "case-steward-1", role: "case_steward" },
    suggestionId: "suggestion-1",
  });

  const administration = kernel.project({ role: "administration" });
  const publicView = kernel.project({ role: "public" });

  assert.ok(administration.departmentWorkPackages);
  const administrationPackages = administration.departmentWorkPackages;
  assert.equal(administrationPackages.length, 8);
  assert.deepEqual(
    administrationPackages.map((item) => item.departmentId),
    departments,
  );
  assert.equal(administration.formalDecision, null);
  assert.equal(administration.authorityBinding, "none");

  assert.equal(publicView.suggestions[0]?.status, "submitted_for_administration_review");
  assert.equal("departmentWorkPackages" in publicView, false);
  assert.equal(publicView.formalDecision, null);
  assert.equal(publicView.authorityBinding, "none");
});

test("the kernel requires a citizen for discussion and suggestion intake", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
  });

  assert.throws(
    () =>
      kernel.dispatch({
        type: "record_discussion",
        actor: { id: "case-steward-1", role: "case_steward" },
        discussion: {
          id: "discussion-role-bypass",
          content: "A discussion submitted by the wrong role.",
          transport: "synthetic_nostr_fixture",
          signature: "synthetic-signature",
        },
      }),
    /citizen_required/,
  );

  assert.throws(
    () =>
      kernel.dispatch({
        type: "craft_suggestion",
        actor: { id: "case-steward-1", role: "case_steward" },
        suggestion: {
          id: "suggestion-role-bypass",
          discussionId: "missing-discussion",
          title: "A suggestion submitted by the wrong role.",
        },
      }),
    /citizen_required/,
  );
});

test("kernel actor envelopes reject unknown fields, invalid roles, and cross-role departments", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
  });
  const discussion = {
    id: "discussion-actor-envelope",
    content: "An actor envelope must be exact.",
    transport: "synthetic_nostr_fixture" as const,
    signature: "synthetic-signature",
  };

  assert.throws(
    () =>
      kernel.dispatch({
        type: "record_discussion",
        actor: { id: "citizen-1", role: "citizen", extra: "bypass" } as never,
        discussion,
      }),
    /civic_actor_field_forbidden:extra/,
  );
  assert.throws(
    () =>
      kernel.dispatch({
        type: "record_discussion",
        actor: { id: "citizen-1", role: "citizen", departmentId: "planning" },
        discussion,
      }),
    /civic_actor_department_forbidden/,
  );
  assert.throws(
    () =>
      kernel.dispatch({
        type: "record_discussion",
        actor: { id: "unknown-role", role: "administrator" } as never,
        discussion,
      }),
    /civic_actor_role_invalid/,
  );
  assert.throws(
    () =>
      kernel.dispatch({
        type: "record_department_response",
        actor: { id: "evil", role: "department_agent", departmentId: "planning" },
        workPackageId: "missing-package",
        response: { summary: "Impersonated response.", citations: ["synthetic://evil"] },
      }),
    /civic_actor_not_registered/,
  );
});

test("department responses are scoped and reviewer authorship stays internal", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
  });
  kernel.dispatch({
    type: "record_discussion",
    actor: { id: "citizen-1", role: "citizen" },
    discussion: {
      id: "discussion-department-scope",
      content: "Please review the crossing.",
      transport: "synthetic_nostr_fixture",
      signature: "synthetic-signature",
    },
  });
  kernel.dispatch({
    type: "craft_suggestion",
    actor: { id: "citizen-1", role: "citizen" },
    suggestion: {
      id: "suggestion-department-scope",
      discussionId: "discussion-department-scope",
      title: "Review the crossing",
    },
  });
  kernel.dispatch({
    type: "submit_suggestion_for_administration",
    actor: { id: "case-steward-1", role: "case_steward" },
    suggestionId: "suggestion-department-scope",
  });
  const workPackageId = "suggestion-department-scope:planning";

  assert.throws(
    () =>
      kernel.dispatch({
        type: "record_department_response",
        actor: { id: "traffic-agent", role: "department_agent", departmentId: "traffic" },
        workPackageId,
        response: { summary: "Wrong department.", citations: ["synthetic://wrong"] },
      }),
    /department_actor_scope_mismatch/,
  );

  kernel.dispatch({
    type: "record_department_response",
    actor: { id: "private-author", role: "department_agent", departmentId: "planning" },
    workPackageId,
    response: {
      summary: "Planning assessment.",
      citations: ["synthetic://planning/assessment"],
    },
  });

  assert.throws(
    () =>
      kernel.dispatch({
        type: "review_department_response",
        actor: { id: "traffic-reviewer", role: "department_reviewer", departmentId: "traffic" },
        workPackageId,
      }),
    /department_reviewer_scope_mismatch/,
  );
  assert.throws(
    () =>
      kernel.dispatch({
        type: "review_department_response",
        actor: { id: "private-author", role: "department_reviewer", departmentId: "planning" },
        workPackageId,
      }),
    /civic_actor_binding_mismatch/,
  );

  kernel.dispatch({
    type: "review_department_response",
    actor: { id: "planning-reviewer", role: "department_reviewer", departmentId: "planning" },
    workPackageId,
  });
  const administration = kernel.project({ role: "administration" });
  const council = kernel.project({ role: "council" });
  const publicView = kernel.project({ role: "public" });
  assert.equal(administration.departmentWorkPackages?.[0]?.response?.status, "reviewed");
  assert.doesNotMatch(JSON.stringify(administration), /private-author/);
  assert.doesNotMatch(JSON.stringify(council), /private-author/);
  assert.doesNotMatch(JSON.stringify(publicView), /private-author/);
  assert.doesNotMatch(JSON.stringify(publicView), /civic_actor_registry|departmentId/);
});

test("recording a discussion is idempotent for identical replays and rejects same-ID conflicts", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
  });
  const command = {
    type: "record_discussion" as const,
    actor: { id: "npub-citizen-1", role: "citizen" as const },
    discussion: {
      id: "discussion-replay-1",
      content: "Could the crossing be made safer?",
      transport: "synthetic_nostr_fixture" as const,
      signature: "synthetic-signature-1",
    },
  };

  kernel.dispatch(command);
  kernel.dispatch({
    ...command,
    discussion: { ...command.discussion },
  });

  assert.throws(
    () =>
      kernel.dispatch({
        ...command,
        discussion: {
          ...command.discussion,
          content: "Conflicting replacement content.",
        },
      }),
    /discussion_conflict/,
  );
  assert.throws(
    () =>
      kernel.dispatch({
        ...command,
        discussion: {
          ...command.discussion,
          signature: "different-signature",
        },
      }),
    /discussion_conflict/,
  );
});

test("an unreviewed department answer stays private", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments,
  });

  kernel.dispatch({
    type: "record_discussion",
    actor: { id: "npub-citizen-1", role: "citizen" },
    discussion: {
      id: "discussion-1",
      content: "Could the Example Straße crossing be made safer?",
      transport: "synthetic_nostr_fixture",
      signature: "synthetic-signature-1",
    },
  });
  kernel.dispatch({
    type: "craft_suggestion",
    actor: { id: "npub-citizen-1", role: "citizen" },
    suggestion: {
      id: "suggestion-1",
      discussionId: "discussion-1",
      title: "Review a safer Example Straße crossing",
    },
  });
  kernel.dispatch({
    type: "submit_suggestion_for_administration",
    actor: { id: "case-steward-1", role: "case_steward" },
    suggestionId: "suggestion-1",
  });
  kernel.dispatch({
    type: "record_department_response",
    actor: { id: "planning-agent", role: "department_agent", departmentId: "planning" },
    workPackageId: "suggestion-1:planning",
    response: {
      summary: "A traffic count and sight-line survey are required.",
      citations: ["synthetic://planning/sight-line-review"],
    },
  });

  const administration = kernel.project({ role: "administration" });
  const publicView = kernel.project({ role: "public" });
  const planningPackage = administration.departmentWorkPackages?.find(
    (item) => item.departmentId === "planning",
  );

  assert.equal(planningPackage?.response?.status, "pending_review");
  assert.equal(
    JSON.stringify(publicView).includes("traffic count and sight-line survey"),
    false,
  );
  assert.equal("departmentWorkPackages" in publicView, false);
});

test("a public citizen brief requires all eight reviewed department answers and a publisher", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments,
  });

  kernel.dispatch({
    type: "record_discussion",
    actor: { id: "npub-citizen-1", role: "citizen" },
    discussion: {
      id: "discussion-1",
      content: "Could the Example Straße crossing be made safer?",
      transport: "synthetic_nostr_fixture",
      signature: "synthetic-signature-1",
    },
  });
  kernel.dispatch({
    type: "craft_suggestion",
    actor: { id: "npub-citizen-1", role: "citizen" },
    suggestion: {
      id: "suggestion-1",
      discussionId: "discussion-1",
      title: "Review a safer Example Straße crossing",
    },
  });
  kernel.dispatch({
    type: "submit_suggestion_for_administration",
    actor: { id: "case-steward-1", role: "case_steward" },
    suggestionId: "suggestion-1",
  });

  assert.throws(
    () =>
      kernel.dispatch({
        type: "publish_reviewed_citizen_brief",
        actor: { id: "publisher-1", role: "publisher" },
        summary: "The suggestion has been reviewed by all departments.",
      }),
    /all_department_responses_must_be_reviewed/,
  );

  for (const departmentId of departments) {
    const workPackageId = `suggestion-1:${departmentId}`;
    kernel.dispatch({
      type: "record_department_response",
      actor: { id: `${departmentId}-agent`, role: "department_agent", departmentId },
      workPackageId,
      response: {
        summary: `${departmentId} supplied its subject-specific assessment.`,
        citations: [`synthetic://${departmentId}/review`],
      },
    });
    kernel.dispatch({
      type: "review_department_response",
      actor: { id: `${departmentId}-reviewer`, role: "department_reviewer", departmentId },
      workPackageId,
    });
  }

  kernel.dispatch({
    type: "publish_reviewed_citizen_brief",
    actor: { id: "publisher-1", role: "publisher" },
    summary: "The suggestion has been reviewed by all departments.",
  });

  const publicView = kernel.project({ role: "public" });

  assert.equal(
    publicView.reviewedCitizenBrief?.summary,
    "The suggestion has been reviewed by all departments.",
  );
  assert.equal(publicView.reviewedCitizenBrief?.citations.length, 8);
  assert.equal(publicView.formalDecision, null);
  assert.equal(publicView.authorityBinding, "none");
});

test("a reviewed participation result crosses the kernel as an aggregate only", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments,
  });

  kernel.dispatch({
    type: "record_participation_result",
    actor: { id: "participation-reviewer-1", role: "participation_reviewer" },
    result: {
      schemaVersion: "participation_result_v1",
      id: "participation-result-1",
      contractId: "synthetic:Example:crossing",
      contractVersion: 1,
      methodKind: "survey",
      methodVersion: "synthetic-survey-v1",
      ruleId: "advisory-signal",
      ruleVersion: "1",
      authorityBinding: "none",
      question: "Which safety improvement should be reviewed first?",
      options: [
        { optionId: "safer-crossing", label: "Safer crossing", aggregateCount: 6 },
        { optionId: "better-lighting", label: "Better lighting", aggregateCount: 2 },
      ],
      totalAccepted: 8,
      resultSummary: "A safer crossing was the strongest advisory signal.",
      unresolvedDissent: ["Lighting remains important to some participants."],
      representationAudit: {
        targetPopulationDescription: "Residents near the crossing",
        recruitmentMethod: "synthetic opt-in",
        samplingMethod: "voluntary response",
        totalInvited: null,
        totalStarted: 8,
        totalCompleted: 8,
        limitations: ["Synthetic data; not representative."],
      },
      limitations: ["Advisory signal only."],
      openedAt: "2026-08-01T00:00:00Z",
      closedAt: "2026-08-02T00:00:00Z",
      reviewedAt: "2026-08-03T00:00:00Z",
      resultArtifactRef: "synthetic://participation/result-1",
      minorityReportRef: null,
      correctionState: "current",
      checksum: "sha256:synthetic-participation-1",
    },
  });

  const publicView = kernel.project({ role: "public" });
  assert.equal(publicView.participationResult?.totalAccepted, 8);
  assert.equal(publicView.participationResult?.options[0]?.aggregateCount, 6);
  assert.equal(publicView.participationResult?.authorityBinding, "none");
  assert.doesNotMatch(
    JSON.stringify(publicView.participationResult),
    /ballot|wallet|npub|participantId|userId/i,
  );
});

test("the participation boundary rejects raw ballot or identity fields", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments,
  });

  assert.throws(
    () =>
      kernel.dispatch({
        type: "record_participation_result",
        actor: { id: "participation-reviewer-1", role: "participation_reviewer" },
        result: {
          schemaVersion: "participation_result_v1",
          id: "participation-result-raw",
          contractId: "synthetic:raw",
          contractVersion: 1,
          methodKind: "survey",
          methodVersion: "synthetic-survey-v1",
          ruleId: "advisory-signal",
          ruleVersion: "1",
          authorityBinding: "none",
          question: "Synthetic question",
          options: [],
          totalAccepted: 0,
          resultSummary: "Synthetic result",
          unresolvedDissent: [],
          representationAudit: {
            targetPopulationDescription: "Synthetic",
            recruitmentMethod: "Synthetic",
            samplingMethod: null,
            totalInvited: null,
            totalStarted: 0,
            totalCompleted: 0,
            limitations: [],
          },
          limitations: [],
          openedAt: "2026-08-01T00:00:00Z",
          closedAt: "2026-08-02T00:00:00Z",
          reviewedAt: "2026-08-03T00:00:00Z",
          resultArtifactRef: "synthetic://participation/raw",
          minorityReportRef: null,
          correctionState: "current",
          checksum: "sha256:synthetic-raw",
          rawBallots: [{ walletAddress: "0xraw" }],
        },
      } as never),
    /raw_participation_data_forbidden/,
  );
});

test("the participation boundary rejects obvious raw identity markers in every aggregate value slot", () => {
  const reviewer = {
    id: "participation-reviewer-1",
    role: "participation_reviewer" as const,
  };
  const valueCases: Array<{
    name: string;
    marker: string;
    mutate: (result: Record<string, unknown>, marker: string) => void;
  }> = [
    {
      name: "question",
      marker: "Which option was submitted by npub1leaked-identity?",
      mutate: (result, marker) => {
        result.question = marker;
      },
    },
    {
      name: "option label",
      marker: "Option tied to nsec1leaked-identity",
      mutate: (result, marker) => {
        result.options = [{ optionId: "option-1", label: marker, aggregateCount: 0 }];
      },
    },
    {
      name: "unresolved dissent",
      marker: "Dissent reference participantId=participant-123",
      mutate: (result, marker) => {
        result.unresolvedDissent = [marker];
      },
    },
    {
      name: "representation audit",
      marker: "Audit note userId: user-123",
      mutate: (result, marker) => {
        result.representationAudit = {
          ...(result.representationAudit as Record<string, unknown>),
          recruitmentMethod: marker,
        };
      },
    },
    {
      name: "limitations",
      marker: "Limitation identity=resident-123",
      mutate: (result, marker) => {
        result.limitations = [marker];
      },
    },
    {
      name: "artifact reference",
      marker: `synthetic://review/0x${"a".repeat(40)}`,
      mutate: (result, marker) => {
        result.resultArtifactRef = marker;
      },
    },
    {
      name: "minority report reference",
      marker: "synthetic://review/ballot:ballot-123",
      mutate: (result, marker) => {
        result.minorityReportRef = marker;
      },
    },
    {
      name: "nested audit limitation",
      marker: "Audit wallet=wallet-123",
      mutate: (result, marker) => {
        result.representationAudit = {
          ...(result.representationAudit as Record<string, unknown>),
          limitations: [marker],
        };
      },
    },
  ];

  for (const [index, valueCase] of valueCases.entries()) {
    const result = syntheticParticipationResult({
      id: `participation-result-value-marker-${index}`,
    });
    valueCase.mutate(result, valueCase.marker);
    assert.throws(
      () =>
        createCivicKernel({
          municipalityId: "sample-municipality",
          caseId: "sample-case",
          departments: ["planning"],
        }).dispatch({
          type: "record_participation_result",
          actor: reviewer,
          result: result as never,
        }),
      /raw_participation_value_forbidden/,
      valueCase.name,
    );
  }
});

test("the bootstrap value guard allows neutral civic prose and citations", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
  });

  kernel.dispatch({
    type: "record_participation_result",
    actor: { id: "participation-reviewer-1", role: "participation_reviewer" },
    result: syntheticParticipationResult({
      question: "Which crossing option should be reviewed?",
      resultSummary: "Identity-aware access policy is discussed in the public brief.",
      unresolvedDissent: ["Some residents prefer more lighting and wallet access information."],
      representationAudit: {
        targetPopulationDescription: "Residents near the crossing",
        recruitmentMethod: "Open civic invitation",
        samplingMethod: "Voluntary response",
        totalInvited: 0,
        totalStarted: 0,
        totalCompleted: 0,
        limitations: ["Synthetic fixture; representativeness is limited."],
      },
      limitations: ["See citation synthetic://participation/neutral-citation."],
      resultArtifactRef: "synthetic://participation/neutral-citation",
    }) as never,
  });

  assert.equal(
    kernel.project({ role: "public" }).participationResult?.resultSummary,
    "Identity-aware access policy is discussed in the public brief.",
  );
});

test("participation result replay is idempotent and conflicting replacement is rejected", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
  });
  const reviewer = {
    id: "participation-reviewer-1",
    role: "participation_reviewer" as const,
  };
  const result = syntheticParticipationResult({
    id: "participation-result-replay",
  });

  kernel.dispatch({
    type: "record_participation_result",
    actor: reviewer,
    result: result as never,
  });
  kernel.dispatch({
    type: "record_participation_result",
    actor: reviewer,
    result: { ...result } as never,
  });
  assert.equal(
    kernel.project({ role: "public" }).participationResult?.checksum,
    "sha256:synthetic-helper",
  );

  assert.throws(
    () =>
      kernel.dispatch({
        type: "record_participation_result",
        actor: reviewer,
        result: syntheticParticipationResult({
          id: "participation-result-replay",
          resultSummary: "Conflicting replacement payload",
          checksum: "sha256:synthetic-conflict",
        }) as never,
      }),
    /participation_result_conflict/,
  );
  assert.throws(
    () =>
      kernel.dispatch({
        type: "record_participation_result",
        actor: reviewer,
        result: syntheticParticipationResult({
          id: "participation-result-second",
        }) as never,
      }),
    /participation_result_conflict/,
  );
  assert.equal(
    kernel.project({ role: "public" }).participationResult?.id,
    "participation-result-replay",
  );
});

test("participation results reject unknown top-level and nested fields", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
  });

  assert.throws(
    () =>
      kernel.dispatch({
        type: "record_participation_result",
        actor: { id: "participation-reviewer-1", role: "participation_reviewer" },
        result: syntheticParticipationResult({
          metadata: { participants: ["npub-secret"] },
        }) as never,
      }),
    /participation_result_field_forbidden/,
  );

  assert.throws(
    () =>
      kernel.dispatch({
        type: "record_participation_result",
        actor: { id: "participation-reviewer-1", role: "participation_reviewer" },
        result: syntheticParticipationResult({
          representationAudit: {
            targetPopulationDescription: "Synthetic",
            recruitmentMethod: "Synthetic",
            samplingMethod: null,
            totalInvited: 0,
            totalStarted: 0,
            totalCompleted: 0,
            limitations: [],
            metadata: { participants: ["npub-secret"] },
          },
        }) as never,
      }),
    /participation_result_field_forbidden/,
  );
});

test("participation validation fails closed on cyclic input", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
  });
  const cyclic = syntheticParticipationResult();
  cyclic.metadata = cyclic;

  assert.throws(
    () =>
      kernel.dispatch({
        type: "record_participation_result",
        actor: { id: "participation-reviewer-1", role: "participation_reviewer" },
        result: cyclic as never,
      }),
    /participation_result_field_forbidden|participation_result_cycle/,
  );
});

test("recording a participation result requires a participation reviewer actor", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
  });
  const result = {
    schemaVersion: "participation_result_v1" as const,
    id: "participation-result-actor",
    contractId: "synthetic:participation",
    contractVersion: 1,
    methodKind: "survey",
    methodVersion: "synthetic-survey-v1",
    ruleId: "advisory-signal",
    ruleVersion: "1",
    authorityBinding: "none" as const,
    question: "Synthetic question",
    options: [],
    totalAccepted: 0,
    resultSummary: "Synthetic result",
    unresolvedDissent: [],
    representationAudit: {
      targetPopulationDescription: "Synthetic",
      recruitmentMethod: "Synthetic",
      samplingMethod: null,
      totalInvited: null,
      totalStarted: 0,
      totalCompleted: 0,
      limitations: [],
    },
    limitations: [],
    openedAt: "2026-08-01T00:00:00Z",
    closedAt: "2026-08-02T00:00:00Z",
    reviewedAt: "2026-08-03T00:00:00Z",
    resultArtifactRef: "synthetic://participation/actor",
    minorityReportRef: null,
    correctionState: "current" as const,
    checksum: "sha256:synthetic-actor",
  };

  assert.throws(
    () => kernel.dispatch({ type: "record_participation_result", result } as never),
    /participation_reviewer_required/,
  );
});

test("participation representation counts must be nonnegative and internally consistent", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
  });
  const result = {
    schemaVersion: "participation_result_v1" as const,
    id: "participation-result-counts",
    contractId: "synthetic:participation",
    contractVersion: 1,
    methodKind: "survey",
    methodVersion: "synthetic-survey-v1",
    ruleId: "advisory-signal",
    ruleVersion: "1",
    authorityBinding: "none" as const,
    question: "Synthetic question",
    options: [],
    totalAccepted: 1,
    resultSummary: "Synthetic result",
    unresolvedDissent: [],
    representationAudit: {
      targetPopulationDescription: "Synthetic",
      recruitmentMethod: "Synthetic",
      samplingMethod: null,
      totalInvited: 1,
      totalStarted: 1,
      totalCompleted: 2,
      limitations: [],
    },
    limitations: [],
    openedAt: "2026-08-01T00:00:00Z",
    closedAt: "2026-08-02T00:00:00Z",
    reviewedAt: "2026-08-03T00:00:00Z",
    resultArtifactRef: "synthetic://participation/counts",
    minorityReportRef: null,
    correctionState: "current" as const,
    checksum: "sha256:synthetic-counts",
  };

  assert.throws(
    () =>
      kernel.dispatch({
        type: "record_participation_result",
        actor: { id: "participation-reviewer-1", role: "participation_reviewer" },
        result,
      }),
    /representation_count_inconsistent/,
  );
});

test("participation results require nonempty timestamps", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
  });

  assert.throws(
    () =>
      kernel.dispatch({
        type: "record_participation_result",
        actor: { id: "participation-reviewer-1", role: "participation_reviewer" },
        result: syntheticParticipationResult({ openedAt: "" }) as never,
      }),
    /participation_timestamp_required/,
  );
});

test("participation result timestamps follow opened, closed, reviewed order", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
  });

  assert.throws(
    () =>
      kernel.dispatch({
        type: "record_participation_result",
        actor: { id: "participation-reviewer-1", role: "participation_reviewer" },
        result: syntheticParticipationResult({
          openedAt: "2026-08-03T00:00:00Z",
          closedAt: "2026-08-02T00:00:00Z",
          reviewedAt: "2026-08-04T00:00:00Z",
        }) as never,
      }),
    /participation_timestamp_order_invalid/,
  );
});

test("participation results require a checksum", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
  });

  assert.throws(
    () =>
      kernel.dispatch({
        type: "record_participation_result",
        actor: { id: "participation-reviewer-1", role: "participation_reviewer" },
        result: syntheticParticipationResult({ checksum: "" }) as never,
      }),
    /participation_checksum_required/,
  );
});

test("participation result options have unique option identifiers", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
  });

  assert.throws(
    () =>
      kernel.dispatch({
        type: "record_participation_result",
        actor: { id: "participation-reviewer-1", role: "participation_reviewer" },
        result: syntheticParticipationResult({
          totalAccepted: 1,
          representationAudit: {
            targetPopulationDescription: "Synthetic",
            recruitmentMethod: "Synthetic",
            samplingMethod: null,
            totalInvited: 1,
            totalStarted: 1,
            totalCompleted: 1,
            limitations: [],
          },
          options: [
            { optionId: "safer-crossing", label: "Safer crossing", aggregateCount: 1 },
            { optionId: "safer-crossing", label: "Duplicate", aggregateCount: 0 },
          ],
        }) as never,
      }),
    /participation_option_duplicate/,
  );
});

test("participation option aggregates must reconcile with accepted count", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
  });

  assert.throws(
    () =>
      kernel.dispatch({
        type: "record_participation_result",
        actor: { id: "participation-reviewer-1", role: "participation_reviewer" },
        result: syntheticParticipationResult({
          totalAccepted: 2,
          representationAudit: {
            targetPopulationDescription: "Synthetic",
            recruitmentMethod: "Synthetic",
            samplingMethod: null,
            totalInvited: 2,
            totalStarted: 2,
            totalCompleted: 2,
            limitations: [],
          },
          options: [
            { optionId: "safer-crossing", label: "Safer crossing", aggregateCount: 1 },
          ],
        }) as never,
      }),
    /participation_option_count_inconsistent/,
  );
});

test("retracted participation results are suppressed from the public projection", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
  });

  kernel.dispatch({
    type: "record_participation_result",
    actor: { id: "participation-reviewer-1", role: "participation_reviewer" },
    result: syntheticParticipationResult({
      correctionState: "retracted",
    }) as never,
  });

  const administration = kernel.project({ role: "administration" });
  const council = kernel.project({ role: "council" });
  const publicView = kernel.project({ role: "public" });
  assert.equal(administration.participationResult?.correctionState, "retracted");
  // Protected roles retain the correction tombstone for audit/context; only
  // the public projection suppresses the retracted aggregate.
  assert.equal(council.participationResult?.correctionState, "retracted");
  assert.equal(publicView.participationResult, undefined);
});

test("a new department response invalidates a previously reviewed citizen brief", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
  });
  kernel.dispatch({
    type: "record_discussion",
    actor: { id: "npub-citizen-1", role: "citizen" },
    discussion: {
      id: "discussion-1",
      content: "Could the crossing be made safer?",
      transport: "synthetic_nostr_fixture",
      signature: "synthetic-signature-1",
    },
  });
  kernel.dispatch({
    type: "craft_suggestion",
    actor: { id: "npub-citizen-1", role: "citizen" },
    suggestion: {
      id: "suggestion-1",
      discussionId: "discussion-1",
      title: "Review the crossing",
    },
  });
  kernel.dispatch({
    type: "submit_suggestion_for_administration",
    actor: { id: "case-steward-1", role: "case_steward" },
    suggestionId: "suggestion-1",
  });
  const workPackageId = "suggestion-1:planning";
  kernel.dispatch({
    type: "record_department_response",
    actor: { id: "planning-agent", role: "department_agent", departmentId: "planning" },
    workPackageId,
    response: {
      summary: "Initial reviewed response.",
      citations: ["synthetic://planning/initial"],
    },
  });
  kernel.dispatch({
    type: "review_department_response",
    actor: { id: "planning-reviewer", role: "department_reviewer", departmentId: "planning" },
    workPackageId,
  });
  kernel.dispatch({
    type: "publish_reviewed_citizen_brief",
    actor: { id: "publisher-1", role: "publisher" },
    summary: "Initial reviewed citizen brief.",
  });

  kernel.dispatch({
    type: "record_department_response",
    actor: { id: "planning-agent", role: "department_agent", departmentId: "planning" },
    workPackageId,
    response: {
      summary: "Updated response awaiting review.",
      citations: ["synthetic://planning/updated"],
    },
  });

  const administration = kernel.project({ role: "administration" });
  const publicView = kernel.project({ role: "public" });
  assert.equal(
    administration.departmentWorkPackages?.[0]?.response?.status,
    "pending_review",
  );
  assert.equal(
    administration.departmentWorkPackages?.[0]?.response?.summary,
    "Updated response awaiting review.",
  );
  assert.equal(publicView.reviewedCitizenBrief, undefined);
});

test("administration projections deep-clone department responses and citations", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
  });

  kernel.dispatch({
    type: "record_discussion",
    actor: { id: "npub-citizen-1", role: "citizen" },
    discussion: {
      id: "discussion-1",
      content: "Could the crossing be made safer?",
      transport: "synthetic_nostr_fixture",
      signature: "synthetic-signature-1",
    },
  });
  kernel.dispatch({
    type: "craft_suggestion",
    actor: { id: "npub-citizen-1", role: "citizen" },
    suggestion: {
      id: "suggestion-1",
      discussionId: "discussion-1",
      title: "Review the crossing",
    },
  });
  kernel.dispatch({
    type: "submit_suggestion_for_administration",
    actor: { id: "case-steward-1", role: "case_steward" },
    suggestionId: "suggestion-1",
  });
  kernel.dispatch({
    type: "record_department_response",
    actor: { id: "planning-agent", role: "department_agent", departmentId: "planning" },
    workPackageId: "suggestion-1:planning",
    response: {
      summary: "A sight-line survey is required.",
      citations: ["synthetic://planning/review"],
    },
  });

  const first = kernel.project({ role: "administration" });
  const response = first.departmentWorkPackages?.[0]?.response;
  assert.ok(response);
  response.summary = "tampered summary";
  response.citations.push("synthetic://tampered");

  const second = kernel.project({ role: "administration" });
  assert.equal(
    second.departmentWorkPackages?.[0]?.response?.summary,
    "A sight-line survey is required.",
  );
  assert.deepEqual(second.departmentWorkPackages?.[0]?.response?.citations, [
    "synthetic://planning/review",
  ]);
});

test("repeated suggestion submission is idempotent", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning", "traffic"],
  });

  kernel.dispatch({
    type: "record_discussion",
    actor: { id: "npub-citizen-1", role: "citizen" },
    discussion: {
      id: "discussion-1",
      content: "Could the crossing be made safer?",
      transport: "synthetic_nostr_fixture",
      signature: "synthetic-signature-1",
    },
  });
  kernel.dispatch({
    type: "craft_suggestion",
    actor: { id: "npub-citizen-1", role: "citizen" },
    suggestion: {
      id: "suggestion-1",
      discussionId: "discussion-1",
      title: "Review the crossing",
    },
  });

  const command = {
    type: "submit_suggestion_for_administration" as const,
    actor: { id: "case-steward-1", role: "case_steward" as const },
    suggestionId: "suggestion-1",
  };
  kernel.dispatch(command);
  kernel.dispatch(command);

  const administration = kernel.project({ role: "administration" });
  assert.equal(administration.departmentWorkPackages?.length, 2);
  assert.deepEqual(
    administration.departmentWorkPackages?.map((item) => item.id),
    ["suggestion-1:planning", "suggestion-1:traffic"],
  );
});

test("replaying a crafted suggestion cannot regress status or duplicate work packages", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
  });
  kernel.dispatch({
    type: "record_discussion",
    actor: { id: "npub-citizen-1", role: "citizen" },
    discussion: {
      id: "discussion-1",
      content: "Could the crossing be made safer?",
      transport: "synthetic_nostr_fixture",
      signature: "synthetic-signature-1",
    },
  });
  const craft = {
    type: "craft_suggestion" as const,
    actor: { id: "npub-citizen-1", role: "citizen" as const },
    suggestion: {
      id: "suggestion-1",
      discussionId: "discussion-1",
      title: "Review the crossing",
    },
  };
  kernel.dispatch(craft);
  kernel.dispatch({
    type: "submit_suggestion_for_administration",
    actor: { id: "case-steward-1", role: "case_steward" },
    suggestionId: "suggestion-1",
  });
  kernel.dispatch(craft);

  const administration = kernel.project({ role: "administration" });
  assert.equal(administration.departmentWorkPackages?.length, 1);
  assert.equal(administration.suggestions[0]?.status, "submitted_for_administration_review");
  assert.throws(
    () =>
      kernel.dispatch({
        ...craft,
        suggestion: { ...craft.suggestion, title: "Conflicting title" },
      }),
    /suggestion_conflict/,
  );
});

test("kernel construction rejects empty or duplicate municipality departments", () => {
  assert.throws(
    () =>
      createCivicKernel({
        municipalityId: "",
        caseId: "sample-case",
        departments: ["planning"],
      }),
    /municipality_id_required/,
  );
  assert.throws(
    () =>
      createCivicKernel({
        municipalityId: "sample-municipality",
        caseId: "sample-case",
        departments: [],
      }),
    /departments_required/,
  );
  assert.throws(
    () =>
      createCivicKernel({
        municipalityId: "sample-municipality",
        caseId: "sample-case",
        departments: ["planning", "planning"],
      }),
    /departments_unique/,
  );
  assert.throws(
    () =>
      createCivicKernel({
        municipalityId: "sample-municipality",
        caseId: "sample-case",
        departments: ["planning", ""],
      }),
    /department_id_required/,
  );
});

test("kernel snapshots departments so caller mutation cannot add work packages", () => {
  const departments = ["planning"];
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments,
  });
  departments.push("traffic");

  kernel.dispatch({
    type: "record_discussion",
    actor: { id: "npub-citizen-1", role: "citizen" },
    discussion: {
      id: "discussion-1",
      content: "Could the crossing be made safer?",
      transport: "synthetic_nostr_fixture",
      signature: "synthetic-signature-1",
    },
  });
  kernel.dispatch({
    type: "craft_suggestion",
    actor: { id: "npub-citizen-1", role: "citizen" },
    suggestion: {
      id: "suggestion-1",
      discussionId: "discussion-1",
      title: "Review the crossing",
    },
  });
  kernel.dispatch({
    type: "submit_suggestion_for_administration",
    actor: { id: "case-steward-1", role: "case_steward" },
    suggestionId: "suggestion-1",
  });

  const administration = kernel.project({ role: "administration" });
  assert.deepEqual(
    administration.departmentWorkPackages?.map((item) => item.departmentId),
    ["planning"],
  );
});

test("kernel projections reject an unknown viewer role", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
  });

  assert.throws(
    () => kernel.project({ role: "auditor" } as never),
    /viewer_role_invalid/,
  );
});

test("a council brief is a review-bound dry run with no submission or vote", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
  });

  kernel.dispatch({
    type: "record_discussion",
    actor: { id: "npub-citizen-1", role: "citizen" },
    discussion: {
      id: "discussion-1",
      content: "Could the crossing be made safer?",
      transport: "synthetic_nostr_fixture",
      signature: "synthetic-signature-1",
    },
  });
  kernel.dispatch({
    type: "craft_suggestion",
    actor: { id: "npub-citizen-1", role: "citizen" },
    suggestion: {
      id: "suggestion-1",
      discussionId: "discussion-1",
      title: "Review the crossing",
    },
  });
  kernel.dispatch({
    type: "submit_suggestion_for_administration",
    actor: { id: "case-steward-1", role: "case_steward" },
    suggestionId: "suggestion-1",
  });
  kernel.dispatch({
    type: "record_department_response",
    actor: { id: "planning-agent", role: "department_agent", departmentId: "planning" },
    workPackageId: "suggestion-1:planning",
    response: {
      summary: "A sight-line survey is required.",
      citations: ["synthetic://planning/sight-line-review"],
    },
  });
  kernel.dispatch({
    type: "review_department_response",
    actor: { id: "planning-reviewer", role: "department_reviewer", departmentId: "planning" },
    workPackageId: "suggestion-1:planning",
  });
  kernel.dispatch({
    type: "publish_reviewed_citizen_brief",
    actor: { id: "publisher-1", role: "publisher" },
    summary: "The planning response is reviewed for council context.",
  });
  kernel.dispatch({
    type: "record_participation_result",
    actor: { id: "participation-reviewer-1", role: "participation_reviewer" },
    result: {
      schemaVersion: "participation_result_v1",
      id: "participation-result-1",
      contractId: "synthetic:Example:crossing",
      contractVersion: 1,
      methodKind: "survey",
      methodVersion: "synthetic-survey-v1",
      ruleId: "advisory-signal",
      ruleVersion: "1",
      authorityBinding: "none",
      question: "Which safety improvement should be reviewed first?",
      options: [
        { optionId: "safer-crossing", label: "Safer crossing", aggregateCount: 6 },
      ],
      totalAccepted: 6,
      resultSummary: "A safer crossing was the strongest advisory signal.",
      unresolvedDissent: [],
      representationAudit: {
        targetPopulationDescription: "Residents near the crossing",
        recruitmentMethod: "synthetic opt-in",
        samplingMethod: "voluntary response",
        totalInvited: null,
        totalStarted: 6,
        totalCompleted: 6,
        limitations: ["Synthetic data; not representative."],
      },
      limitations: ["Advisory signal only."],
      openedAt: "2026-08-01T00:00:00Z",
      closedAt: "2026-08-02T00:00:00Z",
      reviewedAt: "2026-08-03T00:00:00Z",
      resultArtifactRef: "synthetic://participation/result-1",
      minorityReportRef: null,
      correctionState: "current",
      checksum: "sha256:synthetic-participation-1",
    },
  });

  const council = kernel.project({ role: "council" });
  assert.equal(council.councilDryRunBrief?.state, "dry_run_not_submitted");
  assert.equal(council.councilDryRunBrief?.reviewedDepartmentResponseCount, 1);
  assert.equal(council.councilDryRunBrief?.citizenSignal?.totalAccepted, 6);
  assert.equal(council.councilDryRunBrief?.councilSubmissionCreated, false);
  assert.equal(council.councilDryRunBrief?.formalVoteStarted, false);
  assert.equal(council.councilDryRunBrief?.publicWrite, false);
  assert.equal(
    kernel.prepareCouncilDryRunBrief().summary,
    "The planning response is reviewed for council context.",
  );
});
