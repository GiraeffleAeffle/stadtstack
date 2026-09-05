import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import crypto, { createHash, createPrivateKey, sign } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { finalizeEvent } from "nostr-tools/pure";
import { createSqliteAtomicTopicCaseAdmission, type SqliteAtomicTopicCaseAdmissionOptions } from "../src/adapters/sqlite-atomic-topic-case-admission.ts";
import { createRoebelCaseStewardControlService, type AtomicCitizenAdoptionAdmissionV1 } from "../src/roebel-control-service.ts";
import { createRoebelCaseStewardControlServer } from "../src/roebel-case-steward-control-server.ts";
import { createCaseBindingOutboxProjector } from "../src/case-binding-outbox-projector.ts";
import { verifyPublicCaseBindingReceipt } from "../src/case-binding-projection.ts";
import { deriveCaseUuidV7 } from "../src/case-id.ts";
import { verifyCitizenAdoptionCaseAdmission } from "../src/citizen-adoption-case-admission.ts";
import type { CitizenAdoptionEvidenceBundle, CitizenAdoptionEvidencePolicy } from "../src/citizen-adoption-evidence.ts";

type Vector = { verifiedAt: number; policy: CitizenAdoptionEvidencePolicy; bundle: CitizenAdoptionEvidenceBundle;
  adoptionAcceptance: Record<string, unknown>; signedStatusVector: { statusCore: Record<string, unknown> } };
const fixture = (conversation = false): Vector => JSON.parse(readFileSync(new URL(
  `./fixtures/citizen-adoption-roebel-${conversation ? "conversation-" : ""}v1.json`, import.meta.url), "utf8")) as Vector;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") { const r = value as Record<string, unknown>;
    return `{${Object.keys(r).sort().map((k) => `${JSON.stringify(k)}:${canonical(r[k])}`).join(",")}}`; }
  return JSON.stringify(value);
}
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
function status(v: Vector, nonce: string, changes: Record<string, unknown> = {}) {
  const statusCore = { ...v.signedStatusVector.statusCore, requestNonce: nonce, ...changes };
  const statusChecksum = digest(statusCore);
  // Public synthetic issuer seed, matching the independently generated wire vector.
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 84)]), format: "der", type: "pkcs8" });
  return { statusCore, statusChecksum, proof: { algorithm: "Ed25519", keyId: v.policy.issuerKeyId,
    signature: sign(null, Buffer.from(canonical({ domain: "municipal-civic-eligibility-status/v1", schemaVersion: "municipal_civic_eligibility_status_v1", statusChecksum })), key).toString("base64url") } };
}
const steward = { actorId: "example:steward", actorClass: "case_steward" as const };
const path = "/v1/nostr/suggestions/admit";
const command = (v: Vector): AtomicCitizenAdoptionAdmissionV1 => ({ schemaVersion: "atomic_citizen_adoption_admission_v1",
  municipalityId: v.policy.municipalityId, policyVersion: v.policy.policyVersion, expectedCaseVersion: 0, actorBinding: steward, bundle: v.bundle });
function setup(t: TestContext, failpoint?: SqliteAtomicTopicCaseAdmissionOptions["failpoint"]) {
  const v = fixture(); const second = fixture(true); const vectors = [v, second];
  const rootDir = mkdtempSync(join(tmpdir(), "stadtstack-adopted-case-"));
  const state = { time: v.verifiedAt, reads: 0, requests: 0, online: true, statusChanges: {} as Record<string, unknown> };
  const config: SqliteAtomicTopicCaseAdmissionOptions = { rootDir, municipalityId: v.policy.municipalityId,
    policyVersion: v.policy.policyVersion, allowedSignerPubkeys: [], allowedAgentPubkeys: v.policy.allowedAgentPubkeys,
    actorRegistry: [steward, { actorId: "example:backup", actorClass: "case_steward" }, { actorId: "example:public", actorClass: "public" },
      { actorId: "example:agent", actorClass: "department_agent", departmentId: "planning" },
      { actorId: "example:reviewer", actorClass: "department_reviewer", departmentId: "planning" }],
    ...(failpoint ? { failpoint } : {}), citizenAdoption: { policy: v.policy, now: () => new Date(state.time * 1000),
      acceptance: { resolve: async ({ adoptionEventId }) => { state.reads++; if (!state.online) throw Error("offline");
        return vectors.find((item) => item.bundle.adoptionEvent.id === adoptionEventId)?.adoptionAcceptance; } },
      fetch: async (url, options) => { state.requests++; if (!state.online) throw Error("offline");
        const selected = vectors.find((item) => item.bundle.eligibilityReceipt.statusRef === String(url))!;
        return new Response(JSON.stringify(status(selected, new Headers(options?.headers).get("x-stadtstack-status-nonce")!, state.statusChanges)), { headers: { "content-type": "application/json" } }); },
    } };
  const adapters: ReturnType<typeof createSqliteAtomicTopicCaseAdmission>[] = [];
  const open = (changes: Partial<SqliteAtomicTopicCaseAdmissionOptions> = {}) => {
    const adapter = createSqliteAtomicTopicCaseAdmission({ ...config, ...changes }); adapters.push(adapter); return adapter;
  };
  t.after(() => { for (const adapter of adapters) adapter.close(); rmSync(rootDir, { recursive: true, force: true }); });
  const databasePath = join(rootDir, `stadtstack-${v.policy.municipalityId}-atomic-admission.sqlite`);
  const counts = () => { const db = new DatabaseSync(databasePath); try {
    return ["atomic_case_meta", "atomic_root_claims", "atomic_case_events", "atomic_case_idempotency", "atomic_binding_receipts", "atomic_binding_outbox"].map((table) =>
      (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n);
  } finally { db.close(); } };
  return { v, second, vectors, rootDir, databasePath, state, config, open, counts };
}
function control(h: ReturnType<typeof setup>, adapter: ReturnType<ReturnType<typeof setup>["open"]>) {
  return createRoebelCaseStewardControlService({ admissionKind: "eligible_citizen_adopted_topic_suggestion_v1",
    municipalityId: h.v.policy.municipalityId, policyVersion: h.v.policy.policyVersion,
    allowedAgentPubkeys: h.v.policy.allowedAgentPubkeys, atomicAdmission: adapter.admission,
    caseStewardAuthenticator: { authenticate: async ({ authorization }) => authorization === "example-staff-token"
      ? { ...steward, municipalityIds: [h.v.policy.municipalityId] } : null } });
}
const body = (v: Vector) => ({ schemaVersion: "roebel_case_steward_citizen_adoption_request_v1", bundle: v.bundle });

test("staff HTTP admission produces one v2 Case receipt and rebuilds the existing public outbox", async (t) => {
  const h = setup(t); const adapter = h.open(); const service = control(h, adapter);
  const { server } = createRoebelCaseStewardControlServer({ allowedHosts: ["127.0.0.1"], control: service });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const encoded = JSON.stringify(body(h.v));
  const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const outgoing = httpRequest({ host: "127.0.0.1", port: address.port, path, method: "POST",
      headers: { host: "127.0.0.1", authorization: "example-staff-token", "content-type": "application/json", "content-length": String(Buffer.byteLength(encoded)) } }, (incoming) => {
      let body = ""; incoming.setEncoding("utf8"); incoming.on("data", (chunk: string) => { body += chunk; });
      incoming.on("end", () => resolve({ status: incoming.statusCode!, body })); incoming.on("error", reject);
    }); outgoing.on("error", reject); outgoing.end(encoded);
  });
  assert.equal(response.status, 200, response.body);
  const receipt = verifyPublicCaseBindingReceipt(JSON.parse(response.body));
  assert.equal(receipt.schemaVersion, "public_case_binding_receipt_v2");
  if (receipt.schemaVersion !== "public_case_binding_receipt_v2") throw Error("wrong receipt version");
  assert.equal(receipt.caseId, `urn:stadtstack:case:municipality:${h.v.policy.municipalityId}:${deriveCaseUuidV7(h.v.bundle.adoptionEvent)}`);
  assert.ok(!receipt.caseId.endsWith(deriveCaseUuidV7(h.v.bundle.participantSuggestionEvent)));
  assert.equal(receipt.candidateEventId, h.v.bundle.adoptionEvent.id);
  assert.equal(receipt.participantSuggestionEventId, h.v.bundle.participantSuggestionEvent.id);
  assert.equal(receipt.adopterPubkey, h.v.bundle.adoptionEvent.pubkey);
  assert.equal(receipt.adoptionAcceptanceReceiptChecksum, h.v.adoptionAcceptance.receiptChecksum);
  for (const field of ["administrativeEndorsement", "bindingVote", "councilDecision", "openDeskWrite", "treasuryEffect", "paymentEffect"] as const) assert.equal(receipt[field], false);
  assert.deepEqual(h.counts(), [1, 1, 3, 1, 1, 1]);
  const projected = await createCaseBindingOutboxProjector(adapter.outbox);
  assert.deepEqual(projected.reader.getByRootEventId(receipt.rootEventId), receipt);
  assert.deepEqual(Object.keys(projected.reader).sort(), ["get", "getByRootEventId"]);
  const publicJson = JSON.stringify(receipt);
  for (const privateField of ["eligibilityStatus", "requestNonce", "eligibilityCore", "actorId", "statusRef", "proof"]) assert.ok(!publicJson.includes(privateField));

  // Later staff work continues the same Case journal after eligibility expires.
  h.state.time += 3_600; h.state.online = false;
  const coordinator = adapter.caseCoordinators.open(receipt.caseId);
  const query = { schemaVersion: "query_envelope_v1" as const, queryType: "case_projection_v1" as const,
    caseId: receipt.caseId, actorBinding: { actorId: "example:public", actorClass: "public" as const }, visibility: "public" as const,
    policyVersion: h.v.policy.policyVersion, atCaseVersion: null };
  const before = coordinator.project(query);
  assert.equal(before.projection.suggestion.status, "admitted");
  assert.equal(before.projection.suggestion.signerPubkey, h.v.bundle.adoptionEvent.pubkey);
  const later = coordinator.handle({ schemaVersion: "command_envelope_v1", commandType: "assign_department_package_v1", caseId: receipt.caseId,
    actorBinding: steward, expectedCaseVersion: 3, idempotencyKey: "example:planning", visibility: "private_case", policyVersion: h.v.policy.policyVersion,
    payload: { departmentPackage: { id: "example-planning", departmentId: "planning", suggestionId: before.projection.suggestion.id,
      request: "Review the pedestrian crossing options.", assignedAgentActorId: "example:agent", assignedReviewerActorId: "example:reviewer", authorityBinding: "none" } } });
  assert.equal(later.caseVersion, 4);
  adapter.close(); const reopened = h.open();
  assert.equal(reopened.caseCoordinators.open(receipt.caseId).project(query).caseVersion, 4);
  assert.deepEqual(await reopened.admission.admitCitizenAdoption!(command(h.v)), receipt);
  assert.deepEqual(h.counts(), [1, 1, 4, 2, 1, 1]);
  assert.equal(h.state.reads, 1); assert.equal(h.state.requests, 1);
});

test("authenticates before inspecting the adoption; rejects extra authority and legacy/synthetic shapes", async (t) => {
  const h = setup(t); const adapter = h.open(); const service = control(h, adapter);
  const untrusted = Object.defineProperty({}, "bundle", { get() { throw Error("body must not be evaluated"); } });
  assert.equal((await service.respond({ method: "POST", path, authorization: null, body: untrusted })).status, 401);
  for (const invalid of [{ ...body(h.v), actorBinding: steward }, { ...body(h.v), caseId: "chosen" },
    { ...body(h.v), verified: true }, { ...body(h.v), schemaVersion: "roebel_case_steward_admission_request_v1" },
    { ...body(h.v), bundle: { ...h.v.bundle, schemaVersion: "synthetic_citizen_adoption_tracer_v1" } }]) {
    assert.equal((await service.respond({ method: "POST", path, authorization: "example-staff-token", body: invalid })).status, 400);
  }
  await assert.rejects(adapter.admission.admitCitizenAdoption!({ ...command(h.v), actorBinding: { actorId: "example:public", actorClass: "case_steward" } }), /atomic_admission_input_invalid/);
  await assert.rejects(adapter.admission.admitCitizenAdoption!({ ...command(h.v), municipalityId: "another-city" }), /atomic_admission_input_invalid/);
  await assert.rejects(adapter.admission.admit({} as Parameters<typeof adapter.admission.admit>[0]), /atomic_admission_input_invalid/);
  assert.equal(h.state.reads, 0); assert.equal(h.state.requests, 0); assert.deepEqual(h.counts(), [0, 0, 0, 0, 0, 0]);
});

test("concurrent exact adoptions converge and retries require the complete original bundle and staff actor", async (t) => {
  const h = setup(t); const left = h.open(); const right = h.open();
  const [one, two] = await Promise.all([left.admission.admitCitizenAdoption!(command(h.v)), right.admission.admitCitizenAdoption!(command(h.v))]);
  assert.deepEqual(one, two); assert.deepEqual(h.counts(), [1, 1, 3, 1, 1, 1]);
  h.state.online = false; h.state.time += 3600;
  const changed = structuredClone(command(h.v)); changed.bundle.sourceAnswer.content = "changed";
  await assert.rejects(left.admission.admitCitizenAdoption!(changed), /idempotency_conflict/);
  await assert.rejects(left.admission.admitCitizenAdoption!({ ...command(h.v), actorBinding: { actorId: "example:backup", actorClass: "case_steward" } }), /idempotency_conflict/);
  const different = structuredClone(command(h.v));
  different.bundle.adoptionEvent.created_at++;
  Object.assign(different.bundle.adoptionEvent, JSON.parse(JSON.stringify(finalizeEvent(structuredClone(different.bundle.adoptionEvent), new Uint8Array(32).fill(83)))));
  await assert.rejects(left.admission.admitCitizenAdoption!(different), /case_binding_root_conflict/);
  assert.deepEqual(await right.admission.admitCitizenAdoption!(command(h.v)), one);
});

for (const failpoint of ["after_root_claim", "after_case_events", "after_binding_receipt"] as const) {
  test(`adoption failure ${failpoint} rolls back the nonce, root, journal and outbox together`, async (t) => {
    const h = setup(t, failpoint); const failed = h.open();
    await assert.rejects(failed.admission.admitCitizenAdoption!(command(h.v)), /atomic_admission_failpoint/);
    assert.deepEqual(h.counts(), [0, 0, 0, 0, 0, 0]); failed.close();
    const restored = h.open({ failpoint: undefined });
    assert.equal((await restored.admission.admitCitizenAdoption!(command(h.v))).caseVersion, 3);
  });
}
for (const expiryCall of [4, 5]) {
  test(`expiry at transaction clock check ${expiryCall - 3} prevents any committed Case`, async (t) => {
    const h = setup(t); let clockCalls = 0;
    const adapter = h.open({ citizenAdoption: { ...h.config.citizenAdoption!, now: () => new Date((h.v.verifiedAt + (++clockCalls >= expiryCall ? 30 : 0)) * 1000) } });
    await assert.rejects(adapter.admission.admitCitizenAdoption!(command(h.v)), /citizen_adoption_status_stale/);
    assert.deepEqual(h.counts(), [0, 0, 0, 0, 0, 0]);
  });
}

test("a repeated issuer status nonce cannot admit a second root, even with two valid signed responses", async (t) => {
  const h = setup(t); const adapter = h.open();
  t.mock.method(crypto, "randomBytes", () => Buffer.alloc(32, 0xcc)); syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const first = await adapter.admission.admitCitizenAdoption!(command(h.v));
  await assert.rejects(adapter.admission.admitCitizenAdoption!(command(h.second)), /citizen_adoption_nonce_consumed/);
  assert.deepEqual(h.counts(), [1, 1, 3, 1, 1, 1]);
  assert.deepEqual(await adapter.admission.admitCitizenAdoption!(command(h.v)), first);
});

test("revoked, expired, unaccepted and forged evidence creates no Case; caller cannot submit recorded evidence", async (t) => {
  const h = setup(t); const adapter = h.open();
  h.state.statusChanges = { state: "revoked" };
  await assert.rejects(adapter.admission.admitCitizenAdoption!(command(h.v)), /citizen_adoption_binding_invalid/);
  h.state.statusChanges = {}; h.state.time += 3600;
  await assert.rejects(adapter.admission.admitCitizenAdoption!(command(h.v)), /citizen_adoption_receipt_expired/);
  h.state.time = h.v.verifiedAt;
  const signed = h.v.adoptionAcceptance; h.v.adoptionAcceptance = {};
  await assert.rejects(adapter.admission.admitCitizenAdoption!(command(h.v)), /citizen_adoption_acceptance_unavailable/);
  h.v.adoptionAcceptance = signed;
  const forged = structuredClone(command(h.v)); forged.bundle.adoptionEvent.sig = "a".repeat(128);
  await assert.rejects(adapter.admission.admitCitizenAdoption!(forged), /citizen_adoption_event_invalid/);
  await assert.rejects(adapter.admission.admitCitizenAdoption!({ ...command(h.v), evidence: { verified: true } } as AtomicCitizenAdoptionAdmissionV1), /atomic_admission_input_invalid/);
  assert.deepEqual(h.counts(), [0, 0, 0, 0, 0, 0]);
});

test("replay rechecks issuer proofs and public v2 fields; a policy change cannot silently reopen the store", async (t) => {
  const h = setup(t); const adapter = h.open(); const receipt = await adapter.admission.admitCitizenAdoption!(command(h.v));
  const db = new DatabaseSync(h.databasePath);
  const payload = JSON.parse((db.prepare("SELECT payload_json FROM atomic_case_events WHERE case_version=3").get() as { payload_json: string }).payload_json) as { evidence: Record<string, unknown> };
  db.close();
  const record = structuredClone(payload.evidence);
  (record.eligibilityStatus as { proof: { signature: string } }).proof.signature = "a".repeat(86);
  assert.throws(() => verifyCitizenAdoptionCaseAdmission(record, h.v.policy), /citizen_adoption_proof_invalid/);
  const fakeDeadline = { ...payload.evidence, validUntil: h.v.verifiedAt + 31 };
  assert.throws(() => verifyCitizenAdoptionCaseAdmission(fakeDeadline, h.v.policy), /citizen_adoption_record_invalid/);
  for (const change of [{ bindingVote: true }, { candidateKind: "citizen_signed_topic_suggestion_v1" },
    { eligibilityReceiptChecksum: "d".repeat(64) }, { topicId: "urn:stadtstack:topic:municipality:another-city:crossing" }]) {
    const { receiptChecksum: _, ...unsigned } = { ...receipt, ...change }; void _;
    assert.throws(() => verifyPublicCaseBindingReceipt({ ...unsigned, receiptChecksum: `sha256:${digest(unsigned)}` }), /case_binding_receipt_invalid/);
  }
  adapter.close();
  assert.throws(() => h.open({ citizenAdoption: { ...h.config.citizenAdoption!, policy: { ...h.v.policy, issuerPublicKey: "c".repeat(64) } } }), /atomic_admission_config_mismatch/);
});

for (const differentActor of [false, true]) {
  test(`separate writer processes serialize the same adoption with ${differentActor ? "conflicting" : "identical"} staff actors`, async (t) => {
    const h = setup(t); h.open().close();
    const gate = join(h.rootDir, "admission-race-go");
    const workers = [0, 1].map((index) => {
      const inputPath = join(h.rootDir, `worker-${index}.json`);
      const input = command(h.v);
      if (differentActor && index === 1) input.actorBinding = { actorId: "example:backup", actorClass: "case_steward" };
      writeFileSync(inputPath, JSON.stringify({ config: h.config, vector: h.v, command: input, gate }));
      const child = spawn(process.execPath, [new URL("./helpers/citizen-adoption-admission-worker.mjs", import.meta.url).pathname, inputPath], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
      t.after(() => { if (child.exitCode === null) child.kill(); });
      let stdout = ""; let stderr = "";
      child.stdout!.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      const ready = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error(`barrier timed out: ${stderr}`)), 10_000);
        child.once("message", (message) => { clearTimeout(timer); if (message === "append_ready") resolve(); else reject(Error("unexpected worker message")); });
        child.once("error", (error) => { clearTimeout(timer); reject(error); });
        child.once("exit", () => { clearTimeout(timer); reject(Error(`worker exited before barrier: ${stdout} ${stderr}`)); });
      });
      const done = new Promise<{ receipt?: { receiptChecksum: string }; error?: string }>((resolve, reject) => {
        child.once("close", (code) => { if (code !== 0) return reject(Error(stderr));
          try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); } });
      });
      return { ready, done };
    });
    await Promise.all(workers.map((worker) => worker.ready));
    writeFileSync(gate, "go", { flag: "wx" });
    const results = await Promise.all(workers.map((worker) => worker.done));
    if (differentActor) {
      assert.equal(results.filter((item) => item.receipt).length, 1);
      assert.deepEqual(results.filter((item) => item.error).map((item) => item.error), ["idempotency_conflict"]);
    } else {
      assert.ok(results.every((item) => item.receipt && !item.error), JSON.stringify(results));
      assert.equal(results[0]!.receipt!.receiptChecksum, results[1]!.receipt!.receiptChecksum);
    }
    assert.deepEqual(h.counts(), [1, 1, 3, 1, 1, 1]);
    assert.equal(h.open().outbox.replay().length, 1);
  });
}

test("adopted Cases seal and reopen through the existing durable recovery format after expiry", async (t) => {
  const h = setup(t);
  const durableState = { mode: "durable_single_writer" as const, sourceReleaseDigest: `sha256:${"d".repeat(64)}` };
  const adapter = h.open({ durableState, rootDir: realpathSync(h.rootDir) });
  const receipt = await adapter.admission.admitCitizenAdoption!(command(h.v));
  const seal = adapter.sealAndClose();
  assert.equal(seal.recoveryEvidence.orderedHeads[0]!.caseId, receipt.caseId);
  assert.equal(seal.recoveryEvidence.orderedHeads[0]!.caseVersion, 3);
  h.state.time += 3600; h.state.online = false;
  const reopened = h.open({ durableState, rootDir: realpathSync(h.rootDir) });
  assert.deepEqual(await reopened.admission.admitCitizenAdoption!(command(h.v)), receipt);
  assert.deepEqual(reopened.outbox.replay()[0]!.receipt, receipt);
  assert.deepEqual(reopened.sealAndClose().recoveryEvidence, seal.recoveryEvidence);
});
