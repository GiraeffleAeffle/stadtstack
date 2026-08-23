import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { types as utilTypes } from "node:util";

import {
  verifyPublicCaseBindingReceipt,
  type PublicCaseBindingReceiptV1,
} from "./case-binding-projection.ts";

/**
 * The public transport is deliberately narrower than CaseBindingProjectionReader:
 * it cannot use the projection's convenience responder (or any writer) and has
 * no credential, admission, or Case-coordination capability.
 */
export type PublicCaseBindingReader = {
  get(caseId: string): PublicCaseBindingReceiptV1 | null;
  getByRootEventId(rootEventId: string): PublicCaseBindingReceiptV1 | null;
};

export type PublicCaseBindingServerConfig = {
  allowedHosts: readonly string[];
  reader: PublicCaseBindingReader;
};

export type PublicCaseBindingServer = { readonly server: Server };

const CASE_ID = /^urn:stadtstack:case:test:([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?):([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
const MAX_TARGET_BYTES = 512;
const MAX_HOST_BYTES = 253;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_ALLOWED_HOSTS = 16;
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*|(?:127\.){3}1|localhost)(?::[1-9][0-9]{0,4})?$/u;

type SerializedReceipt = { readonly body: string; readonly receiptChecksum: string };

function fail(code: string): never { throw new Error(code); }

function exactObject(value: unknown, keys: readonly string[], code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) {
    fail(code);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail(code);
  }
  return value as Record<string, unknown>;
}

function exactStringArray(value: unknown, code: string): readonly string[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    value.length === 0 || value.length > MAX_ALLOWED_HOSTS) fail(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" &&
    (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)))) fail(code);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable || typeof descriptor.value !== "string") {
      fail(code);
    }
  }
  return value as readonly string[];
}

function configuredHosts(value: unknown): ReadonlySet<string> {
  const hosts = exactStringArray(value, "public_case_binding_server_config_invalid");
  const configured = new Set<string>();
  for (const host of hosts) {
    if (Buffer.byteLength(host, "utf8") > MAX_HOST_BYTES || !HOST.test(host) || host !== host.toLowerCase() ||
      configured.has(host)) fail("public_case_binding_server_config_invalid");
    configured.add(host);
  }
  return configured;
}

function exactReader(value: unknown): { readonly get: PublicCaseBindingReader["get"]; readonly getByRootEventId: PublicCaseBindingReader["getByRootEventId"] } {
  const reader = exactObject(value, ["get", "getByRootEventId"], "public_case_binding_server_reader_invalid");
  if (typeof reader.get !== "function" || typeof reader.getByRootEventId !== "function") {
    fail("public_case_binding_server_reader_invalid");
  }
  return Object.freeze({
    get: reader.get as PublicCaseBindingReader["get"],
    getByRootEventId: reader.getByRootEventId as PublicCaseBindingReader["getByRootEventId"],
  });
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function serialize(receiptValue: unknown): SerializedReceipt {
  const receipt = verifyPublicCaseBindingReceipt(receiptValue);
  const body = `${canonical(receipt)}\n`;
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) fail("public_case_binding_response_too_large");
  return Object.freeze({ body, receiptChecksum: receipt.receiptChecksum });
}

function headers(status: 200 | 400 | 404 | 405 | 503, body: string, extra: Readonly<Record<string, string>> = {}): Readonly<Record<string, string>> {
  return Object.freeze({
    "cache-control": "no-store",
    "content-length": String(Buffer.byteLength(body, "utf8")),
    "content-type": status === 200 ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "cross-origin-resource-policy": "same-origin",
    "x-content-type-options": "nosniff",
    ...extra,
  });
}

function end(response: ServerResponse, status: 200 | 400 | 404 | 405 | 503, body: string, method: string, extra: Readonly<Record<string, string>> = {}): void {
  response.writeHead(status, headers(status, body, extra));
  response.end(method === "HEAD" ? undefined : body);
}

function rawHeaderValues(request: IncomingMessage, expectedName: string): readonly string[] {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === expectedName) {
      values.push(request.rawHeaders[index + 1] ?? "");
    }
  }
  return values;
}

function requestViolation(request: IncomingMessage, allowedHosts: ReadonlySet<string>): boolean {
  const hosts = rawHeaderValues(request, "host");
  const host = hosts.length === 1 ? hosts[0]! : "";
  if (Buffer.byteLength(host, "utf8") > MAX_HOST_BYTES || !allowedHosts.has(host)) return true;
  for (const name of ["authorization", "proxy-authorization", "cookie", "transfer-encoding"] as const) {
    if (rawHeaderValues(request, name).length > 0) return true;
  }
  const contentLengths = rawHeaderValues(request, "content-length");
  if (contentLengths.length > 1 || (contentLengths.length === 1 && contentLengths[0] !== "0")) return true;
  const target = request.url;
  if (typeof target !== "string" || Buffer.byteLength(target, "utf8") > MAX_TARGET_BYTES ||
    target.includes("?") || target.includes("#") || target.includes("%")) return true;
  return false;
}

function route(target: string): { readonly kind: "case" | "root"; readonly value: string } | null {
  const byDiscussion = /^\/v1\/public\/case-bindings\/by-discussion\/([0-9a-f]{64})$/u.exec(target);
  if (byDiscussion) return Object.freeze({ kind: "root", value: byDiscussion[1]! });
  const byCase = /^\/v1\/public\/case-bindings\/(urn:stadtstack:case:test:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?:[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u.exec(target);
  if (byCase && CASE_ID.test(byCase[1]!)) return Object.freeze({ kind: "case", value: byCase[1]! });
  return null;
}

/**
 * A transport-only public reader. It is deliberately not a composition root:
 * callers choose the loopback bind address and lifecycle for the returned Node
 * server. Every successful response is independently receipt-verified.
 */
export function createPublicCaseBindingServer(config: PublicCaseBindingServerConfig): PublicCaseBindingServer {
  const parsed = exactObject(config, ["allowedHosts", "reader"], "public_case_binding_server_config_invalid");
  const allowedHosts = configuredHosts(parsed.allowedHosts);
  const reader = exactReader(parsed.reader);

  const server = createServer({ maxHeaderSize: 8_192 }, (request: IncomingMessage, response: ServerResponse) => {
    const method = request.method ?? "";
    if (requestViolation(request, allowedHosts)) {
      end(response, 400, "bad_request\n", method);
      return;
    }
    if (method !== "GET" && method !== "HEAD") {
      end(response, 405, "method_not_allowed\n", method, { allow: "GET, HEAD" });
      return;
    }
    const matched = route(request.url!);
    if (!matched) {
      end(response, 404, "not_found\n", method);
      return;
    }
    try {
      const receiptValue = matched.kind === "case"
        ? reader.get(matched.value)
        : reader.getByRootEventId(matched.value);
      if (!receiptValue) {
        end(response, 404, "not_found\n", method);
        return;
      }
      const receipt = verifyPublicCaseBindingReceipt(receiptValue);
      if ((matched.kind === "case" && receipt.caseId !== matched.value) ||
        (matched.kind === "root" && receipt.rootEventId !== matched.value)) {
        fail("public_case_binding_reader_mismatch");
      }
      const serialized = serialize(receipt);
      end(response, 200, serialized.body, method, {
        etag: `"${serialized.receiptChecksum}"`,
        "x-stadtstack-receipt-sha256": serialized.receiptChecksum,
      });
    } catch {
      end(response, 503, "service_unavailable\n", method);
    }
  });

  // Bound parser and connection retention independently of the deployment
  // composition. `checkContinue` is fail-closed so this transport never reads
  // a request body.
  // Retain every header inside the parser's fixed byte budget. A count cap can
  // otherwise truncate a trailing Cookie, credential, or duplicate Host.
  server.maxHeadersCount = 0;
  server.headersTimeout = 5_000;
  server.requestTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  server.on("checkContinue", (request, response) => {
    end(response, 400, "bad_request\n", request.method ?? "");
  });

  return Object.freeze({ server });
}
