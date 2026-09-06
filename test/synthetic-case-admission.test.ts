import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { finalizeEvent } from "nostr-tools/pure";
import {
  createSyntheticAdoptionAcceptanceReader, createSyntheticAdoptionEvidenceVerifier, readCitizenAdoptionBundle,
  verifyRecordedCitizenAdoptionEvidence, verifyRecordedSyntheticAdoptionEvidence, verifySyntheticAdoptionPolicy,
  type CitizenAdoptionEvidencePolicy, type SyntheticAdoptionEvidenceBundle, type SyntheticAdoptionEvidencePolicy,
} from "../src/citizen-adoption-evidence.ts";
import { createSqliteAtomicTopicCaseAdmission, type SqliteAtomicTopicCaseAdmissionOptions } from "../src/adapters/sqlite-atomic-topic-case-admission.ts";
import { createRoebelCaseStewardControlService, type AtomicSyntheticAdoptionAdmissionV1 } from "../src/roebel-control-service.ts";
import { createCaseBindingOutboxProjector } from "../src/case-binding-outbox-projector.ts";
import { verifyPublicCaseBindingReceipt } from "../src/case-binding-projection.ts";
import { canonicalMunicipalCaseId, deriveCaseUuidV7, parseMunicipalCaseId, parseSyntheticCaseId } from "../src/case-id.ts";
import { createStagingCaseControlRuntime, type StagingCaseControlRuntimeConfig } from "../src/staging-case-control-runtime.ts";
import { createPublicCaseBindingServer } from "../src/public-case-binding-server.ts";
import { verifyCaseShutdownSeal } from "../src/case-shutdown-seal.ts";
import { CREDENTIAL_FREE_CASE_BINDING_OUTBOX_PATH } from "../src/credential-free-case-binding-outbox-server.ts";

type Vector = { policy: SyntheticAdoptionEvidencePolicy; bundle: SyntheticAdoptionEvidenceBundle;
  projection: Record<string, unknown>; verifiedAt: number };
const fixture = (): Vector => JSON.parse(readFileSync(new URL("./fixtures/synthetic-adoption-roebel-v1.json", import.meta.url), "utf8"));
const realFixture = () => JSON.parse(readFileSync(new URL("./fixtures/citizen-adoption-roebel-v1.json", import.meta.url), "utf8"));
const steward = { actorId: "example:steward", actorClass: "case_steward" as const };
const backup = { actorId: "example:backup", actorClass: "case_steward" as const };
const route = "/v1/nostr/suggestions/admit";
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") { const r = value as Record<string, unknown>;
    return `{${Object.keys(r).sort().map((k) => `${JSON.stringify(k)}:${canonical(r[k])}`).join(",")}}`; }
  return JSON.stringify(value);
}
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const verifier = (v: Vector, resolve = async () => v.projection) => createSyntheticAdoptionEvidenceVerifier({
  policy: v.policy, now: () => new Date(v.verifiedAt * 1000), acceptance: { resolve },
});
const command = (v: Vector): AtomicSyntheticAdoptionAdmissionV1 => ({ schemaVersion: "atomic_synthetic_adoption_admission_v1",
  municipalityId: v.policy.municipalityId, policyVersion: v.policy.policyVersion, actorBinding: steward, expectedCaseVersion: 0, bundle: v.bundle });
const body = (v: Vector) => ({ schemaVersion: "roebel_case_steward_synthetic_adoption_request_v1", bundle: v.bundle });
function setup(t: TestContext, durable = false) {
  const v = fixture(); const temporary = mkdtempSync(join(tmpdir(), "stadtstack-synthetic-case-")); const rootDir = durable ? realpathSync(temporary) : temporary;
  const state = { online: true, reads: 0, projection: v.projection };
  const config: SqliteAtomicTopicCaseAdmissionOptions = { rootDir, municipalityId: v.policy.municipalityId, policyVersion: v.policy.policyVersion,
    allowedAgentPubkeys: v.policy.allowedAgentPubkeys, allowedSignerPubkeys: [], actorRegistry: [steward, backup],
    ...(durable ? { durableState: { mode: "durable_single_writer", sourceReleaseDigest: `sha256:${"d".repeat(64)}` } } : {}),
    syntheticAdoption: { policy: v.policy, now: () => new Date(v.verifiedAt * 1000), acceptance: {
      resolve: async (request) => { state.reads++; assert.equal(request.participantSuggestionId, v.bundle.participantSuggestionEvent.id);
        assert.equal(request.adopterPubkey, v.bundle.proofEvent.pubkey); if (!state.online) throw Error("offline"); return state.projection; },
    } } };
  const adapters: ReturnType<typeof createSqliteAtomicTopicCaseAdmission>[] = [];
  const open = (changes: Partial<SqliteAtomicTopicCaseAdmissionOptions> = {}) => {
    const adapter = createSqliteAtomicTopicCaseAdmission({ ...config, ...changes }); adapters.push(adapter); return adapter;
  };
  t.after(() => { for (const adapter of adapters) adapter.close(); rmSync(rootDir, { recursive: true, force: true }); });
  const databasePath = join(rootDir, `stadtstack-${v.policy.municipalityId}-atomic-admission.sqlite`);
  const counts = () => { const db = new DatabaseSync(databasePath); try {
    return ["atomic_case_meta", "atomic_root_claims", "atomic_case_events", "atomic_case_idempotency", "atomic_binding_receipts", "atomic_binding_outbox"]
      .map((table) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n);
  } finally { db.close(); } };
  return { v, rootDir, databasePath, config, state, open, counts };
}

test("Röbel's public test adoption remains verifiable after its original challenge window without becoming eligibility", async () => {
  const v = fixture(); const before = JSON.stringify(v);
  const evidence = await verifier(v).verify(v.bundle);
  assert.ok(v.verifiedAt > JSON.parse(v.bundle.proofEvent.content).expiresAt);
  assert.deepEqual(verifyRecordedSyntheticAdoptionEvidence(evidence, v.policy), evidence);
  assert.equal(evidence.environment, "staging"); assert.equal(evidence.testOnly, true);
  assert.ok(Object.isFrozen(evidence.bundle.proofEvent.tags));
  assert.equal(JSON.stringify(v), before);
  assert.throws(() => readCitizenAdoptionBundle(v.bundle));
  assert.throws(() => verifyRecordedCitizenAdoptionEvidence(evidence, realFixture().policy as CitizenAdoptionEvidencePolicy));
  assert.throws(() => verifyRecordedSyntheticAdoptionEvidence({ ...evidence, testOnly: false }, v.policy));
  assert.throws(() => verifySyntheticAdoptionPolicy({ ...v.policy, environment: "production" }));
});

test("all source signatures and the pinned test challenge are checked before the ledger is read", async () => {
  for (const field of ["sourceDiscussion", "sourceAnswer", "participantSuggestionEvent", "proofEvent"] as const) {
    const v = fixture(); v.bundle[field].content += "tampered"; let reads = 0;
    await assert.rejects(verifier(v, async () => { reads++; return v.projection; }).verify(v.bundle)); assert.equal(reads, 0);
  }
  for (const change of [{ testCitizenNftContract: `0x${"4".repeat(40)}` }, { chainId: 1 }, { testOnly: false },
    { policyVersion: "wrong-test-policy" }, { subjectPubkey: "a".repeat(64) }, { expiresAt: 1790000301 }]) {
    const v = fixture(); const proof = v.bundle.proofEvent;
    const changed = JSON.parse(JSON.stringify(finalizeEvent({ ...proof, content: canonical({ ...JSON.parse(proof.content), ...change }) }, new Uint8Array(32).fill(73))));
    let reads = 0;
    await assert.rejects(verifier(v, async () => { reads++; return v.projection; }).verify({ ...v.bundle, proofEvent: changed })); assert.equal(reads, 0);
  }
  let evaluated = false; const v = fixture();
  const hostile = { ...v.bundle, get proofEvent() { evaluated = true; return v.bundle.proofEvent; } };
  await assert.rejects(verifier(v).verify(hostile)); assert.equal(evaluated, false);
});

test("checksummed ledger mutations cannot change acceptance time, source bindings or test-only claims", async () => {
  for (const mutate of [
    (v: Vector) => { v.projection.civicCaseCreated = true; },
    (v: Vector) => { v.projection.testOnly = false; },
    (v: Vector) => { v.projection.proofEvent = realFixture().bundle.adoptionEvent; },
    (v: Vector) => { (v.projection.tracer as Record<string, unknown>).title = "Altered title"; },
    (v: Vector) => { (v.projection.tracer as Record<string, unknown>).tracerId = `urn:stadtstack:synthetic-citizen-adoption-tracer:${"f".repeat(64)}`; },
    (v: Vector) => { (v.projection.acceptanceReceipt as Record<string, unknown>).receivedAt = JSON.parse(v.bundle.proofEvent.content).expiresAt; },
    (v: Vector) => { (v.projection.acceptanceReceipt as Record<string, unknown>).adopterPubkey = "f".repeat(64); },
    (v: Vector) => { (v.projection.acceptanceReceipt as Record<string, unknown>).policyVersion = "different-policy"; },
  ]) {
    const v = fixture(); mutate(v);
    const receipt = v.projection.acceptanceReceipt as Record<string, unknown>;
    const unsigned = { ...receipt }; delete unsigned.receiptChecksum;
    receipt.receiptChecksum = digest(unsigned);
    await assert.rejects(verifier(v).verify(v.bundle));
  }
});

test("trusted ledger transport is credential-free, bounded and exact, including a reader that ignores abort", async () => {
  const v = fixture(); const controller = new AbortController();
  const input = { participantSuggestionId: v.bundle.participantSuggestionEvent.id, adopterPubkey: v.bundle.proofEvent.pubkey, signal: controller.signal };
  const reader = createSyntheticAdoptionAcceptanceReader({ baseUrl: "https://ledger.example/by-suggestion", fetch: async (url, options) => {
    assert.equal(url, `https://ledger.example/by-suggestion/${input.participantSuggestionId}/adopter/${input.adopterPubkey}`);
    assert.equal(options?.redirect, "error"); assert.equal(options?.credentials, "omit");
    assert.deepEqual([...new Headers(options?.headers)], [["accept", "application/json"]]); return Response.json(v.projection);
  } });
  assert.deepEqual(await reader.resolve(input), v.projection);
  for (const url of ["http://ledger.example/read", "https://secret@ledger.example/read", "https://ledger.example/read?q=x", "https://ledger.example/read/"]) {
    assert.throws(() => createSyntheticAdoptionAcceptanceReader({ baseUrl: url }));
  }
  for (const response of [new Response(null, { status: 302 }), Response.json({ ...v.projection, participantSuggestionId: "0".repeat(64) }),
    new Response(" ".repeat(16385), { headers: { "content-type": "application/json" } })]) {
    await assert.rejects(createSyntheticAdoptionAcceptanceReader({ baseUrl: "https://ledger.example/read", fetch: async () => response }).resolve(input));
  }
  let signal: AbortSignal | undefined;
  await assert.rejects(createSyntheticAdoptionEvidenceVerifier({ policy: v.policy, timeoutMs: 30,
    acceptance: { resolve: async (input) => { signal = input.signal; return new Promise(() => {}); } } }).verify(v.bundle), /verification_timeout/);
  assert.equal(signal?.aborted, true);
});

test("synthetic admission uses one atomic journal and outbox, with exact concurrent retries and offline restart", async (t) => {
  const h = setup(t); const adapter = h.open(); const original = JSON.stringify(h.v.bundle);
  const [first, concurrent] = await Promise.all([adapter.admission.admitSyntheticAdoption!(command(h.v)), adapter.admission.admitSyntheticAdoption!(command(h.v))]);
  assert.deepEqual(first, concurrent); assert.deepEqual(h.counts(), [1, 1, 3, 1, 1, 1]);
  assert.equal(first.schemaVersion, "public_synthetic_case_binding_receipt_v1");
  assert.equal(parseMunicipalCaseId(first.caseId), null); assert.equal(parseSyntheticCaseId(first.caseId)?.municipalityId, h.v.policy.municipalityId);
  assert.equal(first.civicCaseCreated, false); assert.equal(first.syntheticCaseCreated, true); assert.equal(first.testOnly, true);
  const projector = await createCaseBindingOutboxProjector(adapter.outbox);
  assert.deepEqual(projector.reader.getByRootEventId(h.v.bundle.sourceDiscussion.id), first);
  assert.deepEqual(projector.reader.get(first.caseId), first);
  assert.equal(projector.reader.get(canonicalMunicipalCaseId(h.v.policy.municipalityId, deriveCaseUuidV7(h.v.bundle.proofEvent))!), null);
  assert.equal(JSON.stringify(h.v.bundle), original);
  const db = new DatabaseSync(h.databasePath);
  assert.equal((db.prepare("SELECT event_type FROM atomic_case_events WHERE case_version=3").get() as { event_type: string }).event_type, "synthetic_adoption_admitted_v1"); db.close();
  const reads = h.state.reads; adapter.close(); h.state.online = false;
  const reopened = h.open(); assert.deepEqual(await reopened.admission.admitSyntheticAdoption!(command(h.v)), first); assert.equal(h.state.reads, reads);
  await assert.rejects(reopened.admission.admitSyntheticAdoption!({ ...command(h.v), actorBinding: backup }), /idempotency_conflict/);
  await assert.rejects(reopened.admission.admitSyntheticAdoption!({ ...command(h.v), bundle: { ...h.v.bundle, proofEvent: { ...h.v.bundle.proofEvent, content: "changed" } } }), /idempotency_conflict/);
  const coordinator = reopened.caseCoordinators.open(first.caseId);
  assert.throws(() => coordinator.handle({ schemaVersion: "command_envelope_v1", commandType: "assign_department_package_v1", caseId: first.caseId,
    actorBinding: steward, expectedCaseVersion: 3, idempotencyKey: "no-municipal-continuation", visibility: "private_case", policyVersion: h.v.policy.policyVersion,
    payload: { departmentPackage: { id: "test-package", departmentId: "planning", suggestionId: `urn:stadtstack:suggestion:${h.v.bundle.sourceDiscussion.id}`,
      request: "Test only", assignedAgentActorId: "example:agent", assignedReviewerActorId: "example:reviewer", authorityBinding: "none" } } }), /synthetic_case_continuation_unavailable/);
  assert.deepEqual(h.counts(), [1, 1, 3, 1, 1, 1]);
});

test("test receipts cannot be relabelled as municipal admission or stripped of their no-effect flags", async (t) => {
  const h = setup(t); const receipt = await h.open().admission.admitSyntheticAdoption!(command(h.v));
  for (const change of [{ environment: "production" }, { testOnly: false }, { civicCaseCreated: true }, { bindingVote: true },
    { schemaVersion: "public_case_binding_receipt_v2" }, { caseId: receipt.caseId.replace("synthetic-case:", "case:") }]) {
    const unsigned: Record<string, unknown> = { ...receipt, ...change }; delete unsigned.receiptChecksum;
    assert.throws(() => verifyPublicCaseBindingReceipt({ ...unsigned, receiptChecksum: `sha256:${digest(unsigned)}` }));
  }
});

test("invalid evidence, wrong staff and every transaction failure leave all six Case tables empty", async (t) => {
  for (const failpoint of ["after_root_claim", "after_case_events", "after_binding_receipt"] as const) {
    const h = setup(t); const adapter = h.open({ failpoint });
    await assert.rejects(adapter.admission.admitSyntheticAdoption!(command(h.v)), /atomic_admission_failpoint/);
    assert.deepEqual(h.counts(), [0, 0, 0, 0, 0, 0]);
  }
  const h = setup(t); const adapter = h.open();
  await assert.rejects(adapter.admission.admitSyntheticAdoption!({ ...command(h.v), actorBinding: { actorId: "outsider", actorClass: "case_steward" } }));
  assert.equal(h.state.reads, 0);
  h.state.projection = { ...h.v.projection, submittedToCivicWorkflow: true };
  await assert.rejects(adapter.admission.admitSyntheticAdoption!(command(h.v)));
  assert.deepEqual(h.counts(), [0, 0, 0, 0, 0, 0]);
});

test("municipal and synthetic admission modes reject each other's bodies before invoking their writer", async (t) => {
  const h = setup(t); const adapter = h.open();
  const config = { municipalityId: h.v.policy.municipalityId, policyVersion: h.v.policy.policyVersion,
    allowedAgentPubkeys: h.v.policy.allowedAgentPubkeys, caseStewardAuthenticator: { authenticate: async () => ({ ...steward, municipalityIds: [h.v.policy.municipalityId] }) } };
  let realWrites = 0;
  const real = createRoebelCaseStewardControlService({ ...config, admissionKind: "eligible_citizen_adopted_topic_suggestion_v1",
    atomicAdmission: { admit: async () => { throw Error("unexpected"); }, admitCitizenAdoption: async () => { realWrites++; throw Error("unexpected"); } } });
  const synthetic = createRoebelCaseStewardControlService({ ...config, admissionKind: "synthetic_citizen_adoption_case_input_v1", atomicAdmission: adapter.admission });
  assert.equal((await real.respond({ method: "POST", path: route, authorization: "test", body: body(h.v) })).status, 400);
  assert.equal(realWrites, 0);
  assert.equal((await synthetic.respond({ method: "POST", path: route, authorization: "test",
    body: { schemaVersion: "roebel_case_steward_citizen_adoption_request_v1", bundle: realFixture().bundle } })).status, 400);
  assert.equal(h.state.reads, 0); assert.deepEqual(h.counts(), [0, 0, 0, 0, 0, 0]);
  assert.equal(adapter.admission.admitCitizenAdoption, undefined);
  await assert.rejects(adapter.admission.admit(command(h.v) as never));
  assert.throws(() => h.open({ citizenAdoption: { policy: realFixture().policy, acceptance: { resolve: async () => null } } }), /options_invalid/);
});

test("durable test Case seals and reopens; municipal configuration cannot adopt its store", async (t) => {
  const h = setup(t, true); const adapter = h.open(); const receipt = await adapter.admission.admitSyntheticAdoption!(command(h.v));
  const seal = verifyCaseShutdownSeal(adapter.sealAndClose());
  assert.deepEqual(seal.recoveryEvidence.orderedHeads.map((head) => head.caseId), [receipt.caseId]);
  const reopened = h.open(); assert.deepEqual(await reopened.admission.admitSyntheticAdoption!(command(h.v)), receipt); reopened.sealAndClose();
  assert.throws(() => h.open({ syntheticAdoption: undefined, allowedSignerPubkeys: [h.v.bundle.proofEvent.pubkey] }));
});

function http(port: number, path: string, body?: unknown, authorization?: string): Promise<{ status: number; body: string }> {
  const encoded = body === undefined ? "" : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: "127.0.0.1", port, path, method: body === undefined ? "GET" : "POST",
      headers: { host: "127.0.0.1", "content-length": String(Buffer.byteLength(encoded)),
        ...(body === undefined ? {} : { "content-type": "application/json" }), ...(authorization ? { authorization } : {}) } }, (incoming) => {
      let body = ""; incoming.setEncoding("utf8"); incoming.on("data", (chunk: string) => { body += chunk; });
      incoming.on("end", () => resolve({ status: incoming.statusCode!, body })); incoming.on("error", reject);
    }); outgoing.on("error", reject); outgoing.end(encoded);
  });
}

test("JSON runtime authenticates staff, serves test receipts through the existing outbox/public transports, and restarts offline", async (t) => {
  const h = { v: fixture(), rootDir: realpathSync(mkdtempSync(join(tmpdir(), "stadtstack-synthetic-runtime-"))) };
  const token = Buffer.alloc(32, 79).toString("base64url");
  const baseUrl = "https://ledger.example/by-suggestion";
  const config: StagingCaseControlRuntimeConfig = { deploymentEnvironment: "staging", rootDir: realpathSync(h.rootDir), municipalityId: h.v.policy.municipalityId,
    policyVersion: h.v.policy.policyVersion, actorRegistry: [steward], allowedAgentPubkeys: h.v.policy.allowedAgentPubkeys, allowedSignerPubkeys: [],
    syntheticAdoption: { policy: h.v.policy, acceptanceBaseUrl: baseUrl }, credentials: [{ principal: { ...steward, municipalityIds: [h.v.policy.municipalityId] }, token }],
    admissionAllowedHosts: ["127.0.0.1"], outboxAllowedHosts: ["127.0.0.1"], probeAllowedHosts: ["127.0.0.1"], drainTimeoutMs: 500,
    listeners: { admission: { host: "127.0.0.1", port: 0 }, outbox: { host: "127.0.0.1", port: 0 }, probe: { host: "127.0.0.1", port: 0 } },
    durableState: { mode: "durable_single_writer", sourceReleaseDigest: `sha256:${"d".repeat(64)}` } };
  t.mock.timers.enable({ apis: ["Date"], now: h.v.verifiedAt * 1000 }); let reads = 0; let online = true;
  t.mock.method(globalThis, "fetch", async (url: string) => { reads++; if (!online) throw Error("offline");
    assert.equal(url, `${baseUrl}/${h.v.bundle.participantSuggestionEvent.id}/adopter/${h.v.bundle.proofEvent.pubkey}`); return Response.json(h.v.projection); });
  const runtime = createStagingCaseControlRuntime(JSON.parse(JSON.stringify(config))); t.after(() => runtime.close()); await runtime.start();
  assert.equal((await http(runtime.health().ports.admission!, route, body(h.v), "Bearer invalid")).status, 401); assert.equal(reads, 0);
  const admitted = await http(runtime.health().ports.admission!, route, body(h.v), `Bearer ${token}`); assert.equal(admitted.status, 200, admitted.body);
  const receipt = verifyPublicCaseBindingReceipt(JSON.parse(admitted.body)); assert.equal(receipt.schemaVersion, "public_synthetic_case_binding_receipt_v1");
  const page = await http(runtime.health().ports.outbox!, `${CREDENTIAL_FREE_CASE_BINDING_OUTBOX_PATH}?afterSequence=0&limit=1`);
  assert.equal(page.status, 200); assert.deepEqual(JSON.parse(page.body).entries[0].receipt, receipt);
  for (const hidden of ["example:steward", "walletAddress", "sessionBinding", "requestChecksum", "challengeId", "eligibilityStatus"]) assert.ok(!page.body.includes(hidden));
  const reader = { get: () => receipt, getByRootEventId: () => receipt };
  const { server } = createPublicCaseBindingServer({ allowedHosts: ["127.0.0.1"], reader });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); assert.ok(address && typeof address === "object");
  for (const path of [`/v1/public/case-bindings/${receipt.caseId}`, `/v1/public/case-bindings/by-discussion/${receipt.rootEventId}`]) {
    const result = await http(address.port, path); assert.equal(result.status, 200); assert.deepEqual(JSON.parse(result.body), receipt);
  }
  await runtime.close(); online = false;
  const restarted = createStagingCaseControlRuntime(JSON.parse(JSON.stringify(config))); t.after(() => restarted.close()); await restarted.start();
  assert.deepEqual(await http(restarted.health().ports.admission!, route, body(h.v), `Bearer ${token}`), admitted); assert.equal(reads, 1);
  await restarted.close(); rmSync(h.rootDir, { recursive: true, force: true });
});

test("synthetic runtime rejects mixed modes and untrusted dependency inputs before creating its store", (t) => {
  const h = setup(t); const rootDir = join(h.rootDir, "not-created");
  const common = { deploymentEnvironment: "staging", rootDir, municipalityId: h.v.policy.municipalityId, policyVersion: h.v.policy.policyVersion,
    actorRegistry: [steward], allowedAgentPubkeys: h.v.policy.allowedAgentPubkeys, allowedSignerPubkeys: [],
    credentials: [{ principal: { ...steward, municipalityIds: [h.v.policy.municipalityId] }, token: Buffer.alloc(32, 79).toString("base64url") }],
    admissionAllowedHosts: ["127.0.0.1"], outboxAllowedHosts: ["127.0.0.1"], probeAllowedHosts: ["127.0.0.1"], drainTimeoutMs: 500,
    listeners: { admission: { host: "127.0.0.1", port: 0 }, outbox: { host: "127.0.0.1", port: 0 }, probe: { host: "127.0.0.1", port: 0 } } };
  for (const syntheticAdoption of [
    { policy: h.v.policy, acceptanceBaseUrl: "http://ledger.example/read" },
    { policy: { ...h.v.policy, testOnly: false }, acceptanceBaseUrl: "https://ledger.example/read" },
    { policy: { ...h.v.policy, municipalityId: "another-city" }, acceptanceBaseUrl: "https://ledger.example/read" },
    { policy: h.v.policy, acceptanceBaseUrl: "https://ledger.example/read", acceptance: {} },
  ]) {
    assert.throws(() => createStagingCaseControlRuntime({ ...common, syntheticAdoption } as never)); assert.equal(existsSync(rootDir), false);
  }
  assert.throws(() => createStagingCaseControlRuntime({ ...common,
    syntheticAdoption: { policy: h.v.policy, acceptanceBaseUrl: "https://ledger.example/read" }, citizenAdoption: {} } as never));
  assert.equal(existsSync(rootDir), false);
});
