import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { request as httpRequest, type Server } from "node:http";
import test from "node:test";

import type { CaseBindingOutboxEntryV1, CredentialFreeCaseBindingOutboxReader } from "../src/case-binding-outbox.ts";
import { createPublicCaseBindingReceipt, type PublicCaseBindingReceiptV1 } from "../src/case-binding-projection.ts";
import { createCredentialFreeCaseBindingOutboxServer } from "../src/credential-free-case-binding-outbox-server.ts";
import {
  createStagingPublicCaseBindingRuntime,
  type StagingPublicCaseBindingRuntimeConfig,
} from "../src/staging-public-case-binding-runtime.ts";

const HOST = "127.0.0.1";
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const hex = (value: number) => value.toString(16).padStart(64, "0");

function caseId(value: number): string {
  return `urn:stadtstack:case:test:roebel-mueritz:01983a00-0000-7000-8000-${value.toString(16).padStart(12, "0")}`;
}

function receipt(value: number): PublicCaseBindingReceiptV1 {
  const currentCaseId = caseId(value);
  const candidateEventId = hex(value + 100_000);
  return createPublicCaseBindingReceipt({
    rootEventId: hex(value),
    topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse",
    candidateId: `urn:stadtstack:signed-topic-suggestion:${candidateEventId}`,
    candidateEventId,
    sourceAnswerEventId: hex(value + 200_000),
    caseId: currentCaseId,
    caseVersion: 3,
    caseEventIds: [
      `urn:stadtstack:case-event:${currentCaseId}:1`,
      `urn:stadtstack:case-event:${currentCaseId}:2`,
      `urn:stadtstack:case-event:${currentCaseId}:3`,
    ],
    journalHeadChecksum: digest(`journal-${value}`),
    admissionEventChecksum: digest(`journal-${value}`),
  });
}

function entry(sequence: number, value: PublicCaseBindingReceiptV1): CaseBindingOutboxEntryV1 {
  return Object.freeze({ sequence, receipt: structuredClone(value) });
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function get(port: number, path: string): Promise<Readonly<{ status: number; body: string }>> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: HOST, port, method: "GET", path, headers: { host: HOST, connection: "close" } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { body += chunk; });
      response.once("end", () => resolve(Object.freeze({ status: response.statusCode ?? 0, body })));
    });
    request.once("error", reject);
    request.end();
  });
}

async function eventually(assertion: () => void, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { assertion(); return; } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 15));
    }
  }
}

async function eventuallyAsync(assertion: () => Promise<void>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { await assertion(); return; } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 15));
    }
  }
}

function config(port: number, overrides: Partial<StagingPublicCaseBindingRuntimeConfig> = {}): StagingPublicCaseBindingRuntimeConfig {
  return {
    outboxOrigin: `http://${HOST}:${port}/`,
    publicAllowedHosts: [HOST],
    probeAllowedHosts: [HOST],
    publicListener: { host: HOST, port: 0 },
    probeListener: { host: HOST, port: 0 },
    reconcileIntervalMs: 100,
    drainTimeoutMs: 500,
    ...overrides,
  };
}

test("binds only a not-ready probe during hydration, then publishes receipt-verified lookups", async (t) => {
  const entries: CaseBindingOutboxEntryV1[] = [entry(1, receipt(1))];
  let release!: () => void;
  const hydrationGate = new Promise<void>((resolve) => { release = resolve; });
  let first = true;
  const outbox: CredentialFreeCaseBindingOutboxReader = Object.freeze({
    async replay(input = {}) {
      if (first) { first = false; await hydrationGate; }
      const after = input.afterSequence ?? 0;
      const limit = input.limit ?? 256;
      return Object.freeze(entries.filter((value) => value.sequence > after).slice(0, limit));
    },
  });
  const privateTransport = createCredentialFreeCaseBindingOutboxServer({ allowedHosts: [HOST], outbox });
  const privatePort = await listen(privateTransport.server);
  t.after(async () => { await close(privateTransport.server); });

  const runtime = createStagingPublicCaseBindingRuntime(config(privatePort));
  assert.deepEqual(Object.keys(runtime), ["start", "health", "close"]);
  const start = runtime.start();
  await eventually(() => assert.ok(runtime.health().ports.probe));
  assert.equal(runtime.health().ready, false);
  assert.equal(runtime.health().ports.public, null);
  assert.deepEqual(await get(runtime.health().ports.probe!, "/readyz"), { status: 503, body: "not_ready\n" });

  release();
  await start;
  const ready = runtime.health();
  assert.equal(ready.ready, true);
  assert.equal(ready.detail, "ready");
  assert.ok(ready.ports.public);
  const root = entries[0]!.receipt.rootEventId;
  const response = await get(ready.ports.public!, `/v1/public/case-bindings/by-discussion/${root}`);
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), entries[0]!.receipt);
  await runtime.close();
});

test("periodic outbox faults fail readiness without replacing old receipt bytes and recover", async (t) => {
  const entries: CaseBindingOutboxEntryV1[] = [entry(1, receipt(1))];
  let unavailable = false;
  const outbox: CredentialFreeCaseBindingOutboxReader = Object.freeze({
    replay(input = {}) {
      if (unavailable) throw new Error("private_database_unavailable");
      const after = input.afterSequence ?? 0;
      const limit = input.limit ?? 256;
      return Object.freeze(entries.filter((value) => value.sequence > after).slice(0, limit));
    },
  });
  const privateTransport = createCredentialFreeCaseBindingOutboxServer({ allowedHosts: [HOST], outbox });
  const privatePort = await listen(privateTransport.server);
  t.after(async () => { await close(privateTransport.server); });
  const runtime = createStagingPublicCaseBindingRuntime(config(privatePort));
  t.after(async () => { await runtime.close(); });
  await runtime.start();
  const initial = runtime.health();
  const root = entries[0]!.receipt.rootEventId;
  const before = await get(initial.ports.public!, `/v1/public/case-bindings/by-discussion/${root}`);
  assert.equal(before.status, 200);

  unavailable = true;
  await eventually(() => assert.equal(runtime.health().detail, "outbox_unavailable"));
  assert.equal((await get(runtime.health().ports.probe!, "/readyz")).status, 503);
  assert.deepEqual(await get(initial.ports.public!, `/v1/public/case-bindings/by-discussion/${root}`), before);

  unavailable = false;
  entries.push(entry(2, receipt(2)));
  await eventually(() => assert.equal(runtime.health().ready, true));
  await eventuallyAsync(async () => assert.equal((await get(initial.ports.public!, `/v1/public/case-bindings/by-discussion/${entries[1]!.receipt.rootEventId}`)).status, 200));
});

test("rejects storage, credential, reviewed control deployment, and non-loopback configuration capabilities", () => {
  const valid = config(80);
  for (const forbidden of [
    "db", "rootDir", "token", "credential", "control", "admission", "rbac",
    "reviewedBinding", "expectedBindingChecksum", "reviewedBindingSource", "bindingPinSource",
    "storageObserver", "bindPlan",
  ] as const) {
    assert.throws(() => createStagingPublicCaseBindingRuntime({ ...valid, [forbidden]: "not-accepted" } as never), /staging_public_case_binding_runtime_config_invalid/u);
  }
  assert.throws(() => createStagingPublicCaseBindingRuntime({ ...valid, publicListener: { host: "0.0.0.0", port: 0 } as never }), /staging_public_case_binding_runtime_config_invalid/u);
  assert.throws(() => createStagingPublicCaseBindingRuntime({ ...valid, publicAllowedHosts: ["not a host"] }), /staging_public_case_binding_runtime_config_invalid/u);
  assert.throws(() => createStagingPublicCaseBindingRuntime({ ...valid, publicAllowedHosts: [HOST, HOST] }), /staging_public_case_binding_runtime_config_invalid/u);
  assert.throws(() => createStagingPublicCaseBindingRuntime({ ...valid, extra: true } as never), /staging_public_case_binding_runtime_config_invalid/u);
});

test("close during hydration never binds the public listener and is memoized", async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const outbox: CredentialFreeCaseBindingOutboxReader = Object.freeze({
    async replay() { await gate; return Object.freeze([]); },
  });
  const privateTransport = createCredentialFreeCaseBindingOutboxServer({ allowedHosts: [HOST], outbox });
  const privatePort = await listen(privateTransport.server);
  t.after(async () => { await close(privateTransport.server); });
  const runtime = createStagingPublicCaseBindingRuntime(config(privatePort));
  const start = runtime.start();
  await eventually(() => assert.ok(runtime.health().ports.probe));
  const firstClose = runtime.close();
  assert.strictEqual(firstClose, runtime.close());
  const outcome = await Promise.race([
    firstClose.then(() => "closed" as const),
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 1_000)),
  ]);
  assert.equal(outcome, "closed");
  await start;
  release();
  assert.deepEqual(runtime.health(), {
    phase: "stopped",
    ready: false,
    detail: "stopped",
    ports: { public: null, probe: null },
  });
});

test("close aborts and awaits an in-flight periodic outbox replay", async (t) => {
  let replayStarted!: () => void;
  const started = new Promise<void>((resolve) => { replayStarted = resolve; });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const outbox: CredentialFreeCaseBindingOutboxReader = Object.freeze({
    async replay() {
      calls += 1;
      if (calls > 1) {
        replayStarted();
        await gate;
      }
      return Object.freeze([]);
    },
  });
  const privateTransport = createCredentialFreeCaseBindingOutboxServer({ allowedHosts: [HOST], outbox });
  const privatePort = await listen(privateTransport.server);
  t.after(async () => { await close(privateTransport.server); });
  const runtime = createStagingPublicCaseBindingRuntime(config(privatePort));
  await runtime.start();
  await started;
  const outcome = await Promise.race([
    runtime.close().then(() => "closed" as const),
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 1_000)),
  ]);
  assert.equal(outcome, "closed");
  assert.equal(runtime.health().phase, "stopped");
  release();
});
