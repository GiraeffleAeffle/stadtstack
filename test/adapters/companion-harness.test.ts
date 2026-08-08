import assert from "node:assert/strict";
import test from "node:test";

import { createCompanionRuntime } from "../../src/companion-runtime.ts";
import { createCivicKernel } from "../../src/civic-kernel.ts";
import {
  createDeterministicLocalCompanionAdapter,
  createCompanionIdentityPolicy,
  createOpenClawCompanionAdapter,
  prepareCompanionWorkerTask,
  validateCompanionWorkerResult,
  type CompanionTask,
  type WorkerResultV1,
  type WorkerTaskV1,
} from "../../src/adapters/companion-harness.ts";

const IDENTITIES = {
  administration: "did:stadtstack:sample:admin",
  council: "did:stadtstack:sample:council",
  public: "npub-sample-public",
} as const;
const IDENTITY_POLICY = createCompanionIdentityPolicy(IDENTITIES);

function syntheticTask(profile: "administration" | "council" | "public" = "public"): CompanionTask {
  const kernel = createCivicKernel({
    municipalityId: "sample-municipality",
    caseId: "sample-case",
    departments: ["planning"],
    actors: [{ id: "synthetic-citizen", role: "citizen" }],
  });
  const runtime = createCompanionRuntime({
    caseReader: kernel,
    identities: {
      ...IDENTITIES,
    },
  });
  return runtime.prepareTask({ profile, question: "What is ready for review?" });
}

test("maps a CompanionTask into a role-scoped checksum-bound worker_task_v1 request", () => {
  const task = syntheticTask("council");
  const request = prepareCompanionWorkerTask(task, {
    sessionKey: "session:council:synthetic-1",
    identityPolicy: IDENTITY_POLICY,
  });

  assert.equal(request.schemaVersion, "worker_task_v1");
  assert.equal(request.profile, "council");
  assert.equal(request.identity.id, task.workerIdentity);
  assert.equal(request.identity.profile, "council");
  assert.equal(request.sessionKey, "session:council:synthetic-1");
  assert.match(request.contextChecksum, /^sha256:[a-f0-9]{64}$/);
  assert.equal(request.context.checksum, request.contextChecksum);
  assert.deepEqual(request.tools.allow, []);
  assert.deepEqual(request.tools.deny, ["*"]);
  assert.equal(request.tools.mode, "default-deny");
  assert.deepEqual(request.allowedTools, []);
  assert.equal(request.limits.maxOutputTokens, 512);
  assert.equal(request.limits.timeoutMs, 5_000);
  assert.equal(request.limits.maxCostUsd, 0);
});

test("deterministic local Adapter returns a stable cited worker result without effects", async () => {
  const adapter = createDeterministicLocalCompanionAdapter({ identityPolicy: IDENTITY_POLICY });
  const task = syntheticTask();
  const first = await adapter.run(task);
  const second = await adapter.run(task);

  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, "worker_result_v1");
  assert.equal(first.status, "completed");
  assert.equal(first.identity.profile, "public");
  assert.match(
    first.sessionKey,
    /^companion:public:sample-municipality-sample-case:[a-f0-9]{16}$/,
  );
  assert.ok(first.answer.length > 0);
  assert.ok(first.citations.length > 0);
  assert.equal("tools" in first, false);
  assert.equal("effects" in first, false);
  assert.equal("reasoning" in first, false);
});

test("OpenClaw Adapter sends only through the injected transport and validates its result", async () => {
  const task = syntheticTask("administration");
  let seen: WorkerTaskV1 | undefined;
  const adapter = createOpenClawCompanionAdapter({
    async send(request) {
      seen = request;
      return createDeterministicLocalCompanionAdapter({ identityPolicy: IDENTITY_POLICY }).resultFor(request);
    },
  }, { identityPolicy: IDENTITY_POLICY });

  const result = await adapter.run(task, { sessionKey: "session:administration:synthetic-1" });
  assert.equal(seen?.schemaVersion, "worker_task_v1");
  assert.equal(seen?.identity.profile, "administration");
  assert.equal(seen?.sessionKey, "session:administration:synthetic-1");
  assert.equal(result.sessionKey, "session:administration:synthetic-1");
  assert.equal(result.identity.id, task.workerIdentity);
});

test("result validation rejects identity, profile, and session mismatches", () => {
  const request = prepareCompanionWorkerTask(syntheticTask("council"), {
    sessionKey: "session:council:strict",
    identityPolicy: IDENTITY_POLICY,
  });
  const valid = createDeterministicLocalCompanionAdapter({ identityPolicy: IDENTITY_POLICY }).resultFor(request);

  for (const [field, value] of [
    ["identity", { id: "wrong", profile: "council" }],
    ["profile", "public"],
    ["sessionKey", "session:council:other"],
  ] as const) {
    const candidate = structuredClone(valid) as Record<string, unknown>;
    candidate[field] = value;
    assert.throws(
      () => validateCompanionWorkerResult(request, candidate, IDENTITY_POLICY),
      new RegExp(field === "sessionKey" ? "session_mismatch" : `${field}_mismatch`),
    );
  }
});

test("result validation rejects missing citations, tool/effect fields, raw reasoning, and private leakage", () => {
  const request = prepareCompanionWorkerTask(syntheticTask("public"), { identityPolicy: IDENTITY_POLICY });
  const valid = createDeterministicLocalCompanionAdapter({ identityPolicy: IDENTITY_POLICY }).resultFor(request);
  const cases: Array<[string, (candidate: Record<string, unknown>) => void, RegExp]> = [
    ["missing citations", (candidate) => (candidate.citations = []), /citations_required/],
    ["tools", (candidate) => (candidate.tools = []), /field_forbidden:result\.tools/],
    ["effects", (candidate) => (candidate.effects = ["publish"]), /field_forbidden:result\.effects/],
    ["reasoning", (candidate) => (candidate.reasoning = "hidden chain of thought"), /field_forbidden:result\.reasoning/],
    ["private leakage", (candidate) => (candidate.answer = "The raw citizen npub1leaked-value is visible."), /private_leakage/],
  ];

  for (const [, mutate, error] of cases) {
    const candidate = structuredClone(valid) as Record<string, unknown>;
    mutate(candidate);
    assert.throws(() => validateCompanionWorkerResult(request, candidate, IDENTITY_POLICY), error);
  }
});

test("OpenClaw Adapter rejects a transport result that tries to invoke tools", async () => {
  const task = syntheticTask();
  const adapter = createOpenClawCompanionAdapter({
    send(request) {
      const result = createDeterministicLocalCompanionAdapter({ identityPolicy: IDENTITY_POLICY }).resultFor(request) as Record<string, unknown>;
      result.effects = ["publish"];
      return result;
    },
  }, { identityPolicy: IDENTITY_POLICY });

  await assert.rejects(() => adapter.run(task), /field_forbidden:result\.effects/);
});

test("validateCompanionWorkerResult returns a cloned normalized result", () => {
  const request = prepareCompanionWorkerTask(syntheticTask(), { identityPolicy: IDENTITY_POLICY });
  const result = createDeterministicLocalCompanionAdapter({ identityPolicy: IDENTITY_POLICY }).resultFor(request);
  const validated = validateCompanionWorkerResult(request, result, IDENTITY_POLICY);

  assert.notEqual(validated, result);
  assert.notEqual(validated.citations, result.citations);
  assert.deepEqual(validated, result);
});

test("preparation fails closed when task profile and context profile or visibility disagree", () => {
  const profileMismatch = syntheticTask("public");
  profileMismatch.context.profile = "administration";
  assert.throws(
    () => prepareCompanionWorkerTask(profileMismatch, { identityPolicy: IDENTITY_POLICY }),
    /companion_context_profile_mismatch/,
  );

  const visibilityMismatch = syntheticTask("council");
  visibilityMismatch.context.visibility = "public_reviewed";
  assert.throws(
    () => prepareCompanionWorkerTask(visibilityMismatch, { identityPolicy: IDENTITY_POLICY }),
    /companion_context_visibility_mismatch/,
  );
});

test("preparation rejects administration-only projection fields in public and council contexts", () => {
  const publicTask = syntheticTask("public");
  publicTask.context.departmentWorkPackages = [
    {
      id: "private-work-package",
      departmentId: "planning",
      suggestionId: "synthetic-suggestion",
      status: "awaiting_review",
    },
  ];
  assert.throws(
    () => prepareCompanionWorkerTask(publicTask, { identityPolicy: IDENTITY_POLICY }),
    /companion_context_private_field_forbidden:public:departmentWorkPackages/,
  );

  const councilTask = syntheticTask("council");
  councilTask.context.departmentWorkPackages = publicTask.context.departmentWorkPackages;
  assert.throws(
    () => prepareCompanionWorkerTask(councilTask, { identityPolicy: IDENTITY_POLICY }),
    /companion_context_private_field_forbidden:council:departmentWorkPackages/,
  );

  const councilPublisherLeak = syntheticTask("council");
  councilPublisherLeak.context.reviewedCitizenBrief = {
    summary: "Reviewed",
    citations: ["synthetic://brief"],
    publishedBy: "private-publisher-id",
  };
  assert.throws(
    () => prepareCompanionWorkerTask(councilPublisherLeak, { identityPolicy: IDENTITY_POLICY }),
    /companion_context_private_field_forbidden:council:publishedBy/,
  );
});

test("identity policy is explicit, pairwise-disjoint, and prevents cross-role reuse", () => {
  assert.throws(
    () => createCompanionIdentityPolicy({ ...IDENTITIES, public: IDENTITIES.administration }),
    /identity_policy_cross_role/,
  );

  const reused = syntheticTask("public");
  reused.workerIdentity = IDENTITIES.administration;
  assert.throws(
    () => prepareCompanionWorkerTask(reused, { identityPolicy: IDENTITY_POLICY }),
    /worker_identity_not_allowed:public/,
  );

  const secretIdentity = syntheticTask("public");
  secretIdentity.workerIdentity = "nsec1syntheticsecretmaterial";
  assert.throws(
    () => prepareCompanionWorkerTask(secretIdentity, { identityPolicy: IDENTITY_POLICY }),
    /worker_identity_secret_material/,
  );
  assert.throws(
    () => prepareCompanionWorkerTask(syntheticTask("public"), {
      identityPolicy: IDENTITY_POLICY,
      sessionKey: "session:public:nsec1syntheticsecretmaterial",
    }),
    /worker_session_key_secret_material/,
  );
});

test("result validation and deterministic resultFor reject forged worker task invariants", () => {
  const request = prepareCompanionWorkerTask(syntheticTask("public"), { identityPolicy: IDENTITY_POLICY });
  const result = createDeterministicLocalCompanionAdapter({ identityPolicy: IDENTITY_POLICY }).resultFor(request);
  const mutations: Array<[string, (candidate: WorkerTaskV1) => void, RegExp]> = [
    ["context checksum", (candidate) => (candidate.context.checksum = "sha256:" + "0".repeat(64)), /worker_task_context_checksum_mismatch/],
    ["identity profile", (candidate) => (candidate.identity.profile = "council"), /worker_task_identity_profile_mismatch/],
    ["unregistered identity", (candidate) => (candidate.identity.id = "did:stadtstack:sample:unregistered"), /worker_identity_not_allowed:public/],
    ["allowed tools", (candidate) => (candidate.allowedTools = ["read"] as never), /worker_task_tools_must_be_empty/],
    ["tool mode", (candidate) => (candidate.tools.mode = "allow" as never), /worker_task_tool_policy_invalid/],
    ["prohibited effects", (candidate) => (candidate.prohibitedEffects = ["publish"]), /worker_task_prohibited_effects_invalid/],
  ];

  for (const [, mutate, error] of mutations) {
    const candidate = structuredClone(request) as WorkerTaskV1;
    mutate(candidate);
    assert.throws(() => validateCompanionWorkerResult(candidate, result, IDENTITY_POLICY), error);
    assert.throws(
      () => createDeterministicLocalCompanionAdapter({ identityPolicy: IDENTITY_POLICY }).resultFor(candidate),
      error,
    );
  }
});

test("standalone result validation requires an identity policy and rejects unregistered request identities", () => {
  const request = prepareCompanionWorkerTask(syntheticTask("public"), { identityPolicy: IDENTITY_POLICY });
  const result = createDeterministicLocalCompanionAdapter({ identityPolicy: IDENTITY_POLICY }).resultFor(request);
  const forgedRequest = structuredClone(request) as WorkerTaskV1;
  forgedRequest.identity.id = IDENTITIES.administration;

  assert.throws(
    () => validateCompanionWorkerResult(forgedRequest, result, IDENTITY_POLICY),
    /worker_identity_not_allowed:public/,
  );

  assert.throws(
    () => Reflect.apply(validateCompanionWorkerResult, undefined, [request, result]),
    /identity_policy_required/,
  );
});

// Keep the public result type exercised by the test compiler without relying
// on an implementation detail of either Adapter.
const _workerResultTypeSmoke: WorkerResultV1 | undefined = undefined;
void _workerResultTypeSmoke;
