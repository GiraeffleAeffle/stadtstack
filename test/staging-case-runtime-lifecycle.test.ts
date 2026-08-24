import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import test from "node:test";

import {
  createStagingCaseRuntimeLifecycle,
  type StagingCaseRuntimeLifecycleConfig,
} from "../src/staging-case-runtime-lifecycle.ts";

const HOST = "127.0.0.1" as const;

function config(
  server: ReturnType<typeof createServer>,
  release: () => void | Promise<void> = () => undefined,
  overrides: Partial<StagingCaseRuntimeLifecycleConfig> = {},
): StagingCaseRuntimeLifecycleConfig {
  return {
    server,
    listener: { host: HOST, port: 0 },
    release,
    drainTimeoutMs: 500,
    ...overrides,
  };
}

function request(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: HOST,
      port,
      path: "/",
      headers: { connection: "close" },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { body += chunk; });
      response.on("end", () => resolve(body));
    });
    request.on("error", reject);
    request.end();
  });
}

test("binds a loopback port, reports readiness only after bind, and closes", async () => {
  const server = createServer((_request, response) => response.end("ok"));
  let releases = 0;
  const lifecycle = createStagingCaseRuntimeLifecycle(
    config(server, () => { releases += 1; }),
  );

  assert.deepEqual(Object.keys(lifecycle), ["start", "health", "close"]);
  assert.deepEqual(lifecycle.health(), {
    phase: "new",
    ready: false,
    detail: "not_started",
    port: null,
  });

  const start = lifecycle.start();
  assert.equal(lifecycle.health().phase, "starting");
  assert.equal(lifecycle.health().ready, false);
  await start;

  const ready = lifecycle.health();
  assert.equal(ready.phase, "ready");
  assert.equal(ready.ready, true);
  assert.equal(typeof ready.port, "number");
  assert.ok((ready.port ?? 0) > 0);
  assert.equal(await request(ready.port!), "ok");

  await lifecycle.close();
  assert.equal(releases, 1);
  assert.deepEqual(lifecycle.health(), {
    phase: "stopped",
    ready: false,
    detail: "stopped",
    port: null,
  });
});

test("start is one memoized bind attempt", async () => {
  const server = createServer((_request, response) => response.end("ok"));
  const lifecycle = createStagingCaseRuntimeLifecycle(config(server));
  const first = lifecycle.start();
  const second = lifecycle.start();
  assert.strictEqual(first, second);
  await first;
  await lifecycle.close();
});

test("a bind collision fails redacted and releases exactly once", async () => {
  const blocker = createServer((_request, response) => response.end("blocker"));
  await new Promise<void>((resolve) => blocker.listen(0, HOST, resolve));
  const address = blocker.address();
  assert.ok(address && typeof address !== "string");

  const server = createServer();
  let releases = 0;
  const lifecycle = createStagingCaseRuntimeLifecycle(config(server, () => { releases += 1; }, {
    listener: { host: HOST, port: address.port },
  }));

  await assert.rejects(lifecycle.start(), /staging_case_runtime_bind_failed/u);
  assert.deepEqual(lifecycle.health(), {
    phase: "failed",
    ready: false,
    detail: "bind_failed",
    port: null,
  });
  assert.equal(releases, 1);
  await lifecycle.close();
  await lifecycle.close();
  assert.equal(releases, 1);

  await new Promise<void>((resolve, reject) => blocker.close((error) => error ? reject(error) : resolve()));
});

test("a pre-bound server is rejected before ownership and remains the caller's listener", async () => {
  const server = createServer((_request, response) => response.end("external"));
  await new Promise<void>((resolve) => server.listen(0, HOST, resolve));
  assert.throws(
    () => createStagingCaseRuntimeLifecycle(config(server)),
    /staging_case_runtime_config_invalid/u,
  );
  assert.equal(server.listening, true);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("an external bind after handoff is closed before release and start fails redacted", async () => {
  const server = createServer((_request, response) => response.end("external"));
  let releases = 0;
  const releaseListeningStates: boolean[] = [];
  const lifecycle = createStagingCaseRuntimeLifecycle(config(server, () => {
    releaseListeningStates.push(server.listening);
    releases += 1;
  }));
  await new Promise<void>((resolve) => server.listen(0, HOST, resolve));
  const start = lifecycle.start();
  const close = lifecycle.close();
  const [startResult, closeResult] = await Promise.allSettled([start, close]);
  assert.equal(startResult.status, "rejected");
  if (startResult.status === "rejected") {
    assert.match(String(startResult.reason), /staging_case_runtime_bind_failed/u);
  }
  assert.equal(closeResult.status, "fulfilled");
  assert.equal(server.listening, false);
  assert.equal(releases, 1);
  assert.deepEqual(releaseListeningStates, [false]);
  assert.equal(lifecycle.health().phase, "stopped");
  await lifecycle.close();
  assert.equal(releases, 1);
});

test("close before start is safe, memoized, and releases once", async () => {
  const server = createServer();
  let releases = 0;
  const lifecycle = createStagingCaseRuntimeLifecycle(config(server, () => { releases += 1; }));
  const first = lifecycle.close();
  const second = lifecycle.close();
  assert.strictEqual(first, second);
  await first;
  assert.equal(releases, 1);
  assert.equal(lifecycle.health().phase, "stopped");
  const start = lifecycle.start();
  assert.strictEqual(start, lifecycle.start());
  await start;
  assert.equal(releases, 1);
});

test("rejects raw and structurally forged deployment listener capabilities", () => {
  assert.throws(
    () => createStagingCaseRuntimeLifecycle(config(createServer(), () => undefined, {
      listener: { host: "0.0.0.0", port: 18_085 } as never,
    })),
    /staging_case_runtime_config_invalid/u,
  );
  assert.throws(
    () => createStagingCaseRuntimeLifecycle(config(createServer(), () => undefined, {
      listener: Object.freeze({ schemaVersion: "staging_case_control_listener_bind_plan_v1" }) as never,
    })),
    /staging_case_runtime_config_invalid/u,
  );
});

test("close during an in-flight bind stops the listener and releases once", async () => {
  const server = createServer((_request, response) => response.end("ok"));
  let releases = 0;
  const lifecycle = createStagingCaseRuntimeLifecycle(config(server, () => { releases += 1; }));
  const start = lifecycle.start();
  const close = lifecycle.close();
  await Promise.allSettled([start, close]);
  await close;
  assert.equal(releases, 1);
  assert.equal(lifecycle.health().phase, "stopped");
});

test("close drains a pending response before releasing", async () => {
  let finishPending: (() => void) | undefined;
  const server = createServer((_request, response) => {
    finishPending = () => response.end("drained");
  });
  let releases = 0;
  const lifecycle = createStagingCaseRuntimeLifecycle(config(server, () => { releases += 1; }));
  await lifecycle.start();
  const port = lifecycle.health().port!;
  const pending = request(port);
  while (!finishPending) await new Promise<void>((resolve) => setImmediate(resolve));

  const close = lifecycle.close();
  assert.equal(lifecycle.health().phase, "draining");
  assert.equal(releases, 0);
  finishPending();
  assert.equal(await pending, "drained");
  await close;
  assert.equal(releases, 1);
  assert.equal(lifecycle.health().phase, "stopped");
});

test("a stuck response is force-closed at the bounded drain deadline", async () => {
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => { requestStarted = resolve; });
  const server = createServer(() => { requestStarted(); });
  let releases = 0;
  const lifecycle = createStagingCaseRuntimeLifecycle(config(server, () => { releases += 1; }, {
    drainTimeoutMs: 120,
  }));
  await lifecycle.start();
  const client = httpRequest({ host: HOST, port: lifecycle.health().port!, path: "/" });
  client.on("error", () => undefined);
  client.end();
  await started;

  const began = Date.now();
  await lifecycle.close();
  const elapsed = Date.now() - began;
  assert.ok(elapsed >= 80 && elapsed < 1_000, `elapsed=${elapsed}`);
  assert.equal(releases, 1);
  assert.equal(lifecycle.health().phase, "stopped");
});

test("configuration captures release and rejects proxies, accessors, and extras", async () => {
  const server = createServer();
  let releaseCalls = 0;
  const originalRelease = () => { releaseCalls += 1; };
  const input = config(server, originalRelease);
  const lifecycle = createStagingCaseRuntimeLifecycle(input);
  input.release = () => { throw new Error("replacement must not run"); };
  await lifecycle.close();
  assert.equal(releaseCalls, 1);

  const validServer = createServer();
  const valid = config(validServer);
  assert.throws(
    () => createStagingCaseRuntimeLifecycle({ ...valid, extra: true } as never),
    /staging_case_runtime_config_invalid/u,
  );
  assert.throws(
    () => createStagingCaseRuntimeLifecycle({ ...valid, listener: { host: "0.0.0.0", port: 18085 } } as never),
    /staging_case_runtime_config_invalid/u,
  );
  assert.throws(
    () => createStagingCaseRuntimeLifecycle({ ...valid, listener: { listenerId: "admission" } } as never),
    /staging_case_runtime_config_invalid/u,
  );
  assert.throws(
    () => createStagingCaseRuntimeLifecycle(new Proxy(valid, {})),
    /staging_case_runtime_config_invalid/u,
  );
  const accessor = { ...valid } as Record<string, unknown>;
  Object.defineProperty(accessor, "release", { enumerable: true, get: () => valid.release });
  assert.throws(
    () => createStagingCaseRuntimeLifecycle(accessor as never),
    /staging_case_runtime_config_invalid/u,
  );
  assert.throws(
    () => createStagingCaseRuntimeLifecycle({ ...valid, listener: new Proxy(valid.listener, {}) }),
    /staging_case_runtime_config_invalid/u,
  );
  assert.throws(
    () => createStagingCaseRuntimeLifecycle({ ...valid, listener: { host: HOST, port: 65_536 } }),
    /staging_case_runtime_config_invalid/u,
  );
  assert.throws(
    () => createStagingCaseRuntimeLifecycle({ ...valid, listener: { host: "0.0.0.0", port: 0 } as never }),
    /staging_case_runtime_config_invalid/u,
  );
});
