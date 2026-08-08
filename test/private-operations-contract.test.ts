import assert from "node:assert/strict";
import test from "node:test";

import { verifyPrivateOperationsContract } from "../src/private-operations-contract.ts";

const digest = `sha256:${"a".repeat(64)}`;
const roles = ["public", "administration", "council"] as const;

const allowedEdges = [
  { from: "runner", to: "control_plane", purpose: "acceptance" },
  ...roles.map((role) => ({ from: "control_plane", to: `role_bridge:${role}`, purpose: "worker_rpc" })),
  { from: "control_plane", to: "test_relay", purpose: "local_exchange" },
  ...roles.map((role) => ({ from: `role_gateway:${role}`, to: "deterministic_provider", purpose: "fake_model" })),
  { from: "runner", to: "cluster_dns", purpose: "name_resolution" },
  { from: "control_plane", to: "cluster_dns", purpose: "name_resolution" },
  ...roles.map((role) => ({ from: `role_bridge:${role}`, to: "cluster_dns", purpose: "name_resolution" })),
];

function validContract(): Record<string, unknown> {
  return {
    schemaVersion: "private_operations_contract_v1",
    owner: {
      kind: "private_operations_owner",
      ownerRef: "private-operations-owner",
      authorization: "approved",
    },
    scope: {
      kind: "disposable_synthetic",
      exactNamespace: true,
      namespaceRef: "private-only-ref",
      deleteMode: "exact_namespace_only",
      sharedResources: false,
    },
    gateways: roles.map((role) => ({
      role,
      listener: {
        bind: "127.0.0.1",
        loopbackOnly: true,
        rawPortExposed: false,
        hostNetwork: false,
        hostPort: false,
      },
      bridgeRef: `role-bridge-ref:${role}`,
      directIngress: false,
    })),
    bridges: roles.map((role) => ({
      role,
      bridgeRef: `role-bridge-ref:${role}`,
      serviceExposure: "cluster_internal_role_only",
      target: "same-pod-loopback-gateway",
      fixedDestination: true,
      rawGatewayPort: false,
      arbitraryProxy: false,
    })),
    networkPolicy: {
      defaultDeny: true,
      allowedEdges,
      externalIngress: false,
      paidProviderEgress: false,
      sharedStorage: false,
      sharedDatabase: false,
      wildcards: false,
    },
    locks: {
      images: [{ logicalName: "reference-worker", digest }],
      configs: [{ logicalName: "reference-config", digest }],
      secrets: [{
        logicalName: "synthetic-worker-auth",
        required: true,
        valueFree: true,
        sourceRefOnly: true,
        consumerRefs: ["control-plane", "runner"],
        noDefault: true,
      }],
    },
    effects: {
      publicIngress: false,
      paidEgress: false,
      sharedStorage: false,
      sharedDatabase: false,
      wildcardResources: false,
      dnsMutation: false,
      relayPublication: false,
      providerFallback: false,
      civicEffects: false,
    },
    verifier: {
      readOnly: true,
      noNetwork: true,
      noMutation: true,
      noSecretReads: true,
      rejectUnknownKeys: true,
    },
  };
}

test("private operations verifier accepts one exact value-free synthetic contract", () => {
  const result = verifyPrivateOperationsContract(validContract());
  assert.equal(result.schemaVersion, "private_operations_verification_v1");
  assert.equal(result.status, "passed");
  assert.deepEqual(result.errors, []);
  assert.match(result.contractDigest ?? "", /^sha256:[a-f0-9]{64}$/);
  assert.equal("contractVersion" in result, false);
  assert.equal("digest" in result, false);
});

test("private operations digest is deterministic across object insertion order", () => {
  const original = validContract();
  const originalGateways = original.gateways as unknown[];
  const originalBridges = original.bridges as unknown[];
  const originalNetwork = original.networkPolicy as Record<string, unknown>;
  const originalLocks = original.locks as Record<string, unknown>;
  const originalSecrets = originalLocks.secrets as unknown[];
  const reordered = {
    verifier: original.verifier,
    effects: original.effects,
    locks: {
      ...(original.locks as Record<string, unknown>),
      images: [...(originalLocks.images as unknown[])].reverse(),
      configs: [...(originalLocks.configs as unknown[])].reverse(),
      secrets: [...originalSecrets].reverse().map((secret) => ({
        ...(secret as Record<string, unknown>),
        consumerRefs: [...((secret as Record<string, unknown>).consumerRefs as string[])].reverse(),
      })),
    },
    networkPolicy: {
      ...originalNetwork,
      allowedEdges: [...(originalNetwork.allowedEdges as unknown[])].reverse(),
    },
    bridges: [...originalBridges].reverse(),
    gateways: [...originalGateways].reverse(),
    scope: original.scope,
    owner: original.owner,
    schemaVersion: original.schemaVersion,
  };
  const first = verifyPrivateOperationsContract(original);
  const second = verifyPrivateOperationsContract(reordered);
  assert.equal(first.status, "passed");
  assert.equal(second.status, "passed");
  assert.equal(first.contractDigest, second.contractDigest);
});

test("private operations verifier rejects unknown, public, mutable, wildcard, secret, and civic effects", () => {
  const cases: Array<[string, (candidate: Record<string, unknown>) => void, RegExp]> = [
    ["unknown", (candidate) => { candidate.extra = true; }, /unknown_field/],
    ["unapproved owner", (candidate) => { (candidate.owner as Record<string, unknown>).authorization = "pending"; }, /owner_authorization/],
    ["public ingress", (candidate) => { (candidate.networkPolicy as Record<string, unknown>).externalIngress = true; }, /flag_invalid/],
    ["wildcard edge", (candidate) => { ((candidate.networkPolicy as Record<string, unknown>).allowedEdges as Array<Record<string, unknown>>)[0]!.to = "*"; }, /network_edge/],
    ["unknown edge", (candidate) => { ((candidate.networkPolicy as Record<string, unknown>).allowedEdges as Array<Record<string, unknown>>)[0]!.purpose = "anything"; }, /network_edge/],
    ["raw listener", (candidate) => { ((candidate.gateways as Array<Record<string, unknown>>)[0]!.listener as Record<string, unknown>).bind = "0.0.0.0"; }, /gateway_listener/],
    ["host network", (candidate) => { ((candidate.gateways as Array<Record<string, unknown>>)[0]!.listener as Record<string, unknown>).hostNetwork = true; }, /flag_invalid/],
    ["mutable lock", (candidate) => { ((candidate.locks as Record<string, unknown>).images as Array<Record<string, unknown>>)[0]!.digest = "latest"; }, /lock_digest/],
    ["secret value", (candidate) => { ((candidate.locks as Record<string, unknown>).secrets as Array<Record<string, unknown>>)[0]!.value = "nsec1leaked"; }, /unknown_field|secret/],
    ["civic effect", (candidate) => { (candidate.effects as Record<string, unknown>).civicEffects = true; }, /flag_invalid/],
    ["missing role", (candidate) => { (candidate.gateways as unknown[]).pop(); }, /gateway_roles|gateway_count/],
    ["bridge mismatch", (candidate) => { ((candidate.bridges as Array<Record<string, unknown>>)[0]!).bridgeRef = "other-bridge"; }, /bridge_mapping/],
    ["verifier mutation", (candidate) => { (candidate.verifier as Record<string, unknown>).noMutation = false; }, /flag_invalid/],
  ];
  for (const [, mutate, error] of cases) {
    const candidate = structuredClone(validContract());
    mutate(candidate);
    const result = verifyPrivateOperationsContract(candidate);
    assert.equal(result.schemaVersion, "private_operations_verification_v1");
    assert.equal(result.status, "failed_closed");
    assert.match(result.errors.join(";"), error);
    assert.equal(result.contractDigest, undefined);
  }
});

test("private operations verifier emits stable non-value-leaking failure for malformed input", () => {
  const candidate = validContract();
  ((candidate.locks as Record<string, unknown>).secrets as Array<Record<string, unknown>>)[0]!.value = "nsec1private-material";
  const result = verifyPrivateOperationsContract(candidate);
  assert.equal(result.status, "failed_closed");
  assert.ok(result.errors.length > 0);
  assert.equal(result.errors.some((error) => error.includes("nsec1private-material")), false);
  assert.deepEqual(result, verifyPrivateOperationsContract(structuredClone(candidate)));
  assert.equal(verifyPrivateOperationsContract(null).status, "failed_closed");
});

test("private operations verifier rejects omissions, duplicate bindings, and non-canonical locks", () => {
  const cases: Array<[string, (candidate: Record<string, unknown>) => void, RegExp]> = [
    ["missing root field", (candidate) => { delete candidate.verifier; }, /missing_field:contract.verifier/],
    ["missing owner field", (candidate) => { delete (candidate.owner as Record<string, unknown>).ownerRef; }, /missing_field:owner.ownerRef/],
    ["missing listener field", (candidate) => { delete ((candidate.gateways as Array<Record<string, unknown>>)[0]!.listener as Record<string, unknown>).hostPort; }, /missing_field:gateways.public.listener.hostPort/],
    ["missing bridge field", (candidate) => { delete (candidate.bridges as Array<Record<string, unknown>>)[0]!.arbitraryProxy; }, /missing_field:bridges.public.arbitraryProxy/],
    ["missing network edge set", (candidate) => { delete (candidate.networkPolicy as Record<string, unknown>).allowedEdges; }, /missing_field:networkPolicy.allowedEdges/],
    ["missing lock digest", (candidate) => { delete ((candidate.locks as Record<string, unknown>).images as Array<Record<string, unknown>>)[0]!.digest; }, /missing_field:locks.images\[0\].digest/],
    ["missing secret consumer refs", (candidate) => { delete ((candidate.locks as Record<string, unknown>).secrets as Array<Record<string, unknown>>)[0]!.consumerRefs; }, /missing_field:locks.secrets\[0\].consumerRefs/],
    ["duplicate role", (candidate) => { ((candidate.gateways as Array<Record<string, unknown>>)[1]!).role = "public"; }, /gateway_roles/],
    ["duplicate gateway bridge", (candidate) => { ((candidate.gateways as Array<Record<string, unknown>>)[1]!).bridgeRef = ((candidate.gateways as Array<Record<string, unknown>>)[0]!).bridgeRef; }, /gateway_bridge_duplicate/],
    ["duplicate edge", (candidate) => { ((candidate.networkPolicy as Record<string, unknown>).allowedEdges as unknown[])[1] = ((candidate.networkPolicy as Record<string, unknown>).allowedEdges as unknown[])[0]; }, /network_edge_duplicate|network_edges_incomplete/],
    ["duplicate image lock", (candidate) => { ((candidate.locks as Record<string, unknown>).images as Array<Record<string, unknown>>).push({ logicalName: "reference-worker", digest }); }, /lock_name_duplicate/],
    ["duplicate consumer ref", (candidate) => { (((candidate.locks as Record<string, unknown>).secrets as Array<Record<string, unknown>>)[0]!.consumerRefs as string[]).push("runner"); }, /secret_consumers_duplicate/],
    ["uppercase digest", (candidate) => { ((candidate.locks as Record<string, unknown>).images as Array<Record<string, unknown>>)[0]!.digest = `sha256:${"A".repeat(64)}`; }, /lock_digest_invalid/],
  ];
  for (const [, mutate, error] of cases) {
    const candidate = structuredClone(validContract());
    mutate(candidate);
    const result = verifyPrivateOperationsContract(candidate);
    assert.equal(result.status, "failed_closed");
    assert.match(result.errors.join(";"), error);
    assert.equal(result.contractDigest, undefined);
  }
});

test("private operations verifier remains pure over frozen symbolic input", () => {
  const candidate = Object.freeze(validContract());
  const before = JSON.stringify(candidate, (_key, value) => value);
  const result = verifyPrivateOperationsContract(candidate);
  assert.equal(result.status, "passed");
  assert.equal(JSON.stringify(candidate, (_key, value) => value), before);
});

test("private operations verifier does not consult ambient environment or network", () => {
  const originalFetch = globalThis.fetch;
  const originalEnvDescriptor = Object.getOwnPropertyDescriptor(process, "env");
  assert.ok(originalEnvDescriptor);
  let networkCalls = 0;
  globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
    networkCalls += 1;
    throw new Error("network_called");
  }) as typeof fetch;
  const environment = originalEnvDescriptor.value as NodeJS.ProcessEnv;
  const blockedEnvironment = new Proxy(environment, {
    get() {
      throw new Error("environment_read");
    },
    has() {
      throw new Error("environment_read");
    },
  });
  Object.defineProperty(process, "env", { ...originalEnvDescriptor, value: blockedEnvironment });
  try {
    const result = verifyPrivateOperationsContract(validContract());
    assert.equal(result.status, "passed");
    assert.equal(networkCalls, 0);
  } finally {
    Object.defineProperty(process, "env", originalEnvDescriptor);
    globalThis.fetch = originalFetch;
  }
});

test("private operations verifier rejects endpoint-like DNS refs while allowing symbolic refs", () => {
  const endpointRefs = ["synthetic.cluster.local", "ops.example.org", "registry.example.org:443"];
  for (const endpointRef of endpointRefs) {
    const candidate = structuredClone(validContract());
    (candidate.scope as Record<string, unknown>).namespaceRef = endpointRef;
    const result = verifyPrivateOperationsContract(candidate);
    assert.equal(result.status, "failed_closed");
    assert.match(result.errors.join(";"), /endpoint_ref_forbidden/);
  }
  assert.equal(verifyPrivateOperationsContract(validContract()).status, "passed");
});

test("private operations verifier rejects accessors, proxies, and non-plain input before reading values", () => {
  let getterCalls = 0;
  const accessorCandidate = validContract();
  Object.defineProperty(accessorCandidate, "owner", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error("getter_called");
    },
  });
  const accessorResult = verifyPrivateOperationsContract(accessorCandidate);
  assert.equal(accessorResult.status, "failed_closed");
  assert.match(accessorResult.errors.join(";"), /accessor_forbidden/);
  assert.equal(getterCalls, 0);

  const proxyCandidate = new Proxy(validContract(), {
    get() {
      getterCalls += 1;
      throw new Error("proxy_get_called");
    },
  });
  const proxyResult = verifyPrivateOperationsContract(proxyCandidate);
  assert.equal(proxyResult.status, "failed_closed");
  assert.match(proxyResult.errors.join(";"), /proxy_forbidden|non_plain_input/);
  assert.equal(getterCalls, 0);

  class ContractObject {}
  const classCandidate = Object.assign(new ContractObject(), validContract());
  const classResult = verifyPrivateOperationsContract(classCandidate);
  assert.equal(classResult.status, "failed_closed");
  assert.match(classResult.errors.join(";"), /non_plain_input/);
});
