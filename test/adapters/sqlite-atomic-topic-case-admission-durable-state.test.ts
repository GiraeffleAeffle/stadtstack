import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";

import { finalizeEvent, getPublicKey, type Event as NostrEvent } from "nostr-tools/pure";

import type { CitizenSignedTopicSuggestionV1 } from "../../src/citizen-suggestion.ts";
import { verifyTopicCaseAdmission } from "../../src/topic-case-admission.ts";
import {
  CASE_SHUTDOWN_SEAL_FILENAME,
  createSqliteAtomicTopicCaseAdmission,
  verifyCaseShutdownSeal,
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
const ROOTS = new Set<string>();

function durableRoot(): string {
  // A home-directory temporary child is deliberately outside the system tmp
  // directory: durable mode must not inherit the legacy tmp-only path rule.
  const root = mkdtempSync(join(homedir(), ".stadtstack-durable-admission-"));
  ROOTS.add(root);
  return root;
}

after(() => { for (const root of ROOTS) rmSync(root, { recursive: true, force: true }); });

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function digest(value: unknown): string { return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`; }
function plainEvent(event: NostrEvent): NostrEvent { return JSON.parse(JSON.stringify(event)) as NostrEvent; }

function fixture(): { sourceDiscussion: NostrEvent; sourceAnswer: NostrEvent; signedSuggestion: CitizenSignedTopicSuggestionV1 } {
  const sourceDiscussion = plainEvent(finalizeEvent({
    kind: 1, created_at: 1_787_356_800, content: "@Mecky Welche geprüften Möglichkeiten gibt es für eine sichere Querung?",
    tags: [["p", AGENT_PUBKEY], ["t", "stadtstack-civic-discussion"], ["municipality", MUNICIPALITY_ID], ["topic", TOPIC_ID], ["stance", "root"], ["argument-root", "self"]],
  }, CITIZEN_SECRET));
  const sourceAnswer = plainEvent(finalizeEvent({
    kind: 1, created_at: sourceDiscussion.created_at + 1, content: "Geprüfte Unterlagen beschreiben mehrere Varianten.",
    tags: [["e", sourceDiscussion.id, "", "reply"], ["p", CITIZEN_PUBKEY], ["municipality", MUNICIPALITY_ID], ["topic", TOPIC_ID], ["mecky-receipt", RECEIPT_ID], ["evidence", `sha256:${"c".repeat(64)}`, "https://roebel.example/reviewed/crossing-options"]],
  }, AGENT_SECRET));
  const core = {
    sourceAnswerReceiptId: RECEIPT_ID, sourceDiscussionId: sourceDiscussion.id, sourceDiscussionRef: `nostr://event/${sourceDiscussion.id}`,
    municipalityId: MUNICIPALITY_ID, topicId: TOPIC_ID, citizenPubkey: CITIZEN_PUBKEY, title: "Sichere Querung gemeinsam prüfen",
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

function options(rootDir: string, durable = true): SqliteAtomicTopicCaseAdmissionOptions {
  return {
    rootDir, municipalityId: MUNICIPALITY_ID, policyVersion: POLICY_VERSION,
    actorRegistry: [
      { actorId: "roebel:case-steward", actorClass: "case_steward" }, { actorId: "roebel:case-steward-backup", actorClass: "case_steward" },
      { actorId: "roebel:public", actorClass: "public" }, { actorId: "roebel:administration", actorClass: "administration" },
      { actorId: "roebel:planning-agent", actorClass: "department_agent", departmentId: "planning" },
      { actorId: "roebel:planning-reviewer", actorClass: "department_reviewer", departmentId: "planning" },
    ],
    allowedSignerPubkeys: [CITIZEN_PUBKEY], allowedAgentPubkeys: [AGENT_PUBKEY],
    ...(durable ? { durableState: { mode: "durable_single_writer" as const, sourceReleaseDigest: `sha256:${"d".repeat(64)}` } } : {}),
  };
}

function input(value = fixture()): AtomicTopicCaseAdmissionV1 {
  const verified = verifyTopicCaseAdmission({ ...value, allowedAgentPubkeys: [AGENT_PUBKEY] });
  return {
    schemaVersion: "atomic_topic_case_admission_v1", municipalityId: MUNICIPALITY_ID, rootEventId: verified.discussion.id,
    caseId: verified.identity.caseId, actorBinding: { actorId: "roebel:case-steward", actorClass: "case_steward" }, expectedCaseVersion: 0,
    idempotencyKey: `roebel:admit-signed-topic-suggestion:${verified.signedSuggestion.event.id}`, policyVersion: POLICY_VERSION,
    sourceDiscussion: value.sourceDiscussion, verifiedAdmission: verified,
  };
}

test("durable single writer seals canonical recovery evidence and releases its live owner lock", async () => {
  const root = durableRoot();
  const adapter = createSqliteAtomicTopicCaseAdmission(options(root));
  const admitted = await adapter.admission.admit(input());
  const coordinator = adapter.caseCoordinators.open(admitted.caseId);
  const before = coordinator.project({
    schemaVersion: "query_envelope_v1", queryType: "case_projection_v1", caseId: admitted.caseId,
    actorBinding: { actorId: "roebel:public", actorClass: "public" }, visibility: "public",
    policyVersion: POLICY_VERSION, atCaseVersion: null,
  });
  const continued = coordinator.handle({
    schemaVersion: "command_envelope_v1", commandType: "assign_department_package_v1", caseId: admitted.caseId,
    actorBinding: { actorId: "roebel:case-steward", actorClass: "case_steward" }, expectedCaseVersion: 3,
    idempotencyKey: "roebel:durable-seal:planning-1", visibility: "private_case", policyVersion: POLICY_VERSION,
    payload: { departmentPackage: {
      id: "package-durable-seal-planning-1", departmentId: "planning", suggestionId: before.projection.suggestion.id,
      request: "Welche Varianten können die Querung sicherer machen?", assignedAgentActorId: "roebel:planning-agent",
      assignedReviewerActorId: "roebel:planning-reviewer", authorityBinding: "none",
    } },
  });
  assert.equal(continued.caseVersion, 4);
  assert.throws(() => createSqliteAtomicTopicCaseAdmission(options(root)), /atomic_admission_owner_locked/);
  const seal = adapter.sealAndClose();
  assert.strictEqual(adapter.sealAndClose(), seal);
  assert.equal(Object.isFrozen(seal), true);
  assert.equal(Object.isFrozen(seal.recoveryEvidence), true);
  assert.deepEqual(seal.walCheckpoint, { mode: "TRUNCATE", busy: 0, log: seal.walCheckpoint.log, checkpointed: seal.walCheckpoint.checkpointed });
  assert.equal(seal.databaseBasename, `stadtstack-${MUNICIPALITY_ID}-atomic-admission.sqlite`);
  assert.equal(seal.recoveryEvidence.orderedHeads[0]!.caseVersion, 4);
  const encoded = readFileSync(join(root, CASE_SHUTDOWN_SEAL_FILENAME), "utf8");
  assert.equal(encoded, `${canonical(seal)}\n`);
  assert.deepEqual(verifyCaseShutdownSeal(JSON.parse(encoded)), seal);
  for (const suffix of ["-wal", "-shm"] as const) {
    const sidecar = join(root, `${seal.databaseBasename}${suffix}`);
    assert.ok(!existsSync(sidecar) || statSync(sidecar).size === 0);
  }
  assert.throws(() => verifyCaseShutdownSeal({ ...seal, databaseByteLength: seal.databaseByteLength + 1 }), /atomic_admission_seal_invalid/);
  assert.throws(() => verifyCaseShutdownSeal({ ...seal, walCheckpoint: { ...seal.walCheckpoint, busy: 1 } }), /atomic_admission_seal_invalid/);
  assert.throws(() => verifyCaseShutdownSeal({
    ...seal,
    walCheckpoint: { ...seal.walCheckpoint, log: seal.walCheckpoint.checkpointed + 1 },
  }), /atomic_admission_seal_invalid/);
  const wrongMunicipalityUnsigned = {
    ...seal,
    municipalityId: "other-town",
    databaseBasename: "stadtstack-other-town-atomic-admission.sqlite",
  };
  const wrongMunicipalityFields = structuredClone(wrongMunicipalityUnsigned) as Record<string, unknown>;
  delete wrongMunicipalityFields.sealChecksum;
  assert.throws(() => verifyCaseShutdownSeal({
    ...wrongMunicipalityFields,
    sealChecksum: digest(wrongMunicipalityFields),
  }), /atomic_admission_seal_invalid/);

  const reopened = createSqliteAtomicTopicCaseAdmission(options(root));
  assert.equal(reopened.caseCoordinators.open(admitted.caseId).project({
    schemaVersion: "query_envelope_v1", queryType: "case_projection_v1", caseId: admitted.caseId,
    actorBinding: { actorId: "roebel:public", actorClass: "public" }, visibility: "public",
    policyVersion: POLICY_VERSION, atCaseVersion: null,
  }).caseVersion, 4);
  const reopenedSeal = reopened.sealAndClose();
  assert.equal(canonical(reopenedSeal.recoveryEvidence), canonical(seal.recoveryEvidence));
});

test("durable roots are exact non-symlink paths, while legacy roots remain tmp-only", () => {
  const outside = durableRoot();
  const link = join(tmpdir(), `stadtstack-durable-link-${process.pid}-${Date.now()}`);
  try {
    symlinkSync(outside, link);
    assert.throws(() => createSqliteAtomicTopicCaseAdmission(options(link)), /atomic_admission_root_invalid/);
    assert.throws(() => createSqliteAtomicTopicCaseAdmission(options("relative")), /atomic_admission_root_invalid/);
    assert.throws(() => createSqliteAtomicTopicCaseAdmission(options(`${outside}/..`)), /atomic_admission_root_invalid/);
    assert.throws(() => createSqliteAtomicTopicCaseAdmission({
      ...options(outside), durableState: { mode: "durable_single_writer", sourceReleaseDigest: `sha256:${"e".repeat(64)}`, unexpected: true },
    } as unknown as SqliteAtomicTopicCaseAdmissionOptions), /atomic_admission_options_invalid/);
    const rootOwner = createSqliteAtomicTopicCaseAdmission(options(outside));
    const otherMunicipality = { ...options(outside), municipalityId: "other-town" };
    assert.throws(() => createSqliteAtomicTopicCaseAdmission(otherMunicipality), /atomic_admission_owner_locked/u);
    rootOwner.close();
    assert.throws(() => createSqliteAtomicTopicCaseAdmission(otherMunicipality), /atomic_admission_store_binding_mismatch/u);
    const legacy = createSqliteAtomicTopicCaseAdmission(options(mkdtempSync(join(tmpdir(), "stadtstack-legacy-")), false));
    assert.throws(() => legacy.sealAndClose(), /atomic_admission_seal_unavailable/);
    legacy.close();
  } finally { if (existsSync(link)) unlinkSync(link); }
});

test("durable state rejects dangling symlinks for every SQLite and seal sidecar target", () => {
  const targets = [
    `stadtstack-${MUNICIPALITY_ID}-atomic-admission.sqlite`,
    "stadtstack-case-state-owner.sqlite",
    "stadtstack-case-state-owner.sqlite-journal",
    CASE_SHUTDOWN_SEAL_FILENAME,
  ];
  for (const target of targets) {
    const root = durableRoot();
    symlinkSync(join(root, "missing-target"), join(root, target));
    assert.throws(() => createSqliteAtomicTopicCaseAdmission(options(root)), /atomic_admission_path_symlink_forbidden/u);
  }
});

test("a wrong municipality cannot poison an unbound migrated owner database", () => {
  const root = durableRoot();
  const original = createSqliteAtomicTopicCaseAdmission(options(root));
  original.sealAndClose();
  rmSync(join(root, "stadtstack-case-state-owner.sqlite"), { force: true });

  assert.throws(() => createSqliteAtomicTopicCaseAdmission({
    ...options(root),
    municipalityId: "other-town",
  }), /atomic_admission_store_binding_mismatch/u);

  const correct = createSqliteAtomicTopicCaseAdmission(options(root));
  correct.close();
});

test("owner identity database rejects malformed schema and injected triggers before municipal state opens", () => {
  const malformedRoot = durableRoot();
  const malformed = new DatabaseSync(join(malformedRoot, "stadtstack-case-state-owner.sqlite"));
  malformed.exec("CREATE TABLE durable_store_binding(singleton TEXT, municipality_id TEXT)");
  malformed.close();
  assert.throws(() => createSqliteAtomicTopicCaseAdmission(options(malformedRoot)), /atomic_admission_owner_store_invalid/u);

  const triggerRoot = durableRoot();
  const seeded = createSqliteAtomicTopicCaseAdmission(options(triggerRoot));
  seeded.close();
  const injected = new DatabaseSync(join(triggerRoot, "stadtstack-case-state-owner.sqlite"));
  injected.exec(`
    CREATE TRIGGER forged_owner_binding
    AFTER UPDATE ON durable_store_binding
    BEGIN
      SELECT 1;
    END;
  `);
  injected.close();
  assert.throws(() => createSqliteAtomicTopicCaseAdmission(options(triggerRoot)), /atomic_admission_owner_store_invalid/u);
});

test("restored SQLite schema rejects altered constraints before admission", () => {
  const root = durableRoot();
  const seeded = createSqliteAtomicTopicCaseAdmission(options(root));
  seeded.close();

  const database = new DatabaseSync(join(root, `stadtstack-${MUNICIPALITY_ID}-atomic-admission.sqlite`));
  database.exec(`
    PRAGMA foreign_keys=OFF;
    BEGIN;
    CREATE TABLE atomic_case_meta_rebuilt (
      case_id TEXT PRIMARY KEY, municipality_id TEXT NOT NULL, namespace TEXT NOT NULL,
      options_fingerprint TEXT NOT NULL, case_version INTEGER NOT NULL CHECK(case_version >= 0), head_checksum TEXT NOT NULL
    );
    INSERT INTO atomic_case_meta_rebuilt(case_id,municipality_id,namespace,options_fingerprint,case_version,head_checksum)
      SELECT case_id,municipality_id,namespace,options_fingerprint,case_version,head_checksum FROM atomic_case_meta;
    DROP TABLE atomic_case_meta;
    ALTER TABLE atomic_case_meta_rebuilt RENAME TO atomic_case_meta;
    COMMIT;
  `);
  database.close();

  assert.throws(() => createSqliteAtomicTopicCaseAdmission(options(root)), /atomic_admission_schema_invalid/u);
  const unchanged = new DatabaseSync(join(root, `stadtstack-${MUNICIPALITY_ID}-atomic-admission.sqlite`), { readOnly: true });
  assert.equal((unchanged.prepare("SELECT COUNT(*) AS count FROM atomic_case_meta").get() as { count: number }).count, 0);
  unchanged.close();
});

test("durable seal rejects setuid and setgid permission bits", () => {
  const root = durableRoot();
  const adapter = createSqliteAtomicTopicCaseAdmission(options(root));
  adapter.sealAndClose();
  const sealPath = join(root, CASE_SHUTDOWN_SEAL_FILENAME);
  chmodSync(sealPath, 0o4600);
  assert.throws(() => createSqliteAtomicTopicCaseAdmission(options(root)), /atomic_admission_seal_invalid/u);
});

test("checkpoint failure writes no seal and retains the live owner lock until explicit close", () => {
  const root = durableRoot();
  const previous = createSqliteAtomicTopicCaseAdmission(options(root));
  previous.sealAndClose();
  assert.equal(existsSync(join(root, CASE_SHUTDOWN_SEAL_FILENAME)), true);
  const adapter = createSqliteAtomicTopicCaseAdmission(options(root));
  assert.equal(existsSync(join(root, CASE_SHUTDOWN_SEAL_FILENAME)), false);
  const originalPrepare = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function patchedPrepare(sql: string) {
    const statement = originalPrepare.call(this, sql);
    if (sql === "PRAGMA wal_checkpoint(TRUNCATE)") Object.defineProperty(statement, "get", { value: () => ({ busy: 1, log: 0, checkpointed: 0 }) });
    return statement;
  };
  try {
    assert.throws(() => adapter.sealAndClose(), /atomic_admission_seal_checkpoint_invalid/);
    assert.equal(existsSync(join(root, CASE_SHUTDOWN_SEAL_FILENAME)), false);
    assert.throws(() => createSqliteAtomicTopicCaseAdmission(options(root)), /atomic_admission_owner_locked/);
  } finally {
    DatabaseSync.prototype.prepare = originalPrepare;
    adapter.close();
  }
  const successor = createSqliteAtomicTopicCaseAdmission(options(root));
  successor.close();
});

test("durable capacity rejects a new Case before commit so the store stays sealable", async () => {
  const root = durableRoot();
  const adapter = createSqliteAtomicTopicCaseAdmission(options(root));
  const originalPrepare = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function patchedPrepare(sql: string) {
    const statement = originalPrepare.call(this, sql);
    if (sql === "SELECT COUNT(*) AS case_count FROM atomic_case_meta") {
      Object.defineProperty(statement, "get", { value: () => ({ case_count: 10_000 }) });
    }
    return statement;
  };
  try {
    await assert.rejects(adapter.admission.admit(input()), /atomic_admission_capacity_exhausted/u);
    assert.deepEqual(adapter.outbox.replay(), []);
  } finally {
    DatabaseSync.prototype.prepare = originalPrepare;
  }
  const seal = adapter.sealAndClose();
  assert.equal(seal.recoveryEvidence.projectionEntryCount, 0);
});

test("post-close seal-write failure leaves no success seal and retains ownership until emergency close", () => {
  const root = durableRoot();
  const adapter = createSqliteAtomicTopicCaseAdmission(options(root));
  const sealPath = join(root, CASE_SHUTDOWN_SEAL_FILENAME);
  symlinkSync(join(root, "missing-seal-target"), sealPath);

  assert.throws(() => adapter.sealAndClose(), /atomic_admission_path_symlink_forbidden/u);
  assert.equal(lstatSync(sealPath).isSymbolicLink(), true);
  assert.throws(() => createSqliteAtomicTopicCaseAdmission(options(root)), /atomic_admission_owner_locked/u);

  adapter.close();
  unlinkSync(sealPath);
  const successor = createSqliteAtomicTopicCaseAdmission(options(root));
  successor.close();
});

test("process death releases the live SQLite owner transaction without a sentinel cleanup", async (t) => {
  const root = durableRoot();
  const moduleUrl = new URL("../../src/adapters/sqlite-atomic-topic-case-admission.ts", import.meta.url).href;
  const encodedFixture = Buffer.from(JSON.stringify({ options: options(root), admission: input() }), "utf8").toString("base64url");
  const script = [
    "const { createSqliteAtomicTopicCaseAdmission } = await import(process.argv[1]);",
    "const fixture = JSON.parse(Buffer.from(process.argv[2], 'base64url').toString('utf8'));",
    "const adapter = createSqliteAtomicTopicCaseAdmission(fixture.options);",
    "await adapter.admission.admit(fixture.admission);",
    "process.stdout.write('ready\\n');",
    "setInterval(() => undefined, 1000);",
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script, moduleUrl, encodedFixture], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => rejectReady(new Error(`durable_owner_child_timeout:${stderr}`)), 5_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.includes("ready\n")) {
        clearTimeout(timeout);
        resolveReady();
      }
    });
    child.once("error", (error) => { clearTimeout(timeout); rejectReady(error); });
    child.once("exit", (code) => {
      if (!stdout.includes("ready\n")) {
        clearTimeout(timeout);
        rejectReady(new Error(`durable_owner_child_exit:${String(code)}:${stderr}`));
      }
    });
  });
  await ready;
  assert.throws(() => createSqliteAtomicTopicCaseAdmission(options(root)), /atomic_admission_owner_locked/);
  child.kill("SIGKILL");
  await once(child, "exit");

  const successor = createSqliteAtomicTopicCaseAdmission(options(root));
  assert.equal(successor.outbox.replay().length, 1);
  assert.equal(successor.sealAndClose().recoveryEvidence.projectionEntryCount, 1);
});
