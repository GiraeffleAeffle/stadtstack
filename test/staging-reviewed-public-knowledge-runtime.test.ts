import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import test from "node:test";

import {
  BUNDLED_ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE,
  createStagingReviewedPublicKnowledgeRuntime,
  reviewedKnowledgeInternalHostAllowed,
} from "../src/staging-reviewed-public-knowledge-runtime.ts";

const newsPath = "/api/federation/v1/municipalities/roebel-mueritz/public-knowledge/local-news";
const ratsinformationPath = "/api/federation/v1/municipalities/roebel-mueritz/public-knowledge/ratsinformation";

test("the standalone reviewed-knowledge runtime has exactly two synthetic Röbel projections", () => {
  assert.equal(BUNDLED_ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE.length, 2);
  assert.deepEqual(
    BUNDLED_ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE.map((projection) => [projection.municipalityId, projection.sourceKind]),
    [["roebel-mueritz", "local_news"], ["roebel-mueritz", "ratsinformation"]],
  );
  assert.ok(BUNDLED_ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE.every((projection) => projection.records.length === 1));
  assert.ok(BUNDLED_ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE.every((projection) => projection.records[0]?.admissionState === "admitted"));
  assert.ok(BUNDLED_ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE.every((projection) =>
    projection.records[0]?.sourceKind === projection.sourceKind));
});

test("the runtime uses the reviewed projection transport and exposes only the two GET routes", async (t) => {
  const runtime = createStagingReviewedPublicKnowledgeRuntime();
  t.after(async () => runtime.close());
  assert.deepEqual(runtime.health(), {
    phase: "new",
    ready: false,
    port: null,
    projectionChecksums: {
      local_news: BUNDLED_ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE[0]?.contentSha256,
      ratsinformation: BUNDLED_ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE[1]?.contentSha256,
    },
  });
  assert.equal(runtime.respond({ method: "GET", path: newsPath }).status, 200);
  assert.equal(runtime.respond({ method: "GET", path: ratsinformationPath }).status, 200);
  assert.equal(runtime.respond({ method: "POST", path: newsPath }).status, 405);
  assert.equal(runtime.respond({ method: "GET", path: `${newsPath}?cursor=1` }).status, 400);
  assert.equal(runtime.respond({ method: "GET", path: "/api/federation/v1/municipalities/roebel-mueritz/public-knowledge" }).status, 404);

  await runtime.start();
  const healthy = runtime.health();
  assert.equal(healthy.phase, "ready");
  assert.equal(healthy.ready, true);
  assert.ok(healthy.port && healthy.port > 0);
  const response = await fetch(`http://127.0.0.1:${healthy.port}${newsPath}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-stadtstack-content-sha256"), healthy.projectionChecksums.local_news);
  assert.equal(JSON.parse(await response.text()).municipalityId, "roebel-mueritz");
});

test("the runtime accepts no mutable projection or authority configuration", async () => {
  const runtime = createStagingReviewedPublicKnowledgeRuntime();
  await runtime.close();
  assert.deepEqual(runtime.health(), {
    phase: "stopped",
    ready: false,
    port: null,
    projectionChecksums: {
      local_news: BUNDLED_ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE[0]?.contentSha256,
      ratsinformation: BUNDLED_ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE[1]?.contentSha256,
    },
  });
  await assert.rejects(runtime.start(), /start_invalid/u);
  assert.throws(() => createStagingReviewedPublicKnowledgeRuntime().start(-1), /port_invalid/u);
});

test("the only non-loopback adapter accepts fixed local and ClusterIP Service Host names", async (t) => {
  for (const allowed of [
    "localhost", "localhost:8080", "127.0.0.1", "[::1]",
    "reviewed-public-knowledge",
    "reviewed-public-knowledge:18080",
    "reviewed-public-knowledge.stadtstack-roebel-staging-lab.svc.cluster.local:18080",
  ]) assert.equal(reviewedKnowledgeInternalHostAllowed(allowed), true, allowed);
  for (const rejected of [
    undefined, "", "example.com", "reviewed-public-knowledge.other.svc.cluster.local",
    "reviewed-public-knowledge.stadtstack-roebel-staging-lab.svc.cluster.local:9090",
    "REVIEWED-PUBLIC-KNOWLEDGE", "localhost:1", "localhost:18080", "127.0.0.1.evil",
  ]) assert.equal(reviewedKnowledgeInternalHostAllowed(rejected), false, String(rejected));

  const runtime = createStagingReviewedPublicKnowledgeRuntime();
  t.after(async () => runtime.close());
  await runtime.startInternalClusterIp();
  const port = runtime.health().port!;
  const allowed = await fetch(`http://127.0.0.1:${port}${newsPath}`, {
    headers: { host: "reviewed-public-knowledge.stadtstack-roebel-staging-lab.svc.cluster.local:18080" },
  });
  assert.equal(allowed.status, 200);
  const rejected = await new Promise<number>((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port, path: newsPath, headers: { host: "public.example" } }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    request.on("error", reject);
    request.end();
  });
  assert.equal(rejected, 400);
  const write = await fetch(`http://127.0.0.1:${port}${newsPath}`, { method: "POST", headers: { host: "reviewed-public-knowledge" } });
  assert.equal(write.status, 405);
});
