import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMINISTRATION_HANDOFF_OBSERVATION_SCHEMA_VERSION,
  ADMINISTRATION_PREPARATION_NO_EFFECTS,
  acceptAdministrationWorkspaceResponseAsDraft,
  checksumAdministrationWorkspaceResponse,
  prepareAdministrationWorkRequest,
  recordAdministrationWorkspaceHandoff,
  type AdministrationWorkRequestV1,
  type AdministrationWorkspaceHandoffObservationV1,
} from "../../src/adapters/administration-workspace-adapter.ts";
import {
  createCivicCaseCoordinator,
  type ProjectionEnvelope,
} from "../../src/civic-case-coordinator.ts";
import {
  createNostrDiscussionAdapter,
  type DiscussionArtifact,
} from "../../src/adapters/discussion-adapter.ts";

const scope = { municipalityId: "sample-municipality", caseId: "sample-case" };
const caseId =
  "urn:stadtstack:case:municipality:sample-municipality:018f0000-0000-7000-8000-000000000001";
const fixturePubkey =
  "7190b3fcc08cd9c4edb5ef541e8a578089cb8727ba93c4cfb0583e2287d57bd2";

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

function coordinator() {
  return createCivicCaseCoordinator({
    scope,
    syntheticFixtureOnly: true,
    allowedSignerPubkeys: [fixturePubkey],
    actors: [
      { actorId: "synthetic:citizen-1", actorClass: "citizen" },
      { actorId: "synthetic:public-1", actorClass: "public" },
      { actorId: "synthetic:administration-1", actorClass: "administration" },
      { actorId: "synthetic:steward-1", actorClass: "case_steward" },
      {
        actorId: "synthetic:planning-agent-1",
        actorClass: "department_agent",
        departmentId: "planning",
      },
      {
        actorId: "synthetic:planning-reviewer-1",
        actorClass: "department_reviewer",
        departmentId: "planning",
      },
    ],
  });
}

function project(
  instance: ReturnType<typeof coordinator>,
  visibility: "administration" | "public",
): ProjectionEnvelope {
  return instance.project({
    schemaVersion: "query_envelope_v1",
    queryType: "case_projection_v1",
    caseId,
    actorBinding:
      visibility === "administration"
        ? { actorId: "synthetic:administration-1", actorClass: "administration" }
        : { actorId: "synthetic:public-1", actorClass: "public" },
    visibility,
    policyVersion: "case-intake-v1",
    atCaseVersion: null,
  });
}

function assignedCase() {
  const instance = coordinator();
  const intake = instance.handle({
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
  const assignment = instance.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "assign_department_package_v1",
    caseId,
    actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
    expectedCaseVersion: intake.caseVersion,
    idempotencyKey: "synthetic:idem:package-planning",
    visibility: "private_case",
    policyVersion: "case-intake-v1",
    payload: {
      departmentPackage: {
        id: "package-planning-1",
        departmentId: "planning",
        suggestionId:
          "urn:stadtstack:suggestion:44ac22db49995e6ec96344b624d3ee01eb50ad814cf80f51af05959bb305412c",
        request: "Which reviewed options can make the crossing safer?",
        assignedAgentActorId: "synthetic:planning-agent-1",
        assignedReviewerActorId: "synthetic:planning-reviewer-1",
        authorityBinding: "none",
      },
    },
  });
  return { instance, assignment };
}

function preparedRequest(instance: ReturnType<typeof coordinator>): AdministrationWorkRequestV1 {
  return prepareAdministrationWorkRequest({
    projection: project(instance, "administration"),
    packageId: "package-planning-1",
    targetSystem: "openDesk",
  });
}

function observation(request: AdministrationWorkRequestV1): AdministrationWorkspaceHandoffObservationV1 {
  return {
    schemaVersion: ADMINISTRATION_HANDOFF_OBSERVATION_SCHEMA_VERSION,
    requestId: request.requestId,
    requestChecksum: request.contentChecksum,
    targetSystem: "openDesk",
    externalWorkspaceRef: "workspace:roebel-administration",
    externalTaskRef: "task:crossing-planning-1",
    acknowledgedAt: "2026-08-22T08:00:00.000Z",
    observedBy: {
      actorId: "synthetic:administration-1",
      actorClass: "administration",
    },
    authorityBinding: "none",
  };
}

test("one assigned package produces one deterministic, effect-free openDesk request", () => {
  const { instance } = assignedCase();
  const first = preparedRequest(instance);
  const second = preparedRequest(instance);

  assert.deepEqual(second, first);
  assert.equal(first.state, "prepared_not_sent");
  assert.equal(first.target.system, "openDesk");
  assert.equal(first.packageBinding.packageId, "package-planning-1");
  assert.equal(first.packageBinding.departmentId, "planning");
  assert.deepEqual(first.effects, ADMINISTRATION_PREPARATION_NO_EFFECTS);
  assert.equal(first.authorityBinding, "none");
  assert.match(first.contentChecksum, /^sha256:[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(first).includes("privateEvidence"), true);
  assert.equal(JSON.stringify(first).includes("private-evidence-1"), false);
});

test("a workspace acknowledgement is an idempotent observation, not a civic transition", () => {
  const { instance } = assignedCase();
  const request = preparedRequest(instance);
  const value = observation(request);
  const first = recordAdministrationWorkspaceHandoff(request, value);
  const replay = recordAdministrationWorkspaceHandoff(request, structuredClone(value));

  assert.deepEqual(replay, first);
  assert.equal(first.state, "acknowledged");
  assert.equal(first.authorityBinding, "none");
  assert.deepEqual(first.civicEffects, {
    civicCaseMutation: false,
    reviewAttestation: false,
    publication: false,
    formalSubmission: false,
    voting: false,
    treasuryEffect: false,
  });
  assert.equal(project(instance, "administration").caseVersion, 3);
});

test("an assigned department agent may prepare the bound return only as a draft command", () => {
  const { instance, assignment } = assignedCase();
  const request = preparedRequest(instance);
  const handoff = recordAdministrationWorkspaceHandoff(request, observation(request));
  const response = checksumAdministrationWorkspaceResponse({
    schemaVersion: "administration_workspace_response_v1",
    responseId: "response:crossing-planning-1",
    requestId: request.requestId,
    requestChecksum: request.contentChecksum,
    handoffReceiptId: handoff.receiptId,
    handoffReceiptChecksum: handoff.receiptChecksum,
    caseId,
    packageId: request.packageBinding.packageId,
    packageChecksum: request.packageBinding.packageChecksum,
    returnedAt: "2026-08-22T09:00:00.000Z",
    sourceSystem: {
      kind: "openDesk",
      recordRef: handoff.externalTaskRef,
    },
    draft: {
      publicSummary: "A raised crossing and clearer markings should be reviewed together.",
      publicCitations: ["https://stadt.roebel.example/reviewed/crossing-options"],
      privateEvidenceRefs: ["dms:planning:crossing-note-1"],
    },
    authorityBinding: "none",
  });
  const command = acceptAdministrationWorkspaceResponseAsDraft({
    request,
    handoff,
    response,
    acceptedBy: {
      actorId: "synthetic:planning-agent-1",
      actorClass: "department_agent",
    },
    expectedCaseVersion: assignment.caseVersion,
    policyVersion: "case-intake-v1",
  });

  assert.equal(command.commandType, "record_department_draft_v1");
  assert.equal(command.payload.draft.publicSummary, response.draft.publicSummary);
  assert.deepEqual(command.payload.draft.privateEvidenceRefs, ["dms:planning:crossing-note-1"]);
  assert.equal(command.actorBinding.actorClass, "department_agent");
  assert.equal(JSON.stringify(command).includes("department_review"), false);
  assert.equal(JSON.stringify(command).includes("externalTaskRef"), false);
  assert.equal(project(instance, "administration").caseVersion, assignment.caseVersion);
  assert.equal(project(instance, "public").projection.departmentPackage, undefined);
});

test("public projections and stale workspace bindings fail closed", () => {
  const { instance, assignment } = assignedCase();
  assert.throws(
    () =>
      prepareAdministrationWorkRequest({
        projection: project(instance, "public"),
        packageId: "package-planning-1",
        targetSystem: "openDesk",
      }),
    /administration_projection_invalid/,
  );

  const request = preparedRequest(instance);
  const handoff = recordAdministrationWorkspaceHandoff(request, observation(request));
  const response = checksumAdministrationWorkspaceResponse({
    schemaVersion: "administration_workspace_response_v1",
    responseId: "response:crossing-planning-stale",
    requestId: request.requestId,
    requestChecksum: request.contentChecksum,
    handoffReceiptId: handoff.receiptId,
    handoffReceiptChecksum: handoff.receiptChecksum,
    caseId,
    packageId: request.packageBinding.packageId,
    packageChecksum: request.packageBinding.packageChecksum,
    returnedAt: "2026-08-22T09:00:00.000Z",
    sourceSystem: { kind: "openDesk", recordRef: "task:another" },
    draft: {
      publicSummary: "A mismatched return must not enter the Case.",
      publicCitations: ["https://stadt.roebel.example/reviewed/crossing-options"],
      privateEvidenceRefs: [],
    },
    authorityBinding: "none",
  });
  assert.throws(
    () =>
      acceptAdministrationWorkspaceResponseAsDraft({
        request,
        handoff,
        response,
        acceptedBy: {
          actorId: "synthetic:planning-agent-1",
          actorClass: "department_agent",
        },
        expectedCaseVersion: assignment.caseVersion,
        policyVersion: "case-intake-v1",
      }),
    /administration_response_binding_invalid/,
  );
});

test("unknown fields, credential-like references, and self-review identities are rejected", () => {
  const { instance, assignment } = assignedCase();
  const request = preparedRequest(instance);
  const invalidObservation = {
    ...observation(request),
    prompt: "hidden",
  };
  assert.throws(
    () =>
      recordAdministrationWorkspaceHandoff(
        request,
        invalidObservation as unknown as AdministrationWorkspaceHandoffObservationV1,
      ),
    /administration_handoff_observation_invalid/,
  );
  assert.throws(
    () =>
      recordAdministrationWorkspaceHandoff(request, {
        ...observation(request),
        externalTaskRef: "task:secret:credential",
      }),
    /administration_handoff_observation_invalid/,
  );

  const handoff = recordAdministrationWorkspaceHandoff(request, observation(request));
  const response = checksumAdministrationWorkspaceResponse({
    schemaVersion: "administration_workspace_response_v1",
    responseId: "response:crossing-planning-reviewer",
    requestId: request.requestId,
    requestChecksum: request.contentChecksum,
    handoffReceiptId: handoff.receiptId,
    handoffReceiptChecksum: handoff.receiptChecksum,
    caseId,
    packageId: request.packageBinding.packageId,
    packageChecksum: request.packageBinding.packageChecksum,
    returnedAt: "2026-08-22T09:00:00.000Z",
    sourceSystem: { kind: "openDesk", recordRef: handoff.externalTaskRef },
    draft: {
      publicSummary: "A return still needs the assigned department agent.",
      publicCitations: ["https://stadt.roebel.example/reviewed/crossing-options"],
      privateEvidenceRefs: [],
    },
    authorityBinding: "none",
  });
  assert.throws(
    () =>
      acceptAdministrationWorkspaceResponseAsDraft({
        request,
        handoff,
        response,
        acceptedBy: {
          actorId: "synthetic:planning-reviewer-1",
          actorClass: "department_reviewer",
        },
        expectedCaseVersion: assignment.caseVersion,
        policyVersion: "case-intake-v1",
      }),
    /administration_response_acceptor_forbidden/,
  );
});
