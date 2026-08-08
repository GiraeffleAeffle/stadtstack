import { createHash } from "node:crypto";

import type {
  CompanionContext,
  CompanionProfile,
  CompanionTask,
} from "../companion-runtime.ts";

export type { CompanionTask } from "../companion-runtime.ts";

/**
 * A deliberately small public Interface for a role-scoped worker harness.
 *
 * The caller provides a prepared CompanionTask and receives a validated
 * worker_result_v1 value.  All request shaping, checksums, tool policy,
 * limits, transport adaptation, and result validation live behind this seam.
 * Implementations therefore remain replaceable without giving a caller a
 * model, network, or civic-mutation interface.
 */
export interface CompanionHarnessAdapter {
  readonly kind: "deterministic-local" | "openclaw";
  run(
    task: CompanionTask,
    options?: CompanionHarnessRunOptions,
  ): Promise<WorkerResultV1>;
}

/** Short name for callers that do not need to mention the Adapter role. */
export type CompanionHarness = CompanionHarnessAdapter;

export type CompanionHarnessRunOptions = {
  sessionKey?: string;
  limits?: Partial<WorkerLimits>;
  identityPolicy?: CompanionIdentityPolicy;
};

/**
 * Exact role-to-identity allowlists. The values are intentionally literal
 * strings, not regular expressions: profile/identity binding must be
 * explicit and auditable, and one identity may never appear in two roles.
 */
export type CompanionIdentityPolicy = Readonly<
  Record<CompanionProfile, readonly string[]>
>;

export type CompanionHarnessFactoryOptions = {
  identityPolicy: CompanionIdentityPolicy;
};

export type WorkerLimits = {
  maxOutputTokens: number;
  timeoutMs: number;
  maxCostUsd: number;
};

export type WorkerIdentity = {
  id: string;
  profile: CompanionProfile;
};

export type WorkerToolPolicy = {
  mode: "default-deny";
  allow: readonly [];
  deny: readonly ["*"];
};

export type WorkerContext = {
  checksum: string;
  projection: CompanionContext;
};

/** The cross-Adapter request Interface. */
export type WorkerTaskV1 = {
  schemaVersion: "worker_task_v1";
  taskId: string;
  sessionKey: string;
  profile: CompanionProfile;
  identity: WorkerIdentity;
  question: string;
  contextChecksum: string;
  context: WorkerContext;
  allowedTools: readonly [];
  tools: WorkerToolPolicy;
  prohibitedEffects: readonly string[];
  limits: WorkerLimits;
};

export type WorkerCitationV1 = {
  ref: string;
  label?: string;
  excerpt?: string;
};

/** The only result shape admitted back across the harness seam. */
export type WorkerResultV1 = {
  schemaVersion: "worker_result_v1";
  status: "completed";
  taskId: string;
  sessionKey: string;
  profile: CompanionProfile;
  identity: WorkerIdentity;
  contextChecksum: string;
  answer: string;
  citations: readonly WorkerCitationV1[];
};

export type CompanionHarnessTransport = {
  send(request: WorkerTaskV1): Promise<unknown> | unknown;
};

const DEFAULT_LIMITS: WorkerLimits = Object.freeze({
  maxOutputTokens: 512,
  timeoutMs: 5_000,
  maxCostUsd: 0,
});

const LIMIT_CEILINGS: WorkerLimits = Object.freeze({
  maxOutputTokens: 4_096,
  timeoutMs: 60_000,
  maxCostUsd: 1,
});

const PROHIBITED_EFFECTS: readonly string[] = Object.freeze([
  "approve",
  "change_case_stage",
  "publish",
  "submit_to_council",
  "vote",
]);

const WORKER_RESULT_KEYS = new Set([
  "schemaVersion",
  "status",
  "taskId",
  "sessionKey",
  "profile",
  "identity",
  "contextChecksum",
  "answer",
  "citations",
]);

const WORKER_TASK_KEYS = new Set([
  "schemaVersion",
  "taskId",
  "sessionKey",
  "profile",
  "identity",
  "question",
  "contextChecksum",
  "context",
  "allowedTools",
  "tools",
  "prohibitedEffects",
  "limits",
]);

const WORKER_IDENTITY_KEYS = new Set(["id", "profile"]);
const WORKER_CITATION_KEYS = new Set(["ref", "label", "excerpt"]);

const RAW_REASONING_FIELD = /^(?:analysis|chain[_-]?of[_-]?thought|reasoning|thoughts?|debug|trace)$/i;
const EFFECT_OR_TOOL_FIELD = /^(?:tools?|tool[_-]?calls?|effects?|side[_-]?effects?)$/i;
const PRIVATE_FIELD = /(?:private|secret|credential|token|password|raw[_-]?citizen|department[_-]?work[_-]?packages)/i;
const RAW_LEAK_VALUE = /\b(?:nsec1[a-z0-9-]{8,}|npub1[a-z0-9-]{8,}|0x[a-f0-9]{40}|raw\s+(?:citizen|ballot)|private\s+key|chain[_ -]?of[_ -]?thought|departmentWorkPackages|unreviewed\s+(?:response|draft))\b/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function requireNonEmptyString(value: unknown, errorCode: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(errorCode);
  }
  return value.trim();
}

function assertSafeIdentifier(value: string, errorCode: string): string {
  if (
    /nsec1[a-z0-9]{8,}/i.test(value) ||
    /0x[a-f0-9]{40,64}/i.test(value) ||
    /private[_ -]?key/i.test(value)
  ) {
    throw new Error(`${errorCode}_secret_material`);
  }
  return value;
}

function normalizeIdentityPolicy(
  input: CompanionIdentityPolicy,
): CompanionIdentityPolicy {
  if (!isObject(input)) throw new Error("identity_policy_required");
  const normalized = {} as Record<CompanionProfile, readonly string[]>;
  const owners = new Map<string, CompanionProfile>();
  for (const profile of ["administration", "council", "public"] as const) {
    const values = input[profile];
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error(`identity_policy_allowlist_required:${profile}`);
    }
    const unique = [...new Set(values.map((value) => {
      const identity = assertSafeIdentifier(
        requireNonEmptyString(value, `identity_policy_identity_required:${profile}`),
        `identity_policy:${profile}`,
      );
      const previous = owners.get(identity);
      if (previous && previous !== profile) {
        throw new Error(`identity_policy_cross_role:${identity}`);
      }
      owners.set(identity, profile);
      return identity;
    }))];
    normalized[profile] = Object.freeze(unique);
  }
  return Object.freeze(normalized);
}

/** Build an exact, pairwise-disjoint identity policy for one city slice. */
export function createCompanionIdentityPolicy(
  identities: Readonly<Record<CompanionProfile, string>>,
): CompanionIdentityPolicy {
  return normalizeIdentityPolicy({
    administration: [identities.administration],
    council: [identities.council],
    public: [identities.public],
  });
}

function assertTaskIdentityAllowed(
  task: CompanionTask,
  identityPolicy: CompanionIdentityPolicy | undefined,
): CompanionIdentityPolicy {
  if (!identityPolicy) throw new Error("identity_policy_required");
  const normalized = normalizeIdentityPolicy(identityPolicy);
  const identity = requireNonEmptyString(task.workerIdentity, "worker_identity_required");
  assertSafeIdentifier(identity, "worker_identity");
  if (!normalized[task.profile].includes(identity)) {
    throw new Error(`worker_identity_not_allowed:${task.profile}`);
  }
  return normalized;
}

function normalizeLimits(input: Partial<WorkerLimits> | undefined): WorkerLimits {
  const limits = {
    maxOutputTokens: input?.maxOutputTokens ?? DEFAULT_LIMITS.maxOutputTokens,
    timeoutMs: input?.timeoutMs ?? DEFAULT_LIMITS.timeoutMs,
    maxCostUsd: input?.maxCostUsd ?? DEFAULT_LIMITS.maxCostUsd,
  };
  for (const [key, value] of Object.entries(limits) as Array<[
    keyof WorkerLimits,
    number
  ]>) {
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value) && key !== "maxCostUsd") {
      throw new Error(`worker_limit_invalid:${key}`);
    }
    if (value > LIMIT_CEILINGS[key]) {
      throw new Error(`worker_limit_exceeded:${key}`);
    }
  }
  if (limits.maxOutputTokens === 0 || limits.timeoutMs === 0) {
    throw new Error("worker_limit_zero");
  }
  return Object.freeze(limits);
}

function contextCaseId(context: CompanionContext): string {
  const municipalityId = requireNonEmptyString(
    context.municipalityId,
    "companion_context_municipality_required",
  );
  const caseId = requireNonEmptyString(context.caseId, "companion_context_case_required");
  return `${municipalityId}/${caseId}`;
}

const VISIBILITY_BY_PROFILE: Record<CompanionProfile, CompanionContext["visibility"]> = {
  administration: "administration_internal",
  council: "council_restricted",
  public: "public_reviewed",
};

function assertRoleScopedContext(
  profile: CompanionProfile,
  context: CompanionContext,
): void {
  if (context.profile !== profile) {
    throw new Error("companion_context_profile_mismatch");
  }
  if (context.visibility !== VISIBILITY_BY_PROFILE[profile]) {
    throw new Error("companion_context_visibility_mismatch");
  }

  if (profile !== "administration" && context.departmentWorkPackages !== undefined) {
    throw new Error(`companion_context_private_field_forbidden:${profile}:departmentWorkPackages`);
  }
  if (profile !== "council" && context.councilDryRunBrief !== undefined) {
    throw new Error(`companion_context_role_field_forbidden:${profile}:councilDryRunBrief`);
  }
  const publishedBy = context.reviewedCitizenBrief?.publishedBy;
  if (profile !== "administration" && publishedBy !== undefined) {
    throw new Error(`companion_context_private_field_forbidden:${profile}:publishedBy`);
  }
}

function defaultSessionKey(task: CompanionTask): string {
  const identityHash = sha256(task.workerIdentity).slice("sha256:".length, "sha256:".length + 16);
  const casePart = contextCaseId(task.context).replace(/[^a-zA-Z0-9._:-]+/g, "-");
  return `companion:${task.profile}:${casePart}:${identityHash}`;
}

function defaultTaskId(task: CompanionTask, contextChecksum: string, sessionKey: string): string {
  return `worker-task:${sha256({
    sessionKey,
    profile: task.profile,
    question: task.question,
    contextChecksum,
  }).slice("sha256:".length)}`;
}

function assertTask(
  task: CompanionTask,
  identityPolicy: CompanionIdentityPolicy | undefined,
): CompanionIdentityPolicy {
  if (!isObject(task)) throw new Error("companion_task_required");
  if (!["administration", "council", "public"].includes(task.profile)) {
    throw new Error("companion_profile_invalid");
  }
  requireNonEmptyString(task.question, "companion_question_required");
  const normalizedPolicy = assertTaskIdentityAllowed(task, identityPolicy);
  if (!isObject(task.context)) throw new Error("companion_context_required");
  assertRoleScopedContext(task.profile, task.context);
  if (!Array.isArray(task.allowedTools) || task.allowedTools.length !== 0) {
    throw new Error("companion_tools_must_be_empty");
  }
  if (!Array.isArray(task.prohibitedEffects)) {
    throw new Error("companion_prohibited_effects_required");
  }
  for (const effect of PROHIBITED_EFFECTS) {
    if (!task.prohibitedEffects.includes(effect)) {
      throw new Error(`companion_prohibited_effect_missing:${effect}`);
    }
  }
  return normalizedPolicy;
}

/**
 * Prepare a task once at the external Seam. The same immutable request is
 * used by both Adapters, making their policy and test surface identical.
 */
export function prepareCompanionWorkerTask(
  task: CompanionTask,
  options: CompanionHarnessRunOptions = {},
): WorkerTaskV1 {
  assertTask(task, options.identityPolicy);
  const projection = clone(task.context);
  const contextChecksum = sha256(projection);
  const requestedSessionKey = options.sessionKey;
  const sessionKey = requestedSessionKey
    ? assertSafeIdentifier(
        requireNonEmptyString(requestedSessionKey, "worker_session_key_required"),
        "worker_session_key",
      )
    : defaultSessionKey(task);
  const identity = Object.freeze({
    id: assertSafeIdentifier(
      requireNonEmptyString(task.workerIdentity, "worker_identity_required"),
      "worker_identity",
    ),
    profile: task.profile,
  });
  const limits = normalizeLimits(options.limits);
  const prohibitedEffects = Object.freeze([...new Set([...PROHIBITED_EFFECTS, ...task.prohibitedEffects])]);
  const tools = Object.freeze({
    mode: "default-deny" as const,
    allow: Object.freeze([]) as readonly [],
    deny: Object.freeze(["*"]) as readonly ["*"],
  });

  return {
    schemaVersion: "worker_task_v1",
    taskId: defaultTaskId(task, contextChecksum, sessionKey),
    sessionKey,
    profile: task.profile,
    identity,
    question: task.question.trim(),
    contextChecksum,
    context: {
      checksum: contextChecksum,
      projection,
    },
    allowedTools: Object.freeze([]) as readonly [],
    tools,
    prohibitedEffects,
    limits,
  };
}

function collectContextCitationRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectContextCitationRefs(item, refs);
    return refs;
  }
  if (!isObject(value)) return refs;
  for (const [key, child] of Object.entries(value)) {
    if (key === "citations" && Array.isArray(child)) {
      for (const citation of child) if (typeof citation === "string" && citation.trim()) refs.push(citation.trim());
    }
    collectContextCitationRefs(child, refs);
  }
  return refs;
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(value)) {
    // Closed envelopes explicitly allow `tools` on a task only to carry the
    // default-deny policy.  Apply leakage-name checks to unknown keys so that
    // an allowed structural field is not mistaken for a provider capability.
    if (!allowed.has(key)) {
      if (RAW_REASONING_FIELD.test(key)) throw new Error(`worker_result_field_forbidden:${path}.${key}`);
      if (EFFECT_OR_TOOL_FIELD.test(key)) throw new Error(`worker_result_field_forbidden:${path}.${key}`);
      if (PRIVATE_FIELD.test(key) && !(path === "result.identity" && key === "id")) {
        throw new Error(`worker_result_private_field_forbidden:${path}.${key}`);
      }
      throw new Error(`worker_result_field_forbidden:${path}.${key}`);
    }
  }
}

function assertNoRawLeak(value: unknown, path: string): void {
  if (typeof value === "string") {
    if (RAW_LEAK_VALUE.test(value)) throw new Error(`worker_result_private_leakage:${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoRawLeak(item, `${path}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (RAW_REASONING_FIELD.test(key) || EFFECT_OR_TOOL_FIELD.test(key)) {
      throw new Error(`worker_result_field_forbidden:${path}.${key}`);
    }
    assertNoRawLeak(child, `${path}.${key}`);
  }
}

function normalizeIdentity(value: unknown): WorkerIdentity {
  if (!isObject(value)) throw new Error("worker_result_identity_invalid");
  assertAllowedKeys(value, WORKER_IDENTITY_KEYS, "result.identity");
  const id = requireNonEmptyString(value.id, "worker_result_identity_invalid");
  if (!["administration", "council", "public"].includes(value.profile as string)) {
    throw new Error("worker_result_profile_invalid");
  }
  return { id, profile: value.profile as CompanionProfile };
}

function normalizeCitations(value: unknown): WorkerCitationV1[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("worker_result_citations_required");
  return value.map((item, index) => {
    // A string citation is accepted as a compact transport form and is
    // normalized to the structured worker_result_v1 representation.
    if (typeof item === "string") {
      return { ref: requireNonEmptyString(item, `worker_result_citation_invalid:${index}`) };
    }
    if (!isObject(item)) throw new Error(`worker_result_citation_invalid:${index}`);
    assertAllowedKeys(item, WORKER_CITATION_KEYS, `result.citations[${index}]`);
    return {
      ref: requireNonEmptyString(item.ref, `worker_result_citation_invalid:${index}`),
      ...(item.label === undefined ? {} : { label: requireNonEmptyString(item.label, `worker_result_citation_invalid:${index}`) }),
      ...(item.excerpt === undefined ? {} : { excerpt: requireNonEmptyString(item.excerpt, `worker_result_citation_invalid:${index}`) }),
    };
  });
}

function assertWorkerTask(
  request: WorkerTaskV1,
  identityPolicy: CompanionIdentityPolicy | undefined,
): void {
  // The transport boundary may need to validate a task before it has the
  // city-level allowlist.  In that case all closed-shape, checksum, role, and
  // no-effect invariants still apply; the outer companion harness remains the
  // authoritative identity allowlist gate.
  const normalizedPolicy = identityPolicy === undefined
    ? undefined
    : normalizeIdentityPolicy(identityPolicy);
  if (!isObject(request)) throw new Error("worker_task_shape_invalid");
  assertAllowedKeys(request, WORKER_TASK_KEYS, "task");
  if (request.schemaVersion !== "worker_task_v1") throw new Error("worker_task_schema_invalid");
  if (!["administration", "council", "public"].includes(request.profile)) {
    throw new Error("worker_task_profile_invalid");
  }
  requireNonEmptyString(request.taskId, "worker_task_id_required");
  assertSafeIdentifier(requireNonEmptyString(request.sessionKey, "worker_session_key_required"), "worker_session_key");
  requireNonEmptyString(request.question, "worker_task_question_required");

  if (!isObject(request.identity)) throw new Error("worker_task_identity_invalid");
  assertAllowedKeys(request.identity, WORKER_IDENTITY_KEYS, "task.identity");
  const identityId = assertSafeIdentifier(
    requireNonEmptyString(request.identity.id, "worker_task_identity_invalid"),
    "worker_identity",
  );
  if (request.identity.profile !== request.profile) {
    throw new Error("worker_task_identity_profile_mismatch");
  }
  if (normalizedPolicy && !normalizedPolicy[request.profile].includes(identityId)) {
    throw new Error(`worker_identity_not_allowed:${request.profile}`);
  }

  if (!isObject(request.context) || !isObject(request.context.projection)) {
    throw new Error("worker_task_context_invalid");
  }
  assertAllowedKeys(request.context, new Set(["checksum", "projection"]), "task.context");
  assertRoleScopedContext(request.profile, request.context.projection);
  const recalculatedChecksum = sha256(request.context.projection);
  if (request.context.checksum !== recalculatedChecksum || request.contextChecksum !== recalculatedChecksum) {
    throw new Error("worker_task_context_checksum_mismatch");
  }

  if (!Array.isArray(request.allowedTools) || request.allowedTools.length !== 0) {
    throw new Error("worker_task_tools_must_be_empty");
  }
  if (!isObject(request.tools)) throw new Error("worker_task_tool_policy_invalid");
  assertAllowedKeys(request.tools, new Set(["mode", "allow", "deny"]), "task.tools");
  if (request.tools.mode !== "default-deny") throw new Error("worker_task_tool_policy_invalid");
  if (!Array.isArray(request.tools.allow) || request.tools.allow.length !== 0) {
    throw new Error("worker_task_tool_policy_invalid");
  }
  if (!Array.isArray(request.tools.deny) || request.tools.deny.length !== 1 || request.tools.deny[0] !== "*") {
    throw new Error("worker_task_tool_policy_invalid");
  }
  if (!Array.isArray(request.prohibitedEffects) || PROHIBITED_EFFECTS.some((effect) => !request.prohibitedEffects.includes(effect))) {
    throw new Error("worker_task_prohibited_effects_invalid");
  }
  if (!isObject(request.limits)) throw new Error("worker_task_limits_invalid");
  const limitKeys = Object.keys(request.limits).sort().join(",");
  if (limitKeys !== "maxCostUsd,maxOutputTokens,timeoutMs") {
    throw new Error("worker_task_limits_invalid");
  }
  normalizeLimits(request.limits);
}

/**
 * Validate the closed worker_task_v1 envelope at an injected transport seam.
 *
 * `identityPolicy` is optional here so a provider transport can enforce the
 * structural contract before serialization while the city harness applies
 * its exact role-to-identity allowlist at the outer boundary.
 */
export function validateCompanionWorkerTask(
  request: WorkerTaskV1,
  identityPolicy?: CompanionIdentityPolicy,
): void {
  assertWorkerTask(request, identityPolicy);
}

/**
 * Validate and clone an untrusted worker result. Identity, role, session, and
 * context checksum are all bound to the request. Unknown fields are rejected
 * so tool calls, effects, hidden reasoning, credentials, and private payloads
 * cannot smuggle across the Adapter seam.
 */
export function validateCompanionWorkerResult(
  request: WorkerTaskV1,
  raw: unknown,
  identityPolicy: CompanionIdentityPolicy,
): WorkerResultV1 {
  if (!identityPolicy) throw new Error("identity_policy_required");
  assertWorkerTask(request, identityPolicy);
  if (!isObject(raw)) throw new Error("worker_result_shape_invalid");
  assertAllowedKeys(raw, WORKER_RESULT_KEYS, "result");
  if (raw.schemaVersion !== "worker_result_v1") throw new Error("worker_result_schema_invalid");
  if (raw.status !== "completed") throw new Error("worker_result_status_invalid");
  if (raw.taskId !== request.taskId) throw new Error("worker_result_task_mismatch");
  if (raw.sessionKey !== request.sessionKey) throw new Error("worker_result_session_mismatch");
  if (raw.profile !== request.profile) throw new Error("worker_result_profile_mismatch");
  if (raw.contextChecksum !== request.contextChecksum) throw new Error("worker_result_context_checksum_mismatch");

  const identity = normalizeIdentity(raw.identity);
  if (identity.id !== request.identity.id) throw new Error("worker_result_identity_mismatch");
  if (identity.profile !== request.identity.profile) throw new Error("worker_result_identity_profile_mismatch");

  const answer = requireNonEmptyString(raw.answer, "worker_result_answer_required");
  const estimatedOutputTokens = Math.ceil(answer.length / 4);
  if (estimatedOutputTokens > request.limits.maxOutputTokens) {
    throw new Error("worker_result_output_limit_exceeded");
  }
  const citations = normalizeCitations(raw.citations);
  assertNoRawLeak({ answer, citations }, "result");
  if (
    request.profile === "public" &&
    /\b(?:private|internal|unpublished)\b/i.test(
      [answer, ...citations.flatMap((citation) => [citation.ref, citation.label ?? "", citation.excerpt ?? ""])].join(" "),
    )
  ) {
    throw new Error("worker_result_private_leakage:public_scope");
  }

  // A citation must be a source reference, not a free-form hidden prompt.
  for (const citation of citations) {
    if (!/^[a-z][a-z0-9+.-]*:\S+$/i.test(citation.ref)) {
      throw new Error("worker_result_citation_ref_invalid");
    }
  }

  const knownContextRefs = new Set(collectContextCitationRefs(request.context.projection));
  if (knownContextRefs.size > 0 && citations.every((citation) => !knownContextRefs.has(citation.ref))) {
    throw new Error("worker_result_citations_unbound");
  }

  return {
    schemaVersion: "worker_result_v1",
    status: "completed",
    taskId: request.taskId,
    sessionKey: request.sessionKey,
    profile: request.profile,
    identity,
    contextChecksum: request.contextChecksum,
    answer,
    citations: clone(citations),
  };
}

function timeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("worker_timeout")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function buildDeterministicResult(request: WorkerTaskV1): WorkerResultV1 {
  const contextRefs = collectContextCitationRefs(request.context.projection);
  const fallbackRef = `synthetic://context/${request.context.projection.municipalityId}/${request.context.projection.caseId}`;
  const citations = (contextRefs.length > 0 ? contextRefs : [fallbackRef]).slice(0, 3).map((ref) => ({ ref }));
  return {
    schemaVersion: "worker_result_v1",
    status: "completed",
    taskId: request.taskId,
    sessionKey: request.sessionKey,
    profile: request.profile,
    identity: { ...request.identity },
    contextChecksum: request.contextChecksum,
    answer: `Synthetic ${request.profile} companion answer for ${request.context.projection.municipalityId}/${request.context.projection.caseId}: ${request.question}`,
    citations,
  };
}

/**
 * Deterministic local Adapter used by offline tests and the synthetic flow.
 * It never reads process credentials, invokes a model, writes state, or uses
 * a network transport. `resultFor` is intentionally exposed for a fake
 * OpenClaw transport to reuse the same deterministic worker implementation.
 */
export function createDeterministicLocalCompanionAdapter(
  options: CompanionHarnessFactoryOptions,
): CompanionHarnessAdapter & {
  resultFor(request: WorkerTaskV1): WorkerResultV1;
} {
  const identityPolicy = normalizeIdentityPolicy(options?.identityPolicy);
  return {
    kind: "deterministic-local",
    resultFor(request: WorkerTaskV1): WorkerResultV1 {
      assertWorkerTask(request, identityPolicy);
      return validateCompanionWorkerResult(request, buildDeterministicResult(request), identityPolicy);
    },
    async run(task: CompanionTask, options: CompanionHarnessRunOptions = {}): Promise<WorkerResultV1> {
      const request = prepareCompanionWorkerTask(task, { ...options, identityPolicy });
      return validateCompanionWorkerResult(request, buildDeterministicResult(request), identityPolicy);
    },
  };
}

/**
 * OpenClaw Adapter. It deliberately accepts a transport instead of creating
 * one: the production seam can later bind an approved OpenClaw session/MCP
 * transport, while tests inject a local fake and make no network call.
 */
export function createOpenClawCompanionAdapter(
  transport: CompanionHarnessTransport,
  options: CompanionHarnessFactoryOptions,
): CompanionHarnessAdapter {
  if (!transport || typeof transport.send !== "function") {
    throw new Error("openclaw_transport_required");
  }
  const identityPolicy = normalizeIdentityPolicy(options?.identityPolicy);
  return {
    kind: "openclaw",
    async run(task: CompanionTask, options: CompanionHarnessRunOptions = {}): Promise<WorkerResultV1> {
      const request = prepareCompanionWorkerTask(task, { ...options, identityPolicy });
      const raw = await timeout(Promise.resolve(transport.send(request)), request.limits.timeoutMs);
      return validateCompanionWorkerResult(request, raw, identityPolicy);
    },
  };
}

// Explicit aliases keep the public Interface discoverable without creating a
// second implementation seam. They are useful to callers that think in terms
// of a harness rather than its concrete Adapter kind.
export const createLocalCompanionHarness = createDeterministicLocalCompanionAdapter;
export const createOpenClawCompanionHarness = createOpenClawCompanionAdapter;
export const mapCompanionTaskToWorkerTask = prepareCompanionWorkerTask;
export const validateWorkerResult = validateCompanionWorkerResult;

export { DEFAULT_LIMITS, PROHIBITED_EFFECTS };
