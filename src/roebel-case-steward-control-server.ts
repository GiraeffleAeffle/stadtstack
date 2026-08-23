import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { types as utilTypes } from "node:util";

import type {
  RoebelCaseStewardControlService,
  RoebelControlResponse,
} from "./roebel-control-service.ts";
import { verifyPublicCaseBindingReceipt } from "./case-binding-projection.ts";

export type RoebelCaseStewardControlServerConfig = {
  allowedHosts: readonly string[];
  control: RoebelCaseStewardControlService;
};

export type RoebelCaseStewardControlServer = {
  readonly server: Server;
};

const ADMISSION_PATH = "/v1/nostr/suggestions/admit";
const MAX_TARGET_BYTES = 256;
const MAX_HOST_BYTES = 253;
const MAX_BODY_BYTES = 262_144;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 10_000;
const MAX_JSON_STRING_BYTES = 65_536;
const BODY_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 262_144;
const MAX_ALLOWED_HOSTS = 16;
const RECEIPT_SHA256 = /^sha256:[0-9a-f]{64}$/u;
const HOST_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/u;
const CONTROL_HEADER_NAMES = new Set([
  "allow",
  "cache-control",
  "content-length",
  "content-type",
  "x-content-type-options",
  "x-stadtstack-receipt-sha256",
]);

type ErrorStatus = 400 | 404 | 405 | 408 | 413 | 415 | 500 | 503;

function exactObject(value: unknown, fields: readonly string[], code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) throw new Error(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" || !fields.includes(key))) {
    throw new Error(code);
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) throw new Error(code);
  }
  return value as Record<string, unknown>;
}

function exactStringArray(value: unknown, code: string): readonly string[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    value.length === 0 || value.length > MAX_ALLOWED_HOSTS) throw new Error(code);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || ownKeys.some((key) =>
    key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)))) throw new Error(code);
  const hosts: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) throw new Error(code);
    const host = descriptor.value;
    if (typeof host !== "string" ||
      Buffer.byteLength(host, "utf8") === 0 || Buffer.byteLength(host, "utf8") > MAX_HOST_BYTES ||
      host !== host.toLowerCase() || !configuredHost(host)) throw new Error(code);
    hosts.push(host);
  }
  if (new Set(hosts).size !== hosts.length) throw new Error(code);
  return Object.freeze(hosts);
}

function configuredHost(value: string): boolean {
  const match = /^(.*?)(?::([1-9][0-9]{0,4}))?$/u.exec(value);
  if (!match || !HOST_NAME.test(match[1]!)) return false;
  return match[2] === undefined || Number(match[2]) <= 65_535;
}

function exactControl(value: unknown): (request: Parameters<RoebelCaseStewardControlService["respond"]>[0]) => ReturnType<RoebelCaseStewardControlService["respond"]> {
  const parsed = exactObject(value, ["respond"], "roebel_control_server_config_invalid");
  if (typeof parsed.respond !== "function") throw new Error("roebel_control_server_config_invalid");
  return parsed.respond as (request: Parameters<RoebelCaseStewardControlService["respond"]>[0]) => ReturnType<RoebelCaseStewardControlService["respond"]>;
}

function rawHeaders(request: IncomingMessage, name: string): readonly string[] {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) values.push(request.rawHeaders[index + 1] ?? "");
  }
  return values;
}

function oneHeader(request: IncomingMessage, name: string): string | null {
  const values = rawHeaders(request, name);
  return values.length === 1 ? values[0]! : null;
}

function send(serverResponse: ServerResponse, status: number, body: string, extraHeaders: Readonly<Record<string, string>> = {}): void {
  if (serverResponse.writableEnded) return;
  const headers: Record<string, string> = {
    "cache-control": "no-store",
    "content-length": String(Buffer.byteLength(body, "utf8")),
    "content-type": status === 200 ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "cross-origin-resource-policy": "same-origin",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  };
  serverResponse.writeHead(status, headers);
  serverResponse.end(body);
}

function reject(serverResponse: ServerResponse, status: ErrorStatus, body: string, extraHeaders: Readonly<Record<string, string>> = {}): void {
  send(serverResponse, status, body, extraHeaders);
}

function pathIsExact(rawTarget: string): boolean {
  return rawTarget.length <= MAX_TARGET_BYTES && rawTarget === ADMISSION_PATH &&
    !/[?#%]/u.test(rawTarget);
}

function pathFailureStatus(rawTarget: string): 400 | 404 {
  return rawTarget.length > MAX_TARGET_BYTES || rawTarget.startsWith(`${ADMISSION_PATH}?`) ||
    rawTarget.startsWith(`${ADMISSION_PATH}#`) || rawTarget.startsWith(`${ADMISSION_PATH}%`) ||
    rawTarget.startsWith(`${ADMISSION_PATH}/`)
    ? 400
    : 404;
}

function contentTypeIsJson(value: string | null): boolean {
  return value !== null && /^application\/json(?:[ \t]*;[ \t]*charset=utf-8)?$/u.test(value);
}

function contentLength(value: string | null): number | "invalid" | "too_large" {
  if (value === null || !/^[1-9][0-9]*$/u.test(value)) return "invalid";
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return "invalid";
  return parsed > MAX_BODY_BYTES ? "too_large" : parsed;
}

function parseJsonBody(value: string): unknown {
  const parsed = JSON.parse(value) as unknown;
  const work: Array<{ value: unknown; depth: number }> = [{ value: parsed, depth: 0 }];
  let nodes = 0;
  while (work.length > 0) {
    const current = work.pop()!;
    nodes += 1;
    if (nodes > MAX_JSON_NODES || current.depth > MAX_JSON_DEPTH) throw new Error("json_limits_invalid");
    if (typeof current.value === "string") {
      if (Buffer.byteLength(current.value, "utf8") > MAX_JSON_STRING_BYTES) throw new Error("json_limits_invalid");
      continue;
    }
    if (current.value === null || typeof current.value === "boolean" || typeof current.value === "number") continue;
    if (Array.isArray(current.value)) {
      if (utilTypes.isProxy(current.value) || Object.getPrototypeOf(current.value) !== Array.prototype) {
        throw new Error("json_limits_invalid");
      }
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        work.push({ value: current.value[index], depth: current.depth + 1 });
      }
      continue;
    }
    if (!current.value || typeof current.value !== "object" || utilTypes.isProxy(current.value) ||
      Object.getPrototypeOf(current.value) !== Object.prototype) throw new Error("json_limits_invalid");
    for (const [key, entry] of Object.entries(current.value as Record<string, unknown>)) {
      if (Buffer.byteLength(key, "utf8") > MAX_JSON_STRING_BYTES) throw new Error("json_limits_invalid");
      work.push({ value: entry, depth: current.depth + 1 });
    }
  }
  return parsed;
}

function readBody(request: IncomingMessage, declaredLength: number): Promise<string> {
  return new Promise((resolve, rejectPromise) => {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      request.resume();
      rejectWith("body_timeout");
    }, BODY_TIMEOUT_MS);
    const finish = (callback: () => void) => {
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
    const rejectWith = (code: string) => finish(() => rejectPromise(new Error(code)));
    const onData = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES || bytes > declaredLength) {
        request.resume();
        rejectWith("body_too_large");
        return;
      }
      chunks.push(new Uint8Array(chunk));
    };
    const onEnd = () => {
      if (bytes !== declaredLength) return rejectWith("body_length_invalid");
      try {
        const joined = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) {
          joined.set(chunk, offset);
          offset += chunk.length;
        }
        const decoded = new TextDecoder("utf-8", { fatal: true }).decode(joined);
        finish(() => resolve(decoded));
      } catch {
        rejectWith("body_encoding_invalid");
      }
    };
    const onAborted = () => rejectWith("body_aborted");
    const onError = () => rejectWith("body_error");
    const onTimeout = () => {
      request.resume();
      rejectWith("body_timeout");
    };
    request.setTimeout(BODY_TIMEOUT_MS);
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("aborted", onAborted);
    request.once("error", onError);
    request.once("timeout", onTimeout);
  });
}

function controlHeaders(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) throw new Error("roebel_control_server_response_invalid");
  const keys = Reflect.ownKeys(value);
  if (keys.length > CONTROL_HEADER_NAMES.size || keys.some((key) =>
    typeof key !== "string" || !CONTROL_HEADER_NAMES.has(key))) {
    throw new Error("roebel_control_server_response_invalid");
  }
  let receiptChecksum: string | null = null;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable || typeof descriptor.value !== "string") {
      throw new Error("roebel_control_server_response_invalid");
    }
    if (key === "x-stadtstack-receipt-sha256") {
      if (!RECEIPT_SHA256.test(descriptor.value)) throw new Error("roebel_control_server_response_invalid");
      receiptChecksum = descriptor.value;
    }
  }
  return receiptChecksum;
}

function controlResult(value: unknown): { status: number; body: string; receiptChecksum: string | null } {
  const parsed = exactObject(value, ["status", "headers", "body"], "roebel_control_server_response_invalid");
  if (typeof parsed.status !== "number" || !Number.isInteger(parsed.status) ||
    ![200, 400, 401, 404, 405, 409, 500].includes(parsed.status) || typeof parsed.body !== "string" ||
    Buffer.byteLength(parsed.body, "utf8") > MAX_RESPONSE_BYTES) throw new Error("roebel_control_server_response_invalid");
  const receiptChecksum = controlHeaders(parsed.headers);
  if (parsed.status === 200 && receiptChecksum === null) {
    throw new Error("roebel_control_server_response_invalid");
  }
  if (parsed.status === 200) {
    let receipt;
    try { receipt = verifyPublicCaseBindingReceipt(JSON.parse(parsed.body)); }
    catch { throw new Error("roebel_control_server_response_invalid"); }
    if (receipt.receiptChecksum !== receiptChecksum) throw new Error("roebel_control_server_response_invalid");
    return { status: parsed.status, body: `${JSON.stringify(receipt)}\n`, receiptChecksum };
  }
  if (receiptChecksum !== null) throw new Error("roebel_control_server_response_invalid");
  return { status: parsed.status, body: parsed.body, receiptChecksum: null };
}

/**
 * Narrow staff-only HTTP transport. It contains no public reader, durable
 * store, coordinator, retry queue, or listener lifecycle helpers; deployment
 * composition owns binding and shutdown.
 */
export function createRoebelCaseStewardControlServer(
  config: RoebelCaseStewardControlServerConfig,
): RoebelCaseStewardControlServer {
  const parsed = exactObject(config, ["allowedHosts", "control"], "roebel_control_server_config_invalid");
  const allowedHosts = new Set(exactStringArray(parsed.allowedHosts, "roebel_control_server_config_invalid"));
  const respond = exactControl(parsed.control);

  const server = createServer({ maxHeaderSize: 8_192 }, async (request, serverResponse) => {
    const rawTarget = request.url ?? "";
    if (!pathIsExact(rawTarget)) {
      const status = pathFailureStatus(rawTarget);
      return reject(serverResponse, status, status === 400 ? "bad_request\n" : "not_found\n");
    }
    if (request.method !== "POST") return reject(serverResponse, 405, "method_not_allowed\n", { allow: "POST" });

    const host = oneHeader(request, "host");
    if (host === null || Buffer.byteLength(host, "utf8") === 0 || Buffer.byteLength(host, "utf8") > MAX_HOST_BYTES ||
      !allowedHosts.has(host)) return reject(serverResponse, 400, "bad_request\n");
    const authorization = oneHeader(request, "authorization");
    if (authorization === null || authorization.length === 0 || Buffer.byteLength(authorization, "utf8") > 8_192) {
      return reject(serverResponse, 400, "bad_request\n");
    }
    if (rawHeaders(request, "content-encoding").length > 0 || rawHeaders(request, "transfer-encoding").length > 0) {
      return reject(serverResponse, 400, "bad_request\n");
    }
    if (!contentTypeIsJson(oneHeader(request, "content-type"))) return reject(serverResponse, 415, "unsupported_media_type\n");
    const declaredLength = contentLength(oneHeader(request, "content-length"));
    if (declaredLength === "too_large") return reject(serverResponse, 413, "body_too_large\n");
    if (declaredLength === "invalid") return reject(serverResponse, 400, "bad_request\n");

    let bodyText: string;
    try { bodyText = await readBody(request, declaredLength); }
    catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "body_timeout") return reject(serverResponse, 408, "request_timeout\n");
      if (code === "body_too_large") return reject(serverResponse, 413, "body_too_large\n");
      return reject(serverResponse, 400, "bad_request\n");
    }
    let body: unknown;
    try { body = parseJsonBody(bodyText); }
    catch { return reject(serverResponse, 400, "bad_request\n"); }

    let result: RoebelControlResponse;
    try { result = await respond({ method: "POST", path: ADMISSION_PATH, authorization, body }); }
    catch { return reject(serverResponse, 503, "control_unavailable\n"); }
    try {
      const safe = controlResult(result);
      if (safe.status !== 200) {
        const bodies: Readonly<Record<number, string>> = {
          400: "bad_request\n",
          401: "case_steward_required\n",
          404: "not_found\n",
          405: "method_not_allowed\n",
          409: "conflict\n",
          500: "control_failed\n",
        };
        return send(serverResponse, safe.status, bodies[safe.status]!);
      }
      const extra: Record<string, string> = {};
      if (safe.receiptChecksum) {
        extra["x-stadtstack-receipt-sha256"] = safe.receiptChecksum;
      }
      return send(serverResponse, safe.status, safe.body, extra);
    } catch {
      return reject(serverResponse, 500, "control_response_invalid\n");
    }
  });
  server.headersTimeout = BODY_TIMEOUT_MS;
  server.requestTimeout = BODY_TIMEOUT_MS + 1_000;
  server.keepAliveTimeout = 1_000;
  // The byte cap is the only parser bound. A count cap can silently truncate
  // raw headers and hide a trailing credential or duplicate security header.
  server.maxHeadersCount = 0;
  server.on("checkContinue", (_request, serverResponse) => {
    reject(serverResponse, 400, "bad_request\n");
  });
  server.on("clientError", (_error, socket) => {
    if (!socket.writable) return;
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 12\r\nContent-Type: text/plain; charset=utf-8\r\nX-Content-Type-Options: nosniff\r\n\r\nbad_request\n");
  });
  return Object.freeze({ server });
}
