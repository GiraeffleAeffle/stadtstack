import assert from "node:assert/strict";
import test from "node:test";

import {
  createReferenceBrowserServer,
  renderReferenceView,
  sha256Reference,
} from "../src/reference-browser.ts";

const CASE_ID = "urn:stadtstack:case:test:sample:018f0000-0000-7000-8000-000000000001";
const MUNICIPALITY = "sample";
const POLICY = "case-intake-v1";
const ACTORS = {
  public: { actorId: "synthetic:public-1", actorClass: "public" as const },
  administration: { actorId: "synthetic:administration-1", actorClass: "administration" as const },
  council: { actorId: "synthetic:council-1", actorClass: "council" as const },
};
const IDENTITIES = {
  public: "did:stadtstack:sample:mecky-public",
  administration: "did:stadtstack:sample:mecky-administration",
  council: "did:stadtstack:sample:mecky-council",
};
const SESSIONS = {
  public: "session:public:reference",
  administration: "session:administration:reference",
  council: "session:council:reference",
};

function checksum(_value: unknown): string {
  return `sha256:${"a".repeat(64)}`;
}

function projectionFor(visibility: "public" | "administration" | "council") {
  const packages = ["planning", "traffic", "environment", "finance", "legal", "public-order", "social-affairs", "public-works"].map((departmentId, index) => ({
    schemaVersion: "department_package_projection_v1" as const,
    id: `package-${departmentId}`,
    departmentId,
    suggestionId: "suggestion-1",
    request: `Review ${departmentId}`,
    packageChecksum: `sha256:${String(index + 1).padStart(64, "0")}`,
    assignedAgentActorId: `synthetic:${departmentId}-agent`,
    assignedReviewerActorId: `synthetic:${departmentId}-reviewer`,
    draft: {
      schemaVersion: "department_draft_projection_v1" as const,
      id: `draft-${departmentId}`,
      publicSummary: `${departmentId} reviewed summary`,
      publicCitations: [`synthetic://${departmentId}/citation`],
      privateEvidenceRefs: [`synthetic://${departmentId}/private`],
      artifactChecksum: `sha256:${String(index + 11).padStart(64, "0")}`,
      actorId: `synthetic:${departmentId}-agent`,
    },
    reviewState: "accepted" as const,
    correctionState: "current" as const,
    review: {
      decision: "accepted" as const,
      draftArtifactChecksum: `sha256:${String(index + 11).padStart(64, "0")}`,
      reviewedAt: "2026-08-08T00:00:00.000Z",
      policyVersion: POLICY,
      attestationChecksum: `sha256:${String(index + 21).padStart(64, "0")}`,
      reviewerActorId: `synthetic:${departmentId}-reviewer`,
    },
    artifactChecksum: `sha256:${String(index + 11).padStart(64, "0")}`,
    reviewedAt: "2026-08-08T00:00:00.000Z",
    policyVersion: POLICY,
    publicSummary: `${departmentId} reviewed summary`,
    publicCitations: [`synthetic://${departmentId}/citation`],
    authorityBinding: "none" as const,
  }));
  const sourceBindings = packages.map((item) => ({
    packageId: item.id,
    packageChecksum: item.packageChecksum,
    draftArtifactChecksum: item.draft!.artifactChecksum,
    reviewAttestationChecksum: item.review!.attestationChecksum,
    departmentId: item.departmentId,
    reviewedAt: item.reviewedAt!,
  }));
  return {
    schemaVersion: "case_projection_v1" as const,
    caseId: CASE_ID,
    municipalityId: MUNICIPALITY,
    jurisdiction: { scheme: "test" as const, value: MUNICIPALITY },
    sourceScope: { municipalityId: MUNICIPALITY, caseId: CASE_ID },
    authorityBinding: "none" as const,
    formalDecision: null,
    discussion: {
      schemaVersion: "discussion_projection_v1" as const,
      id: "discussion-1",
      source: "nostr" as const,
      sourceRef: "nostr://event/discussion-1",
      sourceReference: { type: "nostr_event" as const, id: "discussion-1", ref: "nostr://event/discussion-1" },
      scope: { municipalityId: MUNICIPALITY, caseId: CASE_ID },
      content: "Could the crossing be made safer?",
      event: { kind: 1, created_at: 1, tags: [], content: "Could the crossing be made safer?", pubkey: "f".repeat(64), id: "discussion-1", sig: "s".repeat(128) },
      verificationProof: { verified: true, method: "nip01" },
      authorityBinding: "none" as const,
      provenance: {} as never,
    },
    discussions: [] as never[],
    suggestion: {
      schemaVersion: "suggestion_projection_v1" as const,
      id: "suggestion-1",
      discussionId: "discussion-1",
      discussionRef: { type: "nostr_event" as const, id: "discussion-1", ref: "nostr://event/discussion-1" },
      title: "Review the crossing",
      status: "draft" as const,
      authorityBinding: "none" as const,
      provenance: { type: "nostr_event" as const, id: "discussion-1", ref: "nostr://event/discussion-1" },
    },
    suggestions: [] as never[],
    provenance: {} as never,
    departmentPackages: visibility === "administration" ? packages : packages.map((item) => ({
      schemaVersion: item.schemaVersion,
      id: item.id,
      departmentId: item.departmentId,
      suggestionId: item.suggestionId,
      request: item.request,
      packageChecksum: item.packageChecksum,
      reviewState: item.reviewState,
      correctionState: item.correctionState,
      artifactChecksum: item.artifactChecksum,
      reviewedAt: item.reviewedAt,
      publicSummary: item.publicSummary,
      publicCitations: item.publicCitations,
      authorityBinding: item.authorityBinding,
    })),
    reviewedCitizenBrief: {
      schemaVersion: "citizen_brief_projection_v1" as const,
      id: "brief-1",
      title: "Crossing review",
      summary: "Reviewed crossing responses.",
      responses: packages.map((item) => ({ departmentId: item.departmentId, publicSummary: item.publicSummary!, publicCitations: item.publicCitations! })),
      provenance: {
        sourceDiscussionRef: { type: "nostr_event" as const, id: "discussion-1", ref: "nostr://event/discussion-1" },
        suggestionId: "suggestion-1",
        packageBindings: sourceBindings,
      },
      briefChecksum: checksum({}),
      policyVersion: POLICY,
      correctionState: "current" as const,
      authorityBinding: "none" as const,
    },
    participationResult: {
      schemaVersion: "participation_result_v1" as const,
      id: "participation-1",
      contractId: "synthetic:contract",
      contractVersion: 1,
      methodKind: "survey",
      methodVersion: "synthetic-v1",
      ruleId: "rule",
      ruleVersion: "1",
      authorityBinding: "none" as const,
      question: "Which?",
      options: [{ optionId: "a", label: "A", aggregateCount: 1 }],
      totalAccepted: 1,
      resultSummary: "A",
      unresolvedDissent: [],
      representationAudit: { targetPopulationDescription: "Residents", recruitmentMethod: "synthetic", samplingMethod: null, totalInvited: null, totalStarted: 1, totalCompleted: 1, limitations: [] },
      limitations: [],
      openedAt: "2026-08-01T00:00:00.000Z",
      closedAt: "2026-08-02T00:00:00.000Z",
      reviewedAt: "2026-08-08T00:00:00.000Z",
      resultArtifactRef: "synthetic://participation/result",
      minorityReportRef: null,
      correctionState: "current" as const,
      checksum: checksum({ participation: true }),
      advisory: true as const,
    },
    councilDryRunBrief: visibility === "council" ? {
      schemaVersion: "council_dry_run_brief_v1" as const,
      state: "dry_run_not_submitted" as const,
      authorityBinding: "none" as const,
      summary: "Dry run",
      citizenSignal: null,
      reviewedDepartmentResponseCount: 8,
      formalDecision: null,
      councilSubmissionCreated: false as const,
      formalVoteStarted: false as const,
      publicWrite: false as const,
    } : undefined,
  };
}

function sourceFor(): { project: (query: unknown) => unknown } {
  return {
    project(query: unknown) {
      const visibility = (query as { visibility: "public" | "administration" | "council" }).visibility;
      return {
        schemaVersion: "projection_envelope_v1" as const,
        caseId: CASE_ID,
        caseVersion: 42,
        journalHeadChecksum: checksum("head"),
        projectionChecksum: sha256Reference({ schemaVersion: "projection_envelope_v1", caseId: CASE_ID, caseVersion: 42, visibility, policyVersion: POLICY, projection: projectionFor(visibility) }),
        visibility,
        policyVersion: POLICY,
        projection: projectionFor(visibility),
      };
    },
  };
}

test("reference browser renders a project-only public surface and rejects mutating seam", async () => {
  const source = sourceFor();
  assert.throws(
    () => createReferenceBrowserServer({
      coordinator: { ...source, handle() { return {}; } } as never,
      caseId: CASE_ID,
      policyVersion: POLICY,
      actors: ACTORS,
      identities: IDENTITIES,
      sessions: SESSIONS,
    }),
    /project_only|handle_forbidden/,
  );

  const reference = createReferenceBrowserServer({
    coordinator: source as never,
    caseId: CASE_ID,
    policyVersion: POLICY,
    actors: ACTORS,
    identities: IDENTITIES,
    sessions: SESSIONS,
  });
  const view = await reference.render("/public");
  assert.equal(view.schemaVersion, "reference_view_v1");
  assert.equal(view.route, "public");
  assert.equal(view.flow.reviewedDepartments.length, 8);
  assert.equal(view.flow.reviewedCitizenBrief?.id, "brief-1");
  assert.equal(view.flow.participation?.advisory, true);
  assert.equal(view.flow.council, null);
  assert.equal(view.mecky?.profile, "public");
  assert.doesNotMatch(JSON.stringify(view), /privateEvidenceRefs|assignedAgentActorId|assignedReviewerActorId|reviewerActorId/);

  const html = renderReferenceView(view);
  assert.match(html, /<link rel="icon" href="data:,">/);
  assert.doesNotMatch(html, /<script\b|fetch\(/i);
  assert.match(html, /@media\(max-width:640px\)/);
  assert.match(html, /<header>/);
  assert.match(html, /<nav\b/);
  assert.match(html, /<main>/);
  assert.match(html, /<footer>/);
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  const forgedView = structuredClone(view) as Record<string, unknown>;
  forgedView.extra = "unexpected";
  assert.throws(() => renderReferenceView(forgedView as never), /reference_view_field_forbidden:view\.extra/);
});

test("all role routes reuse one projection read and keep administration evidence private", async () => {
  let projectCalls = 0;
  const source = sourceFor();
  const counted = {
    project(query: unknown) {
      projectCalls += 1;
      return source.project(query);
    },
  };
  const reference = createReferenceBrowserServer({ coordinator: counted as never, caseId: CASE_ID, policyVersion: POLICY, actors: ACTORS, identities: IDENTITIES, sessions: SESSIONS });
  const publicView = await reference.render("/public");
  const administrationView = await reference.render("/administration");
  const councilView = await reference.render("/council");
  assert.equal(projectCalls, 3);
  assert.equal(administrationView.flow.administrationPackages?.length, 8);
  assert.match(JSON.stringify(administrationView), /privateEvidenceRefs/);
  assert.doesNotMatch(JSON.stringify(publicView), /privateEvidenceRefs|reviewerActorId/);
  assert.doesNotMatch(JSON.stringify(councilView), /privateEvidenceRefs|reviewerActorId/);
  assert.equal(councilView.flow.council?.state, "dry_run_not_submitted");
  const mutable = publicView.flow.reviewedDepartments as unknown as Array<{ publicCitations: string[] }>;
  mutable[0]!.publicCitations[0] = "synthetic://tampered";
  const fresh = await reference.render("/public");
  assert.notEqual(fresh.flow.reviewedDepartments[0]!.publicCitations[0], "synthetic://tampered");
  await assert.rejects(() => reference.render("/public?caseId=forged"), /reference_route_not_found/);
  await assert.rejects(() => reference.render("/public/"), /reference_route_not_found/);
});

test("projection failures and private public projections fail closed without case HTML", async () => {
  const throwing = createReferenceBrowserServer({
    coordinator: { project() { throw new Error("should not cross the boundary"); } } as never,
    caseId: CASE_ID,
    policyVersion: POLICY,
    actors: ACTORS,
    identities: IDENTITIES,
    sessions: SESSIONS,
  });
  await assert.rejects(() => throwing.render("/public"), /projection_unavailable_v1|mecky_unavailable_v1/);

  const privateProjection = {
    project(query: unknown) {
      const result = sourceFor().project(query) as Record<string, unknown>;
      const envelope = structuredClone(result) as Record<string, unknown>;
      const projection = envelope.projection as Record<string, unknown>;
      projection.departmentPackages = projectionFor("administration").departmentPackages;
      return envelope;
    },
  };
  const guarded = createReferenceBrowserServer({ coordinator: privateProjection as never, caseId: CASE_ID, policyVersion: POLICY, actors: ACTORS, identities: IDENTITIES, sessions: SESSIONS });
  await assert.rejects(() => guarded.render("/public"), /mecky_unavailable_v1|projection_unavailable_v1/);
});
