import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import { connect } from "node:net";
import test from "node:test";

import {
  createPublicCaseBindingReceipt,
  type PublicCaseBindingReceiptV1,
} from "../src/case-binding-projection.ts";
import {
  createPublicCaseBindingServer,
  type PublicCaseBindingReader,
} from "../src/public-case-binding-server.ts";

const CASE_ID = "urn:stadtstack:case:municipality:roebel-mueritz:01983a00-0000-7000-8000-000000000001";
const ROOT = "a".repeat(64);
const HOST = "case-bindings.staging.example";
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const casePath = `/v1/public/case-bindings/${CASE_ID}`;
const rootPath = `/v1/public/case-bindings/by-discussion/${ROOT}`;

type HttpResult = { status: number; headers: IncomingHttpHeaders; body: string };

function receipt(
  caseId = CASE_ID,
  rootEventId = ROOT,
): PublicCaseBindingReceiptV1 {
  return createPublicCaseBindingReceipt({
    rootEventId,
    topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse",
    candidateId: `urn:stadtstack:signed-topic-suggestion:${"b".repeat(64)}`,
    candidateEventId: "b".repeat(64),
    sourceAnswerEventId: "c".repeat(64),
    caseId,
    caseVersion: 3,
    caseEventIds: [
      `urn:stadtstack:case-event:${caseId}:1`,
      `urn:stadtstack:case-event:${caseId}:2`,
      `urn:stadtstack:case-event:${caseId}:3`,
    ] as const,
    journalHeadChecksum: digest("journal"),
    admissionEventChecksum: digest("journal"),
  });
}

function reader(value: PublicCaseBindingReceiptV1 | null = receipt()): PublicCaseBindingReader {
  return {
    get(caseId: string) { return value?.caseId === caseId ? structuredClone(value) : null; },
    getByRootEventId(rootEventId: string) { return value?.rootEventId === rootEventId ? structuredClone(value) : null; },
  };
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function request(
  port: number,
  input: { method?: string; path?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const client = httpRequest({
      host: "127.0.0.1",
      port,
      method: input.method ?? "GET",
      path: input.path ?? casePath,
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

function raw(port: number, value: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let result = "";
    socket.setEncoding("utf8");
    socket.once("error", reject);
    socket.on("data", (chunk: string) => { result += chunk; });
    socket.once("end", () => resolve(result));
    socket.once("connect", () => socket.end(value));
  });
}

test("the loopback listener exposes only canonical GET and HEAD receipt bindings", async (t) => {
  const value = receipt();
  const transport = createPublicCaseBindingServer({ allowedHosts: [HOST], reader: reader(value) });
  assert.deepEqual(Object.keys(transport), ["server"]);
  const port = await listen(transport.server);
  t.after(() => close(transport.server));

  const byCase = await request(port);
  const byRoot = await request(port, { path: rootPath });
  const head = await request(port, { method: "HEAD" });
  const expected = `${JSON.stringify(JSON.parse(byCase.body), Object.keys(JSON.parse(byCase.body)).sort())}\n`;

  assert.equal(byCase.status, 200);
  assert.equal(byRoot.status, 200);
  assert.deepEqual(JSON.parse(byCase.body), value);
  assert.deepEqual(JSON.parse(byRoot.body), value);
  assert.equal(byCase.headers["cache-control"], "no-store");
  assert.equal(byCase.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(byCase.headers["x-content-type-options"], "nosniff");
  assert.equal(byCase.headers["x-stadtstack-receipt-sha256"], value.receiptChecksum);
  assert.equal(byCase.headers.etag, `"${value.receiptChecksum}"`);
  assert.equal(byCase.headers["content-length"], String(Buffer.byteLength(byCase.body)));
  assert.equal(byCase.body, expected);
  assert.equal(byCase.headers["access-control-allow-origin"], undefined);
  assert.equal(byCase.headers["set-cookie"], undefined);
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  for (const key of ["cache-control", "content-type", "x-content-type-options", "x-stadtstack-receipt-sha256", "etag", "content-length"] as const) {
    assert.equal(head.headers[key], byCase.headers[key]);
  }
});

test("the listener rejects credentials, bodies, spoofed hosts, aliases, and writes before any reader call", async (t) => {
  let reads = 0;
  const value = receipt();
  const narrowReader: PublicCaseBindingReader = {
    get(caseId: string) { reads += 1; return caseId === value.caseId ? value : null; },
    getByRootEventId(rootEventId: string) { reads += 1; return rootEventId === value.rootEventId ? value : null; },
  };
  const transport = createPublicCaseBindingServer({ allowedHosts: [HOST], reader: narrowReader });
  const port = await listen(transport.server);
  t.after(() => close(transport.server));

  const violations = await Promise.all([
    request(port, { headers: { authorization: "Bearer secret" } }),
    request(port, { headers: { "proxy-authorization": "Basic secret" } }),
    request(port, { headers: { cookie: "session=secret" } }),
    request(port, { headers: { "content-length": "1" }, body: "x" }),
    request(port, { headers: { host: "attacker.example", "x-forwarded-host": HOST } }),
    request(port, { path: `${casePath}?x=1` }),
    request(port, { path: `${casePath}%2f` }),
  ]);
  for (const result of violations) {
    assert.equal(result.status, 400);
    assert.equal(result.body, "bad_request\n");
    assert.equal(result.headers["x-stadtstack-receipt-sha256"], undefined);
  }
  assert.equal(reads, 0);

  const duplicateHost = await raw(port,
    `GET ${casePath} HTTP/1.1\r\nHost: ${HOST}\r\nHost: attacker.example\r\nConnection: close\r\n\r\n`);
  assert.match(duplicateHost, /^HTTP\/1\.1 400 /u);
  const paddedCredential = await raw(port,
    `GET ${casePath} HTTP/1.1\r\nHost: ${HOST}\r\n${Array.from({ length: 40 }, (_, index) => `X-Pad-${index}: x\r\n`).join("")}Cookie: session=secret\r\nConnection: close\r\n\r\n`);
  assert.match(paddedCredential, /^HTTP\/1\.1 400 /u);
  assert.equal(reads, 0);

  const method = await request(port, { method: "POST" });
  assert.equal(method.status, 405);
  assert.equal(method.headers.allow, "GET, HEAD");
  assert.equal(method.body, "method_not_allowed\n");
  assert.equal(reads, 0);

  for (const path of [
    "/v1/public/case-bindings/unknown",
    `${casePath}/`,
    "/v1/public/case-bindings/by-discussion/ABC",
    "/v1/public/case-bindings//" + CASE_ID,
  ]) {
    const result = await request(port, { path });
    assert.equal(result.status, 404);
    assert.equal(result.body, "not_found\n");
  }
});

test("configuration accepts precisely a two-method read capability and captures it", async (t) => {
  const value = receipt();
  const capability = reader(value) as PublicCaseBindingReader & { respond?: () => unknown };
  capability.respond = () => { throw new Error("must_not_call"); };
  assert.throws(
    () => createPublicCaseBindingServer({ allowedHosts: [HOST], reader: capability }),
    /public_case_binding_server_reader_invalid/u,
  );
  assert.throws(
    () => createPublicCaseBindingServer({ allowedHosts: [HOST], reader: new Proxy(reader(value), {}) }),
    /public_case_binding_server_reader_invalid/u,
  );
  assert.throws(
    () => createPublicCaseBindingServer({ allowedHosts: [HOST, HOST], reader: reader(value) }),
    /public_case_binding_server_config_invalid/u,
  );
  assert.throws(
    () => createPublicCaseBindingServer(new Proxy({ allowedHosts: [HOST], reader: reader(value) }, {})),
    /public_case_binding_server_config_invalid/u,
  );

  const captured = reader(value);
  const transport = createPublicCaseBindingServer({ allowedHosts: [HOST], reader: captured });
  captured.get = () => { throw new Error("replacement must not run"); };
  captured.getByRootEventId = () => { throw new Error("replacement must not run"); };
  const port = await listen(transport.server);
  t.after(() => close(transport.server));
  assert.equal((await request(port)).status, 200);
  assert.equal((await request(port, { path: rootPath })).status, 200);
});

test("reader faults, forged receipts, and lookup mismatches are redacted as unavailable", async () => {
  const badReaders: readonly PublicCaseBindingReader[] = [
    {
      get() { throw new Error("top-secret database address"); },
      getByRootEventId() { throw new Error("top-secret database address"); },
    },
    {
      get() { return { ...receipt(), receiptChecksum: digest("forged") }; },
      getByRootEventId() { return { ...receipt(), receiptChecksum: digest("forged") }; },
    },
    {
      get() { return receipt("urn:stadtstack:case:municipality:roebel-mueritz:01983a00-0000-7000-8000-000000000002"); },
      getByRootEventId() { return receipt(CASE_ID, "d".repeat(64)); },
    },
  ];
  for (const invalidReader of badReaders) {
    const transport = createPublicCaseBindingServer({ allowedHosts: [HOST], reader: invalidReader });
    const port = await listen(transport.server);
    const result = await request(port);
    await close(transport.server);
    assert.equal(result.status, 503);
    assert.equal(result.body, "service_unavailable\n");
    assert.equal(result.body.includes("secret"), false);
    assert.equal(result.headers["x-stadtstack-receipt-sha256"], undefined);
  }
});
