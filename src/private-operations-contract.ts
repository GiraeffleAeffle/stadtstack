import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";

export type PrivateOperationsVerification = {
  schemaVersion: "private_operations_verification_v1";
  status: "passed" | "failed_closed";
  contractDigest?: `sha256:${string}`;
  errors: readonly string[];
};

type Role = "public" | "administration" | "council";
type Edge = { from: string; to: string; purpose: string };

const ROLES: readonly Role[] = ["public", "administration", "council"];
const CONTRACT_SCHEMA = "private_operations_contract_v1";
const VERIFICATION_SCHEMA = "private_operations_verification_v1" as const;
const ROOT_KEYS = ["schemaVersion", "owner", "scope", "gateways", "bridges", "networkPolicy", "locks", "effects", "verifier"] as const;
const SECRET_MARKER = /(?:nsec1|npub1|ncryptsec1|private[_ -]?key|secret[_ -]?(?:key|value|material)|credential|password|token|api[_ -]?key|bearer|authorization|-----BEGIN|sk-[a-z0-9]|0x[a-f0-9]{40})/i;
const WILDCARD_MARKER = /(?:^|[/:])\*(?:$|[/:])/;
const TOPOLOGY_MARKER = /(?:https?:\/\/|postgres(?:ql)?:|sqlite(?:3)?:|mysql:|redis:|0\.0\.0\.0|localhost(?::|$)|\b(?:10|127|172|192\.168)\.\d{1,3}\.\d{1,3})/i;
const DNS_ENDPOINT_REF = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?$/i;
const SYMBOLIC_REF = /^[a-z][a-z0-9._-]*(?::[a-zA-Z0-9._:-]+)?$/;
const SYMBOLIC_NAME = /^[a-z][a-z0-9._-]{0,127}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;

const ALLOWED_EDGES: readonly Edge[] = Object.freeze([
  { from: "runner", to: "control_plane", purpose: "acceptance" },
  ...ROLES.map((role) => ({ from: "control_plane", to: `role_bridge:${role}`, purpose: "worker_rpc" })),
  { from: "control_plane", to: "test_relay", purpose: "local_exchange" },
  ...ROLES.map((role) => ({ from: `role_gateway:${role}`, to: "deterministic_provider", purpose: "fake_model" })),
  { from: "runner", to: "cluster_dns", purpose: "name_resolution" },
  { from: "control_plane", to: "cluster_dns", purpose: "name_resolution" },
  ...ROLES.map((role) => ({ from: `role_bridge:${role}`, to: "cluster_dns", purpose: "name_resolution" })),
]);

class ContractFailure extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ContractFailure";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertPlainDataRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new ContractFailure(`shape_invalid:${path}`);
  if (nodeTypes.isProxy(value)) throw new ContractFailure(`proxy_forbidden:${path}`);
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new ContractFailure(`non_plain_input:${path}`);
  if (Object.getOwnPropertySymbols(value).length > 0) throw new ContractFailure(`unknown_field:${path}`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (descriptor.get || descriptor.set) throw new ContractFailure(`accessor_forbidden:${path}`);
  }
}

function assertPlainDataArray(value: unknown, path: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new ContractFailure(`shape_invalid:${path}`);
  if (nodeTypes.isProxy(value)) throw new ContractFailure(`proxy_forbidden:${path}`);
  if (Object.getOwnPropertySymbols(value).length > 0) throw new ContractFailure(`unknown_field:${path}`);
  for (const key of Object.getOwnPropertyNames(value)) if (key !== "length" && !/^\d+$/.test(key)) throw new ContractFailure(`unknown_field:${path}`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || descriptor.get || descriptor.set) throw new ContractFailure(`accessor_forbidden:${path}[${index}]`);
  }
}

function canonicalize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new ContractFailure("cyclic_input");
    seen.add(value);
    const result = value.map((item) => canonicalize(item, seen));
    seen.delete(value);
    return result;
  }
  if (!isRecord(value)) return value;
  if (seen.has(value)) throw new ContractFailure("cyclic_input");
  seen.add(value);
  const result = Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key], seen)]));
  seen.delete(value);
  return result;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function contractDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function exactKeys(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  assertPlainDataRecord(value, path);
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new ContractFailure(`unknown_field:${path}`);
  for (const key of keys) if (!Object.prototype.hasOwnProperty.call(value, key)) throw new ContractFailure(`missing_field:${path}.${key}`);
  return value;
}

function stringValue(value: unknown, path: string, pattern?: RegExp): string {
  if (typeof value !== "string" || value.trim() === "") throw new ContractFailure(`string_invalid:${path}`);
  const normalized = value.trim();
  if (value !== normalized) throw new ContractFailure(`value_invalid:${path}`);
  if (SECRET_MARKER.test(normalized)) throw new ContractFailure(`secret_value_forbidden:${path}`);
  if (WILDCARD_MARKER.test(normalized)) throw new ContractFailure(`wildcard_forbidden:${path}`);
  if (TOPOLOGY_MARKER.test(normalized)) throw new ContractFailure(`topology_value_forbidden:${path}`);
  if (DNS_ENDPOINT_REF.test(normalized) || DNS_ENDPOINT_REF.test(normalized.split(":", 1)[0] ?? "")) throw new ContractFailure(`endpoint_ref_forbidden:${path}`);
  if (pattern && !pattern.test(normalized)) throw new ContractFailure(`value_invalid:${path}`);
  return normalized;
}

function boolValue(value: unknown, path: string, expected: boolean): void {
  if (value !== expected) throw new ContractFailure(`flag_invalid:${path}`);
}

function roles(value: unknown, path: string): Record<Role, Record<string, unknown>> {
  assertPlainDataArray(value, path);
  if (value.length !== ROLES.length) throw new ContractFailure(`${path}_count`);
  const result = {} as Record<Role, Record<string, unknown>>;
  for (const item of value) {
    assertPlainDataRecord(item, `${path}_item`);
    if (!ROLES.includes(item.role as Role)) throw new ContractFailure(`${path}_roles`);
    const role = item.role as Role;
    if (result[role]) throw new ContractFailure(`${path}_roles`);
    result[role] = item;
  }
  for (const role of ROLES) if (!result[role]) throw new ContractFailure(`${path}_roles`);
  return result;
}

function edgeKey(edge: Edge): string {
  return `${edge.from}|${edge.to}|${edge.purpose}`;
}

function sortByField(values: readonly unknown[], field: string): unknown[] {
  return [...values].sort((left, right) => {
    const leftValue = isRecord(left) && typeof left[field] === "string" ? left[field] as string : "";
    const rightValue = isRecord(right) && typeof right[field] === "string" ? right[field] as string : "";
    return leftValue.localeCompare(rightValue);
  });
}

function normalizeContractOrder(root: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...root };
  normalized.gateways = sortByField(root.gateways as readonly unknown[], "role");
  normalized.bridges = sortByField(root.bridges as readonly unknown[], "role");
  const network = root.networkPolicy as Record<string, unknown>;
  normalized.networkPolicy = {
    ...network,
    allowedEdges: [...(network.allowedEdges as readonly Edge[])].sort((left, right) => edgeKey(left).localeCompare(edgeKey(right))),
  };
  const locks = root.locks as Record<string, unknown>;
  const normalizeSecrets = sortByField(locks.secrets as readonly unknown[], "logicalName").map((secret) => {
    if (!isRecord(secret)) return secret;
    return {
      ...secret,
      consumerRefs: [...(secret.consumerRefs as readonly string[])].sort(),
    };
  });
  normalized.locks = {
    ...locks,
    images: sortByField(locks.images as readonly unknown[], "logicalName"),
    configs: sortByField(locks.configs as readonly unknown[], "logicalName"),
    secrets: normalizeSecrets,
  };
  return normalized;
}

function verifyContract(input: unknown): `sha256:${string}` {
  const root = exactKeys(input, ROOT_KEYS, "contract");
  if (root.schemaVersion !== CONTRACT_SCHEMA) throw new ContractFailure("schema_version_invalid");

  const owner = exactKeys(root.owner, ["kind", "ownerRef", "authorization"], "owner");
  if (owner.kind !== "private_operations_owner") throw new ContractFailure("owner_kind_invalid");
  stringValue(owner.ownerRef, "owner.ownerRef", SYMBOLIC_REF);
  if (owner.authorization !== "approved") throw new ContractFailure("owner_authorization_required");

  const scope = exactKeys(root.scope, ["kind", "exactNamespace", "namespaceRef", "deleteMode", "sharedResources"], "scope");
  if (scope.kind !== "disposable_synthetic") throw new ContractFailure("scope_kind_invalid");
  boolValue(scope.exactNamespace, "scope.exactNamespace", true);
  stringValue(scope.namespaceRef, "scope.namespaceRef", SYMBOLIC_REF);
  if (scope.deleteMode !== "exact_namespace_only") throw new ContractFailure("scope_delete_mode_invalid");
  boolValue(scope.sharedResources, "scope.sharedResources", false);

  const gateways = roles(root.gateways, "gateway");
  const gatewayRefs = new Set<string>();
  for (const role of ROLES) {
    const gateway = exactKeys(gateways[role], ["role", "listener", "bridgeRef", "directIngress"], `gateways.${role}`);
    if (gateway.role !== role) throw new ContractFailure(`gateway_role_invalid:${role}`);
    const listener = exactKeys(gateway.listener, ["bind", "loopbackOnly", "rawPortExposed", "hostNetwork", "hostPort"], `gateways.${role}.listener`);
    if (listener.bind !== "127.0.0.1") throw new ContractFailure(`gateway_listener_bind_invalid:${role}`);
    boolValue(listener.loopbackOnly, `gateways.${role}.listener.loopbackOnly`, true);
    boolValue(listener.rawPortExposed, `gateways.${role}.listener.rawPortExposed`, false);
    boolValue(listener.hostNetwork, `gateways.${role}.listener.hostNetwork`, false);
    boolValue(listener.hostPort, `gateways.${role}.listener.hostPort`, false);
    const bridgeRef = stringValue(gateway.bridgeRef, `gateways.${role}.bridgeRef`, SYMBOLIC_REF);
    if (gatewayRefs.has(bridgeRef)) throw new ContractFailure("gateway_bridge_duplicate");
    gatewayRefs.add(bridgeRef);
    boolValue(gateway.directIngress, `gateways.${role}.directIngress`, false);
  }

  const bridges = roles(root.bridges, "bridge");
  const bridgeRefs = new Set<string>();
  for (const role of ROLES) {
    const bridge = exactKeys(bridges[role], ["role", "bridgeRef", "serviceExposure", "target", "fixedDestination", "rawGatewayPort", "arbitraryProxy"], `bridges.${role}`);
    if (bridge.role !== role) throw new ContractFailure(`bridge_role_invalid:${role}`);
    if (bridge.bridgeRef !== gateways[role].bridgeRef) throw new ContractFailure(`bridge_mapping_invalid:${role}`);
    if (bridgeRefs.has(bridge.bridgeRef as string)) throw new ContractFailure("bridge_ref_duplicate");
    bridgeRefs.add(bridge.bridgeRef as string);
    if (bridge.serviceExposure !== "cluster_internal_role_only") throw new ContractFailure(`bridge_exposure_invalid:${role}`);
    if (bridge.target !== "same-pod-loopback-gateway") throw new ContractFailure(`bridge_target_invalid:${role}`);
    boolValue(bridge.fixedDestination, `bridges.${role}.fixedDestination`, true);
    boolValue(bridge.rawGatewayPort, `bridges.${role}.rawGatewayPort`, false);
    boolValue(bridge.arbitraryProxy, `bridges.${role}.arbitraryProxy`, false);
  }

  const network = exactKeys(root.networkPolicy, ["defaultDeny", "allowedEdges", "externalIngress", "paidProviderEgress", "sharedStorage", "sharedDatabase", "wildcards"], "networkPolicy");
  boolValue(network.defaultDeny, "networkPolicy.defaultDeny", true);
  assertPlainDataArray(network.allowedEdges, "networkPolicy.allowedEdges");
  if (network.allowedEdges.length !== ALLOWED_EDGES.length) throw new ContractFailure("network_edges_count");
  const allowed = new Set(ALLOWED_EDGES.map(edgeKey));
  const observed = new Set<string>();
  for (const [index, value] of network.allowedEdges.entries()) {
    const edge = exactKeys(value, ["from", "to", "purpose"], `networkPolicy.allowedEdges[${index}]`) as Edge;
    const key = edgeKey(edge);
    if (!ALLOWED_EDGES.some((candidate) => candidate.from === edge.from && candidate.to === edge.to && candidate.purpose === edge.purpose)) throw new ContractFailure(`network_edge_forbidden:${index}`);
    if (observed.has(key)) throw new ContractFailure("network_edge_duplicate");
    observed.add(key);
  }
  if (observed.size !== allowed.size || [...allowed].some((key) => !observed.has(key))) throw new ContractFailure("network_edges_incomplete");
  for (const flag of ["externalIngress", "paidProviderEgress", "sharedStorage", "sharedDatabase", "wildcards"]) boolValue(network[flag], `networkPolicy.${flag}`, false);

  // The public gate proves only a nonempty, immutable, value-free lock form;
  // the private owner binds exact resource coverage in its separate manifest.
  const locks = exactKeys(root.locks, ["images", "configs", "secrets"], "locks");
  const lockNames = new Set<string>();
  for (const kind of ["images", "configs"] as const) {
    const entries = locks[kind];
    assertPlainDataArray(entries, `locks.${kind}`);
    if (entries.length === 0) throw new ContractFailure(`lock_${kind}_required`);
    const names = new Set<string>();
    for (const [index, value] of entries.entries()) {
      const lock = exactKeys(value, ["logicalName", "digest"], `locks.${kind}[${index}]`);
      const logicalName = stringValue(lock.logicalName, `locks.${kind}[${index}].logicalName`, SYMBOLIC_NAME);
      if (names.has(logicalName)) throw new ContractFailure(`lock_name_duplicate:${kind}`);
      if (lockNames.has(logicalName)) throw new ContractFailure("lock_name_duplicate");
      names.add(logicalName);
      lockNames.add(logicalName);
      if (typeof lock.digest !== "string" || !SHA256.test(lock.digest)) throw new ContractFailure(`lock_digest_invalid:${kind}[${index}]`);
    }
  }
  const secrets = locks.secrets;
  assertPlainDataArray(secrets, "locks.secrets");
  if (secrets.length === 0) throw new ContractFailure("lock_secrets_required");
  const secretNames = new Set<string>();
  for (const [index, value] of secrets.entries()) {
    const secret = exactKeys(value, ["logicalName", "required", "valueFree", "sourceRefOnly", "consumerRefs", "noDefault"], `locks.secrets[${index}]`);
    const logicalName = stringValue(secret.logicalName, `locks.secrets[${index}].logicalName`, SYMBOLIC_NAME);
    if (secretNames.has(logicalName)) throw new ContractFailure("secret_name_duplicate");
    if (lockNames.has(logicalName)) throw new ContractFailure("lock_name_duplicate");
    secretNames.add(logicalName);
    lockNames.add(logicalName);
    boolValue(secret.required, `locks.secrets[${index}].required`, true);
    boolValue(secret.valueFree, `locks.secrets[${index}].valueFree`, true);
    boolValue(secret.sourceRefOnly, `locks.secrets[${index}].sourceRefOnly`, true);
    assertPlainDataArray(secret.consumerRefs, `locks.secrets[${index}].consumerRefs`);
    if (secret.consumerRefs.length === 0) throw new ContractFailure(`secret_consumers_invalid:${index}`);
    secret.consumerRefs.forEach((ref, consumerIndex) => stringValue(ref, `locks.secrets[${index}].consumerRefs[${consumerIndex}]`, SYMBOLIC_REF));
    if (new Set(secret.consumerRefs).size !== secret.consumerRefs.length) throw new ContractFailure(`secret_consumers_duplicate:${index}`);
    boolValue(secret.noDefault, `locks.secrets[${index}].noDefault`, true);
  }

  const effects = exactKeys(root.effects, ["publicIngress", "paidEgress", "sharedStorage", "sharedDatabase", "wildcardResources", "dnsMutation", "relayPublication", "providerFallback", "civicEffects"], "effects");
  for (const flag of Object.keys(effects)) boolValue(effects[flag], `effects.${flag}`, false);
  const verifier = exactKeys(root.verifier, ["readOnly", "noNetwork", "noMutation", "noSecretReads", "rejectUnknownKeys"], "verifier");
  for (const flag of Object.keys(verifier)) boolValue(verifier[flag], `verifier.${flag}`, true);
  return contractDigest(normalizeContractOrder(root));
}

export function verifyPrivateOperationsContract(input: unknown): PrivateOperationsVerification {
  try {
    return Object.freeze({
      schemaVersion: VERIFICATION_SCHEMA,
      status: "passed" as const,
      contractDigest: verifyContract(input),
      errors: Object.freeze([]) as readonly string[],
    });
  } catch (error) {
    return Object.freeze({
      schemaVersion: VERIFICATION_SCHEMA,
      status: "failed_closed" as const,
      errors: Object.freeze([error instanceof ContractFailure ? error.code : "contract_invalid"]) as readonly string[],
    });
  }
}
