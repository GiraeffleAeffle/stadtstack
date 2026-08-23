import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { finalizeEvent, getPublicKey, type Event as NostrEvent } from "nostr-tools/pure";

import type { PublicCaseBindingReceiptV1 } from "../src/case-binding-projection.ts";
import type { CitizenSignedTopicSuggestionV1 } from "../src/citizen-suggestion.ts";
import { CREDENTIAL_FREE_CASE_BINDING_OUTBOX_PATH } from "../src/credential-free-case-binding-outbox-server.ts";
import { createStagingCaseControlRuntime } from "../src/staging-case-control-runtime.ts";
import { createStagingPublicCaseBindingRuntime } from "../src/staging-public-case-binding-runtime.ts";

const HOST = "127.0.0.1" as const;
const MUNICIPALITY_ID = "roebel-mueritz";
const WRONG_SCOPE_MUNICIPALITY_ID = "strausberg";
const TOPIC_ID = "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse";
const POLICY_VERSION = "case-intake-v1";
const CITIZEN_SECRET = new Uint8Array(32).fill(21);
const AGENT_SECRET = new Uint8Array(32).fill(22);
const CITIZEN_PUBKEY = getPublicKey(CITIZEN_SECRET);
const AGENT_PUBKEY = getPublicKey(AGENT_SECRET);
const RECEIPT_ID = `urn:stadtstack:mecky-answer:${"a".repeat(64)}`;
const STEWARD_TOKEN = createHash("sha256").update("roebel-staging-case-steward").digest("base64url");
// A token issued for another municipality is not in Röbel's fixed credential
// registry and must be rejected before the body reaches admission.
const WRONG_SCOPE_TOKEN = createHash("sha256").update("strausberg-staging-case-steward").digest("base64url");
const INVALID_TOKEN = createHash("sha256").update("not-a-configured-steward").digest("base64url");

type HttpResponse = Readonly<{ status: number; body: string }>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const digest = (value: unknown) => `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
const plainEvent = (event: NostrEvent): NostrEvent => JSON.parse(JSON.stringify(event)) as NostrEvent;

function fixture(title = "Sichere Querung gemeinsam prüfen"): {
  sourceDiscussion: NostrEvent;
  sourceAnswer: NostrEvent;
  signedSuggestion: CitizenSignedTopicSuggestionV1;
} {
  const sourceDiscussion = plainEvent(finalizeEvent({
    kind: 1,
    created_at: 1_787_356_800,
    content: "@Mecky Welche geprüften Möglichkeiten gibt es für eine sichere Querung?",
    tags: [["p", AGENT_PUBKEY], ["t", "stadtstack-civic-discussion"], ["municipality", MUNICIPALITY_ID], ["topic", TOPIC_ID], ["stance", "root"], ["argument-root", "self"]],
  }, CITIZEN_SECRET));
  const sourceAnswer = plainEvent(finalizeEvent({
    kind: 1,
    created_at: sourceDiscussion.created_at + 1,
    content: "Geprüfte Unterlagen beschreiben mehrere Varianten.",
    tags: [["e", sourceDiscussion.id, "", "reply"], ["p", CITIZEN_PUBKEY], ["municipality", MUNICIPALITY_ID], ["topic", TOPIC_ID], ["mecky-receipt", RECEIPT_ID], ["evidence", `sha256:${"c".repeat(64)}`, "https://roebel.example/reviewed/crossing-options"]],
  }, AGENT_SECRET));
  const core = {
    sourceAnswerReceiptId: RECEIPT_ID,
    sourceDiscussionId: sourceDiscussion.id,
    sourceDiscussionRef: `nostr://event/${sourceDiscussion.id}`,
    municipalityId: MUNICIPALITY_ID,
    topicId: TOPIC_ID,
    citizenPubkey: CITIZEN_PUBKEY,
    title,
    summary: "Die geprüften Varianten sollen öffentlich abgewogen und anschließend menschlich in den Civic-Case-Prozess aufgenommen werden.",
  };
  const draft = {
    schemaVersion: "public_mecky_topic_suggestion_draft_v1" as const,
    draftId: `urn:stadtstack:topic-suggestion-draft:${digest(core).slice("sha256:".length)}`,
    ...core,
    entryState: "citizen_signature_required" as const,
    authorityBinding: "none" as const,
    submittedToCivicWorkflow: false as const,
  };
  const event = plainEvent(finalizeEvent({
    kind: 1,
    created_at: sourceAnswer.created_at + 1,
    content: JSON.stringify(draft),
    tags: [["schema", "citizen_signed_topic_suggestion_v1"], ["municipality", MUNICIPALITY_ID], ["topic", TOPIC_ID], ["e", sourceDiscussion.id, "", "root"], ["mecky-receipt", RECEIPT_ID]],
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

type AdmissionRequest = Readonly<{
  schemaVersion: "roebel_case_steward_admission_request_v1";
  sourceDiscussion: NostrEvent;
  sourceAnswer: NostrEvent;
  signedSuggestion: CitizenSignedTopicSuggestionV1;
}>;

function admissionBody(): AdmissionRequest {
  return { schemaVersion: "roebel_case_steward_admission_request_v1", ...fixture() };
}

function controlConfig(rootDir: string, municipalityId = MUNICIPALITY_ID, token = STEWARD_TOKEN) {
  const actorId = `${municipalityId}:case-steward`;
  return {
    deploymentEnvironment: "staging" as const,
    rootDir,
    municipalityId,
    policyVersion: POLICY_VERSION,
    actorRegistry: [{ actorId, actorClass: "case_steward" as const }],
    allowedSignerPubkeys: [CITIZEN_PUBKEY],
    allowedAgentPubkeys: [AGENT_PUBKEY],
    credentials: [{
      principal: { actorId, actorClass: "case_steward" as const, municipalityIds: [municipalityId] },
      token,
    }],
    admissionAllowedHosts: [HOST],
    outboxAllowedHosts: [HOST],
    probeAllowedHosts: [HOST],
    listeners: {
      probe: { host: HOST, port: 0 },
      outbox: { host: HOST, port: 0 },
      admission: { host: HOST, port: 0 },
    },
    drainTimeoutMs: 500,
  } as const;
}

function publicConfig(outboxPort = 1) {
  return {
    outboxOrigin: `http://${HOST}:${outboxPort}/`,
    publicAllowedHosts: [HOST],
    probeAllowedHosts: [HOST],
    publicListener: { host: HOST, port: 0 },
    probeListener: { host: HOST, port: 0 },
    reconcileIntervalMs: 100,
    drainTimeoutMs: 500,
  } as const;
}

function request(
  port: number,
  options: Readonly<{ method: string; path: string; authorization?: string; body?: unknown }>,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? "" : JSON.stringify(options.body);
    const headers: Record<string, string> = {
      host: HOST,
      connection: "close",
    };
    if (options.authorization !== undefined) headers.authorization = options.authorization;
    if (options.body !== undefined) {
      headers["content-type"] = "application/json; charset=utf-8";
      headers["content-length"] = String(Buffer.byteLength(body, "utf8"));
    }
    const client = httpRequest({
      hostname: HOST,
      port,
      method: options.method,
      path: options.path,
      headers,
      agent: false,
    }, (response) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { responseBody += chunk; });
      response.once("error", reject);
      response.once("end", () => resolve({ status: response.statusCode ?? 0, body: responseBody }));
    });
    client.once("error", reject);
    client.end(body);
  });
}

function controlPort(runtime: ReturnType<typeof createStagingCaseControlRuntime>): number {
  const port = runtime.health().ports.admission;
  assert.ok(Number.isSafeInteger(port));
  return port;
}

function outboxPort(runtime: ReturnType<typeof createStagingCaseControlRuntime>): number {
  const port = runtime.health().ports.outbox;
  assert.ok(Number.isSafeInteger(port));
  return port;
}

function publicPort(runtime: ReturnType<typeof createStagingPublicCaseBindingRuntime>): number {
  const port = runtime.health().ports.public;
  assert.ok(port !== null);
  return port;
}

test("traces signed discussion through isolated control/public runtimes and durable replay", async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), "stadtstack-two-process-tracer-"));
  const wrongScopeRootDir = await mkdtemp(join(tmpdir(), "stadtstack-two-process-scope-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
    await rm(wrongScopeRootDir, { recursive: true, force: true });
  });

  const control = createStagingCaseControlRuntime(controlConfig(rootDir));
  const wrongScopeControl = createStagingCaseControlRuntime(
    controlConfig(wrongScopeRootDir, WRONG_SCOPE_MUNICIPALITY_ID, WRONG_SCOPE_TOKEN),
  );
  t.after(async () => {
    await control.close();
    await wrongScopeControl.close();
  });

  await control.start();
  await wrongScopeControl.start();
  assert.equal(control.health().phase, "ready");
  assert.deepEqual(Object.keys(control.health().ports), ["probe", "outbox", "admission"]);

  const body = admissionBody();
  const invalid = await request(controlPort(control), {
    method: "POST",
    path: "/v1/nostr/suggestions/admit",
    authorization: `Bearer ${INVALID_TOKEN}`,
    body,
  });
  assert.equal(invalid.status, 401);
  assert.equal(invalid.body, "case_steward_required\n");

  const wrongScope = await request(controlPort(wrongScopeControl), {
    method: "POST",
    path: "/v1/nostr/suggestions/admit",
    authorization: `Bearer ${WRONG_SCOPE_TOKEN}`,
    body,
  });
  assert.equal(wrongScope.status, 400);
  assert.equal(wrongScope.body, "bad_request\n");
  const deniedReplay = await request(outboxPort(control), {
    method: "GET",
    path: `${CREDENTIAL_FREE_CASE_BINDING_OUTBOX_PATH}?afterSequence=0&limit=1`,
  });
  assert.equal(deniedReplay.status, 200);
  assert.deepEqual(JSON.parse(deniedReplay.body), {
    schemaVersion: "public_case_binding_outbox_page_v1",
    afterSequence: 0,
    nextSequence: null,
    entries: [],
  });
  const wrongScopeReplay = await request(outboxPort(wrongScopeControl), {
    method: "GET",
    path: `${CREDENTIAL_FREE_CASE_BINDING_OUTBOX_PATH}?afterSequence=0&limit=1`,
  });
  assert.equal(wrongScopeReplay.status, 200);
  assert.equal((JSON.parse(wrongScopeReplay.body) as { entries: unknown[] }).entries.length, 0);
  await wrongScopeControl.close();

  const admitted = await request(controlPort(control), {
    method: "POST",
    path: "/v1/nostr/suggestions/admit",
    authorization: `Bearer ${STEWARD_TOKEN}`,
    body,
  });
  assert.equal(admitted.status, 200);
  const receipt = JSON.parse(admitted.body) as PublicCaseBindingReceiptV1;
  assert.equal(receipt.rootEventId, body.sourceDiscussion.id);
  assert.equal(receipt.sourceAnswerEventId, body.sourceAnswer.id);
  assert.equal(receipt.candidateId, body.signedSuggestion.candidateId);
  assert.equal(receipt.authorityBinding, "none");
  assert.equal(receipt.openDeskWrite, false);

  const publicRuntime = createStagingPublicCaseBindingRuntime(publicConfig(outboxPort(control)));
  t.after(() => publicRuntime.close());
  await publicRuntime.start();
  assert.equal(publicRuntime.health().phase, "ready");
  assert.equal(publicRuntime.health().ready, true);
  const rootPath = `/v1/public/case-bindings/by-discussion/${receipt.rootEventId}`;
  const casePath = `/v1/public/case-bindings/${receipt.caseId}`;
  const publicByRoot = await request(publicPort(publicRuntime), { method: "GET", path: rootPath });
  const publicByCase = await request(publicPort(publicRuntime), { method: "GET", path: casePath });
  assert.equal(publicByRoot.status, 200);
  assert.equal(publicByCase.status, 200);
  assert.equal(publicByRoot.body, publicByCase.body);
  assert.equal(JSON.parse(publicByRoot.body).receiptChecksum, receipt.receiptChecksum);

  await publicRuntime.close();
  await control.close();
  assert.equal(control.health().phase, "stopped");
  assert.equal(publicRuntime.health().phase, "stopped");

  const reopenedControl = createStagingCaseControlRuntime(controlConfig(rootDir));
  t.after(async () => {
    await reopenedControl.close();
  });
  await reopenedControl.start();
  const durablePublic = createStagingPublicCaseBindingRuntime(publicConfig(outboxPort(reopenedControl)));
  await durablePublic.start();
  t.after(() => durablePublic.close());
  const replayedByRoot = await request(publicPort(durablePublic), { method: "GET", path: rootPath });
  const replayedByCase = await request(publicPort(durablePublic), { method: "GET", path: casePath });
  assert.equal(replayedByRoot.status, 200);
  assert.equal(replayedByCase.status, 200);
  assert.equal(replayedByRoot.body, publicByRoot.body);
  assert.equal(replayedByCase.body, publicByCase.body);
  await durablePublic.close();
  await reopenedControl.close();
});

test("public runtime rejects private state, credential, control, and network capabilities", () => {
  const valid = publicConfig(8123);
  for (const forbidden of ["db", "rootDir", "token", "credential", "control", "admission", "rbac"] as const) {
    assert.throws(
      () => createStagingPublicCaseBindingRuntime({ ...valid, [forbidden]: "not-accepted" } as never),
      /staging_public_case_binding_runtime_config_invalid/u,
    );
  }
  assert.throws(
    () => createStagingPublicCaseBindingRuntime({ ...valid, publicListener: { host: "0.0.0.0", port: 0 } } as never),
    /staging_public_case_binding_runtime_config_invalid/u,
  );
  assert.throws(
    () => createStagingPublicCaseBindingRuntime({ ...valid, extra: true } as never),
    /staging_public_case_binding_runtime_config_invalid/u,
  );
});
