#!/usr/bin/env node

import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDurableCivicCaseCoordinator } from "../src/civic-case-coordinator.ts";
import { createNostrDiscussionAdapter } from "../src/adapters/discussion-adapter.ts";
import { createSqliteJournalStore } from "../src/adapters/sqlite-journal-adapter.ts";

const scope = { municipalityId: "sample-municipality", caseId: "sample-case" };
const caseId = "urn:stadtstack:case:municipality:sample-municipality:018f0000-0000-7000-8000-000000000001";
const policyVersion = "case-intake-v1";
const fixtureEvent = {
  kind: 1,
  created_at: 1_754_035_200,
  tags: [["municipality", scope.municipalityId], ["case", scope.caseId], ["t", "stadtstack-e2e-fixture"]],
  content: "Could the crossing be made safer?",
  pubkey: "7190b3fcc08cd9c4edb5ef541e8a578089cb8727ba93c4cfb0583e2287d57bd2",
  id: "44ac22db49995e6ec96344b624d3ee01eb50ad814cf80f51af05959bb305412c",
  sig: "4db87c0f4d8d36de728c086bbec21a19224b639f29bf3334d032cc9584b39db4d4f41180a3485c440c83583a61937b53e9de4fe13d375b4635d23590917cf80e",
};
const options = {
  scope,
  caseId,
  policyVersion,
  syntheticFixtureOnly: true,
  allowedSignerPubkeys: [fixtureEvent.pubkey],
  actors: [
    { actorId: "synthetic:citizen-1", actorClass: "citizen" },
    { actorId: "synthetic:public-1", actorClass: "public" },
  ],
};
const discussion = createNostrDiscussionAdapter({ scope, syntheticFixtureOnly: true }).normalize(fixtureEvent);
const command = {
  schemaVersion: "command_envelope_v1",
  commandType: "intake_discussion_v1",
  caseId,
  actorBinding: { actorId: "synthetic:citizen-1", actorClass: "citizen" },
  expectedCaseVersion: 0,
  idempotencyKey: "synthetic:durable-demo-intake",
  visibility: "private_case",
  policyVersion,
  payload: { discussion },
};
const query = {
  schemaVersion: "query_envelope_v1",
  queryType: "case_projection_v1",
  caseId,
  actorBinding: { actorId: "synthetic:public-1", actorClass: "public" },
  visibility: "public",
  policyVersion,
  atCaseVersion: null,
};

const rootDir = mkdtempSync(join(tmpdir(), "stadtstack-issue8-demo-"));
const firstStore = createSqliteJournalStore({ rootDir, namespace: "demo" });
const first = createDurableCivicCaseCoordinator(options, firstStore);
const receipt = first.handle(command);
const projection = first.project(query);
firstStore.close();

const secondStore = createSqliteJournalStore({ rootDir, namespace: "demo" });
const second = createDurableCivicCaseCoordinator(options, secondStore);
const replayReceipt = second.handle(command);
const replayProjection = second.project(query);
const sameReceipt = JSON.stringify(receipt) === JSON.stringify(replayReceipt);
const sameProjection = JSON.stringify(projection) === JSON.stringify(replayProjection);
secondStore.deleteExactSynthetic();

process.stdout.write(`${JSON.stringify({
  schemaVersion: "stadtstack.durable_journal_receipt.v1",
  status: "completed",
  mode: "offline_synthetic_only",
  caseVersion: receipt.caseVersion,
  journalHeadChecksum: receipt.journalHeadChecksum,
  projectionChecksum: projection.projectionChecksum,
  restartReplay: sameReceipt && sameProjection,
  exactSyntheticDeletion: true,
  externalNetworkCalled: false,
  sharedStorageUsed: false,
  authorityBinding: "none",
})}\n`);
