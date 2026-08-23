import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { types as utilTypes } from "node:util";

/**
 * A deliberately capability-free view of a runtime lifecycle.  This is a
 * transport boundary: a probe may learn only whether a process is live and
 * ready; it cannot obtain the lifecycle, a listener address, or its detail.
 */
export type StagingRuntimeProbeHealth = () => Readonly<{
  phase: string;
  ready: boolean;
}>;

export type StagingRuntimeProbeServerConfig = Readonly<{
  allowedHosts: readonly string[];
  health: StagingRuntimeProbeHealth;
}>;

export type StagingRuntimeProbeServer = Readonly<{ server: Server }>;

const MAX_ALLOWED_HOSTS = 16;
const MAX_HEADER_BYTES = 8_192;
const MAX_HOST_BYTES = 253;
const MAX_TARGET_BYTES = 128;
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*|127\.0\.0\.1|localhost)(?::[1-9][0-9]{0,4})?$/u;
const LIVE_PATH = "/livez";
const READY_PATH = "/readyz";
const RUNTIME_PHASES: ReadonlySet<string> = new Set([
  "new",
  "starting",
  "ready",
  "degraded",
  "draining",
  "failed",
  "stopped",
]);

function invalid(code: string): never { throw new Error(code); }

function exactObject(value: unknown, keys: readonly string[], code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) invalid(code);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) {
    invalid(code);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) invalid(code);
  }
  return value as Record<string, unknown>;
}

function configuredHosts(value: unknown): ReadonlySet<string> {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    value.length === 0 || value.length > MAX_ALLOWED_HOSTS) invalid("staging_runtime_probe_server_config_invalid");
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || ownKeys.some((key) => key !== "length" &&
    (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)))) {
    invalid("staging_runtime_probe_server_config_invalid");
  }
  const hosts = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    const host = descriptor?.value;
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable || typeof host !== "string" ||
      Buffer.byteLength(host, "utf8") > MAX_HOST_BYTES || !HOST.test(host) || host !== host.toLowerCase() || hosts.has(host)) {
      invalid("staging_runtime_probe_server_config_invalid");
    }
    hosts.add(host);
  }
  return hosts;
}

function captureHealth(value: unknown): StagingRuntimeProbeHealth {
  if (typeof value !== "function" || utilTypes.isProxy(value)) {
    invalid("staging_runtime_probe_server_config_invalid");
  }
  return value as StagingRuntimeProbeHealth;
}

function rawHeaderValues(request: IncomingMessage, expectedName: string): readonly string[] {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === expectedName) values.push(request.rawHeaders[index + 1] ?? "");
  }
  return values;
}

function requestViolation(request: IncomingMessage, allowedHosts: ReadonlySet<string>): boolean {
  const hosts = rawHeaderValues(request, "host");
  const host = hosts.length === 1 ? hosts[0]! : "";
  if (Buffer.byteLength(host, "utf8") > MAX_HOST_BYTES || !allowedHosts.has(host)) return true;
  for (const name of ["authorization", "proxy-authorization", "cookie", "content-encoding", "transfer-encoding"] as const) {
    if (rawHeaderValues(request, name).length > 0) return true;
  }
  const lengths = rawHeaderValues(request, "content-length");
  if (lengths.length > 1 || (lengths.length === 1 && lengths[0] !== "0")) return true;
  const target = request.url;
  return typeof target !== "string" || Buffer.byteLength(target, "utf8") > MAX_TARGET_BYTES ||
    target.includes("?") || target.includes("#") || target.includes("%");
}

function healthSnapshot(health: StagingRuntimeProbeHealth): Readonly<{ phase: string; ready: boolean }> {
  const snapshot = exactObject(health(), ["phase", "ready"], "staging_runtime_probe_health_invalid");
  if (typeof snapshot.phase !== "string" || !RUNTIME_PHASES.has(snapshot.phase) ||
    typeof snapshot.ready !== "boolean" || snapshot.ready !== (snapshot.phase === "ready")) {
    invalid("staging_runtime_probe_health_invalid");
  }
  return Object.freeze({ phase: snapshot.phase, ready: snapshot.ready });
}

function headers(body: string, extra: Readonly<Record<string, string>> = {}): Readonly<Record<string, string>> {
  return Object.freeze({
    "cache-control": "no-store",
    "content-length": String(Buffer.byteLength(body, "utf8")),
    "content-type": "text/plain; charset=utf-8",
    "cross-origin-resource-policy": "same-origin",
    "x-content-type-options": "nosniff",
    ...extra,
  });
}

function end(response: ServerResponse, status: 200 | 400 | 404 | 405 | 503, body: string, method: string): void {
  response.writeHead(status, headers(body, status === 405 ? { allow: "GET, HEAD" } : {}));
  response.end(method === "HEAD" ? undefined : body);
}

/**
 * Create an unbound, credential-free probe server.  The caller alone chooses
 * its loopback listener and lifecycle.  The routes intentionally never reveal
 * phase, port, process identity, or error details.
 */
export function createStagingRuntimeProbeServer(config: StagingRuntimeProbeServerConfig): StagingRuntimeProbeServer {
  const parsed = exactObject(config, ["allowedHosts", "health"], "staging_runtime_probe_server_config_invalid");
  const allowedHosts = configuredHosts(parsed.allowedHosts);
  const health = captureHealth(parsed.health);

  const server = createServer({ maxHeaderSize: MAX_HEADER_BYTES }, (request, response) => {
    const method = request.method ?? "";
    if (requestViolation(request, allowedHosts)) {
      end(response, 400, "bad_request\n", method);
      return;
    }
    if (method !== "GET" && method !== "HEAD") {
      end(response, 405, "method_not_allowed\n", method);
      return;
    }
    const target = request.url!;
    if (target !== LIVE_PATH && target !== READY_PATH) {
      end(response, 404, "not_found\n", method);
      return;
    }
    try {
      const snapshot = healthSnapshot(health);
      const live = snapshot.phase !== "failed" && snapshot.phase !== "stopped";
      const healthy = target === LIVE_PATH ? live : snapshot.ready;
      end(response, healthy ? 200 : 503, healthy ? "ok\n" : "not_ready\n", method);
    } catch {
      end(response, 503, "not_ready\n", method);
    }
  });

  server.maxHeadersCount = 32;
  server.headersTimeout = 5_000;
  server.requestTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  server.on("checkContinue", (request, response) => end(response, 400, "bad_request\n", request.method ?? ""));
  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  });

  return Object.freeze({ server });
}
