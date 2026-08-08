import assert from "node:assert/strict";
import test from "node:test";

import {
  createCivicCaseCoordinator,
  DETERMINISTIC_REVIEWED_AT,
  type CivicCaseCoordinator,
} from "../src/civic-case-coordinator.ts";
import {
  createCoordinatorCompanionRuntime,
  type CoordinatorCompanionRuntimeConfig,
} from "../src/companion-runtime.ts";
import {
  createCompanionIdentityPolicy,
  createDeterministicLocalCompanionAdapter,
  createOpenClawCompanionAdapter,
  prepareCompanionWorkerTask,
  validateCompanionWorkerResult,
  validateCompanionWorkerTask,
} from "../src/adapters/companion-harness.ts";
import { createNostrDiscussionAdapter } from "../src/adapters/discussion-adapter.ts";

const scope = { municipalityId: "sample-municipality", caseId: "sample-case" };
const caseId = "urn:stadtstack:case:test:sample-municipality:018f0000-0000-7000-8000-000000000001";
const fixturePubkey = "7190b3fcc08cd9c4edb5ef541e8a578089cb8727ba93c4cfb0583e2287d57bd2";
const discussionId = "44ac22db49995e6ec96344b624d3ee01eb50ad814cf80f51af05959bb305412c";
const departments = ["planning", "traffic", "environment", "finance", "legal", "public-order", "social-affairs", "public-works"] as const;

const actors = {
  public: { actorId: "synthetic:public-1", actorClass: "public" as const },
  administration: { actorId: "synthetic:administration-1", actorClass: "administration" as const },
  council: { actorId: "synthetic:council-1", actorClass: "council" as const },
};
const identities = {
  public: "did:stadtstack:sample:mecky-public",
  administration: "did:stadtstack:sample:mecky-administration",
  council: "did:stadtstack:sample:mecky-council",
} as const;
const sessions = {
  public: "session:public:sample-case",
  administration: "session:administration:sample-case",
  council: "session:council:sample-case",
} as const;

function coordinator(): CivicCaseCoordinator {
  const coordinator = createCivicCaseCoordinator({
    scope,
    syntheticFixtureOnly: true,
    allowedSignerPubkeys: [fixturePubkey],
    actors: [
      { actorId: "synthetic:citizen-1", actorClass: "citizen" },
      actors.public,
      actors.administration,
      actors.council,
    ],
  });
  const discussion = createNostrDiscussionAdapter({ scope, syntheticFixtureOnly: true }).normalize({
    kind: 1,
    created_at: 1_754_035_200,
    tags: [["municipality", scope.municipalityId], ["case", scope.caseId], ["t", "stadtstack-e2e-fixture"]],
    content: "Could the crossing be made safer?",
    pubkey: fixturePubkey,
    id: discussionId,
    sig: "4db87c0f4d8d36de728c086bbec21a19224b639f29bf3334d032cc9584b39db4d4f41180a3485c440c83583a61937b53e9de4fe13d375b4635d23590917cf80e",
  });
  coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "intake_discussion_v1",
    caseId,
    actorBinding: { actorId: "synthetic:citizen-1", actorClass: "citizen" },
    expectedCaseVersion: 0,
    idempotencyKey: "synthetic:idem:discussion-1",
    visibility: "private_case",
    policyVersion: "case-intake-v1",
    payload: { discussion },
  });
  return coordinator;
}

function runtimeConfig(caseCoordinator: CivicCaseCoordinator): CoordinatorCompanionRuntimeConfig {
  return {
    coordinator: { project: caseCoordinator.project },
    caseId,
    policyVersion: "case-intake-v1",
    actors,
    identities,
    sessions,
  };
}

function reviewedCoordinator(): CivicCaseCoordinator {
  const caseCoordinator = createCivicCaseCoordinator({
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
        { actorId: `synthetic:${departmentId}-agent`, actorClass: "department_agent" as const, departmentId },
        { actorId: `synthetic:${departmentId}-reviewer`, actorClass: "department_reviewer" as const, departmentId },
      ]),
    ],
  });
  const discussion = createNostrDiscussionAdapter({ scope, syntheticFixtureOnly: true }).normalize({
    kind: 1,
    created_at: 1_754_035_200,
    tags: [["municipality", scope.municipalityId], ["case", scope.caseId], ["t", "stadtstack-e2e-fixture"]],
    content: "Could the crossing be made safer?",
    pubkey: fixturePubkey,
    id: discussionId,
    sig: "4db87c0f4d8d36de728c086bbec21a19224b639f29bf3334d032cc9584b39db4d4f41180a3485c440c83583a61937b53e9de4fe13d375b4635d23590917cf80e",
  });
  let version = caseCoordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "intake_discussion_v1",
    caseId,
    actorBinding: { actorId: "synthetic:citizen-1", actorClass: "citizen" },
    expectedCaseVersion: 0,
    idempotencyKey: "synthetic:idem:reviewed-discussion-1",
    visibility: "private_case",
    policyVersion: "case-intake-v1",
    payload: { discussion },
  }).caseVersion;
  for (const departmentId of departments) {
    version = caseCoordinator.handle({
      schemaVersion: "command_envelope_v1",
      commandType: "assign_department_package_v1",
      caseId,
      actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
      expectedCaseVersion: version,
      idempotencyKey: `synthetic:idem:reviewed-package-${departmentId}`,
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
    }).caseVersion;
  }
  for (const departmentId of departments) {
    const packageProjection = caseCoordinator.project({
      schemaVersion: "query_envelope_v1",
      queryType: "case_projection_v1",
      caseId,
      actorBinding: actors.administration,
      visibility: "administration",
      policyVersion: "case-intake-v1",
      atCaseVersion: null,
    }).projection.departmentPackages!.find((item) => item.departmentId === departmentId)!;
    const draft = caseCoordinator.handle({
      schemaVersion: "command_envelope_v1",
      commandType: "record_department_draft_v1",
      caseId,
      actorBinding: { actorId: `synthetic:${departmentId}-agent`, actorClass: "department_agent" },
      expectedCaseVersion: version,
      idempotencyKey: `synthetic:idem:reviewed-draft-${departmentId}`,
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
    const drafted = caseCoordinator.project({
      schemaVersion: "query_envelope_v1",
      queryType: "case_projection_v1",
      caseId,
      actorBinding: actors.administration,
      visibility: "administration",
      policyVersion: "case-intake-v1",
      atCaseVersion: null,
    }).projection.departmentPackages!.find((item) => item.departmentId === departmentId)!;
    version = caseCoordinator.handle({
      schemaVersion: "command_envelope_v1",
      commandType: "attest_department_review_v1",
      caseId,
      actorBinding: { actorId: `synthetic:${departmentId}-reviewer`, actorClass: "department_reviewer" },
      expectedCaseVersion: draft.caseVersion,
      idempotencyKey: `synthetic:idem:reviewed-review-${departmentId}`,
      visibility: "private_case",
      policyVersion: "case-intake-v1",
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
  const admin = caseCoordinator.project({
    schemaVersion: "query_envelope_v1",
    queryType: "case_projection_v1",
    caseId,
    actorBinding: actors.administration,
    visibility: "administration",
    policyVersion: "case-intake-v1",
    atCaseVersion: null,
  }).projection;
  const sourceBindings = admin.departmentPackages!.map((item) => ({
    packageId: item.id,
    packageChecksum: item.packageChecksum,
    draftArtifactChecksum: item.draft!.artifactChecksum,
    reviewAttestationChecksum: item.review!.attestationChecksum!,
  }));
  caseCoordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "derive_citizen_brief_v1",
    caseId,
    actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
    expectedCaseVersion: version,
    idempotencyKey: "synthetic:idem:reviewed-brief-1",
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
  return caseCoordinator;
}

test("coordinator companion tasks carry role projections and bound context metadata", () => {
  const caseCoordinator = coordinator();
  const runtime = createCoordinatorCompanionRuntime(runtimeConfig(caseCoordinator));
  assert.equal("handle" in runtime, false);
  const policy = createCompanionIdentityPolicy(identities);
  const publicTask = runtime.prepareTask({ profile: "public", question: "What is ready for review?" });
  const administrationTask = runtime.prepareTask({ profile: "administration", question: "What is ready for review?" });
  const councilTask = runtime.prepareTask({ profile: "council", question: "What is ready for review?" });

  const publicProjection = caseCoordinator.project({
    schemaVersion: "query_envelope_v1",
    queryType: "case_projection_v1",
    caseId,
    actorBinding: actors.public,
    visibility: "public",
    policyVersion: "case-intake-v1",
    atCaseVersion: null,
  });
  assert.equal(publicTask.context.profile, "public");
  assert.equal((publicTask.context as any).visibility, "public");
  assert.equal((publicTask.context as any).caseVersion, publicProjection.caseVersion);
  assert.equal((publicTask.context as any).journalHeadChecksum, publicProjection.journalHeadChecksum);
  assert.equal((publicTask.context as any).projectionChecksum, publicProjection.projectionChecksum);
  assert.equal((publicTask.context as any).policyVersion, publicProjection.policyVersion);
  assert.deepEqual((publicTask.context as any).projection, publicProjection.projection);
  assert.notEqual((publicTask.context as any).projection, publicProjection.projection);

  assert.notEqual(publicTask.workerIdentity, administrationTask.workerIdentity);
  assert.notEqual(administrationTask.workerIdentity, councilTask.workerIdentity);
  assert.equal(publicTask.sessionKey, sessions.public);
  assert.equal(administrationTask.sessionKey, sessions.administration);
  assert.equal(councilTask.sessionKey, sessions.council);

  const workerTask = prepareCompanionWorkerTask(publicTask, { identityPolicy: policy });
  assert.equal(workerTask.caseId, caseId);
  assert.equal(workerTask.sessionKey, sessions.public);
  assert.deepEqual(workerTask.context.projection, (publicTask.context as any).projection);
  assert.match(workerTask.contextChecksum, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(workerTask.citations.map((citation) => citation.ref), (publicTask.context as any).citations);
  assert.deepEqual(workerTask.artifactBindings, (publicTask.context as any).artifactBindings);
  assert.deepEqual(workerTask.aiAttribution, (publicTask.context as any).aiAttribution);
});

test("deterministic local and injected OpenClaw adapters share the closed coordinator bindings", async () => {
  const caseCoordinator = coordinator();
  const runtime = createCoordinatorCompanionRuntime(runtimeConfig(caseCoordinator));
  const identityPolicy = createCompanionIdentityPolicy(identities);
  const local = createDeterministicLocalCompanionAdapter({ identityPolicy });
  const openclaw = createOpenClawCompanionAdapter({
    send(request) {
      return local.resultFor(request);
    },
  }, { identityPolicy });
  const localTask = runtime.prepareTask({ profile: "public", question: "What is ready for review?" });
  const localResult = await local.run(localTask);
  const repeatedResult = await local.run(localTask);
  const openclawResult = await openclaw.run(localTask);

  assert.deepEqual(localResult, repeatedResult);
  assert.equal(localResult.aiAttribution.adapterKind, "deterministic-local");
  assert.equal(openclawResult.aiAttribution.adapterKind, "openclaw");
  assert.equal(localResult.caseId, caseId);
  assert.equal(openclawResult.contextChecksum, localResult.contextChecksum);
  assert.deepEqual(openclawResult.artifactBindings, localResult.artifactBindings);
  assert.deepEqual(openclawResult.citations, localResult.citations);
  assert.deepEqual(openclawResult.allowedTools, []);
  assert.deepEqual(openclawResult.tools.deny, ["*"]);
  assert.deepEqual(openclawResult.prohibitedEffects, [
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

test("coordinator role projections keep private department evidence out of public and council worker contexts", () => {
  const caseCoordinator = reviewedCoordinator();
  const runtime = createCoordinatorCompanionRuntime(runtimeConfig(caseCoordinator));
  const administration = runtime.prepareTask({ profile: "administration", question: "What still needs review?" });
  const council = runtime.prepareTask({ profile: "council", question: "What is ready for council?" });
  const publicTask = runtime.prepareTask({ profile: "public", question: "What is happening?" });

  assert.match(JSON.stringify((administration.context as any).projection), /privateEvidenceRefs/);
  assert.doesNotMatch(JSON.stringify((council.context as any).projection), /privateEvidenceRefs|assignedAgentActorId|assignedReviewerActorId|reviewerActorId/);
  assert.doesNotMatch(JSON.stringify((publicTask.context as any).projection), /privateEvidenceRefs|assignedAgentActorId|assignedReviewerActorId|reviewerActorId/);
  assert.equal((council.context as any).projection.councilDryRunBrief?.state, "dry_run_not_submitted");
  assert.equal((publicTask.context as any).projection.councilDryRunBrief, undefined);
});

test("coordinator worker bindings fail closed on role, session, projection, and checksum reuse", () => {
  const caseCoordinator = coordinator();
  const runtime = createCoordinatorCompanionRuntime(runtimeConfig(caseCoordinator));
  const policy = createCompanionIdentityPolicy(identities);
  const publicTask = runtime.prepareTask({ profile: "public", question: "What is ready?" });
  const publicRequest = prepareCompanionWorkerTask(publicTask, { identityPolicy: policy });
  assert.throws(() => prepareCompanionWorkerTask(publicTask, {
    identityPolicy: policy,
    sessionKey: sessions.council,
  }), /worker_session_override_mismatch/);
  const crossRoleTask = structuredClone(publicTask);
  delete crossRoleTask.sessionKey;
  assert.throws(() => prepareCompanionWorkerTask(crossRoleTask, {
    identityPolicy: policy,
    sessionKey: sessions.council,
  }), /worker_session_not_allowed:public/);
  assert.throws(() => prepareCompanionWorkerTask(publicTask, {
    identityPolicy: policy,
    sessionKey: "session:public:other",
  }), /worker_session_override_mismatch/);

  const profileForged = structuredClone(publicRequest);
  profileForged.identity.profile = "council";
  assert.throws(() => validateCompanionWorkerTask(profileForged, policy), /worker_task_identity_profile_mismatch/);

  const sessionForged = structuredClone(publicRequest);
  sessionForged.sessionKey = sessions.council;
  assert.throws(() => validateCompanionWorkerTask(sessionForged, policy), /worker_session_not_allowed:public/);

  const projectionForged = structuredClone(publicRequest);
  (projectionForged.context.projection as any).authorityBinding = "forged";
  assert.throws(() => validateCompanionWorkerTask(projectionForged, policy), /worker_task_projection_checksum_mismatch|worker_task_context_checksum_mismatch/);

  const journalForged = structuredClone(publicRequest);
  journalForged.context.journalHeadChecksum = `sha256:${"0".repeat(64)}`;
  assert.throws(() => validateCompanionWorkerTask(journalForged, policy), /worker_task_context_checksum_mismatch/);

  const contextForged = structuredClone(publicRequest);
  contextForged.contextChecksum = `sha256:${"0".repeat(64)}`;
  assert.throws(() => validateCompanionWorkerTask(contextForged, policy), /worker_task_context_checksum_mismatch/);
});

test("coordinator worker envelopes reject private fields, unknown aliases, unbound artifacts, and effect requests", async () => {
  const caseCoordinator = coordinator();
  const runtime = createCoordinatorCompanionRuntime(runtimeConfig(caseCoordinator));
  const policy = createCompanionIdentityPolicy(identities);
  const task = runtime.prepareTask({ profile: "public", question: "What is ready?" });
  const request = prepareCompanionWorkerTask(task, { identityPolicy: policy });
  const adapter = createDeterministicLocalCompanionAdapter({ identityPolicy: policy });
  const valid = adapter.resultFor(request);

  const unknownTask = structuredClone(request) as any;
  unknownTask.prompt = "hidden provider prompt";
  assert.throws(() => validateCompanionWorkerTask(unknownTask, policy), /field_forbidden:task\.prompt/);

  const privateTask = structuredClone(request) as any;
  privateTask.context.projection.privateEvidenceRefs = ["synthetic://private/evidence"];
  privateTask.contextChecksum = request.contextChecksum;
  assert.throws(() => validateCompanionWorkerTask(privateTask, policy), /private_projection_field_forbidden:public/);

  const unboundCitationTask = runtime.prepareTask({ profile: "public", question: "What is ready?" });
  (unboundCitationTask.context as any).citations = ["synthetic://unbound/task-citation"];
  assert.throws(() => prepareCompanionWorkerTask(unboundCitationTask, { identityPolicy: policy }), /worker_task_citations_unbound/);

  const unboundArtifact = structuredClone(request);
  unboundArtifact.artifactBindings[0].ref = "synthetic://not-in-projection";
  assert.throws(() => validateCompanionWorkerTask(unboundArtifact, policy), /artifact_binding_mismatch/);

  const effectResult = structuredClone(valid) as any;
  effectResult.effects = ["publish"];
  assert.throws(() => validateCompanionWorkerResult(request, effectResult, policy), /field_forbidden:result\.effects/);

  const privateResult = structuredClone(valid) as any;
  privateResult.answer = "The private departmentWorkPackages should be visible.";
  assert.throws(() => validateCompanionWorkerResult(request, privateResult, policy), /private_leakage/);

  let sent = 0;
  const failingOpenClaw = createOpenClawCompanionAdapter({
    send() {
      sent += 1;
      throw new Error("provider_transport_failed");
    },
  }, { identityPolicy: policy });
  await assert.rejects(() => failingOpenClaw.run(task), /provider_transport_failed/);
  assert.equal(sent, 1);

  const unsafeQuestionTask = runtime.prepareTask({ profile: "public", question: "What is ready?" });
  unsafeQuestionTask.question = "private nsec1leaked-secret";
  let unsafeSent = 0;
  const guardedOpenClaw = createOpenClawCompanionAdapter({
    send() {
      unsafeSent += 1;
      return valid;
    },
  }, { identityPolicy: policy });
  await assert.rejects(() => guardedOpenClaw.run(unsafeQuestionTask), /worker_task_private_leakage/);
  assert.equal(unsafeSent, 0);
});

test("coordinator runtime configuration keeps actors, identities, and sessions closed and role-bound", () => {
  const caseCoordinator = coordinator();
  assert.throws(() => createCoordinatorCompanionRuntime({
    ...runtimeConfig(caseCoordinator),
    sessions: { ...sessions, extra: "session:public:extra" } as any,
  }), /coordinator_sessions_invalid/);
  assert.throws(() => createCoordinatorCompanionRuntime({
    ...runtimeConfig(caseCoordinator),
    actors: { ...actors, public: { ...actors.public, extra: "forged" } } as any,
  }), /coordinator_actor_binding_invalid:public/);
  assert.throws(() => createCoordinatorCompanionRuntime({
    ...runtimeConfig(caseCoordinator),
    sessions: { ...sessions, administration: "session:public:wrong-role" },
  }), /worker_session_not_allowed:administration/);
});
