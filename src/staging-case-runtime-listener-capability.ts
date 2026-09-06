import { types as utilTypes } from "node:util";

/**
 * An opaque listener capability resolved by the process lifecycle after
 * reviewed control or public composition has verified a bind plan. The token carries
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

const CONTROL_PORTS: Readonly<Record<string, number>> = Object.freeze({
  admission: 18_085,
  "private-outbox": 18_087,
  probe: 18_088,
});
const PUBLIC_PORTS: Readonly<Record<string, number>> = Object.freeze({
  public: 18_086,
  "public-probe": 18_089,
});

const capabilityFacts = new WeakMap<object, ResolvedDeploymentListener>();

function invalid(): never {
  throw new Error("staging_case_runtime_listener_capability_invalid");
}

function captureDeploymentListener(value: unknown, ports: Readonly<Record<string, number>>): ResolvedDeploymentListener {
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
    typeof id !== "string" || !Object.hasOwn(ports, id) ||
    listener.host !== "0.0.0.0" ||
    typeof port !== "number" ||
    !Number.isSafeInteger(port) ||
    port !== ports[id]
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
  register(capability, listener, "staging_case_control_listener_bind_plan_v1", CONTROL_PORTS);
}

/** @internal Only the reviewed public runtime may register these two public ports. */
export function registerStagingPublicCaseBindingListenerCapability(
  capability: unknown,
  listener: unknown,
): void {
  register(capability, listener, "staging_public_case_binding_listener_bind_plan_v1", PUBLIC_PORTS);
}

function register(capability: unknown, listener: unknown, schema: string, ports: Readonly<Record<string, number>>): void {
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
      schema ||
    capabilityFacts.has(capability)
  ) {
    invalid();
  }
  capabilityFacts.set(capability, captureDeploymentListener(listener, ports));
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
