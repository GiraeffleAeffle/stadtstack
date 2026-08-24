import { types as utilTypes } from "node:util";

import { createCaseBindingOutboxProjector } from "./case-binding-outbox-projector.ts";
import { createCredentialFreeCaseBindingOutboxHttpClient } from "./credential-free-case-binding-outbox-http-client.ts";
import { createPublicCaseBindingServer } from "./public-case-binding-server.ts";
import {
  createStagingCaseRuntimeLifecycle,
  type StagingCaseRuntimeLifecycle,
  type StagingCaseRuntimePhase,
} from "./staging-case-runtime-lifecycle.ts";
import { createStagingRuntimeProbeServer } from "./staging-runtime-probe-server.ts";

/**
 * Composition root for the public half of ADR 0021.  This module owns neither
 * Case admission nor durable state: it can receive only the private, read-only
 * outbox origin and exposes only a receipt-verified public reader plus an
 * intentionally redacted probe.
 */
export type StagingPublicCaseBindingRuntimeConfig = Readonly<{
  outboxOrigin: string;
  publicAllowedHosts: readonly string[];
  probeAllowedHosts: readonly string[];
  publicListener: Readonly<{ host: "127.0.0.1"; port: number }>;
  probeListener: Readonly<{ host: "127.0.0.1"; port: number }>;
  reconcileIntervalMs: number;
  drainTimeoutMs: number;
}>;

export type StagingPublicCaseBindingRuntimeHealth = Readonly<{
  phase: StagingPublicCaseBindingRuntimePhase;
  ready: boolean;
  detail:
    | "not_started"
    | "starting"
    | "ready"
    | "outbox_unavailable"
    | "draining"
    | "stopped"
    | "start_failed";
  /** Listener ports are composition-facing only; the probe never receives them. */
  ports: Readonly<{ public: number | null; probe: number | null }>;
}>;

export type StagingPublicCaseBindingRuntime = Readonly<{
  start(): Promise<void>;
  health(): StagingPublicCaseBindingRuntimeHealth;
  close(): Promise<void>;
}>;

type Listener = Readonly<{ host: "127.0.0.1"; port: number }>;
/** `degraded` means verified public bytes remain available while the next
 * private outbox pull failed. It is deliberately not `ready: false` under the
 * `ready` phase: the probe contract rejects that ambiguous state. */
export type StagingPublicCaseBindingRuntimePhase = StagingCaseRuntimePhase | "degraded";
type CapturedConfig = Readonly<{
  outboxOrigin: string;
  publicAllowedHosts: readonly string[];
  probeAllowedHosts: readonly string[];
  publicListener: Listener;
  probeListener: Listener;
  reconcileIntervalMs: number;
  drainTimeoutMs: number;
}>;
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*|127\.0\.0\.1|localhost)(?::[1-9][0-9]{0,4})?$/u;

const DETAILS: Readonly<Record<StagingPublicCaseBindingRuntimePhase, StagingPublicCaseBindingRuntimeHealth["detail"]>> = Object.freeze({
  new: "not_started",
  starting: "starting",
  ready: "ready",
  degraded: "outbox_unavailable",
  draining: "draining",
  stopped: "stopped",
  failed: "start_failed",
});
function fail(code: string): never { throw new Error(code); }

function exactObject(value: unknown, fields: readonly string[], code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" || !fields.includes(key))) fail(code);
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail(code);
  }
  return value as Record<string, unknown>;
}

function exactHostArray(value: unknown, code: string): readonly string[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < 1 || value.length > 16) fail(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" &&
    (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)))) fail(code);
  const captured: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable || typeof descriptor.value !== "string" ||
      Buffer.byteLength(descriptor.value, "utf8") === 0 || Buffer.byteLength(descriptor.value, "utf8") > 253 ||
      descriptor.value !== descriptor.value.toLowerCase() || !HOST.test(descriptor.value)) fail(code);
    captured.push(descriptor.value);
  }
  if (new Set(captured).size !== captured.length) fail(code);
  return Object.freeze(captured);
}

function captureListener(value: unknown, code: string): Listener {
  const listener = exactObject(value, ["host", "port"], code);
  if (listener.host !== "127.0.0.1" || !Number.isSafeInteger(listener.port) ||
    (listener.port as number) < 0 || (listener.port as number) > 65_535) fail(code);
  return Object.freeze({ host: "127.0.0.1", port: listener.port as number });
}

/**
 * The reference composition reaches the private outbox over a loopback-only
 * bridge.  Keep this stricter than the generic credential-free HTTP client:
 * an Operations adapter may deliberately use another private transport, but
 * this public entrypoint must not acquire a DNS, Service, or external route
 * merely through configuration.
 */
function captureLoopbackOutboxOrigin(value: unknown, code: string): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") === 0 ||
    Buffer.byteLength(value, "utf8") > 512) fail(code);
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    fail(code);
  }
  const port = Number(origin.port);
  if (origin.toString() !== value || origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1" || origin.port === "" ||
    !Number.isSafeInteger(port) || port < 1 || port > 65_535 ||
    origin.username !== "" || origin.password !== "" ||
    origin.pathname !== "/" || origin.search !== "" || origin.hash !== "") fail(code);
  return value;
}

function captureConfig(value: StagingPublicCaseBindingRuntimeConfig): CapturedConfig {
  const config = exactObject(value, [
    "outboxOrigin",
    "publicAllowedHosts",
    "probeAllowedHosts",
    "publicListener",
    "probeListener",
    "reconcileIntervalMs",
    "drainTimeoutMs",
  ], "staging_public_case_binding_runtime_config_invalid");
  if (!Number.isSafeInteger(config.reconcileIntervalMs) || (config.reconcileIntervalMs as number) < 100 ||
    (config.reconcileIntervalMs as number) > 3_600_000 ||
    !Number.isSafeInteger(config.drainTimeoutMs) || (config.drainTimeoutMs as number) < 100 ||
    (config.drainTimeoutMs as number) > 10_000) fail("staging_public_case_binding_runtime_config_invalid");
  const publicListener = captureListener(config.publicListener, "staging_public_case_binding_runtime_config_invalid");
  const probeListener = captureListener(config.probeListener, "staging_public_case_binding_runtime_config_invalid");
  if (publicListener.port !== 0 && publicListener.port === probeListener.port) fail("staging_public_case_binding_runtime_config_invalid");
  return Object.freeze({
    outboxOrigin: captureLoopbackOutboxOrigin(config.outboxOrigin, "staging_public_case_binding_runtime_config_invalid"),
    publicAllowedHosts: exactHostArray(config.publicAllowedHosts, "staging_public_case_binding_runtime_config_invalid"),
    probeAllowedHosts: exactHostArray(config.probeAllowedHosts, "staging_public_case_binding_runtime_config_invalid"),
    publicListener,
    probeListener,
    reconcileIntervalMs: config.reconcileIntervalMs as number,
    drainTimeoutMs: config.drainTimeoutMs as number,
  });
}

function startFailed(): Error { return new Error("staging_public_case_binding_runtime_start_failed"); }

/**
 * The probe listener is bound first so orchestration can distinguish a process
 * that is alive-but-hydrating from a ready public reader.  The public listener
 * is not even bound until the full sequence-zero replay has verified.
 */
export function createStagingPublicCaseBindingRuntime(
  input: StagingPublicCaseBindingRuntimeConfig,
): StagingPublicCaseBindingRuntime {
  const config = captureConfig(input);
  const outboxAbort = new AbortController();
  const outbox = createCredentialFreeCaseBindingOutboxHttpClient(
    { origin: config.outboxOrigin },
    outboxAbort.signal,
  );
  let phase: StagingPublicCaseBindingRuntimePhase = "new";
  let outboxAvailable = false;
  let closingRequested = false;
  let startPromise: Promise<void> | null = null;
  let closePromise: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reconcilePromise: Promise<void> | null = null;
  let probeLifecycle: StagingCaseRuntimeLifecycle | null = null;
  let publicLifecycle: StagingCaseRuntimeLifecycle | null = null;

  const probe = createStagingRuntimeProbeServer({
    allowedHosts: config.probeAllowedHosts,
    health: () => Object.freeze({ phase, ready: phase === "ready" && outboxAvailable }),
  });
  const probeChild = createStagingCaseRuntimeLifecycle({
    server: probe.server,
    listener: config.probeListener,
    release: () => undefined,
    drainTimeoutMs: config.drainTimeoutMs,
  });
  probeLifecycle = probeChild;

  function health(): StagingPublicCaseBindingRuntimeHealth {
    const probeHealth = probeLifecycle?.health();
    const publicHealth = publicLifecycle?.health();
    const ports = Object.freeze({
      public: publicHealth?.port ?? null,
      probe: probeHealth?.port ?? null,
    });
    return Object.freeze({
      phase,
      ready: phase === "ready" && outboxAvailable,
      detail: DETAILS[phase],
      ports,
    });
  }

  async function stopChildren(): Promise<void> {
    if (publicLifecycle) await publicLifecycle.close();
    if (probeLifecycle) await probeLifecycle.close();
  }

  function clearReconcileTimer(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function scheduleReconcile(reconcile: () => Promise<unknown>): void {
    if (closingRequested || phase === "failed" || phase === "stopped") return;
    clearReconcileTimer();
    timer = setTimeout(() => {
      timer = null;
      const operation = (async () => {
        try {
          await reconcile();
          if (!closingRequested && (phase === "ready" || phase === "degraded")) {
            outboxAvailable = true;
            phase = "ready";
          }
        } catch {
          // The projector applies only after validating every pending entry, so
          // a failed pull leaves the previously served receipt bytes intact.
          if (!closingRequested && (phase === "ready" || phase === "degraded")) {
            outboxAvailable = false;
            phase = "degraded";
          }
        } finally {
          if (!closingRequested && (phase === "ready" || phase === "degraded")) scheduleReconcile(reconcile);
        }
      })();
      reconcilePromise = operation;
      void operation.then(
        () => { if (reconcilePromise === operation) reconcilePromise = null; },
        () => { if (reconcilePromise === operation) reconcilePromise = null; },
      );
    }, config.reconcileIntervalMs);
  }

  function start(): Promise<void> {
    if (startPromise) return startPromise;
    if (phase === "stopped") return Promise.resolve();
    if (phase !== "new") return Promise.reject(startFailed());
    phase = "starting";
    startPromise = (async () => {
      try {
        // The probe comes up before any private outbox I/O.  It receives no
        // cursor, origin, error, server, or lifecycle capability.
        await probeChild.start();
        const projection = await createCaseBindingOutboxProjector(outbox);
        if (closingRequested) {
          return;
        }
        const publicServer = createPublicCaseBindingServer({
          allowedHosts: config.publicAllowedHosts,
          reader: projection.reader,
        });
        const child = createStagingCaseRuntimeLifecycle({
          server: publicServer.server,
          listener: config.publicListener,
          release: () => undefined,
          drainTimeoutMs: config.drainTimeoutMs,
        });
        publicLifecycle = child;
        await child.start();
        if (closingRequested) {
          return;
        }
        outboxAvailable = true;
        phase = "ready";
        scheduleReconcile(projection.reconcile);
      } catch {
        outboxAvailable = false;
        if (!closingRequested) phase = "failed";
        clearReconcileTimer();
        await stopChildren();
        if (closingRequested) {
          phase = "stopped";
          return;
        }
        throw startFailed();
      }
    })();
    return startPromise;
  }

  function close(): Promise<void> {
    if (closePromise) return closePromise;
    closingRequested = true;
    clearReconcileTimer();
    outboxAbort.abort();
    if (phase === "new") phase = "draining";
    else if (phase === "starting" || phase === "ready" || phase === "degraded") phase = "draining";
    closePromise = (async () => {
      // Public is drained first. Aborting the private client bounds both an
      // initial hydrate and an in-flight periodic replay; awaiting the start
      // and replay promises prevents hidden work from surviving `close()`.
      await stopChildren();
      if (startPromise) {
        try { await startPromise; } catch { /* a redacted start failure is already reflected in health */ }
      }
      if (reconcilePromise) await reconcilePromise;
      // A start/close race may have assigned a child after the first snapshot.
      await stopChildren();
      outboxAvailable = false;
      phase = "stopped";
    })();
    return closePromise;
  }

  return Object.freeze({ start, health, close });
}
