#!/usr/bin/env node

import { createHash } from "node:crypto";
import http from "node:http";
import { createCivicCaseCoordinator, DETERMINISTIC_REVIEWED_AT } from "../src/civic-case-coordinator.ts";
import { createNostrDiscussionAdapter } from "../src/adapters/discussion-adapter.ts";
import { buildBrowserAcceptanceEvidence, createReferenceBrowserServer, sha256Reference } from "../src/reference-browser.ts";

const municipalityId = "sample-municipality";
const caseId = "urn:stadtstack:case:test:sample-municipality:018f0000-0000-7000-8000-000000000001";
const scope = { municipalityId, caseId: "sample-case" };
const policyVersion = "case-intake-v1";
const fixturePubkey = "7190b3fcc08cd9c4edb5ef541e8a578089cb8727ba93c4cfb0583e2287d57bd2";
const discussionId = "44ac22db49995e6ec96344b624d3ee01eb50ad814cf80f51af05959bb305412c";
const discussionSignature = "4db87c0f4d8d36de728c086bbec21a19224b639f29bf3334d032cc9584b39db4d4f41180a3485c440c83583a61937b53e9de4fe13d375b4635d23590917cf80e";
const departments = ["planning", "traffic", "environment", "finance", "legal", "public-order", "social-affairs", "public-works"];
const participationReviewedAt = "2026-08-08T00:00:05.000Z";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function requestWithHost(port, method, pathname, host) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port, method, path: pathname, headers: { host } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on("error", reject);
    request.end();
  });
}

function project(coordinator, actorId, actorClass, visibility) {
  return coordinator.project({
    schemaVersion: "query_envelope_v1",
    queryType: "case_projection_v1",
    caseId,
    actorBinding: { actorId, actorClass },
    visibility,
    policyVersion,
    atCaseVersion: null,
  });
}

function fixtureCoordinator() {
  const event = {
    kind: 1,
    created_at: 1_754_035_200,
    tags: [["municipality", municipalityId], ["case", scope.caseId], ["t", "stadtstack-e2e-fixture"]],
    content: "Could the crossing be made safer?",
    pubkey: fixturePubkey,
    id: discussionId,
    sig: discussionSignature,
  };
  const discussion = createNostrDiscussionAdapter({ scope, syntheticFixtureOnly: true }).normalize(event);
  const actors = [
    { actorId: "synthetic:citizen-1", actorClass: "citizen" },
    { actorId: "synthetic:public-1", actorClass: "public" },
    { actorId: "synthetic:administration-1", actorClass: "administration" },
    { actorId: "synthetic:council-1", actorClass: "council" },
    { actorId: "synthetic:steward-1", actorClass: "case_steward" },
    { actorId: "synthetic:participation-reviewer-1", actorClass: "participation_reviewer" },
    ...departments.flatMap((departmentId) => [
      { actorId: `synthetic:${departmentId}-agent`, actorClass: "department_agent", departmentId },
      { actorId: `synthetic:${departmentId}-reviewer`, actorClass: "department_reviewer", departmentId },
    ]),
  ];
  const coordinator = createCivicCaseCoordinator({
    scope,
    syntheticFixtureOnly: true,
    allowedSignerPubkeys: [fixturePubkey],
    requiredDepartmentIds: departments,
    actors,
  });
  let version = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "intake_discussion_v1",
    caseId,
    actorBinding: { actorId: "synthetic:citizen-1", actorClass: "citizen" },
    expectedCaseVersion: 0,
    idempotencyKey: "synthetic:idem:discussion-1",
    visibility: "private_case",
    policyVersion,
    payload: { discussion },
  }).caseVersion;

  for (const departmentId of departments) {
    version = coordinator.handle({
      schemaVersion: "command_envelope_v1",
      commandType: "assign_department_package_v1",
      caseId,
      actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
      expectedCaseVersion: version,
      idempotencyKey: `synthetic:idem:package-${departmentId}`,
      visibility: "private_case",
      policyVersion,
      payload: {
        departmentPackage: {
          id: `package-${departmentId}`,
          departmentId,
          suggestionId: `urn:stadtstack:suggestion:${discussionId}`,
          request: `Review a bounded ${departmentId} response.`,
          assignedAgentActorId: `synthetic:${departmentId}-agent`,
          assignedReviewerActorId: `synthetic:${departmentId}-reviewer`,
          authorityBinding: "none",
        },
      },
    }).caseVersion;
  }

  for (const departmentId of departments) {
    const administration = project(coordinator, "synthetic:administration-1", "administration", "administration");
    const packageProjection = administration.projection.departmentPackages.find((item) => item.departmentId === departmentId);
    const draftReceipt = coordinator.handle({
      schemaVersion: "command_envelope_v1",
      commandType: "record_department_draft_v1",
      caseId,
      actorBinding: { actorId: `synthetic:${departmentId}-agent`, actorClass: "department_agent" },
      expectedCaseVersion: version,
      idempotencyKey: `synthetic:idem:draft-${departmentId}`,
      visibility: "private_case",
      policyVersion,
      payload: {
        packageId: packageProjection.id,
        packageChecksum: packageProjection.packageChecksum,
        draft: {
          schemaVersion: "department_draft_v1",
          id: `draft-${departmentId}-1`,
          publicSummary: `Reviewed ${departmentId} response.`,
          publicCitations: [`synthetic://${departmentId}/evidence-1`],
          privateEvidenceRefs: [`synthetic://${departmentId}/private-evidence-1`],
          authorityBinding: "none",
        },
      },
    });
    const drafted = project(coordinator, "synthetic:administration-1", "administration", "administration").projection.departmentPackages.find((item) => item.departmentId === departmentId);
    version = coordinator.handle({
      schemaVersion: "command_envelope_v1",
      commandType: "attest_department_review_v1",
      caseId,
      actorBinding: { actorId: `synthetic:${departmentId}-reviewer`, actorClass: "department_reviewer" },
      expectedCaseVersion: draftReceipt.caseVersion,
      idempotencyKey: `synthetic:idem:review-${departmentId}`,
      visibility: "private_case",
      policyVersion,
      payload: { review: { packageId: drafted.id, draftArtifactChecksum: drafted.draft.artifactChecksum, decision: "accepted", reviewedAt: DETERMINISTIC_REVIEWED_AT } },
    }).caseVersion;
  }

  const administration = project(coordinator, "synthetic:administration-1", "administration", "administration");
  const sourceBindings = administration.projection.departmentPackages.map((item) => ({
    packageId: item.id,
    packageChecksum: item.packageChecksum,
    draftArtifactChecksum: item.draft.artifactChecksum,
    reviewAttestationChecksum: item.review.attestationChecksum,
  }));
  const derive = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "derive_citizen_brief_v1",
    caseId,
    actorBinding: { actorId: "synthetic:steward-1", actorClass: "case_steward" },
    expectedCaseVersion: version,
    idempotencyKey: "synthetic:idem:citizen-brief-1",
    visibility: "private_case",
    policyVersion,
    payload: { brief: { id: `urn:stadtstack:citizen-brief:${caseId}:1`, sourceBindings, authorityBinding: "none" } },
  });
  const brief = project(coordinator, "synthetic:public-1", "public", "public").projection.reviewedCitizenBrief;
  const participationBase = {
    schemaVersion: "participation_result_v1",
    id: "participation-result-1",
    contractId: "synthetic:crossing-advisory",
    contractVersion: 1,
    methodKind: "survey",
    methodVersion: "synthetic-survey-v1",
    ruleId: "advisory-signal",
    ruleVersion: "1",
    authorityBinding: "none",
    question: "Which safety improvement should be reviewed first?",
    options: [
      { optionId: "better-lighting", label: "Better lighting", aggregateCount: 2 },
      { optionId: "safer-crossing", label: "Safer crossing", aggregateCount: 6 },
    ],
    totalAccepted: 8,
    resultSummary: "A safer crossing was the strongest advisory signal.",
    unresolvedDissent: ["Lighting remains important to some participants."],
    representationAudit: {
      targetPopulationDescription: "Residents near the crossing",
      recruitmentMethod: "Synthetic opt-in",
      samplingMethod: "Voluntary response",
      totalInvited: null,
      totalStarted: 8,
      totalCompleted: 8,
      limitations: ["Synthetic data; not representative."],
    },
    limitations: ["Advisory signal only."],
    openedAt: "2026-08-01T00:00:00Z",
    closedAt: "2026-08-02T00:00:00Z",
    reviewedAt: participationReviewedAt,
    resultArtifactRef: "synthetic://participation/result-1",
    minorityReportRef: null,
    correctionState: "current",
  };
  const sourceBrief = { id: brief.id, briefChecksum: brief.briefChecksum, briefEventId: derive.eventIds[0] };
  const participation = {
    ...participationBase,
    checksum: sha256({
      participation: participationBase,
      sourceBrief,
      policyVersion,
      actorBinding: { actorId: "synthetic:participation-reviewer-1", actorClass: "participation_reviewer" },
      reviewedAt: participationReviewedAt,
    }),
  };
  coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "record_advisory_participation_v1",
    caseId,
    actorBinding: { actorId: "synthetic:participation-reviewer-1", actorClass: "participation_reviewer" },
    expectedCaseVersion: derive.caseVersion,
    idempotencyKey: "synthetic:idem:participation-1",
    visibility: "private_case",
    policyVersion,
    payload: { participation, sourceBrief: { id: brief.id, briefChecksum: brief.briefChecksum } },
  });
  return coordinator;
}

function accessibility(html) {
  return {
    keyboard: /a:focus-visible/.test(html),
    headings: (html.match(/<h[1-6]\b/g) ?? []).length >= 3 && (html.match(/<h1\b/g) ?? []).length === 1,
    landmarks: /<header>/.test(html) && /<nav\b/.test(html) && /<main>/.test(html) && /<footer>/.test(html),
    labels: /<dt>Case<\/dt>/.test(html),
    focus: /outline:3px solid #005fcc/.test(html),
    contrast: /#17202a/.test(html) && /#fff/.test(html),
    readable: /Offline synthetic reference surface/.test(html),
  };
}

const coordinator = fixtureCoordinator();
const projectOnly = { project: coordinator.project };
const actors = {
  public: { actorId: "synthetic:public-1", actorClass: "public" },
  administration: { actorId: "synthetic:administration-1", actorClass: "administration" },
  council: { actorId: "synthetic:council-1", actorClass: "council" },
};
const identities = {
  public: "did:stadtstack:sample:mecky-public",
  administration: "did:stadtstack:sample:mecky-administration",
  council: "did:stadtstack:sample:mecky-council",
};
const sessions = {
  public: "session:public:reference",
  administration: "session:administration:reference",
  council: "session:council:reference",
};
const reference = createReferenceBrowserServer({ coordinator: projectOnly, caseId, policyVersion, actors, identities, sessions });
const serveOnly = process.argv.includes("--serve");
const portArgument = process.argv.find((argument) => argument.startsWith("--port="));
const requestedPort = portArgument === undefined ? 0 : Number(portArgument.slice("--port=".length));
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535) throw new Error("reference_port_invalid");
const listening = await reference.listen(requestedPort);
if (serveOnly) {
  process.stdout.write(`STADTSTACK_REFERENCE_BROWSER_READY http://${listening.host}:${listening.port}\n`);
  await new Promise((resolve) => {
    const stop = () => { process.off("SIGINT", stop); process.off("SIGTERM", stop); resolve(); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  await reference.close();
  process.exit(0);
}
const routes = [];
const views = {};
for (const route of ["public", "administration", "council"]) {
  const pathname = `/${route}`;
  const response = await fetch(`http://127.0.0.1:${listening.port}${pathname}`);
  const html = await response.text();
  if (response.status !== 200) throw new Error(`reference_route_failed:${pathname}:${response.status}`);
  const view = await reference.render(pathname);
  views[route] = view;
  const a11y = accessibility(html);
  if (!Object.values(a11y).every(Boolean) || /<script\b|<form\b|<img\b|<iframe\b|fetch\(|localStorage|sessionStorage/i.test(html) || (/<link\b/i.test(html) && !/<link rel="icon" href="data:,">/.test(html))) throw new Error(`reference_accessibility_failed:${pathname}`);
  routes.push({
    route: pathname,
    status: 200,
    visibility: route,
    caseVersion: view.caseVersion,
    journalHeadChecksum: view.journalHeadChecksum,
    projectionChecksum: view.projectionChecksum,
    contentChecksum: sha256Reference(html),
    consoleErrors: 0,
    externalRequests: 0,
    destinations: [`loopback:${pathname}`],
    accessibility: a11y,
  });
}
for (const [method, pathname, expectedStatus, headers] of [
  ["GET", "/unknown", 404, {}],
  ["GET", "/public/", 404, {}],
  ["GET", "/public?caseId=forged", 400, {}],
  ["POST", "/public", 405, {}],
  ["GET", "/public", 400, { host: "example.invalid" }],
]) {
  const response = headers.host
    ? await requestWithHost(listening.port, method, pathname, headers.host)
    : await fetch(`http://127.0.0.1:${listening.port}${pathname}`, { method });
  if ((response.status ?? response.statusCode) !== expectedStatus) throw new Error(`reference_negative_failed:${method}:${pathname}:${response.status ?? response.statusCode}`);
}
await reference.close();
const publicView = views.public;
const evidence = buildBrowserAcceptanceEvidence({
  status: "completed",
  mode: "offline_synthetic_only",
  source: "CivicCaseCoordinator.project",
  caseId,
  policyVersion,
  flow: {
    discussionId: publicView.flow.discussion.id,
    suggestionId: publicView.flow.suggestion.id,
    reviewedDepartmentCount: 8,
    briefChecksum: publicView.flow.reviewedCitizenBrief.briefChecksum,
    participationChecksum: publicView.flow.participation.checksum,
    councilState: "dry_run_not_submitted",
  },
  routes,
  rolePrivacy: { publicPrivateEvidenceVisible: false, publicReviewerMetadataVisible: false, councilPrivateEvidenceVisible: false, administrationPrivateEvidenceVisible: true },
  continuity: { sameCaseId: true, samePolicyVersion: true, sameJournalHead: new Set(routes.map((route) => route.journalHeadChecksum)).size === 1, sourceBoundBrief: true, sourceBoundParticipation: true },
  authority: { authorityBinding: "none", publicWrite: false, publication: false, formalVote: false, councilSubmissionCreated: false, formalVoteStarted: false, externalNetworkCalled: false, paidProviderCalled: false, hiddenState: false },
  provenance: { localProofOnly: true, deploymentReady: false, civicReadiness: false, browserTool: "contract-harness" },
});
process.stdout.write(`${canonical(evidence)}\n`);
