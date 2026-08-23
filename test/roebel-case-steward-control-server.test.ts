import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import test, { type TestContext } from "node:test";

import {
  createRoebelCaseStewardControlServer,
} from "../src/roebel-case-steward-control-server.ts";
import { createPublicCaseBindingReceipt } from "../src/case-binding-projection.ts";
import type {
  RoebelCaseStewardControlService,
  RoebelControlRequest,
  RoebelControlResponse,
} from "../src/roebel-control-service.ts";

const HOST = "case-steward.staging.roebel.app";
const PATH = "/v1/nostr/suggestions/admit";
const CASE_ID = "urn:stadtstack:case:test:roebel-mueritz:01983a00-0000-7000-8000-000000000001";
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const SUCCESS_RECEIPT = createPublicCaseBindingReceipt({
  rootEventId: "a".repeat(64),
  topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse",
  candidateId: `urn:stadtstack:signed-topic-suggestion:${"b".repeat(64)}`,
  candidateEventId: "b".repeat(64),
  sourceAnswerEventId: "c".repeat(64),
  caseId: CASE_ID,
  caseVersion: 3,
  caseEventIds: [
    `urn:stadtstack:case-event:${CASE_ID}:1`,
    `urn:stadtstack:case-event:${CASE_ID}:2`,
    `urn:stadtstack:case-event:${CASE_ID}:3`,
  ] as const,
  journalHeadChecksum: digest("journal"),
  admissionEventChecksum: digest("journal"),
});
const RECEIPT = SUCCESS_RECEIPT.receiptChecksum;
const SUCCESS_BODY = `${JSON.stringify(SUCCESS_RECEIPT)}\n`;

type ReceivedResponse = { status: number; headers: Record<string, string | string[] | undefined>; body: string };

function exactControl(
  responder: (request: RoebelControlRequest) => Promise<RoebelControlResponse>,
): RoebelCaseStewardControlService {
  return Object.freeze({ respond: responder });
}

async function listener(t: TestContext, control: RoebelCaseStewardControlService) {
  const transport = createRoebelCaseStewardControlServer({ allowedHosts: [HOST], control });
  await new Promise<void>((resolve, reject) => {
    transport.server.once("error", reject);
    transport.server.listen(0, "127.0.0.1", () => {
      transport.server.off("error", reject);
      resolve();
    });
  });
  t.after(async () => new Promise<void>((resolve, reject) =>
    transport.server.close((error) => error ? reject(error) : resolve())));
  const address = transport.server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

function request(
  port: number,
  options: {
    method?: string;
    path?: string;
    host?: string;
    authorization?: string;
    contentType?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<ReceivedResponse> {
  const body = options.body ?? JSON.stringify({ request: "ok" });
  const headers: Record<string, string> = {
    host: options.host ?? HOST,
    "content-type": options.contentType ?? "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(body, "utf8")),
    ...(options.authorization === undefined ? {} : { authorization: options.authorization }),
    ...options.headers,
  };
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({
      host: "127.0.0.1",
      port,
      path: options.path ?? PATH,
      method: options.method ?? "POST",
      headers,
    }, (incoming) => {
      const chunks: Uint8Array[] = [];
      incoming.on("data", (chunk: Buffer) => chunks.push(new Uint8Array(chunk)));
      incoming.on("end", () => resolve({
        status: incoming.statusCode ?? 0,
        headers: incoming.headers,
        body: new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(chunks.flatMap((chunk) => [...chunk]))),
      }));
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

function raw(port: number, chunks: readonly (string | Uint8Array)[], waitBeforeLastMs = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let result = "";
    socket.setEncoding("utf8");
    socket.once("error", reject);
    socket.on("data", (chunk: string) => { result += chunk; });
    socket.once("end", () => resolve(result));
    socket.once("connect", () => {
      const [first, ...rest] = chunks;
      socket.write(first ?? "");
      const sendRest = () => {
        for (const chunk of rest) socket.write(chunk);
        socket.end();
      };
      if (waitBeforeLastMs > 0) setTimeout(sendRest, waitBeforeLastMs);
      else sendRest();
    });
  });
}

function status(rawResponse: string): number {
  const match = /^HTTP\/1\.1 ([0-9]{3}) /u.exec(rawResponse);
  return Number(match?.[1] ?? 0);
}

test("only the exact staff POST route delegates opaque authorization and parsed JSON", async (t) => {
  const seen: RoebelControlRequest[] = [];
  const port = await listener(t, exactControl(async (input) => {
    seen.push(input);
    return {
      status: 200,
      headers: { "x-stadtstack-receipt-sha256": RECEIPT },
      body: SUCCESS_BODY,
    };
  }));
  const response = await request(port, { authorization: "opaque credential, not parsed", body: "{\"ok\":true}" });
  assert.equal(response.status, 200);
  assert.equal(response.body, SUCCESS_BODY);
  assert.equal(response.headers["x-stadtstack-receipt-sha256"], RECEIPT);
  assert.equal(response.headers["access-control-allow-origin"], undefined);
  assert.equal(response.headers["set-cookie"], undefined);
  assert.deepEqual(seen, [{
    method: "POST",
    path: PATH,
    authorization: "opaque credential, not parsed",
    body: { ok: true },
  }]);
});

test("route, method, host, headers, and authentication-shaped input fail before the control dependency", async (t) => {
  let calls = 0;
  const port = await listener(t, exactControl(async () => {
    calls += 1;
    return { status: 401, headers: {}, body: "case_steward_required\n" };
  }));
  assert.equal((await request(port, { method: "GET", authorization: "x" })).status, 405);
  assert.equal((await request(port, { method: "GET", authorization: "x" })).headers.allow, "POST");
  assert.equal((await request(port, { path: "/v1/public/case-bindings/anything", authorization: "x" })).status, 404);
  assert.equal((await request(port, { path: `${PATH}?x=1`, authorization: "x" })).status, 400);
  assert.equal((await request(port, { path: `${PATH}/`, authorization: "x" })).status, 400);
  assert.equal((await request(port, { host: "public.example", authorization: "x" })).status, 400);
  assert.equal((await request(port, { authorization: undefined })).status, 400);
  assert.equal((await request(port, { authorization: "x", contentType: "text/plain" })).status, 415);
  assert.equal((await request(port, { authorization: "x", headers: { "content-encoding": "gzip" } })).status, 400);
  assert.equal((await request(port, { authorization: "x", headers: { "content-length": "262145" } })).status, 413);
  const duplicateAuthorization = await raw(port, [
    `POST ${PATH} HTTP/1.1\r\nHost: ${HOST}\r\nAuthorization: first\r\nAuthorization: second\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`,
  ]);
  assert.equal(status(duplicateAuthorization), 400);
  const paddedDuplicateAuthorization = await raw(port, [
    `POST ${PATH} HTTP/1.1\r\nHost: ${HOST}\r\nAuthorization: first\r\n${Array.from({ length: 40 }, (_, index) => `X-Pad-${index}: x\r\n`).join("")}Authorization: second\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`,
  ]);
  assert.equal(status(paddedDuplicateAuthorization), 400);
  assert.equal(calls, 0);

  const denied = await request(port, { authorization: "not-a-steward" });
  assert.equal(denied.status, 401);
  assert.equal(denied.body, "case_steward_required\n");
  assert.equal(calls, 1);
});

test("chunked input is assembled once while malformed, deep, long, and oversized JSON never reach control", async (t) => {
  let calls = 0;
  const port = await listener(t, exactControl(async () => {
    calls += 1;
    return { status: 200, headers: { "x-stadtstack-receipt-sha256": RECEIPT }, body: SUCCESS_BODY };
  }));
  const body = "{\"nested\":[1,2,3]}";
  const chunked = await raw(port, [
    `POST ${PATH} HTTP/1.1\r\nHost: ${HOST}\r\nAuthorization: opaque\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body.slice(0, 5)}`,
    body.slice(5),
  ]);
  assert.equal(status(chunked), 200);
  assert.equal(calls, 1);

  const tooDeep = `${"[".repeat(33)}0${"]".repeat(33)}`;
  const tooLong = JSON.stringify("x".repeat(65_537));
  const manyNodes = `[${Array.from({ length: 10_001 }, () => "0").join(",")}]`;
  for (const bad of ["{", tooDeep, tooLong, manyNodes]) {
    const result = await request(port, { authorization: "opaque", body: bad });
    assert.equal(result.status, 400);
  }
  const invalidUtf8 = await raw(port, [
    `POST ${PATH} HTTP/1.1\r\nHost: ${HOST}\r\nAuthorization: opaque\r\nContent-Type: application/json\r\nContent-Length: 1\r\nConnection: close\r\n\r\n`,
    Uint8Array.of(0xff),
  ]);
  assert.equal(status(invalidUtf8), 400);
  assert.equal(calls, 1);
});

test("body timeout and dependency faults are bounded and redact internal error details", async (t) => {
  let dependencyMode: "throw" | "return" = "throw";
  const port = await listener(t, exactControl(async () => {
    if (dependencyMode === "throw") throw new Error("postgres://secret@internal.example/roebel");
    return { status: 500, headers: {}, body: "postgres://secret@internal.example/roebel\n" };
  }));
  const timeout = await raw(port, [
    `POST ${PATH} HTTP/1.1\r\nHost: ${HOST}\r\nAuthorization: opaque\r\nContent-Type: application/json\r\nContent-Length: 5\r\nConnection: close\r\n\r\n{`,
  ], 5_200);
  assert.equal(status(timeout), 408);
  assert.doesNotMatch(timeout, /secret|postgres|internal/u);

  const unavailable = await request(port, { authorization: "opaque" });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body, "control_unavailable\n");
  assert.doesNotMatch(unavailable.body, /secret|postgres|internal/u);
  dependencyMode = "return";
  const failed = await request(port, { authorization: "opaque" });
  assert.equal(failed.status, 500);
  assert.equal(failed.body, "control_failed\n");
  assert.doesNotMatch(failed.body, /secret|postgres|internal/u);
});

test("a malformed control response, proxy headers, arbitrary headers, or a forged success body never leaks", async (t) => {
  let mode: "missing" | "proxy" | "arbitrary" | "forged" = "missing";
  const proxyHeaders = new Proxy({}, { ownKeys() { throw new Error("must_not_run"); } });
  const port = await listener(t, exactControl(async () => {
    if (mode === "proxy") return { status: 200, headers: proxyHeaders, body: "secret\n" } as unknown as RoebelControlResponse;
    if (mode === "arbitrary") return { status: 200, headers: { "set-cookie": "secret=1", "x-stadtstack-receipt-sha256": RECEIPT }, body: "secret\n" };
    if (mode === "forged") return { status: 200, headers: { "x-stadtstack-receipt-sha256": RECEIPT }, body: "{\"accepted\":true}\n" };
    return { status: 200, headers: {}, body: "secret\n" };
  }));
  for (const next of ["missing", "proxy", "arbitrary", "forged"] as const) {
    mode = next;
    const response = await request(port, { authorization: "opaque" });
    assert.equal(response.status, 500);
    assert.equal(response.body, "control_response_invalid\n");
    assert.doesNotMatch(response.body, /secret|must_not_run/u);
  }
});

test("factory rejects hidden dependency methods and server exposes neither bind helpers nor public readers", () => {
  const control = Object.freeze({
    async respond() { return { status: 200, headers: {}, body: "{}\n" } as RoebelControlResponse; },
    coordinator() { throw new Error("must never be reached"); },
  });
  assert.throws(() => createRoebelCaseStewardControlServer({ allowedHosts: [HOST], control }));
  assert.throws(() => createRoebelCaseStewardControlServer({
    allowedHosts: [HOST, HOST],
    control: exactControl(async () => ({ status: 200, headers: {}, body: "{}\n" })),
  }));
  assert.throws(() => createRoebelCaseStewardControlServer({
    allowedHosts: Array.from({ length: 17 }, (_, index) => `control-${index}.example`),
    control: exactControl(async () => ({ status: 200, headers: {}, body: "{}\n" })),
  }), /config_invalid/u);
  const accessorHosts = [HOST];
  Object.defineProperty(accessorHosts, "0", {
    enumerable: true,
    get: () => { throw new Error("must not execute accessor"); },
  });
  assert.throws(() => createRoebelCaseStewardControlServer({
    allowedHosts: accessorHosts,
    control: exactControl(async () => ({ status: 200, headers: {}, body: "{}\n" })),
  }), /config_invalid/u);
  const portHost = `${HOST}:8443`;
  assert.doesNotThrow(() => createRoebelCaseStewardControlServer({
    allowedHosts: [portHost],
    control: exactControl(async () => ({ status: 200, headers: {}, body: "{}\n" })),
  }));
  const transport = createRoebelCaseStewardControlServer({
    allowedHosts: [HOST],
    control: exactControl(async () => ({ status: 200, headers: {}, body: "{}\n" })),
  });
  assert.deepEqual(Object.keys(transport), ["server"]);
  assert.equal("listen" in transport, false);
  assert.equal("close" in transport, false);
  assert.equal("reader" in transport, false);
});
