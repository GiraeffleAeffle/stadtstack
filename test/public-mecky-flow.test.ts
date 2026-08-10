import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

function run(): { raw: string; evidence: Record<string, any> } {
  const raw = execFileSync(process.execPath, ["scripts/run-public-mecky-flow.mjs"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  return { raw, evidence: JSON.parse(raw) };
}

test("the Marienfelder Straße public Mecky tracer is deterministic and effect free", () => {
  const first = run();
  const second = run();
  assert.equal(first.raw, second.raw);
  const evidence = first.evidence;
  assert.equal(evidence.schemaVersion, "stadtstack.public_mecky_acceptance_evidence.v1");
  assert.equal(evidence.status, "completed");
  assert.equal(evidence.scope.municipalityId, "roebel-mueritz");
  assert.equal(evidence.scope.sourceCaseId, "marienfelder-strasse");
  assert.equal(evidence.source.reviewedDepartmentCount, 8);
  assert.equal(evidence.answer.citedDiscussion, true);
  assert.equal(evidence.answer.citedReviewedArtifact, true);
  assert.equal(evidence.answer.administrationAnswerReviewRequired, false);
  assert.equal(evidence.suggestion.citizenEdited, true);
  assert.equal(evidence.suggestion.nip01Verified, true);
  assert.equal(evidence.suggestion.entryState, "awaiting_human_case_admission");
  assert.equal(evidence.suggestion.submittedToCivicWorkflow, false);
  assert.deepEqual(evidence.negatives, {
    ordinaryDiscussion: "not_invoked",
    staleEvidence: "stale_evidence",
    staleWorkerCalls: 0,
    unboundCitation: "unavailable",
    wrongSignerRejected: true,
  });
  assert.deepEqual(evidence.continuity, {
    caseVersionUnchanged: true,
    journalHeadUnchanged: true,
    projectionUnchanged: true,
  });
  assert.deepEqual(evidence.effects, {
    civicStateMutation: false,
    externalNetwork: false,
    paidProvider: false,
    privateToolAccess: false,
    publication: false,
    suggestionSubmission: false,
    vote: false,
  });
  assert.match(evidence.evidenceChecksum, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidence.authorityBinding, "none");
  assert.equal(evidence.localProofOnly, true);
  assert.equal(evidence.deploymentReady, false);
});
