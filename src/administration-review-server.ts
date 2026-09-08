import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  ADMINISTRATION_REVIEW_MAX_BODY_BYTES, ADMINISTRATION_REVIEW_PATH,
  type AdministrationReviewResponse, type AdministrationReviewService,
} from "./administration-review-service.ts";

function headerValues(request: IncomingMessage, name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) values.push(request.rawHeaders[index + 1]!);
  }
  return values;
}
function oneHeader(request: IncomingMessage, name: string): string | null {
  const values = headerValues(request, name);
  return values.length === 1 ? values[0]! : null;
}
function send(response: ServerResponse, result: AdministrationReviewResponse): void {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(result.status, { ...result.headers, "content-length": Buffer.byteLength(result.body),
    "connection": "close", "cross-origin-resource-policy": "same-origin" });
  response.end(result.body);
}
function reject(response: ServerResponse, status: AdministrationReviewResponse["status"], code: string): void {
  send(response, { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff" }, body: JSON.stringify({ error: code }) });
}
function readBody(request: IncomingMessage, length: number): Promise<string> {
  return new Promise((resolve, rejectPromise) => {
    const chunks: Buffer[] = [];
    let received = 0;
    const timeout = setTimeout(() => fail(), 2_000);
    const cleanup = () => {
      clearTimeout(timeout);
      request.removeListener("data", data);
      request.removeListener("end", end);
      request.removeListener("error", fail);
      request.removeListener("aborted", fail);
    };
    const fail = () => { cleanup(); request.resume(); rejectPromise(new Error("body_invalid")); };
    const data = (chunk: Buffer) => {
      received += chunk.length;
      if (received > length || received > ADMINISTRATION_REVIEW_MAX_BODY_BYTES) { fail(); return; }
      chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      if (received !== length) { rejectPromise(new Error("body_invalid")); return; }
      try { resolve(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { rejectPromise(new Error("body_invalid")); }
    };
    request.on("data", data);
    request.once("end", end);
    request.once("error", fail);
    request.once("aborted", fail);
  });
}

/** Unbound internal HTTP transport for an administrative gateway. Listener,
 * TLS/SSO, secret injection, origin and network policy belong to Operations.
 * Browser cookies, Origin, query aliases, encodings and oversized requests are
 * rejected; this is not a login endpoint or a public app route. */
export function createAdministrationReviewServer(config: {
  allowedHosts: readonly string[];
  service: AdministrationReviewService;
}) {
  if (!Array.isArray(config.allowedHosts) || config.allowedHosts.length === 0 || config.allowedHosts.length > 16 ||
    config.allowedHosts.some((host) => typeof host !== "string" ||
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[1-9][0-9]{0,4})?$/u.test(host))) {
    throw new Error("administration_review_server_config_invalid");
  }
  const hosts = new Set(config.allowedHosts);
  const respond = config.service.respond.bind(config.service);
  let active = 0;
  const server = createServer({ maxHeaderSize: 8_192, headersTimeout: 3_000, requestTimeout: 5_000 }, async (request, response) => {
    if (active >= 8) { reject(response, 500, "review_unavailable"); return; }
    active++;
    try {
      if (!hosts.has(oneHeader(request, "host") ?? "") ||
        ["cookie", "origin", "transfer-encoding", "content-encoding"].some((name) => headerValues(request, name).length > 0) ||
        headerValues(request, "authorization").length > 1) { reject(response, 400, "request_invalid"); return; }
      if (request.url !== ADMINISTRATION_REVIEW_PATH) { reject(response, 404, "not_found"); return; }
      if (request.method !== "GET" && request.method !== "POST") { reject(response, 405, "method_not_allowed"); return; }
      let body: string | null = null;
      if (request.method === "POST") {
        const length = oneHeader(request, "content-length");
        const contentType = oneHeader(request, "content-type");
        if (!length || !/^[1-9][0-9]*$/u.test(length) || !contentType ||
          !/^application\/json(?:; charset=utf-8)?$/u.test(contentType)) { reject(response, 400, "request_invalid"); return; }
        const bytes = Number(length);
        if (!Number.isSafeInteger(bytes) || bytes > ADMINISTRATION_REVIEW_MAX_BODY_BYTES) { reject(response, 413, "request_too_large"); return; }
        body = await readBody(request, bytes);
      } else if (headerValues(request, "content-length").length > 0) { reject(response, 400, "request_invalid"); return; }
      send(response, await respond({ method: request.method, path: request.url,
        authorization: oneHeader(request, "authorization"), body }));
    } catch {
      reject(response, 400, "request_invalid");
    } finally {
      active--;
      request.resume();
    }
  });
  server.maxConnections = 16;
  server.setTimeout(5_000, (socket) => socket.destroy());
  return server;
}
