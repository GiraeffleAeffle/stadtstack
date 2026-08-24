import {
  Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import { types as utilTypes } from "node:util";

import {
  captureStagingCaseRuntimeDeploymentListener,
  type StagingCaseRuntimeDeploymentListenerCapability,
} from "./staging-case-runtime-listener-capability.ts";

/**
 * The lifecycle is a listener-mechanics seam, not a server factory. Control
 * deployment bind plans stay in the private process lifecycle; this module
 * receives either a loopback tuple or an opaque capability minted after the
 * private lifecycle's bind-plan proof. It contains no Operations capability or
 * deployment proof verifier.
 */
export const STAGING_CASE_RUNTIME_PHASES = [
  "new",
  "starting",
  "ready",
  "draining",
  "stopped",
  "failed",
] as const;

export type StagingCaseRuntimePhase =
  (typeof STAGING_CASE_RUNTIME_PHASES)[number];

export type StagingCaseRuntimeHealth = Readonly<{
  phase: StagingCaseRuntimePhase;
  ready: boolean;
  /** A stable operational code; bind errors and exception messages never cross this boundary. */
  detail:
    | "not_started"
    | "starting"
    | "ready"
    | "draining"
    | "stopped"
    | "bind_failed";
  /** The actual port while ready; unavailable in every other phase. */
  port: number | null;
}>;

export type StagingCaseRuntimeLoopbackListener = Readonly<{
  host: "127.0.0.1";
  port: number;
}>;

export type StagingCaseRuntimeListener =
  | StagingCaseRuntimeLoopbackListener
  | StagingCaseRuntimeDeploymentListenerCapability;

export type StagingCaseRuntimeLifecycleConfig = {
  server: Server;
  listener: StagingCaseRuntimeListener;
  release: () => void | Promise<void>;
  drainTimeoutMs: number;
};

export type StagingCaseRuntimeLifecycle = Readonly<{
  start(): Promise<void>;
  health(): StagingCaseRuntimeHealth;
  close(): Promise<void>;
}>;

const PHASE_DETAILS: Readonly<Record<StagingCaseRuntimePhase, StagingCaseRuntimeHealth["detail"]>> =
  Object.freeze({
    new: "not_started",
    starting: "starting",
    ready: "ready",
    draining: "draining",
    stopped: "stopped",
    failed: "bind_failed",
  });

const START_ERROR = "staging_case_runtime_bind_failed";
function invalid(code: string): never {
  throw new Error(code);
}

/** Rejects proxies, accessors, symbols, inherited fields and extra fields. */
function exactObject(
  value: unknown,
  keys: readonly string[],
  code: string,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    invalid(code);
  }

  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some(
      (key) => typeof key !== "string" || !keys.includes(key),
    )
  ) {
    invalid(code);
  }

  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      descriptor.get ||
      descriptor.set ||
      !descriptor.enumerable
    ) {
      invalid(code);
    }
  }

  return value as Record<string, unknown>;
}

function captureListener(value: unknown): Readonly<{
  host: "127.0.0.1" | "0.0.0.0";
  port: number;
}> {
  if (value && typeof value === "object" && !Array.isArray(value) && !utilTypes.isProxy(value) &&
    Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === 2 &&
    Reflect.ownKeys(value).every((key) => key === "host" || key === "port")) {
    const listener = exactObject(value, ["host", "port"], "staging_case_runtime_config_invalid");
    if (listener.host !== "127.0.0.1" || typeof listener.port !== "number" ||
      !Number.isSafeInteger(listener.port) || listener.port < 0 || listener.port > 65_535) {
      invalid("staging_case_runtime_config_invalid");
    }
    return Object.freeze({ host: "127.0.0.1" as const, port: listener.port });
  }

  const deploymentListener = captureStagingCaseRuntimeDeploymentListener(value);
  if (!deploymentListener) invalid("staging_case_runtime_config_invalid");
  return deploymentListener;
}

function captureConfig(config: StagingCaseRuntimeLifecycleConfig): {
  server: Server;
  host: "127.0.0.1" | "0.0.0.0";
  port: number;
  release: () => void | Promise<void>;
  drainTimeoutMs: number;
} {
  const parsed = exactObject(
    config,
    ["server", "listener", "release", "drainTimeoutMs"],
    "staging_case_runtime_config_invalid",
  );

  const server = parsed.server;
  if (
    utilTypes.isProxy(server) ||
    !(server instanceof Server) ||
    !serverIsUnbound(server)
  ) {
    invalid("staging_case_runtime_config_invalid");
  }

  const listener = captureListener(parsed.listener);

  const release = parsed.release;
  if (typeof release !== "function") {
    invalid("staging_case_runtime_config_invalid");
  }

  const drainTimeoutMs = parsed.drainTimeoutMs;
  if (
    typeof drainTimeoutMs !== "number" ||
    !Number.isSafeInteger(drainTimeoutMs) ||
    drainTimeoutMs < 100 ||
    drainTimeoutMs > 10_000
  ) {
    invalid("staging_case_runtime_config_invalid");
  }

  return {
    server,
    host: listener.host,
    port: listener.port,
    release: release as () => void | Promise<void>,
    drainTimeoutMs,
  };
}

function asBindError(): Error {
  // Never preserve the Node error as `cause`: it may contain a path, host,
  // port, or deployment detail that the health surface must not disclose.
  return new Error(START_ERROR);
}

function serverIsUnbound(server: Server): boolean {
  try {
    return !server.listening && server.address() === null;
  } catch {
    return false;
  }
}

function isAddressInfo(
  value: ReturnType<Server["address"]>,
): value is { address: string; family: string; port: number } {
  return (
    !!value &&
    typeof value === "object" &&
    typeof value.address === "string" &&
    typeof value.port === "number"
  );
}

/**
 * Compose lifecycle around an already-created Node HTTP server.
 *
 * The returned object intentionally has no server property, no dependency
 * accessor, no signal handling and no health route.  Operations can expose
 * `health()` through its own probe adapter without granting the probe access
 * to this process's request or close capability.
 */
export function createStagingCaseRuntimeLifecycle(
  input: StagingCaseRuntimeLifecycleConfig,
): StagingCaseRuntimeLifecycle {
  const config = captureConfig(input);
  const { server } = config;

  let phase: StagingCaseRuntimePhase = "new";
  let boundPort: number | null = null;
  let closingRequested = false;
  let cleanupDone = false;
  let releasePromise: Promise<void> | null = null;
  let startPromise: Promise<void> | null = null;
  let closePromise: Promise<void> | null = null;
  let startSettled = false;

  const connections = new Set<Socket>();
  const requests = new Set<IncomingMessage>();
  const responses = new Set<ServerResponse>();
  const connectionCloseHandlers = new Map<Socket, () => void>();
  const requestTrackingHandlers = new Map<IncomingMessage, {
    close: () => void;
    aborted: () => void;
  }>();
  const responseTrackingHandlers = new Map<ServerResponse, {
    finish: () => void;
    close: () => void;
  }>();

  let drainResolve: ((value: { forced: boolean }) => void) | null = null;
  let drainTimer: ReturnType<typeof setTimeout> | null = null;
  let serverCloseStarted = false;
  let serverCloseFinished = false;

  const removeConnection = (socket: Socket): void => {
    connections.delete(socket);
    maybeResolveDrain();
  };

  const trackConnection = (socket: Socket): void => {
    connections.add(socket);
    const onClose = (): void => {
      connectionCloseHandlers.delete(socket);
      removeConnection(socket);
    };
    connectionCloseHandlers.set(socket, onClose);
    socket.once("close", onClose);
  };

  const removeRequest = (request: IncomingMessage): void => {
    requests.delete(request);
    const handlers = requestTrackingHandlers.get(request);
    if (handlers) {
      request.removeListener("close", handlers.close);
      request.removeListener("aborted", handlers.aborted);
    }
    requestTrackingHandlers.delete(request);
    maybeResolveDrain();
  };

  const removeResponse = (response: ServerResponse): void => {
    responses.delete(response);
    const handlers = responseTrackingHandlers.get(response);
    if (handlers) {
      response.removeListener("finish", handlers.finish);
      response.removeListener("close", handlers.close);
    }
    responseTrackingHandlers.delete(response);
    maybeResolveDrain();
  };

  const trackRequest = (
    request: IncomingMessage,
    response: ServerResponse,
  ): void => {
    requests.add(request);
    responses.add(response);
    const requestClose = (): void => removeRequest(request);
    const requestAborted = (): void => removeRequest(request);
    const responseFinish = (): void => removeResponse(response);
    const responseClose = (): void => removeResponse(response);
    requestTrackingHandlers.set(request, {
      close: requestClose,
      aborted: requestAborted,
    });
    responseTrackingHandlers.set(response, {
      finish: responseFinish,
      close: responseClose,
    });
    request.once("close", requestClose);
    request.once("aborted", requestAborted);
    response.once("finish", responseFinish);
    response.once("close", responseClose);
  };

  function maybeResolveDrain(): void {
    if (
      drainResolve &&
      connections.size === 0 &&
      requests.size === 0 &&
      responses.size === 0
    ) {
      const resolve = drainResolve;
      drainResolve = null;
      if (drainTimer) {
        clearTimeout(drainTimer);
        drainTimer = null;
      }
      resolve({ forced: false });
    }
  }

  // These listeners are installed before `listen`; therefore the first
  // accepted socket/request is tracked even when the caller uses port 0.
  server.prependListener("connection", trackConnection);
  server.prependListener("request", trackRequest);

  function health(): StagingCaseRuntimeHealth {
    return Object.freeze({
      phase,
      ready: phase === "ready",
      detail: PHASE_DETAILS[phase],
      port: phase === "ready" ? boundPort : null,
    });
  }

  function invokeRelease(): Promise<void> {
    if (releasePromise) return releasePromise;
    releasePromise = Promise.resolve()
      .then(() => config.release())
      .then(
        () => undefined,
        () => undefined,
      );
    return releasePromise;
  }

  function removeTracking(): void {
    if (cleanupDone) return;
    cleanupDone = true;
    server.removeListener("connection", trackConnection);
    server.removeListener("request", trackRequest);
    for (const [socket, onClose] of connectionCloseHandlers) {
      socket.removeListener("close", onClose);
    }
    for (const [request, handlers] of requestTrackingHandlers) {
      request.removeListener("close", handlers.close);
      request.removeListener("aborted", handlers.aborted);
    }
    for (const [response, handlers] of responseTrackingHandlers) {
      response.removeListener("finish", handlers.finish);
      response.removeListener("close", handlers.close);
    }
    connectionCloseHandlers.clear();
    requestTrackingHandlers.clear();
    responseTrackingHandlers.clear();
    connections.clear();
    requests.clear();
    responses.clear();
  }

  function forceCloseConnections(): void {
    // Both methods are supported Node APIs in the runtime range.  Keep the
    // optional checks for compatibility with a patched/test server instance.
    try {
      server.closeIdleConnections?.();
    } catch {
      // Continue to the stronger supported operation if a wrapper rejects
      // idle cleanup.
    }
    try {
      server.closeAllConnections?.();
    } catch {
      // The lifecycle remains bounded even for an externally patched server.
    }
  }

  async function stopUnexpectedListener(): Promise<void> {
    if (serverIsUnbound(server)) return;
    forceCloseConnections();
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, config.drainTimeoutMs);
      try {
        server.close(() => finish());
      } catch {
        finish();
      }
    });
  }

  function waitForDrain(): Promise<{ forced: boolean }> {
    if (
      connections.size === 0 &&
      requests.size === 0 &&
      responses.size === 0
    ) {
      return Promise.resolve({ forced: false });
    }

    return new Promise<{ forced: boolean }>((resolve) => {
      drainResolve = resolve;
      drainTimer = setTimeout(() => {
        drainTimer = null;
        drainResolve = null;
        forceCloseConnections();
        // `closeAllConnections` closes sockets asynchronously. The runtime's
        // own state is nevertheless safe to finalize now: all future accepts
        // have already been stopped and the supported force-close API was
        // invoked at the deadline.
        resolve({ forced: true });
      }, config.drainTimeoutMs);
    });
  }

  async function finishClose(): Promise<void> {
    if (phase === "stopped" && cleanupDone) {
      await invokeRelease();
      return;
    }

    if (phase === "new") {
      phase = "stopped";
      boundPort = null;
      removeTracking();
      await invokeRelease();
      return;
    }

    // Starting is allowed to race close.  Wait for the bind attempt to settle
    // before invoking Server.close: calling close on a never-listened server
    // would otherwise produce ERR_SERVER_NOT_RUNNING and leave a later bind
    // race unresolved.
    if (startPromise && !startSettled) {
      try {
        await startPromise;
      } catch {
        // The bind path has already marked the phase failed and invoked the
        // release callback. Continue to the common finalization below.
      }
      if ((phase as StagingCaseRuntimePhase) === "failed") {
        phase = "stopped";
        boundPort = null;
        removeTracking();
        await invokeRelease();
        return;
      }
    }

    if (phase === "failed") {
      phase = "stopped";
      boundPort = null;
      removeTracking();
      await invokeRelease();
      return;
    }

    if (phase === "ready" || phase === "draining") {
      phase = "draining";
      boundPort = null;

      // Start both operations together. Node's close callback waits for active
      // sockets, so awaiting it before the independent deadline would make a
      // stuck response unbounded.
      const serverClose = waitForServerClose();
      const drain = await waitForDrain();
      if (drain.forced) {
        // The timer already issued closeAllConnections. Give Node one turn to
        // process its close events, but never let a broken server
        // implementation hold shutdown beyond the configured deadline.
        await Promise.race([
          serverClose,
          new Promise<void>((resolve) => setImmediate(resolve)),
        ]);
      } else {
        await serverClose;
      }
    }

    phase = "stopped";
    boundPort = null;
    removeTracking();
    await invokeRelease();
  }

  function waitForServerClose(): Promise<void> {
    if (serverCloseFinished) return Promise.resolve();
    if (serverCloseStarted) {
      return new Promise<void>((resolve) => {
        const check = (): void => {
          if (serverCloseFinished) resolve();
          else setImmediate(check);
        };
        check();
      });
    }

    serverCloseStarted = true;
    return new Promise<void>((resolve) => {
      const done = (): void => {
        if (serverCloseFinished) return;
        serverCloseFinished = true;
        resolve();
      };

      try {
        server.close((error?: Error) => {
          // A close error after the listener has stopped must not leak the
          // server's internal message. The lifecycle still reaches stopped;
          // close is deliberately idempotent and best-effort.
          void error;
          done();
        });
      } catch {
        // This can only happen for an externally-closed/already-unbound
        // server. Treat it as stopped and let the tracked sockets drain.
        done();
      }

      // Idle keep-alive sockets are not useful during shutdown and should not
      // consume the drain window. Active responses remain tracked.
      try {
        server.closeIdleConnections?.();
      } catch {
        // Server.close remains the authoritative stop-accepting operation.
      }
    });
  }

  function start(): Promise<void> {
    if (startPromise) return startPromise;
    if (phase === "stopped") {
      startPromise = Promise.resolve();
      startSettled = true;
      return startPromise;
    }
    if (phase !== "new") return Promise.reject(asBindError());
    if (!serverIsUnbound(server)) {
      phase = "failed";
      boundPort = null;
      startPromise = (async () => {
        await stopUnexpectedListener();
        await invokeRelease();
        startSettled = true;
        throw asBindError();
      })();
      return startPromise;
    }

    phase = "starting";
    startPromise = new Promise<void>((resolve, reject) => {
      let settled = false;

      const cleanupBindListeners = (): void => {
        server.removeListener("listening", onListening);
        server.removeListener("error", onError);
      };

      const failBind = (): void => {
        if (settled) return;
        settled = true;
        cleanupBindListeners();
        phase = "failed";
        boundPort = null;
        void (async () => {
          await stopUnexpectedListener();
          await invokeRelease();
          startSettled = true;
          reject(asBindError());
        })();
      };

      const onError = (): void => failBind();

      const onListening = (): void => {
        if (settled) return;
        const address = server.address();
        if (
          !isAddressInfo(address) ||
          address.address !== config.host ||
          !Number.isSafeInteger(address.port) ||
          address.port < 0 ||
          address.port > 65_535
        ) {
          // The server did bind, but not to the exact loopback or verified
          // Pod-network address promised. Close it before reporting failure.
          failBind();
          return;
        }

        settled = true;
        startSettled = true;
        cleanupBindListeners();
        boundPort = address.port;
        if (!closingRequested) phase = "ready";
        resolve();
      };

      server.once("listening", onListening);
      server.once("error", onError);
      try {
        server.listen(config.port, config.host);
      } catch {
        failBind();
      }
    });

    return startPromise;
  }

  function close(): Promise<void> {
    if (closePromise) return closePromise;
    closingRequested = true;
    if (phase === "starting") phase = "draining";
    else if (phase === "ready") phase = "draining";

    closePromise = finishClose().catch(() => {
      // Keep shutdown idempotent and redacted even if an unusual patched
      // Server implementation throws from a close method.
      phase = "stopped";
      boundPort = null;
      removeTracking();
      return invokeRelease();
    });
    return closePromise;
  }

  return Object.freeze({ start, health, close });
}
