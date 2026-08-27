import { readFileSync } from "node:fs";

import {
  MunicipalContextExchange,
  createMcpCivicContextAdapter,
  consumeEquivalentCivicContextPages,
  municipalPublicationAuthorizationChecksum,
  publicSafePayloadChecksum,
  reviewedAdministrationReturnChecksum,
} from "../src/municipal-context-exchange.ts";

const fixtureRoot = new URL("../test/fixtures/municipal-context/", import.meta.url);
const context = JSON.parse(readFileSync(new URL("municipal-context-v1.json", fixtureRoot), "utf8"));
const bundle = JSON.parse(readFileSync(new URL("kair-session-bundle-v1.json", fixtureRoot), "utf8"));
const authorizationUnsigned = {
  schemaVersion: "municipal_publication_authorization_v1",
  municipalityId: "sample-municipality",
  policyId: "sample-municipality-publication-policy-v1",
  principalId: "sample-municipality-publisher-1",
  endpointId: "sample-municipality-publication-endpoint-1",
  allowedOfficialKinds: ["Paper"],
  validFromUtc: "2026-08-25T00:00:00.000Z",
  validUntilUtc: "2026-08-26T00:00:00.000Z",
};
const authorization = {
  ...authorizationUnsigned,
  authorizationSha256: municipalPublicationAuthorizationChecksum(authorizationUnsigned),
};
const exchange = new MunicipalContextExchange([authorization]);
exchange.registerContext(context);
exchange.intakeSession(bundle, "2026-08-25T11:00:00.000Z");

const deliberationPayload = {
  title: "Reviewed deliberation",
  summary: "Participants identified one shared concern and two bounded follow-up questions.",
  citations: ["https://example.org/municipal/paper-2026-001"],
};
const deliberation = exchange.reviewSession({
  bundleId: bundle.bundleId,
  bundleSha256: bundle.bundleSha256,
  artifactId: "reviewed-deliberation-synthetic-2026-001",
  policyId: "human-deliberation-review-v1",
  reviewerId: "reviewer-synthetic-1",
  reviewedAtUtc: "2026-08-25T11:15:00.000Z",
  publicPayload: deliberationPayload,
  publicPayloadSha256: publicSafePayloadChecksum(deliberationPayload),
});

let caseCitationDenied = false;
try {
  exchange.createCaseCitation({
    bundleId: bundle.bundleId,
    bundleSha256: bundle.bundleSha256,
    artifactId: deliberation.artifactId,
    canonicalCaseId: "urn:stadtstack:case:municipality:sample-municipality:018f0000-0000-7000-8000-000000000001",
    citedAtUtc: "2026-08-25T11:20:00.000Z",
  });
} catch (error) {
  caseCitationDenied = error instanceof Error && error.message === "kair_session_case_citation_forbidden";
}
if (!caseCitationDenied) throw new Error("municipal_context_case_citation_not_isolated");

const administrationPayload = {
  title: "Reviewed administration result",
  summary: "The synthetic administration return is reviewed, public-safe and still non-official.",
  citations: ["https://example.org/municipal/paper-2026-001"],
};
const administrationUnsigned = {
  schemaVersion: "reviewed_administration_return_v1",
  artifactId: "reviewed-opendesk-return-synthetic-2026-001",
  municipalityId: "sample-municipality",
  canonicalCaseId: "urn:stadtstack:case:municipality:sample-municipality:018f0000-0000-7000-8000-000000000001",
  sourceSystem: "openDesk",
  requestId: "administration-request-synthetic-2026-001",
  responseId: "opendesk-response-synthetic-2026-001",
  responseSha256: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
  reviewAttestationSha256: "sha256:5555555555555555555555555555555555555555555555555555555555555555",
  publicPayload: administrationPayload,
  publicPayloadSha256: publicSafePayloadChecksum(administrationPayload),
  reviewedAtUtc: "2026-08-25T12:00:00.000Z",
  correctionState: "current",
  authorityState: "reviewed_non_official",
};
const administrationReturn = exchange.admitReviewedAdministrationReturn({
  ...administrationUnsigned,
  artifactSha256: reviewedAdministrationReturnChecksum(administrationUnsigned),
});
const candidate = exchange.preparePublicationCandidate({
  candidateId: "municipal-publication-candidate-synthetic-2026-001",
  sourceArtifactId: administrationReturn.artifactId,
  sourceArtifactSha256: administrationReturn.artifactSha256,
  version: 1,
  proposedPublisher: "sample-municipality",
  proposedOfficialKind: "Paper",
  visibility: "public",
  correctionOf: null,
});
if (exchange.strictOparlProjection().papers.length !== 0) throw new Error("municipal_context_candidate_became_official");

const publication = exchange.publishCandidate({
  candidateId: candidate.candidateId,
  candidateSha256: candidate.candidateSha256,
  authorization,
  officialId: "urn:stadtstack:official:sample-municipality:paper-2026-001",
  publishedAtUtc: "2026-08-25T12:30:00.000Z",
});
const withdrawal = exchange.withdrawReviewedArtifact({
  artifactId: deliberation.artifactId,
  artifactSha256: deliberation.artifactSha256,
  reasonCode: "scope-withdrawn",
  withdrawnAtUtc: "2026-08-25T12:35:00.000Z",
});
const restPage = exchange.changes(null, 100);
const mcpPage = createMcpCivicContextAdapter(exchange).listChanges(null, 100);
const consumerReceipt = consumeEquivalentCivicContextPages(restPage, mcpPage);
if (!consumerReceipt.restMcpEquivalent) {
  throw new Error("municipal_context_mcp_projection_drift");
}

console.log(JSON.stringify({
  schemaVersion: "municipal_context_reference_flow_receipt_v1",
  status: "PASS",
  contextSha256: context.contentSha256,
  bundleSha256: bundle.bundleSha256,
  reviewedDeliberationSha256: deliberation.artifactSha256,
  caseCitationDenied,
  administrationReturnSha256: administrationReturn.artifactSha256,
  candidateAuthority: candidate.institutionalEffect,
  publicationReceiptSha256: publication.receipt.receiptSha256,
  officialPublicationSha256: publication.publication.publicationSha256,
  withdrawalSha256: withdrawal.correctionSha256,
  projectionVersion: restPage.projectionVersion,
  projectionSha256: restPage.projectionSha256,
  restMcpEquivalent: true,
  consumerReceiptSha256: consumerReceipt.receiptSha256,
  strictOparlPaperCount: exchange.strictOparlProjection().papers.length,
  effects: {
    network: false,
    caseAdmission: false,
    municipalPublication: "synthetic_authorized_reference_only",
    voting: false,
    treasury: false,
  },
}, null, 2));
