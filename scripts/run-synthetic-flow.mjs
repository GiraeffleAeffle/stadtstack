#!/usr/bin/env node

import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { createCivicKernel } from "../src/civic-kernel.ts";
import { createCompanionRuntime } from "../src/companion-runtime.ts";
import { createDeterministicLocalCompanionAdapter, createCompanionIdentityPolicy } from "../src/adapters/companion-harness.ts";
import { createNostrDiscussionAdapter } from "../src/adapters/discussion-adapter.ts";

const scope = { municipalityId: "sample-municipality", caseId: "sample-case" };
const departments = ["planning", "traffic"];
const identities = {
  administration: "did:stadtstack:sample:administration",
  council: "did:stadtstack:sample:council",
  public: "npub-sample-public",
};
const actors = [
  { id: "citizen", role: "citizen" },
  { id: "steward", role: "case_steward" },
  ...departments.flatMap((departmentId) => [
    { id: `${departmentId}-agent`, role: "department_agent", departmentId },
    { id: `${departmentId}-reviewer`, role: "department_reviewer", departmentId },
  ]),
  { id: "publisher", role: "publisher" },
  { id: "participation-reviewer", role: "participation_reviewer" },
];

const event = finalizeEvent({
  kind: 1,
  created_at: 1_754_035_200,
  tags: [["municipality", scope.municipalityId], ["case", scope.caseId], ["t", "stadtstack-e2e-fixture"]],
  content: "Could this synthetic crossing be made safer?",
}, generateSecretKey());
const discussion = createNostrDiscussionAdapter({ scope, syntheticFixtureOnly: true }).normalize(event);

const kernel = createCivicKernel({ ...scope, departments, actors });
kernel.dispatch({ type: "record_discussion", actor: { id: "citizen", role: "citizen" }, discussion: {
  id: "discussion-1", content: discussion.event.content, transport: "synthetic_nostr_fixture",
  signature: discussion.verificationProof.kind === "nostr_nip01" ? discussion.verificationProof.signature : "",
  provenance: discussion,
} });
kernel.dispatch({ type: "craft_suggestion", actor: { id: "citizen", role: "citizen" }, suggestion: { id: "suggestion-1", discussionId: "discussion-1", title: "Review a safer crossing" } });
kernel.dispatch({ type: "submit_suggestion_for_administration", actor: { id: "steward", role: "case_steward" }, suggestionId: "suggestion-1" });
for (const departmentId of departments) {
  const workPackageId = `suggestion-1:${departmentId}`;
  kernel.dispatch({ type: "record_department_response", actor: { id: `${departmentId}-agent`, role: "department_agent", departmentId }, workPackageId, response: { summary: `${departmentId} supplied a synthetic assessment.`, citations: [`synthetic://${departmentId}/review`] } });
  kernel.dispatch({ type: "review_department_response", actor: { id: `${departmentId}-reviewer`, role: "department_reviewer", departmentId }, workPackageId });
}
kernel.dispatch({ type: "publish_reviewed_citizen_brief", actor: { id: "publisher", role: "publisher" }, summary: "Synthetic responses are reviewed for this rehearsal." });

const runtime = createCompanionRuntime({ caseReader: kernel, identities });
const harness = createDeterministicLocalCompanionAdapter({ identityPolicy: createCompanionIdentityPolicy(identities) });
const tasks = ["administration", "council", "public"].map((profile) => runtime.prepareTask({ profile, question: "What is ready for review?" }));
const results = await Promise.all(tasks.map((task) => harness.run(task)));
process.stdout.write(`${JSON.stringify({ schemaVersion: "stadtstack.synthetic_public_receipt.v1", status: "completed", mode: "offline_synthetic_only", municipalityId: scope.municipalityId, caseId: scope.caseId, signatureVerified: true, departments: departments.length, profiles: tasks.map(({ profile }) => profile), results: results.map(({ profile, answer, citations }) => ({ profile, answer, citations })), authorityBinding: "none", externalNetworkCalled: false, modelCalled: false, publicPublication: false, formalVote: false })}\n`);
