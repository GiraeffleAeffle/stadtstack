import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createSqliteAtomicTopicCaseAdmission, prepareSyntheticDepartmentReviewMigration } from "../src/adapters/sqlite-atomic-topic-case-admission.ts";
import { createStagingCaseControlRuntime, type StagingCaseControlRuntimeConfig } from "../src/staging-case-control-runtime.ts";
import { CASE_SHUTDOWN_SEAL_FILENAME, verifyCaseShutdownSeal } from "../src/case-shutdown-seal.ts";
import { ADMINISTRATION_REVIEW_PATH } from "../src/administration-review-service.ts";
import { CREDENTIAL_FREE_CASE_BINDING_OUTBOX_PATH } from "../src/credential-free-case-binding-outbox-server.ts";
import type { ActorBinding, ActorRegistration } from "../src/civic-case-coordinator.ts";
import type { SyntheticAdoptionEvidenceBundle, SyntheticAdoptionEvidencePolicy } from "../src/citizen-adoption-evidence.ts";

const departments = ["planning", "traffic", "environment", "finance", "legal", "public-order", "social-affairs", "public-works"];
const steward: ActorBinding = { actorId: "example:steward", actorClass: "case_steward" };
const administration: ActorBinding = { actorId: "example:administration", actorClass: "administration" };
const publicReader: ActorBinding = { actorId: "example:public", actorClass: "public" };
const agent = (id: string): ActorBinding => ({ actorId: `example:${id}:agent`, actorClass: "department_agent" });
const reviewer = (id: string): ActorBinding => ({ actorId: `example:${id}:reviewer`, actorClass: "department_reviewer" });
const additions: ActorRegistration[] = [administration, publicReader,
  ...departments.flatMap((departmentId) => [{ ...agent(departmentId), departmentId }, { ...reviewer(departmentId), departmentId }])];
const token = () => randomBytes(32).toString("base64url");
const loopback = { host: "127.0.0.1" as const, port: 0 };

async function setup(t: TestContext) {
  const runtimes: ReturnType<typeof createStagingCaseControlRuntime>[] = [];
  t.after(async () => { for (const runtime of runtimes) await runtime.close(); });
  const vector = JSON.parse(readFileSync(new URL("./fixtures/synthetic-adoption-roebel-v1.json", import.meta.url), "utf8")) as {
    policy: SyntheticAdoptionEvidencePolicy; bundle: SyntheticAdoptionEvidenceBundle; verifiedAt: number; projection: Record<string, unknown>;
  };
  const sourceRootDir = realpathSync(mkdtempSync(join(tmpdir(), "stadtstack-review-runtime-source-")));
  t.after(() => rmSync(sourceRootDir, { recursive: true, force: true }));
  const sourceConfig = { municipalityId: vector.policy.municipalityId, policyVersion: vector.policy.policyVersion,
    actorRegistry: [steward], allowedSignerPubkeys: [], allowedAgentPubkeys: vector.policy.allowedAgentPubkeys,
    syntheticAdoption: { policy: vector.policy, now: () => new Date(vector.verifiedAt * 1000), acceptance: { resolve: async () => vector.projection } } };
  const source = createSqliteAtomicTopicCaseAdmission({ ...sourceConfig, rootDir: sourceRootDir,
    durableState: { mode: "durable_single_writer", sourceReleaseDigest: `sha256:${"1".repeat(64)}` } });
  t.after(() => source.close());
  const receipt = await source.admission.admitSyntheticAdoption!({ schemaVersion: "atomic_synthetic_adoption_admission_v1",
    municipalityId: sourceConfig.municipalityId, policyVersion: sourceConfig.policyVersion, actorBinding: steward,
    expectedCaseVersion: 0, bundle: vector.bundle });
  const seal = source.sealAndClose();
  const candidate = prepareSyntheticDepartmentReviewMigration({ sourceRootDir, expectedSourceSealChecksum: seal.sealChecksum,
    expectedCaseId: receipt.caseId, expectedAdmissionReceiptChecksum: receipt.receiptChecksum, sourceConfig,
    additionalActors: additions, requiredDepartmentIds: departments });
  t.after(() => rmSync(candidate.candidateRootDir, { recursive: true, force: true }));
  const admissionToken = token();
  const grants = [steward, administration, agent("planning"), reviewer("planning"), agent("traffic")].map((actor) => ({
    actor, caseId: receipt.caseId, token: token(), notBefore: Date.now() - 1000, expiresAt: Date.now() + 120_000,
  }));
  const config: StagingCaseControlRuntimeConfig = {
    deploymentEnvironment: "staging", rootDir: realpathSync(candidate.candidateRootDir),
    municipalityId: sourceConfig.municipalityId, policyVersion: sourceConfig.policyVersion,
    actorRegistry: [steward, ...additions], allowedSignerPubkeys: [], allowedAgentPubkeys: sourceConfig.allowedAgentPubkeys,
    requiredDepartmentIds: departments, syntheticAdoption: { policy: vector.policy, acceptanceBaseUrl: "https://ledger.example/acceptance" },
    credentials: [{ token: admissionToken, principal: { ...steward, actorClass: "case_steward", municipalityIds: [sourceConfig.municipalityId] } }],
    admissionAllowedHosts: ["admission.internal"], outboxAllowedHosts: ["outbox.internal"], probeAllowedHosts: ["probe.internal"],
    administrationReview: { caseId: receipt.caseId, grants, allowedHosts: ["review.internal"] },
    listeners: { admission: loopback, outbox: loopback, probe: loopback, administrationReview: loopback }, drainTimeoutMs: 250,
    // This is the existing unbound durable test composition, not a deployed
    // activation of the migration candidate or a forged Operations claim.
    durableState: { mode: "durable_single_writer", sourceReleaseDigest: `sha256:${"2".repeat(64)}` },
  };
  const authorization = (actor: ActorBinding) => `Bearer ${grants.find((entry) => entry.actor.actorId === actor.actorId)!.token}`;
  const createRuntime = (value = config) => { const runtime = createStagingCaseControlRuntime(value); runtimes.push(runtime); return runtime; };
  return { config, sourceRootDir, seal, receipt, candidate, admissionToken, authorization, createRuntime };
}

function request(port: number, host: string, authorization?: string, body?: unknown, path = ADMINISTRATION_REVIEW_PATH) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const bytes = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({ hostname: "127.0.0.1", port, path, method: bytes === undefined ? "GET" : "POST",
      headers: { host, connection: "close", ...(authorization ? { authorization } : {}),
        ...(bytes === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(bytes) }) } }, (res) => {
      let value = ""; res.setEncoding("utf8"); res.on("data", (chunk: string) => { value += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, body: value }));
    }); req.on("error", reject); req.end(bytes);
  });
}
const accepted = (result: { status: number; body: string }) => { assert.equal(result.status, 200, result.body); return JSON.parse(result.body); };

test("one runtime owns review, admission and receipt listeners, preserves migrated review across sealed restart", async (t) => {
  const h = await setup(t);
  const originalDatabase = readFileSync(join(h.sourceRootDir, h.seal.databaseBasename));
  const originalSeal = readFileSync(join(h.sourceRootDir, CASE_SHUTDOWN_SEAL_FILENAME));
  let runtime = h.createRuntime();
  await runtime.start();
  const ports = () => runtime.health().ports;
  assert.deepEqual(Object.keys(ports()), ["probe", "outbox", "admission", "administration-review"]);
  const get = (actor = steward) => request(ports()["administration-review"]!, "review.internal", h.authorization(actor));
  const post = (actor: ActorBinding, body: unknown) => request(ports()["administration-review"]!, "review.internal", h.authorization(actor), body);
  const initial = accepted(await get());
  assert.equal(initial.testOnly, true); assert.equal(initial.caseVersion, 3);
  assert.equal((await request(ports()["administration-review"]!, "review.internal", `Bearer ${h.admissionToken}`)).status, 401);
  assert.equal((await request(ports().admission!, "admission.internal", h.authorization(steward), {}, "/v1/nostr/suggestions/admit")).status, 401);
  assert.equal((await request(ports().admission!, "admission.internal", h.authorization(steward))).status, 404);
  assert.equal((await request(ports().outbox!, "outbox.internal", h.authorization(steward))).status, 400);
  const assign = { schemaVersion: "administration_review_request_v1", operation: "assign", expectedCaseVersion: 3,
    payload: { departmentPackage: { id: "package:planning", departmentId: "planning", suggestionId: initial.suggestion.id,
      request: "Assess crossing options.", assignedAgentActorId: agent("planning").actorId,
      assignedReviewerActorId: reviewer("planning").actorId, authorityBinding: "none" } } };
  const assigned = accepted(await post(steward, assign));
  const assignedView = accepted(await get(agent("planning")));
  assert.equal(accepted(await get(agent("traffic"))).departmentPackages.length, 0);
  const draft = { schemaVersion: "administration_review_request_v1", operation: "draft", expectedCaseVersion: 4,
    payload: { packageId: "package:planning", packageChecksum: assignedView.departmentPackages[0].packageChecksum,
      draft: { schemaVersion: "department_draft_v1", id: "draft:planning", publicSummary: "Compare crossing options.",
        publicCitations: ["synthetic://planning/evidence"], privateEvidenceRefs: ["synthetic://planning/private"], authorityBinding: "none" } } };
  accepted(await post(agent("planning"), draft));
  const drafted = accepted(await get(reviewer("planning")));
  const reviewedAt = new Date().toISOString();
  const review = { schemaVersion: "administration_review_request_v1", operation: "review", expectedCaseVersion: 5,
    payload: { review: { packageId: "package:planning", draftArtifactChecksum: drafted.departmentPackages[0].draft.artifactChecksum,
      decision: "accepted", reviewedAt } } };
  for (const invalid of ["2026-02-30T12:00:00.000Z", "2026-09-08T12:00:00+02:00", "not-a-date"]) {
    assert.equal((await post(reviewer("planning"), { ...review, payload: { review: { ...review.payload.review, reviewedAt: invalid } } })).status, 409);
  }
  assert.equal((await post(agent("planning"), review)).status, 403);
  const reviewed = accepted(await post(reviewer("planning"), review));
  assert.equal(reviewed.receipt.caseVersion, 6);
  const finalView = accepted(await get());
  assert.ok(JSON.stringify(finalView).includes(reviewedAt));
  const outbox = () => request(ports().outbox!, "outbox.internal", undefined, undefined, `${CREDENTIAL_FREE_CASE_BINDING_OUTBOX_PATH}?afterSequence=0&limit=1`);
  assert.deepEqual(accepted(await outbox()).entries[0].receipt, h.receipt);
  await runtime.close();
  const seal = verifyCaseShutdownSeal(JSON.parse(readFileSync(join(h.config.rootDir, CASE_SHUTDOWN_SEAL_FILENAME), "utf8")));
  assert.equal(seal.recoveryEvidence.orderedHeads[0]!.caseVersion, 6);
  runtime = h.createRuntime(); await runtime.start();
  assert.deepEqual(accepted(await get()), finalView);
  assert.deepEqual(accepted(await post(steward, assign)), assigned);
  assert.deepEqual(accepted(await post(reviewer("planning"), review)), reviewed);
  assert.deepEqual(accepted(await outbox()).entries[0].receipt, h.receipt);
  assert.deepEqual(readFileSync(join(h.sourceRootDir, h.seal.databaseBasename)), originalDatabase);
  assert.deepEqual(readFileSync(join(h.sourceRootDir, CASE_SHUTDOWN_SEAL_FILENAME)), originalSeal);
});

test("review configuration rejects ambiguous roles, foreign grants and reused admission credentials before opening storage", async (t) => {
  const h = await setup(t);
  const before = readFileSync(join(h.config.rootDir, h.seal.databaseBasename));
  const review = h.config.administrationReview!;
  const bad = [
    { ...h.config, administrationReview: { ...review, grants: [{ ...review.grants[0]!, token: h.admissionToken }] } },
    { ...h.config, administrationReview: { ...review, grants: [{ ...review.grants[0]!, actor: { actorId: "example:unknown", actorClass: "administration" as const } }] } },
    { ...h.config, administrationReview: { ...review, caseId: review.caseId.replace("synthetic-case:", "case:") } },
    { ...h.config, actorRegistry: [...h.config.actorRegistry, { actorId: "example:other-admin", actorClass: "administration" as const }] },
    { ...h.config, actorRegistry: h.config.actorRegistry.filter((entry) => entry.actorId !== reviewer("planning").actorId) },
    { ...h.config, listeners: { probe: loopback, outbox: loopback, admission: loopback } },
  ];
  for (const config of bad) {
    assert.throws(() => createStagingCaseControlRuntime(config), /config_invalid/);
    assert.deepEqual(readFileSync(join(h.config.rootDir, h.seal.databaseBasename)), before);
    assert.equal(existsSync(join(h.config.rootDir, CASE_SHUTDOWN_SEAL_FILENAME)), false);
  }
});

test("review listener bind failure drains every sibling before releasing and sealing the single owner", async (t) => {
  const h = await setup(t);
  const occupied = createServer();
  await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => occupied.close(() => resolve())));
  const address = occupied.address(); assert.ok(address && typeof address !== "string");
  const runtime = h.createRuntime({ ...h.config,
    listeners: { ...h.config.listeners, administrationReview: { host: "127.0.0.1", port: address.port } } });
  await assert.rejects(runtime.start(), /start_failed/);
  assert.equal(runtime.health().ready, false);
  assert.deepEqual(runtime.health().ports, {});
  assert.equal(existsSync(join(h.config.rootDir, CASE_SHUTDOWN_SEAL_FILENAME)), true);
  // Reacquisition proves the failed fourth bind did not retain a writer.
  const retry = h.createRuntime();
  await retry.start(); assert.equal(retry.health().ready, true); await retry.close();
});
