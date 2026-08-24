#!/usr/bin/env node

import { createCivicCaseCoordinator } from "../src/civic-case-coordinator.ts";
import { createNostrDiscussionAdapter } from "../src/adapters/discussion-adapter.ts";

const scope = {
  municipalityId: "sample-municipality",
  caseId: "sample-case",
};
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
const discussion = createNostrDiscussionAdapter({
  scope,
  syntheticFixtureOnly: true,
}).normalize(event);
const coordinator = createCivicCaseCoordinator({
  scope,
  syntheticFixtureOnly: true,
  allowedSignerPubkeys: [event.pubkey],
});
const caseId = "urn:stadtstack:case:municipality:sample-municipality:018f0000-0000-7000-8000-000000000001";
const receipt = coordinator.handle({
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
const queryBase = {
  schemaVersion: "query_envelope_v1",
  queryType: "case_projection_v1",
  caseId,
  policyVersion: "case-intake-v1",
  atCaseVersion: null,
};
const publicProjection = coordinator.project({
  ...queryBase,
  actorBinding: { actorId: "synthetic:public-1", actorClass: "public" },
  visibility: "public",
});
const administrationProjection = coordinator.project({
  ...queryBase,
  actorBinding: { actorId: "synthetic:administration-1", actorClass: "administration" },
  visibility: "administration",
});
process.stdout.write(`${JSON.stringify({
  schemaVersion: "stadtstack.case_intake_receipt.v1",
  status: "completed",
  mode: "offline_synthetic_only",
  receipt,
  publicProjection,
  administrationProjection,
  authorityBinding: "none",
  externalNetworkCalled: false,
  publicPublication: false,
  formalVote: false,
})}\n`);
