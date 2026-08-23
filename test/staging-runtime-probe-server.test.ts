import assert from "node:assert/strict";
import { request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import { connect } from "node:net";
import test from "node:test";

import { createStagingRuntimeProbeServer } from "../src/staging-runtime-probe-server.ts";

const HOST = "runtime-probe.staging.example";

type Result = Readonly<{ status: number; headers: IncomingHttpHeaders; body: string }>;

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function request(port: number, input: Readonly<{
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
}> = {}): Promise<Result> {
  return new Promise((resolve, reject) => {
    const client = httpRequest({
      host: "127.0.0.1",
      port,
      method: input.method ?? "GET",
      path: input.path ?? "/livez",
      headers: { host: HOST, connection: "close", ...input.headers },
    }, (incoming) => {
      let body = "";
      incoming.setEncoding("utf8");
      incoming.on("data", (chunk: string) => { body += chunk; });
      incoming.on("end", () => resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body }));
    });
    client.on("error", reject);
    client.end(input.body);
  });
}

function raw(port: number, data: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let received = "";
    socket.setEncoding("utf8");
    socket.once("error", reject);
    socket.on("data", (chunk: string) => { received += chunk; });
    socket.once("end", () => resolve(received));
    socket.once("connect", () => socket.end(data));
  });
}

test("liveness and readiness expose only fixed probe responses across lifecycle phases", async (t) => {
  let snapshot: { phase: string; ready: boolean } = { phase: "new", ready: false };
  const privateRuntimeDetail = "private detail: port 12345";
  const transport = createStagingRuntimeProbeServer({ allowedHosts: [HOST], health: () => snapshot });
  assert.deepEqual(Object.keys(transport), ["server"]);
  assert.equal(transport.server.listening, false);
  const port = await listen(transport.server);
  t.after(() => close(transport.server));

  const expectations: readonly Readonly<{ phase: string; ready: boolean; live: number; readyStatus: number }>[] = [
    { phase: "new", ready: false, live: 200, readyStatus: 503 },
    { phase: "starting", ready: false, live: 200, readyStatus: 503 },
    { phase: "ready", ready: true, live: 200, readyStatus: 200 },
    { phase: "draining", ready: false, live: 200, readyStatus: 503 },
    { phase: "failed", ready: false, live: 503, readyStatus: 503 },
    { phase: "stopped", ready: false, live: 503, readyStatus: 503 },
  ];
  for (const expected of expectations) {
    snapshot = { ...snapshot, phase: expected.phase, ready: expected.ready };
    const live = await request(port, { path: "/livez" });
    const ready = await request(port, { path: "/readyz" });
    assert.equal(live.status, expected.live, expected.phase);
    assert.equal(ready.status, expected.readyStatus, expected.phase);
    assert.equal(live.body, expected.live === 200 ? "ok\n" : "not_ready\n");
    assert.equal(ready.body, expected.readyStatus === 200 ? "ok\n" : "not_ready\n");
    assert.equal(live.body.includes(privateRuntimeDetail), false);
    assert.equal(live.body.includes("12345"), false);
    assert.equal(live.headers["content-length"], String(Buffer.byteLength(live.body)));
    assert.equal(live.headers["cache-control"], "no-store");
    assert.equal(live.headers["x-content-type-options"], "nosniff");
  }
  const head = await request(port, { method: "HEAD", path: "/livez" });
  assert.equal(head.status, 503);
  assert.equal(head.body, "");
  assert.equal(head.headers["content-length"], String(Buffer.byteLength("not_ready\n")));
});

test("invalid requests are rejected before health and the route surface stays closed", async (t) => {
  let calls = 0;
  const transport = createStagingRuntimeProbeServer({
    allowedHosts: [HOST],
    health: () => { calls += 1; return { phase: "ready", ready: true }; },
  });
  const port = await listen(transport.server);
  t.after(() => close(transport.server));
  const denied = await Promise.all([
    request(port, { headers: { authorization: "Bearer private" } }),
    request(port, { headers: { "proxy-authorization": "Basic private" } }),
    request(port, { headers: { cookie: "session=private" } }),
    request(port, { headers: { "content-encoding": "gzip" } }),
    request(port, { headers: { "transfer-encoding": "chunked" } }),
    request(port, { headers: { "content-length": "1" }, body: "x" }),
    request(port, { headers: { host: "attacker.example", "x-forwarded-host": HOST } }),
    request(port, { path: "/livez?x=1" }),
    request(port, { path: "/readyz%2f" }),
  ]);
  for (const result of denied) {
    assert.equal(result.status, 400);
    assert.equal(result.body, "bad_request\n");
  }
  assert.equal(calls, 0);
  const duplicateHost = await raw(port,
    `GET /livez HTTP/1.1\r\nHost: ${HOST}\r\nHost: attacker.example\r\nConnection: close\r\n\r\n`);
  assert.match(duplicateHost, /^HTTP\/1\.1 400 /u);
  assert.equal(calls, 0);
  const paddedCookie = await raw(port,
    `GET /livez HTTP/1.1\r\nHost: ${HOST}\r\n${Array.from({ length: 40 }, (_, i) => `X-Pad-${i}: x\r\n`).join("")}Cookie: x\r\nConnection: close\r\n\r\n`);
  assert.match(paddedCookie, /^HTTP\/1\.1 400 /u);
  assert.equal(calls, 0);

  const method = await request(port, { method: "POST" });
  assert.equal(method.status, 405);
  assert.equal(method.headers.allow, "GET, HEAD");
  assert.equal(method.body, "method_not_allowed\n");
  const missing = await request(port, { path: "/health" });
  assert.equal(missing.status, 404);
  assert.equal(missing.body, "not_found\n");
  assert.equal(calls, 0);
});

test("health faults and invalid snapshots are redacted as not-ready", async () => {
  const modes: readonly (() => unknown)[] = [
    () => { throw new Error("private port 16443"); },
    () => ({ phase: "ready", ready: "yes" }),
    () => ({ phase: "ready", ready: true, detail: "private" }),
    () => ({ phase: "unknown", ready: false }),
    () => ({ phase: "starting", ready: true }),
    () => new Proxy({ phase: "ready", ready: true }, {}),
    () => ({ get phase() { throw new Error("private"); }, ready: true }),
  ];
  for (const health of modes) {
    const transport = createStagingRuntimeProbeServer({ allowedHosts: [HOST], health: health as never });
    const port = await listen(transport.server);
    const result = await request(port, { path: "/readyz" });
    await close(transport.server);
    assert.equal(result.status, 503);
    assert.equal(result.body, "not_ready\n");
    assert.equal(result.body.includes("private"), false);
  }
});

test("configuration captures one health function and rejects proxy, accessor, and expanded capability shapes", async () => {
  let calls = 0;
  const health = () => { calls += 1; return { phase: "ready", ready: true }; };
  const input = { allowedHosts: [HOST], health };
  const transport = createStagingRuntimeProbeServer(input);
  input.health = () => { throw new Error("replacement must not run"); };
  const port = await listen(transport.server);
  const result = await request(port);
  await close(transport.server);
  assert.equal(result.status, 200);
  assert.equal(calls, 1);

  assert.throws(() => createStagingRuntimeProbeServer({ ...input, extra: true } as never), /staging_runtime_probe_server_config_invalid/u);
  assert.throws(() => createStagingRuntimeProbeServer(new Proxy({ allowedHosts: [HOST], health }, {})), /staging_runtime_probe_server_config_invalid/u);
  assert.throws(() => createStagingRuntimeProbeServer({ allowedHosts: new Proxy([HOST], {}), health }), /staging_runtime_probe_server_config_invalid/u);
  assert.throws(() => createStagingRuntimeProbeServer({ allowedHosts: [HOST, HOST], health }), /staging_runtime_probe_server_config_invalid/u);
  assert.throws(() => createStagingRuntimeProbeServer({ allowedHosts: [HOST], health: new Proxy(health, {}) }), /staging_runtime_probe_server_config_invalid/u);
  const accessor: Record<string, unknown> = { allowedHosts: [HOST] };
  Object.defineProperty(accessor, "health", { enumerable: true, get: () => health });
  assert.throws(() => createStagingRuntimeProbeServer(accessor as never), /staging_runtime_probe_server_config_invalid/u);
});
