import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { types as utilTypes } from "node:util";

import {
  createDurableCivicCaseCoordinator,
  type ActorRegistration,
  type CommandEnvelope,
} from "./civic-case-coordinator.ts";
import { createSqliteJournalStore } from "./adapters/sqlite-journal-adapter.ts";
import { createPublicKnowledge } from "./public-knowledge.ts";
import {
  createPermanentPublicRuntime,
  type PermanentPublicRuntime,
} from "./permanent-public-runtime.ts";
import { createPermanentNostrIntake } from "./permanent-nostr-intake.ts";
import { completePermanentSyntheticE2e, projectPermanentSyntheticE2e } from "./permanent-synthetic-e2e.ts";

const ACTION_ROLES = new Set([
  "citizen", "case_steward", "department_agent", "department_reviewer", "participation_reviewer",
]);
const ACTOR_CLASSES = new Set([
  "citizen", "public", "administration", "council", "case_steward", "department_agent",
  "department_reviewer", "participation_reviewer",
]);
const DEPARTMENT_ACTOR_CLASSES = new Set(["department_agent", "department_reviewer"]);
const OWNER_KINDS = new Set([
  "municipal_body", "committee", "local_advisory_board", "department", "operator_role", "independent_evaluator", "other",
]);
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
const DEPARTMENT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ACTOR_ID = /^[a-z0-9][a-z0-9:._-]{0,159}$/;
const POLICY_VERSION = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HOST = /^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|localhost|127\.0\.0\.1|::1)$/;
const TOP_LEVEL_KEYS = [
  "schemaVersion", "scope", "canonicalCaseId", "policyVersion", "journal", "requiredDepartmentIds",
  "actors", "publicActor", "publicMecky", "municipality", "decisionCaseSlug", "publicCasePath", "owner", "publicHttp", "controlHttp",
] as const;

export type PermanentCoordinatorRuntimeConfig = {
  schemaVersion: "stadtstack_permanent_coordinator_runtime_v1";
  scope: { municipalityId: string; sourceCaseId: string };
  canonicalCaseId: string;
  policyVersion: string;
  journal: { rootDir: string; namespace: string };
  requiredDepartmentIds: string[];
  actors: ActorRegistration[];
  publicActor: { actorId: string; actorClass: "public" };
  publicMecky: { pubkey: string; agentName: string; nodeId: string };
  municipality: { id: string; name: string; state: string; country: string };
  decisionCaseSlug: string;
  publicCasePath: string;
  owner: {
    id: string;
    label: string;
    kind: "municipal_body" | "committee" | "local_advisory_board" | "department" | "operator_role" | "independent_evaluator" | "other";
  };
  publicHttp: { bindHost: "127.0.0.1" | "0.0.0.0"; port: number; allowedHosts: string[]; allowedOrigins: string[] };
  controlHttp: { bindHost: "127.0.0.1" | "0.0.0.0"; port: number; allowedHosts: string[]; maxBodyBytes: number };
};

export type PermanentCoordinatorRuntimeOptions = {
  actorTokens: Readonly<Record<string, string>>;
  syntheticE2e?: boolean;
};

export type PermanentCoordinatorRuntime = {
  readonly publicRuntime: PermanentPublicRuntime;
  readonly controlServer: Server;
  start(): Promise<{
    public: { host: string; port: number };
    control: { host: string; port: number };
  }>;
  close(): Promise<void>;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: unknown, expected: readonly string[], code: string): asserts value is Record<string, unknown> {
  if (!isPlainRecord(value)) throw new Error(code);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string") || keys.length !== expected.length || keys.some((key) => !expected.includes(key as string))) {
    throw new Error(code);
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) throw new Error(code);
  }
}

function exactArray(value: unknown, code: string): asserts value is unknown[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new Error(code);
  const keys = Reflect.ownKeys(value);
  const expected = Array.from({ length: value.length }, (_, index) => String(index));
  if (keys.length !== expected.length + 1 || !keys.includes("length") || expected.some((key) => !keys.includes(key))) throw new Error(code);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) throw new Error(code);
  }
}

function text(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(code);
  return value;
}

function validateConfig(config: PermanentCoordinatorRuntimeConfig): void {
  exactKeys(config, TOP_LEVEL_KEYS, "permanent_runtime_config_invalid");
  if (config.schemaVersion !== "stadtstack_permanent_coordinator_runtime_v1") throw new Error("permanent_runtime_config_invalid");
  exactKeys(config.scope, ["municipalityId", "sourceCaseId"], "permanent_runtime_scope_invalid");
  const municipalityId = text(config.scope.municipalityId, "permanent_runtime_scope_invalid");
  const sourceCaseId = text(config.scope.sourceCaseId, "permanent_runtime_scope_invalid");
  if (!SLUG.test(municipalityId) || !SLUG.test(sourceCaseId)) throw new Error("permanent_runtime_scope_invalid");
  if (config.municipality.id !== municipalityId || config.decisionCaseSlug !== sourceCaseId) throw new Error("permanent_runtime_scope_invalid");
  const canonicalParts = text(config.canonicalCaseId, "permanent_runtime_case_invalid").split(":");
  if (canonicalParts.length !== 6 || canonicalParts.slice(0, 4).join(":") !== "urn:stadtstack:case:municipality" || canonicalParts[4] !== municipalityId || !UUID_V7.test(canonicalParts[5] ?? "")) throw new Error("permanent_runtime_case_invalid");
  if (!POLICY_VERSION.test(text(config.policyVersion, "permanent_runtime_policy_invalid"))) throw new Error("permanent_runtime_policy_invalid");
  exactKeys(config.journal, ["rootDir", "namespace"], "permanent_runtime_journal_invalid");
  text(config.journal.rootDir, "permanent_runtime_journal_invalid");
  if (!SLUG.test(text(config.journal.namespace, "permanent_runtime_journal_invalid"))) throw new Error("permanent_runtime_journal_invalid");
  exactArray(config.requiredDepartmentIds, "permanent_runtime_departments_invalid");
  if (config.requiredDepartmentIds.length !== 8 || new Set(config.requiredDepartmentIds).size !== 8 || config.requiredDepartmentIds.some((id) => typeof id !== "string" || !DEPARTMENT_ID.test(id))) throw new Error("permanent_runtime_departments_invalid");
  exactArray(config.actors, "permanent_runtime_actors_invalid");
  if (config.actors.length === 0) throw new Error("permanent_runtime_actors_invalid");
  const actorIds = new Set<string>();
  const departmentActorCounts = new Map<string, { agents: number; reviewers: number }>(config.requiredDepartmentIds.map((id) => [id, { agents: 0, reviewers: 0 }]));
  for (const actor of config.actors) {
    if (!isPlainRecord(actor)) throw new Error("permanent_runtime_actors_invalid");
    const classDescriptor = Object.getOwnPropertyDescriptor(actor, "actorClass");
    if (!classDescriptor || classDescriptor.get || classDescriptor.set || !classDescriptor.enumerable || !ACTOR_CLASSES.has(String(classDescriptor.value))) throw new Error("permanent_runtime_actors_invalid");
    const departmentScoped = DEPARTMENT_ACTOR_CLASSES.has(String(classDescriptor.value));
    exactKeys(actor, departmentScoped ? ["actorId", "actorClass", "departmentId"] : ["actorId", "actorClass"], "permanent_runtime_actors_invalid");
    const actorId = text(actor.actorId, "permanent_runtime_actors_invalid");
    if (!ACTOR_ID.test(actorId) || actorIds.has(actorId)) throw new Error("permanent_runtime_actors_invalid");
    actorIds.add(actorId);
    if (departmentScoped) {
      const departmentId = text(actor.departmentId, "permanent_runtime_actors_invalid");
      if (!DEPARTMENT_ID.test(departmentId) || !departmentActorCounts.has(departmentId)) throw new Error("permanent_runtime_actors_invalid");
      const counts = departmentActorCounts.get(departmentId)!;
      if (actor.actorClass === "department_agent") counts.agents += 1;
      else counts.reviewers += 1;
    }
  }
  if ([...departmentActorCounts.values()].some(({ agents, reviewers }) => agents !== 1 || reviewers !== 1)) throw new Error("permanent_runtime_actors_invalid");
  exactKeys(config.publicActor, ["actorId", "actorClass"], "permanent_runtime_public_actor_invalid");
  if (config.publicActor.actorClass !== "public" || !actorIds.has(config.publicActor.actorId)) throw new Error("permanent_runtime_public_actor_invalid");
  const registeredPublic = config.actors.find((actor) => actor.actorId === config.publicActor.actorId);
  if (registeredPublic?.actorClass !== "public") throw new Error("permanent_runtime_public_actor_invalid");
  exactKeys(config.publicMecky, ["pubkey", "agentName", "nodeId"], "permanent_runtime_public_mecky_invalid");
  if (
    !HEX_64.test(text(config.publicMecky.pubkey, "permanent_runtime_public_mecky_invalid")) ||
    !SLUG.test(text(config.publicMecky.agentName, "permanent_runtime_public_mecky_invalid")) ||
    !SLUG.test(text(config.publicMecky.nodeId, "permanent_runtime_public_mecky_invalid"))
  ) throw new Error("permanent_runtime_public_mecky_invalid");
  if (
    config.actors.find((actor) => actor.actorId === "roebel:nostr-ingestor")?.actorClass !== "citizen" ||
    config.actors.find((actor) => actor.actorId === "roebel:case-steward")?.actorClass !== "case_steward"
  ) throw new Error("permanent_runtime_nostr_actors_invalid");
  exactKeys(config.municipality, ["id", "name", "state", "country"], "permanent_runtime_municipality_invalid");
  if (config.municipality.id !== municipalityId || !text(config.municipality.name, "permanent_runtime_municipality_invalid") || !text(config.municipality.state, "permanent_runtime_municipality_invalid") || !/^[A-Z]{2}$/.test(config.municipality.country)) throw new Error("permanent_runtime_municipality_invalid");
  if (config.publicCasePath !== `/kommunen/${municipalityId}/entscheidungen/${sourceCaseId}`) throw new Error("permanent_runtime_scope_invalid");
  exactKeys(config.owner, ["id", "label", "kind"], "permanent_runtime_owner_invalid");
  if (!ACTOR_ID.test(text(config.owner.id, "permanent_runtime_owner_invalid")) || !text(config.owner.label, "permanent_runtime_owner_invalid") || !OWNER_KINDS.has(config.owner.kind)) throw new Error("permanent_runtime_owner_invalid");
  exactKeys(config.publicHttp, ["bindHost", "port", "allowedHosts", "allowedOrigins"], "permanent_runtime_http_invalid");
  exactKeys(config.controlHttp, ["bindHost", "port", "allowedHosts", "maxBodyBytes"], "permanent_runtime_http_invalid");
  for (const http of [config.publicHttp, config.controlHttp]) {
    if ((http.bindHost !== "127.0.0.1" && http.bindHost !== "0.0.0.0") || !Number.isInteger(http.port) || http.port < 0 || http.port > 65_535 || !Array.isArray(http.allowedHosts) || http.allowedHosts.length === 0) {
      throw new Error("permanent_runtime_http_invalid");
    }
    exactArray(http.allowedHosts, "permanent_runtime_http_invalid");
    const normalizedHosts = http.allowedHosts.map((host) => text(host, "permanent_runtime_http_invalid").toLowerCase());
    if (normalizedHosts.some((host) => !HOST.test(host)) || new Set(normalizedHosts).size !== normalizedHosts.length) throw new Error("permanent_runtime_http_invalid");
  }
  exactArray(config.publicHttp.allowedOrigins, "permanent_runtime_http_invalid");
  if (config.publicHttp.allowedOrigins.length === 0 || new Set(config.publicHttp.allowedOrigins).size !== config.publicHttp.allowedOrigins.length) throw new Error("permanent_runtime_http_invalid");
  for (const origin of config.publicHttp.allowedOrigins) {
    if (typeof origin !== "string") throw new Error("permanent_runtime_http_invalid");
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("permanent_runtime_http_invalid");
    }
    const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
    if (parsed.origin !== origin || parsed.username || parsed.password || (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:"))) throw new Error("permanent_runtime_http_invalid");
  }
  if (config.publicHttp.port !== 0 && config.publicHttp.port === config.controlHttp.port) throw new Error("permanent_http_ports_not_distinct");
  if (!Number.isSafeInteger(config.controlHttp.maxBodyBytes) || config.controlHttp.maxBodyBytes < 1_024 || config.controlHttp.maxBodyBytes > 1_048_576) throw new Error("permanent_runtime_http_invalid");
}

export function parsePermanentCoordinatorRuntimeConfig(value: unknown): PermanentCoordinatorRuntimeConfig {
  validateConfig(value as PermanentCoordinatorRuntimeConfig);
  return structuredClone(value) as PermanentCoordinatorRuntimeConfig;
}

function tokenDigests(config: PermanentCoordinatorRuntimeConfig, options: PermanentCoordinatorRuntimeOptions): Map<string, Buffer> {
  exactKeys(
    options,
    options.syntheticE2e === undefined ? ["actorTokens"] : ["actorTokens", "syntheticE2e"],
    "permanent_actor_tokens_invalid",
  );
  if (options.syntheticE2e !== undefined && typeof options.syntheticE2e !== "boolean") throw new Error("permanent_actor_tokens_invalid");
  if (!isPlainRecord(options.actorTokens)) throw new Error("permanent_actor_tokens_invalid");
  const expectedActors = config.actors.filter((actor) => ACTION_ROLES.has(actor.actorClass)).map((actor) => actor.actorId).sort();
  const actualActors = Object.keys(options.actorTokens).sort();
  if (JSON.stringify(expectedActors) !== JSON.stringify(actualActors)) throw new Error("permanent_actor_tokens_invalid");
  const result = new Map<string, Buffer>();
  for (const actorId of expectedActors) {
    const token = options.actorTokens[actorId];
    if (typeof token !== "string" || token.length < 32 || token !== token.trim() || /[\u0000-\u0020\u007f]/.test(token)) throw new Error("permanent_actor_tokens_invalid");
    result.set(actorId, createHash("sha256").update(token, "utf8").digest());
  }
  return result;
}

function requestHost(header: string | undefined): string | null {
  if (!header || /[\u0000-\u0020\u007f]/.test(header)) return null;
  if (header.startsWith("[")) return /^\[([^\]]+)\](?::\d{1,5})?$/.exec(header)?.[1]?.toLowerCase() ?? null;
  return /^([^:]+)(?::\d{1,5})?$/.exec(header)?.[1]?.toLowerCase() ?? null;
}

function send(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function body(request: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    request.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.byteLength;
      if (total > maxBytes) {
        settled = true;
        chunks.length = 0;
        reject(new Error("body_too_large"));
        return;
      }
      chunks.push(bytes);
    });
    request.once("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    request.once("end", () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
  });
}

function authorizedActor(request: IncomingMessage, digests: ReadonlyMap<string, Buffer>): string | null {
  const actorHeader = request.headers["x-stadtstack-actor-id"];
  const actorId = typeof actorHeader === "string" ? actorHeader : null;
  const authorization = request.headers.authorization;
  if (!actorId || typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return null;
  const expected = digests.get(actorId);
  if (!expected) return null;
  const supplied = createHash("sha256").update(authorization.slice(7), "utf8").digest();
  return timingSafeEqual(expected, supplied) ? actorId : null;
}

function listen(server: Server, host: "127.0.0.1" | "0.0.0.0", port: number): Promise<{ host: string; port: number }> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("permanent_runtime_address_invalid"));
      resolve({ host: address.address, port: address.port });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close((error) => error ? reject(error) : resolve());
  });
}

export function createPermanentCoordinatorRuntime(
  config: PermanentCoordinatorRuntimeConfig,
  options: PermanentCoordinatorRuntimeOptions,
): PermanentCoordinatorRuntime {
  config = parsePermanentCoordinatorRuntimeConfig(config);
  const digests = tokenDigests(config, options);
  const journal = createSqliteJournalStore({ rootDir: config.journal.rootDir, namespace: config.journal.namespace });
  let closed = false;
  let started = false;
  let coordinator: ReturnType<typeof createDurableCivicCaseCoordinator>;
  let publicRuntime: PermanentPublicRuntime;
  try {
    coordinator = createDurableCivicCaseCoordinator({
      scope: { municipalityId: config.scope.municipalityId, caseId: config.scope.sourceCaseId },
      jurisdiction: { scheme: "municipality", value: config.scope.municipalityId },
      canonicalCaseId: config.canonicalCaseId,
      policyVersion: config.policyVersion,
      actors: structuredClone(config.actors),
      discussionTrustMode: "verified_public_nostr",
      requiredDepartmentIds: [...config.requiredDepartmentIds],
      requireSignedSuggestionAdmission: true,
      journalPort: journal,
      journalNamespace: config.journal.namespace,
    }, journal);
    const projectOnly = Object.freeze({ project: coordinator.project });
    const knowledge = createPublicKnowledge({
      coordinator: projectOnly,
      caseId: config.canonicalCaseId,
      policyVersion: config.policyVersion,
      actorBinding: structuredClone(config.publicActor),
    });
    publicRuntime = createPermanentPublicRuntime({
      knowledge,
      municipality: structuredClone(config.municipality),
      decisionCaseSlug: config.decisionCaseSlug,
      canonicalCaseId: config.canonicalCaseId,
      policyVersion: config.policyVersion,
      publicCasePath: config.publicCasePath,
      owner: structuredClone(config.owner),
      http: structuredClone(config.publicHttp),
    });
  } catch (error) {
    journal.close();
    throw error;
  }
  const controlHosts = new Set(config.controlHttp.allowedHosts.map((host) => host.toLowerCase()));
  const nostrIntake = createPermanentNostrIntake({
    scope: structuredClone(config.scope),
    canonicalCaseId: config.canonicalCaseId,
    policyVersion: config.policyVersion,
    discussionActorId: "roebel:nostr-ingestor",
    caseStewardActorId: "roebel:case-steward",
    publicMecky: structuredClone(config.publicMecky),
  });
  const controlServer = createServer((request, response) => {
    void (async () => {
      const host = requestHost(request.headers.host);
      if (!host || !controlHosts.has(host)) return send(response, 400, { error: "invalid_host" });
      const url = request.url ?? "";
      if (url.includes("?") || url.includes("#")) return send(response, 400, { error: "invalid_request" });
      if (request.method === "GET" && (url === "/healthz" || url === "/readyz")) return send(response, 200, { status: url === "/healthz" ? "ok" : "ready", mode: "actor_bound_control" });
      const commandRoute = url === "/v1/commands";
      const discussionRoute = url === "/v1/nostr/discussions";
      const suggestionRoute = url === "/v1/nostr/suggestions/admit";
      const syntheticE2eRoute = options.syntheticE2e === true && url === "/v1/e2e/complete";
      const syntheticE2eViewRoute = options.syntheticE2e === true && url === "/v1/e2e/view";
      if (!commandRoute && !discussionRoute && !suggestionRoute && !syntheticE2eRoute && !syntheticE2eViewRoute) return send(response, 404, { error: "not_found" });
      if (request.method !== "POST") return send(response, 405, { error: "method_not_allowed" });
      const actorId = authorizedActor(request, digests);
      if (!actorId) return send(response, 401, { error: "unauthorized" });
      if (!(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) return send(response, 415, { error: "content_type_required" });
      let raw: string;
      try {
        raw = await body(request, config.controlHttp.maxBodyBytes);
      } catch {
        return send(response, 413, { error: "body_too_large" });
      }
      let requestValue: unknown;
      try {
        requestValue = JSON.parse(raw) as unknown;
      } catch {
        return send(response, 400, { error: "invalid_json" });
      }
      if (commandRoute && (!isPlainRecord(requestValue) || !isPlainRecord(requestValue.actorBinding) || requestValue.actorBinding.actorId !== actorId)) {
        return send(response, 401, { error: "actor_binding_mismatch" });
      }
      if (discussionRoute && actorId !== nostrIntake.discussionActorId) return send(response, 403, { error: "actor_forbidden" });
      if (suggestionRoute && actorId !== nostrIntake.caseStewardActorId) return send(response, 403, { error: "actor_forbidden" });
      if (syntheticE2eRoute && actorId !== nostrIntake.caseStewardActorId) return send(response, 403, { error: "actor_forbidden" });
      if (syntheticE2eViewRoute && actorId !== nostrIntake.caseStewardActorId) return send(response, 403, { error: "actor_forbidden" });
      try {
        if (syntheticE2eRoute) {
          if (!isPlainRecord(requestValue) || Reflect.ownKeys(requestValue).length !== 0) throw new Error("synthetic_e2e_input_invalid");
          return send(response, 200, completePermanentSyntheticE2e(coordinator, {
            caseId: config.canonicalCaseId,
            policyVersion: config.policyVersion,
          }));
        }
        if (syntheticE2eViewRoute) {
          if (!isPlainRecord(requestValue) || Reflect.ownKeys(requestValue).length !== 1) throw new Error("synthetic_e2e_view_invalid");
          const profile = requestValue.profile;
          if (profile !== "public" && profile !== "administration" && profile !== "council") throw new Error("synthetic_e2e_view_invalid");
          return send(response, 200, projectPermanentSyntheticE2e(coordinator, {
            caseId: config.canonicalCaseId,
            policyVersion: config.policyVersion,
          }, profile));
        }
        const commandValue = commandRoute
          ? requestValue as CommandEnvelope
          : discussionRoute
            ? nostrIntake.discussionCommand(requestValue)
            : nostrIntake.suggestionAdmissionCommand(requestValue);
        return send(response, 200, coordinator.handle(commandValue));
      } catch {
        return send(response, 422, { error: "command_rejected" });
      }
    })().catch(() => {
      if (!response.writableEnded) send(response, 503, { error: "control_unavailable" });
    });
  });

  return {
    publicRuntime,
    controlServer,
    async start() {
      if (closed) throw new Error("permanent_runtime_closed");
      if (started) throw new Error("permanent_runtime_already_started");
      try {
        const publicAddress = await publicRuntime.listen();
        const controlAddress = await listen(controlServer, config.controlHttp.bindHost, config.controlHttp.port);
        started = true;
        return { public: publicAddress, control: controlAddress };
      } catch (error) {
        await Promise.allSettled([publicRuntime.close(), closeServer(controlServer)]);
        try {
          journal.close();
        } finally {
          closed = true;
        }
        throw error;
      }
    },
    async close() {
      if (closed) return;
      const results = await Promise.allSettled([publicRuntime.close(), closeServer(controlServer)]);
      let journalError: unknown;
      try {
        journal.close();
      } catch (error) {
        journalError = error;
      } finally {
        closed = true;
      }
      const serverError = results.find((result): result is PromiseRejectedResult => result.status === "rejected")?.reason;
      if (serverError || journalError) throw serverError ?? journalError;
    },
  };
}
