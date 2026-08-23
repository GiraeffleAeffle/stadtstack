import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import { connect } from "node:net";
import test from "node:test";

import {
  createPublicCaseBindingReceipt,
  type PublicCaseBindingReceiptV1,
} from "../src/case-binding-projection.ts";
import type {
  CaseBindingOutboxEntryV1,
  CredentialFreeCaseBindingOutboxReader,
} from "../src/adapters/sqlite-atomic-topic-case-admission.ts";
import {
  CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_LIMIT,
  CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_PAGE_BYTES,
  createCredentialFreeCaseBindingOutboxServer,
  parseAndVerifyCredentialFreeCaseBindingOutboxPage,
  serializeCredentialFreeCaseBindingOutboxPage,
  verifyCredentialFreeCaseBindingOutboxPage,
} from "../src/credential-free-case-binding-outbox-server.ts";

const HOST = "case-control.staging.example";
const PATH = "/v1/internal/public-case-bindings/outbox";
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const hex = (value: number) => value.toString(16).padStart(64, "0");

function caseId(value: number): string {
  return `urn:stadtstack:case:test:roebel-mueritz:01983a00-0000-7000-8000-${value.toString(16).padStart(12, "0")}`;
}

function receipt(value: number, overrides: Readonly<{ caseId?: string; rootEventId?: string }> = {}): PublicCaseBindingReceiptV1 {
  const currentCaseId = overrides.caseId ?? caseId(value);
  const candidateEventId = hex(value + 100_000);
  return createPublicCaseBindingReceipt({
    rootEventId: overrides.rootEventId ?? hex(value),
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
    ] as const,
    journalHeadChecksum: digest(`journal-${value}`),
    admissionEventChecksum: digest(`journal-${value}`),
  });
}

function entry(sequence: number, value: PublicCaseBindingReceiptV1): CaseBindingOutboxEntryV1 {
  return Object.freeze({ sequence, receipt: structuredClone(value) });
}

function outbox(entries: readonly CaseBindingOutboxEntryV1[]): CredentialFreeCaseBindingOutboxReader {
  return Object.freeze({
    replay(input: { afterSequence?: number; limit?: number } = {}) {
      const after = input.afterSequence ?? 0;
      const limit = input.limit ?? 100;
      return Object.freeze(entries.filter((value) => value.sequence > after).slice(0, limit).map((value) =>
        Object.freeze({ sequence: value.sequence, receipt: structuredClone(value.receipt) })));
    },
  });
}

type HttpResult = { status: number; headers: IncomingHttpHeaders; body: string };

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close((error) => error ? reject(error) : resolve());
  });
}

function request(port: number, input: Readonly<{
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
}> = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const client = httpRequest({
      host: "127.0.0.1",
      port,
      method: input.method ?? "GET",
      path: input.path ?? `${PATH}?afterSequence=0&limit=2`,
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

test("the private route returns empty, gapped, bounded canonical pages", async (t) => {
  const first = entry(2, receipt(1));
  const second = entry(7, receipt(2));
  const transport = createCredentialFreeCaseBindingOutboxServer({ allowedHosts: [HOST], outbox: outbox([first, second]) });
  assert.deepEqual(Object.keys(transport), ["server"]);
  const port = await listen(transport.server);
  t.after(() => close(transport.server));

  const result = await request(port);
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), {
    schemaVersion: "public_case_binding_outbox_page_v1",
    afterSequence: 0,
    nextSequence: 7,
    entries: [first, second],
  });
  assert.equal(result.body, serializeCredentialFreeCaseBindingOutboxPage(JSON.parse(result.body)));
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(result.headers["x-content-type-options"], "nosniff");
  assert.equal(result.headers["cross-origin-resource-policy"], "same-origin");
  assert.equal(result.headers["access-control-allow-origin"], undefined);
  assert.equal(result.headers["set-cookie"], undefined);
  assert.equal(result.headers["content-length"], String(Buffer.byteLength(result.body)));

  const empty = await request(port, { path: `${PATH}?afterSequence=7&limit=1` });
  assert.equal(empty.status, 200);
  assert.deepEqual(JSON.parse(empty.body), {
    schemaVersion: "public_case_binding_outbox_page_v1",
    afterSequence: 7,
    nextSequence: null,
    entries: [],
  });
});

test("credentials, body, methods, aliases, and oversized targets fail before replay", async (t) => {
  let replayCalls = 0;
  const value = entry(1, receipt(1));
  const source = Object.freeze({
    replay(input: { afterSequence?: number; limit?: number } = {}) {
      replayCalls += 1;
      return outbox([value]).replay(input);
    },
  });
  const transport = createCredentialFreeCaseBindingOutboxServer({ allowedHosts: [HOST], outbox: source });
  const port = await listen(transport.server);
  t.after(() => close(transport.server));

  const results = await Promise.all([
    request(port, { headers: { authorization: "Bearer secret" } }),
    request(port, { headers: { "proxy-authorization": "Basic secret" } }),
    request(port, { headers: { cookie: "session=secret" } }),
    request(port, { headers: { "content-length": "1" }, body: "x" }),
    request(port, { headers: { "content-encoding": "gzip" } }),
    request(port, { headers: { "transfer-encoding": "chunked" } }),
    request(port, { method: "POST" }),
    request(port, { path: PATH }),
    request(port, { path: `${PATH}?limit=1&afterSequence=0` }),
    request(port, { path: `${PATH}?afterSequence=00&limit=1` }),
    request(port, { path: `${PATH}?afterSequence=0&limit=01` }),
    request(port, { path: `${PATH}?afterSequence=0&limit=257` }),
    request(port, { path: `${PATH}?afterSequence=0&limit=1&extra=1` }),
    request(port, { path: `${PATH}?afterSequence=0&limit=1%20` }),
    request(port, { path: `${PATH}?afterSequence=0&limit=1${"x".repeat(600)}` }),
  ]);
  assert.ok(results.every((result) => result.status !== 200));
  assert.equal(replayCalls, 0);

  const duplicateHost = await raw(port,
    `GET ${PATH}?afterSequence=0&limit=1 HTTP/1.1\r\nHost: ${HOST}\r\nHost: attacker.example\r\nConnection: close\r\n\r\n`);
  assert.match(duplicateHost, /^HTTP\/1\.1 400 /u);
  assert.equal(replayCalls, 0);

  const paddedCookie = await raw(port,
    `GET ${PATH}?afterSequence=0&limit=1 HTTP/1.1\r\nHost: ${HOST}\r\n${Array.from({ length: 40 }, (_, index) => `X-Pad-${index}: x\r\n`).join("")}Cookie: session=secret\r\nConnection: close\r\n\r\n`);
  assert.match(paddedCookie, /^HTTP\/1\.1 400 /u);
  assert.equal(replayCalls, 0);
});

test("replay corruption, conflicts, oversized pages, and dependency faults are redacted", async (t) => {
  const first = entry(1, receipt(1));
  let mode: "normal" | "throw" | "forged" | "non-increasing" | "duplicate" | "conflict" | "oversized" = "normal";
  const source: CredentialFreeCaseBindingOutboxReader = Object.freeze({
    replay(input: { afterSequence?: number; limit?: number } = {}) {
      if (mode === "throw") throw new Error("private sqlite path must not escape");
      if ((input.afterSequence ?? 0) === 0) return Object.freeze([first]);
      if (mode === "forged") return Object.freeze([{ sequence: 2, receipt: { ...first.receipt, receiptChecksum: digest("forged") } }]);
      if (mode === "non-increasing") return Object.freeze([{ sequence: 1, receipt: receipt(2) }]);
      if (mode === "duplicate") return Object.freeze([{ sequence: 2, receipt: first.receipt }, { sequence: 3, receipt: first.receipt }]);
      if (mode === "conflict") return Object.freeze([{ sequence: 2, receipt: receipt(2, { caseId: first.receipt.caseId }), }, { sequence: 3, receipt: receipt(3, { caseId: first.receipt.caseId }), }]);
      if (mode === "oversized") return Object.freeze(Array.from({ length: (input.limit ?? 1) + 1 }, (_, index) => entry(index + 2, receipt(index + 2))));
      return Object.freeze([]);
    },
  });
  const transport = createCredentialFreeCaseBindingOutboxServer({ allowedHosts: [HOST], outbox: source });
  const port = await listen(transport.server);
  t.after(() => close(transport.server));

  for (const fault of ["throw", "forged", "non-increasing", "duplicate", "conflict", "oversized"] as const) {
    mode = fault;
    const response = await request(port, { path: `${PATH}?afterSequence=1&limit=2` });
    assert.equal(response.status, 503, fault);
    assert.equal(response.body, "service_unavailable\n");
    assert.equal(response.headers["x-stadtstack-receipt-sha256"], undefined);
    assert.equal(response.body.includes("sqlite"), false);
  }

  const good = await request(port, { path: `${PATH}?afterSequence=0&limit=1` });
  assert.equal(good.status, 200);

  assert.throws(() => createCredentialFreeCaseBindingOutboxServer({
    allowedHosts: [HOST],
    outbox: new Proxy({ replay: () => [] }, {}),
  }), /outbox_invalid/u);
  const accessor: Record<string, unknown> = {};
  Object.defineProperty(accessor, "replay", { enumerable: true, get: () => { throw new Error("must not execute"); } });
  assert.throws(() => createCredentialFreeCaseBindingOutboxServer({ allowedHosts: [HOST], outbox: accessor as CredentialFreeCaseBindingOutboxReader }), /outbox_invalid/u);
  const sparse = new Array(4_000_000_000);
  assert.throws(() => verifyCredentialFreeCaseBindingOutboxPage({
    schemaVersion: "public_case_binding_outbox_page_v1",
    afterSequence: 0,
    nextSequence: null,
    entries: sparse,
  }), /(page|replay)_invalid/u);
});

test("page verifier enforces checksums, cursors, exact shape, sparse bounds, and response size", () => {
  const value = {
    schemaVersion: "public_case_binding_outbox_page_v1" as const,
    afterSequence: 3,
    nextSequence: 7,
    entries: [entry(7, receipt(1))],
  };
  assert.deepEqual(verifyCredentialFreeCaseBindingOutboxPage(value), value);
  const forged = structuredClone(value);
  forged.entries[0]!.receipt.receiptChecksum = digest("forged");
  assert.throws(() => verifyCredentialFreeCaseBindingOutboxPage(forged), /receipt/u);
  assert.throws(() => verifyCredentialFreeCaseBindingOutboxPage({ ...value, nextSequence: 3 }), /cursor/u);
  assert.throws(() => verifyCredentialFreeCaseBindingOutboxPage({ ...value, extra: false } as unknown), /page_invalid/u);
  assert.throws(() => verifyCredentialFreeCaseBindingOutboxPage(value, { expectedAfterSequence: 2 }), /cursor/u);
  assert.throws(() => verifyCredentialFreeCaseBindingOutboxPage(value, { requestedLimit: CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_LIMIT + 1 }), /page_invalid/u);

  const hugeEntries = Array.from({ length: CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_LIMIT }, (_, index) => entry(index + 1, receipt(index + 1)));
  const huge = {
    schemaVersion: "public_case_binding_outbox_page_v1" as const,
    afterSequence: 0,
    nextSequence: CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_LIMIT,
    entries: hugeEntries,
  };
  const serialized = serializeCredentialFreeCaseBindingOutboxPage(huge);
  assert.ok(Buffer.byteLength(serialized) < CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_PAGE_BYTES);
  assert.deepEqual(parseAndVerifyCredentialFreeCaseBindingOutboxPage(serialized), huge);
  assert.deepEqual(parseAndVerifyCredentialFreeCaseBindingOutboxPage(new TextEncoder().encode(serialized)), huge);
  assert.throws(() => parseAndVerifyCredentialFreeCaseBindingOutboxPage(serialized.replace("\n", " \n")), /noncanonical/u);
  assert.throws(() => parseAndVerifyCredentialFreeCaseBindingOutboxPage(`${serialized}x`), /invalid|noncanonical/u);
  assert.throws(() => verifyCredentialFreeCaseBindingOutboxPage({
    schemaVersion: "public_case_binding_outbox_page_v1",
    afterSequence: 0,
    nextSequence: null,
    entries: Array.from({ length: CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_LIMIT + 1 }, (_, index) => entry(index + 1, receipt(index + 1))),
  }), /(page|replay)_invalid/u);
});
