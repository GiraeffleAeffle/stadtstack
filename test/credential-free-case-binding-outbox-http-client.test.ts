import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import test from "node:test";

import {
  createPublicCaseBindingReceipt,
  type PublicCaseBindingReceiptV1,
} from "../src/case-binding-projection.ts";
import type {
  CaseBindingOutboxEntryV1,
  CredentialFreeCaseBindingOutboxReader,
} from "../src/case-binding-outbox.ts";
import {
  createCredentialFreeCaseBindingOutboxHttpClient,
} from "../src/credential-free-case-binding-outbox-http-client.ts";
import {
  createCredentialFreeCaseBindingOutboxServer,
  serializeCredentialFreeCaseBindingOutboxPage,
} from "../src/credential-free-case-binding-outbox-server.ts";

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

function outbox(entries: readonly CaseBindingOutboxEntryV1[]): CredentialFreeCaseBindingOutboxReader {
  return Object.freeze({
    replay(input: { afterSequence?: number; limit?: number } = {}) {
      const after = input.afterSequence ?? 0;
      const limit = input.limit ?? 256;
      return Object.freeze(entries.filter((value) => value.sequence > after).slice(0, limit).map((value) =>
        Object.freeze({ sequence: value.sequence, receipt: structuredClone(value.receipt) })));
    },
  });
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("the HTTP client issues one credential-free exact request and verifies a private server page", async (t) => {
  const entries = [entry(2, receipt(1)), entry(7, receipt(2))] as const;
  const transport = createCredentialFreeCaseBindingOutboxServer({ allowedHosts: ["127.0.0.1"], outbox: outbox(entries) });
  const port = await listen(transport.server);
  t.after(() => close(transport.server));

  const client = createCredentialFreeCaseBindingOutboxHttpClient({ origin: `http://127.0.0.1:${port}/` });
  assert.deepEqual(Object.keys(client), ["replay"]);
  assert.equal(Object.isFrozen(client), true);
  assert.deepEqual(await client.replay(), entries);
  assert.deepEqual(await client.replay({ limit: 1 }), [entries[0]]);
  assert.deepEqual(await client.replay({ afterSequence: 2 }), [entries[1]]);
  assert.deepEqual(await client.replay({ afterSequence: 0, limit: 1 }), [entries[0]]);
  assert.deepEqual(await client.replay({ afterSequence: 2, limit: 2 }), [entries[1]]);
  assert.deepEqual(await client.replay({ afterSequence: 7, limit: 2 }), []);
});

test("the client rejects malformed configuration and caller-supplied request capabilities", async () => {
  assert.throws(() => createCredentialFreeCaseBindingOutboxHttpClient({ origin: "https://case-control.internal:8080/" }), /config_invalid/u);
  assert.throws(() => createCredentialFreeCaseBindingOutboxHttpClient({ origin: "http://user:secret@case-control.internal:8080/" }), /config_invalid/u);
  assert.throws(() => createCredentialFreeCaseBindingOutboxHttpClient({ origin: "http://case-control.internal:8080/other" }), /config_invalid/u);
  assert.throws(() => createCredentialFreeCaseBindingOutboxHttpClient({ origin: "http://case-control.internal:8080/?afterSequence=0" }), /config_invalid/u);
  const client = createCredentialFreeCaseBindingOutboxHttpClient({ origin: "http://case-control.internal:8080/" });
  await assert.rejects(client.replay({ afterSequence: -1, limit: 1 }), /request_invalid/u);
  await assert.rejects(client.replay({ afterSequence: 0, limit: 257 }), /request_invalid/u);
  await assert.rejects(client.replay({ afterSequence: 0, limit: 1, authorization: "Bearer secret" } as unknown as { afterSequence: number; limit: number }), /request_invalid/u);
});

type ResponseMode = "status" | "type" | "encoding" | "transfer" | "duplicate-length" | "oversized" | "truncated" | "wrong-cursor" | "invalid-page";

test("noncanonical, encoded, redirected-equivalent, or malformed upstream responses fail closed without leaking details", async (t) => {
  const value = entry(1, receipt(1));
  let mode: ResponseMode = "status";
  const server = createServer((request, response) => {
    assert.equal(request.method, "GET");
    assert.equal(request.url, "/v1/internal/public-case-bindings/outbox?afterSequence=0&limit=1");
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.cookie, undefined);
    assert.equal(request.headers["proxy-authorization"], undefined);
    const pageEntry = mode === "wrong-cursor" ? entry(2, receipt(2)) : value;
    const page = serializeCredentialFreeCaseBindingOutboxPage({
      schemaVersion: "public_case_binding_outbox_page_v1",
      afterSequence: mode === "wrong-cursor" ? 1 : 0,
      nextSequence: pageEntry.sequence,
      entries: [pageEntry],
    });
    if (mode === "status") {
      response.writeHead(302, { location: "http://private.sqlite.invalid/secret", "content-length": "0" });
      response.end();
      return;
    }
    if (mode === "type") {
      response.writeHead(200, { "content-type": "text/plain", "content-length": String(Buffer.byteLength(page)) });
      response.end(page);
      return;
    }
    if (mode === "encoding" || mode === "transfer") {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-length": String(Buffer.byteLength(page)),
        [mode === "encoding" ? "content-encoding" : "transfer-encoding"]: mode === "encoding" ? "gzip" : "chunked",
      });
      response.end(page);
      return;
    }
    if (mode === "duplicate-length") {
      response.writeHead(200, [
        "content-type", "application/json; charset=utf-8",
        "content-length", String(Buffer.byteLength(page)),
        "content-length", String(Buffer.byteLength(page)),
      ]);
      response.end(page);
      return;
    }
    if (mode === "oversized") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-length": "1048577" });
      response.end();
      return;
    }
    if (mode === "truncated") {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-length": String(Buffer.byteLength(page) + 1),
      });
      response.end(page);
      return;
    }
    if (mode === "invalid-page") {
      const invalid = "private database detail\n";
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-length": String(Buffer.byteLength(invalid)) });
      response.end(invalid);
      return;
    }
    response.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-length": String(Buffer.byteLength(page)) });
    response.end(page);
  });
  const port = await listen(server);
  t.after(() => close(server));
  const client = createCredentialFreeCaseBindingOutboxHttpClient({ origin: `http://127.0.0.1:${port}/` });

  for (const candidate of ["status", "type", "encoding", "transfer", "duplicate-length", "oversized", "truncated", "wrong-cursor", "invalid-page"] as const) {
    mode = candidate;
    await assert.rejects(client.replay({ afterSequence: 0, limit: 1 }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "case_binding_outbox_transport_unavailable");
      assert.doesNotMatch(error.message, /private|sqlite|secret/u);
      return true;
    });
  }
});
