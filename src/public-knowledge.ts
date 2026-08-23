import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { types as utilTypes } from "node:util";

import type {
  ActorBinding,
  CivicCaseCoordinator,
  ProjectionEnvelope,
} from "./civic-case-coordinator.ts";

export type PublicKnowledgeReader = {
  project(): PublicKnowledgeProjectionV1;
};

export type PublicKnowledgeProjectionV1 = {
  schemaVersion: "public_knowledge_projection_v1";
  caseId: string;
  municipalityId: string;
  sourceCaseId: string;
  policyVersion: string;
  caseVersion: number;
  journalHeadChecksum: string;
  sourceProjectionChecksum: string;
  discussion: {
    id: string;
    sourceRef: string;
    content: string;
    signerPubkey: string;
    outcomeRef: { id: string; outcomeChecksum: string } | null;
  };
  suggestion: {
    id: string;
    title: string;
    summary: string;
    status: "admitted";
    signerPubkey: string;
    admissionChecksum: string;
    sourceTopicId: string | null;
  };
  citizenBrief: {
    id: string;
    title: string;
    summary: string;
    briefChecksum: string;
    sourceDiscussionRef: string;
    reviewedDepartmentCount: 8;
    reviewedCitations: readonly string[];
  };
  participation: {
    id: string;
    question: string;
    options: readonly { optionId: string; label: string; aggregateCount: number }[];
    totalAccepted: number;
    resultSummary: string;
    unresolvedDissent: readonly string[];
    openedAt: string;
    closedAt: string;
    reviewedAt: string;
    checksum: string;
    advisory: true;
  };
  reviewedOutcome: {
    id: string;
    summary: string;
    resultArtifactRef: string;
    reviewedAt: string;
    outcomeChecksum: string;
    discussionRef: string;
    externalPublication: false;
  } | null;
  governance: {
    participationKind: "advisory_non_binding";
    formalVoteAvailable: false;
    formalVoteReason: "separate_legal_authority_binding_required";
    councilSubmissionCreated: false;
  };
  authorityBinding: "none";
  knowledgeChecksum: string;
};

export type PublicKnowledgeConfig = {
  coordinator: Pick<CivicCaseCoordinator, "project">;
  caseId: string;
  policyVersion: string;
  actorBinding: ActorBinding & { actorClass: "public" };
};

export type MitmachenViewV1 = {
  schemaVersion: "mitmachen_view_v1";
  route: "/mitmachen";
  status: "available";
  knowledge: PublicKnowledgeProjectionV1;
  interaction: {
    mode: "read_only_reference";
    advisoryChoiceVisible: true;
    submissionAvailable: false;
    formalVoteAvailable: false;
  };
};

export type MitmachenServer = {
  readonly server: Server;
  listen(port?: number): Promise<{ host: "127.0.0.1"; port: number }>;
  close(): Promise<void>;
  render(): MitmachenViewV1;
};

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const PRIVATE_FIELD = /(?:privateEvidenceRefs|assignedAgentActorId|assignedReviewerActorId|reviewerActorId|departmentWorkPackages|participantId|eligibilityProof|secret|credential|password|nsec1|rawBallot|prompt|reasoning)/i;
const MAX_PLAIN_DEPTH = 64;
const MAX_PLAIN_NODES = 20_000;
const MAX_PLAIN_ARRAY_LENGTH = 4_096;
const MAX_PLAIN_OBJECT_KEYS = 512;

type PlainAssertionState = { seen: WeakSet<object>; nodes: number };

function assertPlain(
  value: unknown,
  state: PlainAssertionState = { seen: new WeakSet<object>(), nodes: 0 },
  depth = 0,
): void {
  state.nodes += 1;
  if (state.nodes > MAX_PLAIN_NODES || depth > MAX_PLAIN_DEPTH) throw new Error("public_knowledge_input_unsafe");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new Error("public_knowledge_input_unsafe");
    return;
  }
  if (typeof value !== "object" || utilTypes.isProxy(value)) throw new Error("public_knowledge_input_unsafe");
  if (state.seen.has(value)) throw new Error("public_knowledge_input_unsafe");
  state.seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) throw new Error("public_knowledge_input_unsafe");
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (!lengthDescriptor || typeof lengthDescriptor.value !== "number" ||
      !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
      lengthDescriptor.value > MAX_PLAIN_ARRAY_LENGTH || keys.length !== lengthDescriptor.value + 1 ||
      keys.some((key) => {
        if (key === "length") return false;
        if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)) return true;
        const index = Number(key);
        return !Number.isSafeInteger(index) || index < 0 || index >= lengthDescriptor.value || String(index) !== key;
      })) throw new Error("public_knowledge_input_unsafe");
  } else if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("public_knowledge_input_unsafe");
  } else if (keys.length > MAX_PLAIN_OBJECT_KEYS) {
    throw new Error("public_knowledge_input_unsafe");
  }
  for (const key of keys) {
    if (typeof key === "symbol") throw new Error("public_knowledge_input_unsafe");
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) throw new Error("public_knowledge_input_unsafe");
    assertPlain(descriptor.value, state, depth + 1);
  }
  // The projection intentionally contains byte-identical alias objects (for
  // example `discussion` and `discussions[0]`). Keep the set stack-scoped so
  // aliases remain valid while cycles still fail; the global node budget
  // bounds repeated traversal.
  state.seen.delete(value);
}

function exactDataObject(value: unknown, keys: readonly string[], code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value)) throw new Error(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(code);
  const ownKeys = Reflect.ownKeys(value);
  const stringKeys = ownKeys.filter((key): key is string => typeof key === "string").sort();
  if (stringKeys.length !== ownKeys.length || canonical(stringKeys) !== canonical([...keys].sort())) {
    throw new Error(code);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) throw new Error(code);
  }
  return value as Record<string, unknown>;
}

function exactMethod(value: unknown, name: string, code: string): (...args: never[]) => unknown {
  const object = exactDataObject(value, [name], code);
  const descriptor = Object.getOwnPropertyDescriptor(object, name);
  if (!descriptor || typeof descriptor.value !== "function") throw new Error(code);
  return descriptor.value as (...args: never[]) => unknown;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function publicKnowledgeChecksum(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], code: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (canonical(actual) !== canonical(expected)) throw new Error(code);
}

function textValue(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(code);
  return value.trim();
}

function checksum(value: unknown, code: string): string {
  const result = textValue(value, code);
  if (!SHA256.test(result)) throw new Error(code);
  return result;
}

function assertNoPrivate(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoPrivate);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (PRIVATE_FIELD.test(key) || (typeof child === "string" && /\bnsec1[a-z0-9]{8,}\b/i.test(child))) {
      throw new Error("public_knowledge_private_field_forbidden");
    }
    assertNoPrivate(child);
  }
}

function mapProjection(envelope: ProjectionEnvelope, config: PublicKnowledgeConfig): PublicKnowledgeProjectionV1 {
  assertPlain(envelope);
  if (
    envelope.schemaVersion !== "projection_envelope_v1" ||
    envelope.caseId !== config.caseId ||
    envelope.visibility !== "public" ||
    envelope.policyVersion !== config.policyVersion ||
    !Number.isSafeInteger(envelope.caseVersion) ||
    envelope.caseVersion < 1
  ) throw new Error("public_knowledge_envelope_invalid");
  checksum(envelope.journalHeadChecksum, "public_knowledge_head_invalid");
  checksum(envelope.projectionChecksum, "public_knowledge_projection_checksum_invalid");
  const projection = record(envelope.projection, "public_knowledge_projection_invalid");
  exactKeys(projection, [
    "schemaVersion", "caseId", "jurisdiction", "municipalityId", "sourceScope", "authorityBinding",
    "formalDecision", "discussion", "discussions", "suggestion", "suggestions", "provenance",
    "departmentPackages", "reviewedCitizenBrief",
    ...(Object.hasOwn(projection, "participationResult") ? ["participationResult"] : []),
    ...(Object.hasOwn(projection, "reviewedOutcome") ? ["reviewedOutcome"] : []),
  ], "public_knowledge_projection_unknown_field");
  assertNoPrivate(projection);
  if (
    projection.schemaVersion !== "case_projection_v1" ||
    projection.caseId !== config.caseId ||
    projection.authorityBinding !== "none" ||
    projection.formalDecision !== null
  ) throw new Error("public_knowledge_authority_invalid");
  const discussion = record(projection.discussion, "public_knowledge_discussion_invalid");
  exactKeys(discussion, [
    "schemaVersion", "id", "source", "sourceRef", "sourceReference", "scope", "content", "event",
    "verificationProof", "authorityBinding", "provenance",
    ...(Object.hasOwn(discussion, "outcomeRef") ? ["outcomeRef"] : []),
  ], "public_knowledge_discussion_unknown_field");
  const discussionEvent = record(discussion.event, "public_knowledge_discussion_invalid");
  const discussionScope = record(discussion.scope, "public_knowledge_discussion_invalid");
  const sourceScope = record(projection.sourceScope, "public_knowledge_scope_invalid");
  const suggestion = record(projection.suggestion, "public_knowledge_suggestion_invalid");
  exactKeys(suggestion, [
    "schemaVersion", "id", "discussionId", "discussionRef", "title", "summary", "status", "signerPubkey",
    "admission", "authorityBinding", "provenance",
  ], "public_knowledge_suggestion_unknown_field");
  const suggestionDiscussionRef = record(suggestion.discussionRef, "public_knowledge_suggestion_invalid");
  const admission = record(suggestion.admission, "public_knowledge_admission_required");
  exactKeys(admission, [
    "candidateId", "signedEventId", "sourceAnswerReceiptId", "admissionChecksum", "admittedByActorClass",
    ...(Object.hasOwn(admission, "sourceTopicId") ? ["sourceTopicId"] : []),
  ], "public_knowledge_admission_unknown_field");
  const sourceTopicId = Object.hasOwn(admission, "sourceTopicId")
    ? textValue(admission.sourceTopicId, "public_knowledge_admission_invalid")
    : null;
  const brief = record(projection.reviewedCitizenBrief, "public_knowledge_brief_required");
  exactKeys(brief, ["schemaVersion", "id", "title", "summary", "responses", "provenance", "briefChecksum", "policyVersion", "correctionState", "authorityBinding"], "public_knowledge_brief_unknown_field");
  const provenance = record(brief.provenance, "public_knowledge_brief_invalid");
  const sourceDiscussion = record(provenance.sourceDiscussionRef, "public_knowledge_brief_invalid");
  const participation = record(projection.participationResult, "public_knowledge_participation_required");
  exactKeys(participation, [
    "schemaVersion", "id", "contractId", "contractVersion", "methodKind", "methodVersion", "ruleId", "ruleVersion",
    "authorityBinding", "question", "options", "totalAccepted", "resultSummary", "unresolvedDissent",
    "representationAudit", "limitations", "openedAt", "closedAt", "reviewedAt", "resultArtifactRef",
    "minorityReportRef", "correctionState", "checksum", "advisory",
  ], "public_knowledge_participation_unknown_field");
  if (
    !Array.isArray(projection.discussions) || projection.discussions.length !== 1 ||
    canonical(projection.discussions[0]) !== canonical(discussion) ||
    !Array.isArray(projection.suggestions) || projection.suggestions.length !== 1 ||
    canonical(projection.suggestions[0]) !== canonical(suggestion)
  ) throw new Error("public_knowledge_alias_projection_invalid");
  if (
    suggestion.status !== "admitted" ||
    suggestion.authorityBinding !== "none" ||
    brief.correctionState !== "current" ||
    brief.authorityBinding !== "none" ||
    participation.correctionState !== "current" ||
    participation.authorityBinding !== "none" ||
    participation.advisory !== true
  ) throw new Error("public_knowledge_state_invalid");
  if (
    projection.municipalityId !== sourceScope.municipalityId ||
    projection.municipalityId !== discussionScope.municipalityId ||
    sourceScope.caseId !== discussionScope.caseId ||
    suggestion.discussionId !== discussion.id ||
    suggestionDiscussionRef.id !== discussion.id ||
    suggestionDiscussionRef.ref !== discussion.sourceRef ||
    suggestion.signerPubkey !== discussionEvent.pubkey ||
    sourceDiscussion.id !== discussion.id ||
    sourceDiscussion.ref !== discussion.sourceRef ||
    provenance.suggestionId !== suggestion.id ||
    (sourceTopicId !== null && (!Array.isArray(discussionEvent.tags) ||
      !discussionEvent.tags.some((tag) => Array.isArray(tag) && tag[0] === "topic" && tag[1] === sourceTopicId)))
  ) throw new Error("public_knowledge_continuity_invalid");
  if (!Array.isArray(brief.responses) || brief.responses.length !== 8) throw new Error("public_knowledge_department_count_invalid");
  const citations = [...new Set(brief.responses.flatMap((response) => {
    const item = record(response, "public_knowledge_brief_invalid");
    if (!Array.isArray(item.publicCitations)) throw new Error("public_knowledge_brief_invalid");
    return item.publicCitations.map((ref) => textValue(ref, "public_knowledge_citation_invalid"));
  }))].sort();
  if (citations.length < 8) throw new Error("public_knowledge_citations_incomplete");
  if (!Array.isArray(participation.options) || participation.options.length < 2) throw new Error("public_knowledge_options_invalid");
  const options = participation.options.map((option) => {
    const item = record(option, "public_knowledge_options_invalid");
    if (!Number.isSafeInteger(item.aggregateCount) || Number(item.aggregateCount) < 0) throw new Error("public_knowledge_options_invalid");
    return {
      optionId: textValue(item.optionId, "public_knowledge_options_invalid"),
      label: textValue(item.label, "public_knowledge_options_invalid"),
      aggregateCount: Number(item.aggregateCount),
    };
  });
  if (
    !Number.isSafeInteger(participation.totalAccepted) ||
    Number(participation.totalAccepted) < 0 ||
    options.reduce((total, option) => total + option.aggregateCount, 0) !== Number(participation.totalAccepted)
  ) throw new Error("public_knowledge_participation_count_invalid");
  const openedAt = textValue(participation.openedAt, "public_knowledge_window_invalid");
  const closedAt = textValue(participation.closedAt, "public_knowledge_window_invalid");
  const reviewedAt = textValue(participation.reviewedAt, "public_knowledge_window_invalid");
  if (!(Date.parse(openedAt) <= Date.parse(closedAt) && Date.parse(closedAt) <= Date.parse(reviewedAt))) {
    throw new Error("public_knowledge_window_invalid");
  }
  const rawOutcome = projection.reviewedOutcome;
  let reviewedOutcome: PublicKnowledgeProjectionV1["reviewedOutcome"] = null;
  if (rawOutcome !== undefined) {
    const outcome = record(rawOutcome, "public_knowledge_outcome_invalid");
    exactKeys(outcome, [
      "schemaVersion", "id", "summary", "resultArtifactRef", "reviewedAt", "sourceDiscussionRef", "sourceBrief",
      "sourceParticipation", "publicationTarget", "authorityBinding", "outcomeChecksum", "correctionState", "advisory",
      "formalDecision", "externalPublication",
    ], "public_knowledge_outcome_unknown_field");
    if (
      outcome.correctionState !== "current" ||
      outcome.authorityBinding !== "none" ||
      outcome.advisory !== true ||
      outcome.formalDecision !== null ||
      outcome.externalPublication !== false ||
      outcome.publicationTarget !== "public_knowledge_projection"
    ) throw new Error("public_knowledge_outcome_invalid");
    const outcomeDiscussion = record(outcome.sourceDiscussionRef, "public_knowledge_outcome_invalid");
    const outcomeBrief = record(outcome.sourceBrief, "public_knowledge_outcome_invalid");
    const outcomeParticipation = record(outcome.sourceParticipation, "public_knowledge_outcome_invalid");
    if (
      outcomeDiscussion.ref !== discussion.sourceRef ||
      outcomeBrief.id !== brief.id ||
      outcomeBrief.briefChecksum !== brief.briefChecksum ||
      outcomeParticipation.id !== participation.id ||
      outcomeParticipation.participationChecksum !== participation.checksum
    ) throw new Error("public_knowledge_outcome_binding_invalid");
    reviewedOutcome = {
      id: textValue(outcome.id, "public_knowledge_outcome_invalid"),
      summary: textValue(outcome.summary, "public_knowledge_outcome_invalid"),
      resultArtifactRef: textValue(outcome.resultArtifactRef, "public_knowledge_outcome_invalid"),
      reviewedAt: textValue(outcome.reviewedAt, "public_knowledge_outcome_invalid"),
      outcomeChecksum: checksum(outcome.outcomeChecksum, "public_knowledge_outcome_invalid"),
      discussionRef: textValue(outcomeDiscussion.ref, "public_knowledge_outcome_invalid"),
      externalPublication: false,
    };
  }
  const rawOutcomeRef = discussion.outcomeRef;
  if ((rawOutcomeRef === undefined) !== (reviewedOutcome === null)) throw new Error("public_knowledge_outcome_backlink_invalid");
  if (reviewedOutcome && (!rawOutcomeRef || typeof rawOutcomeRef !== "object")) throw new Error("public_knowledge_outcome_backlink_invalid");
  if (reviewedOutcome) {
    const outcomeRef = record(rawOutcomeRef, "public_knowledge_outcome_backlink_invalid");
    if (outcomeRef.id !== reviewedOutcome.id || outcomeRef.outcomeChecksum !== reviewedOutcome.outcomeChecksum) {
      throw new Error("public_knowledge_outcome_backlink_invalid");
    }
  }
  const base = {
    schemaVersion: "public_knowledge_projection_v1" as const,
    caseId: config.caseId,
    municipalityId: textValue(projection.municipalityId, "public_knowledge_scope_invalid"),
    sourceCaseId: textValue(sourceScope.caseId, "public_knowledge_scope_invalid"),
    policyVersion: config.policyVersion,
    caseVersion: envelope.caseVersion,
    journalHeadChecksum: envelope.journalHeadChecksum,
    sourceProjectionChecksum: envelope.projectionChecksum,
    discussion: {
      id: textValue(discussion.id, "public_knowledge_discussion_invalid"),
      sourceRef: textValue(discussion.sourceRef, "public_knowledge_discussion_invalid"),
      content: textValue(discussion.content, "public_knowledge_discussion_invalid"),
      signerPubkey: textValue(discussionEvent.pubkey, "public_knowledge_discussion_invalid"),
      outcomeRef: reviewedOutcome ? { id: reviewedOutcome.id, outcomeChecksum: reviewedOutcome.outcomeChecksum } : null,
    },
    suggestion: {
      id: textValue(suggestion.id, "public_knowledge_suggestion_invalid"),
      title: textValue(suggestion.title, "public_knowledge_suggestion_invalid"),
      summary: textValue(suggestion.summary, "public_knowledge_suggestion_invalid"),
      status: "admitted" as const,
      signerPubkey: textValue(suggestion.signerPubkey, "public_knowledge_suggestion_invalid"),
      admissionChecksum: checksum(admission.admissionChecksum, "public_knowledge_admission_invalid"),
      sourceTopicId,
    },
    citizenBrief: {
      id: textValue(brief.id, "public_knowledge_brief_invalid"),
      title: textValue(brief.title, "public_knowledge_brief_invalid"),
      summary: textValue(brief.summary, "public_knowledge_brief_invalid"),
      briefChecksum: checksum(brief.briefChecksum, "public_knowledge_brief_invalid"),
      sourceDiscussionRef: textValue(sourceDiscussion.ref, "public_knowledge_brief_invalid"),
      reviewedDepartmentCount: 8 as const,
      reviewedCitations: citations,
    },
    participation: {
      id: textValue(participation.id, "public_knowledge_participation_invalid"),
      question: textValue(participation.question, "public_knowledge_participation_invalid"),
      options,
      totalAccepted: Number(participation.totalAccepted),
      resultSummary: textValue(participation.resultSummary, "public_knowledge_participation_invalid"),
      unresolvedDissent: Array.isArray(participation.unresolvedDissent) ? participation.unresolvedDissent.map((item) => textValue(item, "public_knowledge_participation_invalid")) : [],
      openedAt,
      closedAt,
      reviewedAt,
      checksum: checksum(participation.checksum, "public_knowledge_participation_invalid"),
      advisory: true as const,
    },
    reviewedOutcome,
    governance: {
      participationKind: "advisory_non_binding" as const,
      formalVoteAvailable: false as const,
      formalVoteReason: "separate_legal_authority_binding_required" as const,
      councilSubmissionCreated: false as const,
    },
    authorityBinding: "none" as const,
  };
  return structuredClone({ ...base, knowledgeChecksum: publicKnowledgeChecksum(base) });
}

export function createPublicKnowledge(config: PublicKnowledgeConfig): PublicKnowledgeReader {
  exactDataObject(config, ["actorBinding", "caseId", "coordinator", "policyVersion"], "public_knowledge_config_invalid");
  assertPlain({ caseId: config.caseId, policyVersion: config.policyVersion, actorBinding: config.actorBinding });
  exactKeys(config.actorBinding as unknown as Record<string, unknown>, ["actorId", "actorClass"], "public_knowledge_actor_invalid");
  const project = exactMethod(config.coordinator, "project", "public_knowledge_project_only_required") as CivicCaseCoordinator["project"];
  if (config.actorBinding.actorClass !== "public") throw new Error("public_knowledge_public_actor_required");
  return {
    project() {
      const envelope = project({
        schemaVersion: "query_envelope_v1",
        queryType: "case_projection_v1",
        caseId: config.caseId,
        actorBinding: structuredClone(config.actorBinding),
        visibility: "public",
        policyVersion: config.policyVersion,
        atCaseVersion: null,
      });
      return mapProjection(envelope, config);
    },
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

export function renderMitmachen(view: MitmachenViewV1): string {
  exactDataObject(view, ["schemaVersion", "route", "status", "knowledge", "interaction"], "mitmachen_view_invalid");
  assertPlain(view);
  const interaction = exactDataObject(
    view.interaction,
    ["mode", "advisoryChoiceVisible", "submissionAvailable", "formalVoteAvailable"],
    "mitmachen_view_invalid",
  );
  const { knowledgeChecksum, ...knowledgeCore } = view.knowledge;
  if (
    view.schemaVersion !== "mitmachen_view_v1" ||
    view.route !== "/mitmachen" ||
    view.status !== "available" ||
    interaction.mode !== "read_only_reference" ||
    interaction.advisoryChoiceVisible !== true ||
    interaction.submissionAvailable !== false ||
    interaction.formalVoteAvailable !== false ||
    knowledgeChecksum !== publicKnowledgeChecksum(knowledgeCore)
  ) throw new Error("mitmachen_view_invalid");
  const knowledge = view.knowledge;
  const options = knowledge.participation.options.map((option) => `<li><strong>${escapeHtml(option.label)}</strong>: ${option.aggregateCount}</li>`).join("");
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Mitmachen · ${escapeHtml(knowledge.suggestion.title)}</title><style>body{font:16px/1.55 system-ui,sans-serif;color:#17202a;background:#fff;margin:0}header,main,footer{max-width:68rem;margin:auto;padding:1rem}a{color:#005a9c}a:focus-visible{outline:3px solid #005fcc;outline-offset:2px}.notice{border-left:.35rem solid #a35b00;padding:.75rem;background:#fff7e6}dl{display:grid;grid-template-columns:minmax(11rem,18rem) 1fr;gap:.4rem 1rem}dt{font-weight:700}dd{margin:0;overflow-wrap:anywhere}@media(max-width:640px){dl{grid-template-columns:1fr}}</style></head><body><header><nav aria-label="Hauptnavigation"><a href="/mitmachen" aria-current="page">Mitmachen</a></nav></header><main><h1>Mitmachen: ${escapeHtml(knowledge.suggestion.title)}</h1><p class="notice"><strong>Beratende Beteiligung.</strong> Dies ist keine rechtsverbindliche Abstimmung. Eine formale Wahl benötigt eine separate rechtliche Autorisierung.</p><section aria-labelledby="brief-heading"><h2 id="brief-heading">Geprüfter Citizen Brief</h2><p>${escapeHtml(knowledge.citizenBrief.summary)}</p><dl><dt>Prüfstand</dt><dd>${escapeHtml(knowledge.citizenBrief.briefChecksum)}</dd><dt>Geprüfte Fachbereiche</dt><dd>8</dd><dt>Ursprungsdiskussion</dt><dd>${escapeHtml(knowledge.discussion.sourceRef)}</dd></dl></section><section aria-labelledby="choice-heading"><h2 id="choice-heading">Beratendes Ergebnis</h2><p>${escapeHtml(knowledge.participation.question)}</p><ul>${options}</ul><dl><dt>Zeitraum</dt><dd><time datetime="${escapeHtml(knowledge.participation.openedAt)}">${escapeHtml(knowledge.participation.openedAt)}</time> – <time datetime="${escapeHtml(knowledge.participation.closedAt)}">${escapeHtml(knowledge.participation.closedAt)}</time></dd><dt>Geprüft</dt><dd>${escapeHtml(knowledge.participation.reviewedAt)}</dd><dt>Ergebnis</dt><dd>${escapeHtml(knowledge.participation.resultSummary)}</dd></dl></section><section aria-labelledby="outcome-heading"><h2 id="outcome-heading">Veröffentlichter Ausgang</h2><p>${escapeHtml(knowledge.reviewedOutcome?.summary ?? "Noch kein geprüfter Ausgang veröffentlicht.")}</p><dl><dt>Diskussionsbezug</dt><dd>${escapeHtml(knowledge.reviewedOutcome?.discussionRef ?? knowledge.discussion.sourceRef)}</dd><dt>Externe Veröffentlichung</dt><dd>nein</dd></dl></section></main><footer>Öffentliche Wissensprojektion · nur beratend · Authority Binding: none</footer></body></html>`;
}

function loopbackHost(value: string | undefined): boolean {
  if (!value) return false;
  const host = value.trim().toLowerCase();
  return /^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host) || /^\[::1\](?::\d+)?$/.test(host);
}

function send(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(body);
}

export function createMitmachenServer(knowledge: PublicKnowledgeReader): MitmachenServer {
  const project = exactMethod(knowledge, "project", "mitmachen_knowledge_reader_required") as PublicKnowledgeReader["project"];
  const render = (): MitmachenViewV1 => ({
    schemaVersion: "mitmachen_view_v1",
    route: "/mitmachen",
    status: "available",
    knowledge: project(),
    interaction: {
      mode: "read_only_reference",
      advisoryChoiceVisible: true,
      submissionAvailable: false,
      formalVoteAvailable: false,
    },
  });
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (!loopbackHost(request.headers.host)) return send(response, 400, "invalid_host");
    if (request.method !== "GET") return send(response, 405, "method_not_allowed");
    if (request.url !== "/mitmachen") return send(response, request.url?.startsWith("/mitmachen?") ? 400 : 404, "route_not_found");
    try {
      send(response, 200, renderMitmachen(render()));
    } catch {
      send(response, 503, "public_knowledge_unavailable");
    }
  });
  return {
    server,
    listen(port = 0) {
      return new Promise((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        server.once("error", onError);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", onError);
          const address = server.address();
          if (!address || typeof address === "string") return reject(new Error("mitmachen_server_address_invalid"));
          resolve({ host: "127.0.0.1", port: address.port });
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((error) => error ? reject(error) : resolve());
      });
    },
    render,
  };
}
