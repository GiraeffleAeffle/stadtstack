import assert from "node:assert/strict";
import test from "node:test";

import { finalizeEvent } from "nostr-tools/pure";

import { createNostrDiscussionAdapter } from "../src/adapters/discussion-adapter.ts";
import { createCivicCaseCoordinator } from "../src/civic-case-coordinator.ts";

const municipalityId = "roebel-mueritz";
const sourceCaseId = "marienfelder-strasse";
const canonicalCaseId = "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001";
const policyVersion = "roebel-permanent-v1";
const secret = new Uint8Array(32).fill(21);

function discussion(extraTags: string[][] = []) {
  const event = finalizeEvent({
    kind: 1,
    created_at: 1_786_454_400,
    tags: [
      ["municipality", municipalityId],
      ["case", sourceCaseId],
      ...extraTags,
    ],
    content: "@Mecky Wie kann die Querung der Marienfelder Straße sicherer werden?",
  }, secret);
  return createNostrDiscussionAdapter({
    scope: { municipalityId, caseId: sourceCaseId },
  }).normalize(event);
}

function coordinator() {
  return createCivicCaseCoordinator({
    scope: { municipalityId, caseId: sourceCaseId },
    jurisdiction: { scheme: "municipality", value: municipalityId },
    canonicalCaseId,
    policyVersion,
    discussionTrustMode: "verified_public_nostr",
    requireSignedSuggestionAdmission: true,
    actors: [
      { actorId: "roebel:nostr-ingestor", actorClass: "citizen" },
      { actorId: "roebel:public-reader", actorClass: "public" },
    ],
  });
}

function intake(value = discussion()) {
  return {
    schemaVersion: "command_envelope_v1" as const,
    commandType: "intake_discussion_v1" as const,
    caseId: canonicalCaseId,
    actorBinding: { actorId: "roebel:nostr-ingestor", actorClass: "citizen" as const },
    expectedCaseVersion: 0,
    idempotencyKey: `roebel:discussion:${value.event.id}`,
    visibility: "private_case" as const,
    policyVersion,
    payload: { discussion: value },
  };
}

test("accepts a scope-bound NIP-01 discussion without a synthetic fixture marker", () => {
  const runtime = coordinator();
  const receipt = runtime.handle(intake());
  assert.equal(receipt.caseVersion, 2);
  assert.equal(receipt.eventIds.length, 2);
  const projection = runtime.project({
    schemaVersion: "query_envelope_v1",
    queryType: "case_projection_v1",
    caseId: canonicalCaseId,
    actorBinding: { actorId: "roebel:public-reader", actorClass: "public" },
    visibility: "public",
    policyVersion,
    atCaseVersion: null,
  });
  assert.equal(projection.projection.jurisdiction.scheme, "municipality");
  assert.equal(projection.projection.discussion.verificationProof.kind, "nostr_nip01");
  assert.equal(projection.projection.discussion.event.pubkey, discussion().event.pubkey);
});

test("rejects fixture-marked or signature-drifted discussions in the permanent lane", () => {
  assert.throws(
    () => coordinator().handle(intake(discussion([["t", "stadtstack-e2e-fixture"]]))),
    /discussion_fixture_marker_forbidden/,
  );
  const forged = discussion();
  if (forged.verificationProof.kind !== "nostr_nip01") throw new Error("fixture_invalid");
  forged.verificationProof.signature = "0".repeat(128);
  forged.event.id = "0".repeat(64);
  assert.throws(() => coordinator().handle(intake(forged)), /discussion_event_invalid|discussion_proof_invalid/);
});

test("does not allow production trust with the synthetic Case namespace", () => {
  assert.throws(() => createCivicCaseCoordinator({
    scope: { municipalityId, caseId: sourceCaseId },
    jurisdiction: { scheme: "test", value: municipalityId },
    canonicalCaseId: "urn:stadtstack:case:test:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
    discussionTrustMode: "verified_public_nostr",
    actors: [{ actorId: "roebel:public-reader", actorClass: "public" }],
  }), /discussion_trust_namespace_invalid/);
});
