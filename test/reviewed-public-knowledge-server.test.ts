import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import test from "node:test";

import {
  prepareReviewedPublicKnowledgeProjection,
  serializeReviewedPublicKnowledgeProjection,
  sourceReviewAttestationChecksum,
  type ReviewedLocalNewsEvidence,
  type ReviewedPublicKnowledgeEvidence,
  type ReviewedPublicKnowledgeProjectionV1,
  type ReviewedRatsinformationEvidence,
  type ReviewedSourceAdmissionBatchV1,
  type SourceReviewAttestationDraftV1,
} from "../src/reviewed-public-knowledge.ts";
import { createReviewedPublicKnowledgeServer } from "../src/reviewed-public-knowledge-server.ts";

const MUNICIPALITY = "roebel-mueritz";
const GENERATED_AT = "2026-08-22T12:00:00.000Z";
const REVIEWED_AT = "2026-08-22T10:00:00.000Z";
const POLICY = "public-source-review-v1";
const sha = (digit: string) => `sha256:${digit.repeat(64)}` as const;

function news(overrides: Partial<ReviewedLocalNewsEvidence> = {}): ReviewedLocalNewsEvidence {
  return {
    evidenceId: sha("a"),
    municipalityId: MUNICIPALITY,
    sourceKind: "local_news",
    authority: "editorial_report",
    title: "Bericht zur Marienfelder Straße",
    summary: "Die Redaktion berichtet über Vorschläge für eine sichere Querung.",
    publishedAt: "2026-08-20T08:00:00.000Z",
    admissionState: "admitted",
    lifecycle: "current",
    publisher: "Röbel Kurier",
    articleUrl: "https://news.example/roebel/marienfelder-strasse",
    reviewedAt: REVIEWED_AT,
    ...overrides,
  };
}

function ris(overrides: Partial<ReviewedRatsinformationEvidence> = {}): ReviewedRatsinformationEvidence {
  return {
    evidenceId: sha("b"),
    municipalityId: MUNICIPALITY,
    sourceKind: "ratsinformation",
    authority: "official_record",
    title: "Ausschussvorlage zur Marienfelder Straße",
    summary: "Die Vorlage dokumentiert einen Prüfauftrag zur Querung.",
    publishedAt: "2026-08-19T08:00:00.000Z",
    admissionState: "admitted",
    lifecycle: "current",
    body: "Beratungsgegenstand ist die Prüfung einer sicheren Querung.",
    recordId: "RIS-2026-42",
    recordUrl: "https://ris.example/roebel/vorlagen/2026-42",
    reviewedAt: REVIEWED_AT,
    ...overrides,
  };
}

function review(evidence: ReviewedPublicKnowledgeEvidence) {
  const draft: SourceReviewAttestationDraftV1 = {
    schemaVersion: "source_review_attestation_v1",
    municipalityId: MUNICIPALITY,
    sourceKind: evidence.sourceKind,
    evidenceId: evidence.evidenceId,
    sourceCaptureSha256: evidence.evidenceId,
    reviewerActorId: "synthetic:source-reviewer-1",
    actorClass: "source_reviewer",
    decision: "admit_public",
    reviewedAt: evidence.reviewedAt,
    policyVersion: POLICY,
  };
  return { ...draft, attestationChecksum: sourceReviewAttestationChecksum(draft) };
}

function projection(evidence: ReviewedPublicKnowledgeEvidence): ReviewedPublicKnowledgeProjectionV1 {
  const batch: ReviewedSourceAdmissionBatchV1 = {
    schemaVersion: "reviewed_source_admission_batch_v1",
    municipalityId: MUNICIPALITY,
    sourceKind: evidence.sourceKind,
    generatedAt: GENERATED_AT,
    policyVersion: POLICY,
    records: [{
      evidence,
      sourceCaptureSha256: evidence.evidenceId,
      review: review(evidence),
    }],
  };
  return prepareReviewedPublicKnowledgeProjection(batch).projection;
}

function path(source: "local-news" | "ratsinformation"): string {
  return `/api/federation/v1/municipalities/${MUNICIPALITY}/public-knowledge/${source}`;
}

test("the two reviewed source snapshots have independent exact GET routes", () => {
  const newsProjection = projection(news());
  const risProjection = projection(ris());
  const transport = createReviewedPublicKnowledgeServer({
    municipalityId: MUNICIPALITY,
    projections: [newsProjection, risProjection],
  });

  const newsResponse = transport.respond({ method: "GET", path: path("local-news") });
  const risResponse = transport.respond({ method: "GET", path: path("ratsinformation") });
  assert.equal(newsResponse.status, 200);
  assert.equal(risResponse.status, 200);
  assert.equal(newsResponse.headers["cache-control"], "no-store");
  assert.equal(newsResponse.headers["x-stadtstack-content-sha256"], newsProjection.contentSha256);
  assert.equal(risResponse.headers["x-stadtstack-content-sha256"], risProjection.contentSha256);
  assert.equal(newsResponse.body, serializeReviewedPublicKnowledgeProjection(newsProjection));
  assert.equal(risResponse.body, serializeReviewedPublicKnowledgeProjection(risProjection));
  assert.equal(JSON.parse(newsResponse.body).sourceKind, "local_news");
  assert.equal(JSON.parse(risResponse.body).sourceKind, "ratsinformation");
});

test("the route refuses queries, writes, unknown municipalities, and missing projections", () => {
  const transport = createReviewedPublicKnowledgeServer({
    municipalityId: MUNICIPALITY,
    projections: [projection(news())],
  });
  assert.deepEqual(
    transport.respond({ method: "POST", path: path("local-news") }),
    {
      status: 405,
      headers: {
        allow: "GET",
        "cache-control": "no-store",
        "content-length": "19",
        "content-type": "text/plain; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
      body: "method_not_allowed\n",
    },
  );
  assert.equal(transport.respond({ method: "GET", path: `${path("local-news")}?fresh=1` }).status, 400);
  assert.equal(transport.respond({ method: "GET", path: path("ratsinformation") }).status, 404);
  assert.equal(transport.respond({
    method: "GET",
    path: "/api/federation/v1/municipalities/malchow/public-knowledge/local-news",
  }).status, 404);
});

test("a withdrawn reviewed source remains explicit in the bytes for consumer omission", () => {
  const withdrawn = projection(news({ lifecycle: "withdrawn" }));
  const transport = createReviewedPublicKnowledgeServer({
    municipalityId: MUNICIPALITY,
    projections: [withdrawn],
  });
  const served = JSON.parse(
    transport.respond({ method: "GET", path: path("local-news") }).body,
  ) as ReviewedPublicKnowledgeProjectionV1;
  assert.equal(served.records[0]?.lifecycle, "withdrawn");
  assert.equal(served.contentSha256, withdrawn.contentSha256);
});

test("checksum drift, non-canonical order, duplicates, and cross-town snapshots fail before listen", () => {
  const first = projection(news());
  const secondEvidence = news({
    evidenceId: sha("c"),
    articleUrl: "https://news.example/roebel/crossing-update",
  });
  const secondBatch: ReviewedSourceAdmissionBatchV1 = {
    schemaVersion: "reviewed_source_admission_batch_v1",
    municipalityId: MUNICIPALITY,
    sourceKind: "local_news",
    generatedAt: GENERATED_AT,
    policyVersion: POLICY,
    records: [
      {
        evidence: secondEvidence,
        sourceCaptureSha256: secondEvidence.evidenceId,
        review: review(secondEvidence),
      },
      {
        evidence: news(),
        sourceCaptureSha256: news().evidenceId,
        review: review(news()),
      },
    ],
  };
  const ordered = prepareReviewedPublicKnowledgeProjection(secondBatch).projection;
  const reversed = { ...ordered, records: [...ordered.records].reverse() };
  const invalid = [
    { ...first, contentSha256: sha("f") },
    reversed,
  ];
  for (const candidate of invalid) {
    assert.throws(() => createReviewedPublicKnowledgeServer({
      municipalityId: MUNICIPALITY,
      projections: [candidate as ReviewedPublicKnowledgeProjectionV1],
    }));
  }
  assert.throws(() => createReviewedPublicKnowledgeServer({
    municipalityId: MUNICIPALITY,
    projections: [first, first],
  }), /scope/u);
  assert.throws(() => createReviewedPublicKnowledgeServer({
    municipalityId: "malchow",
    projections: [first],
  }), /scope/u);
});

test("configuration and request accessors or proxies fail closed", () => {
  const config = {
    municipalityId: MUNICIPALITY,
    projections: [projection(news())],
  };
  assert.throws(() => createReviewedPublicKnowledgeServer(new Proxy(config, {})));
  assert.throws(() => createReviewedPublicKnowledgeServer({
    ...config,
    projections: new Proxy([...config.projections], {}),
  }));
  const sparseProjections = new Array(1) as typeof config.projections;
  assert.throws(() => createReviewedPublicKnowledgeServer({
    ...config,
    projections: sparseProjections,
  }));
  const accessorProjections = [...config.projections];
  Object.defineProperty(accessorProjections, "0", {
    enumerable: true,
    get: () => config.projections[0],
  });
  assert.throws(() => createReviewedPublicKnowledgeServer({
    ...config,
    projections: accessorProjections,
  }));
  const methodAccessorProjections = [...config.projections];
  Object.defineProperty(methodAccessorProjections, "map", {
    enumerable: true,
    get: () => { throw new Error("array method getter executed"); },
  });
  assert.throws(
    () => createReviewedPublicKnowledgeServer({
      ...config,
      projections: methodAccessorProjections,
    }),
    /reviewed_source_server_config_invalid/u,
  );
  const request = { method: "GET", path: path("local-news") };
  Object.defineProperty(request, "path", {
    enumerable: true,
    get: () => path("local-news"),
  });
  const transport = createReviewedPublicKnowledgeServer(config);
  assert.throws(() => transport.respond(request));
});

test("a snapshot above the consumer response budget is rejected before listen", () => {
  const evidence = Array.from({ length: 40 }, (_, index) => ris({
    evidenceId: `sha256:${index.toString(16).padStart(64, "0")}`,
    summary: `${index}: ${"s".repeat(3_990)}`,
    body: `${index}: ${"b".repeat(9_990)}`,
    recordId: `RIS-2026-${index}`,
    recordUrl: `https://ris.example/roebel/vorlagen/2026-${index}`,
  }));
  const batch: ReviewedSourceAdmissionBatchV1 = {
    schemaVersion: "reviewed_source_admission_batch_v1",
    municipalityId: MUNICIPALITY,
    sourceKind: "ratsinformation",
    generatedAt: GENERATED_AT,
    policyVersion: POLICY,
    records: evidence.map((entry) => ({
      evidence: entry,
      sourceCaptureSha256: entry.evidenceId,
      review: review(entry),
    })),
  };
  const oversized = prepareReviewedPublicKnowledgeProjection(batch).projection;
  assert.ok(Buffer.byteLength(serializeReviewedPublicKnowledgeProjection(oversized)) > 512_000);
  assert.throws(() => createReviewedPublicKnowledgeServer({
    municipalityId: MUNICIPALITY,
    projections: [oversized],
  }), /too_large/u);
});

test("the reference listener is loopback-only and preserves HTTP semantics", async (t) => {
  const newsProjection = projection(news());
  const transport = createReviewedPublicKnowledgeServer({
    municipalityId: MUNICIPALITY,
    projections: [newsProjection],
  });
  const address = await transport.listen();
  t.after(async () => transport.close());

  const response = await fetch(`http://${address.host}:${address.port}${path("local-news")}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-stadtstack-content-sha256"), newsProjection.contentSha256);
  assert.equal(await response.text(), serializeReviewedPublicKnowledgeProjection(newsProjection));

  const badHostStatus = await new Promise<number>((resolve, reject) => {
    const request = httpRequest({
      host: address.host,
      port: address.port,
      path: path("local-news"),
      method: "GET",
      headers: { host: "public.example" },
    }, (incoming) => {
      incoming.resume();
      incoming.on("end", () => resolve(incoming.statusCode ?? 0));
    });
    request.on("error", reject);
    request.end();
  });
  assert.equal(badHostStatus, 400);
});
