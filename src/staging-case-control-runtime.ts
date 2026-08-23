import { types as utilTypes } from "node:util";

import {
  createSqliteAtomicTopicCaseAdmission,
  type DurableSingleWriterState,
  type SqliteAtomicTopicCaseAdmissionOptions,
} from "./adapters/sqlite-atomic-topic-case-admission.ts";
import {
  createCaseDurableDeploymentClaimToken,
  type CaseDurableDeploymentClaimToken,
} from "./case-durable-deployment-claim.ts";
import {
  createCredentialFreeCaseBindingOutboxServer,
} from "./credential-free-case-binding-outbox-server.ts";
import {
  createRoebelCaseStewardControlServer,
} from "./roebel-case-steward-control-server.ts";
import {
  createRoebelCaseStewardControlService,
} from "./roebel-control-service.ts";
import {
  createStagingCaseProcessLifecycle,
  type StagingCaseProcessHealth,
} from "./staging-case-process-lifecycle.ts";
import {
  assertStagingCaseControlListenerBindPlan,
  consumeStagingCaseControlDeploymentProofForRuntime,
  createStagingCaseControlDeploymentProofFromReviewedSources,
  createStagingCaseControlListenerBindPlans,
  type StagingCaseControlBindingPinSource,
  type StagingCaseControlDeploymentRuntimeFacts,
  type StagingCaseControlListenerBindPlan,
  type StagingCaseControlReviewedBindingSource,
  type StagingCaseControlStorageObserver,
} from "./staging-case-control-preflight.ts";
import {
  createStagingCaseStewardTokenAuthenticator,
  type StagingCaseStewardCredential,
} from "./staging-case-steward-token-authenticator.ts";
import {
  type StagingCaseRecoveryGateInput,
} from "./staging-case-recovery-attestation.ts";
import {
  assertStagingCaseRecoveryActivationAuthorizationFresh,
  createStagingCaseRecoveryActivationAuthorization,
  type StagingCaseRecoveryActivationAuthorization,
} from "./staging-case-recovery-activation-authority.ts";
import { createStagingRuntimeProbeServer } from "./staging-runtime-probe-server.ts";
import type { ActorRegistration } from "./civic-case-coordinator.ts";

/** One intentionally loopback-only listener.  A later Operations-reviewed
 * deployment adapter is the only place allowed to choose a non-loopback bind. */
export type StagingCaseControlListenerPlan = Readonly<{
  host: "127.0.0.1";
  port: number;
}>;

export type StagingCaseControlRuntimeConfig = Readonly<{
  deploymentEnvironment: "staging";
  rootDir: string;
  municipalityId: string;
  policyVersion: string;
  actorRegistry: readonly ActorRegistration[];
  allowedSignerPubkeys: readonly string[];
  allowedAgentPubkeys: readonly string[];
  requiredDepartmentIds?: readonly string[];
  credentials: readonly StagingCaseStewardCredential[];
  admissionAllowedHosts: readonly string[];
  outboxAllowedHosts: readonly string[];
  probeAllowedHosts: readonly string[];
  listeners: Readonly<{
    probe: StagingCaseControlListenerPlan;
    outbox: StagingCaseControlListenerPlan;
    admission: StagingCaseControlListenerPlan;
  }>;
  drainTimeoutMs: number;
  /** Opt-in production-path ownership. When present, graceful process release
   * must seal the durable database instead of merely closing a tmp adapter. */
  durableState?: DurableSingleWriterState;
}>;

/** Civic/application inputs for the reviewed Operations composition. Storage,
 * release, listener hosts and listener ports are deliberately absent. */
export type OperationsBoundStagingCaseControlApplicationConfig = Readonly<{
  municipalityId: string;
  policyVersion: string;
  actorRegistry: readonly ActorRegistration[];
  allowedSignerPubkeys: readonly string[];
  allowedAgentPubkeys: readonly string[];
  requiredDepartmentIds?: readonly string[];
  credentials: readonly StagingCaseStewardCredential[];
  admissionAllowedHosts: readonly string[];
  outboxAllowedHosts: readonly string[];
  probeAllowedHosts: readonly string[];
  drainTimeoutMs: number;
}>;

export type OperationsBoundStagingCaseControlRuntimeConfig = Readonly<{
  reviewedBindingSource: StagingCaseControlReviewedBindingSource;
  bindingPinSource: StagingCaseControlBindingPinSource;
  storageObserver: StagingCaseControlStorageObserver;
  application: OperationsBoundStagingCaseControlApplicationConfig;
}>;

export type RecoveryActivatedOperationsBoundStagingCaseControlRuntimeConfig = Readonly<{
  reviewedBindingSource: StagingCaseControlReviewedBindingSource;
  bindingPinSource: StagingCaseControlBindingPinSource;
  storageObserver: StagingCaseControlStorageObserver;
  recovery: StagingCaseRecoveryGateInput;
  application: OperationsBoundStagingCaseControlApplicationConfig;
}>;

/** Deliberately capability-free runtime surface. */
export type StagingCaseControlRuntime = Readonly<{
  start(): Promise<void>;
  health(): StagingCaseProcessHealth;
  close(): Promise<void>;
}>;

type CapturedConfig = Readonly<{
  rootDir: string;
  municipalityId: string;
  policyVersion: string;
  actorRegistry: readonly ActorRegistration[];
  allowedSignerPubkeys: readonly string[];
  allowedAgentPubkeys: readonly string[];
  requiredDepartmentIds: readonly string[] | undefined;
  credentials: readonly StagingCaseStewardCredential[];
  admissionAllowedHosts: readonly string[];
  outboxAllowedHosts: readonly string[];
  probeAllowedHosts: readonly string[];
  listeners: Readonly<{
    probe: StagingCaseControlListenerPlan;
    outbox: StagingCaseControlListenerPlan;
    admission: StagingCaseControlListenerPlan;
  }>;
  drainTimeoutMs: number;
  durableState: DurableSingleWriterState | undefined;
}>;

type DeploymentListenerPlans = Readonly<{
  probe: StagingCaseControlListenerBindPlan;
  outbox: StagingCaseControlListenerBindPlan;
  admission: StagingCaseControlListenerBindPlan;
}>;

const ACTOR_ID = /^[A-Za-z0-9:._-]{1,256}$/u;
const MUNICIPALITY_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const POLICY_VERSION = /^[A-Za-z0-9:._-]{1,256}$/u;
const HEX64 = /^[0-9a-f]{64}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const HOST_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/u;
const MAX_HOST_BYTES = 253;
const MAX_CREDENTIALS = 16;
const MAX_LISTENER_PORT = 65_535;

function invalid(): never { throw new Error("staging_case_control_runtime_config_invalid"); }

function exactRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" || !fields.includes(key))) invalid();
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) invalid();
  }
  return value as Record<string, unknown>;
}

function allowedRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) invalid();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !fields.includes(key)) invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) invalid();
  }
  return value as Record<string, unknown>;
}

function exactArray(value: unknown, min: number, max: number): readonly unknown[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    !Number.isSafeInteger(value.length) || value.length < min || value.length > max) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" &&
    (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)))) invalid();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) invalid();
  }
  return value;
}

function text(value: unknown, expression: RegExp, bytes: number): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value ||
    Buffer.byteLength(value, "utf8") > bytes || !expression.test(value)) invalid();
  return value;
}

function captureStrings(value: unknown, expression: RegExp, maxBytes: number, min: number, max: number): readonly string[] {
  const input = exactArray(value, min, max);
  const result = input.map((entry) => text(entry, expression, maxBytes));
  if (new Set(result).size !== result.length) invalid();
  return Object.freeze(result);
}

function configuredHost(value: string): boolean {
  const match = /^(.*?)(?::([1-9][0-9]{0,4}))?$/u.exec(value);
  return !!match && HOST_NAME.test(match[1]!) &&
    (match[2] === undefined || Number(match[2]) <= 65_535);
}

function captureHosts(value: unknown): readonly string[] {
  const hosts = exactArray(value, 1, 16).map((entry) => {
    if (typeof entry !== "string" || entry.length === 0 || entry.trim() !== entry ||
      entry !== entry.toLowerCase() || Buffer.byteLength(entry, "utf8") > MAX_HOST_BYTES ||
      !configuredHost(entry)) invalid();
    return entry;
  });
  if (new Set(hosts).size !== hosts.length) invalid();
  return Object.freeze(hosts);
}

function captureActorRegistry(value: unknown): readonly ActorRegistration[] {
  const entries = exactArray(value, 1, 256).map((entry) => {
    const record = allowedRecord(entry, ["actorId", "actorClass", "departmentId"]);
    const actorId = text(record.actorId, ACTOR_ID, 256);
    const actorClass = record.actorClass;
    if (typeof actorClass !== "string" || ![
      "citizen", "public", "administration", "council", "case_steward",
      "department_agent", "department_reviewer", "participation_reviewer",
    ].includes(actorClass)) invalid();
    const needsDepartment = actorClass === "department_agent" || actorClass === "department_reviewer";
    if (record.departmentId !== undefined && (typeof record.departmentId !== "string" || !MUNICIPALITY_ID.test(record.departmentId))) invalid();
    if (needsDepartment !== (record.departmentId !== undefined)) invalid();
    return Object.freeze(record.departmentId === undefined
      ? { actorId, actorClass }
      : { actorId, actorClass, departmentId: record.departmentId }) as ActorRegistration;
  });
  if (new Set(entries.map((entry) => entry.actorId)).size !== entries.length ||
    !entries.some((entry) => entry.actorClass === "case_steward")) invalid();
  return Object.freeze(entries);
}

function captureCredentials(value: unknown, municipalityId: string, registry: readonly ActorRegistration[]): readonly StagingCaseStewardCredential[] {
  const credentials = exactArray(value, 1, MAX_CREDENTIALS).map((entry) => {
    const record = exactRecord(entry, ["principal", "token"]);
    const principal = exactRecord(record.principal, ["actorId", "actorClass", "municipalityIds"]);
    const actorId = text(principal.actorId, ACTOR_ID, 256);
    if (principal.actorClass !== "case_steward") invalid();
    const municipalityIds = captureStrings(principal.municipalityIds, MUNICIPALITY_ID, 63, 1, 16);
    if (!municipalityIds.includes(municipalityId) || typeof record.token !== "string") invalid();
    const registration = registry.find((entry) => entry.actorId === actorId);
    if (!registration || registration.actorClass !== "case_steward") invalid();
    return Object.freeze({
      principal: Object.freeze({ actorId, actorClass: "case_steward" as const, municipalityIds }),
      token: record.token,
    });
  });
  if (new Set(credentials.map((entry) => entry.principal.actorId)).size !== credentials.length) invalid();
  return Object.freeze(credentials);
}

function captureListener(value: unknown): StagingCaseControlListenerPlan {
  const record = exactRecord(value, ["host", "port"]);
  if (record.host !== "127.0.0.1" || !Number.isSafeInteger(record.port) ||
    (record.port as number) < 0 || (record.port as number) > MAX_LISTENER_PORT) invalid();
  return Object.freeze({ host: "127.0.0.1", port: record.port as number });
}

function captureDurableState(value: unknown): DurableSingleWriterState | undefined {
  if (value === undefined) return undefined;
  const parsed = exactRecord(value, ["mode", "sourceReleaseDigest"]);
  if (parsed.mode !== "durable_single_writer" || typeof parsed.sourceReleaseDigest !== "string" ||
    !SHA256.test(parsed.sourceReleaseDigest)) invalid();
  return Object.freeze({
    mode: "durable_single_writer" as const,
    sourceReleaseDigest: parsed.sourceReleaseDigest,
  });
}

function captureRecoveryGateInput(value: unknown): StagingCaseRecoveryGateInput {
  const parsed = exactRecord(value, [
    "recoveryPolicySource", "recoveryPolicyPinSource", "shutdownSealSource",
    "catalogLocatorSource", "recoveryAttestationSource", "clock",
  ]);
  return Object.freeze({
    recoveryPolicySource: parsed.recoveryPolicySource as StagingCaseRecoveryGateInput["recoveryPolicySource"],
    recoveryPolicyPinSource: parsed.recoveryPolicyPinSource as StagingCaseRecoveryGateInput["recoveryPolicyPinSource"],
    shutdownSealSource: parsed.shutdownSealSource as StagingCaseRecoveryGateInput["shutdownSealSource"],
    catalogLocatorSource: parsed.catalogLocatorSource as StagingCaseRecoveryGateInput["catalogLocatorSource"],
    recoveryAttestationSource: parsed.recoveryAttestationSource as StagingCaseRecoveryGateInput["recoveryAttestationSource"],
    clock: parsed.clock as StagingCaseRecoveryGateInput["clock"],
  });
}

function captureConfig(input: StagingCaseControlRuntimeConfig): CapturedConfig {
  const parsed = allowedRecord(input, [
    "deploymentEnvironment", "rootDir", "municipalityId", "policyVersion", "actorRegistry",
    "allowedSignerPubkeys", "allowedAgentPubkeys", "requiredDepartmentIds", "credentials",
    "admissionAllowedHosts", "outboxAllowedHosts", "probeAllowedHosts", "listeners", "drainTimeoutMs", "durableState",
  ]);
  const expected = [
    "deploymentEnvironment", "rootDir", "municipalityId", "policyVersion", "actorRegistry",
    "allowedSignerPubkeys", "allowedAgentPubkeys", "credentials", "admissionAllowedHosts",
    "outboxAllowedHosts", "probeAllowedHosts", "listeners", "drainTimeoutMs",
  ];
  for (const field of expected) if (!(field in parsed)) invalid();
  if (parsed.deploymentEnvironment !== "staging" || typeof parsed.rootDir !== "string" ||
    parsed.rootDir.length === 0 || parsed.rootDir.trim() !== parsed.rootDir) invalid();
  const municipalityId = text(parsed.municipalityId, MUNICIPALITY_ID, 63);
  const policyVersion = text(parsed.policyVersion, POLICY_VERSION, 256);
  const actorRegistry = captureActorRegistry(parsed.actorRegistry);
  const requiredDepartmentIds = parsed.requiredDepartmentIds === undefined ? undefined :
    captureStrings(parsed.requiredDepartmentIds, MUNICIPALITY_ID, 63, 8, 8);
  const allowedSignerPubkeys = captureStrings(parsed.allowedSignerPubkeys, HEX64, 64, 1, 64);
  const allowedAgentPubkeys = captureStrings(parsed.allowedAgentPubkeys, HEX64, 64, 1, 64);
  const credentials = captureCredentials(parsed.credentials, municipalityId, actorRegistry);
  const listeners = exactRecord(parsed.listeners, ["probe", "outbox", "admission"]);
  if (!Number.isSafeInteger(parsed.drainTimeoutMs) || (parsed.drainTimeoutMs as number) < 100 ||
    (parsed.drainTimeoutMs as number) > 10_000) invalid();
  return Object.freeze({
    rootDir: parsed.rootDir, municipalityId, policyVersion, actorRegistry, allowedSignerPubkeys,
    allowedAgentPubkeys, requiredDepartmentIds, credentials,
    admissionAllowedHosts: captureHosts(parsed.admissionAllowedHosts),
    outboxAllowedHosts: captureHosts(parsed.outboxAllowedHosts),
    probeAllowedHosts: captureHosts(parsed.probeAllowedHosts),
    listeners: Object.freeze({
      probe: captureListener(listeners.probe), outbox: captureListener(listeners.outbox),
      admission: captureListener(listeners.admission),
    }),
    drainTimeoutMs: parsed.drainTimeoutMs as number,
    durableState: captureDurableState(parsed.durableState),
  });
}

function captureOperationsApplication(
  value: unknown,
  deployment: StagingCaseControlDeploymentRuntimeFacts,
): CapturedConfig {
  const parsed = allowedRecord(value, [
    "municipalityId", "policyVersion", "actorRegistry", "allowedSignerPubkeys", "allowedAgentPubkeys",
    "requiredDepartmentIds", "credentials", "admissionAllowedHosts", "outboxAllowedHosts",
    "probeAllowedHosts", "drainTimeoutMs",
  ]);
  for (const field of [
    "municipalityId", "policyVersion", "actorRegistry", "allowedSignerPubkeys", "allowedAgentPubkeys",
    "credentials", "admissionAllowedHosts", "outboxAllowedHosts", "probeAllowedHosts", "drainTimeoutMs",
  ]) if (!(field in parsed)) invalid();
  if (parsed.municipalityId !== deployment.municipalityId) invalid();
  return captureConfig({
    deploymentEnvironment: "staging",
    rootDir: deployment.durableRootDir,
    municipalityId: parsed.municipalityId as string,
    policyVersion: parsed.policyVersion as string,
    actorRegistry: parsed.actorRegistry as readonly ActorRegistration[],
    allowedSignerPubkeys: parsed.allowedSignerPubkeys as readonly string[],
    allowedAgentPubkeys: parsed.allowedAgentPubkeys as readonly string[],
    ...(parsed.requiredDepartmentIds === undefined ? {} : {
      requiredDepartmentIds: parsed.requiredDepartmentIds as readonly string[],
    }),
    credentials: parsed.credentials as readonly StagingCaseStewardCredential[],
    admissionAllowedHosts: parsed.admissionAllowedHosts as readonly string[],
    outboxAllowedHosts: parsed.outboxAllowedHosts as readonly string[],
    probeAllowedHosts: parsed.probeAllowedHosts as readonly string[],
    // Validation-only reference plans. The deployment composition below never
    // receives these hosts or ports and instead consumes opaque bind plans.
    listeners: {
      probe: { host: "127.0.0.1", port: 0 },
      outbox: { host: "127.0.0.1", port: 0 },
      admission: { host: "127.0.0.1", port: 0 },
    },
    drainTimeoutMs: parsed.drainTimeoutMs as number,
    durableState: Object.freeze({
      mode: "durable_single_writer" as const,
      sourceReleaseDigest: deployment.releaseDigest,
    }),
  });
}

function deploymentPlans(proofValue: unknown): DeploymentListenerPlans {
  const plans = createStagingCaseControlListenerBindPlans(proofValue);
  const find = (id: "admission" | "private-outbox" | "probe"): StagingCaseControlListenerBindPlan => {
    const plan = plans.find((candidate) => assertStagingCaseControlListenerBindPlan(candidate).id === id);
    if (!plan) invalid();
    return plan;
  };
  return Object.freeze({
    probe: find("probe"),
    outbox: find("private-outbox"),
    admission: find("admission"),
  });
}

function composeStagingCaseControlRuntime(
  config: CapturedConfig,
  deployedListeners?: DeploymentListenerPlans,
  deploymentClaimToken?: CaseDurableDeploymentClaimToken,
  recoveryActivationAuthorization?: StagingCaseRecoveryActivationAuthorization,
): StagingCaseControlRuntime {
  const sqliteOptions: SqliteAtomicTopicCaseAdmissionOptions = {
    rootDir: config.rootDir,
    municipalityId: config.municipalityId,
    policyVersion: config.policyVersion,
    actorRegistry: config.actorRegistry,
    allowedSignerPubkeys: config.allowedSignerPubkeys,
    allowedAgentPubkeys: config.allowedAgentPubkeys,
    ...(config.requiredDepartmentIds === undefined ? {} : { requiredDepartmentIds: config.requiredDepartmentIds }),
    ...(config.durableState === undefined ? {} : { durableState: config.durableState }),
    ...(deploymentClaimToken === undefined ? {} : { deploymentClaimToken }),
    ...(recoveryActivationAuthorization === undefined ? {} : { recoveryActivationAuthorization }),
  };
  let durable: ReturnType<typeof createSqliteAtomicTopicCaseAdmission> | null = null;
  let released = false;
  // A recovery marker is the durable proof that the restored target is still
  // mid-activation.  Until every listener has become ready it must survive
  // any failed freshness check, bind failure, or early close.  In particular,
  // do not turn a failed recovery into a clean target seal merely because the
  // lifecycle's rollback invokes its release callback.
  let recoveryReadyForSeal = recoveryActivationAuthorization === undefined;
  const release = (): void => {
    if (released) return;
    if (durable) {
      if (config.durableState && recoveryReadyForSeal) durable.sealAndClose();
      else durable.close();
    }
    released = true;
  };

  try {
    durable = createSqliteAtomicTopicCaseAdmission(sqliteOptions);
    // The durable owner, including any recovery activation, is established
    // before credentials or listener-bearing services are constructed.
    const authenticator = createStagingCaseStewardTokenAuthenticator({
      deploymentEnvironment: "staging",
      credentials: config.credentials,
    });
    const control = createRoebelCaseStewardControlService({
      municipalityId: config.municipalityId,
      policyVersion: config.policyVersion,
      allowedAgentPubkeys: config.allowedAgentPubkeys,
      caseStewardAuthenticator: authenticator,
      atomicAdmission: durable.admission,
    });
    const admission = createRoebelCaseStewardControlServer({
      allowedHosts: config.admissionAllowedHosts,
      control,
    });
    const outbox = createCredentialFreeCaseBindingOutboxServer({
      allowedHosts: config.outboxAllowedHosts,
      outbox: durable.outbox,
    });
    let lifecycle: StagingCaseControlRuntime | null = null;
    const probe = createStagingRuntimeProbeServer({
      allowedHosts: config.probeAllowedHosts,
      health: () => lifecycle === null
        ? Object.freeze({ phase: "new", ready: false })
        : (() => {
          const health = lifecycle.health();
          return Object.freeze({ phase: health.phase, ready: health.ready });
        })(),
    });
    lifecycle = createStagingCaseProcessLifecycle({
      listeners: deployedListeners ? [
        { id: "probe", server: probe.server, bindPlan: deployedListeners.probe },
        { id: "outbox", server: outbox.server, bindPlan: deployedListeners.outbox },
        { id: "admission", server: admission.server, bindPlan: deployedListeners.admission },
      ] : [
        { id: "probe", server: probe.server, host: config.listeners.probe.host, port: config.listeners.probe.port },
        { id: "outbox", server: outbox.server, host: config.listeners.outbox.host, port: config.listeners.outbox.port },
        { id: "admission", server: admission.server, host: config.listeners.admission.host, port: config.listeners.admission.port },
      ],
      release,
      drainTimeoutMs: config.drainTimeoutMs,
      ...(recoveryActivationAuthorization === undefined ? {} : {
        beforeBind: () => assertStagingCaseRecoveryActivationAuthorizationFresh(recoveryActivationAuthorization),
      }),
    });
    const start = async (): Promise<void> => {
      await lifecycle.start();
      // This continuation only runs after all three children have reported
      // ready. If close raced with startup, lifecycle reports stopped/draining
      // instead and recovery remains on the non-sealing abort path.
      if (lifecycle.health().ready) recoveryReadyForSeal = true;
    };
    return Object.freeze({ start, health: lifecycle.health, close: lifecycle.close });
  } catch (error) {
    release();
    throw error;
  }
}

/**
 * Compose the private Case owner used by the loopback staging tracer.  It has
 * one SQLite owner, an authenticated staff admission server, a credential-free
 * private outbox server, and a capability-free health probe.  This is not a
 * Kubernetes bind adapter and deliberately cannot expose `0.0.0.0`.
 */
export function createStagingCaseControlRuntime(
  input: StagingCaseControlRuntimeConfig,
): StagingCaseControlRuntime {
  const config = captureConfig(input);
  return composeStagingCaseControlRuntime(config);
}

/**
 * Reviewed deployment composition for the single private Case owner. The
 * preflight completes before credentials, SQLite, servers or sockets exist;
 * only its opaque listener plans can authorize the fixed Pod-network binds.
 */
export function createOperationsBoundStagingCaseControlRuntime(
  input: OperationsBoundStagingCaseControlRuntimeConfig,
): StagingCaseControlRuntime {
  const parsed = exactRecord(input, ["reviewedBindingSource", "bindingPinSource", "storageObserver", "application"]);
  const proof = createStagingCaseControlDeploymentProofFromReviewedSources({
    reviewedBindingSource: parsed.reviewedBindingSource as StagingCaseControlReviewedBindingSource,
    bindingPinSource: parsed.bindingPinSource as StagingCaseControlBindingPinSource,
    storageObserver: parsed.storageObserver as StagingCaseControlStorageObserver,
  });
  const deployment = consumeStagingCaseControlDeploymentProofForRuntime(proof);
  const config = captureOperationsApplication(parsed.application, deployment);
  return composeStagingCaseControlRuntime(
    config,
    deploymentPlans(proof),
    createCaseDurableDeploymentClaimToken(proof),
  );
}

/**
 * Recovery-only reviewed composition. The signed evidence is constructed and
 * consumed inside the durable-owner critical section, before credentials,
 * municipal SQLite, servers or Pod-network listeners exist.
 */
export function createRecoveryActivatedOperationsBoundStagingCaseControlRuntime(
  input: RecoveryActivatedOperationsBoundStagingCaseControlRuntimeConfig,
): StagingCaseControlRuntime {
  const parsed = exactRecord(input, [
    "reviewedBindingSource", "bindingPinSource", "storageObserver", "recovery", "application",
  ]);
  const proof = createStagingCaseControlDeploymentProofFromReviewedSources({
    reviewedBindingSource: parsed.reviewedBindingSource as StagingCaseControlReviewedBindingSource,
    bindingPinSource: parsed.bindingPinSource as StagingCaseControlBindingPinSource,
    storageObserver: parsed.storageObserver as StagingCaseControlStorageObserver,
  });
  const deployment = consumeStagingCaseControlDeploymentProofForRuntime(proof);
  const recovery = captureRecoveryGateInput(parsed.recovery);
  const config = captureOperationsApplication(parsed.application, deployment);
  const deploymentClaimToken = createCaseDurableDeploymentClaimToken(proof);
  const recoveryActivationAuthorization = createStagingCaseRecoveryActivationAuthorization({
    targetDeploymentClaimToken: deploymentClaimToken,
    recovery,
  });
  return composeStagingCaseControlRuntime(
    config,
    deploymentPlans(proof),
    deploymentClaimToken,
    recoveryActivationAuthorization,
  );
}
