import { createHash } from "node:crypto";

import {
  DETERMINISTIC_OUTCOME_REVIEWED_AT,
  DETERMINISTIC_REVIEWED_AT,
  type CivicCaseCoordinator,
  type ProjectionEnvelope,
} from "./civic-case-coordinator.ts";

const DEPARTMENTS = ["planning", "traffic", "environment", "finance", "legal", "public-order", "social-affairs", "public-works"] as const;

export type PermanentSyntheticE2eConfig = { caseId: string; policyVersion: string };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function project(coordinator: CivicCaseCoordinator, config: PermanentSyntheticE2eConfig, profile: "public" | "administration" | "council"): ProjectionEnvelope {
  return coordinator.project({
    schemaVersion: "query_envelope_v1",
    queryType: "case_projection_v1",
    caseId: config.caseId,
    actorBinding: { actorId: `roebel:${profile}-reader`, actorClass: profile },
    visibility: profile,
    policyVersion: config.policyVersion,
    atCaseVersion: null,
  });
}

export function projectPermanentSyntheticE2e(
  coordinator: CivicCaseCoordinator,
  config: PermanentSyntheticE2eConfig,
  profile: "public" | "administration" | "council",
): ProjectionEnvelope {
  return project(coordinator, config, profile);
}

function result(coordinator: CivicCaseCoordinator, config: PermanentSyntheticE2eConfig) {
  const publicView = project(coordinator, config, "public");
  const administration = project(coordinator, config, "administration");
  const council = project(coordinator, config, "council");
  const brief = publicView.projection.reviewedCitizenBrief;
  const participation = publicView.projection.participationResult;
  const outcome = publicView.projection.reviewedOutcome;
  if (!brief || !participation || !outcome || administration.projection.departmentPackages?.length !== 8) {
    throw new Error("permanent_synthetic_e2e_incomplete");
  }
  return Object.freeze({
    status: "completed" as const,
    caseVersion: publicView.caseVersion,
    journalHeadChecksum: publicView.journalHeadChecksum,
    projectionChecksums: {
      public: publicView.projectionChecksum,
      administration: administration.projectionChecksum,
      council: council.projectionChecksum,
    },
    reviewedDepartmentCount: 8 as const,
    citizenBriefChecksum: brief.briefChecksum,
    participationChecksum: participation.checksum,
    outcomeChecksum: outcome.outcomeChecksum,
    authorityBinding: "none" as const,
    formalVoteStarted: false as const,
    externalPublication: false as const,
  });
}

/** Complete the synthetic non-authoritative workflow after real signed intake. */
export function completePermanentSyntheticE2e(coordinator: CivicCaseCoordinator, config: PermanentSyntheticE2eConfig) {
  let administration = project(coordinator, config, "administration");
  if (administration.projection.reviewedOutcome) return result(coordinator, config);
  if (administration.projection.suggestion.status !== "admitted") throw new Error("permanent_synthetic_e2e_suggestion_not_admitted");
  if (administration.projection.departmentPackages?.length) throw new Error("permanent_synthetic_e2e_partial_state");

  let version = administration.caseVersion;
  const prefix = `roebel:e2e:${administration.projection.suggestion.id}`;
  for (const departmentId of DEPARTMENTS) {
    version = coordinator.handle({
      schemaVersion: "command_envelope_v1",
      commandType: "assign_department_package_v1",
      caseId: config.caseId,
      actorBinding: { actorId: "roebel:case-steward", actorClass: "case_steward" },
      expectedCaseVersion: version,
      idempotencyKey: `${prefix}:package:${departmentId}`,
      visibility: "private_case",
      policyVersion: config.policyVersion,
      payload: { departmentPackage: {
        id: `package-${departmentId}`,
        departmentId,
        suggestionId: administration.projection.suggestion.id,
        request: `Synthetic E2E review of the bounded ${departmentId} evidence.`,
        assignedAgentActorId: `roebel:${departmentId}:agent`,
        assignedReviewerActorId: `roebel:${departmentId}:reviewer`,
        authorityBinding: "none",
      } },
    }).caseVersion;
  }

  for (const departmentId of DEPARTMENTS) {
    administration = project(coordinator, config, "administration");
    const assigned = administration.projection.departmentPackages?.find((item) => item.departmentId === departmentId);
    if (!assigned) throw new Error("permanent_synthetic_e2e_package_missing");
    const draft = coordinator.handle({
      schemaVersion: "command_envelope_v1",
      commandType: "record_department_draft_v1",
      caseId: config.caseId,
      actorBinding: { actorId: `roebel:${departmentId}:agent`, actorClass: "department_agent" },
      expectedCaseVersion: version,
      idempotencyKey: `${prefix}:draft:${departmentId}`,
      visibility: "private_case",
      policyVersion: config.policyVersion,
      payload: {
        packageId: assigned.id,
        packageChecksum: assigned.packageChecksum,
        draft: {
          schemaVersion: "department_draft_v1",
          id: `draft-${departmentId}`,
          publicSummary: `Geprüfte synthetische Stellungnahme des Bereichs ${departmentId} zur sicheren Querung.`,
          publicCitations: [`synthetic://roebel/marienfelder-strasse/${departmentId}/reviewed`],
          privateEvidenceRefs: [`synthetic://roebel/marienfelder-strasse/${departmentId}/private`],
          authorityBinding: "none",
        },
      },
    });
    administration = project(coordinator, config, "administration");
    const drafted = administration.projection.departmentPackages?.find((item) => item.departmentId === departmentId);
    if (!drafted?.draft) throw new Error("permanent_synthetic_e2e_draft_missing");
    version = coordinator.handle({
      schemaVersion: "command_envelope_v1",
      commandType: "attest_department_review_v1",
      caseId: config.caseId,
      actorBinding: { actorId: `roebel:${departmentId}:reviewer`, actorClass: "department_reviewer" },
      expectedCaseVersion: draft.caseVersion,
      idempotencyKey: `${prefix}:review:${departmentId}`,
      visibility: "private_case",
      policyVersion: config.policyVersion,
      payload: { review: {
        packageId: drafted.id,
        draftArtifactChecksum: drafted.draft.artifactChecksum,
        decision: "accepted",
        reviewedAt: DETERMINISTIC_REVIEWED_AT,
      } },
    }).caseVersion;
  }

  administration = project(coordinator, config, "administration");
  const packages = administration.projection.departmentPackages;
  if (!packages || packages.length !== 8 || packages.some((item) => !item.draft || !item.review?.attestationChecksum)) throw new Error("permanent_synthetic_e2e_review_incomplete");
  const briefReceipt = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "derive_citizen_brief_v1",
    caseId: config.caseId,
    actorBinding: { actorId: "roebel:case-steward", actorClass: "case_steward" },
    expectedCaseVersion: version,
    idempotencyKey: `${prefix}:brief`,
    visibility: "private_case",
    policyVersion: config.policyVersion,
    payload: { brief: {
      id: `urn:stadtstack:citizen-brief:${config.caseId}:1`,
      sourceBindings: packages.map((item) => ({
        packageId: item.id,
        packageChecksum: item.packageChecksum,
        draftArtifactChecksum: item.draft!.artifactChecksum,
        reviewAttestationChecksum: item.review!.attestationChecksum!,
      })),
      authorityBinding: "none",
    } },
  });
  const brief = project(coordinator, config, "public").projection.reviewedCitizenBrief;
  if (!brief) throw new Error("permanent_synthetic_e2e_brief_missing");
  const sourceBrief = { id: brief.id, briefChecksum: brief.briefChecksum, briefEventId: briefReceipt.eventIds[0]! };
  const participationWithoutChecksum = {
    schemaVersion: "participation_result_v1" as const,
    id: "participation-marienfelder-strasse-e2e-1",
    contractId: "synthetic:roebel-mitmachen-advisory",
    contractVersion: 1,
    methodKind: "survey",
    methodVersion: "synthetic-survey-v1",
    ruleId: "advisory-signal",
    ruleVersion: "1",
    authorityBinding: "none" as const,
    question: "Welche Querungsvariante soll zuerst geprüft werden?",
    options: [
      { optionId: "lighting", label: "Beleuchtung", aggregateCount: 2 },
      { optionId: "marked-crossing", label: "Markierte Querung", aggregateCount: 6 },
    ],
    totalAccepted: 8,
    resultSummary: "Die markierte Querung erhielt das stärkste synthetische beratende Signal.",
    unresolvedDissent: ["Beleuchtung bleibt für zwei synthetische Beiträge wichtig."],
    representationAudit: {
      targetPopulationDescription: "Synthetische Anwohnende der Marienfelder Straße",
      recruitmentMethod: "Synthetic opt-in",
      samplingMethod: "Voluntary response",
      totalInvited: null,
      totalStarted: 8,
      totalCompleted: 8,
      limitations: ["Synthetic data; not representative."],
    },
    limitations: ["Advisory synthetic signal only."],
    openedAt: "2026-08-01T00:00:00Z",
    closedAt: "2026-08-02T00:00:00Z",
    reviewedAt: "2026-08-08T00:00:05.000Z",
    resultArtifactRef: "synthetic://roebel/marienfelder-strasse/participation-result",
    minorityReportRef: null,
    correctionState: "current" as const,
  };
  const participation = {
    ...participationWithoutChecksum,
    checksum: sha256({
      participation: participationWithoutChecksum,
      sourceBrief,
      policyVersion: config.policyVersion,
      actorBinding: { actorId: "roebel:participation-reviewer", actorClass: "participation_reviewer" },
      reviewedAt: participationWithoutChecksum.reviewedAt,
    }),
  };
  const participationReceipt = coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "record_advisory_participation_v1",
    caseId: config.caseId,
    actorBinding: { actorId: "roebel:participation-reviewer", actorClass: "participation_reviewer" },
    expectedCaseVersion: briefReceipt.caseVersion,
    idempotencyKey: `${prefix}:participation`,
    visibility: "private_case",
    policyVersion: config.policyVersion,
    payload: { participation, sourceBrief: { id: brief.id, briefChecksum: brief.briefChecksum } },
  });
  coordinator.handle({
    schemaVersion: "command_envelope_v1",
    commandType: "record_reviewed_outcome_v1",
    caseId: config.caseId,
    actorBinding: { actorId: "roebel:case-steward", actorClass: "case_steward" },
    expectedCaseVersion: participationReceipt.caseVersion,
    idempotencyKey: `${prefix}:outcome`,
    visibility: "private_case",
    policyVersion: config.policyVersion,
    payload: { outcome: {
      schemaVersion: "reviewed_outcome_input_v1",
      id: "outcome-marienfelder-strasse-e2e-1",
      summary: "Die markierte Querung wird als stärkstes synthetisches beratendes Ergebnis weiter geprüft.",
      resultArtifactRef: "synthetic://roebel/marienfelder-strasse/reviewed-outcome",
      reviewedAt: DETERMINISTIC_OUTCOME_REVIEWED_AT,
      sourceDiscussionRef: { type: "nostr_event", id: administration.projection.discussion.id, ref: administration.projection.discussion.sourceRef },
      sourceBrief: { id: brief.id, briefChecksum: brief.briefChecksum },
      sourceParticipation: { id: participation.id, participationChecksum: participation.checksum },
      publicationTarget: "public_knowledge_projection",
      authorityBinding: "none",
    } },
  });
  return result(coordinator, config);
}
