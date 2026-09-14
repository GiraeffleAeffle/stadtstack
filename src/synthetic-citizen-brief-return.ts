import { createHash } from "node:crypto";
import { parseSyntheticCaseId } from "./case-id.ts";
import type { ProjectionEnvelope, ReviewedCitizenBriefProjection } from "./civic-case-coordinator.ts";

/** A public demo return, never municipal public knowledge or participation. */
export type SyntheticCitizenBriefReturnV1 = {
  schemaVersion: "synthetic_citizen_brief_return_v1";
  environment: "staging";
  testOnly: true;
  authorityBinding: "none";
  caseId: string;
  municipalityId: string;
  discussionId: string;
  topicId: string;
  caseVersion: number;
  policyVersion: string;
  status: "not_ready" | "current" | "withdrawn";
  brief: ReviewedCitizenBriefProjection | null;
  returnChecksum: string;
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => [key, canonical(item)]));
}

/** Called only with the current replay-verified PUBLIC coordinator projection.
 * Nothing from pending packages, private evidence or the journal is copied. */
export function createSyntheticCitizenBriefReturn(envelope: ProjectionEnvelope): SyntheticCitizenBriefReturnV1 {
  const p = envelope.projection, suggestion = p.suggestion;
  const source = suggestion.discussionRef;
  const topicId = suggestion.admission?.sourceTopicId;
  if (!parseSyntheticCaseId(envelope.caseId) || p.caseId !== envelope.caseId ||
    envelope.visibility !== "public" || p.authorityBinding !== "none" || suggestion.status !== "admitted" ||
    source.type !== "nostr_event" || !/^[0-9a-f]{64}$/u.test(source.id) || !topicId) {
    throw new Error("synthetic_brief_projection_invalid");
  }
  const candidate = p.reviewedCitizenBrief;
  let brief: ReviewedCitizenBriefProjection | null = null;
  if (candidate?.correctionState === "current") {
    if (candidate.responses.length !== 8 || candidate.provenance.packageBindings.length !== 8 ||
      candidate.provenance.sourceDiscussionRef.id !== source.id || candidate.provenance.suggestionId !== suggestion.id ||
      candidate.authorityBinding !== "none" || candidate.policyVersion !== envelope.policyVersion) {
      throw new Error("synthetic_brief_projection_invalid");
    }
    // Explicit public allowlist; never forward the administrative view.
    brief = {
      schemaVersion: "citizen_brief_projection_v1", id: candidate.id, title: candidate.title, summary: candidate.summary,
      responses: candidate.responses.map(({ departmentId, publicSummary, publicCitations }) =>
        ({ departmentId, publicSummary, publicCitations: [...publicCitations] })),
      provenance: { sourceDiscussionRef: { type: "nostr_event", id: source.id, ref: source.ref },
        suggestionId: candidate.provenance.suggestionId,
        packageBindings: candidate.provenance.packageBindings.map(({ packageId, packageChecksum, draftArtifactChecksum,
          reviewAttestationChecksum, departmentId, reviewedAt }) =>
          ({ packageId, packageChecksum, draftArtifactChecksum, reviewAttestationChecksum, departmentId, reviewedAt })) },
      briefChecksum: candidate.briefChecksum, policyVersion: candidate.policyVersion,
      correctionState: "current", authorityBinding: "none",
    };
  }
  const base = {
    schemaVersion: "synthetic_citizen_brief_return_v1" as const, environment: "staging" as const,
    testOnly: true as const, authorityBinding: "none" as const, caseId: envelope.caseId,
    municipalityId: p.municipalityId, discussionId: source.id, topicId,
    caseVersion: envelope.caseVersion, policyVersion: envelope.policyVersion,
    status: brief ? "current" as const : candidate ? "withdrawn" as const : "not_ready" as const, brief,
  };
  return { ...base, returnChecksum: `sha256:${createHash("sha256").update(JSON.stringify(canonical(base))).digest("hex")}` };
}
