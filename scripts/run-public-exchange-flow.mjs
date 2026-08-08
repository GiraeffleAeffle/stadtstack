#!/usr/bin/env node

import { createCivicCaseCoordinator, DETERMINISTIC_REVIEWED_AT } from "../src/civic-case-coordinator.ts";
import { createNostrDiscussionAdapter } from "../src/adapters/discussion-adapter.ts";
import {
  createLocalPublicExchangeRelay,
  createPublicExchangeAdapter,
} from "../src/adapters/public-exchange-adapter.ts";

const scope = { municipalityId: "sample-municipality", caseId: "sample-case" };
const caseId = "urn:stadtstack:case:test:sample-municipality:018f0000-0000-7000-8000-000000000001";
const policyVersion = "case-intake-v1";
const fixturePubkey = "7190b3fcc08cd9c4edb5ef541e8a578089cb8727ba93c4cfb0583e2287d57bd2";
const discussionId = "44ac22db49995e6ec96344b624d3ee01eb50ad814cf80f51af05959bb305412c";
const discussion = createNostrDiscussionAdapter({ scope, syntheticFixtureOnly: true }).normalize({
  kind: 1,
  created_at: 1_754_035_200,
  tags: [["municipality", scope.municipalityId], ["case", scope.caseId], ["t", "stadtstack-e2e-fixture"]],
  content: "Could the crossing be made safer?",
  pubkey: fixturePubkey,
  id: discussionId,
  sig: "4db87c0f4d8d36de728c086bbec21a19224b639f29bf3334d032cc9584b39db4d4f41180a3485c440c83583a61937b53e9de4fe13d375b4635d23590917cf80e",
});
const departments = ["planning", "traffic", "environment", "finance", "legal", "public-order", "social-affairs", "public-works"];
const actors = [
  { actorId: "synthetic:citizen-1", actorClass: "citizen" },
  { actorId: "synthetic:public-1", actorClass: "public" },
  { actorId: "synthetic:administration-1", actorClass: "administration" },
  { actorId: "synthetic:steward-1", actorClass: "case_steward" },
  ...departments.flatMap((departmentId) => [
    { actorId: `synthetic:${departmentId}-agent`, actorClass: "department_agent", departmentId },
    { actorId: `synthetic:${departmentId}-reviewer`, actorClass: "department_reviewer", departmentId },
  ]),
];
const coordinator = createCivicCaseCoordinator({ scope, syntheticFixtureOnly: true, allowedSignerPubkeys: [fixturePubkey], requiredDepartmentIds: departments, actors });
let version = 0;
const command = (commandType, actorBinding, idempotencyKey, expectedCaseVersion, payload) => coordinator.handle({ schemaVersion: "command_envelope_v1", commandType, caseId, actorBinding, expectedCaseVersion, idempotencyKey, visibility: "private_case", policyVersion, payload });
const intake = command("intake_discussion_v1", { actorId: "synthetic:citizen-1", actorClass: "citizen" }, "synthetic:idem:discussion-1", version, { discussion });
version = intake.caseVersion;
for (const departmentId of departments) {
  const assignment = command("assign_department_package_v1", { actorId: "synthetic:steward-1", actorClass: "case_steward" }, `synthetic:idem:package-${departmentId}`, version, { departmentPackage: { id: `package-${departmentId}`, departmentId, suggestionId: `urn:stadtstack:suggestion:${discussionId}`, request: `Review a bounded ${departmentId} response.`, assignedAgentActorId: `synthetic:${departmentId}-agent`, assignedReviewerActorId: `synthetic:${departmentId}-reviewer`, authorityBinding: "none" } });
  version = assignment.caseVersion;
  const administration = coordinator.project({ schemaVersion: "query_envelope_v1", queryType: "case_projection_v1", caseId, actorBinding: { actorId: "synthetic:administration-1", actorClass: "administration" }, visibility: "administration", policyVersion, atCaseVersion: null });
  const pkg = administration.projection.departmentPackages.find((item) => item.departmentId === departmentId);
  const draft = command("record_department_draft_v1", { actorId: `synthetic:${departmentId}-agent`, actorClass: "department_agent" }, `synthetic:idem:draft-${departmentId}`, version, { packageId: pkg.id, packageChecksum: pkg.packageChecksum, draft: { schemaVersion: "department_draft_v1", id: `draft-${departmentId}-1`, publicSummary: `Reviewed ${departmentId} response.`, publicCitations: [`synthetic://${departmentId}/evidence-1`], privateEvidenceRefs: [`synthetic://${departmentId}/private-evidence-1`], authorityBinding: "none" } });
  const drafted = coordinator.project({ schemaVersion: "query_envelope_v1", queryType: "case_projection_v1", caseId, actorBinding: { actorId: "synthetic:administration-1", actorClass: "administration" }, visibility: "administration", policyVersion, atCaseVersion: null }).projection.departmentPackages.find((item) => item.departmentId === departmentId);
  version = command("attest_department_review_v1", { actorId: `synthetic:${departmentId}-reviewer`, actorClass: "department_reviewer" }, `synthetic:idem:review-${departmentId}`, draft.caseVersion, { review: { packageId: pkg.id, draftArtifactChecksum: drafted.draft.artifactChecksum, decision: "accepted", reviewedAt: DETERMINISTIC_REVIEWED_AT } }).caseVersion;
}
const administration = coordinator.project({ schemaVersion: "query_envelope_v1", queryType: "case_projection_v1", caseId, actorBinding: { actorId: "synthetic:administration-1", actorClass: "administration" }, visibility: "administration", policyVersion, atCaseVersion: null });
const sourceBindings = administration.projection.departmentPackages.map((item) => ({ packageId: item.id, packageChecksum: item.packageChecksum, draftArtifactChecksum: item.draft.artifactChecksum, reviewAttestationChecksum: item.review.attestationChecksum }));
const derive = command("derive_citizen_brief_v1", { actorId: "synthetic:steward-1", actorClass: "case_steward" }, "synthetic:idem:citizen-brief-1", version, { brief: { id: `urn:stadtstack:citizen-brief:${caseId}:1`, sourceBindings, authorityBinding: "none" } });
const publicActor = { actorId: "synthetic:public-1", actorClass: "public" };
const source = { project: (query) => coordinator.project(query) };
const relay = createLocalPublicExchangeRelay();
const exchange = createPublicExchangeAdapter({ source, caseId, policyVersion, publicActor, signer: { seed: "stadtstack-public-exchange-fixture-seed", workerIdentityId: "did:stadtstack:sample:exchange-agent" }, relay });
const record = exchange.createCurrentRecord();
const published = await exchange.publishAndQuery(record);
const imported = exchange.reimport(published.event);
const output = { schemaVersion: "stadtstack.public_exchange_receipt.v1", status: "completed", mode: "offline_synthetic_only", caseVersion: derive.caseVersion, recordId: record.recordId, recordChecksum: record.recordChecksum, eventId: published.event.id, importedChecksum: imported.recordChecksum, eose: published.query.eose, ok: published.publish.ok, authorityBinding: record.authorityBinding, relay: "memory://public-exchange", externalNetworkCalled: false, privateEvidenceVisible: JSON.stringify(imported).includes("privateEvidenceRefs") };
process.stdout.write(`${JSON.stringify(output)}\n`);
