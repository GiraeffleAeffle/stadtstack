import { Server } from "node:http";
import { types as utilTypes } from "node:util";

import {
  createStagingCaseRuntimeLifecycle,
  type StagingCaseRuntimePhase,
} from "./staging-case-runtime-lifecycle.ts";
import {
  assertStagingCaseControlListenerBindPlan,
  type StagingCaseControlListenerBindPlan,
} from "./staging-case-control-preflight.ts";

export const STAGING_CASE_PROCESS_PHASES = [
  "new",
  "starting",
  "ready",
  "draining",
  "stopped",
  "failed",
] as const;

export type StagingCaseProcessPhase = (typeof STAGING_CASE_PROCESS_PHASES)[number];

export type StagingCaseProcessHealth = Readonly<{
  phase: StagingCaseProcessPhase;
  ready: boolean;
  /** Stable operational status; never a bind error, host, or exception. */
  detail: "not_started" | "starting" | "ready" | "draining" | "stopped" | "start_failed";
  /** Actual ports are available only while every listener is ready. */
  ports: Readonly<Record<string, number>>;
}>;

export type StagingCaseProcessLoopbackListener = {
  id: string;
  server: Server;
  /**
   * The process lifecycle is intentionally loopback-only until a separately
   * reviewed Service + NetworkPolicy composition gate permits another host.
   */
  host: "127.0.0.1";
  port: number;
};

export type StagingCaseProcessDeploymentListener = {
  id: "admission" | "outbox" | "probe";
  server: Server;
  bindPlan: StagingCaseControlListenerBindPlan;
};

export type StagingCaseProcessListener =
  | StagingCaseProcessLoopbackListener
  | StagingCaseProcessDeploymentListener;

export type StagingCaseProcessLifecycleConfig = {
  listeners: readonly StagingCaseProcessListener[];
  release: () => void | Promise<void>;
  drainTimeoutMs: number;
};

export type StagingCaseProcessLifecycle = Readonly<{
  start(): Promise<void>;
  health(): StagingCaseProcessHealth;
  close(): Promise<void>;
}>;

type CapturedListener = Readonly<{
  id: string;
  server: Server;
  listener: Readonly<{ host: "127.0.0.1"; port: number }> | StagingCaseControlListenerBindPlan;
}>;

const PROCESS_DETAILS: Readonly<Record<StagingCaseProcessPhase, StagingCaseProcessHealth["detail"]>> = Object.freeze({
  new: "not_started",
  starting: "starting",
  ready: "ready",
  draining: "draining",
  stopped: "stopped",
  failed: "start_failed",
});
const LISTENER_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const EMPTY_PORTS: Readonly<Record<string, number>> = Object.freeze({});

function invalid(): never { throw new Error("staging_case_process_config_invalid"); }
function startFailed(): Error { return new Error("staging_case_process_start_failed"); }
function releaseFailed(): Error { return new Error("staging_case_process_release_failed"); }

function exactObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
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

function exactArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < 1 || value.length > 4) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" &&
    (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)))) invalid();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) invalid();
  }
  return value;
}

function captureConfig(input: StagingCaseProcessLifecycleConfig): Readonly<{
  listeners: readonly CapturedListener[];
  release: () => void | Promise<void>;
  drainTimeoutMs: number;
}> {
  const parsed = exactObject(input, ["listeners", "release", "drainTimeoutMs"]);
  const rawListeners = exactArray(parsed.listeners);
  const ids = new Set<string>();
  const servers = new Set<Server>();
  const listeners: CapturedListener[] = [];
  for (const rawListener of rawListeners) {
    if (!rawListener || typeof rawListener !== "object" || Array.isArray(rawListener) || utilTypes.isProxy(rawListener) ||
      Object.getPrototypeOf(rawListener) !== Object.prototype) invalid();
    const keys = Reflect.ownKeys(rawListener);
    if (keys.length === 4 && keys.every((key) => key === "id" || key === "server" || key === "host" || key === "port")) {
      const listener = exactObject(rawListener, ["id", "server", "host", "port"]);
      if (typeof listener.id !== "string" || !LISTENER_ID.test(listener.id) || ids.has(listener.id) ||
        utilTypes.isProxy(listener.server) || !(listener.server instanceof Server) || servers.has(listener.server) ||
        listener.host !== "127.0.0.1" || !Number.isSafeInteger(listener.port) ||
        (listener.port as number) < 0 || (listener.port as number) > 65_535) invalid();
      ids.add(listener.id);
      servers.add(listener.server);
      listeners.push(Object.freeze({
        id: listener.id,
        server: listener.server,
        listener: Object.freeze({ host: "127.0.0.1" as const, port: listener.port as number }),
      }));
      continue;
    }

    const listener = exactObject(rawListener, ["id", "server", "bindPlan"]);
    if (typeof listener.id !== "string" || !LISTENER_ID.test(listener.id) || ids.has(listener.id) ||
      utilTypes.isProxy(listener.server) || !(listener.server instanceof Server) || servers.has(listener.server)) invalid();
    let deployment: ReturnType<typeof assertStagingCaseControlListenerBindPlan>;
    try { deployment = assertStagingCaseControlListenerBindPlan(listener.bindPlan); }
    catch { invalid(); }
    const expectedId = deployment.id === "private-outbox" ? "outbox" : deployment.id;
    if (listener.id !== expectedId) invalid();
    ids.add(listener.id);
    servers.add(listener.server);
    listeners.push(Object.freeze({
      id: listener.id,
      server: listener.server,
      listener: listener.bindPlan as StagingCaseControlListenerBindPlan,
    }));
  }
  if (typeof parsed.release !== "function" || utilTypes.isProxy(parsed.release) ||
    !Number.isSafeInteger(parsed.drainTimeoutMs) || (parsed.drainTimeoutMs as number) < 100 ||
    (parsed.drainTimeoutMs as number) > 10_000) invalid();
  return Object.freeze({
    listeners: Object.freeze(listeners),
    release: parsed.release as () => void | Promise<void>,
    drainTimeoutMs: parsed.drainTimeoutMs as number,
  });
}

/**
 * Starts the private control and public projection listeners as one bounded
 * process capability. It has no listener, server, callback, or dependency
 * accessor: the only operational surface is start, redacted health, and close.
 */
export function createStagingCaseProcessLifecycle(
  input: StagingCaseProcessLifecycleConfig,
): StagingCaseProcessLifecycle {
  const config = captureConfig(input);
  const children = config.listeners.map((listener) => Object.freeze({
    id: listener.id,
    lifecycle: createStagingCaseRuntimeLifecycle({
      server: listener.server,
      listener: listener.listener,
      release: () => undefined,
      drainTimeoutMs: config.drainTimeoutMs,
    }),
  }));

  let phase: StagingCaseProcessPhase = "new";
  let closingRequested = false;
  let startPromise: Promise<void> | null = null;
  let closePromise: Promise<void> | null = null;
  let releasePromise: Promise<void> | null = null;

  function invokeRelease(): Promise<void> {
    if (releasePromise) return releasePromise;
    releasePromise = Promise.resolve().then(() => config.release()).then(
      () => undefined,
      () => { throw releaseFailed(); },
    );
    return releasePromise;
  }

  async function stopChildrenInReverse(): Promise<void> {
    for (let index = children.length - 1; index >= 0; index -= 1) {
      await children[index]!.lifecycle.close();
    }
  }

  function readyPorts(): Readonly<Record<string, number>> {
    if (phase !== "ready") return EMPTY_PORTS;
    const ports: Record<string, number> = {};
    for (const child of children) {
      const health = child.lifecycle.health();
      if (!health.ready || health.port === null) return EMPTY_PORTS;
      ports[child.id] = health.port;
    }
    return Object.freeze(ports);
  }

  function health(): StagingCaseProcessHealth {
    return Object.freeze({
      phase,
      ready: phase === "ready",
      detail: PROCESS_DETAILS[phase],
      ports: readyPorts(),
    });
  }

  function start(): Promise<void> {
    if (startPromise) return startPromise;
    if (phase === "stopped") {
      startPromise = Promise.resolve();
      return startPromise;
    }
    if (phase !== "new") return Promise.reject(startFailed());
    phase = "starting";
    startPromise = (async () => {
      try {
        for (const child of children) {
          if (closingRequested) return;
          await child.lifecycle.start();
          const childHealth = child.lifecycle.health();
          if (!childHealth.ready || childHealth.port === null) throw startFailed();
        }
        if (!closingRequested) phase = "ready";
      } catch {
        phase = "failed";
        await stopChildrenInReverse();
        try { await invokeRelease(); } catch { /* start remains one redacted bind failure */ }
        throw startFailed();
      }
    })();
    return startPromise;
  }

  async function finishClose(): Promise<void> {
    if (startPromise) {
      try { await startPromise; } catch { /* failure cleanup is shared below */ }
    }
    await stopChildrenInReverse();
    phase = "stopped";
    await invokeRelease();
  }

  function close(): Promise<void> {
    if (closePromise) return closePromise;
    closingRequested = true;
    if (phase === "starting" || phase === "ready") phase = "draining";
    closePromise = finishClose().catch(async () => {
      phase = "stopped";
      await invokeRelease();
    });
    return closePromise;
  }

  return Object.freeze({ start, health, close });
}

/** Keeps the child phase type imported at this process boundary intentionally. */
export type StagingCaseProcessChildPhase = StagingCaseRuntimePhase;
