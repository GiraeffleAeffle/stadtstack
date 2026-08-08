import assert from "node:assert/strict";
import test from "node:test";

import { createCivicKernel } from "../src/civic-kernel.ts";
import { createCompanionRuntime } from "../src/companion-runtime.ts";

test("administration, council, and public companions receive isolated task contexts", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
    actors: [
      { id: "npub-citizen-1", role: "citizen" },
      { id: "case-steward-1", role: "case_steward" },
      { id: "planning-agent", role: "department_agent", departmentId: "planning" },
      { id: "planning-reviewer", role: "department_reviewer", departmentId: "planning" },
      { id: "publisher-1", role: "publisher" },
      { id: "participation-reviewer-1", role: "participation_reviewer" },
    ],
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
      summary: "Private draft: commission a sight-line survey.",
      citations: ["synthetic://planning/private-draft"],
    },
  });

  const runtime = createCompanionRuntime({
    caseReader: kernel,
    identities: {
      administration: "did:stadtstack:sample:mecky-administration",
      council: "did:stadtstack:sample:mecky-council",
      public: "npub-sample-public-mecky",
    },
  });

  const administration = runtime.prepareTask({
    profile: "administration",
    question: "What still needs review?",
  });
  const council = runtime.prepareTask({
    profile: "council",
    question: "What is ready for council?",
  });
  const publicTask = runtime.prepareTask({
    profile: "public",
    question: "What is happening?",
  });

  assert.match(
    JSON.stringify(administration.context),
    /commission a sight-line survey/,
  );
  assert.doesNotMatch(
    JSON.stringify(council.context),
    /commission a sight-line survey/,
  );
  assert.doesNotMatch(
    JSON.stringify(publicTask.context),
    /commission a sight-line survey/,
  );

  assert.notEqual(administration.workerIdentity, council.workerIdentity);
  assert.notEqual(council.workerIdentity, publicTask.workerIdentity);
  assert.deepEqual(publicTask.allowedTools, []);
  assert.deepEqual(administration.prohibitedEffects, [
    "approve",
    "change_case_stage",
    "publish",
    "submit_to_council",
    "vote",
    "write_source",
    "write_nostr",
    "invoke_tool",
  ]);
});

test("companion construction requires pairwise-distinct worker identities", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
    actors: [{ id: "synthetic-citizen", role: "citizen" }],
  });

  assert.throws(
    () =>
      createCompanionRuntime({
        caseReader: kernel,
        identities: {
          administration: "same-worker",
          council: "same-worker",
          public: "same-worker",
        },
      }),
    /worker_identity_unique/,
  );
});

test("the synthetic case reaches each companion through reviewed, role-safe context", () => {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
    actors: [
      { id: "npub-citizen-1", role: "citizen" },
      { id: "case-steward-1", role: "case_steward" },
      { id: "planning-agent", role: "department_agent", departmentId: "planning" },
      { id: "planning-reviewer", role: "department_reviewer", departmentId: "planning" },
      { id: "publisher-1", role: "publisher" },
      { id: "participation-reviewer-1", role: "participation_reviewer" },
    ],
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
      summary: "Private planning draft: commission a sight-line survey.",
      citations: ["synthetic://planning/review"],
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
    summary: "The planning response is reviewed for the public case brief.",
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

  const runtime = createCompanionRuntime({
    caseReader: kernel,
    identities: {
      administration: "did:stadtstack:sample:mecky-administration",
      council: "did:stadtstack:sample:mecky-council",
      public: "npub-sample-public-mecky",
    },
  });

  const administration = runtime.prepareTask({
    profile: "administration",
    question: "What still needs review?",
  });
  const council = runtime.prepareTask({
    profile: "council",
    question: "What is ready for council?",
  });
  const publicTask = runtime.prepareTask({
    profile: "public",
    question: "What is happening?",
  });

  assert.match(JSON.stringify(administration.context), /Private planning draft/);
  assert.equal(administration.context.reviewedCitizenBrief?.publishedBy, "publisher-1");
  assert.equal(council.context.councilDryRunBrief?.state, "dry_run_not_submitted");
  assert.equal(council.context.participationResult?.totalAccepted, 6);
  assert.equal("departmentWorkPackages" in council.context, false);
  assert.equal(publicTask.context.reviewedCitizenBrief?.publishedBy, undefined);
  assert.equal(publicTask.context.councilDryRunBrief, undefined);
  assert.equal("departmentWorkPackages" in publicTask.context, false);
  assert.equal(publicTask.context.participationResult?.authorityBinding, "none");
  assert.doesNotMatch(JSON.stringify(publicTask.context), /Private planning draft/);

  administration.context.suggestions[0]!.title = "tampered";
  const freshAdministration = runtime.prepareTask({
    profile: "administration",
    question: "Read again",
  });
  assert.equal(freshAdministration.context.suggestions[0]?.title, "Review the crossing");
});
