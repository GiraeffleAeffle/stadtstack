import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after, type TestContext } from "node:test";

import { finalizeEvent, getPublicKey, type Event as NostrEvent } from "nostr-tools/pure";

import {
  createStagingCaseControlRuntime,
  type StagingCaseControlRuntimeConfig,
} from "../src/staging-case-control-runtime.ts";
import {
  CASE_SHUTDOWN_SEAL_FILENAME,
  verifyCaseShutdownSeal,
} from "../src/adapters/sqlite-atomic-topic-case-admission.ts";
import { CREDENTIAL_FREE_CASE_BINDING_OUTBOX_PATH } from "../src/credential-free-case-binding-outbox-server.ts";
import type { CitizenSignedTopicSuggestionV1 } from "../src/citizen-suggestion.ts";

const MUNICIPALITY_ID = "roebel-mueritz";
const POLICY_VERSION = "case-intake-v1";
const TOPIC_ID = "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse";
const CITIZEN_SECRET = new Uint8Array(32).fill(21);
const AGENT_SECRET = new Uint8Array(32).fill(22);
const CITIZEN_PUBKEY = getPublicKey(CITIZEN_SECRET);
const AGENT_PUBKEY = getPublicKey(AGENT_SECRET);
const TOKEN = Buffer.alloc(32, 91).toString("base64url");
const ROOTS = new Set<string>();

after(() => { for (const root of ROOTS) rmSync(root, { recursive: true, force: true }); });

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "stadtstack-control-runtime-"));
  ROOTS.add(value);
  return value;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function plain(event: NostrEvent): NostrEvent { return JSON.parse(JSON.stringify(event)) as NostrEvent; }

function candidate(): { sourceDiscussion: NostrEvent; sourceAnswer: NostrEvent; signedSuggestion: CitizenSignedTopicSuggestionV1 } {
  const sourceDiscussion = plain(finalizeEvent({
    kind: 1,
    created_at: 1_787_356_800,
    content: "@Mecky Welche geprüften Möglichkeiten gibt es für eine sichere Querung?",
    tags: [["p", AGENT_PUBKEY], ["t", "stadtstack-civic-discussion"], ["municipality", MUNICIPALITY_ID], ["topic", TOPIC_ID], ["stance", "root"], ["argument-root", "self"]],
  }, CITIZEN_SECRET));
  const sourceAnswer = plain(finalizeEvent({
    kind: 1,
    created_at: sourceDiscussion.created_at + 1,
    content: "Geprüfte Unterlagen beschreiben mehrere Varianten.",
    tags: [["e", sourceDiscussion.id, "", "reply"], ["p", CITIZEN_PUBKEY], ["municipality", MUNICIPALITY_ID], ["topic", TOPIC_ID], ["mecky-receipt", `urn:stadtstack:mecky-answer:${"a".repeat(64)}`], ["evidence", `sha256:${"c".repeat(64)}`, "https://www.roebel-mueritz.de/rathaus/reviewed/crossing-options"]],
  }, AGENT_SECRET));
  const core = {
    sourceAnswerReceiptId: `urn:stadtstack:mecky-answer:${"a".repeat(64)}`,
    sourceDiscussionId: sourceDiscussion.id,
    sourceDiscussionRef: `nostr://event/${sourceDiscussion.id}`,
    municipalityId: MUNICIPALITY_ID,
    topicId: TOPIC_ID,
    citizenPubkey: CITIZEN_PUBKEY,
    title: "Sichere Querung gemeinsam prüfen",
    summary: "Geprüfte Varianten sollen öffentlich abgewogen und menschlich in einen Case übergehen.",
  };
  const draft = {
    schemaVersion: "public_mecky_topic_suggestion_draft_v1" as const,
    draftId: `urn:stadtstack:topic-suggestion-draft:${digest(core).slice(7)}`,
    ...core,
    entryState: "citizen_signature_required" as const,
    authorityBinding: "none" as const,
    submittedToCivicWorkflow: false as const,
  };
  const event = plain(finalizeEvent({
    kind: 1,
    created_at: sourceAnswer.created_at + 1,
    content: JSON.stringify(draft),
    tags: [["schema", "citizen_signed_topic_suggestion_v1"], ["municipality", MUNICIPALITY_ID], ["topic", TOPIC_ID], ["e", sourceDiscussion.id, "", "root"], ["mecky-receipt", core.sourceAnswerReceiptId]],
  }, CITIZEN_SECRET));
  return {
    sourceDiscussion,
    sourceAnswer,
    signedSuggestion: {
      schemaVersion: "citizen_signed_topic_suggestion_v1",
      candidateId: `urn:stadtstack:signed-topic-suggestion:${event.id}`,
      signerPubkey: event.pubkey,
      draft,
      event: { ...event, kind: 1 },
      verification: { kind: "nostr_nip01", verified: true },
      entryState: "awaiting_human_case_admission",
      authorityBinding: "none",
      submittedToCivicWorkflow: false,
    },
  };
}

function config(rootDir: string, durable = false): StagingCaseControlRuntimeConfig {
  return {
    deploymentEnvironment: "staging",
    rootDir,
    municipalityId: MUNICIPALITY_ID,
    policyVersion: POLICY_VERSION,
    actorRegistry: [
      { actorId: "roebel:case-steward", actorClass: "case_steward" },
      { actorId: "roebel:public", actorClass: "public" },
      { actorId: "roebel:planning-agent", actorClass: "department_agent", departmentId: "planning" },
      { actorId: "roebel:planning-reviewer", actorClass: "department_reviewer", departmentId: "planning" },
    ],
    allowedSignerPubkeys: [CITIZEN_PUBKEY],
    allowedAgentPubkeys: [AGENT_PUBKEY],
    credentials: [{
      principal: { actorId: "roebel:case-steward", actorClass: "case_steward", municipalityIds: [MUNICIPALITY_ID] },
      token: TOKEN,
    }],
    admissionAllowedHosts: ["127.0.0.1"],
    outboxAllowedHosts: ["127.0.0.1"],
    probeAllowedHosts: ["127.0.0.1"],
    listeners: {
      probe: { host: "127.0.0.1", port: 0 },
      outbox: { host: "127.0.0.1", port: 0 },
      admission: { host: "127.0.0.1", port: 0 },
    },
    drainTimeoutMs: 500,
    ...(durable ? {
      durableState: {
        mode: "durable_single_writer" as const,
        sourceReleaseDigest: `sha256:${"d".repeat(64)}`,
      },
    } : {}),
  };
}

type Response = Readonly<{ status: number; body: string }>;

function request(port: number, method: string, path: string, headers: Record<string, string>, body = ""): Promise<Response> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ host: "127.0.0.1", port, method, path, headers }, (incoming) => {
      const chunks: Uint8Array[] = [];
      incoming.on("data", (chunk: Buffer) => chunks.push(new Uint8Array(chunk)));
      incoming.once("error", reject);
      incoming.once("end", () => {
        const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
        resolve(Object.freeze({ status: incoming.statusCode ?? 0, body: new TextDecoder("utf-8", { fatal: true }).decode(bytes) }));
      });
    });
    outgoing.once("error", reject);
    outgoing.end(body);
  });
}

async function started(t: TestContext, rootDir = root()) {
  const runtime = createStagingCaseControlRuntime(config(rootDir));
  t.after(async () => runtime.close());
  await runtime.start();
  const health = runtime.health();
  assert.equal(health.ready, true);
  assert.deepEqual(Object.keys(health.ports).sort(), ["admission", "outbox", "probe"]);
  return { runtime, ports: health.ports, rootDir };
}

test("starts the loopback probe, private outbox, and staff admission path without exposing composition capabilities", async (t) => {
  const { runtime, ports } = await started(t);
  assert.deepEqual(Object.keys(runtime).sort(), ["close", "health", "start"]);
  assert.ok(Object.isFrozen(runtime));
  assert.notEqual(ports.probe, ports.outbox);
  assert.notEqual(ports.outbox, ports.admission);
  const probe = await request(ports.probe!, "GET", "/readyz", { host: "127.0.0.1", "content-length": "0" });
  assert.deepEqual(probe, { status: 200, body: "ok\n" });
});

test("admits one valid citizen-signed suggestion and replays exactly its public receipt from the private outbox", async (t) => {
  const { ports } = await started(t);
  const value = candidate();
  const body = JSON.stringify({
    schemaVersion: "roebel_case_steward_admission_request_v1",
    sourceDiscussion: value.sourceDiscussion,
    sourceAnswer: value.sourceAnswer,
    signedSuggestion: value.signedSuggestion,
  });
  const admitted = await request(ports.admission!, "POST", "/v1/nostr/suggestions/admit", {
    host: "127.0.0.1",
    authorization: `Bearer ${TOKEN}`,
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(body, "utf8")),
  }, body);
  assert.equal(admitted.status, 200);
  const receipt = JSON.parse(admitted.body) as { rootEventId: string; caseId: string };
  assert.equal(receipt.rootEventId, value.sourceDiscussion.id);
  const replay = await request(ports.outbox!, "GET", `${CREDENTIAL_FREE_CASE_BINDING_OUTBOX_PATH}?afterSequence=0&limit=1`, {
    host: "127.0.0.1",
    "content-length": "0",
  });
  assert.equal(replay.status, 200);
  const page = JSON.parse(replay.body) as { entries: Array<{ receipt: { caseId: string } }> };
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0]!.receipt.caseId, receipt.caseId);
});

test("invalid bearer input cannot mutate the private outbox and wrong-scope credential configuration is rejected before bind", async (t) => {
  const { ports } = await started(t);
  const invalid = await request(ports.admission!, "POST", "/v1/nostr/suggestions/admit", {
    host: "127.0.0.1",
    authorization: `Bearer ${Buffer.alloc(32, 92).toString("base64url")}`,
    "content-type": "application/json; charset=utf-8",
    "content-length": "2",
  }, "{}");
  assert.equal(invalid.status, 401);
  const replay = await request(ports.outbox!, "GET", `${CREDENTIAL_FREE_CASE_BINDING_OUTBOX_PATH}?afterSequence=0&limit=1`, {
    host: "127.0.0.1", "content-length": "0",
  });
  assert.deepEqual(JSON.parse(replay.body), {
    schemaVersion: "public_case_binding_outbox_page_v1", afterSequence: 0, nextSequence: null, entries: [],
  });
  const wrongScope = {
    ...config(root()),
    credentials: [{
      principal: { actorId: "roebel:case-steward", actorClass: "case_steward" as const, municipalityIds: ["other-town"] },
      token: TOKEN,
    }],
  };
  assert.throws(() => createStagingCaseControlRuntime(wrongScope), /staging_case_control_runtime_config_invalid/u);
  const missingActor = {
    ...config(root()),
    credentials: [{
      principal: { actorId: "roebel:unregistered", actorClass: "case_steward" as const, municipalityIds: [MUNICIPALITY_ID] },
      token: TOKEN,
    }],
  };
  assert.throws(() => createStagingCaseControlRuntime(missingActor), /staging_case_control_runtime_config_invalid/u);
  const malformedHostRoot = root();
  assert.throws(() => createStagingCaseControlRuntime({
    ...config(malformedHostRoot),
    outboxAllowedHosts: ["not a host"],
  }), /staging_case_control_runtime_config_invalid/u);
  assert.deepEqual(readdirSync(malformedHostRoot), []);
});

test("close is idempotent, releases SQLite after listeners stop, and permits a clean matching reopen", async (t) => {
  const rootDir = root();
  const first = createStagingCaseControlRuntime(config(rootDir));
  await first.start();
  await Promise.all([first.close(), first.close()]);
  assert.equal(first.health().phase, "stopped");
  const second = createStagingCaseControlRuntime(config(rootDir));
  t.after(async () => second.close());
  await second.start();
  assert.equal(second.health().ready, true);
});

test("durable runtime drains its listeners, seals one admitted Case, and cleanly reopens", async () => {
  const rootDir = realpathSync(root());
  const first = createStagingCaseControlRuntime(config(rootDir, true));
  await first.start();
  const ports = first.health().ports;
  const value = candidate();
  const body = JSON.stringify({
    schemaVersion: "roebel_case_steward_admission_request_v1",
    sourceDiscussion: value.sourceDiscussion,
    sourceAnswer: value.sourceAnswer,
    signedSuggestion: value.signedSuggestion,
  });
  const admitted = await request(ports.admission!, "POST", "/v1/nostr/suggestions/admit", {
    host: "127.0.0.1",
    authorization: `Bearer ${TOKEN}`,
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(body, "utf8")),
  }, body);
  assert.equal(admitted.status, 200);

  await first.close();
  assert.equal(first.health().phase, "stopped");
  const sealPath = join(rootDir, CASE_SHUTDOWN_SEAL_FILENAME);
  const firstSeal = verifyCaseShutdownSeal(JSON.parse(readFileSync(sealPath, "utf8")));
  assert.equal(firstSeal.recoveryEvidence.projectionEntryCount, 1);

  const second = createStagingCaseControlRuntime(config(rootDir, true));
  assert.equal(existsSync(sealPath), false);
  await second.start();
  await second.close();
  const secondSeal = verifyCaseShutdownSeal(JSON.parse(readFileSync(sealPath, "utf8")));
  assert.deepEqual(secondSeal.recoveryEvidence, firstSeal.recoveryEvidence);
});

test("durable runtime redacts a failed checkpoint and cannot leave a stale success seal", async () => {
  const rootDir = realpathSync(root());
  const runtime = createStagingCaseControlRuntime(config(rootDir, true));
  await runtime.start();
  const originalPrepare = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function patchedPrepare(sql: string) {
    const statement = originalPrepare.call(this, sql);
    if (sql === "PRAGMA wal_checkpoint(TRUNCATE)") {
      Object.defineProperty(statement, "get", { value: () => ({ busy: 1, log: 0, checkpointed: 0 }) });
    }
    return statement;
  };
  try {
    await assert.rejects(runtime.close(), /staging_case_process_release_failed/u);
    assert.equal(existsSync(join(rootDir, CASE_SHUTDOWN_SEAL_FILENAME)), false);
    assert.throws(() => createStagingCaseControlRuntime(config(rootDir, true)), /atomic_admission_owner_locked/u);
  } finally {
    DatabaseSync.prototype.prepare = originalPrepare;
  }
});
