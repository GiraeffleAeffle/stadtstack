#!/usr/bin/env node

import { createHash } from "node:crypto";

import { finalizeEvent } from "nostr-tools/pure";

import {
  createCivicCaseCoordinator,
  DETERMINISTIC_REVIEWED_AT,
} from "../src/civic-case-coordinator.ts";
import { createNostrDiscussionAdapter } from "../src/adapters/discussion-adapter.ts";
import {
  createCompanionIdentityPolicy,
  createOpenClawCompanionAdapter,
} from "../src/adapters/companion-harness.ts";
import { createCoordinatorCompanionRuntime } from "../src/companion-runtime.ts";
import { createPublicMecky } from "../src/public-mecky.ts";

const municipalityId = "roebel-mueritz";
const sourceCaseId = "marienfelder-strasse";
const caseId = "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001";
const scope = { municipalityId, caseId: sourceCaseId };
const policyVersion = "case-intake-v1";
const departments = [
  "planning",
  "traffic",
  "environment",
  "finance",
  "legal",
  "public-order",
  "social-affairs",
  "public-works",
];
const citizenSecret = new Uint8Array(32).fill(11);
const otherCitizenSecret = new Uint8Array(32).fill(12);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function project(coordinator, actorId = "synthetic:public-1", actorClass = "public", visibility = "public") {
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

const discussionEvent = finalizeEvent({
  kind: 1,
  created_at: 1_786_204_800,
  tags: [
    ["municipality", municipalityId],
    ["case", sourceCaseId],
    ["t", "stadtstack-e2e-fixture"],
  ],
  content: "@Mecky Welche geprüfte Maßnahme könnte die Querung der Marienfelder Straße sicherer machen?",
}, citizenSecret);
const adapter = createNostrDiscussionAdapter({ scope, syntheticFixtureOnly: true });
const discussion = adapter.normalize(discussionEvent);
const actors = {
  public: { actorId: "synthetic:public-1", actorClass: "public" },
  administration: { actorId: "synthetic:administration-1", actorClass: "administration" },
  council: { actorId: "synthetic:council-1", actorClass: "council" },
};
const coordinator = createCivicCaseCoordinator({
  scope,
  syntheticFixtureOnly: true,
  allowedSignerPubkeys: [discussionEvent.pubkey],
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
  idempotencyKey: "synthetic:idem:issue23-discussion",
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
    idempotencyKey: `synthetic:idem:issue23-package-${departmentId}`,
    visibility: "private_case",
    policyVersion,
    payload: {
      departmentPackage: {
        id: `package-${departmentId}`,
        departmentId,
        suggestionId: `urn:stadtstack:suggestion:${discussion.id}`,
        request: `Review the bounded ${departmentId} evidence for the Marienfelder Straße crossing.`,
        assignedAgentActorId: `synthetic:${departmentId}-agent`,
        assignedReviewerActorId: `synthetic:${departmentId}-reviewer`,
        authorityBinding: "none",
      },
    },
  }).caseVersion;
}

for (const departmentId of departments) {
  const packageProjection = project(
    coordinator,
    actors.administration.actorId,
    actors.administration.actorClass,
    "administration",
  ).projection.departmentPackages.find((item) => item.departmentId === departmentId);
  const draft = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "record_department_draft_v1",
    caseId,
    actorBinding: { actorId: `synthetic:${departmentId}-agent`, actorClass: "department_agent" },
    expectedCaseVersion: version,
    idempotencyKey: `synthetic:idem:issue23-draft-${departmentId}`,
    visibility: "private_case",
    policyVersion,
    payload: {
      packageId: packageProjection.id,
      packageChecksum: packageProjection.packageChecksum,
      draft: {
        schemaVersion: "department_draft_v1",
        id: `draft-${departmentId}-1`,
        publicSummary: departmentId === "traffic"
          ? "The reviewed traffic response supports assessing a safer marked crossing."
          : `The reviewed ${departmentId} response records its bounded public assessment.`,
        publicCitations: [`synthetic://roebel/${sourceCaseId}/${departmentId}/reviewed-evidence`],
        privateEvidenceRefs: [`synthetic://roebel/${sourceCaseId}/${departmentId}/private-review-file`],
        authorityBinding: "none",
      },
    },
  });
  const drafted = project(
    coordinator,
    actors.administration.actorId,
    actors.administration.actorClass,
    "administration",
  ).projection.departmentPackages.find((item) => item.departmentId === departmentId);
  version = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "attest_department_review_v1",
    caseId,
    actorBinding: { actorId: `synthetic:${departmentId}-reviewer`, actorClass: "department_reviewer" },
    expectedCaseVersion: draft.caseVersion,
    idempotencyKey: `synthetic:idem:issue23-review-${departmentId}`,
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

const administration = project(
  coordinator,
  actors.administration.actorId,
  actors.administration.actorClass,
  "administration",
).projection;
const sourceBindings = administration.departmentPackages.map((item) => ({
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
  idempotencyKey: "synthetic:idem:issue23-brief",
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

const identities = {
  public: "did:stadtstack:roebel:mecky-public",
  administration: "did:stadtstack:roebel:mecky-administration",
  council: "did:stadtstack:roebel:mecky-council",
};
const runtime = createCoordinatorCompanionRuntime({
  coordinator: { project: coordinator.project },
  caseId,
  policyVersion,
  actors,
  identities,
  sessions: {
    public: "session:public:marienfelder-strasse",
    administration: "session:administration:marienfelder-strasse",
    council: "session:council:marienfelder-strasse",
  },
});
const identityPolicy = createCompanionIdentityPolicy(identities);
let workerCalls = 0;
const worker = createOpenClawCompanionAdapter({
  send(request) {
    workerCalls += 1;
    const publicProjection = request.context.projection;
    const sourceDiscussion = publicProjection.discussion;
    const traffic = publicProjection.reviewedCitizenBrief.responses.find((response) => response.departmentId === "traffic");
    return {
      schemaVersion: "worker_result_v1",
      status: "completed",
      taskId: request.taskId,
      caseId: request.caseId,
      sessionKey: request.sessionKey,
      profile: request.profile,
      identity: { ...request.identity },
      contextChecksum: request.contextChecksum,
      answer: JSON.stringify({
        schemaVersion: "public_mecky_answer_draft_v1",
        answer: "Die geprüfte Verkehrsantwort stützt die Prüfung einer sichereren markierten Querung.",
        facts: [
          {
            text: "Die Frage stammt aus einem signierten öffentlichen Diskussionsbeitrag.",
            citationRefs: [sourceDiscussion.sourceRef],
          },
          {
            text: traffic.publicSummary,
            citationRefs: [...traffic.publicCitations],
          },
        ],
        uncertainty: ["Ein Bauzeitpunkt oder eine formelle Umsetzungsentscheidung ist nicht belegt."],
        reasoningSummary: ["Mecky verbindet die öffentliche Frage nur mit der aktuell geprüften Verkehrsantwort."],
        suggestion: {
          title: "Sicherere Querung der Marienfelder Straße prüfen",
          summary: "Die Stadt soll Varianten für eine sicherere markierte Querung prüfen und die Abwägung öffentlich erläutern.",
        },
      }),
      citations: request.citations.map((citation) => ({ ...citation })),
      artifactBindings: request.artifactBindings.map((binding) => ({ ...binding })),
      aiAttribution: { ...request.aiAttribution },
      allowedTools: [],
      tools: { mode: "default-deny", allow: [], deny: ["*"] },
      prohibitedEffects: [...request.prohibitedEffects],
      limits: { ...request.limits },
    };
  },
}, { identityPolicy });
const mecky = createPublicMecky({ runtime, worker });
const before = project(coordinator);
const turn = await mecky.answer({
  schemaVersion: "public_mecky_request_v1",
  invocation: "discussion",
  discussion,
});
if (turn.status !== "answered") throw new Error(`public_mecky_tracer_failed:${turn.status}`);
const signingRequest = mecky.prepareSuggestion({
  turn,
  edits: {
    title: "Sicherere Querung an der Marienfelder Straße prüfen",
    summary: "Bitte Varianten für eine sicherere markierte Querung prüfen und die geprüfte Abwägung öffentlich darstellen.",
  },
  createdAt: 1_786_204_860,
});
const signedEvent = finalizeEvent(structuredClone(signingRequest.unsignedEvent), citizenSecret);
const signedSuggestion = mecky.acceptSignedSuggestion({ turn, signingRequest, event: signedEvent });
const after = project(coordinator);

const ordinaryEvent = finalizeEvent({
  kind: 1,
  created_at: 1_786_204_900,
  tags: [
    ["municipality", municipalityId],
    ["case", sourceCaseId],
    ["t", "stadtstack-e2e-fixture"],
  ],
  content: "Die Querung ist abends unübersichtlich.",
}, citizenSecret);
const ordinary = await mecky.answer({
  schemaVersion: "public_mecky_request_v1",
  invocation: "discussion",
  discussion: adapter.normalize(ordinaryEvent),
});

let staleWorkerCalls = 0;
const stale = await createPublicMecky({
  runtime: {
    prepareTask(request) {
      const task = runtime.prepareTask(request);
      task.context.projection.reviewedCitizenBrief.correctionState = "invalidated";
      return task;
    },
  },
  worker: {
    async run() {
      staleWorkerCalls += 1;
      throw new Error("stale_worker_must_not_run");
    },
  },
}).answer({ schemaVersion: "public_mecky_request_v1", invocation: "discussion", discussion });

const unbound = await createPublicMecky({
  runtime,
  worker: {
    async run(task) {
      const result = structuredClone(await worker.run(task));
      const answer = JSON.parse(result.answer);
      answer.facts[1].citationRefs = ["https://unreviewed.example/claim"];
      result.answer = JSON.stringify(answer);
      return result;
    },
  },
}).answer({ schemaVersion: "public_mecky_request_v1", invocation: "discussion", discussion });

const wrongSignerRequest = mecky.prepareSuggestion({
  turn,
  edits: { title: turn.suggestionDraft.title, summary: turn.suggestionDraft.summary },
  createdAt: 1_786_204_920,
});
let wrongSignerRejected = false;
try {
  mecky.acceptSignedSuggestion({
    turn,
    signingRequest: wrongSignerRequest,
    event: finalizeEvent(structuredClone(wrongSignerRequest.unsignedEvent), otherCitizenSecret),
  });
} catch (error) {
  wrongSignerRejected = error instanceof Error && error.message === "public_mecky_signature_binding_invalid";
}

if (
  ordinary.status !== "not_invoked" ||
  stale.status !== "unavailable" ||
  stale.reason !== "stale_evidence" ||
  staleWorkerCalls !== 0 ||
  unbound.status !== "unavailable" ||
  !wrongSignerRejected ||
  before.caseVersion !== after.caseVersion ||
  before.journalHeadChecksum !== after.journalHeadChecksum ||
  before.projectionChecksum !== after.projectionChecksum
) throw new Error("public_mecky_negative_or_effect_check_failed");

const receipt = {
  schemaVersion: "stadtstack.public_mecky_acceptance_evidence.v1",
  status: "completed",
  mode: "offline_synthetic_only",
  scope: { municipalityId, sourceCaseId, caseId, policyVersion },
  source: {
    discussionId: discussion.id,
    discussionSignerPubkey: discussion.event.pubkey,
    discussionVerified: discussion.verificationProof.verified,
    reviewedBriefChecksum: before.projection.reviewedCitizenBrief.briefChecksum,
    reviewedDepartmentCount: before.projection.reviewedCitizenBrief.responses.length,
  },
  answer: {
    status: turn.status,
    workerIdentityId: turn.receipt.workerIdentityId,
    factsSeparated: turn.answer.facts.length > 0,
    uncertaintySeparated: turn.answer.uncertainty.length > 0,
    reasoningSeparated: turn.answer.reasoningSummary.length > 0,
    citedDiscussion: turn.citations.some((citation) => citation.kind === "public_discussion" && citation.attributedTo === discussion.event.pubkey),
    citedReviewedArtifact: turn.citations.some((citation) => citation.kind === "reviewed_public_artifact"),
    citationRefs: turn.receipt.usedCitationRefs,
    administrationAnswerReviewRequired: turn.receipt.administrationAnswerReviewRequired,
  },
  suggestion: {
    citizenEdited: signingRequest.draft.title !== turn.suggestionDraft.title,
    signerPubkey: signedSuggestion.signerPubkey,
    nip01Verified: signedSuggestion.verification.verified,
    entryState: signedSuggestion.entryState,
    submittedToCivicWorkflow: signedSuggestion.submittedToCivicWorkflow,
    authorityBinding: signedSuggestion.authorityBinding,
  },
  negatives: {
    ordinaryDiscussion: ordinary.status,
    staleEvidence: stale.status === "unavailable" ? stale.reason : stale.status,
    staleWorkerCalls,
    unboundCitation: unbound.status,
    wrongSignerRejected,
  },
  continuity: {
    caseVersionUnchanged: before.caseVersion === after.caseVersion,
    journalHeadUnchanged: before.journalHeadChecksum === after.journalHeadChecksum,
    projectionUnchanged: before.projectionChecksum === after.projectionChecksum,
  },
  effects: {
    privateToolAccess: false,
    civicStateMutation: false,
    publication: false,
    suggestionSubmission: false,
    vote: false,
    externalNetwork: false,
    paidProvider: false,
  },
  workerCalls,
  authorityBinding: "none",
  localProofOnly: true,
  deploymentReady: false,
};
process.stdout.write(`${canonical({ ...receipt, evidenceChecksum: sha256(receipt) })}\n`);
