import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { types as utilTypes } from "node:util";

import {
  publicKnowledgeChecksum,
  renderMitmachen,
  type PublicKnowledgeProjectionV1,
  type PublicKnowledgeReader,
} from "./public-knowledge.ts";

const CASE_SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
const CHECKSUM = /^sha256:[a-f0-9]{64}$/;
const COUNTRY = /^[A-Z]{2}$/;
const HOST = /^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|localhost|127\.0\.0\.1|::1)$/;
const POLICY_VERSION = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OWNER_KINDS = new Set(["municipal_body", "committee", "local_advisory_board", "department", "operator_role", "independent_evaluator", "other"]);
const PRIVATE_FIELD = /(?:privateEvidenceRefs|assignedAgentActorId|assignedReviewerActorId|reviewerActorId|participantId|eligibilityProof|secret|credential|password|nsec1|rawBallot|prompt|reasoning)/i;
const PRIVATE_VALUE = /(?:\bnsec1[a-z0-9]{8,}\b|\b(?:private[_ -]?key|secret[_ -]?key|password|credential)\s*[:=])/i;

export const CIVIC_CASE_MACRO_STAGE_IDS = [
  "facts", "mandate", "experience", "options", "decision", "delivery", "outcome",
] as const;

export const CIVIC_CASE_DETAIL_STAGE_IDS = [
  "candidate_selected",
  "evidence_baseline_ready",
  "authority_and_contract",
  "round_a_experience",
  "feasible_alternatives",
  "round_b_advisory",
  "administrative_synthesis",
  "official_decision",
  "institutional_response",
  "delivery",
  "outcome_evaluation",
  "impact_receipt_next_cycle",
] as const;

type MacroStageId = typeof CIVIC_CASE_MACRO_STAGE_IDS[number];
type DetailStageId = typeof CIVIC_CASE_DETAIL_STAGE_IDS[number];
type Lifecycle = "not_started" | "ready" | "active" | "waiting_external" | "blocked" | "completed" | "not_applicable" | "cancelled";
type TruthState = "reviewed" | "pending_review" | "review_due" | "stale" | "missing" | "fallback" | "demo";
type Attention = "normal" | "watch" | "action_required" | "critical";

type Municipality = {
  id: string;
  name: string;
  state: string;
  country: string;
};

type Owner = {
  id: string;
  label: string;
  kind: "municipal_body" | "committee" | "local_advisory_board" | "department" | "operator_role" | "independent_evaluator" | "other";
};

type ProofRef = {
  id: string;
  label: string;
  uri: string | null;
  checksum: string;
  reviewedAt: string | null;
};

type DetailStage = {
  id: DetailStageId;
  macroStageId: MacroStageId;
  label: string;
  summary: string;
  required: boolean;
  lifecycle: Lifecycle;
  timeliness: "no_deadline";
  attention: Attention;
  truthState: TruthState;
  authorityBinding: "not_applicable" | "declared" | "confirmed" | "formal_source";
  owner: Owner | null;
  dueAt: null;
  lastReviewedAt: string | null;
  startedAt: string | null;
  waitingSince: string | null;
  waitReason: string | null;
  completedAt: string | null;
  nextAction: string | null;
  availablePublicAction: { label: string; href: string } | null;
  blocker: string | null;
  proofRefs: ProofRef[];
};

type CurrentStage = {
  macroStageId: MacroStageId;
  detailStageId: DetailStageId;
  position: number;
  total: 7;
  label: string;
  lifecycle: Lifecycle;
  timeliness: "no_deadline";
  truthState: TruthState;
  owner: Owner | null;
  dueAt: null;
  nextAction: string | null;
  availablePublicAction: { label: string; href: string } | null;
  blocker: string | null;
  waitReason: string | null;
  lastReviewedAt: string | null;
};

export type PermanentStageMapV1 = {
  schemaVersion: "civic_case_stage_snapshot_v1";
  algorithmVersion: "1.0.0";
  caseKey: { municipalityId: string; decisionCaseSlug: string };
  sourceArtifactSetHash: string;
  decisionRouteVersion: null;
  truthState: "reviewed";
  participationAuthorityState: "declared";
  primaryCurrentMacroStageId: MacroStageId;
  primaryCurrentDetailStageId: DetailStageId;
  parallelActiveDetailStageIds: DetailStageId[];
  current: CurrentStage;
  macroStages: Array<{
    id: MacroStageId;
    position: number;
    label: string;
    lifecycle: Lifecycle;
    timeliness: "no_deadline";
    attention: Attention;
    detailStageIds: DetailStageId[];
  }>;
  detailStages: DetailStage[];
  derivedAt: string;
};

type CaseSummary = {
  decisionCaseSlug: string;
  title: string;
  publicSummary: string;
  truthState: "reviewed";
  participationAuthorityState: "declared";
  currentStage: CurrentStage;
  manifestUrl: string;
  stageMapUrl: string;
  publicCaseUrl: string;
  updatedAt: string;
};

type CaseIndex = {
  schemaVersion: "civic_federation_case_index_v1";
  municipality: Municipality;
  generatedAt: string;
  cases: CaseSummary[];
};

type CaseManifest = {
  schemaVersion: "civic_federation_manifest_v1";
  municipality: Municipality;
  decisionCaseSlug: string;
  generatedAt: string;
  publicCaseUrl: string;
  stageMap: { url: string; contentSha256: string; snapshot: PermanentStageMapV1 };
  artifacts: Array<{
    artifactType: "decision_case";
    artifactSchemaVersion: "public_knowledge_projection_v1";
    artifactId: string;
    artifactVersion: number;
    contentSha256: string;
    status: "reviewed";
    url: string;
    generatedAt: string;
  }>;
};

export type PermanentPublicSnapshot = {
  index: CaseIndex;
  manifest: CaseManifest | null;
  stageMap: PermanentStageMapV1 | null;
  artifacts: ReadonlyMap<string, unknown>;
};

export type PermanentPublicRuntimeConfig = {
  knowledge: PublicKnowledgeReader;
  municipality: Municipality;
  decisionCaseSlug: string;
  canonicalCaseId: string;
  policyVersion: string;
  publicCasePath: string;
  owner: Owner;
  http: {
    bindHost: "127.0.0.1" | "0.0.0.0";
    port: number;
    allowedHosts: readonly string[];
  };
  now?: () => string;
};

export type PermanentPublicRuntime = {
  readonly server: Server;
  snapshot(): PermanentPublicSnapshot;
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
};

const MACRO_LABELS: Record<MacroStageId, string> = {
  facts: "Fakten verstehen",
  mandate: "Mandat klären",
  experience: "Erfahrungen sammeln",
  options: "Optionen ausarbeiten und abwägen",
  decision: "Entscheiden und begründen",
  delivery: "Umsetzen",
  outcome: "Wirkung prüfen und zurückmelden",
};

const DETAIL_REGISTRY: Record<DetailStageId, { macro: MacroStageId; label: string; summary: string; required: boolean }> = {
  candidate_selected: { macro: "facts", label: "Fall ausgewählt", summary: "Das lokale Problem ist als überprüfbarer Entscheidungsfall beschrieben.", required: true },
  evidence_baseline_ready: { macro: "facts", label: "Evidenz und Ausgangslage", summary: "Quellen, bekannte Einschränkungen und Datenlücken sind nachvollziehbar.", required: true },
  authority_and_contract: { macro: "mandate", label: "Mandat und Beteiligungsvertrag", summary: "Zuständigkeit, offene Fragen, Antwortpflicht und Entscheidungsroute sind bestätigt.", required: true },
  round_a_experience: { macro: "experience", label: "Runde A: Erfahrungen", summary: "Betroffene Perspektiven werden online und offline gesammelt und geprüft.", required: true },
  feasible_alternatives: { macro: "options", label: "Machbare Alternativen", summary: "Verwaltung und Planung überführen Erfahrungen in realisierbare Optionen.", required: true },
  round_b_advisory: { macro: "options", label: "Runde B: Optionen abwägen", summary: "Machbare Optionen können in einer getrennten beratenden Runde verglichen werden.", required: false },
  administrative_synthesis: { macro: "options", label: "Verwaltungsprüfung und Entscheidungsbrief", summary: "Evidenz, Beteiligung, Machbarkeit, Kosten und offene Konflikte werden zusammengeführt.", required: true },
  official_decision: { macro: "decision", label: "Zuständige Entscheidung", summary: "Die zuständige Stelle entscheidet oder leitet den Fall durch die formale Route.", required: true },
  institutional_response: { macro: "decision", label: "Begründete institutionelle Antwort", summary: "Die Entscheidung wird mit Gründen, Zusagen, Zuständigkeiten und Fristen veröffentlicht.", required: true },
  delivery: { macro: "delivery", label: "Umsetzung", summary: "Zusagen, Meilensteine, Änderungen, Verzögerungen und Nachweise bleiben sichtbar.", required: true },
  outcome_evaluation: { macro: "outcome", label: "Wirkung auswerten", summary: "Beobachtungen werden gegen die Ausgangslage geprüft, inklusive Unsicherheit.", required: true },
  impact_receipt_next_cycle: { macro: "outcome", label: "Wirkungsquittung und nächster Zyklus", summary: "Bewohner sehen Antwort, Umsetzung, Wirkung und den nächsten Schritt.", required: true },
};

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("permanent_public_canonical_invalid");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!value || typeof value !== "object") throw new Error("permanent_public_canonical_invalid");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

export function permanentStageMapChecksum(stageMap: PermanentStageMapV1): string {
  const stable = structuredClone(stageMap) as Partial<PermanentStageMapV1>;
  delete stable.derivedAt;
  return sha256(stable);
}

function exactKeys(value: unknown, expected: readonly string[], code: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value)) throw new Error(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || keys.some((key) => typeof key !== "string" || !expected.includes(key))) throw new Error(code);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) throw new Error(code);
  }
}

function exactArray(value: unknown, code: string): asserts value is unknown[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new Error(code);
  const keys = Reflect.ownKeys(value);
  const expected = Array.from({ length: value.length }, (_, index) => String(index));
  if (keys.length !== expected.length + 1 || !keys.includes("length") || expected.some((key) => !keys.includes(key))) throw new Error(code);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) throw new Error(code);
  }
}

function assertPlain(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (PRIVATE_VALUE.test(value)) throw new Error("permanent_public_knowledge_invalid");
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new Error("permanent_public_knowledge_invalid");
    return;
  }
  if (typeof value !== "object" || utilTypes.isProxy(value) || seen.has(value)) throw new Error("permanent_public_knowledge_invalid");
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) throw new Error("permanent_public_knowledge_invalid");
    exactArray(value, "permanent_public_knowledge_invalid");
  } else if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("permanent_public_knowledge_invalid");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new Error("permanent_public_knowledge_invalid");
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable || PRIVATE_FIELD.test(key)) {
      throw new Error("permanent_public_knowledge_invalid");
    }
    assertPlain(descriptor.value, seen);
  }
  seen.delete(value);
}

function iso(value: string, code: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(code);
  }
  return value;
}

function validateKnowledgeShape(value: PublicKnowledgeProjectionV1): void {
  exactKeys(value.discussion, ["id", "sourceRef", "content", "signerPubkey", "outcomeRef"], "permanent_public_knowledge_invalid");
  if (value.discussion.outcomeRef !== null) exactKeys(value.discussion.outcomeRef, ["id", "outcomeChecksum"], "permanent_public_knowledge_invalid");
  exactKeys(value.suggestion, ["id", "title", "summary", "status", "signerPubkey", "admissionChecksum"], "permanent_public_knowledge_invalid");
  exactKeys(value.citizenBrief, ["id", "title", "summary", "briefChecksum", "sourceDiscussionRef", "reviewedDepartmentCount", "reviewedCitations"], "permanent_public_knowledge_invalid");
  exactArray(value.citizenBrief.reviewedCitations, "permanent_public_knowledge_invalid");
  exactKeys(value.participation, [
    "id", "question", "options", "totalAccepted", "resultSummary", "unresolvedDissent", "openedAt", "closedAt",
    "reviewedAt", "checksum", "advisory",
  ], "permanent_public_knowledge_invalid");
  exactArray(value.participation.options, "permanent_public_knowledge_invalid");
  for (const option of value.participation.options) exactKeys(option, ["optionId", "label", "aggregateCount"], "permanent_public_knowledge_invalid");
  exactArray(value.participation.unresolvedDissent, "permanent_public_knowledge_invalid");
  if (value.reviewedOutcome !== null) exactKeys(value.reviewedOutcome, [
    "id", "summary", "resultArtifactRef", "reviewedAt", "outcomeChecksum", "discussionRef", "externalPublication",
  ], "permanent_public_knowledge_invalid");
  exactKeys(value.governance, ["participationKind", "formalVoteAvailable", "formalVoteReason", "councilSubmissionCreated"], "permanent_public_knowledge_invalid");
}

function validateKnowledge(value: PublicKnowledgeProjectionV1, config: PermanentPublicRuntimeConfig): PublicKnowledgeProjectionV1 {
  assertPlain(value);
  const record = value as unknown as Record<string, unknown>;
  exactKeys(record, [
    "schemaVersion", "caseId", "municipalityId", "sourceCaseId", "policyVersion", "caseVersion",
    "journalHeadChecksum", "sourceProjectionChecksum", "discussion", "suggestion", "citizenBrief",
    "participation", "reviewedOutcome", "governance", "authorityBinding", "knowledgeChecksum",
  ], "permanent_public_knowledge_invalid");
  validateKnowledgeShape(value);
  const { knowledgeChecksum, ...core } = value;
  if (
    value.municipalityId !== config.municipality.id ||
    value.sourceCaseId !== config.decisionCaseSlug ||
    value.caseId !== config.canonicalCaseId ||
    value.policyVersion !== config.policyVersion
  ) {
    throw new Error("permanent_public_knowledge_scope_invalid");
  }
  if (
    value.schemaVersion !== "public_knowledge_projection_v1" ||
    value.authorityBinding !== "none" ||
    !Number.isSafeInteger(value.caseVersion) || value.caseVersion < 1 ||
    !CHECKSUM.test(value.journalHeadChecksum) ||
    !CHECKSUM.test(value.sourceProjectionChecksum) ||
    !CHECKSUM.test(knowledgeChecksum) ||
    publicKnowledgeChecksum(core) !== knowledgeChecksum ||
    value.governance.participationKind !== "advisory_non_binding" ||
    value.governance.formalVoteAvailable !== false ||
    value.governance.formalVoteReason !== "separate_legal_authority_binding_required" ||
    value.governance.councilSubmissionCreated !== false ||
    value.citizenBrief.reviewedDepartmentCount !== 8 ||
    value.citizenBrief.sourceDiscussionRef !== value.discussion.sourceRef ||
    value.suggestion.signerPubkey !== value.discussion.signerPubkey ||
    !/^[a-f0-9]{64}$/.test(value.discussion.signerPubkey) ||
    !CHECKSUM.test(value.suggestion.admissionChecksum) ||
    !CHECKSUM.test(value.citizenBrief.briefChecksum) ||
    !CHECKSUM.test(value.participation.checksum) ||
    value.participation.options.length === 0 ||
    new Set(value.participation.options.map((option) => option.optionId)).size !== value.participation.options.length ||
    value.participation.options.some((option) => !Number.isSafeInteger(option.aggregateCount) || option.aggregateCount < 0) ||
    value.participation.options.reduce((total, option) => total + option.aggregateCount, 0) !== value.participation.totalAccepted ||
    value.participation.advisory !== true ||
    value.reviewedOutcome?.externalPublication !== false ||
    (value.reviewedOutcome !== null && (
      !CHECKSUM.test(value.reviewedOutcome.outcomeChecksum) ||
      value.reviewedOutcome.discussionRef !== value.discussion.sourceRef ||
      value.discussion.outcomeRef?.id !== value.reviewedOutcome.id ||
      value.discussion.outcomeRef?.outcomeChecksum !== value.reviewedOutcome.outcomeChecksum
    ))
  ) throw new Error("permanent_public_knowledge_invalid");
  const openedAt = iso(value.participation.openedAt, "permanent_public_knowledge_invalid");
  const closedAt = iso(value.participation.closedAt, "permanent_public_knowledge_invalid");
  const reviewedAt = iso(value.participation.reviewedAt, "permanent_public_knowledge_invalid");
  if (!(Date.parse(openedAt) <= Date.parse(closedAt) && Date.parse(closedAt) <= Date.parse(reviewedAt))) throw new Error("permanent_public_knowledge_invalid");
  if (value.reviewedOutcome) iso(value.reviewedOutcome.reviewedAt, "permanent_public_knowledge_invalid");
  return structuredClone(value);
}

function cloneOwner(owner: Owner): Owner {
  return { id: owner.id, label: owner.label, kind: owner.kind };
}

function proof(id: string, label: string, checksum: string, reviewedAt: string): ProofRef[] {
  return [{ id, label, uri: null, checksum, reviewedAt }];
}

function detailStages(knowledge: PublicKnowledgeProjectionV1, config: PermanentPublicRuntimeConfig): DetailStage[] {
  const outcomeReady = knowledge.reviewedOutcome !== null;
  const participationAt = knowledge.participation.reviewedAt;
  const outcomeAt = knowledge.reviewedOutcome?.reviewedAt ?? null;
  const currentId: DetailStageId = outcomeReady ? "delivery" : "institutional_response";
  const completed = new Set<DetailStageId>([
    "candidate_selected", "evidence_baseline_ready", "authority_and_contract", "round_a_experience",
    "feasible_alternatives", "round_b_advisory", "administrative_synthesis",
    ...(outcomeReady ? ["institutional_response" as const] : []),
  ]);
  return CIVIC_CASE_DETAIL_STAGE_IDS.map((id) => {
    const definition = DETAIL_REGISTRY[id];
    const isOfficialDecision = id === "official_decision";
    const isCurrent = id === currentId;
    const isCompleted = completed.has(id);
    const lifecycle: Lifecycle = isOfficialDecision
      ? "not_applicable"
      : isCompleted
        ? "completed"
        : isCurrent
          ? (id === "delivery" ? "ready" : "waiting_external")
          : "not_started";
    const reviewedAt = id === "institutional_response" && outcomeAt ? outcomeAt : participationAt;
    let proofRefs: ProofRef[] = [];
    if (id === "candidate_selected") proofRefs = proof("signed-suggestion", "Signierter Vorschlag", knowledge.suggestion.admissionChecksum, participationAt);
    if (id === "evidence_baseline_ready" || id === "administrative_synthesis") proofRefs = proof("citizen-brief", "Geprüfter Citizen Brief", knowledge.citizenBrief.briefChecksum, participationAt);
    if (id === "round_b_advisory") proofRefs = proof("participation-result", "Geprüftes beratendes Ergebnis", knowledge.participation.checksum, participationAt);
    if (id === "institutional_response" && knowledge.reviewedOutcome) proofRefs = proof("reviewed-outcome", "Geprüfter öffentlicher Ausgang", knowledge.reviewedOutcome.outcomeChecksum, knowledge.reviewedOutcome.reviewedAt);
    return {
      id,
      macroStageId: definition.macro,
      label: definition.label,
      summary: definition.summary,
      required: definition.required,
      lifecycle,
      timeliness: "no_deadline",
      attention: isCurrent && lifecycle === "waiting_external" ? "action_required" : "normal",
      truthState: lifecycle === "not_started" ? "missing" : "reviewed",
      authorityBinding: id === "authority_and_contract" ? "declared" : "not_applicable",
      owner: isCurrent ? cloneOwner(config.owner) : null,
      dueAt: null,
      lastReviewedAt: isCompleted || isCurrent || isOfficialDecision ? reviewedAt : null,
      startedAt: isCompleted || isCurrent ? reviewedAt : null,
      waitingSince: lifecycle === "waiting_external" ? reviewedAt : null,
      waitReason: lifecycle === "waiting_external" ? "Die begründete institutionelle Antwort steht noch aus." : null,
      completedAt: isCompleted ? reviewedAt : null,
      nextAction: isCurrent
        ? id === "delivery"
          ? "Geprüfte Zusagen und Umsetzungsschritte mit Nachweisen fortschreiben."
          : "Eine begründete institutionelle Antwort veröffentlichen."
        : null,
      availablePublicAction: isCurrent ? { label: "Mitmachen ansehen", href: "/mitmachen" } : null,
      blocker: lifecycle === "waiting_external" ? "Die institutionelle Antwort wurde noch nicht geprüft veröffentlicht." : null,
      proofRefs,
    };
  });
}

function buildStageMap(knowledge: PublicKnowledgeProjectionV1, config: PermanentPublicRuntimeConfig): PermanentStageMapV1 {
  const details = detailStages(knowledge, config);
  const currentDetail = details.find((stage) => stage.required && stage.lifecycle !== "completed" && stage.lifecycle !== "not_applicable") ?? details.at(-1)!;
  const currentMacroId = currentDetail.macroStageId;
  const attentionRank: Record<Attention, number> = { normal: 0, watch: 1, action_required: 2, critical: 3 };
  const macros = CIVIC_CASE_MACRO_STAGE_IDS.map((id, index) => {
    const children = details.filter((stage) => stage.macroStageId === id);
    const lifecycle: Lifecycle = children.every((stage) => stage.lifecycle === "completed" || stage.lifecycle === "not_applicable")
      ? "completed"
      : (children.find((stage) => stage.lifecycle !== "completed" && stage.lifecycle !== "not_applicable")?.lifecycle ?? "not_started");
    const attention = children.reduce<Attention>((highest, stage) => attentionRank[stage.attention] > attentionRank[highest] ? stage.attention : highest, "normal");
    return {
      id,
      position: index + 1,
      label: MACRO_LABELS[id],
      lifecycle,
      timeliness: "no_deadline" as const,
      attention,
      detailStageIds: children.map((stage) => stage.id),
    };
  });
  const currentMacro = macros.find((macro) => macro.id === currentMacroId)!;
  const derivedAt = knowledge.reviewedOutcome?.reviewedAt ?? knowledge.participation.reviewedAt;
  return {
    schemaVersion: "civic_case_stage_snapshot_v1",
    algorithmVersion: "1.0.0",
    caseKey: { municipalityId: config.municipality.id, decisionCaseSlug: config.decisionCaseSlug },
    sourceArtifactSetHash: knowledge.knowledgeChecksum,
    decisionRouteVersion: null,
    truthState: "reviewed",
    participationAuthorityState: "declared",
    primaryCurrentMacroStageId: currentMacroId,
    primaryCurrentDetailStageId: currentDetail.id,
    parallelActiveDetailStageIds: [],
    current: {
      macroStageId: currentMacroId,
      detailStageId: currentDetail.id,
      position: currentMacro.position,
      total: 7,
      label: currentMacro.label,
      lifecycle: currentDetail.lifecycle,
      timeliness: currentDetail.timeliness,
      truthState: currentDetail.truthState,
      owner: currentDetail.owner ? cloneOwner(currentDetail.owner) : null,
      dueAt: null,
      nextAction: currentDetail.nextAction,
      availablePublicAction: currentDetail.availablePublicAction ? { ...currentDetail.availablePublicAction } : null,
      blocker: currentDetail.blocker,
      waitReason: currentDetail.waitReason,
      lastReviewedAt: currentDetail.lastReviewedAt,
    },
    macroStages: macros,
    detailStages: details,
    derivedAt,
  };
}

function emptySnapshot(config: PermanentPublicRuntimeConfig, generatedAt: string): PermanentPublicSnapshot {
  return {
    index: {
      schemaVersion: "civic_federation_case_index_v1",
      municipality: structuredClone(config.municipality),
      generatedAt,
      cases: [],
    },
    manifest: null,
    stageMap: null,
    artifacts: new Map(),
  };
}

function buildSnapshot(config: PermanentPublicRuntimeConfig, emptyGeneratedAt: string): PermanentPublicSnapshot {
  let raw: PublicKnowledgeProjectionV1;
  try {
    raw = config.knowledge.project();
  } catch {
    return emptySnapshot(config, emptyGeneratedAt);
  }
  const knowledge = validateKnowledge(raw, config);
  const stageMap = buildStageMap(knowledge, config);
  const generatedAt = stageMap.derivedAt;
  const caseBase = `/api/federation/v1/municipalities/${encodeURIComponent(config.municipality.id)}/cases/${encodeURIComponent(config.decisionCaseSlug)}`;
  const artifactId = `decision-case:${config.municipality.id}:${config.decisionCaseSlug}`;
  const artifactUrl = `/api/federation/v1/municipalities/${encodeURIComponent(config.municipality.id)}/artifacts/${encodeURIComponent(artifactId)}/${knowledge.caseVersion}`;
  const summary: CaseSummary = {
    decisionCaseSlug: config.decisionCaseSlug,
    title: knowledge.suggestion.title,
    publicSummary: knowledge.reviewedOutcome?.summary ?? knowledge.citizenBrief.summary,
    truthState: "reviewed",
    participationAuthorityState: "declared",
    currentStage: structuredClone(stageMap.current),
    manifestUrl: `${caseBase}/manifest`,
    stageMapUrl: `${caseBase}/stage-map`,
    publicCaseUrl: config.publicCasePath,
    updatedAt: generatedAt,
  };
  const artifactBody = structuredClone(knowledge) as Partial<PublicKnowledgeProjectionV1>;
  delete artifactBody.knowledgeChecksum;
  const manifest: CaseManifest = {
    schemaVersion: "civic_federation_manifest_v1",
    municipality: structuredClone(config.municipality),
    decisionCaseSlug: config.decisionCaseSlug,
    generatedAt,
    publicCaseUrl: config.publicCasePath,
    stageMap: {
      url: `${caseBase}/stage-map`,
      contentSha256: permanentStageMapChecksum(stageMap),
      snapshot: structuredClone(stageMap),
    },
    artifacts: [{
      artifactType: "decision_case",
      artifactSchemaVersion: "public_knowledge_projection_v1",
      artifactId,
      artifactVersion: knowledge.caseVersion,
      contentSha256: knowledge.knowledgeChecksum,
      status: "reviewed",
      url: artifactUrl,
      generatedAt,
    }],
  };
  return {
    index: {
      schemaVersion: "civic_federation_case_index_v1",
      municipality: structuredClone(config.municipality),
      generatedAt,
      cases: [summary],
    },
    manifest,
    stageMap,
    artifacts: new Map([[artifactUrl, structuredClone(artifactBody)]]),
  };
}

function validateConfig(config: PermanentPublicRuntimeConfig): void {
  if (!config || typeof config !== "object" || Array.isArray(config) || utilTypes.isProxy(config)) throw new Error("permanent_public_config_invalid");
  const configKeys = Reflect.ownKeys(config);
  const topKeys = ["knowledge", "municipality", "decisionCaseSlug", "canonicalCaseId", "policyVersion", "publicCasePath", "owner", "http"];
  if (configKeys.includes("now")) topKeys.push("now");
  exactKeys(config, topKeys, "permanent_public_config_invalid");
  exactKeys(config.knowledge, ["project"], "permanent_public_config_invalid");
  if (typeof config.knowledge.project !== "function" || utilTypes.isProxy(config.knowledge.project)) throw new Error("permanent_public_config_invalid");
  exactKeys(config.municipality, ["id", "name", "state", "country"], "permanent_public_config_invalid");
  exactKeys(config.owner, ["id", "label", "kind"], "permanent_public_config_invalid");
  exactKeys(config.http, ["bindHost", "port", "allowedHosts"], "permanent_public_config_invalid");
  if (config.now !== undefined && (typeof config.now !== "function" || utilTypes.isProxy(config.now))) throw new Error("permanent_public_config_invalid");
  if (!CASE_SLUG.test(config.municipality.id) || !CASE_SLUG.test(config.decisionCaseSlug)) throw new Error("permanent_public_config_invalid");
  if (!config.municipality.name.trim() || config.municipality.name !== config.municipality.name.trim() || !config.municipality.state.trim() || config.municipality.state !== config.municipality.state.trim() || !COUNTRY.test(config.municipality.country)) throw new Error("permanent_public_config_invalid");
  const canonicalParts = config.canonicalCaseId.split(":");
  if (canonicalParts.length !== 6 || canonicalParts.slice(0, 4).join(":") !== "urn:stadtstack:case:municipality" || canonicalParts[4] !== config.municipality.id || !UUID_V7.test(canonicalParts[5] ?? "") || !POLICY_VERSION.test(config.policyVersion)) throw new Error("permanent_public_config_invalid");
  if (config.publicCasePath !== `/kommunen/${config.municipality.id}/entscheidungen/${config.decisionCaseSlug}`) throw new Error("permanent_public_config_invalid");
  if (!config.owner.id.trim() || config.owner.id !== config.owner.id.trim() || !config.owner.label.trim() || config.owner.label !== config.owner.label.trim() || !OWNER_KINDS.has(config.owner.kind)) throw new Error("permanent_public_config_invalid");
  if (!Number.isInteger(config.http.port) || config.http.port < 0 || config.http.port > 65_535) throw new Error("permanent_public_config_invalid");
  if (config.http.bindHost !== "127.0.0.1" && config.http.bindHost !== "0.0.0.0") throw new Error("permanent_public_config_invalid");
  exactArray(config.http.allowedHosts, "permanent_public_config_invalid");
  if (config.http.allowedHosts.length === 0 || new Set(config.http.allowedHosts.map((host) => host.toLowerCase())).size !== config.http.allowedHosts.length) throw new Error("permanent_public_config_invalid");
  for (const host of config.http.allowedHosts) if (typeof host !== "string" || !HOST.test(host.toLowerCase())) throw new Error("permanent_public_config_invalid");
}

function requestHost(header: string | undefined): string | null {
  if (!header || /[\u0000-\u0020\u007f]/.test(header)) return null;
  if (header.startsWith("[")) {
    const match = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(header);
    return match?.[1]?.toLowerCase() ?? null;
  }
  const match = /^([^:]+)(?::\d{1,5})?$/.exec(header);
  return match?.[1]?.toLowerCase() ?? null;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function sendHtml(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

export function createPermanentPublicRuntime(config: PermanentPublicRuntimeConfig): PermanentPublicRuntime {
  validateConfig(config);
  config = {
    knowledge: Object.freeze({ project: config.knowledge.project }),
    municipality: structuredClone(config.municipality),
    decisionCaseSlug: config.decisionCaseSlug,
    canonicalCaseId: config.canonicalCaseId,
    policyVersion: config.policyVersion,
    publicCasePath: config.publicCasePath,
    owner: structuredClone(config.owner),
    http: { ...structuredClone(config.http), allowedHosts: [...config.http.allowedHosts] },
    ...(config.now === undefined ? {} : { now: config.now }),
  };
  const emptyGeneratedAt = iso((config.now ?? (() => new Date().toISOString()))(), "permanent_public_clock_invalid");
  const allowedHosts = new Set(config.http.allowedHosts.map((host) => host.toLowerCase()));
  const snapshot = () => buildSnapshot(config, emptyGeneratedAt);
  snapshot();

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    try {
      const host = requestHost(request.headers.host);
      if (!host || !allowedHosts.has(host)) return sendJson(response, 400, { error: "invalid_host" });
      const url = request.url ?? "";
      if (url.includes("?") || url.includes("#")) return sendJson(response, 400, { error: "invalid_request" });
      if (request.method !== "GET") {
        const known = url === "/healthz" || url === "/readyz" || url === "/mitmachen" || url === config.publicCasePath || url.startsWith("/api/federation/v1/");
        return sendJson(response, known ? 405 : 404, { error: known ? "method_not_allowed" : "not_found" });
      }
      if (url === "/healthz" || url === "/readyz") return sendJson(response, 200, { status: url === "/healthz" ? "ok" : "ready", mode: "reviewed_public_read_only" });
      const current = snapshot();
      const indexPath = `/api/federation/v1/municipalities/${encodeURIComponent(config.municipality.id)}/cases`;
      const caseBase = `${indexPath}/${encodeURIComponent(config.decisionCaseSlug)}`;
      if (url === indexPath) return sendJson(response, 200, current.index);
      if (url === `${caseBase}/manifest`) return current.manifest ? sendJson(response, 200, current.manifest) : sendJson(response, 404, { error: "reviewed_case_not_found" });
      if (url === `${caseBase}/stage-map`) return current.stageMap ? sendJson(response, 200, current.stageMap) : sendJson(response, 404, { error: "reviewed_case_not_found" });
      if (current.artifacts.has(url)) return sendJson(response, 200, current.artifacts.get(url));
      if (url === "/mitmachen" || url === config.publicCasePath) {
        if (!current.manifest) return sendJson(response, 404, { error: "reviewed_case_not_found" });
        const knowledge = validateKnowledge(config.knowledge.project(), config);
        return sendHtml(response, 200, renderMitmachen({
          schemaVersion: "mitmachen_view_v1",
          route: "/mitmachen",
          status: "available",
          knowledge,
          interaction: {
            mode: "read_only_reference",
            advisoryChoiceVisible: true,
            submissionAvailable: false,
            formalVoteAvailable: false,
          },
        }));
      }
      return sendJson(response, 404, { error: "not_found" });
    } catch {
      return sendJson(response, 503, { error: "reviewed_public_projection_unavailable" });
    }
  });

  return {
    server,
    snapshot,
    listen() {
      return new Promise((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        server.once("error", onError);
        server.listen(config.http.port, config.http.bindHost, () => {
          server.off("error", onError);
          const address = server.address();
          if (!address || typeof address === "string") return reject(new Error("permanent_public_address_invalid"));
          resolve({ host: address.address, port: address.port });
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}
