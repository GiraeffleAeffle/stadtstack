import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import test from "node:test";

import {
  createStagingCaseProcessLifecycle,
  type StagingCaseProcessLifecycleConfig,
} from "../src/staging-case-process-lifecycle.ts";

const HOST = "127.0.0.1" as const;

function listener(id: string, server = createServer((_request, response) => response.end(id)), port = 0) {
  return { id, server, host: HOST, port } as const;
}

function config(
  listeners: readonly ReturnType<typeof listener>[],
  release: () => void | Promise<void> = () => undefined,
  overrides: Partial<StagingCaseProcessLifecycleConfig> = {},
): StagingCaseProcessLifecycleConfig {
  return { listeners, release, drainTimeoutMs: 250, ...overrides };
}

function get(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: HOST, port, path: "/", headers: { connection: "close" } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { body += chunk; });
      response.on("end", () => resolve(body));
    });
    request.on("error", reject);
    request.end();
  });
}

function listen(server: ReturnType<typeof createServer>, port = 0): Promise<void> {
  return new Promise((resolve) => server.listen(port, HOST, resolve));
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("starts declared listeners in order and exposes only redacted aggregate health", async () => {
  const first = listener("control");
  const second = listener("public");
  const sequence: string[] = [];
  first.server.on("listening", () => sequence.push("control:listen"));
  second.server.on("listening", () => sequence.push("public:listen"));
  first.server.on("close", () => sequence.push("control:close"));
  second.server.on("close", () => sequence.push("public:close"));
  let releases = 0;
  const lifecycle = createStagingCaseProcessLifecycle(config([first, second], () => { releases += 1; }));

  assert.deepEqual(Object.keys(lifecycle), ["start", "health", "close"]);
  assert.deepEqual(lifecycle.health(), {
    phase: "new", ready: false, detail: "not_started", ports: {},
  });
  await lifecycle.start();
  const health = lifecycle.health();
  assert.equal(health.phase, "ready");
  assert.equal(health.ready, true);
  assert.equal(Object.isFrozen(health), true);
  assert.equal(Object.isFrozen(health.ports), true);
  assert.deepEqual(Object.keys(health.ports), ["control", "public"]);
  assert.equal(await get(health.ports.control!), "control");
  assert.equal(await get(health.ports.public!), "public");
  assert.deepEqual(sequence.slice(0, 2), ["control:listen", "public:listen"]);

  const close = lifecycle.close();
  await close;
  assert.equal(releases, 1);
  assert.equal(first.server.listening, false);
  assert.equal(second.server.listening, false);
  assert.deepEqual(sequence.slice(-2), ["public:close", "control:close"]);
  assert.deepEqual(lifecycle.health(), {
    phase: "stopped", ready: false, detail: "stopped", ports: {},
  });
});

test("runs the synchronous beforeBind guard immediately before each child start", async () => {
  const first = listener("control");
  const second = listener("public");
  const sequence: string[] = [];
  first.server.on("listening", () => sequence.push("control:listen"));
  second.server.on("listening", () => sequence.push("public:listen"));
  const lifecycle = createStagingCaseProcessLifecycle(config([first, second], () => undefined, {
    beforeBind: (listenerId) => { sequence.push(`${listenerId}:guard`); },
  }));

  await lifecycle.start();
  assert.deepEqual(sequence, [
    "control:guard", "control:listen", "public:guard", "public:listen",
  ]);
  await lifecycle.close();
});

test("a first-listener beforeBind failure rolls back every listener before release", async () => {
  const first = listener("control");
  const second = listener("public");
  const guards: string[] = [];
  let releaseState: readonly boolean[] | undefined;
  const lifecycle = createStagingCaseProcessLifecycle(config([first, second], () => {
    releaseState = [first.server.listening, second.server.listening];
  }, {
    beforeBind: (listenerId) => {
      guards.push(listenerId);
      throw new Error("private guard failure");
    },
  }));

  await assert.rejects(lifecycle.start(), /staging_case_process_start_failed/u);
  assert.deepEqual(guards, ["control"]);
  assert.equal(first.server.listening, false);
  assert.equal(second.server.listening, false);
  assert.deepEqual(releaseState, [false, false]);
  assert.deepEqual(lifecycle.health(), {
    phase: "failed", ready: false, detail: "start_failed", ports: {},
  });
  await lifecycle.close();
});

test("a second-listener beforeBind failure rolls back the first listener before release", async () => {
  const first = listener("control");
  const second = listener("public");
  const guards: string[] = [];
  let releaseState: readonly boolean[] | undefined;
  const lifecycle = createStagingCaseProcessLifecycle(config([first, second], () => {
    releaseState = [first.server.listening, second.server.listening];
  }, {
    beforeBind: (listenerId) => {
      guards.push(listenerId);
      if (listenerId === "public") throw new Error("private guard failure");
    },
  }));

  await assert.rejects(lifecycle.start(), /staging_case_process_start_failed/u);
  assert.deepEqual(guards, ["control", "public"]);
  assert.equal(first.server.listening, false);
  assert.equal(second.server.listening, false);
  assert.deepEqual(releaseState, [false, false]);
  assert.deepEqual(lifecycle.health(), {
    phase: "failed", ready: false, detail: "start_failed", ports: {},
  });
  await lifecycle.close();
});

test("rejects async, proxied, and thenable beforeBind guards", async () => {
  const valid = config([listener("control")]);
  assert.throws(() => createStagingCaseProcessLifecycle({
    ...valid,
    beforeBind: async () => undefined,
  }), /staging_case_process_config_invalid/u);
  assert.throws(() => createStagingCaseProcessLifecycle({
    ...valid,
    beforeBind: new Proxy(() => undefined, {}),
  }), /staging_case_process_config_invalid/u);

  const server = listener("control");
  let releases = 0;
  const lifecycle = createStagingCaseProcessLifecycle(config([server], () => { releases += 1; }, {
    beforeBind: () => ({ then: () => undefined } as never),
  }));
  await assert.rejects(lifecycle.start(), /staging_case_process_start_failed/u);
  assert.equal(server.server.listening, false);
  assert.equal(releases, 1);
  await lifecycle.close();
});

test("start is memoized and a bind failure rolls every listener back before release", async () => {
  const blocker = createServer();
  await listen(blocker);
  const address = blocker.address();
  assert.ok(address && typeof address !== "string");
  const first = listener("control");
  const second = listener("public", createServer(), address.port);
  const releases: boolean[][] = [];
  const lifecycle = createStagingCaseProcessLifecycle(config([first, second], () => {
    releases.push([first.server.listening, second.server.listening]);
  }));
  const start = lifecycle.start();
  assert.strictEqual(start, lifecycle.start());
  await assert.rejects(start, /staging_case_process_start_failed/u);
  assert.equal(first.server.listening, false);
  assert.equal(second.server.listening, false);
  assert.deepEqual(releases, [[false, false]]);
  assert.deepEqual(lifecycle.health(), {
    phase: "failed", ready: false, detail: "start_failed", ports: {},
  });
  await lifecycle.close();
  assert.equal(releases.length, 1);
  await closeServer(blocker);
});

test("a listener pre-bound after handoff is stopped before process release", async () => {
  const first = listener("control");
  const second = listener("public");
  let releaseSawListening: boolean | undefined;
  const lifecycle = createStagingCaseProcessLifecycle(config([first, second], () => {
    releaseSawListening = first.server.listening || second.server.listening;
  }));
  await listen(second.server);
  const start = lifecycle.start();
  void start.catch(() => undefined);
  // Let the first process turn observe the externally bound handoff before
  // introducing the independent close race below.
  await new Promise<void>((resolve) => setImmediate(resolve));
  const close = lifecycle.close();
  await assert.rejects(start, /staging_case_process_start_failed/u);
  await close;
  assert.equal(first.server.listening, false);
  assert.equal(second.server.listening, false);
  assert.equal(releaseSawListening, false);
  assert.equal(lifecycle.health().phase, "stopped");
});

test("same-tick start and close never starts a later listener and releases once", async () => {
  const first = listener("control");
  const second = listener("projection");
  const third = listener("public");
  let releases = 0;
  const lifecycle = createStagingCaseProcessLifecycle(config([first, second, third], () => { releases += 1; }));
  const start = lifecycle.start();
  const close = lifecycle.close();
  await Promise.allSettled([start, close]);
  await close;
  assert.equal(first.server.listening, false);
  assert.equal(second.server.listening, false);
  assert.equal(third.server.listening, false);
  assert.equal(releases, 1);
  assert.equal(lifecycle.health().phase, "stopped");
});

test("shutdown remains bounded for a listener with a stuck response", async () => {
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => { requestStarted = resolve; });
  const stuck = listener("public", createServer(() => { requestStarted(); }));
  let releases = 0;
  const lifecycle = createStagingCaseProcessLifecycle(config([stuck], () => { releases += 1; }, { drainTimeoutMs: 120 }));
  await lifecycle.start();
  const client = httpRequest({ host: HOST, port: lifecycle.health().ports.public!, path: "/" });
  client.on("error", () => undefined);
  client.end();
  await started;
  const began = Date.now();
  await lifecycle.close();
  const elapsed = Date.now() - began;
  assert.ok(elapsed >= 80 && elapsed < 1_000, `elapsed=${elapsed}`);
  assert.equal(releases, 1);
});

test("a release failure is stable, redacted, memoized, and never reported as success", async () => {
  let releases = 0;
  const lifecycle = createStagingCaseProcessLifecycle(config([listener("control")], () => {
    releases += 1;
    throw new Error("sqlite:///private/control.db");
  }));
  await lifecycle.start();
  const closing = lifecycle.close();
  assert.strictEqual(closing, lifecycle.close());
  await assert.rejects(closing, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "staging_case_process_release_failed");
    assert.doesNotMatch(error.message, /sqlite|private|control\.db/u);
    return true;
  });
  assert.equal(releases, 1);
  assert.equal(lifecycle.health().phase, "stopped");
});

test("configuration is closed over exact plain data and no capability leaks", async () => {
  let capturedReleases = 0;
  const valid = config([listener("control")], () => { capturedReleases += 1; });
  const lifecycle = createStagingCaseProcessLifecycle(valid);
  valid.release = () => { throw new Error("replacement must not run"); };
  assert.deepEqual(Reflect.ownKeys(lifecycle), ["start", "health", "close"]);
  await lifecycle.close();
  assert.equal(capturedReleases, 1);

  assert.throws(() => createStagingCaseProcessLifecycle({ ...valid, extra: true } as never), /staging_case_process_config_invalid/u);
  assert.throws(() => createStagingCaseProcessLifecycle({
    ...valid,
    listeners: [{ id: "admission", server: createServer(), bindPlan: { listenerId: "admission" } }],
  } as never), /staging_case_process_config_invalid/u);
  assert.throws(() => createStagingCaseProcessLifecycle(new Proxy(valid, {})), /staging_case_process_config_invalid/u);
  assert.throws(() => createStagingCaseProcessLifecycle({ ...valid, listeners: new Proxy(valid.listeners, {}) }), /staging_case_process_config_invalid/u);
  assert.throws(() => createStagingCaseProcessLifecycle({ ...valid, listeners: [valid.listeners[0]!, valid.listeners[0]!] }), /staging_case_process_config_invalid/u);
  assert.throws(() => createStagingCaseProcessLifecycle({ ...valid, listeners: [{ ...valid.listeners[0]!, id: "Control" }] as never }), /staging_case_process_config_invalid/u);
  assert.throws(() => createStagingCaseProcessLifecycle({ ...valid, listeners: [{ ...valid.listeners[0]!, host: "0.0.0.0" }] as never }), /staging_case_process_config_invalid/u);
  const accessor = { ...valid } as Record<string, unknown>;
  Object.defineProperty(accessor, "release", { enumerable: true, get: () => valid.release });
  assert.throws(() => createStagingCaseProcessLifecycle(accessor as never), /staging_case_process_config_invalid/u);
  const sparse: unknown[] = [];
  sparse.length = 1;
  assert.throws(() => createStagingCaseProcessLifecycle({ ...valid, listeners: sparse as never }), /staging_case_process_config_invalid/u);
});
