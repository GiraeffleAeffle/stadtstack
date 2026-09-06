import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import type { CaseBindingOutboxEntryV1, CredentialFreeCaseBindingOutboxReader } from "../src/case-binding-outbox.ts";
import { createPublicCaseBindingReceipt, type PublicCaseBindingReceiptV1 } from "../src/case-binding-projection.ts";
import { createCredentialFreeCaseBindingOutboxServer } from "../src/credential-free-case-binding-outbox-server.ts";
import {
  createStagingPublicCaseBindingRuntime,
  createOperationsBoundStagingPublicCaseBindingRuntime,
  type OperationsBoundStagingPublicCaseBindingApplicationConfig,
  type StagingPublicCaseBindingDeploymentBindingV1,
  type StagingPublicCaseBindingRuntimeConfig,
} from "../src/staging-public-case-binding-runtime.ts";

const HOST = "127.0.0.1";
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const hex = (value: number) => value.toString(16).padStart(64, "0");

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function reviewedBinding(overrides: Record<string, unknown> = {}): StagingPublicCaseBindingDeploymentBindingV1 {
  const payload: Omit<StagingPublicCaseBindingDeploymentBindingV1, "bindingChecksum"> = {
    schemaVersion: "staging_public_case_binding_deployment_binding_v1", deploymentEnvironment: "staging",
    municipalityId: "roebel-mueritz", namespace: "stadtstack-synthetic", workloadName: "case-public-binding",
    workload: { serviceAccountName: "case-public-binding", automountServiceAccountToken: false, imagePullSecrets: [] },
    releaseDigest: digest("public-release"), operationsTopologyChecksum: digest("reviewed-topology"),
    outbox: { namespace: "stadtstack-synthetic", serviceName: "case-control-private-outbox", port: 18087 },
    listeners: [{ id: "public", port: 18086, bindScope: "pod_network" }, { id: "public-probe", port: 18089, bindScope: "pod_network" }],
    ...overrides,
  };
  return { ...payload, bindingChecksum: digest(canonical(payload)) };
}

function reviewedApplication(): OperationsBoundStagingPublicCaseBindingApplicationConfig {
  return { publicAllowedHosts: [HOST], probeAllowedHosts: [HOST], reconcileIntervalMs: 100, drainTimeoutMs: 500 };
}

function caseId(value: number): string {
  return `urn:stadtstack:case:municipality:roebel-mueritz:01983a00-0000-7000-8000-${value.toString(16).padStart(12, "0")}`;
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

test("reviewed public composition requires separate pins and rejects control, storage and arbitrary transport choices", async () => {
  const create = (binding = reviewedBinding(), application = reviewedApplication(), pin = binding.bindingChecksum) =>
    createOperationsBoundStagingPublicCaseBindingRuntime({
      application, reviewedBindingSource: { read: () => binding }, bindingPinSource: { read: () => pin },
    });
  const runtime = create();
  assert.deepEqual(Object.keys(runtime), ["start", "health", "close"]);
  assert.equal(runtime.health().phase, "new");
  await runtime.close();
  assert.throws(() => create(reviewedBinding(), reviewedApplication(), digest("other pin")), /staging_public_case_binding_deployment_invalid/u);
  assert.throws(() => create({ ...reviewedBinding(), releaseDigest: digest("changed release") }), /staging_public_case_binding_deployment_invalid/u);
  const valid = reviewedBinding();
  for (const changed of [
    { deploymentEnvironment: "production" },
    { schemaVersion: "staging_case_control_deployment_binding_v1" },
    { releaseDigest: "latest" },
    { rootDir: "/var/lib/case" },
    { workload: { ...valid.workload, automountServiceAccountToken: true } },
    { workload: { ...valid.workload, imagePullSecrets: ["private-registry"] } },
    { outbox: { ...valid.outbox, port: 18085 } },
    { outbox: { ...valid.outbox, namespace: "another-city" } },
    { outbox: { ...valid.outbox, serviceName: "169.254.169.254" } },
    { outbox: { ...valid.outbox, origin: "http://external.example/" } },
    { listeners: [{ id: "admission", port: 18085, bindScope: "pod_network" }, valid.listeners[1]] },
  ]) assert.throws(() => create(reviewedBinding(changed)), /staging_public_case_binding_deployment_invalid/u);
  for (const field of ["rootDir", "token", "outboxOrigin", "publicListener", "storageObserver"]) {
    assert.throws(() => create(valid, { ...reviewedApplication(), [field]: "forbidden" } as never), /staging_public_case_binding_runtime_config_invalid/u);
  }
  const sharedSource = { read: () => valid };
  assert.throws(() => createOperationsBoundStagingPublicCaseBindingRuntime({
    application: reviewedApplication(), reviewedBindingSource: sharedSource, bindingPinSource: sharedSource,
  }), /staging_public_case_binding_deployment_invalid/u);
});

test("mounted public entrypoint replays verified receipts on fixed public ports and shuts down cleanly", async (t) => {
  const files = mkdtempSync(join(tmpdir(), "stadtstack-public-entrypoint-"));
  t.after(() => rmSync(files, { recursive: true, force: true }));
  const binding = reviewedBinding();
  const outboxHost = `${binding.outbox.serviceName}.${binding.outbox.namespace}.svc.cluster.local`;
  const entries = [entry(1, receipt(1))];
  let unavailable = false;
  const outbox = createCredentialFreeCaseBindingOutboxServer({ allowedHosts: [outboxHost], outbox: {
    replay(input = {}) {
      if (unavailable) throw new Error("synthetic outage");
      return entries.filter((value) => value.sequence > (input.afterSequence ?? 0)).slice(0, input.limit ?? 256);
    },
  } });
  const privatePort = await listen(outbox.server);
  t.after(() => close(outbox.server));
  const applicationPath = join(files, "application.json");
  const bindingPath = join(files, "binding.json");
  const bridgePath = join(files, "synthetic-transport.mjs");
  writeFileSync(applicationPath, JSON.stringify(reviewedApplication()), { mode: 0o600 });
  writeFileSync(bindingPath, JSON.stringify(binding), { mode: 0o600 });
  // Only the subprocess's synthetic cluster transport is redirected. The
  // unmodified production client must first choose the exact reviewed origin,
  // port, GET method and credential-free headers. No runtime test hook exists.
  writeFileSync(bridgePath, `
    import assert from "node:assert/strict";
    import http from "node:http";
    import { syncBuiltinESMExports } from "node:module";
    const request = http.request;
    http.request = (options, callback) => {
      assert.equal(options.hostname, ${JSON.stringify(outboxHost)});
      assert.equal(options.port, 18087);
      assert.equal(options.method, "GET");
      assert.deepEqual(options.headers, { accept: "application/json", connection: "close", host: ${JSON.stringify(outboxHost)} });
      return request({ ...options, hostname: "127.0.0.1", port: ${privatePort} }, callback);
    };
    syncBuiltinESMExports();
    await import(${JSON.stringify(pathToFileURL(resolve("containers/case-runtime/case-public-binding-entrypoint.mjs")).href)});
  `, { mode: 0o600 });
  const before = readdirSync(files).sort();
  const child = spawn(process.execPath, ["--experimental-strip-types", bridgePath], {
    env: { PATH: process.env.PATH, NODE_NO_WARNINGS: "1",
      STADTSTACK_CASE_PUBLIC_CONFIG_PATH: applicationPath,
      STADTSTACK_CASE_PUBLIC_REVIEWED_BINDING_PATH: bindingPath,
      STADTSTACK_CASE_PUBLIC_BINDING_SHA256: binding.bindingChecksum },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let diagnostics = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { diagnostics += String(chunk); });
  const exited = once(child, "exit");
  try {
    await eventually(() => assert.equal(output, "stadtstack_case_public_binding_reviewed_public_ready\n", diagnostics), 8_000);
    assert.deepEqual(await get(18089, "/readyz"), { status: 200, body: "ok\n" });
    const path = `/v1/public/case-bindings/by-discussion/${entries[0]!.receipt.rootEventId}`;
    const published = await get(18086, path);
    assert.equal(published.status, 200);
    assert.deepEqual(JSON.parse(published.body), entries[0]!.receipt);
    assert.equal((await get(18086, "/v1/nostr/suggestions/admit")).status, 404);
    unavailable = true;
    await eventuallyAsync(async () => assert.equal((await get(18089, "/readyz")).status, 503));
    assert.deepEqual(await get(18086, path), published);
    unavailable = false;
    await eventuallyAsync(async () => assert.equal((await get(18089, "/readyz")).status, 200));
    child.kill("SIGTERM");
    assert.deepEqual(await exited, [0, null]);
    assert.equal(diagnostics, "");
    assert.deepEqual(readdirSync(files).sort(), before);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
  }
});

test("mounted public entrypoint rejects partial pins and mixed control configuration with redacted errors", () => {
  const files = mkdtempSync(join(tmpdir(), "stadtstack-public-rejected-"));
  try {
    const applicationPath = join(files, "application.json");
    const bindingPath = join(files, "binding.json");
    const binding = reviewedBinding();
    writeFileSync(applicationPath, JSON.stringify(reviewedApplication()), { mode: 0o600 });
    writeFileSync(bindingPath, JSON.stringify(binding), { mode: 0o600 });
    const base = { PATH: process.env.PATH, NODE_NO_WARNINGS: "1", STADTSTACK_CASE_PUBLIC_CONFIG_PATH: applicationPath };
    const pins = { STADTSTACK_CASE_PUBLIC_REVIEWED_BINDING_PATH: bindingPath, STADTSTACK_CASE_PUBLIC_BINDING_SHA256: binding.bindingChecksum };
    for (const env of [
      { ...base, STADTSTACK_CASE_PUBLIC_REVIEWED_BINDING_PATH: bindingPath },
      { ...base, STADTSTACK_CASE_PUBLIC_BINDING_SHA256: binding.bindingChecksum },
      { ...base, ...pins, STADTSTACK_CASE_PUBLIC_BINDING_SHA256: digest("wrong") },
      { ...base, ...pins, STADTSTACK_CASE_CONTROL_CONFIG_PATH: applicationPath },
    ]) {
      const result = spawnSync(process.execPath, ["--experimental-strip-types", "containers/case-runtime/case-public-binding-entrypoint.mjs"],
        { env, encoding: "utf8", timeout: 5_000 });
      assert.equal(result.status, 78);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "stadtstack_case_public_binding_start_failed\n");
    }
    assert.deepEqual(readdirSync(files).sort(), ["application.json", "binding.json"]);
  } finally { rmSync(files, { recursive: true, force: true }); }
});

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

test("admits only a canonical explicit loopback outbox origin before start", () => {
  const runtime = createStagingPublicCaseBindingRuntime(config(18_087, {
    outboxOrigin: "http://127.0.0.1:18087/",
  }));
  assert.equal(runtime.health().phase, "new");

  for (const outboxOrigin of [
    "http://localhost:18087/",
    "http://[::1]:18087/",
    "http://0.0.0.0:18087/",
    "http://case-steward-control.stadtstack.svc:18087/",
    "http://example.test:18087/",
    "http://169.254.169.254:18087/",
    "https://127.0.0.1:18087/",
    "http://127.0.0.1/",
    "http://127.0.0.1:80/",
    "http://127.0.0.1:0/",
    "http://127.0.0.1:65536/",
    "http://127.0.0.1:00018087/",
    "http://user:password@127.0.0.1:18087/",
    "http://127.0.0.1:18087",
    "http://127.0.0.1:18087/outbox",
    "http://127.0.0.1:18087/?after=0",
    "http://127.0.0.1:18087/#fragment",
    " http://127.0.0.1:18087/",
    "HTTP://127.0.0.1:18087/",
  ]) {
    assert.throws(
      () => createStagingPublicCaseBindingRuntime(config(18_087, { outboxOrigin })),
      /staging_public_case_binding_runtime_config_invalid/u,
    );
  }
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
