import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MunicipalContextExchange,
  createMcpCivicContextAdapter,
  consumeEquivalentCivicContextPages,
  kairSessionBundleChecksum,
  municipalContextCanonicalSha256,
  municipalPublicationAuthorizationChecksum,
  publicSafePayloadChecksum,
  reviewedAdministrationReturnChecksum,
  serializeCivicChangePage,
  type KairSessionBundleV1,
  type MunicipalContextSnapshotV1,
  type MunicipalPublicationAuthorizationV1,
  type ConsentPurpose,
  type PublicSafePayloadV1,
  type ReviewedAdministrationReturnV1,
} from "../src/municipal-context-exchange.ts";

const fixtureRoot = new URL("./fixtures/municipal-context/", import.meta.url);
const contextFixture = JSON.parse(readFileSync(new URL("municipal-context-v1.json", fixtureRoot), "utf8")) as MunicipalContextSnapshotV1;
const bundleFixture = JSON.parse(readFileSync(new URL("kair-session-bundle-v1.json", fixtureRoot), "utf8")) as KairSessionBundleV1;
const caseId = "urn:stadtstack:case:municipality:sample-municipality:018f0000-0000-7000-8000-000000000001";

function reviewedPayload(title = "Reviewed deliberation"): PublicSafePayloadV1 {
  return {
    title,
    summary: "Participants identified one shared concern and two bounded follow-up questions.",
    citations: ["https://example.org/municipal/paper-2026-001"],
  };
}

function derivedBundle(options: Readonly<{
  bundleId: string;
  purposes?: readonly ConsentPurpose[];
  expiresAtUtc?: string;
  revoked?: boolean;
  contextContentSha256?: `sha256:${string}`;
}>): KairSessionBundleV1 {
  const unsigned: Omit<KairSessionBundleV1, "bundleSha256"> = {
    ...bundleFixture,
    bundleId: options.bundleId,
    contextReferences: bundleFixture.contextReferences.map((reference) => ({
      ...reference,
      contentSha256: options.contextContentSha256 ?? reference.contentSha256,
    })),
    consent: {
      ...bundleFixture.consent,
      purposes: options.purposes ?? bundleFixture.consent.purposes,
      expiresAtUtc: options.expiresAtUtc ?? bundleFixture.consent.expiresAtUtc,
      revoked: options.revoked ?? false,
    },
  };
  const bundleSha256 = options.revoked === true
    ? municipalContextCanonicalSha256(unsigned)
    : kairSessionBundleChecksum(unsigned);
  return { ...unsigned, bundleSha256 };
}

function reviewBundle(exchange: MunicipalContextExchange, bundle = bundleFixture, artifactId = "reviewed-deliberation-synthetic-2026-001") {
  exchange.registerContext(contextFixture);
  exchange.intakeSession(bundle, "2026-08-25T11:00:00.000Z");
  const publicPayload = reviewedPayload();
  return exchange.reviewSession({
    bundleId: bundle.bundleId,
    bundleSha256: bundle.bundleSha256,
    artifactId,
    policyId: "human-deliberation-review-v1",
    reviewerId: "reviewer-synthetic-1",
    reviewedAtUtc: "2026-08-25T11:15:00.000Z",
    publicPayload,
    publicPayloadSha256: publicSafePayloadChecksum(publicPayload),
  });
}

function reviewedAdministrationReturn(): ReviewedAdministrationReturnV1 {
  const unsigned = {
    schemaVersion: "reviewed_administration_return_v1" as const,
    artifactId: "reviewed-opendesk-return-synthetic-2026-001",
    municipalityId: "sample-municipality",
    canonicalCaseId: caseId,
    sourceSystem: "openDesk" as const,
    requestId: "administration-request-synthetic-2026-001",
    responseId: "opendesk-response-synthetic-2026-001",
    responseSha256: "sha256:4444444444444444444444444444444444444444444444444444444444444444" as const,
    reviewAttestationSha256: "sha256:5555555555555555555555555555555555555555555555555555555555555555" as const,
    publicPayload: reviewedPayload("Reviewed administration result"),
    publicPayloadSha256: publicSafePayloadChecksum(reviewedPayload("Reviewed administration result")),
    reviewedAtUtc: "2026-08-25T12:00:00.000Z",
    correctionState: "current" as const,
    authorityState: "reviewed_non_official" as const,
  };
  return { ...unsigned, artifactSha256: reviewedAdministrationReturnChecksum(unsigned) };
}

function publicationAuthorization(principalId = "sample-municipality-publisher-1"): MunicipalPublicationAuthorizationV1 {
  const unsigned = {
    schemaVersion: "municipal_publication_authorization_v1" as const,
    municipalityId: "sample-municipality",
    policyId: "sample-municipality-publication-policy-v1",
    principalId,
    endpointId: "sample-municipality-publication-endpoint-1",
    allowedOfficialKinds: ["Paper"] as const,
    validFromUtc: "2026-08-25T00:00:00.000Z",
    validUntilUtc: "2026-08-26T00:00:00.000Z",
  };
  return { ...unsigned, authorizationSha256: municipalPublicationAuthorizationChecksum(unsigned) };
}

test("freezes and binds the exact synthetic Municipal context and Kair bundle", () => {
  const exchange = new MunicipalContextExchange();
  const context = exchange.registerContext(contextFixture);
  const bundle = exchange.intakeSession(bundleFixture, "2026-08-25T11:00:00.000Z");

  assert.equal(context.contentSha256, "sha256:7eb0ac1bc6a8d436c44a8a6a8dc341813d0d330f3dee3ef64d3ba5047d64ba07");
  assert.equal(bundle.bundleSha256, "sha256:27a8e90685131824767977c002dac228dff474416ae8ddfe6592f2127e943b54");
  assert.equal(bundle.contextReferences[0]?.contentSha256, context.contentSha256);
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(bundle.consent.purposes), true);

  const mismatched = derivedBundle({
    bundleId: "kair-bundle-synthetic-context-mismatch",
    contextContentSha256: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  });
  assert.throws(() => exchange.intakeSession(mismatched, "2026-08-25T11:00:00.000Z"), /kair_session_context_binding_invalid/);
});

test("derives one public-safe human-reviewed artifact without leaking private bundle fields", () => {
  const exchange = new MunicipalContextExchange();
  const artifact = reviewBundle(exchange);
  const encoded = JSON.stringify(exchange.broadProjection());

  assert.equal(artifact.authorityState, "reviewed_non_official");
  assert.equal(artifact.correctionState, "current");
  assert.equal(artifact.publicPayloadSha256, publicSafePayloadChecksum(artifact.publicPayload));
  for (const forbidden of [bundleFixture.bundleId, bundleFixture.sourceContentSha256, bundleFixture.consent.receiptSha256, ...bundleFixture.privateContentReferences]) {
    assert.equal(encoded.includes(forbidden), false);
  }
  assert.equal(encoded.includes("Reviewed deliberation"), true);
});

test("keeps caseCitation purpose isolated from public-safe review consent", () => {
  const exchange = new MunicipalContextExchange();
  const artifact = reviewBundle(exchange);
  assert.throws(() => exchange.createCaseCitation({
    bundleId: bundleFixture.bundleId,
    bundleSha256: bundleFixture.bundleSha256,
    artifactId: artifact.artifactId,
    canonicalCaseId: caseId,
    citedAtUtc: "2026-08-25T11:20:00.000Z",
  }), /kair_session_case_citation_forbidden/);

  const citedBundle = derivedBundle({
    bundleId: "kair-bundle-synthetic-2026-001-case-citation",
    purposes: ["caseCitation", "publicSafeReview"],
  });
  const citedArtifact = reviewBundle(exchange, citedBundle, "reviewed-deliberation-synthetic-2026-001-case");
  assert.throws(() => exchange.createCaseCitation({
    bundleId: citedBundle.bundleId,
    bundleSha256: citedBundle.bundleSha256,
    artifactId: artifact.artifactId,
    canonicalCaseId: caseId,
    citedAtUtc: "2026-08-25T11:20:00.000Z",
  }), /kair_session_case_citation_forbidden/);
  const citation = exchange.createCaseCitation({
    bundleId: citedBundle.bundleId,
    bundleSha256: citedBundle.bundleSha256,
    artifactId: citedArtifact.artifactId,
    canonicalCaseId: caseId,
    citedAtUtc: "2026-08-25T11:20:00.000Z",
  });
  assert.equal(citation.canonicalCaseId, caseId);
  assert.match(citation.citationSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.throws(() => exchange.createCaseCitation({
    bundleId: citedBundle.bundleId,
    bundleSha256: citedBundle.bundleSha256,
    artifactId: citedArtifact.artifactId,
    canonicalCaseId: caseId,
    citedAtUtc: "2026-09-26T11:20:00.000Z",
  }), /kair_session_case_citation_forbidden/);
});

test("withdrawal preserves history while blocking future citation and publication eligibility", () => {
  const bundle = derivedBundle({
    bundleId: "kair-bundle-synthetic-2026-002-case-citation",
    purposes: ["caseCitation", "publicSafeReview"],
  });
  const exchange = new MunicipalContextExchange([publicationAuthorization()]);
  const artifact = reviewBundle(exchange, bundle, "reviewed-deliberation-synthetic-2026-002");
  const preparedCandidate = exchange.preparePublicationCandidate({
    candidateId: "candidate-prepared-before-withdrawal",
    sourceArtifactId: artifact.artifactId,
    sourceArtifactSha256: artifact.artifactSha256,
    version: 1,
    proposedPublisher: "sample-municipality",
    proposedOfficialKind: "Paper",
    visibility: "public",
    correctionOf: null,
  });
  const withdrawal = exchange.withdrawReviewedArtifact({ artifactId: artifact.artifactId, artifactSha256: artifact.artifactSha256, reasonCode: "consent-withdrawn", withdrawnAtUtc: "2026-08-25T11:30:00.000Z" });

  assert.equal(withdrawal.artifactId, artifact.artifactId);
  assert.equal(exchange.broadProjection().records.some((record) => record.id === artifact.artifactId), false);
  assert.equal(exchange.broadProjection().records.some((record) => record.id === withdrawal.correctionId), true);
  assert.equal(exchange.broadProjection().records.some((record) => record.id === preparedCandidate.candidateId), false);
  const history = exchange.changes(null, 10);
  assert.deepEqual(history.events.map((event) => event.artifact.id), [artifact.artifactId, preparedCandidate.candidateId, withdrawal.correctionId]);
  assert.throws(() => exchange.publishCandidate({ candidateId: preparedCandidate.candidateId, candidateSha256: preparedCandidate.candidateSha256, authorization: publicationAuthorization(), officialId: "urn:stadtstack:official:sample-municipality:withdrawn-paper", publishedAtUtc: "2026-08-25T12:30:00.000Z" }), /municipal_publication_source_not_eligible/);
  assert.throws(() => exchange.createCaseCitation({ bundleId: bundle.bundleId, bundleSha256: bundle.bundleSha256, artifactId: artifact.artifactId, canonicalCaseId: caseId, citedAtUtc: "2026-08-25T11:31:00.000Z" }), /kair_session_case_citation_forbidden/);
  assert.throws(() => exchange.preparePublicationCandidate({ candidateId: "candidate-withdrawn", sourceArtifactId: artifact.artifactId, sourceArtifactSha256: artifact.artifactSha256, version: 1, proposedPublisher: "sample-municipality", proposedOfficialKind: "Paper", visibility: "public", correctionOf: null }), /municipal_publication_source_not_eligible/);
});

test("serves deterministic correction-aware REST pages and equivalent read-only MCP pages", () => {
  const emptyExchange = new MunicipalContextExchange();
  const emptyPage = emptyExchange.changes(null, 10);
  const emptyMcpPage = createMcpCivicContextAdapter(emptyExchange).listChanges(null, 10);
  assert.equal(emptyPage.projectionVersion, 0);
  assert.equal(consumeEquivalentCivicContextPages(emptyPage, emptyMcpPage).acceptedEventCount, 0);
  const exchange = new MunicipalContextExchange();
  const artifact = reviewBundle(exchange);
  exchange.withdrawReviewedArtifact({ artifactId: artifact.artifactId, artifactSha256: artifact.artifactSha256, reasonCode: "scope-withdrawn", withdrawnAtUtc: "2026-08-25T11:30:00.000Z" });
  const first = exchange.changes(null, 1);
  const second = exchange.changes(first.nextCursor, 10);
  const mcp = createMcpCivicContextAdapter(exchange).listChanges(null, 1);

  assert.equal(first.events.length, 1);
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0]?.correctionState, "withdrawn");
  assert.equal(mcp.readOnly, true);
  assert.equal(mcp.authority, "none");
  assert.deepEqual(mcp.page, first);
  assert.equal(mcp.projectionSha256, exchange.broadProjection().contentSha256);
  assert.equal(serializeCivicChangePage(first).endsWith("\n"), true);
  assert.throws(() => exchange.changes("caller-selected-cursor", 10), /civic_change_cursor_invalid/);
  assert.equal(JSON.stringify(first.events).includes(bundleFixture.bundleId), false);
  const consumerReceipt = consumeEquivalentCivicContextPages(first, mcp);
  assert.equal(consumerReceipt.restMcpEquivalent, true);
  assert.equal(consumerReceipt.projectionSha256, first.projectionSha256);
  assert.equal(consumerReceipt.pageSha256, first.pageSha256);
  assert.throws(
    () => consumeEquivalentCivicContextPages(first, { ...mcp, projectionSha256: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" }),
    /municipal_context_reference_consumer_drift/,
  );
});

test("keeps a reviewed openDesk return non-official until an exact authorized publication receipt", () => {
  const exchange = new MunicipalContextExchange([publicationAuthorization()]);
  const administrationReturn = exchange.admitReviewedAdministrationReturn(reviewedAdministrationReturn());
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

  assert.equal(candidate.institutionalEffect, "none");
  assert.equal(exchange.strictOparlProjection().papers.length, 0);
  assert.throws(() => exchange.publishCandidate({ candidateId: candidate.candidateId, candidateSha256: candidate.candidateSha256, authorization: { ...publicationAuthorization(), principalId: "attacker" }, officialId: "urn:stadtstack:official:sample-municipality:paper-2026-001", publishedAtUtc: "2026-08-25T12:30:00.000Z" }), /municipal_publication_authorization_checksum_invalid/);

  const action = {
    candidateId: candidate.candidateId,
    candidateSha256: candidate.candidateSha256,
    authorization: publicationAuthorization(),
    officialId: "urn:stadtstack:official:sample-municipality:paper-2026-001",
    publishedAtUtc: "2026-08-25T12:30:00.000Z",
  };
  const first = exchange.publishCandidate(action);
  const replay = exchange.publishCandidate(action);
  const strict = exchange.strictOparlProjection();

  assert.deepEqual(replay, first);
  assert.throws(() => exchange.publishCandidate({ ...action, authorization: publicationAuthorization("sample-municipality-publisher-2") }), /municipal_publication_authority_forbidden/);
  assert.throws(() => exchange.publishCandidate({ ...action, officialId: "urn:stadtstack:official:sample-municipality:other-paper" }), /municipal_publication_action_conflict/);
  const collidingCandidate = exchange.preparePublicationCandidate({
    candidateId: "municipal-publication-candidate-synthetic-2026-002",
    sourceArtifactId: administrationReturn.artifactId,
    sourceArtifactSha256: administrationReturn.artifactSha256,
    version: 2,
    proposedPublisher: "sample-municipality",
    proposedOfficialKind: "Paper",
    visibility: "public",
    correctionOf: null,
  });
  assert.throws(() => exchange.publishCandidate({ ...action, candidateId: collidingCandidate.candidateId, candidateSha256: collidingCandidate.candidateSha256 }), /municipal_publication_official_id_conflict/);
  assert.equal(first.receipt.institutionalEffectCeiling, "official_publication");
  assert.equal(first.receipt.candidateVersion, candidate.version);
  assert.equal(first.receipt.authorizationSha256, action.authorization.authorizationSha256);
  assert.equal(first.publication.receiptSha256, first.receipt.receiptSha256);
  assert.equal(strict.papers.length, 1);
  const firstPaper = strict.papers[0];
  assert.ok(firstPaper && typeof firstPaper === "object" && "type" in firstPaper);
  assert.deepEqual(firstPaper.type, "https://schema.oparl.org/1.1/Paper");
  assert.equal(JSON.stringify(strict).includes("municipal_publication_candidate"), false);
});

test("fails closed for invalid official kinds, expired/revoked consent and authority-bearing method guesses", () => {
  const expired = derivedBundle({
    bundleId: "expired-bundle",
    expiresAtUtc: "2026-08-25T10:46:00.000Z",
  });
  const exchange = new MunicipalContextExchange(); exchange.registerContext(contextFixture);
  assert.throws(() => exchange.intakeSession(expired, "2026-08-25T11:00:00.000Z"), /kair_session_consent_expired/);

  const revoked = derivedBundle({ bundleId: "revoked-bundle", revoked: true });
  assert.throws(() => exchange.intakeSession(revoked, "2026-08-25T10:50:00.000Z"), /kair_session_consent_revoked/);

  const publicationExchange = new MunicipalContextExchange();
  const source = publicationExchange.admitReviewedAdministrationReturn(reviewedAdministrationReturn());
  for (const officialKind of ["Decision", "Meeting"]) {
    assert.throws(() => publicationExchange.preparePublicationCandidate({ candidateId: `bad-kind-${officialKind}`, sourceArtifactId: source.artifactId, sourceArtifactSha256: source.artifactSha256, version: 1, proposedPublisher: "sample-municipality", proposedOfficialKind: officialKind, visibility: "public", correctionOf: null }), /municipal_publication_candidate_invalid/);
  }
  assert.throws(() => publicationExchange.preparePublicationCandidate({ candidateId: "bad-publisher", sourceArtifactId: source.artifactId, sourceArtifactSha256: source.artifactSha256, version: 1, proposedPublisher: "different-municipality", proposedOfficialKind: "Paper", visibility: "public", correctionOf: null }), /municipal_publication_candidate_invalid/);
  for (const forbidden of ["admitCase", "vote", "publishWithoutAuthorization", "executeTreasury", "writeChangeFeed"]) {
    assert.equal(forbidden in publicationExchange, false);
  }
});
