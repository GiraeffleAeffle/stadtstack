import assert from "node:assert/strict";
import test from "node:test";

import {
  createCivicCaseCoordinator,
  type CommandEnvelope,
} from "../src/civic-case-coordinator.ts";
import {
  createNostrDiscussionAdapter,
  type DiscussionArtifact,
} from "../src/adapters/discussion-adapter.ts";

const scope = {
  municipalityId: "sample-municipality",
  caseId: "sample-case",
};
const FIXTURE_PUBKEY = "7190b3fcc08cd9c4edb5ef541e8a578089cb8727ba93c4cfb0583e2287d57bd2";

function signedDiscussion(): DiscussionArtifact {
  const event = {
    kind: 1,
    created_at: 1_754_035_200,
    tags: [
      ["municipality", scope.municipalityId],
      ["case", scope.caseId],
      ["t", "stadtstack-e2e-fixture"],
    ],
    content: "Could the crossing be made safer?",
    pubkey: "7190b3fcc08cd9c4edb5ef541e8a578089cb8727ba93c4cfb0583e2287d57bd2",
    id: "44ac22db49995e6ec96344b624d3ee01eb50ad814cf80f51af05959bb305412c",
    sig: "4db87c0f4d8d36de728c086bbec21a19224b639f29bf3334d032cc9584b39db4d4f41180a3485c440c83583a61937b53e9de4fe13d375b4635d23590917cf80e",
  };
  return createNostrDiscussionAdapter({
    scope,
    syntheticFixtureOnly: true,
  }).normalize(event);
}

function command(discussion: DiscussionArtifact, key = "synthetic:idem:discussion-1") {
  return {
    schemaVersion: "command_envelope_v1",
    commandType: "intake_discussion_v1",
    caseId: "urn:stadtstack:case:test:sample-municipality:018f0000-0000-7000-8000-000000000001",
    actorBinding: { actorId: "synthetic:citizen-1", actorClass: "citizen" },
    expectedCaseVersion: 0,
    idempotencyKey: key,
    visibility: "private_case",
    policyVersion: "case-intake-v1",
    payload: { discussion },
  } satisfies CommandEnvelope;
}

function createCoordinator() {
  return createCivicCaseCoordinator({
    scope,
    syntheticFixtureOnly: true,
    allowedSignerPubkeys: [FIXTURE_PUBKEY],
  });
}

test("intake appends a deterministic checksum chain and projects one case", () => {
  const discussion = signedDiscussion();
  const coordinator = createCoordinator();
  const first = coordinator.handle(command(discussion));

  assert.equal(first.caseVersion, 2);
  assert.equal(first.eventIds.length, 2);
  assert.match(first.journalHeadChecksum, /^sha256:[0-9a-f]{64}$/);

  const publicView = coordinator.project({
    schemaVersion: "query_envelope_v1",
    queryType: "case_projection_v1",
    caseId: command(discussion).caseId,
    actorBinding: { actorId: "synthetic:public-1", actorClass: "public" },
    visibility: "public",
    policyVersion: "case-intake-v1",
    atCaseVersion: null,
  });
  assert.equal(publicView.projection.authorityBinding, "none");
  assert.equal(publicView.projection.discussions.length, 1);
  assert.equal(publicView.projection.suggestions.length, 1);
  assert.equal(publicView.projection.suggestions[0]?.authorityBinding, "none");
  assert.equal(publicView.projection.discussions[0]?.provenance.source, "nostr");
  assert.equal(publicView.projection.discussions[0]?.provenance.event.id, discussion.event.id);
});

test("identical replay returns the original receipt and conflicting replay fails closed", () => {
  const discussion = signedDiscussion();
  const coordinator = createCoordinator();
  const first = coordinator.handle(command(discussion));
  assert.deepEqual(coordinator.handle(command(discussion)), first);
  assert.throws(
    () => coordinator.handle({
      ...command(discussion),
      expectedCaseVersion: 1,
    }),
    /idempotency_conflict/,
  );
});

test("invalid signature, actor binding, version, and unknown fields are rejected", () => {
  const discussion = signedDiscussion();
  const coordinator = createCoordinator();
  const badSignature = {
    ...discussion,
    verificationProof: {
      kind: "nostr_nip01" as const,
      verified: true as const,
      signature: "0".repeat(128),
    },
  };
  assert.throws(
    () => coordinator.handle(command(badSignature)),
    /discussion_event_signature_invalid|discussion_proof_invalid/,
  );
  assert.throws(
    () => coordinator.handle({ ...command(discussion), extra: true }),
    /unknown_field:envelope.extra/,
  );
  assert.throws(
    () => coordinator.handle({
      ...command(discussion),
      actorBinding: { actorId: "synthetic:unknown", actorClass: "citizen" },
    }),
    /actor_not_registered/,
  );
  const accepted = coordinator.handle(command(discussion));
  assert.throws(
    () => coordinator.handle({
      ...command(discussion, "synthetic:idem:discussion-2"),
      expectedCaseVersion: accepted.caseVersion - 1,
    }),
    /case_version_conflict/,
  );
});

test("fresh deterministic runs and reordered closed objects produce the same receipt", () => {
  const discussion = signedDiscussion();
  const firstCoordinator = createCoordinator();
  const first = firstCoordinator.handle(command(discussion));
  const reorderedDiscussion = {
    event: discussion.event,
    verificationProof: discussion.verificationProof,
    authorityBinding: discussion.authorityBinding,
    caseId: discussion.caseId,
    municipalityId: discussion.municipalityId,
    sourceRef: discussion.sourceRef,
    source: discussion.source,
    id: discussion.id,
    schemaVersion: discussion.schemaVersion,
  } satisfies DiscussionArtifact;
  const secondCoordinator = createCoordinator();
  const second = secondCoordinator.handle(command(reorderedDiscussion));
  assert.deepEqual(second, first);
  const query = {
    schemaVersion: "query_envelope_v1" as const,
    queryType: "case_projection_v1" as const,
    caseId: command(discussion).caseId,
    actorBinding: { actorId: "synthetic:public-1" as const, actorClass: "public" as const },
    visibility: "public" as const,
    policyVersion: "case-intake-v1",
    atCaseVersion: null,
  };
  assert.deepEqual(
    secondCoordinator.project(query),
    firstCoordinator.project(query),
  );
});

test("normalized command whitespace and key order do not change idempotent intent", () => {
  const discussion = signedDiscussion();
  const coordinator = createCoordinator();
  const first = coordinator.handle(command(discussion));
  const reordered = {
    payload: { discussion },
    policyVersion: "  case-intake-v1  ",
    visibility: "private_case" as const,
    idempotencyKey: "  synthetic:idem:discussion-1  ",
    expectedCaseVersion: 0,
    actorBinding: { actorClass: "citizen" as const, actorId: "  synthetic:citizen-1  " },
    caseId: `  ${command(discussion).caseId}  `,
    commandType: "intake_discussion_v1" as const,
    schemaVersion: "command_envelope_v1" as const,
  } satisfies CommandEnvelope;
  assert.deepEqual(coordinator.handle(reordered), first);
});

test("future or stale new keys fail before duplicate detection and leave the valid path intact", () => {
  const discussion = signedDiscussion();
  const futureCoordinator = createCoordinator();
  assert.throws(
    () => futureCoordinator.handle({ ...command(discussion), expectedCaseVersion: 1 }),
    /case_version_conflict/,
  );
  const futureReceipt = futureCoordinator.handle(command(discussion));
  assert.equal(futureReceipt.caseVersion, 2);

  const coordinator = createCoordinator();
  const receipt = coordinator.handle(command(discussion));
  assert.throws(
    () => coordinator.handle({ ...command(discussion, "synthetic:idem:discussion-2"), expectedCaseVersion: receipt.caseVersion }),
    /discussion_already_recorded/,
  );
});

test("fixture signer allowlist, exact marker, and obvious secret content fail closed", () => {
  const discussion = signedDiscussion();
  assert.throws(
    () => createCivicCaseCoordinator({ scope }).handle(command(discussion)),
    /discussion_signer_not_allowed/,
  );
  assert.throws(
    () => createCivicCaseCoordinator({
      scope,
      fixturePubkey: "0".repeat(64),
    }).handle(command(discussion)),
    /discussion_signer_not_allowed/,
  );
  const wrongMarker = {
    ...discussion,
    event: {
      ...discussion.event,
      tags: discussion.event.tags.map((tag) => tag[0] === "t" ? ["t", "wrong-marker"] : tag),
    },
  };
  assert.throws(
    () => createCoordinator().handle(command(wrongMarker)),
    /discussion_fixture_marker_required|discussion_event_id_invalid|discussion_event_signature_invalid/,
  );
  const secretContent = {
    ...discussion,
    event: { ...discussion.event, content: "credential: leaked" },
  };
  assert.throws(
    () => createCoordinator().handle(command(secretContent)),
    /secret_material_forbidden/,
  );
});

test("bad event ID, scope, actor class, and public visibility requests fail closed", () => {
  const discussion = signedDiscussion();
  const badEventId = {
    ...discussion,
    id: "55ac22db49995e6ec96344b624d3ee01eb50ad814cf80f51af05959bb305412c",
    event: {
      ...discussion.event,
      id: "55ac22db49995e6ec96344b624d3ee01eb50cf80f51af05959bb305412c",
    },
  };
  assert.throws(
    () => createCoordinator().handle(command(badEventId)),
    /discussion_event_id_invalid|discussion_proof_invalid/,
  );
  const wrongScope = {
    ...discussion,
    municipalityId: "another-municipality",
  };
  assert.throws(
    () => createCoordinator().handle(command(wrongScope)),
    /discussion_scope_mismatch/,
  );
  assert.throws(
    () => createCoordinator().handle({
      ...command(discussion),
      actorBinding: { actorId: "synthetic:citizen-1", actorClass: "public" },
    }),
    /actor_binding_mismatch/,
  );
  const coordinator = createCoordinator();
  coordinator.handle(command(discussion));
  assert.throws(
    () => coordinator.project({
      schemaVersion: "query_envelope_v1",
      queryType: "case_projection_v1",
      caseId: command(discussion).caseId,
      actorBinding: { actorId: "synthetic:public-1", actorClass: "public" },
      visibility: "administration",
      policyVersion: "case-intake-v1",
      atCaseVersion: null,
    }),
    /projection_visibility_forbidden/,
  );
  // The failed queries do not alter the journal; an authorized query remains valid.
  assert.equal(coordinator.project({
    schemaVersion: "query_envelope_v1",
    queryType: "case_projection_v1",
    caseId: command(discussion).caseId,
    actorBinding: { actorId: "synthetic:public-1", actorClass: "public" },
    visibility: "public",
    policyVersion: "case-intake-v1",
    atCaseVersion: null,
  }).caseVersion, 2);
});
