import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { types as utilTypes } from "node:util";

import type {
  CaseBindingOutboxEntryV1,
  CredentialFreeCaseBindingOutboxReader,
} from "./case-binding-outbox.ts";
import {
  CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_LIMIT,
  CREDENTIAL_FREE_CASE_BINDING_OUTBOX_PATH,
  serializeCredentialFreeCaseBindingOutboxPage,
  verifyCredentialFreeCaseBindingOutboxEntries,
  verifyCredentialFreeCaseBindingOutboxPage,
} from "./case-binding-outbox-wire.ts";
export {
  CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_LIMIT,
  CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_PAGE_BYTES,
  CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_PAGE_NODES,
  CREDENTIAL_FREE_CASE_BINDING_OUTBOX_PATH,
  parseAndVerifyCredentialFreeCaseBindingOutboxPage,
  parseCredentialFreeCaseBindingOutboxPage,
  serializeCredentialFreeCaseBindingOutboxPage,
  verifyCredentialFreeCaseBindingOutboxEntries,
  verifyCredentialFreeCaseBindingOutboxPage,
} from "./case-binding-outbox-wire.ts";
export type {
  CredentialFreeCaseBindingOutboxPageV1,
  CredentialFreeCaseBindingOutboxPageVerificationOptions,
} from "./case-binding-outbox-wire.ts";

/** A shorter alias for callers that only need the public page contract. */
export type PublicCaseBindingOutboxPageV1 = import("./case-binding-outbox-wire.ts").CredentialFreeCaseBindingOutboxPageV1;

export type CredentialFreeCaseBindingOutboxServerConfig = {
  allowedHosts: readonly string[];
  outbox: CredentialFreeCaseBindingOutboxReader;
};

export type CredentialFreeCaseBindingOutboxServer = {
  readonly server: Server;
};

const MAX_TARGET_BYTES = 512;
const MAX_HOST_BYTES = 253;
const MAX_ALLOWED_HOSTS = 16;
const MAX_HEADER_BYTES = 8_192;
const REQUEST_TIMEOUT_MS = 5_000;
const KEEP_ALIVE_TIMEOUT_MS = 1_000;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const HOST_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/u;
const STATIC_BAD_REQUEST = "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nCache-Control: no-store\r\nCross-Origin-Resource-Policy: same-origin\r\nContent-Length: 12\r\nContent-Type: text/plain; charset=utf-8\r\nX-Content-Type-Options: nosniff\r\n\r\nbad_request\n";

type Replay = (
  input: { afterSequence: number; limit: number },
) => readonly CaseBindingOutboxEntryV1[] | Promise<readonly CaseBindingOutboxEntryV1[]>;
function fail(code: string): never { throw new Error(code); }

function exactRecord(value: unknown, fields: readonly string[], code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" || !fields.includes(key))) {
    fail(code);
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail(code);
  }
  return value as Record<string, unknown>;
}

function configuredHost(value: string): boolean {
  const match = /^(.*?)(?::([1-9][0-9]{0,4}))?$/u.exec(value);
  if (!match || !match[1]) return false;
  const host = match[1]!;
  if (!HOST_NAME.test(host)) return false;
  return match[2] === undefined || Number(match[2]) <= 65_535;
}

function configuredHosts(value: unknown): ReadonlySet<string> {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < 1 || value.length > MAX_ALLOWED_HOSTS) fail("case_binding_outbox_server_config_invalid");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" &&
    (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)))) fail("case_binding_outbox_server_config_invalid");
  const hosts = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable || typeof descriptor.value !== "string") {
      fail("case_binding_outbox_server_config_invalid");
    }
    const host = descriptor.value;
    if (Buffer.byteLength(host, "utf8") === 0 || Buffer.byteLength(host, "utf8") > MAX_HOST_BYTES ||
      host !== host.toLowerCase() || !configuredHost(host) || hosts.has(host)) {
      fail("case_binding_outbox_server_config_invalid");
    }
    hosts.add(host);
  }
  return hosts;
}

function captureReplay(value: unknown): Replay {
  const parsed = exactRecord(value, ["replay"], "case_binding_outbox_server_outbox_invalid");
  const descriptor = Object.getOwnPropertyDescriptor(parsed, "replay");
  if (!descriptor || descriptor.get || descriptor.set || typeof descriptor.value !== "function" ||
    utilTypes.isProxy(descriptor.value)) fail("case_binding_outbox_server_outbox_invalid");
  return descriptor.value as Replay;
}

function rawHeaderValues(request: IncomingMessage, name: string): readonly string[] {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) values.push(request.rawHeaders[index + 1] ?? "");
  }
  return values;
}

function requestHeadersValid(request: IncomingMessage, allowedHosts: ReadonlySet<string>): boolean {
  const hosts = rawHeaderValues(request, "host");
  if (hosts.length !== 1 || Buffer.byteLength(hosts[0]!, "utf8") > MAX_HOST_BYTES || !allowedHosts.has(hosts[0]!)) return false;
  for (const name of ["authorization", "proxy-authorization", "cookie", "transfer-encoding", "content-encoding"] as const) {
    if (rawHeaderValues(request, name).length > 0) return false;
  }
  const contentLengths = rawHeaderValues(request, "content-length");
  if (contentLengths.length > 1 || (contentLengths.length === 1 && contentLengths[0] !== "0")) return false;
  return true;
}

function exactTarget(target: string): { afterSequence: number; limit: number } | null {
  if (Buffer.byteLength(target, "utf8") > MAX_TARGET_BYTES || target.includes("#") || target.includes("%")) return null;
  const match = new RegExp(`^${CREDENTIAL_FREE_CASE_BINDING_OUTBOX_PATH.replaceAll("/", "\\/")}\\?afterSequence=([^&]+)&limit=([^&]+)$`, "u").exec(target);
  if (!match || !DECIMAL.test(match[1]!) || !DECIMAL.test(match[2]!)) return null;
  const afterSequence = Number(match[1]);
  const limit = Number(match[2]);
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || !Number.isSafeInteger(limit) ||
    limit < 1 || limit > CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_LIMIT) return null;
  return Object.freeze({ afterSequence, limit });
}

function send(response: ServerResponse, status: number, body: string, extra: Readonly<Record<string, string>> = {}): void {
  if (response.writableEnded) return;
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": String(Buffer.byteLength(body, "utf8")),
    "content-type": status === 200 ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "cross-origin-resource-policy": "same-origin",
    "x-content-type-options": "nosniff",
    ...extra,
  });
  response.end(body);
}

function waitForAbsentBody(request: IncomingMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(() => reject(new Error("case_binding_outbox_body_timeout"))), REQUEST_TIMEOUT_MS);
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("aborted", onAborted);
      request.removeListener("error", onError);
      request.removeListener("timeout", onTimeout);
      callback();
    };
    const onData = (): void => {
      request.resume();
      finish(() => reject(new Error("case_binding_outbox_body_present")));
    };
    const onEnd = (): void => finish(resolve);
    const onAborted = (): void => finish(() => reject(new Error("case_binding_outbox_body_aborted")));
    const onError = (): void => finish(() => reject(new Error("case_binding_outbox_body_error")));
    const onTimeout = (): void => {
      request.resume();
      finish(() => reject(new Error("case_binding_outbox_body_timeout")));
    };
    request.setTimeout(REQUEST_TIMEOUT_MS);
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("aborted", onAborted);
    request.once("error", onError);
    request.once("timeout", onTimeout);
    request.resume();
  });
}

/**
 * Creates an unbound, credential-free private outbox server. The returned
 * object intentionally contains only the Node server; socket binding,
 * shutdown, TLS and private network policy belong to the deployment root.
 */
export function createCredentialFreeCaseBindingOutboxServer(
  config: CredentialFreeCaseBindingOutboxServerConfig,
): CredentialFreeCaseBindingOutboxServer {
  const parsed = exactRecord(config, ["allowedHosts", "outbox"], "case_binding_outbox_server_config_invalid");
  const allowedHosts = configuredHosts(parsed.allowedHosts);
  const replay = captureReplay(parsed.outbox);

  const server = createServer({ maxHeaderSize: MAX_HEADER_BYTES }, async (request, response) => {
    const target = request.url;
    if (typeof target !== "string" || Buffer.byteLength(target, "utf8") > MAX_TARGET_BYTES) {
      send(response, 400, "bad_request\n");
      return;
    }
    if (!requestHeadersValid(request, allowedHosts)) {
      send(response, 400, "bad_request\n");
      return;
    }
    if (request.method !== "GET") {
      send(response, 405, "method_not_allowed\n", { allow: "GET" });
      return;
    }
    const query = exactTarget(target);
    if (!query) {
      send(response, 404, "not_found\n");
      return;
    }
    try {
      await waitForAbsentBody(request);
    } catch {
      send(response, 400, "bad_request\n");
      return;
    }
    try {
      const replayed = await replay(Object.freeze({ afterSequence: query.afterSequence, limit: query.limit }));
      const entries = verifyCredentialFreeCaseBindingOutboxEntries(replayed, query.afterSequence, query.limit);
      const page = verifyCredentialFreeCaseBindingOutboxPage({
        schemaVersion: "public_case_binding_outbox_page_v1",
        afterSequence: query.afterSequence,
        nextSequence: entries.length === 0 ? null : entries[entries.length - 1]!.sequence,
        entries,
      }, { expectedAfterSequence: query.afterSequence, requestedLimit: query.limit });
      const body = serializeCredentialFreeCaseBindingOutboxPage(page);
      send(response, 200, body);
    } catch {
      // Replay failures, malformed receipts and oversize pages are deliberately
      // indistinguishable from an unavailable private source.
      send(response, 503, "service_unavailable\n");
    }
  });

  server.maxHeadersCount = 32;
  server.headersTimeout = REQUEST_TIMEOUT_MS;
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.on("checkContinue", (_request, response) => send(response, 400, "bad_request\n"));
  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end(STATIC_BAD_REQUEST);
  });
  return Object.freeze({ server });
}
