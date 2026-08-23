import {
  consumeCaseDurableDeploymentClaimToken,
  sameCaseDurableDeploymentClaim,
  type CaseDurableDeploymentClaim,
  type CaseDurableDeploymentClaimToken,
} from "./case-durable-deployment-claim.ts";
import { type CaseShutdownSealV2 } from "./case-shutdown-seal.ts";
import {
  consumeStagingCaseRecoveryGateForRuntime,
  createStagingCaseRecoveryGateFromReviewedSources,
  type StagingCaseRecoveryGateFacts,
  type StagingCaseRecoveryGateInput,
} from "./staging-case-recovery-attestation.ts";
import { types as utilTypes } from "node:util";

/** Opaque capability; only the reviewed composition root may construct one. */
export type StagingCaseRecoveryActivationAuthorization = Readonly<{
  readonly schemaVersion: "staging_case_recovery_activation_authorization_v1";
}>;
export type StagingCaseRecoveryActivationLease = Readonly<{
  readonly schemaVersion: "staging_case_recovery_activation_lease_v1";
}>;

type AuthorizationState = Readonly<{
  targetToken: CaseDurableDeploymentClaimToken;
  recovery: StagingCaseRecoveryGateInput;
}>;
type LeaseFacts = Readonly<{
  gate: StagingCaseRecoveryGateFacts;
  sourceClaim: CaseDurableDeploymentClaim;
  sourceSeal: CaseShutdownSealV2;
  targetClaim: CaseDurableDeploymentClaim;
}>;
const authorizations = new WeakMap<object, AuthorizationState>();
const leases = new WeakMap<object, LeaseFacts>();
const successfulActivations = new WeakMap<object, LeaseFacts>();
function fail(code: string): never { throw new Error(code); }

function captureInput(value: unknown): StagingCaseRecoveryGateInput {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) fail("staging_case_recovery_activation_authorization_invalid");
  const record = value as Record<string, unknown>;
  const fields = ["catalogLocatorSource", "clock", "recoveryAttestationSource", "recoveryPolicyPinSource", "recoveryPolicySource", "shutdownSealSource"];
  const keys = Reflect.ownKeys(record);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" || !fields.includes(key))) fail("staging_case_recovery_activation_authorization_invalid");
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable || !record[key] || typeof record[key] !== "object") fail("staging_case_recovery_activation_authorization_invalid");
  }
  return Object.freeze({
    recoveryPolicySource: record.recoveryPolicySource as StagingCaseRecoveryGateInput["recoveryPolicySource"],
    recoveryPolicyPinSource: record.recoveryPolicyPinSource as StagingCaseRecoveryGateInput["recoveryPolicyPinSource"],
    shutdownSealSource: record.shutdownSealSource as StagingCaseRecoveryGateInput["shutdownSealSource"],
    catalogLocatorSource: record.catalogLocatorSource as StagingCaseRecoveryGateInput["catalogLocatorSource"],
    recoveryAttestationSource: record.recoveryAttestationSource as StagingCaseRecoveryGateInput["recoveryAttestationSource"],
    clock: record.clock as StagingCaseRecoveryGateInput["clock"],
  });
}

export function createStagingCaseRecoveryActivationAuthorization(input: Readonly<{
  targetDeploymentClaimToken: CaseDurableDeploymentClaimToken;
  recovery: StagingCaseRecoveryGateInput;
}>): StagingCaseRecoveryActivationAuthorization {
  if (!input || typeof input !== "object" || Array.isArray(input) || utilTypes.isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).length !== 2 || !Object.hasOwn(input, "targetDeploymentClaimToken") || !Object.hasOwn(input, "recovery")) fail("staging_case_recovery_activation_authorization_invalid");
  for (const key of ["targetDeploymentClaimToken", "recovery"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail("staging_case_recovery_activation_authorization_invalid");
  }
  // Consume now only to reject shaped tokens; no source is read until owner lock.
  const targetToken = input.targetDeploymentClaimToken;
  consumeCaseDurableDeploymentClaimToken(targetToken);
  const authorization: StagingCaseRecoveryActivationAuthorization = Object.freeze({ schemaVersion: "staging_case_recovery_activation_authorization_v1" });
  authorizations.set(authorization, Object.freeze({ targetToken, recovery: captureInput(input.recovery) }));
  return authorization;
}

function factsFor(state: AuthorizationState, sourceClaim: CaseDurableDeploymentClaim, sourceSeal: CaseShutdownSealV2, database: Readonly<{ basename: string; byteLength: number; sha256: string }>): LeaseFacts {
  const targetClaim = consumeCaseDurableDeploymentClaimToken(state.targetToken);
  const gate = consumeStagingCaseRecoveryGateForRuntime(createStagingCaseRecoveryGateFromReviewedSources(state.recovery), state.recovery.clock);
  if (sourceSeal.deploymentClaimChecksum === null || sourceSeal.deploymentClaimChecksum !== sourceClaim.claimChecksum ||
    gate.municipalityId !== sourceClaim.municipalityId || gate.sourceReleaseDigest !== sourceClaim.releaseDigest ||
    gate.sourceDeploymentClaimChecksum !== sourceClaim.claimChecksum || gate.sourcePvcNamespace !== sourceClaim.pvc.namespace ||
    gate.sourcePvcName !== sourceClaim.pvc.name || gate.sourcePvcUid !== sourceClaim.pvc.uid ||
    gate.shutdownSealChecksum !== sourceSeal.sealChecksum || gate.databaseBasename !== database.basename ||
    gate.databaseByteLength !== database.byteLength || gate.databaseSha256 !== database.sha256 ||
    gate.municipalityId !== targetClaim.municipalityId || gate.controlDeploymentBindingChecksum !== targetClaim.controlDeploymentBindingChecksum ||
    gate.targetPvcNamespace !== targetClaim.pvc.namespace || gate.targetPvcName !== targetClaim.pvc.name ||
    gate.targetPvcUid !== targetClaim.pvc.uid || gate.targetPvName !== targetClaim.pvName) fail("staging_case_recovery_activation_authorization_mismatch");
  return Object.freeze({ gate, sourceClaim, sourceSeal, targetClaim });
}

/** @internal: durable adapter calls this only after acquiring its owner lock. */
export function consumeStagingCaseRecoveryActivationAuthorization(
  value: unknown,
  sourceClaim: CaseDurableDeploymentClaim,
  sourceSeal: CaseShutdownSealV2,
  database: Readonly<{ basename: string; byteLength: number; sha256: string }>,
): StagingCaseRecoveryActivationLease {
  if (!value || typeof value !== "object") fail("staging_case_recovery_activation_authorization_invalid");
  const state = authorizations.get(value);
  if (!state) fail("staging_case_recovery_activation_authorization_invalid");
  const lease: StagingCaseRecoveryActivationLease = Object.freeze({ schemaVersion: "staging_case_recovery_activation_lease_v1" });
  const facts = factsFor(state, sourceClaim, sourceSeal, database);
  leases.set(lease, facts);
  successfulActivations.set(value, facts);
  return lease;
}

/** @internal: returns facts only for a module-proven lock-held lease. */
export function consumeStagingCaseRecoveryActivationLease(value: unknown): LeaseFacts {
  if (!value || typeof value !== "object") fail("staging_case_recovery_activation_lease_invalid");
  const facts = leases.get(value);
  if (!facts) fail("staging_case_recovery_activation_lease_invalid");
  return facts;
}

/** Re-reads and reconsumes signed evidence immediately before listener bind. */
export function assertStagingCaseRecoveryActivationAuthorizationFresh(
  authorization: unknown,
): void {
  if (!authorization || typeof authorization !== "object") fail("staging_case_recovery_activation_authorization_invalid");
  const state = authorizations.get(authorization);
  const held = successfulActivations.get(authorization);
  if (!state || !held) fail("staging_case_recovery_activation_authorization_invalid");
  const fresh = factsFor(state, held.sourceClaim, held.sourceSeal, { basename: held.gate.databaseBasename, byteLength: held.gate.databaseByteLength, sha256: held.gate.databaseSha256 });
  const stable = (facts: LeaseFacts) => ({ ...facts.gate, verifiedAtUtc: undefined });
  if (new Date(fresh.gate.verifiedAtUtc).getTime() < new Date(held.gate.verifiedAtUtc).getTime() ||
    JSON.stringify(stable(fresh)) !== JSON.stringify(stable(held)) ||
    !sameCaseDurableDeploymentClaim(fresh.sourceClaim, held.sourceClaim) ||
    !sameCaseDurableDeploymentClaim(fresh.targetClaim, held.targetClaim)) {
    fail("staging_case_recovery_activation_authorization_stale");
  }
  // Every successful pre-bind check advances a process-local monotonic
  // watermark. A trusted wall clock may move forward, never backward.
  successfulActivations.set(authorization, fresh);
}
