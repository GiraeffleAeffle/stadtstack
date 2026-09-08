import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createSqliteAtomicTopicCaseAdmission, type SqliteAtomicTopicCaseAdmissionOptions } from "../src/adapters/sqlite-atomic-topic-case-admission.ts";
import { createDurableCaseContinuation, type DurableCaseContinuationConfig, type AdministrationCaseViewV1 } from "../src/durable-case-continuation.ts";
import { createStagingAdministrationAuthenticator, type StagingAdministrationGrant } from "../src/staging-administration-authenticator.ts";
import { createAdministrationReviewService, ADMINISTRATION_REVIEW_PATH, type AdministrationReviewResponse } from "../src/administration-review-service.ts";
import { createAdministrationReviewServer } from "../src/administration-review-server.ts";
import { DETERMINISTIC_REVIEWED_AT, type ActorBinding, type ActorRegistration } from "../src/civic-case-coordinator.ts";
import type { SyntheticAdoptionEvidencePolicy, SyntheticAdoptionEvidenceBundle } from "../src/citizen-adoption-evidence.ts";

const departments = ["planning", "traffic", "environment", "finance", "legal", "public-order", "social-affairs", "public-works"];
const steward: ActorBinding = { actorId: "example:steward", actorClass: "case_steward" };
const administration: ActorBinding = { actorId: "example:administration", actorClass: "administration" };
const publicReader: ActorBinding = { actorId: "example:public", actorClass: "public" };
const participation: ActorBinding = { actorId: "example:participation", actorClass: "participation_reviewer" };
const agent = (id: string): ActorBinding => ({ actorId: `example:${id}:agent`, actorClass: "department_agent" });
const reviewer = (id: string): ActorBinding => ({ actorId: `example:${id}:reviewer`, actorClass: "department_reviewer" });
const registrations: ActorRegistration[] = [steward, administration, publicReader, participation,
  ...departments.flatMap((departmentId) => [{ ...agent(departmentId), departmentId }, { ...reviewer(departmentId), departmentId }])];

async function setup(t: TestContext) {
  const vector = JSON.parse(readFileSync(new URL("./fixtures/synthetic-adoption-roebel-v1.json", import.meta.url), "utf8")) as {
    policy: SyntheticAdoptionEvidencePolicy; bundle: SyntheticAdoptionEvidenceBundle; verifiedAt: number; projection: Record<string, unknown>;
  };
  const rootDir = mkdtempSync(join(tmpdir(), "stadtstack-review-"));
  const config: SqliteAtomicTopicCaseAdmissionOptions = {
    rootDir, municipalityId: vector.policy.municipalityId, policyVersion: vector.policy.policyVersion,
    actorRegistry: registrations, allowedSignerPubkeys: [], allowedAgentPubkeys: vector.policy.allowedAgentPubkeys,
    requiredDepartmentIds: departments, syntheticDepartmentReview: true,
    syntheticAdoption: { policy: vector.policy, now: () => new Date(vector.verifiedAt * 1000), acceptance: { resolve: async () => vector.projection } },
  };
  let store = createSqliteAtomicTopicCaseAdmission(config);
  t.after(() => { store.close(); rmSync(rootDir, { recursive: true, force: true }); });
  const admission = await store.admission.admitSyntheticAdoption!({ schemaVersion: "atomic_synthetic_adoption_admission_v1",
    municipalityId: config.municipalityId, policyVersion: config.policyVersion, actorBinding: steward,
    expectedCaseVersion: 0, bundle: vector.bundle });
  let time = vector.verifiedAt * 1000;
  const grants: StagingAdministrationGrant[] = registrations.filter((entry) => !["public", "participation_reviewer"].includes(entry.actorClass))
    .map(({ actorId, actorClass }) => ({ token: randomBytes(32).toString("base64url"), caseId: admission.caseId,
      actor: { actorId, actorClass }, notBefore: time - 1000, expiresAt: time + 60_000 }));
  const authenticator = createStagingAdministrationAuthenticator({ deploymentEnvironment: "staging", grants, now: () => time });
  const token = (actor: ActorBinding) => `Bearer ${grants.find((grant) => grant.actor.actorId === actor.actorId)!.token}`;
  const continuationConfig: DurableCaseContinuationConfig = {
    caseKind: "synthetic_case", municipalityId: config.municipalityId, policyVersion: config.policyVersion,
    caseCoordinators: { open: (caseId) => store.caseCoordinators.open(caseId) }, roleAuthenticator: authenticator,
    actors: { caseSteward: steward, administrationReader: administration, publicReader, participationReviewer: participation },
    departments: departments.map((departmentId) => ({ departmentId, agent: agent(departmentId), reviewer: reviewer(departmentId) })),
  };
  const continuation = createDurableCaseContinuation(continuationConfig);
  const service = createAdministrationReviewService({ deploymentEnvironment: "staging", caseId: admission.caseId, continuation });
  const get = (actor: ActorBinding) => service.respond({ method: "GET", path: ADMINISTRATION_REVIEW_PATH, authorization: token(actor), body: null });
  const view = async (actor = steward) => {
    const result = await get(actor); assert.equal(result.status, 200, result.body);
    return JSON.parse(result.body) as AdministrationCaseViewV1;
  };
  const post = (actor: ActorBinding, operation: string, payload: unknown, expectedCaseVersion: number) => service.respond({
    method: "POST", path: ADMINISTRATION_REVIEW_PATH, authorization: token(actor), body: JSON.stringify({
      schemaVersion: "administration_review_request_v1", operation, expectedCaseVersion, payload,
    }),
  });
  return { config, continuationConfig, authenticator, admission, continuation, service, get, view, post, token, grants,
    expire: () => { time += 60_000; },
    store: () => store,
    restart: () => { store.close(); store = createSqliteAtomicTopicCaseAdmission(config); },
  };
}
const parsed = (result: AdministrationReviewResponse) => { assert.equal(result.status, 200, result.body); return JSON.parse(result.body); };
function assignment(id: string, suggestionId: string) {
  return { departmentPackage: { id: `package:${id}`, departmentId: id, suggestionId,
    request: `Assess the crossing options for ${id}.`, assignedAgentActorId: agent(id).actorId,
    assignedReviewerActorId: reviewer(id).actorId, authorityBinding: "none" } };
}

test("synthetic workspace HTTP completes one role-scoped package, with replay and durable restart", async (t) => {
  const h = await setup(t);
  const server = createAdministrationReviewServer({ allowedHosts: ["review.internal"], service: h.service });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const send = (actor: ActorBinding, body?: unknown, headers: Record<string, string> = {}, path = ADMINISTRATION_REVIEW_PATH) => new Promise<AdministrationReviewResponse>((resolve, reject) => {
    const bytes = body === undefined ? null : JSON.stringify(body);
    const req = httpRequest({ host: "127.0.0.1", port: address.port, path, method: bytes === null ? "GET" : "POST",
      headers: { host: "review.internal", authorization: h.token(actor), ...(bytes === null ? {} : {
        "content-type": "application/json", "content-length": String(Buffer.byteLength(bytes)),
      }), ...headers } }, (res) => {
      let text = ""; res.setEncoding("utf8"); res.on("data", (chunk: string) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode as AdministrationReviewResponse["status"], headers: res.headers as Record<string, string>, body: text }));
    }); req.on("error", reject); req.end(bytes ?? undefined);
  });
  const initial = parsed(await send(steward));
  assert.equal(initial.testOnly, true); assert.equal(initial.caseVersion, 3);
  const assign = { schemaVersion: "administration_review_request_v1", operation: "assign", expectedCaseVersion: 3,
    payload: assignment("planning", initial.suggestion.id) };
  const assigned = parsed(await send(steward, assign)); assert.equal(assigned.receipt.caseVersion, 4);
  assert.deepEqual(parsed(await send(steward, assign)), assigned);
  assert.equal((await send(agent("planning"), assign)).status, 403);
  const mine = parsed(await send(agent("planning")));
  assert.equal(mine.departmentPackages.length, 1); assert.equal(mine.briefReadiness, null);
  assert.equal(parsed(await send(agent("traffic"))).departmentPackages.length, 0);
  const draft = { schemaVersion: "administration_review_request_v1", operation: "draft", expectedCaseVersion: 4,
    payload: { packageId: "package:planning", packageChecksum: mine.departmentPackages[0].packageChecksum,
      draft: { schemaVersion: "department_draft_v1", id: "draft:planning", publicSummary: "Compare crossing markings with a raised crossing.",
        publicCitations: ["synthetic://planning/evidence-1"], privateEvidenceRefs: ["synthetic://planning/private-canary"], authorityBinding: "none" } } };
  assert.equal((await send(agent("traffic"), draft)).status, 403);
  const drafted = parsed(await send(agent("planning"), draft)); assert.equal(drafted.receipt.caseVersion, 5);
  assert.deepEqual(parsed(await send(agent("planning"), draft)), drafted);
  const reviewerView = parsed(await send(reviewer("planning")));
  const review = { schemaVersion: "administration_review_request_v1", operation: "review", expectedCaseVersion: 5,
    payload: { review: { packageId: "package:planning", draftArtifactChecksum: reviewerView.departmentPackages[0].draft.artifactChecksum,
      decision: "accepted", reviewedAt: DETERMINISTIC_REVIEWED_AT } } };
  assert.equal((await send(agent("planning"), review)).status, 403);
  assert.equal((await send(reviewer("traffic"), review)).status, 403);
  assert.equal((await send(reviewer("planning"), { ...review, payload: { review: { ...review.payload.review, draftArtifactChecksum: `sha256:${"0".repeat(64)}` } } })).status, 409);
  const reviewed = parsed(await send(reviewer("planning"), review)); assert.equal(reviewed.receipt.caseVersion, 6);
  assert.deepEqual(parsed(await send(reviewer("planning"), review)), reviewed);
  const final = await h.view(); assert.equal(final.briefReadiness?.acceptedDepartmentIds.length, 1);
  assert.equal(final.briefReadiness?.status, "waiting_for_department_review");
  assert.ok(!JSON.stringify(await h.view(agent("traffic"))).includes("private-canary"));
  assert.ok(!JSON.stringify(await h.view(agent("traffic"))).includes("package:planning"));
  assert.equal((await send(steward, undefined, { cookie: "session=unused" })).status, 400);
  assert.equal((await send(steward, undefined, { origin: "https://public.example" })).status, 400);
  assert.equal((await send(steward, undefined, { host: "other.internal" })).status, 400);
  assert.equal((await send(steward, undefined, {}, `${ADMINISTRATION_REVIEW_PATH}?role=case_steward`)).status, 404);
  assert.equal((await send(steward, { ...assign, actorBinding: steward })).status, 400);
  assert.equal((await send(steward, { ...assign, operation: "admit" })).status, 400);
  assert.equal((await send(steward, "x".repeat(65_537))).status, 413);
  assert.equal((await send(steward, undefined, { authorization: "Bearer invalid" })).status, 401);
  h.restart();
  assert.deepEqual(await h.view(), final);
  assert.deepEqual(h.store().outbox.replay({ afterSequence: 0, limit: 256 })[0]?.receipt, h.admission);
  assert.deepEqual(parsed(await send(reviewer("planning"), review)), reviewed);
  h.expire(); assert.equal((await send(steward)).status, 401);
});

test("synthetic review stays separate from municipal access and old store configuration", async (t) => {
  const h = await setup(t);
  const auth = { authorization: h.token(steward), caseId: h.admission.caseId };
  assert.equal(await h.authenticator.authenticate({ ...auth, caseId: h.admission.caseId.replace("synthetic-case:", "case:") }), null);
  const { caseKind, ...municipalConfig } = h.continuationConfig;
  assert.equal(caseKind, "synthetic_case");
  await assert.rejects(createDurableCaseContinuation(municipalConfig).administrationView(auth), /durable_continuation_case_invalid/);
  assert.throws(() => h.continuation.currentPublicKnowledge({ caseId: h.admission.caseId }), /synthetic_public_knowledge_unavailable/);
  assert.throws(() => createAdministrationReviewService({ deploymentEnvironment: "staging", caseId: h.admission.caseId.replace("synthetic-case:", "case:"), continuation: h.continuation }));
  assert.throws(() => createStagingAdministrationAuthenticator({ deploymentEnvironment: "production" as "staging", grants: h.grants }));
  assert.throws(() => createStagingAdministrationAuthenticator({ deploymentEnvironment: "staging", grants: [h.grants[0]!, h.grants[0]!] }));
  const unauthorized = await h.service.respond({ method: "POST", path: ADMINISTRATION_REVIEW_PATH, authorization: null, body: "{broken json" });
  assert.equal(unauthorized.status, 401);
  h.store().close();
  const { syntheticDepartmentReview: omitted, ...oldConfig } = h.config;
  assert.equal(omitted, true);
  assert.throws(() => createSqliteAtomicTopicCaseAdmission(oldConfig), /config|corrupt|fingerprint/);
});

test("all configured reviews can derive a synthetic brief; private evidence and old admission receipt remain separate", async (t) => {
  const h = await setup(t);
  for (const id of departments) {
    const initial = await h.view(); parsed(await h.post(steward, "assign", assignment(id, initial.suggestion.id), initial.caseVersion));
    const view = await h.view(agent(id)); const item = view.departmentPackages[0]!;
    parsed(await h.post(agent(id), "draft", { packageId: item.id, packageChecksum: item.packageChecksum,
      draft: { schemaVersion: "department_draft_v1", id: `draft:${id}`, publicSummary: `Synthetic assessment for ${id}.`,
        publicCitations: [`synthetic://${id}/evidence-1`], privateEvidenceRefs: [`synthetic://${id}/private-canary`], authorityBinding: "none" } }, view.caseVersion));
    const drafted = await h.view(reviewer(id));
    parsed(await h.post(reviewer(id), "review", { review: { packageId: item.id,
      draftArtifactChecksum: drafted.departmentPackages[0]!.draft!.artifactChecksum,
      decision: "accepted", reviewedAt: DETERMINISTIC_REVIEWED_AT } }, drafted.caseVersion));
  }
  const auth = { authorization: h.token(steward), caseId: h.admission.caseId };
  const prepared = await h.continuation.prepareCitizenBrief({ ...auth, briefId: "brief:synthetic-review" });
  await assert.rejects(h.continuation.applyCitizenBrief({ ...auth, briefId: "brief:synthetic-review", preparationChecksum: `sha256:${"0".repeat(64)}` }), /brief_stale/);
  const receipt = await h.continuation.applyCitizenBrief({ ...auth, briefId: "brief:synthetic-review", preparationChecksum: prepared.preparationChecksum });
  assert.equal(receipt.caseVersion, 28);
  const read = () => h.store().caseCoordinators.open(h.admission.caseId).project({ schemaVersion: "query_envelope_v1",
    queryType: "case_projection_v1", caseId: h.admission.caseId, actorBinding: publicReader, visibility: "public",
    policyVersion: h.config.policyVersion, atCaseVersion: null });
  const before = read();
  assert.equal(before.projection.reviewedCitizenBrief?.responses.length, 8);
  assert.ok(!JSON.stringify(before).includes("private-canary"));
  assert.equal((await h.view()).briefReadiness?.status, "citizen_brief_current");
  assert.throws(() => h.store().caseCoordinators.open(h.admission.caseId).handle({
    schemaVersion: "command_envelope_v1", commandType: "retract_advisory_participation_v1",
    caseId: h.admission.caseId, actorBinding: steward, expectedCaseVersion: 28,
    idempotencyKey: "synthetic-review-cannot-enter-participation", visibility: "private_case", policyVersion: h.config.policyVersion,
    payload: { retraction: { participationId: "synthetic:participation", participationChecksum: `sha256:${"0".repeat(64)}` } },
  }), /synthetic_case_continuation_unavailable/);
  assert.deepEqual(read(), before);
  h.restart(); assert.deepEqual(read(), before);
  assert.deepEqual(h.store().outbox.replay({ afterSequence: 0, limit: 256 })[0]?.receipt, h.admission);
});
