import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { types as utilTypes } from "node:util";

import {
  serializeReviewedPublicKnowledgeProjection,
  type ReviewedPublicKnowledgeProjectionV1,
  type ReviewedSourceKind,
} from "./reviewed-public-knowledge.ts";

export type ReviewedPublicKnowledgeRouteRequest = {
  method: string;
  path: string;
};

export type ReviewedPublicKnowledgeRouteResponse = {
  status: 200 | 400 | 404 | 405;
  headers: Readonly<Record<string, string>>;
  body: string;
};

export type ReviewedPublicKnowledgeServerConfig = {
  municipalityId: string;
  projections: readonly ReviewedPublicKnowledgeProjectionV1[];
};

export type ReviewedPublicKnowledgeServer = {
  readonly server: Server;
  respond(request: ReviewedPublicKnowledgeRouteRequest): ReviewedPublicKnowledgeRouteResponse;
  listen(port?: number): Promise<{ host: "127.0.0.1"; port: number }>;
  close(): Promise<void>;
};

const MUNICIPALITY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MAX_RESPONSE_BYTES = 512_000;

function exactObject(
  value: unknown,
  keys: readonly string[],
  code: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) throw new Error(code);
  const ownKeys = Reflect.ownKeys(value);
  const expected = [...keys].sort();
  const actual = ownKeys.filter((key): key is string => typeof key === "string").sort();
  if (actual.length !== ownKeys.length || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(code);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) throw new Error(code);
  }
  return value as Record<string, unknown>;
}

function exactProjectionArray(value: unknown): readonly ReviewedPublicKnowledgeProjectionV1[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype || value.length > 2) {
    throw new Error("reviewed_source_server_config_invalid");
  }
  const ownKeys = Reflect.ownKeys(value);
  const allowed = new Set(["length"]);
  for (let index = 0; index < value.length; index += 1) allowed.add(String(index));
  if (ownKeys.length !== value.length + 1 || ownKeys.some((key) =>
    typeof key !== "string" || !allowed.has(key))) {
    throw new Error("reviewed_source_server_config_invalid");
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      throw new Error("reviewed_source_server_config_invalid");
    }
  }
  return value as readonly ReviewedPublicKnowledgeProjectionV1[];
}

function sourcePath(municipalityId: string, sourceKind: ReviewedSourceKind): string {
  const source = sourceKind === "local_news" ? "local-news" : "ratsinformation";
  return `/api/federation/v1/municipalities/${municipalityId}/public-knowledge/${source}`;
}

function response(
  status: ReviewedPublicKnowledgeRouteResponse["status"],
  body: string,
  extraHeaders: Readonly<Record<string, string>> = {},
): ReviewedPublicKnowledgeRouteResponse {
  const headers = Object.freeze({
    "cache-control": "no-store",
    "content-length": String(Buffer.byteLength(body, "utf8")),
    "content-type": status === 200
      ? "application/json; charset=utf-8"
      : "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  return Object.freeze({ status, headers, body });
}

function loopbackHost(value: string | undefined): boolean {
  if (!value) return false;
  const host = value.trim().toLowerCase();
  return /^(?:127\.0\.0\.1|localhost)(?::\d+)?$/u.test(host) ||
    /^\[::1\](?::\d+)?$/u.test(host);
}

function send(serverResponse: ServerResponse, value: ReviewedPublicKnowledgeRouteResponse): void {
  serverResponse.writeHead(value.status, value.headers);
  serverResponse.end(value.body);
}

/**
 * Creates a credential-free reference transport over already-reviewed bytes.
 * The embedded listener is loopback-only; deployments should mount `respond`
 * behind their reviewed public ingress without widening its two GET routes.
 */
export function createReviewedPublicKnowledgeServer(
  config: ReviewedPublicKnowledgeServerConfig,
): ReviewedPublicKnowledgeServer {
  const parsedConfig = exactObject(
    config,
    ["municipalityId", "projections"],
    "reviewed_source_server_config_invalid",
  );
  const municipalityId = parsedConfig.municipalityId;
  if (typeof municipalityId !== "string" || municipalityId.length > 80 ||
    !MUNICIPALITY_ID.test(municipalityId)) {
    throw new Error("reviewed_source_server_config_invalid");
  }
  const projections = exactProjectionArray(parsedConfig.projections);

  const snapshots = new Map<string, { body: string; contentSha256: string }>();
  for (const projection of projections) {
    const body = serializeReviewedPublicKnowledgeProjection(projection);
    if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
      throw new Error("reviewed_source_server_snapshot_too_large");
    }
    const trusted = JSON.parse(body) as ReviewedPublicKnowledgeProjectionV1;
    const route = sourcePath(municipalityId, trusted.sourceKind);
    if (trusted.municipalityId !== municipalityId || snapshots.has(route)) {
      throw new Error("reviewed_source_server_scope_invalid");
    }
    snapshots.set(route, {
      body,
      contentSha256: trusted.contentSha256,
    });
  }

  const respond = (request: ReviewedPublicKnowledgeRouteRequest): ReviewedPublicKnowledgeRouteResponse => {
    const parsed = exactObject(
      request,
      ["method", "path"],
      "reviewed_source_request_invalid",
    );
    if (typeof parsed.method !== "string" || typeof parsed.path !== "string") {
      throw new Error("reviewed_source_request_invalid");
    }
    if (parsed.method !== "GET") {
      return response(405, "method_not_allowed\n", { allow: "GET" });
    }
    if (/[?#]/u.test(parsed.path)) return response(400, "query_not_allowed\n");
    const snapshot = snapshots.get(parsed.path);
    if (!snapshot) return response(404, "projection_not_found\n");
    return response(200, snapshot.body, {
      "x-stadtstack-content-sha256": snapshot.contentSha256,
    });
  };

  const server = createServer((request: IncomingMessage, serverResponse: ServerResponse) => {
    if (!loopbackHost(request.headers.host)) {
      return send(serverResponse, response(400, "invalid_host\n"));
    }
    try {
      send(serverResponse, respond({
        method: request.method ?? "",
        path: request.url ?? "",
      }));
    } catch {
      send(serverResponse, response(400, "request_invalid\n"));
    }
  });

  return Object.freeze({
    server,
    respond,
    listen(port = 0) {
      return new Promise((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        server.once("error", onError);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", onError);
          const address = server.address();
          if (!address || typeof address === "string") {
            return reject(new Error("reviewed_source_server_address_invalid"));
          }
          resolve({ host: "127.0.0.1", port: address.port });
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  });
}
