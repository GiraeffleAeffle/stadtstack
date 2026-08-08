import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createNostrDiscussionAdapter, type DiscussionArtifact } from "../../src/adapters/discussion-adapter.ts";
import { createDurableCivicCaseCoordinator } from "../../src/civic-case-coordinator.ts";
import { createSqliteJournalStore } from "../../src/adapters/sqlite-journal-adapter.ts";

const scope = { municipalityId: "sample-municipality", caseId: "sample-case" };
const caseId = "urn:stadtstack:case:test:sample-municipality:018f0000-0000-7000-8000-000000000001";
const policyVersion = "case-intake-v1";
const fixtureEvent = {
  kind: 1,
  created_at: 1_754_035_200,
  tags: [["municipality", scope.municipalityId], ["case", scope.caseId], ["t", "stadtstack-e2e-fixture"]],
  content: "Could the crossing be made safer?",
  pubkey: "7190b3fcc08cd9c4edb5ef541e8a578089cb8727ba93c4cfb0583e2287d57bd2",
  id: "44ac22db49995e6ec96344b624d3ee01eb50ad814cf80f51af05959bb305412c",
  sig: "4db87c0f4d8d36de728c086bbec21a19224b639f29bf3334d032cc9584b39db4d4f41180a3485c440c83583a61937b53e9de4fe13d375b4635d23590917cf80e",
};

function coordinatorOptions() {
  return {
    scope,
    caseId,
    policyVersion,
    syntheticFixtureOnly: true,
    allowedSignerPubkeys: [fixtureEvent.pubkey],
    actors: [
      { actorId: "synthetic:citizen-1", actorClass: "citizen" as const },
      { actorId: "synthetic:public-1", actorClass: "public" as const },
    ],
  };
}

function intakeCommand(discussion: DiscussionArtifact) {
  return {
    schemaVersion: "command_envelope_v1" as const,
    commandType: "intake_discussion_v1" as const,
    caseId,
    actorBinding: { actorId: "synthetic:citizen-1", actorClass: "citizen" as const },
    expectedCaseVersion: 0,
    idempotencyKey: "synthetic:durable-intake-1",
    visibility: "private_case" as const,
    policyVersion,
    payload: { discussion },
  };
}

function publicQuery() {
  return {
    schemaVersion: "query_envelope_v1" as const,
    queryType: "case_projection_v1" as const,
    caseId,
    actorBinding: { actorId: "synthetic:public-1", actorClass: "public" as const },
    visibility: "public" as const,
    policyVersion,
    atCaseVersion: null,
  };
}

function administrationQuery(singleCaseId = caseId) {
  return {
    schemaVersion: "query_envelope_v1" as const,
    queryType: "case_projection_v1" as const,
    caseId: singleCaseId,
    actorBinding: { actorId: "synthetic:administration-1", actorClass: "administration" as const },
    visibility: "administration" as const,
    policyVersion,
    atCaseVersion: null,
  };
}

test("durable coordinator recovers the same receipt, version, head, and public projection", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "stadtstack-issue8-"));
  const discussion = createNostrDiscussionAdapter({ scope, syntheticFixtureOnly: true }).normalize(fixtureEvent);
  const firstStore = createSqliteJournalStore({ rootDir, namespace: "durable-fixture" });
  const pragmaDb = new DatabaseSync(join(rootDir, "durable-fixture.sqlite"));
  assert.equal(String((pragmaDb.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toLowerCase(), "wal");
  assert.equal((pragmaDb.prepare("PRAGMA synchronous").get() as { synchronous: number }).synchronous, 2);
  assert.equal((pragmaDb.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys, 1);
  pragmaDb.close();
  const first = createDurableCivicCaseCoordinator(coordinatorOptions(), firstStore);
  const receipt = first.handle(intakeCommand(discussion));
  const firstProjection = first.project(publicQuery());
  firstStore.close();

  const secondStore = createSqliteJournalStore({ rootDir, namespace: "durable-fixture" });
  const second = createDurableCivicCaseCoordinator(coordinatorOptions(), secondStore);
  assert.deepEqual(second.handle(intakeCommand(discussion)), receipt);
  assert.deepEqual(second.project(publicQuery()), firstProjection);
  secondStore.close();
});

test("durable idempotency conflicts and version failures do not mutate the journal", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "stadtstack-issue8-idempotency-"));
  const discussion = createNostrDiscussionAdapter({ scope, syntheticFixtureOnly: true }).normalize(fixtureEvent);
  const store = createSqliteJournalStore({ rootDir, namespace: "idempotency-fixture" });
  const coordinator = createDurableCivicCaseCoordinator(coordinatorOptions(), store);
  const receipt = coordinator.handle(intakeCommand(discussion));
  const before = coordinator.project(publicQuery());
  assert.throws(() => coordinator.handle({
    ...intakeCommand(discussion),
    actorBinding: { actorId: "synthetic:public-1", actorClass: "public" },
  }), /idempotency_conflict/);
  assert.throws(() => coordinator.handle({
    ...intakeCommand(discussion),
    idempotencyKey: "synthetic:stale-version",
  }), /case_version_conflict/);
  assert.deepEqual(coordinator.project(publicQuery()), before);
  assert.equal(receipt.caseVersion, 2);
  store.close();
});

test("exact synthetic deletion removes only the scoped sqlite trio", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "stadtstack-issue8-delete-"));
  const sentinel = join(rootDir, "keep-sentinel.txt");
  writeFileSync(sentinel, "keep");
  const store = createSqliteJournalStore({ rootDir, namespace: "delete-fixture" });
  const databasePath = join(rootDir, "delete-fixture.sqlite");
  store.deleteExactSynthetic();
  assert.equal(existsSync(databasePath), false);
  assert.equal(existsSync(`${databasePath}-wal`), false);
  assert.equal(existsSync(`${databasePath}-shm`), false);
  assert.equal(existsSync(sentinel), true);
});

test("synthetic deletion preflights sidecar symlinks before removing any file", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "stadtstack-issue8-delete-symlink-"));
  const sentinel = join(rootDir, "keep-sentinel.txt");
  writeFileSync(sentinel, "keep");
  const store = createSqliteJournalStore({ rootDir, namespace: "delete-symlink-fixture" });
  const databasePath = join(rootDir, "delete-symlink-fixture.sqlite");
  store.close();
  symlinkSync(sentinel, `${databasePath}-wal`);
  assert.throws(() => store.deleteExactSynthetic(), /journal_path_symlink_forbidden/);
  assert.equal(existsSync(databasePath), true);
  assert.equal(existsSync(sentinel), true);
});

test("durable recovery fails closed on metadata corruption", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "stadtstack-issue8-corrupt-"));
  const discussion = createNostrDiscussionAdapter({ scope, syntheticFixtureOnly: true }).normalize(fixtureEvent);
  const store = createSqliteJournalStore({ rootDir, namespace: "corrupt-fixture" });
  const coordinator = createDurableCivicCaseCoordinator(coordinatorOptions(), store);
  coordinator.handle(intakeCommand(discussion));
  store.close();
  const databasePath = join(rootDir, "corrupt-fixture.sqlite");
  const db = new DatabaseSync(databasePath);
  db.prepare("UPDATE journal_meta SET head_checksum=? WHERE namespace=?").run("sha256:" + "0".repeat(64), "corrupt-fixture");
  db.close();
  const reopened = createSqliteJournalStore({ rootDir, namespace: "corrupt-fixture" });
  assert.throws(() => createDurableCivicCaseCoordinator(coordinatorOptions(), reopened), /journal_meta_invalid/);
  reopened.close();
});

test("durable recovery binds the namespace to the coordinator options fingerprint", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "stadtstack-issue8-fingerprint-"));
  const discussion = createNostrDiscussionAdapter({ scope, syntheticFixtureOnly: true }).normalize(fixtureEvent);
  const store = createSqliteJournalStore({ rootDir, namespace: "fingerprint-fixture" });
  const coordinator = createDurableCivicCaseCoordinator(coordinatorOptions(), store);
  coordinator.handle(intakeCommand(discussion));
  store.close();
  const reopened = createSqliteJournalStore({ rootDir, namespace: "fingerprint-fixture" });
  assert.throws(() => createDurableCivicCaseCoordinator({ ...coordinatorOptions(), policyVersion: "other-policy" }, reopened), /journal_meta_invalid/);
  reopened.close();
});

test("durable coordinator keeps only the public handle/project seam", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "stadtstack-issue8-seam-"));
  const store = createSqliteJournalStore({ rootDir, namespace: "seam-fixture" });
  const coordinator = createDurableCivicCaseCoordinator(coordinatorOptions(), store);
  assert.deepEqual(Object.keys(coordinator).sort(), ["handle", "project"]);
  store.deleteExactSynthetic();
});

test("a SQLite insert failure rolls back the complete intake batch", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "stadtstack-issue8-rollback-"));
  const discussion = createNostrDiscussionAdapter({ scope, syntheticFixtureOnly: true }).normalize(fixtureEvent);
  const store = createSqliteJournalStore({ rootDir, namespace: "rollback-fixture" });
  const coordinator = createDurableCivicCaseCoordinator(coordinatorOptions(), store);
  const databasePath = join(rootDir, "rollback-fixture.sqlite");
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TRIGGER synthetic_fail_case_event BEFORE INSERT ON case_events WHEN NEW.case_version = 1 BEGIN SELECT RAISE(ABORT, 'synthetic_failure'); END");
  db.close();
  assert.throws(() => coordinator.handle(intakeCommand(discussion)), /synthetic_failure|constraint|abort/i);
  const afterFailure = coordinator.project;
  assert.equal(typeof afterFailure, "function");
  const dbAfter = new DatabaseSync(databasePath);
  assert.equal((dbAfter.prepare("SELECT COUNT(*) AS count FROM case_events").get() as { count: number }).count, 0);
  assert.equal((dbAfter.prepare("SELECT COUNT(*) AS count FROM command_idempotency").get() as { count: number }).count, 0);
  assert.equal((dbAfter.prepare("SELECT case_version FROM journal_meta WHERE namespace=?").get("rollback-fixture") as { case_version: number }).case_version, 0);
  dbAfter.exec("DROP TRIGGER synthetic_fail_case_event");
  dbAfter.close();
  assert.equal(coordinator.handle(intakeCommand(discussion)).caseVersion, 2);
  store.close();
});

test("payload, event, prior, head, and receipt corruption fail closed", () => {
  const corruptions: Array<{ name: string; mutate: (db: DatabaseSync) => void; expected: RegExp }> = [
    {
      name: "payload",
      mutate: (db) => db.prepare("UPDATE case_events SET payload_json=? WHERE case_version=2").run("null"),
      expected: /journal_payload_checksum_invalid/,
    },
    {
      name: "event",
      mutate: (db) => db.prepare("UPDATE case_events SET event_checksum=? WHERE case_version=2").run(`sha256:${"0".repeat(64)}`),
      expected: /journal_event_checksum_invalid/,
    },
    {
      name: "prior",
      mutate: (db) => db.prepare("UPDATE case_events SET prior_event_checksum=? WHERE case_version=2").run(`sha256:${"0".repeat(64)}`),
      expected: /journal_event_checksum_invalid|journal_chain_invalid/,
    },
    {
      name: "head",
      mutate: (db) => db.prepare("UPDATE journal_meta SET head_checksum=? WHERE namespace=?").run(`sha256:${"0".repeat(64)}`, "corrupt-shape"),
      expected: /journal_meta_invalid/,
    },
    {
      name: "receipt",
      mutate: (db) => {
        const row = db.prepare("SELECT head_checksum FROM command_idempotency WHERE namespace=?").get("corrupt-shape") as { head_checksum: string };
        const receipt = JSON.stringify({ caseVersion: 2, eventIds: ["urn:stadtstack:case-event:bogus", "urn:stadtstack:case-event:bogus-2"], journalHeadChecksum: row.head_checksum });
        db.prepare("UPDATE command_idempotency SET receipt_json=? WHERE namespace=?").run(receipt, "corrupt-shape");
      },
      expected: /journal_idempotency_invalid/,
    },
  ];
  for (const corruption of corruptions) {
    const rootDir = mkdtempSync(join(tmpdir(), `stadtstack-issue8-${corruption.name}-`));
    const discussion = createNostrDiscussionAdapter({ scope, syntheticFixtureOnly: true }).normalize(fixtureEvent);
    const store = createSqliteJournalStore({ rootDir, namespace: "corrupt-shape" });
    const coordinator = createDurableCivicCaseCoordinator(coordinatorOptions(), store);
    coordinator.handle(intakeCommand(discussion));
    store.close();
    const db = new DatabaseSync(join(rootDir, "corrupt-shape.sqlite"));
    corruption.mutate(db);
    db.close();
    const reopened = createSqliteJournalStore({ rootDir, namespace: "corrupt-shape" });
    assert.throws(() => createDurableCivicCaseCoordinator(coordinatorOptions(), reopened), corruption.expected);
    reopened.close();
  }
});

test("corrections remain immutable and replay with their correctionOf reference", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "stadtstack-issue8-correction-"));
  const discussion = createNostrDiscussionAdapter({ scope, syntheticFixtureOnly: true }).normalize(fixtureEvent);
  const options = {
    ...coordinatorOptions(),
    actors: [
      { actorId: "synthetic:citizen-1", actorClass: "citizen" as const },
      { actorId: "synthetic:public-1", actorClass: "public" as const },
      { actorId: "synthetic:administration-1", actorClass: "administration" as const },
      { actorId: "synthetic:steward-1", actorClass: "case_steward" as const },
      { actorId: "synthetic:planning-agent", actorClass: "department_agent" as const, departmentId: "planning" },
      { actorId: "synthetic:planning-reviewer", actorClass: "department_reviewer" as const, departmentId: "planning" },
    ],
  };
  const store = createSqliteJournalStore({ rootDir, namespace: "correction-fixture" });
  const coordinator = createDurableCivicCaseCoordinator(options, store);
  let version = coordinator.handle(intakeCommand(discussion)).caseVersion;
  version = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "assign_department_package_v1",
    caseId,
    actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
    expectedCaseVersion: version,
    idempotencyKey: "synthetic:correction-package",
    visibility: "private_case",
    policyVersion,
    payload: { departmentPackage: { id: "package-planning", departmentId: "planning", suggestionId: `urn:stadtstack:suggestion:${fixtureEvent.id}`, request: "Review planning.", assignedAgentActorId: "synthetic:planning-agent", assignedReviewerActorId: "synthetic:planning-reviewer", authorityBinding: "none" } },
  }).caseVersion;
  const pkg = coordinator.project(administrationQuery()).projection.departmentPackage!;
  const draftReceipt = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "record_department_draft_v1",
    caseId,
    actorBinding: { actorId: "synthetic:planning-agent", actorClass: "department_agent" },
    expectedCaseVersion: version,
    idempotencyKey: "synthetic:correction-draft",
    visibility: "private_case",
    policyVersion,
    payload: { packageId: pkg.id, packageChecksum: pkg.packageChecksum, draft: { schemaVersion: "department_draft_v1", id: "draft-planning-1", publicSummary: "Initial planning response.", publicCitations: ["synthetic://planning/initial"], privateEvidenceRefs: ["synthetic://planning/private-initial"], authorityBinding: "none" } },
  });
  const drafted = coordinator.project(administrationQuery()).projection.departmentPackage!;
  version = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "attest_department_review_v1",
    caseId,
    actorBinding: { actorId: "synthetic:planning-reviewer", actorClass: "department_reviewer" },
    expectedCaseVersion: draftReceipt.caseVersion,
    idempotencyKey: "synthetic:correction-review",
    visibility: "private_case",
    policyVersion,
    payload: { review: { packageId: drafted.id, draftArtifactChecksum: drafted.draft!.artifactChecksum, decision: "accepted", reviewedAt: "2026-08-08T00:00:05.000Z" } },
  }).caseVersion;
  const accepted = coordinator.project(administrationQuery()).projection.departmentPackage!;
  const correction = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "correct_department_draft_v1",
    caseId,
    actorBinding: { actorId: "synthetic:planning-agent", actorClass: "department_agent" },
    expectedCaseVersion: version,
    idempotencyKey: "synthetic:correction-correct",
    visibility: "private_case",
    policyVersion,
    payload: { packageId: accepted.id, packageChecksum: accepted.packageChecksum, priorDraftArtifactChecksum: accepted.draft!.artifactChecksum, draft: { schemaVersion: "department_draft_v1", id: "draft-planning-2", publicSummary: "Corrected planning response.", publicCitations: ["synthetic://planning/corrected"], privateEvidenceRefs: ["synthetic://planning/private-corrected"], authorityBinding: "none" } },
  });
  assert.equal(correction.caseVersion, version + 1);
  const db = new DatabaseSync(join(rootDir, "correction-fixture.sqlite"));
  const priorRow = db.prepare("SELECT event_checksum FROM case_events WHERE case_version=?").get(draftReceipt.caseVersion) as { event_checksum: string };
  const correctionRow = db.prepare("SELECT correction_of FROM case_events WHERE case_version=?").get(correction.caseVersion) as { correction_of: string };
  assert.equal(priorRow.event_checksum.length, 71);
  assert.equal(correctionRow.correction_of, `urn:stadtstack:case-event:${caseId}:${draftReceipt.caseVersion}`);
  db.close();
  store.close();
  const reopenedStore = createSqliteJournalStore({ rootDir, namespace: "correction-fixture" });
  const reopened = createDurableCivicCaseCoordinator(options, reopenedStore);
  const replayed = reopened.project(administrationQuery()).projection.departmentPackage!;
  assert.equal(replayed.reviewState, "draft_pending_review");
  assert.equal(replayed.draft!.publicSummary, "Corrected planning response.");
  reopenedStore.deleteExactSynthetic();
});
