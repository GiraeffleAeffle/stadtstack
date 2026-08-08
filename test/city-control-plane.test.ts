import assert from "node:assert/strict";
import test from "node:test";

import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { createDeterministicLocalCompanionAdapter, createCompanionIdentityPolicy } from "../src/adapters/companion-harness.ts";
import { createInMemoryNostrRelayTransport } from "../src/adapters/nostr-relay-transport.ts";
import { createCityControlPlane, type CityControlPlaneConfig } from "../src/city-control-plane.ts";

const municipalityId = "sample-municipality";
const caseId = "sample-case";
const departments = ["planning", "traffic", "environment", "finance", "legal", "public-order", "social-affairs", "public-works"];
const identities = {
  administration: "did:stadtstack:sample:e2e-administration",
  council: "did:stadtstack:sample:e2e-council",
  public: "npub-sample-e2e-public",
} as const;

function makeFixture() {
  const secretKey = generateSecretKey();
  const event = finalizeEvent({
    kind: 1,
    created_at: 1_754_035_200,
    tags: [["municipality", municipalityId], ["case", caseId], ["t", "stadtstack-e2e-fixture"]],
    content: "Could the crossing be made safer?",
  }, secretKey);
  return event;
}

function makeConfig(
  event: { pubkey: string },
  departmentList: readonly string[] = departments,
): CityControlPlaneConfig {
  const actors: Array<{ id: string; role: any; departmentId?: string }> = [
    { id: "citizen-1", role: "citizen" },
    { id: "case-steward-1", role: "case_steward" },
    { id: "publisher-1", role: "publisher" },
    { id: "participation-reviewer-1", role: "participation_reviewer" },
    { id: "council-1", role: "council_member" },
    { id: "public-viewer-1", role: "public_viewer" },
  ];
  for (const department of departmentList) {
    const agent = `agent-${department}`;
    const reviewer = `reviewer-${department}`;
    actors.push({ id: agent, role: "department_agent", departmentId: department });
    actors.push({ id: reviewer, role: "department_reviewer", departmentId: department });
  }
  return {
    municipalityId,
    caseId,
    departments: [...departmentList],
    relayUrl: "wss://relay.synthetic.invalid",
    allowedSignerPubkeys: [event.pubkey],
    fixtureMarker: ["t", "stadtstack-e2e-fixture"],
    companionIdentities: identities,
    actors,
  };
}

function makePlane(
  event = makeFixture(),
  departmentList: readonly string[] = departments,
) {
  const config = makeConfig(event, departmentList);
  const relay = createInMemoryNostrRelayTransport({ relayUrl: config.relayUrl, scope: { municipalityId, caseId }, fixtureSignerPubkey: event.pubkey });
  const harness = createDeterministicLocalCompanionAdapter({ identityPolicy: createCompanionIdentityPolicy(identities) });
  return { event, config, relay, plane: createCityControlPlane(config, { relay, harness }) };
}

function participationResult() {
  return {
    schemaVersion: "participation_result_v1" as const,
    id: "participation-1",
    contractId: "synthetic:crossing",
    contractVersion: 1,
    methodKind: "survey",
    methodVersion: "synthetic-v1",
    ruleId: "advisory-signal",
    ruleVersion: "1",
    authorityBinding: "none" as const,
    question: "Which improvement should be reviewed first?",
    options: [{ optionId: "crossing", label: "Safer crossing", aggregateCount: 2 }],
    totalAccepted: 2,
    resultSummary: "A safer crossing was the strongest synthetic signal.",
    unresolvedDissent: [],
    representationAudit: {
      targetPopulationDescription: "Residents near crossing",
      recruitmentMethod: "synthetic opt-in",
      samplingMethod: "voluntary response",
      totalInvited: 2,
      totalStarted: 2,
      totalCompleted: 2,
      limitations: ["Synthetic data."],
    },
    limitations: ["Advisory only; no formal vote."],
    openedAt: "2026-08-01T00:00:00Z",
    closedAt: "2026-08-02T00:00:00Z",
    reviewedAt: "2026-08-03T00:00:00Z",
    resultArtifactRef: "synthetic://participation/1",
    minorityReportRef: null,
    correctionState: "current" as const,
    checksum: "sha256:synthetic-participation-1",
  };
}

test("city control plane executes the one-city reviewed vertical slice with authority-free receipts", async () => {
  const { event, relay, plane } = makePlane();
  const discussion = await plane.ingestDiscussion({ callerId: "citizen-1", event });
  assert.equal(discussion.artifact.source, "nostr");
  assert.equal(discussion.authorityBinding, "none");
  assert.equal(relay.publishCount, 1);
  const replay = await plane.ingestDiscussion({ callerId: "citizen-1", event });
  assert.deepEqual(replay.artifact, discussion.artifact);
  assert.equal(relay.publishCount, 1);

  const crafted = plane.craftSuggestion({ callerId: "citizen-1", suggestion: { id: "suggestion-1", discussionId: event.id, title: "Review a safer crossing" } });
  assert.equal(crafted.suggestion.status, "draft");
  const submitted = plane.submitSuggestion({ callerId: "case-steward-1", suggestionId: "suggestion-1" });
  assert.equal(submitted.departmentWorkPackages.length, 8);

  for (const department of departments) {
    const workPackageId = `suggestion-1:${department}`;
    const response = plane.recordDepartmentResponse({ callerId: `agent-${department}`, workPackageId, response: { summary: `${department} reviewed the crossing.`, citations: [`synthetic://${department}/review`] } });
    assert.equal(response.workPackage.response?.status, "pending_review");
    const reviewed = plane.reviewDepartmentResponse({ callerId: `reviewer-${department}`, workPackageId });
    assert.equal(reviewed.workPackage.response?.status, "reviewed");
  }

  const published = plane.publishReviewedBrief({ callerId: "publisher-1", summary: "All department responses are reviewed." });
  assert.equal(published.brief.publishedBy, undefined);
  assert.equal(published.public.reviewedCitizenBrief?.publishedBy, undefined);
  assert.equal(published.administration.reviewedCitizenBrief?.publishedBy, "publisher-1");
  plane.recordDepartmentResponse({ callerId: "agent-planning", workPackageId: "suggestion-1:planning", response: { summary: "Planning supplied a corrected review.", citations: ["synthetic://planning/review-v2"] } });
  assert.throws(() => plane.publishReviewedBrief({ callerId: "publisher-1", summary: "All department responses are reviewed." }), /all_department_responses_must_be_reviewed|reviewed_brief_missing/);
  plane.reviewDepartmentResponse({ callerId: "reviewer-planning", workPackageId: "suggestion-1:planning" });
  assert.equal(plane.publishReviewedBrief({ callerId: "publisher-1", summary: "All department responses are reviewed." }).administration.reviewedCitizenBrief?.publishedBy, "publisher-1");

  const participation = plane.recordReviewedParticipation({ callerId: "participation-reviewer-1", result: participationResult() });
  assert.equal(participation.result.totalAccepted, 2);
  assert.equal(participation.result.authorityBinding, "none");

  const dryRun = plane.prepareCouncilDryRunBrief({ callerId: "council-1" });
  assert.equal(dryRun.state, "dry_run_not_submitted");
  assert.equal(dryRun.formalVoteStarted, false);
  assert.equal(dryRun.councilSubmissionCreated, false);
  assert.equal(dryRun.publicWrite, false);
  assert.equal("departmentWorkPackages" in plane.project({ callerId: "public-viewer-1", profile: "public" }), false);
  assert.equal("departmentWorkPackages" in plane.project({ callerId: "council-1", profile: "council" }), false);

  const companion = await plane.askCompanion({ profile: "public", callerId: "public-viewer-1", question: "What is happening?" });
  assert.equal(companion.status, "completed");
  assert.equal(companion.profile, "public");
  assert.deepEqual(companion.prohibitedEffects.includes("vote"), true);
});

test("control plane binds caller identity and department reviewer independence", async () => {
  const { event, plane } = makePlane();
  assert.throws(() => plane.recordReviewedParticipation({ callerId: "participation-reviewer-1", result: participationResult() }), /reviewed_citizen_brief_required/);
  await assert.rejects(() => plane.ingestDiscussion({ callerId: "citizen-1", role: "citizen", event } as any), /actor_role_self_assertion/);
  await assert.rejects(() => plane.ingestDiscussion({ callerId: "unknown", event }), /actor_not_registered/);
  assert.throws(() => plane.craftSuggestion({ callerId: "case-steward-1", suggestion: { id: "s", discussionId: event.id, title: "x" } }), /actor_role_forbidden/);
  await plane.ingestDiscussion({ callerId: "citizen-1", event });
  plane.craftSuggestion({ callerId: "citizen-1", suggestion: { id: "s", discussionId: event.id, title: "x" } });
  plane.submitSuggestion({ callerId: "case-steward-1", suggestionId: "s" });
  assert.throws(() => plane.recordDepartmentResponse({ callerId: "agent-traffic", workPackageId: "s:planning", response: { summary: "wrong department", citations: ["synthetic://wrong"] } }), /department_agent_scope_mismatch/);
  assert.throws(() => plane.recordDepartmentResponse({ callerId: "reviewer-planning", workPackageId: "s:planning", response: { summary: "reviewer cannot answer", citations: ["synthetic://wrong"] } }), /actor_role_forbidden/);
  assert.throws(() => plane.project({ profile: "public" } as any), /actor_id_required/);
  assert.throws(() => plane.project({ callerId: "citizen-1", profile: "administration" }), /actor_profile_forbidden/);
  assert.throws(() => plane.project({ callerId: "citizen-1", profile: "council" }), /actor_profile_forbidden/);
  await assert.rejects(() => plane.askCompanion({ profile: "administration", question: "private?" } as any), /actor_id_required/);
  await assert.rejects(() => plane.askCompanion({ callerId: "citizen-1", profile: "administration", question: "private?" }), /actor_profile_forbidden/);
  assert.throws(() => plane.prepareCouncilDryRunBrief({ callerId: "citizen-1" }), /actor_profile_forbidden/);
  assert.throws(() => plane.craftSuggestion({ callerId: "citizen-1", suggestion: { id: "smuggle", discussionId: event.id, title: "x", effect: "publish" } } as any), /city_control_request_field_forbidden:suggestion.effect/);
  assert.throws(() => plane.project({ callerId: "public-viewer-1", profile: "public", role: "publisher" } as any), /actor_role_self_assertion/);
});

test("department routing uses package metadata when department IDs contain colons", async () => {
  const departmentList = ["public:works"] as const;
  const { event, plane } = makePlane(makeFixture(), departmentList);
  await plane.ingestDiscussion({ callerId: "citizen-1", event });
  plane.craftSuggestion({
    callerId: "citizen-1",
    suggestion: { id: "suggestion-colon", discussionId: event.id, title: "Review public works" },
  });
  plane.submitSuggestion({ callerId: "case-steward-1", suggestionId: "suggestion-colon" });

  const workPackageId = "suggestion-colon:public:works";
  const response = plane.recordDepartmentResponse({
    callerId: "agent-public:works",
    workPackageId,
    response: {
      summary: "Public works reviewed the crossing.",
      citations: ["synthetic://public-works/review"],
    },
  });
  assert.equal(response.workPackage.departmentId, "public:works");
  const reviewed = plane.reviewDepartmentResponse({
    callerId: "reviewer-public:works",
    workPackageId,
  });
  assert.equal(reviewed.workPackage.response?.status, "reviewed");
});
