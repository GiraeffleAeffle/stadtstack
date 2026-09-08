import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, type TestContext } from "node:test";
import {
  createSqliteAtomicTopicCaseAdmission, prepareSyntheticDepartmentReviewMigration,
  type SyntheticReviewMigrationSourceConfig,
} from "../src/adapters/sqlite-atomic-topic-case-admission.ts";
import { CASE_SHUTDOWN_SEAL_FILENAME } from "../src/case-shutdown-seal.ts";
import { createDurableCaseContinuation } from "../src/durable-case-continuation.ts";
import { DETERMINISTIC_REVIEWED_AT, type ActorBinding, type ActorRegistration } from "../src/civic-case-coordinator.ts";
import type { SyntheticAdoptionEvidenceBundle, SyntheticAdoptionEvidencePolicy } from "../src/citizen-adoption-evidence.ts";

const departments = ["planning", "traffic", "environment", "finance", "legal", "public-order", "social-affairs", "public-works"];
const steward: ActorBinding = { actorId: "example:steward", actorClass: "case_steward" };
const administration: ActorBinding = { actorId: "example:administration", actorClass: "administration" };
const publicReader: ActorBinding = { actorId: "example:public", actorClass: "public" };
const agent = (id: string): ActorBinding => ({ actorId: `example:${id}:agent`, actorClass: "department_agent" });
const reviewer = (id: string): ActorBinding => ({ actorId: `example:${id}:reviewer`, actorClass: "department_reviewer" });
const additions: ActorRegistration[] = [administration, publicReader,
  ...departments.flatMap((departmentId) => [{ ...agent(departmentId), departmentId }, { ...reviewer(departmentId), departmentId }])];
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const snapshot = (root: string) => Object.fromEntries(readdirSync(root).sort().map((name) => [name, hash(readFileSync(join(root, name)))]));

// This file asserts candidate cleanup. Give it a private temporary namespace
// so another test process preparing a candidate cannot change its inventory.
const previousTemporaryRoot = process.env.TMPDIR;
const testTemporaryRoot = realpathSync(mkdtempSync(join(tmpdir(), "stadtstack-migration-test-")));
process.env.TMPDIR = testTemporaryRoot;
after(() => {
  if (previousTemporaryRoot === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTemporaryRoot;
  rmSync(testTemporaryRoot, { recursive: true, force: true });
});

async function source(t: TestContext) {
  const vector = JSON.parse(readFileSync(new URL("./fixtures/synthetic-adoption-roebel-v1.json", import.meta.url), "utf8")) as {
    policy: SyntheticAdoptionEvidencePolicy; bundle: SyntheticAdoptionEvidenceBundle; verifiedAt: number; projection: Record<string, unknown>;
  };
  const rootDir = realpathSync(mkdtempSync(join(tmpdir(), "stadtstack-migration-source-")));
  const sourceConfig: SyntheticReviewMigrationSourceConfig = {
    municipalityId: vector.policy.municipalityId, policyVersion: vector.policy.policyVersion,
    actorRegistry: [steward], allowedSignerPubkeys: [], allowedAgentPubkeys: vector.policy.allowedAgentPubkeys,
    syntheticAdoption: { policy: vector.policy, now: () => new Date(vector.verifiedAt * 1000), acceptance: { resolve: async () => vector.projection } },
  };
  const durableState = { mode: "durable_single_writer" as const, sourceReleaseDigest: `sha256:${"1".repeat(64)}` };
  const store = createSqliteAtomicTopicCaseAdmission({ ...sourceConfig, rootDir, durableState });
  t.after(() => { store.close(); rmSync(rootDir, { recursive: true, force: true }); });
  const admitted = await store.admission.admitSyntheticAdoption!({ schemaVersion: "atomic_synthetic_adoption_admission_v1",
    municipalityId: sourceConfig.municipalityId, policyVersion: sourceConfig.policyVersion,
    actorBinding: steward, expectedCaseVersion: 0, bundle: vector.bundle });
  const seal = store.sealAndClose();
  const request = { sourceRootDir: rootDir, expectedSourceSealChecksum: seal.sealChecksum,
    expectedCaseId: admitted.caseId, expectedAdmissionReceiptChecksum: admitted.receiptChecksum,
    sourceConfig, additionalActors: additions, requiredDepartmentIds: departments };
  const prepare = () => {
    const result = prepareSyntheticDepartmentReviewMigration(request);
    t.after(() => rmSync(result.candidateRootDir, { recursive: true, force: true }));
    return result;
  };
  return { rootDir, sourceConfig, durableState, admitted, seal, request, prepare };
}

test("sealed admission-only Case migrates in a private copy and continues review after restart", async (t) => {
  const h = await source(t);
  const untouched = snapshot(h.rootDir);
  const candidate = h.prepare();
  assert.deepEqual(snapshot(h.rootDir), untouched);
  assert.equal(candidate.receipt.caseVersion, 3);
  assert.equal(candidate.receipt.admissionReceiptChecksum, h.admitted.receiptChecksum);
  assert.equal(candidate.receipt.sourceDatabaseSha256, h.seal.databaseSha256);
  assert.notEqual(candidate.receipt.sourceConfigFingerprint, candidate.receipt.targetConfigFingerprint);
  assert.notEqual(candidate.receipt.sourceOptionsFingerprint, candidate.receipt.targetOptionsFingerprint);
  assert.deepEqual(readdirSync(candidate.candidateRootDir).sort(), [h.seal.databaseBasename, "synthetic-review-migration-candidate-v1.json"].sort());
  assert.equal(statSync(candidate.candidateRootDir).mode & 0o777, 0o700);
  assert.equal(statSync(join(candidate.candidateRootDir, h.seal.databaseBasename)).mode & 0o777, 0o600);
  assert.equal(existsSync(join(candidate.candidateRootDir, CASE_SHUTDOWN_SEAL_FILENAME)), false);
  // Deterministic source/target semantics even though candidate directories differ.
  const again = h.prepare();
  assert.deepEqual(again.receipt, candidate.receipt);
  assert.deepEqual(snapshot(h.rootDir), untouched);

  assert.throws(() => createSqliteAtomicTopicCaseAdmission({ ...h.sourceConfig, rootDir: candidate.candidateRootDir }), /config_mismatch/);
  const config = { ...h.sourceConfig, rootDir: candidate.candidateRootDir, syntheticDepartmentReview: true as const,
    actorRegistry: [steward, ...additions], requiredDepartmentIds: departments };
  let store = createSqliteAtomicTopicCaseAdmission(config);
  t.after(() => store.close());
  const facade = createDurableCaseContinuation({ caseKind: "synthetic_case", municipalityId: config.municipalityId,
    policyVersion: config.policyVersion, caseCoordinators: { open: (id) => store.caseCoordinators.open(id) },
    roleAuthenticator: { authenticate: async ({ authorization }) => [steward, agent("planning"), reviewer("planning")].find((item) => item.actorId === authorization) ?? null },
    actors: { caseSteward: steward, administrationReader: administration, publicReader,
      participationReviewer: { actorId: "example:unissued-participation", actorClass: "participation_reviewer" } },
    departments: departments.map((departmentId) => ({ departmentId, agent: agent(departmentId), reviewer: reviewer(departmentId) })),
  });
  const input = { authorization: steward.actorId, caseId: h.admitted.caseId };
  const before = await facade.administrationView(input);
  const assignment = { ...input, expectedCaseVersion: 3, departmentPackage: { id: "package:planning", departmentId: "planning",
    suggestionId: before.suggestion.id, request: "Assess crossing options.", assignedAgentActorId: agent("planning").actorId,
    assignedReviewerActorId: reviewer("planning").actorId, authorityBinding: "none" as const } };
  const assigned = await facade.assignDepartmentPackage(assignment);
  const view = await facade.administrationView(input);
  const draft = { ...input, authorization: agent("planning").actorId, expectedCaseVersion: 4,
    packageId: "package:planning", packageChecksum: view.departmentPackages[0]!.packageChecksum,
    draft: { schemaVersion: "department_draft_v1" as const, id: "draft:planning", publicSummary: "Compare crossing options.",
      publicCitations: ["synthetic://planning/evidence"], privateEvidenceRefs: ["synthetic://planning/private"], authorityBinding: "none" as const } };
  await facade.recordDepartmentDraft(draft);
  const drafted = await facade.administrationView(input);
  const review = { ...input, authorization: reviewer("planning").actorId, expectedCaseVersion: 5,
    review: { packageId: "package:planning", draftArtifactChecksum: drafted.departmentPackages[0]!.draft!.artifactChecksum,
      decision: "accepted" as const, reviewedAt: DETERMINISTIC_REVIEWED_AT } };
  const reviewed = await facade.attestDepartmentReview(review);
  assert.equal(reviewed.caseVersion, 6);
  const completed = await facade.administrationView(input);
  store.close(); store = createSqliteAtomicTopicCaseAdmission(config);
  assert.deepEqual(await facade.administrationView(input), completed);
  assert.deepEqual(await facade.assignDepartmentPackage(assignment), assigned);
  assert.deepEqual(await facade.attestDepartmentReview(review), reviewed);
  assert.deepEqual(store.outbox.replay()[0]!.receipt, h.admitted);
  assert.deepEqual(snapshot(h.rootDir), untouched);
  // The source still reopens only with its original deployment configuration.
  const original = createSqliteAtomicTopicCaseAdmission({ ...h.sourceConfig, rootDir: h.rootDir, durableState: h.durableState });
  assert.deepEqual(original.outbox.replay()[0]!.receipt, h.admitted);
  assert.equal(original.sealAndClose().recoveryEvidence.orderedHeads[0]!.caseVersion, 3);
});

test("migration rejects drift, role replacement and unrelated capabilities without changing the source", async (t) => {
  const h = await source(t);
  const untouched = snapshot(h.rootDir);
  const badRequests = [
    { ...h.request, expectedSourceSealChecksum: `sha256:${"0".repeat(64)}` },
    { ...h.request, expectedAdmissionReceiptChecksum: `sha256:${"0".repeat(64)}` },
    { ...h.request, expectedCaseId: h.admitted.caseId.replace("synthetic-case:", "case:") },
    { ...h.request, sourceConfig: { ...h.sourceConfig, policyVersion: "different-policy" } },
    { ...h.request, sourceConfig: { ...h.sourceConfig, syntheticDepartmentReview: true } },
    { ...h.request, additionalActors: [...additions, { actorId: steward.actorId, actorClass: "administration" as const }] },
    { ...h.request, additionalActors: [...additions, { actorId: "example:extra-steward", actorClass: "case_steward" as const }] },
    { ...h.request, additionalActors: [...additions, { actorId: "example:council", actorClass: "council" as const }] },
    { ...h.request, additionalActors: additions.filter((item) => item.actorId !== reviewer("planning").actorId) },
    { ...h.request, requiredDepartmentIds: departments.slice(0, 7) },
  ];
  const candidates = () => readdirSync(tmpdir()).filter((name) => name.startsWith("stadtstack-review-migration-"));
  const directoriesBefore = candidates();
  for (const request of badRequests) {
    assert.throws(() => prepareSyntheticDepartmentReviewMigration(request));
    assert.deepEqual(snapshot(h.rootDir), untouched);
  }
  assert.deepEqual(candidates(), directoriesBefore, "failed rehearsals remove only their own generated candidate");
  const path = join(h.rootDir, h.seal.databaseBasename);
  const original = readFileSync(path);
  writeFileSync(path, Buffer.concat([original, Buffer.from("unexpected")]), { mode: 0o600 });
  const altered = snapshot(h.rootDir);
  assert.throws(() => h.prepare());
  assert.deepEqual(snapshot(h.rootDir), altered);
});

test("migration requires a completed sealed epoch and refuses sidecar or unsealed state", async (t) => {
  const h = await source(t);
  const walPath = join(h.rootDir, `${h.seal.databaseBasename}-wal`);
  writeFileSync(walPath, "uncheckpointed", { mode: 0o600 });
  const sidecarState = snapshot(h.rootDir);
  assert.throws(() => h.prepare(), /sidecar_nonempty/);
  assert.deepEqual(snapshot(h.rootDir), sidecarState);
  rmSync(walPath);
  const live = createSqliteAtomicTopicCaseAdmission({ ...h.sourceConfig, rootDir: h.rootDir, durableState: h.durableState });
  t.after(() => live.close());
  const liveState = snapshot(h.rootDir);
  assert.throws(() => h.prepare());
  assert.deepEqual(snapshot(h.rootDir), liveState);
  live.sealAndClose();
});
