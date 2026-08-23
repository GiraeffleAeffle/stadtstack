import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";

import { finalizeEvent, getPublicKey, type Event as NostrEvent } from "nostr-tools/pure";

import { createInMemoryCaseBindingProjection } from "../../src/case-binding-projection.ts";
import type { CitizenSignedTopicSuggestionV1 } from "../../src/citizen-suggestion.ts";
import { verifyTopicCaseAdmission } from "../../src/topic-case-admission.ts";
import {
  createSqliteAtomicTopicCaseAdmission,
  type SqliteAtomicTopicCaseAdmissionOptions,
} from "../../src/adapters/sqlite-atomic-topic-case-admission.ts";
import type { AtomicTopicCaseAdmissionV1 } from "../../src/roebel-control-service.ts";

const MUNICIPALITY_ID = "roebel-mueritz";
const TOPIC_ID = "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse";
const POLICY_VERSION = "case-intake-v1";
const CITIZEN_SECRET = new Uint8Array(32).fill(21);
const AGENT_SECRET = new Uint8Array(32).fill(22);
const CITIZEN_PUBKEY = getPublicKey(CITIZEN_SECRET);
const AGENT_PUBKEY = getPublicKey(AGENT_SECRET);
const RECEIPT_ID = `urn:stadtstack:mecky-answer:${"a".repeat(64)}`;
const TEMP_ROOTS = new Set<string>();

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  TEMP_ROOTS.add(root);
  return root;
}

after(() => {
  for (const root of TEMP_ROOTS) rmSync(root, { recursive: true, force: true });
});

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function digest(value: unknown): string { return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`; }
function plainEvent(event: NostrEvent): NostrEvent { return JSON.parse(JSON.stringify(event)) as NostrEvent; }

function fixture(title = "Sichere Querung gemeinsam prüfen", discussionSuffix = ""): { sourceDiscussion: NostrEvent; sourceAnswer: NostrEvent; signedSuggestion: CitizenSignedTopicSuggestionV1 } {
  const sourceDiscussion = plainEvent(finalizeEvent({
    kind: 1, created_at: 1_787_356_800, content: `@Mecky Welche geprüften Möglichkeiten gibt es für eine sichere Querung?${discussionSuffix}`,
    tags: [["p", AGENT_PUBKEY], ["t", "stadtstack-civic-discussion"], ["municipality", MUNICIPALITY_ID], ["topic", TOPIC_ID], ["stance", "root"], ["argument-root", "self"]],
  }, CITIZEN_SECRET));
  const sourceAnswer = plainEvent(finalizeEvent({
    kind: 1, created_at: sourceDiscussion.created_at + 1, content: "Geprüfte Unterlagen beschreiben mehrere Varianten.",
    tags: [["e", sourceDiscussion.id, "", "reply"], ["p", CITIZEN_PUBKEY], ["municipality", MUNICIPALITY_ID], ["topic", TOPIC_ID], ["mecky-receipt", RECEIPT_ID], ["evidence", `sha256:${"c".repeat(64)}`, "https://roebel.example/reviewed/crossing-options"]],
  }, AGENT_SECRET));
  const core = {
    sourceAnswerReceiptId: RECEIPT_ID, sourceDiscussionId: sourceDiscussion.id, sourceDiscussionRef: `nostr://event/${sourceDiscussion.id}`,
    municipalityId: MUNICIPALITY_ID, topicId: TOPIC_ID, citizenPubkey: CITIZEN_PUBKEY, title,
    summary: "Die geprüften Varianten sollen öffentlich abgewogen und anschließend menschlich in den Civic-Case-Prozess aufgenommen werden.",
  };
  const draft = { schemaVersion: "public_mecky_topic_suggestion_draft_v1" as const, draftId: `urn:stadtstack:topic-suggestion-draft:${digest(core).slice(7)}`, ...core, entryState: "citizen_signature_required" as const, authorityBinding: "none" as const, submittedToCivicWorkflow: false as const };
  const event = plainEvent(finalizeEvent({
    kind: 1, created_at: sourceAnswer.created_at + 1, content: JSON.stringify(draft),
    tags: [["schema", "citizen_signed_topic_suggestion_v1"], ["municipality", MUNICIPALITY_ID], ["topic", TOPIC_ID], ["e", sourceDiscussion.id, "", "root"], ["mecky-receipt", RECEIPT_ID]],
  }, CITIZEN_SECRET));
  return { sourceDiscussion, sourceAnswer, signedSuggestion: {
    schemaVersion: "citizen_signed_topic_suggestion_v1", candidateId: `urn:stadtstack:signed-topic-suggestion:${event.id}`, signerPubkey: event.pubkey, draft,
    event: { ...event, kind: 1 }, verification: { kind: "nostr_nip01", verified: true }, entryState: "awaiting_human_case_admission", authorityBinding: "none", submittedToCivicWorkflow: false,
  } };
}

function options(rootDir: string, failpoint?: SqliteAtomicTopicCaseAdmissionOptions["failpoint"]): SqliteAtomicTopicCaseAdmissionOptions {
  return {
    rootDir, municipalityId: MUNICIPALITY_ID, policyVersion: POLICY_VERSION,
    actorRegistry: [
      { actorId: "roebel:case-steward", actorClass: "case_steward" },
      { actorId: "roebel:case-steward-backup", actorClass: "case_steward" },
      { actorId: "roebel:public", actorClass: "public" },
      { actorId: "roebel:administration", actorClass: "administration" },
      { actorId: "roebel:planning-agent", actorClass: "department_agent", departmentId: "planning" },
      { actorId: "roebel:planning-reviewer", actorClass: "department_reviewer", departmentId: "planning" },
    ],
    allowedSignerPubkeys: [CITIZEN_PUBKEY], allowedAgentPubkeys: [AGENT_PUBKEY], ...(failpoint ? { failpoint } : {}),
  };
}

function input(value = fixture()): AtomicTopicCaseAdmissionV1 {
  const verified = verifyTopicCaseAdmission({ ...value, allowedAgentPubkeys: [AGENT_PUBKEY] });
  return {
    schemaVersion: "atomic_topic_case_admission_v1", municipalityId: MUNICIPALITY_ID, rootEventId: verified.discussion.id,
    caseId: verified.identity.caseId, actorBinding: { actorId: "roebel:case-steward", actorClass: "case_steward" },
    expectedCaseVersion: 0, idempotencyKey: `roebel:admit-signed-topic-suggestion:${verified.signedSuggestion.event.id}`,
    policyVersion: POLICY_VERSION, sourceDiscussion: value.sourceDiscussion, verifiedAdmission: verified,
  };
}

function concurrentAdmissionProcess(rootDir: string, gatePath: string, appendGatePath: string, candidate: AtomicTopicCaseAdmissionV1): {
  ready: Promise<void>;
  appendReady: Promise<void>;
  done: Promise<{ code: number | null; stdout: string; stderr: string }>;
} {
  const adapterUrl = new URL("../../src/adapters/sqlite-atomic-topic-case-admission.ts", import.meta.url).href;
  const script = `
    import { existsSync } from 'node:fs';
    import { DatabaseSync } from 'node:sqlite';
    const { createSqliteAtomicTopicCaseAdmission } = await import(process.env.ATOMIC_ADAPTER_URL);
    const input = JSON.parse(Buffer.from(process.env.ATOMIC_INPUT, 'base64url').toString('utf8'));
    const config = JSON.parse(Buffer.from(process.env.ATOMIC_CONFIG, 'base64url').toString('utf8'));
    const originalExec = DatabaseSync.prototype.exec;
    let beginImmediateCount = 0;
    DatabaseSync.prototype.exec = function (sql) {
      if (sql.trim().toUpperCase() === 'BEGIN IMMEDIATE') beginImmediateCount += 1;
      if (beginImmediateCount === 2 && sql.trim().toUpperCase() === 'BEGIN IMMEDIATE') {
        process.stdout.write('APPEND_READY\\n');
        const appendWait = new Int32Array(new SharedArrayBuffer(4));
        while (!existsSync(process.env.ATOMIC_APPEND_GATE)) Atomics.wait(appendWait, 0, 0, 5);
      }
      return originalExec.call(this, sql);
    };
    const adapter = createSqliteAtomicTopicCaseAdmission(config);
    process.stdout.write('READY\\n');
    const wait = new Int32Array(new SharedArrayBuffer(4));
    while (!existsSync(process.env.ATOMIC_GATE)) Atomics.wait(wait, 0, 0, 5);
    try { const receipt = await adapter.admission.admit(input); process.stdout.write('OK:' + receipt.receiptChecksum + '\\n'); }
    catch (error) { process.stdout.write('ERR:' + (error instanceof Error ? error.message : 'unknown') + '\\n'); process.exitCode = 1; }
    finally { DatabaseSync.prototype.exec = originalExec; adapter.close(); }
  `;
  const config = options(rootDir);
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
    env: {
      ...process.env,
      ATOMIC_ADAPTER_URL: adapterUrl,
      ATOMIC_INPUT: Buffer.from(JSON.stringify(candidate)).toString("base64url"),
      ATOMIC_CONFIG: Buffer.from(JSON.stringify(config)).toString("base64url"),
      ATOMIC_GATE: gatePath,
      ATOMIC_APPEND_GATE: appendGatePath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`atomic_race_ready_timeout:${stderr}`)), 10_000);
    child.stdout.on("data", () => { if (stdout.includes("READY\n")) { clearTimeout(timer); resolve(); } });
    child.once("error", reject);
  });
  const appendReady = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`atomic_race_append_timeout:${stderr}`)), 10_000);
    child.stdout.on("data", () => { if (stdout.includes("APPEND_READY\n")) { clearTimeout(timer); resolve(); } });
    child.once("error", reject);
  });
  const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => child.once("close", (code) => resolve({ code, stdout, stderr })));
  return { ready, appendReady, done };
}

function concurrentContinuationReadProcess(rootDir: string, caseId: string, startGatePath: string, resumeGatePath: string, query: object): {
  ready: Promise<void>;
  metaReady: Promise<void>;
  done: Promise<{ code: number | null; stdout: string; stderr: string }>;
} {
  const adapterUrl = new URL("../../src/adapters/sqlite-atomic-topic-case-admission.ts", import.meta.url).href;
  const metaQuery = "SELECT case_id,municipality_id,namespace,options_fingerprint,case_version,head_checksum FROM atomic_case_meta WHERE case_id=?";
  const script = `
    import { existsSync } from 'node:fs';
    import { DatabaseSync } from 'node:sqlite';
    const { createSqliteAtomicTopicCaseAdmission } = await import(process.env.ATOMIC_ADAPTER_URL);
    const config = JSON.parse(Buffer.from(process.env.ATOMIC_CONFIG, 'base64url').toString('utf8'));
    const caseId = process.env.ATOMIC_CASE_ID;
    const query = JSON.parse(Buffer.from(process.env.ATOMIC_QUERY, 'base64url').toString('utf8'));
    const originalPrepare = DatabaseSync.prototype.prepare;
    let metaGetCount = 0;
    DatabaseSync.prototype.prepare = function (sql) {
      const statement = originalPrepare.call(this, sql);
      if (sql.trim() === ${JSON.stringify(metaQuery)}) {
        const originalGet = statement.get;
        statement.get = function (...args) {
          const row = originalGet.apply(this, args);
          metaGetCount += 1;
          // Adapter construction performs the first recovery read.  During
          // open(), the third read is the recovery read inside the same
          // BEGIN snapshot as the preceding meta read.  Pause there so the
          // parent can commit version 4 concurrently.
          if (metaGetCount === 3) {
            process.stdout.write('META_READY\\n');
            const wait = new Int32Array(new SharedArrayBuffer(4));
            while (!existsSync(process.env.ATOMIC_RESUME_GATE)) Atomics.wait(wait, 0, 0, 5);
          }
          return row;
        };
      }
      return statement;
    };
    const adapter = createSqliteAtomicTopicCaseAdmission(config);
    process.stdout.write('READY\\n');
    const wait = new Int32Array(new SharedArrayBuffer(4));
    while (!existsSync(process.env.ATOMIC_START_GATE)) Atomics.wait(wait, 0, 0, 5);
    try {
      const coordinator = adapter.caseCoordinators.open(caseId);
      process.stdout.write('OPENED\\n');
      const projection = coordinator.project(query);
      process.stdout.write('OK:' + projection.caseVersion + '\\n');
    } catch (error) {
      process.stdout.write('ERR:' + (error instanceof Error ? error.message : 'unknown') + '\\n');
      process.exitCode = 1;
    } finally {
      DatabaseSync.prototype.prepare = originalPrepare;
      adapter.close();
    }
  `;
  const config = options(rootDir);
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
    env: {
      ...process.env,
      ATOMIC_ADAPTER_URL: adapterUrl,
      ATOMIC_CONFIG: Buffer.from(JSON.stringify(config)).toString("base64url"),
      ATOMIC_CASE_ID: caseId,
      ATOMIC_QUERY: Buffer.from(JSON.stringify(query)).toString("base64url"),
      ATOMIC_START_GATE: startGatePath,
      ATOMIC_RESUME_GATE: resumeGatePath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`atomic_continuation_ready_timeout:${stderr}`)), 10_000);
    child.stdout.on("data", () => { if (stdout.includes("READY\n")) { clearTimeout(timer); resolve(); } });
    child.once("error", reject);
  });
  const metaReady = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`atomic_continuation_meta_timeout:${stderr}`)), 10_000);
    child.stdout.on("data", () => { if (stdout.includes("META_READY\n")) { clearTimeout(timer); resolve(); } });
    child.once("error", reject);
  });
  const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => child.once("close", (code) => resolve({ code, stdout, stderr })));
  return { ready, metaReady, done };
}

test("one municipal WAL/FULL database atomically writes a Case, receipt, and credential-free outbox", async () => {
  const rootDir = temporaryRoot("stadtstack-atomic-admission-");
  const adapter = createSqliteAtomicTopicCaseAdmission(options(rootDir));
  const first = await adapter.admission.admit(input());
  assert.equal(first.caseVersion, 3);
  assert.equal(adapter.outbox.replay().length, 1);
  assert.equal(adapter.outbox.replay()[0]!.receipt.receiptChecksum, first.receiptChecksum);
  assert.deepEqual(Object.keys(adapter.outbox).sort(), ["replay"]);
  assert.equal("admit" in adapter.outbox, false);
  const db = new DatabaseSync(join(rootDir, `stadtstack-${MUNICIPALITY_ID}-atomic-admission.sqlite`));
  assert.equal(String((db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toLowerCase(), "wal");
  assert.equal((db.prepare("PRAGMA synchronous").get() as { synchronous: number }).synchronous, 2);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM atomic_case_events").get() as { count: number }).count, 3);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM atomic_case_idempotency").get() as { count: number }).count, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM atomic_binding_receipts").get() as { count: number }).count, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM atomic_binding_outbox").get() as { count: number }).count, 1);
  db.close(); adapter.close();
});

test("unknown outbox replay is read-only, reopen returns byte-identical receipt, and a different candidate conflicts", async () => {
  const rootDir = temporaryRoot("stadtstack-atomic-reopen-");
  const firstAdapter = createSqliteAtomicTopicCaseAdmission(options(rootDir));
  assert.deepEqual(firstAdapter.outbox.replay(), []);
  const dbBefore = new DatabaseSync(join(rootDir, `stadtstack-${MUNICIPALITY_ID}-atomic-admission.sqlite`));
  assert.equal((dbBefore.prepare("SELECT COUNT(*) AS count FROM atomic_case_meta").get() as { count: number }).count, 0);
  dbBefore.close();
  const value = input();
  const first = await firstAdapter.admission.admit(value);
  const firstBytes = JSON.stringify(first);
  firstAdapter.close();
  const reopened = createSqliteAtomicTopicCaseAdmission(options(rootDir));
  const retry = await reopened.admission.admit(value);
  assert.equal(JSON.stringify(retry), firstBytes);
  await assert.rejects(reopened.admission.admit(input(fixture("Andere Formulierung"))), /case_binding_root_conflict/);
  reopened.close();
});

test("only an exact deployment-pinned Case Steward can admit and configuration drift fails closed", async () => {
  const rootDir = temporaryRoot("stadtstack-atomic-registry-");
  const adapter = createSqliteAtomicTopicCaseAdmission(options(rootDir));
  const unauthorized = input();
  unauthorized.actorBinding = { actorId: "roebel:not-steward", actorClass: "case_steward" };
  await assert.rejects(adapter.admission.admit(unauthorized), /atomic_admission_input_invalid/);
  await adapter.admission.admit(input());
  adapter.close();
  assert.throws(() => createSqliteAtomicTopicCaseAdmission({ ...options(rootDir), policyVersion: "case-intake-v2" }), /atomic_admission_config_mismatch/);
});

test("credential-free outbox pagination is ordered and every page is still receipt-verified", async () => {
  const rootDir = temporaryRoot("stadtstack-atomic-pagination-");
  const adapter = createSqliteAtomicTopicCaseAdmission(options(rootDir));
  await adapter.admission.admit(input(fixture("Erste Querung", " A")));
  await adapter.admission.admit(input(fixture("Zweite Querung", " B")));
  const first = adapter.outbox.replay({ limit: 1 });
  const second = adapter.outbox.replay({ afterSequence: first[0]!.sequence, limit: 1 });
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.ok(second[0]!.sequence > first[0]!.sequence);
  assert.equal(adapter.outbox.replay({ afterSequence: second[0]!.sequence }).length, 0);
  adapter.close();
});

test("every initial failpoint rolls back root claim, Case journal, receipt, and outbox together", async () => {
  for (const failpoint of ["after_root_claim", "after_case_events", "after_binding_receipt"] as const) {
    const rootDir = temporaryRoot(`stadtstack-atomic-rollback-${failpoint}-`);
    const failing = createSqliteAtomicTopicCaseAdmission(options(rootDir, failpoint));
    await assert.rejects(failing.admission.admit(input()), /atomic_admission_failpoint/);
    failing.close();
    const db = new DatabaseSync(join(rootDir, `stadtstack-${MUNICIPALITY_ID}-atomic-admission.sqlite`));
    for (const table of ["atomic_case_meta", "atomic_root_claims", "atomic_case_events", "atomic_case_idempotency", "atomic_binding_receipts", "atomic_binding_outbox"]) {
      assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count, 0, `${failpoint}:${table}`);
    }
    db.close();
    const recovered = createSqliteAtomicTopicCaseAdmission(options(rootDir));
    assert.equal((await recovered.admission.admit(input())).caseVersion, 3);
    recovered.close();
  }
});

test("two database connections converge on one same-candidate claim and one outbox entry", async () => {
  const rootDir = temporaryRoot("stadtstack-atomic-race-");
  const left = createSqliteAtomicTopicCaseAdmission(options(rootDir));
  const right = createSqliteAtomicTopicCaseAdmission(options(rootDir));
  const candidate = input();
  const [one, two] = await Promise.all([left.admission.admit(candidate), right.admission.admit(candidate)]);
  assert.equal(JSON.stringify(one), JSON.stringify(two));
  assert.equal(left.outbox.replay().length, 1);
  left.close(); right.close();
});

test("two independently scheduled Node processes cross a barrier and converge on one atomic claim", async () => {
  const rootDir = temporaryRoot("stadtstack-atomic-process-race-");
  const gatePath = join(rootDir, "race-go");
  const appendGatePath = join(rootDir, "append-go");
  const candidate = input();
  const left = concurrentAdmissionProcess(rootDir, gatePath, appendGatePath, candidate);
  const right = concurrentAdmissionProcess(rootDir, gatePath, appendGatePath, candidate);
  await Promise.all([left.ready, right.ready]);
  writeFileSync(gatePath, "go", { flag: "wx" });
  await Promise.all([left.appendReady, right.appendReady]);
  writeFileSync(appendGatePath, "go", { flag: "wx" });
  const [leftDone, rightDone] = await Promise.all([left.done, right.done]);
  assert.equal(leftDone.code, 0, leftDone.stderr);
  assert.equal(rightDone.code, 0, rightDone.stderr);
  assert.match(leftDone.stdout, /OK:sha256:/);
  assert.match(rightDone.stdout, /OK:sha256:/);
  const adapter = createSqliteAtomicTopicCaseAdmission(options(rootDir));
  assert.equal(adapter.outbox.replay().length, 1);
  adapter.close();
});

test("two database connections allow exactly one different-candidate claim for the same immutable root", async () => {
  const rootDir = temporaryRoot("stadtstack-atomic-race-conflict-");
  const left = createSqliteAtomicTopicCaseAdmission(options(rootDir));
  const right = createSqliteAtomicTopicCaseAdmission(options(rootDir));
  const results = await Promise.allSettled([left.admission.admit(input()), right.admission.admit(input(fixture("Alternative Kandidatin")))]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  assert.match(String(rejected?.reason), /case_binding_root_conflict/);
  assert.equal(left.outbox.replay().length, 1);
  left.close(); right.close();
});

test("a coherently rewritten receipt cannot detach its topic from the signed journal payload", async () => {
  const rootDir = temporaryRoot("stadtstack-atomic-receipt-binding-");
  const adapter = createSqliteAtomicTopicCaseAdmission(options(rootDir));
  const admitted = await adapter.admission.admit(input());
  adapter.close();
  const db = new DatabaseSync(join(rootDir, `stadtstack-${MUNICIPALITY_ID}-atomic-admission.sqlite`));
  const stored = db.prepare("SELECT receipt_json FROM atomic_binding_receipts WHERE case_id=?").get(admitted.caseId) as { receipt_json: string };
  const parsed = JSON.parse(stored.receipt_json) as Record<string, unknown>;
  const forgedUnsigned: Record<string, unknown> = {
    ...parsed,
    topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:forged-topic",
  };
  delete forgedUnsigned.receiptChecksum;
  const forgedReceipt = JSON.stringify({ ...forgedUnsigned, receiptChecksum: digest(forgedUnsigned) });
  db.prepare("UPDATE atomic_binding_receipts SET receipt_json=? WHERE case_id=?").run(forgedReceipt, admitted.caseId);
  db.prepare("UPDATE atomic_binding_outbox SET receipt_json=?,receipt_checksum=? WHERE case_id=?")
    .run(forgedReceipt, digest(forgedUnsigned), admitted.caseId);
  db.close();
  assert.throws(() => createSqliteAtomicTopicCaseAdmission(options(rootDir)), /atomic_admission_unit_corrupt/);
});

test("a cross-process continuation cannot make an in-flight old-snapshot open look corrupt", async () => {
  const rootDir = temporaryRoot("stadtstack-atomic-continuation-snapshot-");
  const parent = createSqliteAtomicTopicCaseAdmission(options(rootDir));
  const admitted = await parent.admission.admit(input());
  const coordinator = parent.caseCoordinators.open(admitted.caseId);
  const before = coordinator.project({
    schemaVersion: "query_envelope_v1", queryType: "case_projection_v1", caseId: admitted.caseId,
    actorBinding: { actorId: "roebel:public", actorClass: "public" }, visibility: "public",
    policyVersion: POLICY_VERSION, atCaseVersion: null,
  });
  const startGatePath = join(rootDir, "continuation-start");
  const resumeGatePath = join(rootDir, "continuation-resume");
  const child = concurrentContinuationReadProcess(rootDir, admitted.caseId, startGatePath, resumeGatePath, {
    schemaVersion: "query_envelope_v1", queryType: "case_projection_v1", caseId: admitted.caseId,
    actorBinding: { actorId: "roebel:public", actorClass: "public" }, visibility: "public",
    policyVersion: POLICY_VERSION, atCaseVersion: null,
  });
  await child.ready;
  writeFileSync(startGatePath, "go", { flag: "wx" });
  await child.metaReady;

  const later = coordinator.handle({
    schemaVersion: "command_envelope_v1", commandType: "assign_department_package_v1", caseId: admitted.caseId,
    actorBinding: { actorId: "roebel:case-steward", actorClass: "case_steward" }, expectedCaseVersion: 3,
    idempotencyKey: "roebel:continuation:snapshot-planning-1", visibility: "private_case", policyVersion: POLICY_VERSION,
    payload: { departmentPackage: {
      id: "package-snapshot-planning-1", departmentId: "planning", suggestionId: before.projection.suggestion.id,
      request: "Welche Varianten können die Querung sicherer machen?", assignedAgentActorId: "roebel:planning-agent",
      assignedReviewerActorId: "roebel:planning-reviewer", authorityBinding: "none",
    } },
  });
  assert.equal(later.caseVersion, 4);
  writeFileSync(resumeGatePath, "go", { flag: "wx" });
  const result = await child.done;
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /META_READY\nOPENED\nOK:4\n/);
  parent.close();
});

test("only an admitted Case can be reopened and later commands append to its same municipal journal", async () => {
  const rootDir = temporaryRoot("stadtstack-atomic-continuation-");
  const adapter = createSqliteAtomicTopicCaseAdmission(options(rootDir));
  assert.throws(() => adapter.caseCoordinators.open("urn:stadtstack:case:test:roebel-mueritz:018f0000-0000-7000-8000-000000000001"), /atomic_admission_case_not_admitted/);
  const candidate = input();
  const admitted = await adapter.admission.admit(candidate);
  const coordinator = adapter.caseCoordinators.open(admitted.caseId);
  const before = coordinator.project({
    schemaVersion: "query_envelope_v1", queryType: "case_projection_v1", caseId: admitted.caseId,
    actorBinding: { actorId: "roebel:public", actorClass: "public" }, visibility: "public",
    policyVersion: POLICY_VERSION, atCaseVersion: null,
  });
  const later = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "assign_department_package_v1",
    caseId: admitted.caseId,
    actorBinding: { actorId: "roebel:case-steward", actorClass: "case_steward" },
    expectedCaseVersion: 3,
    idempotencyKey: "roebel:continuation:planning-1",
    visibility: "private_case",
    policyVersion: POLICY_VERSION,
    payload: { departmentPackage: {
      id: "package-planning-1", departmentId: "planning", suggestionId: before.projection.suggestion.id,
      request: "Welche Varianten können die Querung sicherer machen?", assignedAgentActorId: "roebel:planning-agent",
      assignedReviewerActorId: "roebel:planning-reviewer", authorityBinding: "none",
    } },
  });
  assert.equal(later.caseVersion, 4);
  const assigned = coordinator.project({
    schemaVersion: "query_envelope_v1", queryType: "case_projection_v1", caseId: admitted.caseId,
    actorBinding: { actorId: "roebel:administration", actorClass: "administration" }, visibility: "administration",
    policyVersion: POLICY_VERSION, atCaseVersion: null,
  }).projection.departmentPackage;
  assert.ok(assigned);
  const drafted = coordinator.handle({
    schemaVersion: "command_envelope_v1", commandType: "record_department_draft_v1", caseId: admitted.caseId,
    actorBinding: { actorId: "roebel:planning-agent", actorClass: "department_agent" }, expectedCaseVersion: 4,
    idempotencyKey: "roebel:continuation:planning-draft-1", visibility: "private_case", policyVersion: POLICY_VERSION,
    payload: {
      packageId: assigned.id,
      packageChecksum: assigned.packageChecksum,
      draft: {
        schemaVersion: "department_draft_v1", id: "draft-planning-1",
        publicSummary: "Mehrere Querungsvarianten werden fachlich geprüft.",
        publicCitations: ["synthetic://roebel/planning/reviewed-crossing-options"],
        privateEvidenceRefs: ["synthetic://roebel/planning/private-evidence-1"], authorityBinding: "none",
      },
    },
  });
  assert.equal(drafted.caseVersion, 5);
  assert.equal(adapter.outbox.replay().length, 1);
  adapter.close();
  const reopened = createSqliteAtomicTopicCaseAdmission(options(rootDir));
  const recovered = reopened.caseCoordinators.open(admitted.caseId).project({
    schemaVersion: "query_envelope_v1", queryType: "case_projection_v1", caseId: admitted.caseId,
    actorBinding: { actorId: "roebel:public", actorClass: "public" }, visibility: "public",
    policyVersion: POLICY_VERSION, atCaseVersion: null,
  });
  assert.equal(recovered.caseVersion, 5);
  reopened.close();
});

test("startup and outbox corruption fail closed while a valid replay rebuilds the public binding projection", async () => {
  const rootDir = temporaryRoot("stadtstack-atomic-projection-");
  const adapter = createSqliteAtomicTopicCaseAdmission(options(rootDir));
  const receipt = await adapter.admission.admit(input());
  const projection = createInMemoryCaseBindingProjection(adapter.outbox.replay().map((entry) => entry.receipt));
  assert.deepEqual(projection.reader.get(receipt.caseId), receipt);
  adapter.close();
  const db = new DatabaseSync(join(rootDir, `stadtstack-${MUNICIPALITY_ID}-atomic-admission.sqlite`));
  db.prepare("UPDATE atomic_case_events SET payload_json=? WHERE case_version=2").run("null");
  db.close();
  assert.throws(() => createSqliteAtomicTopicCaseAdmission(options(rootDir)), /atomic_admission_(journal|unit)_corrupt/);

  const outboxRoot = temporaryRoot("stadtstack-atomic-outbox-corrupt-");
  const outboxAdapter = createSqliteAtomicTopicCaseAdmission(options(outboxRoot));
  await outboxAdapter.admission.admit(input());
  outboxAdapter.close();
  const outboxDb = new DatabaseSync(join(outboxRoot, `stadtstack-${MUNICIPALITY_ID}-atomic-admission.sqlite`));
  outboxDb.prepare("DELETE FROM atomic_binding_outbox").run();
  outboxDb.close();
  assert.throws(() => createSqliteAtomicTopicCaseAdmission(options(outboxRoot)), /atomic_admission_unit_corrupt/);

  const claimRoot = temporaryRoot("stadtstack-atomic-claim-corrupt-");
  const claimAdapter = createSqliteAtomicTopicCaseAdmission(options(claimRoot));
  await claimAdapter.admission.admit(input());
  claimAdapter.close();
  const claimDb = new DatabaseSync(join(claimRoot, `stadtstack-${MUNICIPALITY_ID}-atomic-admission.sqlite`));
  claimDb.prepare("DELETE FROM atomic_root_claims").run();
  claimDb.close();
  assert.throws(() => createSqliteAtomicTopicCaseAdmission(options(claimRoot)), /atomic_admission_unit_corrupt/);
});
