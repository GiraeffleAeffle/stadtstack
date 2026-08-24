import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { finalizeEvent } from "nostr-tools/pure";

import {
  createCivicCaseCoordinator,
  DETERMINISTIC_OUTCOME_REVIEWED_AT,
  DETERMINISTIC_REVIEWED_AT,
  type CitizenSignedSuggestionV1,
  type CoordinatorJournalPort,
} from "../src/civic-case-coordinator.ts";
import { createNostrDiscussionAdapter } from "../src/adapters/discussion-adapter.ts";
import { createSqliteJournalStore } from "../src/adapters/sqlite-journal-adapter.ts";
import { createMitmachenServer, createPublicKnowledge, renderMitmachen } from "../src/public-knowledge.ts";
import { createCoordinatorCompanionRuntime } from "../src/companion-runtime.ts";
import { createPublicMecky } from "../src/public-mecky.ts";
import { createReferenceBrowserServer } from "../src/reference-browser.ts";

const municipalityId = "roebel-mueritz";
const sourceCaseId = "marienfelder-strasse";
const caseId = "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001";
const policyVersion = "case-intake-v1";
const secret = new Uint8Array(32).fill(11);
const departments = ["planning", "traffic", "environment", "finance", "legal", "public-order", "social-affairs", "public-works"] as const;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function fixture(journalPort?: CoordinatorJournalPort) {
  const discussionEvent = finalizeEvent({
    kind: 1,
    created_at: 1_786_204_800,
    tags: [
      ["municipality", municipalityId],
      ["case", sourceCaseId],
      ["t", "stadtstack-e2e-fixture"],
    ],
    content: "@Mecky Wie kann die Querung der Marienfelder Straße sicherer werden?",
  }, secret);
  const discussion = createNostrDiscussionAdapter({
    scope: { municipalityId, caseId: sourceCaseId },
    syntheticFixtureOnly: true,
  }).normalize(discussionEvent);
  const draftCore = {
    sourceAnswerReceiptId: `urn:stadtstack:mecky-answer:${"b".repeat(64)}`,
    sourceDiscussionId: discussion.id,
    sourceDiscussionRef: discussion.sourceRef,
    municipalityId,
    sourceCaseId,
    caseId,
    citizenPubkey: discussion.event.pubkey,
    title: "Sicherere Querung an der Marienfelder Straße prüfen",
    summary: "Bitte Varianten prüfen und die Abwägung öffentlich darstellen.",
  };
  const draft = {
    schemaVersion: "public_mecky_suggestion_draft_v1" as const,
    draftId: `urn:stadtstack:suggestion-draft:${sha256(draftCore).slice("sha256:".length)}`,
    ...draftCore,
    entryState: "citizen_signature_required" as const,
    authorityBinding: "none" as const,
    submittedToCivicWorkflow: false as const,
  };
  const event = finalizeEvent({
    kind: 1,
    created_at: 1_786_204_860,
    tags: [
      ["schema", "citizen_signed_suggestion_v1"],
      ["municipality", municipalityId],
      ["case", sourceCaseId],
      ["e", discussion.id, "", "root"],
      ["mecky-receipt", draft.sourceAnswerReceiptId],
    ],
    content: JSON.stringify(draft),
  }, secret);
  const signedSuggestion: CitizenSignedSuggestionV1 = {
    schemaVersion: "citizen_signed_suggestion_v1",
    candidateId: `urn:stadtstack:signed-suggestion:${event.id}`,
    signerPubkey: event.pubkey,
    draft,
    event: {
      id: event.id,
      pubkey: event.pubkey,
      createdAt: event.created_at,
      kind: 1,
      tags: event.tags.map((tag) => [...tag]),
      content: event.content,
      signature: event.sig,
    },
    verification: { kind: "nostr_nip01", verified: true },
    entryState: "awaiting_human_case_admission",
    authorityBinding: "none",
    submittedToCivicWorkflow: false,
  };
  const coordinator = createCivicCaseCoordinator({
    scope: { municipalityId, caseId: sourceCaseId },
    syntheticFixtureOnly: true,
    requireSignedSuggestionAdmission: true,
    allowedSignerPubkeys: [discussion.event.pubkey],
    requiredDepartmentIds: [...departments],
    actors: [
      { actorId: "synthetic:citizen-1", actorClass: "citizen" },
      { actorId: "synthetic:steward-1", actorClass: "case_steward" },
      { actorId: "synthetic:public-1", actorClass: "public" },
      { actorId: "synthetic:administration-1", actorClass: "administration" },
      { actorId: "synthetic:council-1", actorClass: "council" },
      { actorId: "synthetic:participation-reviewer-1", actorClass: "participation_reviewer" },
      ...departments.flatMap((departmentId) => [
        { actorId: `synthetic:${departmentId}-agent`, actorClass: "department_agent" as const, departmentId },
        { actorId: `synthetic:${departmentId}-reviewer`, actorClass: "department_reviewer" as const, departmentId },
      ]),
    ],
    ...(journalPort ? { journalPort, journalNamespace: journalPort.namespace } : {}),
  });
  return { coordinator, discussion, signedSuggestion };
}

test("an accountable human admits the exact citizen-signed suggestion into the canonical Case", () => {
  const { coordinator, discussion, signedSuggestion } = fixture();
  const intake = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "intake_discussion_v1",
    caseId,
    actorBinding: { actorId: "synthetic:citizen-1", actorClass: "citizen" },
    expectedCaseVersion: 0,
    idempotencyKey: "synthetic:idem:issue24-discussion",
    visibility: "private_case",
    policyVersion,
    payload: { discussion },
  });

  const admitted = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "admit_signed_suggestion_v1",
    caseId,
    actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
    expectedCaseVersion: intake.caseVersion,
    idempotencyKey: "synthetic:idem:issue24-admission",
    visibility: "private_case",
    policyVersion,
    payload: { signedSuggestion },
  });

  const projection = coordinator.project({
    schemaVersion: "query_envelope_v1",
    queryType: "case_projection_v1",
    caseId,
    actorBinding: { actorId: "synthetic:public-1", actorClass: "public" },
    visibility: "public",
    policyVersion,
    atCaseVersion: null,
  });
  assert.equal(admitted.caseVersion, 3);
  assert.equal(projection.projection.suggestion.status, "admitted");
  assert.equal(projection.projection.suggestion.title, signedSuggestion.draft.title);
  assert.equal(projection.projection.suggestion.summary, signedSuggestion.draft.summary);
  assert.equal(projection.projection.suggestion.signerPubkey, signedSuggestion.signerPubkey);
  assert.equal(projection.projection.suggestion.admission?.admittedByActorClass, "case_steward");
  assert.equal(projection.projection.suggestion.discussionId, discussion.id);
  assert.deepEqual(coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "admit_signed_suggestion_v1",
    caseId,
    actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
    expectedCaseVersion: intake.caseVersion,
    idempotencyKey: "synthetic:idem:issue24-admission",
    visibility: "private_case",
    policyVersion,
    payload: { signedSuggestion },
  }), admitted);
});

function project(
  coordinator: ReturnType<typeof createCivicCaseCoordinator>,
  actorId = "synthetic:public-1",
  actorClass: "public" | "administration" | "council" = "public",
  visibility: "public" | "administration" | "council" = "public",
) {
  return coordinator.project({
    schemaVersion: "query_envelope_v1",
    queryType: "case_projection_v1",
    caseId,
    actorBinding: { actorId, actorClass },
    visibility,
    policyVersion,
    atCaseVersion: null,
  });
}

function intakeAndAdmit(journalPort?: CoordinatorJournalPort) {
  const value = fixture(journalPort);
  const intake = value.coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "intake_discussion_v1",
    caseId,
    actorBinding: { actorId: "synthetic:citizen-1", actorClass: "citizen" },
    expectedCaseVersion: 0,
    idempotencyKey: "synthetic:idem:issue24-discussion",
    visibility: "private_case",
    policyVersion,
    payload: { discussion: value.discussion },
  });
  const admission = value.coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "admit_signed_suggestion_v1",
    caseId,
    actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
    expectedCaseVersion: intake.caseVersion,
    idempotencyKey: "synthetic:idem:issue24-admission",
    visibility: "private_case",
    policyVersion,
    payload: { signedSuggestion: value.signedSuggestion },
  });
  return { ...value, intake, admission };
}

function completedReviewedLoop(journalPort?: CoordinatorJournalPort) {
  const value = intakeAndAdmit(journalPort);
  let version = value.admission.caseVersion;
  for (const departmentId of departments) {
    version = value.coordinator.handle({
      schemaVersion: "command_envelope_v1",
      commandType: "assign_department_package_v1",
      caseId,
      actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
      expectedCaseVersion: version,
      idempotencyKey: `synthetic:idem:issue24-package-${departmentId}`,
      visibility: "private_case",
      policyVersion,
      payload: {
        departmentPackage: {
          id: `package-${departmentId}`,
          departmentId,
          suggestionId: `urn:stadtstack:suggestion:${value.discussion.id}`,
          request: `Review the bounded ${departmentId} evidence.`,
          assignedAgentActorId: `synthetic:${departmentId}-agent`,
          assignedReviewerActorId: `synthetic:${departmentId}-reviewer`,
          authorityBinding: "none",
        },
      },
    }).caseVersion;
  }
  for (const departmentId of departments) {
    const assigned = project(value.coordinator, "synthetic:administration-1", "administration", "administration")
      .projection.departmentPackages!.find((item) => item.departmentId === departmentId)!;
    const draftReceipt = value.coordinator.handle({
      schemaVersion: "command_envelope_v1",
      commandType: "record_department_draft_v1",
      caseId,
      actorBinding: { actorId: `synthetic:${departmentId}-agent`, actorClass: "department_agent" },
      expectedCaseVersion: version,
      idempotencyKey: `synthetic:idem:issue24-draft-${departmentId}`,
      visibility: "private_case",
      policyVersion,
      payload: {
        packageId: assigned.id,
        packageChecksum: assigned.packageChecksum,
        draft: {
          schemaVersion: "department_draft_v1",
          id: `draft-${departmentId}`,
          publicSummary: `Reviewed ${departmentId} response for the safer crossing.`,
          publicCitations: [`synthetic://roebel/${sourceCaseId}/${departmentId}/reviewed`],
          privateEvidenceRefs: [`synthetic://roebel/${sourceCaseId}/${departmentId}/private`],
          authorityBinding: "none",
        },
      },
    });
    const drafted = project(value.coordinator, "synthetic:administration-1", "administration", "administration")
      .projection.departmentPackages!.find((item) => item.departmentId === departmentId)!;
    version = value.coordinator.handle({
      schemaVersion: "command_envelope_v1",
      commandType: "attest_department_review_v1",
      caseId,
      actorBinding: { actorId: `synthetic:${departmentId}-reviewer`, actorClass: "department_reviewer" },
      expectedCaseVersion: draftReceipt.caseVersion,
      idempotencyKey: `synthetic:idem:issue24-review-${departmentId}`,
      visibility: "private_case",
      policyVersion,
      payload: {
        review: {
          packageId: drafted.id,
          draftArtifactChecksum: drafted.draft!.artifactChecksum,
          decision: "accepted",
          reviewedAt: DETERMINISTIC_REVIEWED_AT,
        },
      },
    }).caseVersion;
  }
  const administration = project(value.coordinator, "synthetic:administration-1", "administration", "administration");
  const briefReceipt = value.coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "derive_citizen_brief_v1",
    caseId,
    actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
    expectedCaseVersion: version,
    idempotencyKey: "synthetic:idem:issue24-brief",
    visibility: "private_case",
    policyVersion,
    payload: {
      brief: {
        id: `urn:stadtstack:citizen-brief:${caseId}:1`,
        sourceBindings: administration.projection.departmentPackages!.map((item) => ({
          packageId: item.id,
          packageChecksum: item.packageChecksum,
          draftArtifactChecksum: item.draft!.artifactChecksum,
          reviewAttestationChecksum: item.review!.attestationChecksum!,
        })),
        authorityBinding: "none",
      },
    },
  });
  const brief = project(value.coordinator).projection.reviewedCitizenBrief!;
  const sourceBrief = { id: brief.id, briefChecksum: brief.briefChecksum, briefEventId: briefReceipt.eventIds[0]! };
  const participationWithoutChecksum = {
    schemaVersion: "participation_result_v1" as const,
    id: "participation-marienfelder-strasse-1",
    contractId: "synthetic:roebel-mitmachen-advisory",
    contractVersion: 1,
    methodKind: "survey",
    methodVersion: "synthetic-survey-v1",
    ruleId: "advisory-signal",
    ruleVersion: "1",
    authorityBinding: "none" as const,
    question: "Welche Querungsvariante soll zuerst geprüft werden?",
    options: [
      { optionId: "lighting", label: "Beleuchtung", aggregateCount: 2 },
      { optionId: "marked-crossing", label: "Markierte Querung", aggregateCount: 6 },
    ],
    totalAccepted: 8,
    resultSummary: "Die markierte Querung erhielt das stärkste beratende Signal.",
    unresolvedDissent: ["Beleuchtung bleibt für zwei Beiträge wichtig."],
    representationAudit: {
      targetPopulationDescription: "Anwohnende der Marienfelder Straße",
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
    reviewedAt: "2026-08-08T00:00:05.000Z",
    resultArtifactRef: "synthetic://roebel/marienfelder-strasse/participation-result",
    minorityReportRef: null,
    correctionState: "current" as const,
  };
  const participation = {
    ...participationWithoutChecksum,
    checksum: sha256({
      participation: participationWithoutChecksum,
      sourceBrief,
      policyVersion,
      actorBinding: { actorId: "synthetic:participation-reviewer-1", actorClass: "participation_reviewer" },
      reviewedAt: participationWithoutChecksum.reviewedAt,
    }),
  };
  const participationReceipt = value.coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "record_advisory_participation_v1",
    caseId,
    actorBinding: { actorId: "synthetic:participation-reviewer-1", actorClass: "participation_reviewer" },
    expectedCaseVersion: briefReceipt.caseVersion,
    idempotencyKey: "synthetic:idem:issue24-participation",
    visibility: "private_case",
    policyVersion,
    payload: { participation, sourceBrief: { id: brief.id, briefChecksum: brief.briefChecksum } },
  });
  const outcomeReceipt = value.coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "record_reviewed_outcome_v1",
    caseId,
    actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
    expectedCaseVersion: participationReceipt.caseVersion,
    idempotencyKey: "synthetic:idem:issue24-outcome",
    visibility: "private_case",
    policyVersion,
    payload: {
      outcome: {
        schemaVersion: "reviewed_outcome_input_v1",
        id: "outcome-marienfelder-strasse-1",
        summary: "Die markierte Querung wird als stärkstes beratendes Ergebnis in die weitere Prüfung gegeben.",
        resultArtifactRef: "synthetic://roebel/marienfelder-strasse/reviewed-outcome",
        reviewedAt: DETERMINISTIC_OUTCOME_REVIEWED_AT,
        sourceDiscussionRef: { type: "nostr_event", id: value.discussion.id, ref: value.discussion.sourceRef },
        sourceBrief: { id: brief.id, briefChecksum: brief.briefChecksum },
        sourceParticipation: { id: participation.id, participationChecksum: participation.checksum },
        publicationTarget: "public_knowledge_projection",
        authorityBinding: "none",
      },
    },
  });
  return { ...value, brief, participation, briefReceipt, participationReceipt, outcomeReceipt };
}

test("the reviewed outcome is linked back to the signed discussion and powers Mecky plus Mitmachen", async () => {
  const value = completedReviewedLoop();
  const envelope = project(value.coordinator);
  assert.equal(envelope.caseVersion, 30);
  assert.equal(envelope.projection.reviewedOutcome?.sourceParticipation.participationChecksum, value.participation.checksum);
  assert.deepEqual(envelope.projection.discussion.outcomeRef, {
    id: envelope.projection.reviewedOutcome?.id,
    outcomeChecksum: envelope.projection.reviewedOutcome?.outcomeChecksum,
  });

  const knowledge = createPublicKnowledge({
    coordinator: { project: value.coordinator.project },
    caseId,
    policyVersion,
    actorBinding: { actorId: "synthetic:public-1", actorClass: "public" },
  });
  const publicKnowledge = knowledge.project();
  assert.equal(publicKnowledge.sourceProjectionChecksum, envelope.projectionChecksum);
  assert.equal(publicKnowledge.suggestion.status, "admitted");
  assert.equal(publicKnowledge.citizenBrief.reviewedDepartmentCount, 8);
  assert.equal(publicKnowledge.governance.participationKind, "advisory_non_binding");
  assert.equal(publicKnowledge.governance.formalVoteAvailable, false);
  assert.equal(publicKnowledge.reviewedOutcome?.discussionRef, value.discussion.sourceRef);

  const mitmachen = createMitmachenServer(knowledge);
  const view = mitmachen.render();
  const html = renderMitmachen(view);
  assert.equal(view.knowledge.knowledgeChecksum, publicKnowledge.knowledgeChecksum);
  assert.match(html, /Beratende Beteiligung/);
  assert.match(html, /keine rechtsverbindliche Abstimmung/);
  assert.match(html, /Geprüfter Citizen Brief/);
  assert.doesNotMatch(html, /privateEvidenceRefs|assignedAgentActorId|reviewerActorId/);
  const forgedView = structuredClone(view);
  (forgedView.interaction as { formalVoteAvailable: boolean }).formalVoteAvailable = true;
  assert.throws(() => renderMitmachen(forgedView), /mitmachen_view_invalid/);
  const staleView = structuredClone(view);
  staleView.knowledge.knowledgeChecksum = `sha256:${"0".repeat(64)}`;
  assert.throws(() => renderMitmachen(staleView), /mitmachen_view_invalid/);

  const reference = createReferenceBrowserServer({
    coordinator: { project: value.coordinator.project },
    caseId,
    policyVersion,
    actors: {
      public: { actorId: "synthetic:public-1", actorClass: "public" },
      administration: { actorId: "synthetic:administration-1", actorClass: "administration" },
      council: { actorId: "synthetic:council-1", actorClass: "council" },
    },
    identities: {
      public: "did:stadtstack:roebel:mecky-public",
      administration: "did:stadtstack:roebel:mecky-administration",
      council: "did:stadtstack:roebel:mecky-council",
    },
    sessions: {
      public: "session:public:marienfelder-strasse",
      administration: "session:administration:marienfelder-strasse",
      council: "session:council:marienfelder-strasse",
    },
  });
  const [publicView, administrationView, councilView] = await Promise.all([
    reference.render("/public"),
    reference.render("/administration"),
    reference.render("/council"),
  ]);
  assert.equal(publicView.flow.suggestion.status, "admitted");
  assert.equal(administrationView.flow.administrationPackages?.length, 8);
  assert.equal(councilView.flow.council?.state, "dry_run_not_submitted");
  assert.doesNotMatch(JSON.stringify(publicView), /privateEvidenceRefs|assignedAgentActorId|reviewerActorId/);
  assert.doesNotMatch(JSON.stringify(councilView), /privateEvidenceRefs|assignedAgentActorId|reviewerActorId/);
  assert.match(JSON.stringify(administrationView), /privateEvidenceRefs/);

  assert.deepEqual(value.coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "record_reviewed_outcome_v1",
    caseId,
    actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
    expectedCaseVersion: value.participationReceipt.caseVersion,
    idempotencyKey: "synthetic:idem:issue24-outcome",
    visibility: "private_case",
    policyVersion,
    payload: {
      outcome: {
        schemaVersion: "reviewed_outcome_input_v1",
        id: "outcome-marienfelder-strasse-1",
        summary: "Die markierte Querung wird als stärkstes beratendes Ergebnis in die weitere Prüfung gegeben.",
        resultArtifactRef: "synthetic://roebel/marienfelder-strasse/reviewed-outcome",
        reviewedAt: DETERMINISTIC_OUTCOME_REVIEWED_AT,
        sourceDiscussionRef: { type: "nostr_event", id: value.discussion.id, ref: value.discussion.sourceRef },
        sourceBrief: { id: value.brief.id, briefChecksum: value.brief.briefChecksum },
        sourceParticipation: { id: value.participation.id, participationChecksum: value.participation.checksum },
        publicationTarget: "public_knowledge_projection",
        authorityBinding: "none",
      },
    },
  }), value.outcomeReceipt);

  const runtime = createCoordinatorCompanionRuntime({
    coordinator: { project: value.coordinator.project },
    caseId,
    policyVersion,
    actors: {
      public: { actorId: "synthetic:public-1", actorClass: "public" },
      administration: { actorId: "synthetic:administration-1", actorClass: "administration" },
      council: { actorId: "synthetic:council-1", actorClass: "council" },
    },
    identities: {
      public: "did:stadtstack:roebel:mecky-public",
      administration: "did:stadtstack:roebel:mecky-administration",
      council: "did:stadtstack:roebel:mecky-council",
    },
    sessions: {
      public: "session:public:marienfelder-strasse",
      administration: "session:administration:marienfelder-strasse",
      council: "session:council:marienfelder-strasse",
    },
  });
  const worker: Parameters<typeof createPublicMecky>[0]["worker"] = {
    async run(task) {
        const citationRefs = [...task.context.citations!];
        const reviewedRef = citationRefs.find((ref) => ref !== value.discussion.sourceRef)!;
        return {
          schemaVersion: "worker_result_v1",
          status: "completed",
          taskId: "worker-task:issue24-public-knowledge",
          caseId,
          sessionKey: task.sessionKey!,
          profile: "public",
          identity: { id: task.workerIdentity, profile: "public" },
          contextChecksum: sha256(task.context),
          answer: JSON.stringify({
            schemaVersion: "public_mecky_answer_draft_v1",
            answer: "Die geprüfte Wissensprojektion zeigt das beratende Ergebnis und seinen Ursprung.",
            facts: [
              { text: "Die Frage stammt aus der signierten Diskussion.", citationRefs: [value.discussion.sourceRef] },
              { text: "Das beratende Ergebnis ist mit geprüftem Material belegt.", citationRefs: [reviewedRef] },
            ],
            uncertainty: ["Eine rechtsverbindliche Entscheidung ist nicht Teil dieses Ergebnisses."],
            reasoningSummary: ["Antwort aus derselben aktuellen öffentlichen Wissensprojektion wie Mitmachen."],
            suggestion: { title: "Weiteren Prüfschritt beraten", summary: "Den geprüften Ausgang öffentlich weiter beraten." },
          }),
          citations: citationRefs.map((ref) => ({ ref })),
          artifactBindings: citationRefs.map((ref) => ({ ref, checksum: sha256(ref) })),
          aiAttribution: {
            schemaVersion: "ai_attribution_v1",
            kind: "agent_contribution",
            workerIdentityId: task.workerIdentity,
            profile: "public",
            adapterKind: "deterministic-local",
            authorityBinding: "none",
          },
          allowedTools: [],
          tools: { mode: "default-deny", allow: [], deny: ["*"] },
          prohibitedEffects: [...task.prohibitedEffects],
          limits: { maxOutputTokens: 512, timeoutMs: 5_000, maxCostUsd: 0 },
        };
    },
  };
  const mecky = createPublicMecky({ runtime, knowledge, worker });
  const answer = await mecky.answer({
    schemaVersion: "public_mecky_request_v1",
    invocation: "discussion",
    discussion: value.discussion,
  });
  assert.equal(answer.status, "answered");
  if (answer.status !== "answered") throw new Error("expected_public_mecky_answer");
  assert.equal(answer.receipt.publicKnowledgeChecksum, publicKnowledge.knowledgeChecksum);

  let forgedWorkerCalls = 0;
  const forgedKnowledge = structuredClone(publicKnowledge);
  forgedKnowledge.knowledgeChecksum = `sha256:${"f".repeat(64)}`;
  const forgedMecky = createPublicMecky({
    runtime,
    knowledge: { project: () => forgedKnowledge },
    worker: {
      async run() {
        forgedWorkerCalls += 1;
        throw new Error("worker_must_not_run");
      },
    },
  });
  const rejected = await forgedMecky.answer({
    schemaVersion: "public_mecky_request_v1",
    invocation: "discussion",
    discussion: value.discussion,
  });
  assert.equal(rejected.status, "unavailable");
  assert.equal(rejected.status === "unavailable" ? rejected.reason : null, "stale_evidence");
  assert.equal(forgedWorkerCalls, 0);
});

test("admission, outcome, and public knowledge bindings fail closed without mutating the Case", () => {
  const beforeAdmission = fixture();
  const intake = beforeAdmission.coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "intake_discussion_v1",
    caseId,
    actorBinding: { actorId: "synthetic:citizen-1", actorClass: "citizen" },
    expectedCaseVersion: 0,
    idempotencyKey: "synthetic:idem:issue24-negative-discussion",
    visibility: "private_case",
    policyVersion,
    payload: { discussion: beforeAdmission.discussion },
  });
  assert.throws(() => beforeAdmission.coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "assign_department_package_v1",
    caseId,
    actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
    expectedCaseVersion: intake.caseVersion,
    idempotencyKey: "synthetic:idem:issue24-premature-package",
    visibility: "private_case",
    policyVersion,
    payload: {
      departmentPackage: {
        id: "package-planning",
        departmentId: "planning",
        suggestionId: `urn:stadtstack:suggestion:${beforeAdmission.discussion.id}`,
        request: "Review planning evidence.",
        assignedAgentActorId: "synthetic:planning-agent",
        assignedReviewerActorId: "synthetic:planning-reviewer",
        authorityBinding: "none",
      },
    },
  }), /signed_suggestion_admission_required/);
  const tampered = structuredClone(beforeAdmission.signedSuggestion);
  tampered.draft.summary = "Changed after signing";
  assert.throws(() => beforeAdmission.coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "admit_signed_suggestion_v1",
    caseId,
    actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
    expectedCaseVersion: intake.caseVersion,
    idempotencyKey: "synthetic:idem:issue24-tampered-admission",
    visibility: "private_case",
    policyVersion,
    payload: { signedSuggestion: tampered },
  }), /signed_suggestion_binding_invalid|signed_suggestion_signature_invalid/);
  assert.equal(project(beforeAdmission.coordinator).caseVersion, 2);

  const completed = completedReviewedLoop();
  const before = project(completed.coordinator);
  assert.throws(() => completed.coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "record_reviewed_outcome_v1",
    caseId,
    actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
    expectedCaseVersion: completed.outcomeReceipt.caseVersion,
    idempotencyKey: "synthetic:idem:issue24-second-outcome",
    visibility: "private_case",
    policyVersion,
    payload: {
      outcome: {
        schemaVersion: "reviewed_outcome_input_v1",
        id: "outcome-forged",
        summary: "Forged outcome",
        resultArtifactRef: "synthetic://roebel/marienfelder-strasse/forged",
        reviewedAt: DETERMINISTIC_OUTCOME_REVIEWED_AT,
        sourceDiscussionRef: { type: "nostr_event", id: completed.discussion.id, ref: completed.discussion.sourceRef },
        sourceBrief: { id: completed.brief.id, briefChecksum: completed.brief.briefChecksum },
        sourceParticipation: { id: completed.participation.id, participationChecksum: `sha256:${"f".repeat(64)}` },
        publicationTarget: "public_knowledge_projection",
        authorityBinding: "none",
      },
    },
  }), /reviewed_outcome_already_recorded|reviewed_outcome_source_mismatch/);
  const after = project(completed.coordinator);
  assert.equal(after.caseVersion, before.caseVersion);
  assert.equal(after.journalHeadChecksum, before.journalHeadChecksum);

  const unknownProjection = createPublicKnowledge({
    coordinator: {
      project() {
        const envelope = structuredClone(before) as typeof before & { projection: typeof before.projection & { internalAlias?: string } };
        envelope.projection.internalAlias = "forbidden";
        return envelope;
      },
    },
    caseId,
    policyVersion,
    actorBinding: { actorId: "synthetic:public-1", actorClass: "public" },
  });
  assert.throws(() => unknownProjection.project(), /public_knowledge_projection_unknown_field/);

  let configGetterCalls = 0;
  const accessorConfig = Object.defineProperty({
    caseId,
    policyVersion,
    actorBinding: { actorId: "synthetic:public-1", actorClass: "public" },
  }, "coordinator", {
    enumerable: true,
    get() {
      configGetterCalls += 1;
      return { project: completed.coordinator.project };
    },
  });
  assert.throws(
    () => createPublicKnowledge(accessorConfig as unknown as Parameters<typeof createPublicKnowledge>[0]),
    /public_knowledge_config_invalid/,
  );
  assert.equal(configGetterCalls, 0);

  let proxyTraps = 0;
  const proxiedProjection = createPublicKnowledge({
    coordinator: {
      project() {
        return new Proxy(before, {
          getPrototypeOf() { proxyTraps += 1; throw new Error("trap"); },
          ownKeys() { proxyTraps += 1; throw new Error("trap"); },
        });
      },
    },
    caseId,
    policyVersion,
    actorBinding: { actorId: "synthetic:public-1", actorClass: "public" },
  });
  assert.throws(() => proxiedProjection.project(), /public_knowledge_input_unsafe/);
  assert.equal(proxyTraps, 0);

  const sparseDiscussions: unknown[] = [];
  sparseDiscussions.length = 4_000_000_000;
  const sparseProjection = createPublicKnowledge({
    coordinator: {
      project() {
        const envelope = structuredClone(before);
        (envelope.projection as unknown as { discussions: unknown[] }).discussions = sparseDiscussions;
        return envelope;
      },
    },
    caseId,
    policyVersion,
    actorBinding: { actorId: "synthetic:public-1", actorClass: "public" },
  });
  assert.throws(() => sparseProjection.project(), /public_knowledge_input_unsafe/);
});

test("retraction invalidates the public outcome and the Mitmachen knowledge surface", () => {
  const value = completedReviewedLoop();
  const retraction = value.coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "retract_advisory_participation_v1",
    caseId,
    actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
    expectedCaseVersion: value.outcomeReceipt.caseVersion,
    idempotencyKey: "synthetic:idem:issue24-retract-participation",
    visibility: "private_case",
    policyVersion,
    payload: { retraction: { participationId: value.participation.id, participationChecksum: value.participation.checksum } },
  });
  const publicProjection = project(value.coordinator);
  assert.equal(retraction.caseVersion, 31);
  assert.equal(publicProjection.projection.participationResult, undefined);
  assert.equal(publicProjection.projection.reviewedOutcome, undefined);
  assert.equal(publicProjection.projection.discussion.outcomeRef, undefined);
  const knowledge = createPublicKnowledge({
    coordinator: { project: value.coordinator.project },
    caseId,
    policyVersion,
    actorBinding: { actorId: "synthetic:public-1", actorClass: "public" },
  });
  assert.throws(() => knowledge.project(), /public_knowledge_participation_required/);
});

test("the admitted suggestion and reviewed outcome recover byte-identically from SQLite WAL", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "stadtstack-issue24-"));
  const firstStore = createSqliteJournalStore({ rootDir, namespace: "issue24" });
  try {
    const first = completedReviewedLoop(firstStore);
    const before = project(first.coordinator);
    firstStore.close();

    const secondStore = createSqliteJournalStore({ rootDir, namespace: "issue24" });
    const reopened = fixture(secondStore).coordinator;
    const after = project(reopened);
    assert.deepEqual(after, before);
    assert.equal(after.caseVersion, 30);
    assert.equal(after.projection.suggestion.status, "admitted");
    assert.equal(after.projection.reviewedOutcome?.outcomeChecksum, before.projection.reviewedOutcome?.outcomeChecksum);
    secondStore.close();
    secondStore.deleteExactSynthetic();
  } finally {
    try { firstStore.close(); } catch { /* already closed */ }
    rmdirSync(rootDir);
  }
});

test("the loopback Mitmachen route is accessible and rejects writes or route tampering", async () => {
  const value = completedReviewedLoop();
  const knowledge = createPublicKnowledge({
    coordinator: { project: value.coordinator.project },
    caseId,
    policyVersion,
    actorBinding: { actorId: "synthetic:public-1", actorClass: "public" },
  });
  const mitmachen = createMitmachenServer(knowledge);
  const address = await mitmachen.listen();
  try {
    const ok = await fetch(`http://${address.host}:${address.port}/mitmachen`);
    assert.equal(ok.status, 200);
    const html = await ok.text();
    assert.match(html, /<main>/);
    assert.match(html, /aria-labelledby="brief-heading"/);
    assert.match(html, /viewport/);
    assert.doesNotMatch(html, /<form|<script|privateEvidenceRefs/);
    const query = await fetch(`http://${address.host}:${address.port}/mitmachen?case=forged`);
    assert.equal(query.status, 400);
    const post = await fetch(`http://${address.host}:${address.port}/mitmachen`, { method: "POST" });
    assert.equal(post.status, 405);
    const unknown = await fetch(`http://${address.host}:${address.port}/vote`);
    assert.equal(unknown.status, 404);
  } finally {
    await mitmachen.close();
  }
});
