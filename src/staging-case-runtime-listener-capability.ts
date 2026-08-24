import { types as utilTypes } from "node:util";

/**
 * An opaque listener capability resolved by the private process lifecycle
 * after it has verified a control bind plan. The token intentionally carries
 * no host or port fields, so a serialized or structurally cloned value cannot
 * become a deployment listener.
 */
declare const stagingCaseRuntimeDeploymentListenerBrand: unique symbol;
export type StagingCaseRuntimeDeploymentListenerCapability = Readonly<{
  readonly [stagingCaseRuntimeDeploymentListenerBrand]: true;
}>;

type ResolvedDeploymentListener = Readonly<{
  host: "0.0.0.0";
  port: number;
}>;

type DeploymentListenerId = "admission" | "private-outbox" | "probe";
const DEPLOYMENT_PORTS: Readonly<Record<DeploymentListenerId, number>> = Object.freeze({
  admission: 18_085,
  "private-outbox": 18_087,
  probe: 18_088,
});

const capabilityFacts = new WeakMap<object, ResolvedDeploymentListener>();

function invalid(): never {
  throw new Error("staging_case_runtime_listener_capability_invalid");
}

function captureDeploymentListener(value: unknown): ResolvedDeploymentListener {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    invalid();
  }

  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 3 ||
    keys.some((key) => typeof key !== "string" ||
      (key !== "id" && key !== "host" && key !== "port"))
  ) {
    invalid();
  }

  for (const key of ["id", "host", "port"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      invalid();
    }
  }

  const listener = value as { id?: unknown; host?: unknown; port?: unknown };
  const id = listener.id;
  const port = listener.port;
  if (
    (id !== "admission" && id !== "private-outbox" && id !== "probe") ||
    listener.host !== "0.0.0.0" ||
    typeof port !== "number" ||
    !Number.isSafeInteger(port) ||
    port !== DEPLOYMENT_PORTS[id as DeploymentListenerId]
  ) {
    invalid();
  }

  return Object.freeze({ host: "0.0.0.0" as const, port });
}

/**
 * Associates a preflight-created opaque bind plan with its resolved listener.
 * This is an internal registration seam, not a public constructor: CI permits
 * only the preflight module to import it. The registered object is the exact
 * opaque bind plan itself, so neither a raw tuple nor a structural clone can
 * become a listener capability.
 *
 * @internal Imported only by staging-case-control-preflight.ts.
 */
export function registerStagingCaseRuntimeDeploymentListenerCapability(
  capability: unknown,
  listener: unknown,
): void {
  if (
    !capability ||
    typeof capability !== "object" ||
    Array.isArray(capability) ||
    utilTypes.isProxy(capability) ||
    Object.getPrototypeOf(capability) !== Object.prototype ||
    !Object.isFrozen(capability) ||
    Reflect.ownKeys(capability).length !== 1 ||
    Reflect.ownKeys(capability)[0] !== "schemaVersion" ||
    Object.getOwnPropertyDescriptor(capability, "schemaVersion")?.enumerable !== true ||
    Object.getOwnPropertyDescriptor(capability, "schemaVersion")?.value !==
      "staging_case_control_listener_bind_plan_v1" ||
    capabilityFacts.has(capability)
  ) {
    invalid();
  }
  capabilityFacts.set(capability, captureDeploymentListener(listener));
}

/** Resolves only an exact plan registered by preflight; clones and arbitrary objects fail closed. */
export function captureStagingCaseRuntimeDeploymentListener(
  value: unknown,
): ResolvedDeploymentListener | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value)) {
    return undefined;
  }
  return capabilityFacts.get(value);
}
