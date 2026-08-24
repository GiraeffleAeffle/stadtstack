import { createServer, type Server, type ServerResponse } from "node:http";

import {
  createReviewedPublicKnowledgeServer,
  type ReviewedPublicKnowledgeRouteRequest,
  type ReviewedPublicKnowledgeRouteResponse,
  type ReviewedPublicKnowledgeServer,
} from "./reviewed-public-knowledge-server.ts";
import {
  prepareReviewedPublicKnowledgeProjection,
  sourceReviewAttestationChecksum,
  type ReviewedLocalNewsEvidence,
  type ReviewedPublicKnowledgeEvidence,
  type ReviewedPublicKnowledgeProjectionV1,
  type ReviewedRatsinformationEvidence,
  type ReviewedSourceAdmissionBatchV1,
  type SourceReviewAttestationDraftV1,
} from "./reviewed-public-knowledge.ts";

/**
 * Credential-free composition root for the reviewed-source tracer.  Its small
 * Interface deliberately offers no source collection, review, Case, model,
 * administration, vote, treasury, persistence, or configuration capability:
 * it serves exactly the two already-admitted synthetic projections below.
 */
export type StagingReviewedPublicKnowledgeRuntime = Readonly<{
  /** Default reference listener: loopback-only, including Host validation. */
  start(port?: number): Promise<void>;
  /** Fixed ClusterIP adapter for the reviewed staging Service only. */
  startInternalClusterIp(port?: number): Promise<void>;
  health(): Readonly<{
    phase: "new" | "ready" | "stopped";
    ready: boolean;
    port: number | null;
    projectionChecksums: Readonly<Record<"local_news" | "ratsinformation", `sha256:${string}`>>;
  }>;
  respond(request: ReviewedPublicKnowledgeRouteRequest): ReviewedPublicKnowledgeRouteResponse;
  close(): Promise<void>;
}>;

const MUNICIPALITY_ID = "roebel-mueritz";
const GENERATED_AT = "2026-08-22T12:00:00.000Z";
const REVIEWED_AT = "2026-08-22T10:00:00.000Z";
const POLICY_VERSION = "synthetic-reviewed-source-v1";
const sha = (digit: string): `sha256:${string}` => `sha256:${digit.repeat(64)}`;
const INTERNAL_SERVICE_HOSTS = Object.freeze(new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "reviewed-public-knowledge",
  "reviewed-public-knowledge.stadtstack-roebel-staging-lab",
  "reviewed-public-knowledge.stadtstack-roebel-staging-lab.svc",
  "reviewed-public-knowledge.stadtstack-roebel-staging-lab.svc.cluster.local",
]));

function review(evidence: ReviewedPublicKnowledgeEvidence) {
  const draft: SourceReviewAttestationDraftV1 = {
    schemaVersion: "source_review_attestation_v1",
    municipalityId: MUNICIPALITY_ID,
    sourceKind: evidence.sourceKind,
    evidenceId: evidence.evidenceId,
    sourceCaptureSha256: evidence.evidenceId,
    reviewerActorId: "synthetic:roebel-source-reviewer",
    actorClass: "source_reviewer",
    decision: "admit_public",
    reviewedAt: evidence.reviewedAt,
    policyVersion: POLICY_VERSION,
  };
  return Object.freeze({ ...draft, attestationChecksum: sourceReviewAttestationChecksum(draft) });
}

function prepare(evidence: ReviewedPublicKnowledgeEvidence): ReviewedPublicKnowledgeProjectionV1 {
  const batch: ReviewedSourceAdmissionBatchV1 = {
    schemaVersion: "reviewed_source_admission_batch_v1",
    municipalityId: MUNICIPALITY_ID,
    sourceKind: evidence.sourceKind,
    generatedAt: GENERATED_AT,
    policyVersion: POLICY_VERSION,
    records: Object.freeze([Object.freeze({
      evidence,
      sourceCaptureSha256: evidence.evidenceId,
      review: review(evidence),
    })]),
  };
  return prepareReviewedPublicKnowledgeProjection(batch).projection;
}

const LOCAL_NEWS: ReviewedLocalNewsEvidence = Object.freeze({
  evidenceId: sha("1"),
  municipalityId: MUNICIPALITY_ID,
  sourceKind: "local_news",
  authority: "editorial_report",
  title: "Synthetischer Bericht zur Marienfelder Straße",
  summary: "Synthetische Testdaten über eine nachvollziehbare Diskussion zur sicheren Querung.",
  publishedAt: "2026-08-20T08:00:00.000Z",
  admissionState: "admitted",
  lifecycle: "current",
  publisher: "Synthetischer Röbel Kurier",
  articleUrl: "https://example.invalid/roebel/marienfelder-strasse-lokalnachricht",
  reviewedAt: REVIEWED_AT,
});

const RATSINFORMATION: ReviewedRatsinformationEvidence = Object.freeze({
  evidenceId: sha("2"),
  municipalityId: MUNICIPALITY_ID,
  sourceKind: "ratsinformation",
  authority: "official_record",
  title: "Synthetische Ausschussvorlage zur Marienfelder Straße",
  summary: "Synthetische Testdaten zu einem dokumentierten Prüfauftrag für die Querung.",
  publishedAt: "2026-08-19T08:00:00.000Z",
  admissionState: "admitted",
  lifecycle: "current",
  body: "Synthetischer Beratungsgegenstand: Prüfung einer sicheren und nachvollziehbaren Querung.",
  recordId: "SYN-RIS-2026-42",
  recordUrl: "https://example.invalid/roebel/ris/syn-2026-42",
  reviewedAt: REVIEWED_AT,
});

/** Exactly one local-news and one Ratsinformation projection; no input can add,
 * remove, or replace a source after this module was reviewed. */
export const BUNDLED_ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE: readonly ReviewedPublicKnowledgeProjectionV1[] = Object.freeze([
  prepare(LOCAL_NEWS),
  prepare(RATSINFORMATION),
]);

function checkedPort(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 65_535) {
    throw new Error("staging_reviewed_public_knowledge_port_invalid");
  }
  return value as number;
}

/**
 * This is deliberately a fixed allowlist rather than ingress configuration.
 * The ClusterIP adapter accepts only direct local probes or the one reviewed
 * Service name in its one staging namespace. It never consults environment,
 * forwarded headers, DNS, or a caller-provided hostname list.
 */
export function reviewedKnowledgeInternalHostAllowed(value: string | undefined): boolean {
  if (!value || value !== value.trim() || value !== value.toLowerCase()) return false;
  const separator = value.lastIndexOf(":");
  const host = value.startsWith("[") ? value.replace(/(?::8080)?$/u, "") :
    (separator > -1 ? value.slice(0, separator) : value);
  const port = value.startsWith("[") ? value.slice(host.length) : (separator > -1 ? value.slice(separator) : "");
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  const portAllowed = port === "" || port === ":8080" || (!loopback && port === ":18080");
  return INTERNAL_SERVICE_HOSTS.has(host) && portAllowed;
}

function send(response: ServerResponse, value: ReviewedPublicKnowledgeRouteResponse): void {
  response.writeHead(value.status, value.headers);
  response.end(value.body);
}

export function createStagingReviewedPublicKnowledgeRuntime(): StagingReviewedPublicKnowledgeRuntime {
  const transport: ReviewedPublicKnowledgeServer = createReviewedPublicKnowledgeServer({
    municipalityId: MUNICIPALITY_ID,
    projections: BUNDLED_ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE,
  });
  const projectionChecksums = Object.freeze({
    local_news: BUNDLED_ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE[0]!.contentSha256,
    ratsinformation: BUNDLED_ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE[1]!.contentSha256,
  });
  let phase: "new" | "ready" | "stopped" = "new";
  let port: number | null = null;
  let startPromise: Promise<void> | null = null;
  let closePromise: Promise<void> | null = null;
  let internalAdapter: Server | null = null;

  function health() {
    return Object.freeze({
      phase,
      ready: phase === "ready",
      port,
      projectionChecksums,
    });
  }

  function start(requestedPort = 0): Promise<void> {
    checkedPort(requestedPort);
    if (startPromise) return startPromise;
    if (phase !== "new") return Promise.reject(new Error("staging_reviewed_public_knowledge_start_invalid"));
    startPromise = (async () => {
      const address = await transport.listen(requestedPort);
      port = address.port;
      phase = "ready";
    })();
    return startPromise;
  }

  function startInternalClusterIp(requestedPort = 8080): Promise<void> {
    checkedPort(requestedPort);
    if (startPromise) return startPromise;
    if (phase !== "new") return Promise.reject(new Error("staging_reviewed_public_knowledge_start_invalid"));
    const adapter = createServer((request, response) => {
      if (!reviewedKnowledgeInternalHostAllowed(request.headers.host)) {
        send(response, { status: 400, headers: { "content-length": "13", "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-store" }, body: "invalid_host\n" });
        return;
      }
      try {
        send(response, transport.respond({ method: request.method ?? "", path: request.url ?? "" }));
      } catch {
        send(response, { status: 400, headers: { "content-length": "16", "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-store" }, body: "request_invalid\n" });
      }
    });
    internalAdapter = adapter;
    startPromise = new Promise<void>((resolve, reject) => {
      adapter.once("error", reject);
      adapter.listen(requestedPort, "0.0.0.0", () => {
        adapter.off("error", reject);
        const address = adapter.address();
        if (!address || typeof address === "string") {
          reject(new Error("staging_reviewed_public_knowledge_address_invalid"));
          return;
        }
        port = address.port;
        phase = "ready";
        resolve();
      });
    });
    return startPromise;
  }

  function close(): Promise<void> {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      if (internalAdapter?.listening) {
        await new Promise<void>((resolve, reject) => internalAdapter?.close((error) => error ? reject(error) : resolve()));
      } else await transport.close();
      port = null;
      phase = "stopped";
    })();
    return closePromise;
  }

  return Object.freeze({ start, startInternalClusterIp, health, respond: transport.respond, close });
}
