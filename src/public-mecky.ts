import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import {
  getEventHash,
  validateEvent,
  verifyEvent,
  type Event as NostrEvent,
} from "nostr-tools/pure";

import type { DiscussionArtifact } from "./adapters/discussion-adapter.ts";
import type {
  CompanionHarnessAdapter,
  WorkerResultV1,
} from "./adapters/companion-harness.ts";
import type { CompanionRuntime, CompanionTask } from "./companion-runtime.ts";
import {
  publicKnowledgeChecksum,
  type PublicKnowledgeReader,
} from "./public-knowledge.ts";
import type {
  CitizenSignedSuggestionV1,
  PublicMeckySigningRequestV1,
  PublicMeckySuggestionDraftV1,
} from "./citizen-suggestion.ts";

export type {
  CitizenSignedSuggestionV1,
  PublicMeckySigningRequestV1,
  PublicMeckySuggestionDraftV1,
} from "./citizen-suggestion.ts";

export type PublicMeckyRequestV1 = {
  schemaVersion: "public_mecky_request_v1";
  invocation: "discussion" | "button";
  discussion: DiscussionArtifact;
  question?: string;
};

export type PublicMeckyCitationV1 = {
  ref: string;
  kind: "reviewed_public_artifact" | "public_discussion";
  label: string;
  excerpt: string;
  attributedTo: string | null;
};

export type PublicMeckyFactV1 = {
  text: string;
  citationRefs: readonly string[];
};

export type PublicMeckyAnswerReceiptV1 = {
  schemaVersion: "public_mecky_answer_receipt_v1";
  receiptId: string;
  taskId: string;
  caseId: string;
  municipalityId: string;
  sourceCaseId: string;
  discussionId: string;
  caseVersion: number;
  journalHeadChecksum: string;
  projectionChecksum: string;
  publicKnowledgeChecksum?: string;
  contextChecksum: string;
  workerIdentityId: string;
  availableCitationRefs: readonly string[];
  usedCitationRefs: readonly string[];
  administrationAnswerReviewRequired: false;
  sourceArtifactReviewRequired: true;
  answerValidity: "current_projection_only";
  authorityBinding: "none";
  effects: {
    privateToolAccess: false;
    civicStateMutation: false;
    publication: false;
    suggestionSubmission: false;
    vote: false;
  };
  receiptChecksum: string;
};

export type PublicMeckyTurnV1 =
  | {
      schemaVersion: "public_mecky_turn_v1";
      status: "not_invoked";
      reason: "explicit_trigger_required";
      authorityBinding: "none";
    }
  | {
      schemaVersion: "public_mecky_turn_v1";
      status: "unavailable";
      reason:
        | "insufficient_evidence"
        | "stale_evidence"
        | "conflicting_evidence"
        | "answer_unavailable";
      message: string;
      authorityBinding: "none";
    }
  | {
      schemaVersion: "public_mecky_turn_v1";
      status: "answered";
      answer: {
        text: string;
        facts: readonly PublicMeckyFactV1[];
        uncertainty: readonly string[];
        reasoningSummary: readonly string[];
      };
      citations: readonly PublicMeckyCitationV1[];
      suggestionDraft: PublicMeckySuggestionDraftV1;
      receipt: PublicMeckyAnswerReceiptV1;
      authorityBinding: "none";
    };

export type PublicMecky = {
  answer(request: PublicMeckyRequestV1): Promise<PublicMeckyTurnV1>;
  prepareSuggestion(input: {
    turn: Extract<PublicMeckyTurnV1, { status: "answered" }>;
    edits: { title: string; summary: string };
    createdAt: number;
  }): PublicMeckySigningRequestV1;
  acceptSignedSuggestion(input: {
    turn: Extract<PublicMeckyTurnV1, { status: "answered" }>;
    signingRequest: PublicMeckySigningRequestV1;
    event: NostrEvent;
  }): CitizenSignedSuggestionV1;
};

export type PublicMeckyConfig = {
  runtime: Pick<CompanionRuntime, "prepareTask">;
  worker: Pick<CompanionHarnessAdapter, "run">;
  knowledge?: PublicKnowledgeReader;
};

type EvidenceSnapshot = {
  municipalityId: string;
  sourceCaseId: string;
  caseId: string;
  caseVersion: number;
  journalHeadChecksum: string;
  projectionChecksum: string;
  citations: ReadonlyMap<string, PublicMeckyCitationV1>;
};

type AnswerDraft = {
  answer: string;
  facts: PublicMeckyFactV1[];
  uncertainty: string[];
  reasoningSummary: string[];
  suggestion: { title: string; summary: string };
};

const URI_REFERENCE = /^[a-z][a-z0-9+.-]*:\S+$/i;
const PRIVATE_PUBLIC_FIELD = /^(?:privateEvidenceRefs|assignedAgentActorId|assignedReviewerActorId|reviewerActorId|departmentWorkPackages|raw(?:Ballots?|Participants?|Evidence|Drafts?)|participantId|eligibilityProof|secret(?:Value|Material)?|credentials?)$/i;

function assertSafePlainData(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || value === undefined || ["string", "number", "boolean"].includes(typeof value)) return;
  if (typeof value !== "object" || utilTypes.isProxy(value)) throw new Error("public_mecky_input_unsafe");
  if (seen.has(value)) throw new Error("public_mecky_input_unsafe");
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) throw new Error("public_mecky_input_unsafe");
    const keys = Reflect.ownKeys(value);
    const expected = [...value.keys()].map(String);
    const actual = keys.filter((key): key is string => typeof key === "string" && key !== "length");
    if (keys.some((key) => typeof key === "symbol") || canonical(actual) !== canonical(expected)) {
      throw new Error("public_mecky_input_unsafe");
    }
  } else if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("public_mecky_input_unsafe");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol" || (Array.isArray(value) && key === "length")) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      throw new Error("public_mecky_input_unsafe");
    }
    assertSafePlainData(descriptor.value, seen);
  }
  seen.delete(value);
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], code: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (canonical(actual) !== canonical(expected)) throw new Error(code);
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, code: string, maximum = 4_096): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > maximum) throw new Error(code);
  return value.trim();
}

function stringArray(value: unknown, code: string): string[] {
  if (!Array.isArray(value)) throw new Error(code);
  return value.map((item) => stringValue(item, code));
}

function checksum(value: unknown, code: string): string {
  const normalized = stringValue(value, code);
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized)) throw new Error(code);
  return normalized;
}

function questionFor(request: PublicMeckyRequestV1): string | null {
  if (!isRecord(request) || request.schemaVersion !== "public_mecky_request_v1") throw new Error("public_mecky_request_invalid");
  const expectedKeys = request.question === undefined
    ? ["schemaVersion", "invocation", "discussion"]
    : ["schemaVersion", "invocation", "discussion", "question"];
  assertExactKeys(request, expectedKeys, "public_mecky_request_invalid");
  if (request.invocation === "button") return stringValue(request.question, "public_mecky_question_required", 1_024);
  if (request.invocation !== "discussion") throw new Error("public_mecky_invocation_invalid");
  const content = request.discussion?.event?.content;
  if (typeof content !== "string") throw new Error("public_mecky_discussion_invalid");
  if (!/(?:^|\s)@mecky\b/i.test(content)) return null;
  const question = content.replace(/(?:^|\s)@mecky\b[\s,:;.!?-]*/i, " ").trim();
  return stringValue(question, "public_mecky_question_required", 1_024);
}

function verifiedDiscussion(value: DiscussionArtifact): DiscussionArtifact {
  if (
    !isRecord(value) ||
    value.schemaVersion !== "discussion_artifact_v1" ||
    value.source !== "nostr" ||
    value.authorityBinding !== "none" ||
    !isRecord(value.verificationProof) ||
    value.verificationProof.kind !== "nostr_nip01" ||
    value.verificationProof.verified !== true ||
    !isRecord(value.event) ||
    !Array.isArray(value.event.tags) ||
    !Array.isArray(value.event.relayRefs)
  ) throw new Error("public_mecky_discussion_invalid");
  assertExactKeys(value, ["schemaVersion", "id", "source", "sourceRef", "municipalityId", "caseId", "authorityBinding", "verificationProof", "event"], "public_mecky_discussion_invalid");
  assertExactKeys(value.verificationProof, ["kind", "verified", "signature"], "public_mecky_discussion_invalid");
  assertExactKeys(value.event, ["id", "pubkey", "createdAt", "kind", "content", "tags", "relayRefs"], "public_mecky_discussion_invalid");
  const event: NostrEvent = {
    id: stringValue(value.event.id, "public_mecky_discussion_invalid"),
    pubkey: stringValue(value.event.pubkey, "public_mecky_discussion_invalid"),
    created_at: Number(value.event.createdAt),
    kind: Number(value.event.kind),
    content: stringValue(value.event.content, "public_mecky_discussion_invalid"),
    tags: value.event.tags.map((tag) => {
      if (!Array.isArray(tag) || tag.some((part) => typeof part !== "string")) throw new Error("public_mecky_discussion_invalid");
      return [...tag];
    }),
    sig: stringValue(value.verificationProof.signature, "public_mecky_discussion_invalid"),
  };
  if (
    value.id !== event.id ||
    value.sourceRef !== `nostr://event/${event.id}` ||
    !/^[a-f0-9]{64}$/.test(event.id) ||
    !/^[a-f0-9]{64}$/.test(event.pubkey) ||
    !/^[a-f0-9]{128}$/.test(event.sig) ||
    event.kind !== 1 ||
    !Number.isSafeInteger(event.created_at) ||
    event.created_at < 0 ||
    value.event.relayRefs.some((ref) => {
      if (typeof ref !== "string") return true;
      try { return !["ws:", "wss:"].includes(new URL(ref).protocol); } catch { return true; }
    }) ||
    !validateEvent(event) ||
    getEventHash(event) !== event.id ||
    !verifyEvent(event)
  ) throw new Error("public_mecky_discussion_invalid");
  return value;
}

function taskProjection(task: CompanionTask): Record<string, unknown> {
  if (task.profile !== "public") throw new Error("public_mecky_profile_invalid");
  if ((task.context.visibility as string) !== "public" && task.context.visibility !== "public_reviewed") {
    throw new Error("public_mecky_visibility_invalid");
  }
  const direct = task.context as unknown as Record<string, unknown>;
  const projection = isRecord(direct.projection) ? direct.projection : direct;
  if (projection.authorityBinding !== "none") throw new Error("public_mecky_authority_invalid");
  return projection;
}

function assertPublicProjection(value: unknown, seen = new WeakSet<object>()): void {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) throw new Error("public_mecky_projection_invalid");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertPublicProjection(item, seen);
    seen.delete(value);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (PRIVATE_PUBLIC_FIELD.test(key)) throw new Error("public_mecky_private_projection_rejected");
    assertPublicProjection(child, seen);
  }
  seen.delete(value);
}

function evidenceFor(task: CompanionTask, discussion: DiscussionArtifact): EvidenceSnapshot {
  if (
    task.profile !== "public" ||
    typeof task.question !== "string" ||
    task.question.trim() === "" ||
    typeof task.workerIdentity !== "string" ||
    task.workerIdentity.trim() === "" ||
    typeof task.sessionKey !== "string" ||
    task.sessionKey.trim() === "" ||
    !Array.isArray(task.allowedTools) ||
    task.allowedTools.length !== 0 ||
    !Array.isArray(task.prohibitedEffects)
  ) throw new Error("public_mecky_task_invalid");
  const projection = taskProjection(task);
  assertPublicProjection(projection);
  if (
    projection.schemaVersion !== "case_projection_v1" ||
    !Number.isSafeInteger(task.context.caseVersion) ||
    Number(task.context.caseVersion) < 1 ||
    typeof task.policyVersion !== "string" ||
    task.policyVersion.trim() === "" ||
    task.context.policyVersion !== task.policyVersion
  ) throw new Error("public_mecky_context_invalid");
  const municipalityId = stringValue(projection.municipalityId, "public_mecky_municipality_invalid");
  const caseId = stringValue(task.caseId ?? projection.caseId, "public_mecky_case_invalid");
  if (projection.caseId !== caseId) throw new Error("public_mecky_case_invalid");
  const sourceScope = projection.sourceScope;
  if (!isRecord(sourceScope)) throw new Error("public_mecky_source_scope_invalid");
  const sourceCaseId = stringValue(sourceScope.caseId, "public_mecky_source_scope_invalid");
  if (
    stringValue(sourceScope.municipalityId, "public_mecky_source_scope_invalid") !== municipalityId ||
    discussion.municipalityId !== municipalityId ||
    discussion.caseId !== sourceCaseId
  ) throw new Error("public_mecky_discussion_scope_mismatch");

  const projectedDiscussion = projection.discussion;
  if (!isRecord(projectedDiscussion) || !isRecord(projectedDiscussion.event)) {
    throw new Error("public_mecky_discussion_projection_missing");
  }
  if (
    stringValue(projectedDiscussion.id, "public_mecky_discussion_projection_invalid") !== discussion.id ||
    stringValue(projectedDiscussion.sourceRef, "public_mecky_discussion_projection_invalid") !== discussion.sourceRef ||
    stringValue(projectedDiscussion.event.id, "public_mecky_discussion_projection_invalid") !== discussion.event.id ||
    stringValue(projectedDiscussion.event.pubkey, "public_mecky_discussion_projection_invalid") !== discussion.event.pubkey
  ) throw new Error("public_mecky_discussion_projection_mismatch");

  const brief = projection.reviewedCitizenBrief;
  if (!isRecord(brief)) throw new Error("insufficient_evidence");
  assertExactKeys(brief, ["schemaVersion", "id", "title", "summary", "responses", "provenance", "briefChecksum", "policyVersion", "correctionState", "authorityBinding"], "insufficient_evidence");
  const briefProvenance = brief.provenance;
  const briefDiscussionRef = isRecord(briefProvenance) ? briefProvenance.sourceDiscussionRef : undefined;
  if (isRecord(briefDiscussionRef)) {
    assertExactKeys(briefDiscussionRef, ["type", "id", "ref"], "insufficient_evidence");
  }
  if (
    brief.schemaVersion !== "citizen_brief_projection_v1" ||
    brief.authorityBinding !== "none" ||
    brief.policyVersion !== task.policyVersion ||
    !isRecord(briefProvenance) ||
    !isRecord(briefDiscussionRef) ||
    briefDiscussionRef.type !== "nostr_event" ||
    briefDiscussionRef.id !== discussion.id ||
    briefDiscussionRef.ref !== discussion.sourceRef
  ) throw new Error("insufficient_evidence");
  checksum(brief.briefChecksum, "insufficient_evidence");
  if (brief.correctionState !== "current") throw new Error("stale_evidence");
  if (!Array.isArray(brief.responses) || brief.responses.length === 0) throw new Error("insufficient_evidence");

  const citations = new Map<string, PublicMeckyCitationV1>([[discussion.sourceRef, {
    ref: discussion.sourceRef,
    kind: "public_discussion",
    label: "Public discussion contribution",
    excerpt: discussion.event.content,
    attributedTo: discussion.event.pubkey,
  }]]);
  for (const response of brief.responses) {
    if (!isRecord(response)) throw new Error("insufficient_evidence");
    assertExactKeys(response, ["departmentId", "publicSummary", "publicCitations"], "insufficient_evidence");
    const departmentId = stringValue(response.departmentId, "insufficient_evidence", 128);
    const publicSummary = stringValue(response.publicSummary, "insufficient_evidence");
    const refs = stringArray(response.publicCitations, "insufficient_evidence");
    if (refs.length === 0) throw new Error("insufficient_evidence");
    for (const ref of refs) {
      if (!URI_REFERENCE.test(ref)) throw new Error("insufficient_evidence");
      const citation: PublicMeckyCitationV1 = {
        ref,
        kind: "reviewed_public_artifact",
        label: `Reviewed ${departmentId} response`,
        excerpt: publicSummary,
        attributedTo: null,
      };
      const existing = citations.get(ref);
      if (existing && canonical(existing) !== canonical(citation)) throw new Error("conflicting_evidence");
      citations.set(ref, citation);
    }
  }
  if (citations.size === 0) throw new Error("insufficient_evidence");

  return {
    municipalityId,
    sourceCaseId,
    caseId,
    caseVersion: Number(task.context.caseVersion),
    journalHeadChecksum: checksum(task.context.journalHeadChecksum, "public_mecky_context_invalid"),
    projectionChecksum: checksum(task.context.projectionChecksum, "public_mecky_context_invalid"),
    citations,
  };
}

function validateWorkerBinding(
  result: WorkerResultV1,
  task: CompanionTask,
  evidence: EvidenceSnapshot,
): void {
  if (
    !isRecord(result) ||
    result.schemaVersion !== "worker_result_v1" ||
    result.status !== "completed" ||
    result.profile !== "public" ||
    result.caseId !== evidence.caseId ||
    result.sessionKey !== task.sessionKey ||
    !isRecord(result.identity) ||
    result.identity.id !== task.workerIdentity ||
    result.identity.profile !== "public" ||
    !isRecord(result.aiAttribution) ||
    result.aiAttribution.schemaVersion !== "ai_attribution_v1" ||
    result.aiAttribution.kind !== "agent_contribution" ||
    result.aiAttribution.profile !== "public" ||
    result.aiAttribution.workerIdentityId !== task.workerIdentity ||
    result.aiAttribution.authorityBinding !== "none" ||
    !Array.isArray(result.allowedTools) ||
    result.allowedTools.length !== 0 ||
    canonical(result.prohibitedEffects) !== canonical(task.prohibitedEffects) ||
    !isRecord(result.tools) ||
    result.tools.mode !== "default-deny" ||
    !Array.isArray(result.tools.allow) ||
    result.tools.allow.length !== 0 ||
    !Array.isArray(result.tools.deny) ||
    result.tools.deny.length !== 1 ||
    result.tools.deny[0] !== "*"
  ) throw new Error("public_mecky_worker_binding_invalid");
  stringValue(result.taskId, "public_mecky_worker_binding_invalid");
  checksum(result.contextChecksum, "public_mecky_worker_binding_invalid");
  if (!Array.isArray(result.citations) || !Array.isArray(result.artifactBindings)) {
    throw new Error("public_mecky_worker_binding_invalid");
  }
  const citationRefs = result.citations.map((citation) => {
    if (!isRecord(citation)) throw new Error("public_mecky_worker_binding_invalid");
    const ref = stringValue(citation.ref, "public_mecky_worker_binding_invalid");
    if (!URI_REFERENCE.test(ref)) throw new Error("public_mecky_worker_binding_invalid");
    return ref;
  });
  if (new Set(citationRefs).size !== citationRefs.length) throw new Error("public_mecky_worker_binding_invalid");
  const citationSet = new Set(citationRefs);
  if ([...evidence.citations.keys()].some((ref) => !citationSet.has(ref))) {
    throw new Error("public_mecky_worker_binding_invalid");
  }
  const bindingRefs = result.artifactBindings.map((binding) => {
    if (!isRecord(binding)) throw new Error("public_mecky_worker_binding_invalid");
    checksum(binding.checksum, "public_mecky_worker_binding_invalid");
    return stringValue(binding.ref, "public_mecky_worker_binding_invalid");
  });
  if (
    new Set(bindingRefs).size !== bindingRefs.length ||
    bindingRefs.length !== citationRefs.length ||
    bindingRefs.some((ref) => !citationSet.has(ref))
  ) throw new Error("public_mecky_worker_binding_invalid");
}

function answerDraft(value: unknown, evidence: EvidenceSnapshot): AnswerDraft {
  if (typeof value !== "string") throw new Error("public_mecky_answer_invalid");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("public_mecky_answer_invalid");
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== "public_mecky_answer_draft_v1") throw new Error("public_mecky_answer_invalid");
  const allowed = new Set(["schemaVersion", "answer", "facts", "uncertainty", "reasoningSummary", "suggestion"]);
  if (Object.keys(parsed).some((key) => !allowed.has(key))) throw new Error("public_mecky_answer_invalid");
  if (!Array.isArray(parsed.facts) || parsed.facts.length === 0) throw new Error("public_mecky_answer_invalid");
  const facts = parsed.facts.map((fact) => {
    if (!isRecord(fact) || Object.keys(fact).some((key) => key !== "text" && key !== "citationRefs")) throw new Error("public_mecky_answer_invalid");
    const citationRefs = [...new Set(stringArray(fact.citationRefs, "public_mecky_answer_invalid"))].sort();
    if (citationRefs.length === 0 || citationRefs.some((ref) => !evidence.citations.has(ref))) throw new Error("public_mecky_citation_unbound");
    return { text: stringValue(fact.text, "public_mecky_answer_invalid"), citationRefs };
  });
  const usedCitationRefs = new Set(facts.flatMap((fact) => fact.citationRefs));
  if (![...usedCitationRefs].some((ref) => evidence.citations.get(ref)?.kind === "reviewed_public_artifact")) {
    throw new Error("public_mecky_reviewed_citation_required");
  }
  const uncertainty = stringArray(parsed.uncertainty, "public_mecky_answer_invalid");
  const reasoningSummary = parsed.reasoningSummary === undefined
    ? []
    : stringArray(parsed.reasoningSummary, "public_mecky_answer_invalid");
  if (!isRecord(parsed.suggestion) || Object.keys(parsed.suggestion).some((key) => key !== "title" && key !== "summary")) {
    throw new Error("public_mecky_suggestion_invalid");
  }
  return {
    answer: stringValue(parsed.answer, "public_mecky_answer_invalid"),
    facts,
    uncertainty,
    reasoningSummary,
    suggestion: {
      title: stringValue(parsed.suggestion.title, "public_mecky_suggestion_invalid", 240),
      summary: stringValue(parsed.suggestion.summary, "public_mecky_suggestion_invalid", 2_000),
    },
  };
}

function unavailable(error: unknown): PublicMeckyTurnV1 {
  const code = error instanceof Error ? error.message : "answer_unavailable";
  const reason = code === "insufficient_evidence" || code === "stale_evidence" || code === "conflicting_evidence"
    ? code
    : "answer_unavailable";
  const messages = {
    insufficient_evidence: "Mecky cannot answer because no sufficient reviewed public material is available.",
    stale_evidence: "Mecky cannot answer because the reviewed public material is no longer current.",
    conflicting_evidence: "Mecky cannot answer because the reviewed public material conflicts.",
    answer_unavailable: "Mecky cannot provide a safely cited answer for this question.",
  } as const;
  return {
    schemaVersion: "public_mecky_turn_v1",
    status: "unavailable",
    reason,
    message: messages[reason],
    authorityBinding: "none",
  };
}

function answeredTurn(value: PublicMeckyTurnV1): Extract<PublicMeckyTurnV1, { status: "answered" }> {
  if (!isRecord(value) || value.status !== "answered") throw new Error("public_mecky_answer_receipt_required");
  assertExactKeys(value, ["schemaVersion", "status", "answer", "citations", "suggestionDraft", "receipt", "authorityBinding"], "public_mecky_answer_receipt_invalid");
  if (value.schemaVersion !== "public_mecky_turn_v1" || value.authorityBinding !== "none") {
    throw new Error("public_mecky_answer_receipt_invalid");
  }
  const receipt = value.receipt;
  if (!isRecord(receipt)) throw new Error("public_mecky_answer_receipt_invalid");
  assertExactKeys(receipt, [
    "schemaVersion", "receiptId", "taskId", "caseId", "municipalityId", "sourceCaseId", "discussionId",
    "caseVersion", "journalHeadChecksum", "projectionChecksum", "contextChecksum", "workerIdentityId",
    "availableCitationRefs", "usedCitationRefs", "administrationAnswerReviewRequired", "sourceArtifactReviewRequired",
    "answerValidity", "authorityBinding", "effects", "receiptChecksum",
    ...(receipt.publicKnowledgeChecksum === undefined ? [] : ["publicKnowledgeChecksum"]),
  ], "public_mecky_answer_receipt_invalid");
  const { receiptId, receiptChecksum, ...receiptCore } = receipt;
  if (isRecord(receipt.effects)) {
    assertExactKeys(receipt.effects, ["privateToolAccess", "civicStateMutation", "publication", "suggestionSubmission", "vote"], "public_mecky_answer_receipt_invalid");
  }
  if (
    receipt.schemaVersion !== "public_mecky_answer_receipt_v1" ||
    receipt.authorityBinding !== "none" ||
    receipt.administrationAnswerReviewRequired !== false ||
    receipt.sourceArtifactReviewRequired !== true ||
    receipt.answerValidity !== "current_projection_only" ||
    (receipt.publicKnowledgeChecksum !== undefined && !/^sha256:[a-f0-9]{64}$/.test(String(receipt.publicKnowledgeChecksum))) ||
    !isRecord(receipt.effects) ||
    Object.values(receipt.effects).some((effect) => effect !== false) ||
    sha256(receiptCore) !== receiptChecksum ||
    receiptId !== `urn:stadtstack:mecky-answer:${String(receiptChecksum).slice("sha256:".length)}`
  ) throw new Error("public_mecky_answer_receipt_invalid");

  const draft = value.suggestionDraft;
  if (!isRecord(draft)) throw new Error("public_mecky_answer_receipt_invalid");
  assertExactKeys(draft, [
    "schemaVersion", "draftId", "sourceAnswerReceiptId", "sourceDiscussionId", "sourceDiscussionRef",
    "municipalityId", "sourceCaseId", "caseId", "citizenPubkey", "title", "summary", "entryState",
    "authorityBinding", "submittedToCivicWorkflow",
  ], "public_mecky_answer_receipt_invalid");
  const draftCore = {
    sourceAnswerReceiptId: draft.sourceAnswerReceiptId,
    sourceDiscussionId: draft.sourceDiscussionId,
    sourceDiscussionRef: draft.sourceDiscussionRef,
    municipalityId: draft.municipalityId,
    sourceCaseId: draft.sourceCaseId,
    caseId: draft.caseId,
    citizenPubkey: draft.citizenPubkey,
    title: draft.title,
    summary: draft.summary,
  };
  if (
    draft.schemaVersion !== "public_mecky_suggestion_draft_v1" ||
    draft.entryState !== "citizen_signature_required" ||
    draft.authorityBinding !== "none" ||
    draft.submittedToCivicWorkflow !== false ||
    draft.sourceAnswerReceiptId !== receiptId ||
    draft.sourceDiscussionId !== receipt.discussionId ||
    !/^[a-f0-9]{64}$/.test(String(draft.citizenPubkey)) ||
    draft.draftId !== `urn:stadtstack:suggestion-draft:${sha256(draftCore).slice("sha256:".length)}`
  ) throw new Error("public_mecky_answer_receipt_invalid");
  return value as Extract<PublicMeckyTurnV1, { status: "answered" }>;
}

function prepareSuggestion(input: {
  turn: Extract<PublicMeckyTurnV1, { status: "answered" }>;
  edits: { title: string; summary: string };
  createdAt: number;
}): PublicMeckySigningRequestV1 {
  assertSafePlainData(input);
  const turn = answeredTurn(input.turn);
  if (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0) throw new Error("public_mecky_signing_time_invalid");
  if (!isRecord(input.edits) || Object.keys(input.edits).sort().join(",") !== "summary,title") {
    throw new Error("public_mecky_suggestion_edits_invalid");
  }
  const title = stringValue(input.edits.title, "public_mecky_suggestion_invalid", 240);
  const summary = stringValue(input.edits.summary, "public_mecky_suggestion_invalid", 2_000);
  const source = turn.suggestionDraft;
  const draftCore = {
    sourceAnswerReceiptId: turn.receipt.receiptId,
    sourceDiscussionId: source.sourceDiscussionId,
    sourceDiscussionRef: source.sourceDiscussionRef,
    municipalityId: source.municipalityId,
    sourceCaseId: source.sourceCaseId,
    caseId: source.caseId,
    citizenPubkey: source.citizenPubkey,
    title,
    summary,
  };
  const draft: PublicMeckySuggestionDraftV1 = {
    schemaVersion: "public_mecky_suggestion_draft_v1",
    draftId: `urn:stadtstack:suggestion-draft:${sha256(draftCore).slice("sha256:".length)}`,
    ...draftCore,
    entryState: "citizen_signature_required",
    authorityBinding: "none",
    submittedToCivicWorkflow: false,
  };
  return {
    schemaVersion: "public_mecky_signing_request_v1",
    citizenPubkey: draft.citizenPubkey,
    sourceAnswerReceiptId: turn.receipt.receiptId,
    draft,
    unsignedEvent: {
      kind: 1,
      created_at: input.createdAt,
      tags: [
        ["schema", "citizen_signed_suggestion_v1"],
        ["municipality", draft.municipalityId],
        ["case", draft.sourceCaseId],
        ["e", draft.sourceDiscussionId, "", "root"],
        ["mecky-receipt", draft.sourceAnswerReceiptId],
      ],
      content: JSON.stringify(draft),
    },
  };
}

function acceptSignedSuggestion(input: {
  turn: Extract<PublicMeckyTurnV1, { status: "answered" }>;
  signingRequest: PublicMeckySigningRequestV1;
  event: NostrEvent;
}): CitizenSignedSuggestionV1 {
  assertSafePlainData(input);
  const turn = answeredTurn(input.turn);
  if (!isRecord(input.signingRequest) || !isRecord(input.signingRequest.draft) || !isRecord(input.signingRequest.unsignedEvent)) {
    throw new Error("public_mecky_signing_request_invalid");
  }
  const expected = prepareSuggestion({
    turn,
    edits: {
      title: stringValue(input.signingRequest.draft.title, "public_mecky_suggestion_invalid", 240),
      summary: stringValue(input.signingRequest.draft.summary, "public_mecky_suggestion_invalid", 2_000),
    },
    createdAt: Number(input.signingRequest.unsignedEvent.created_at),
  });
  if (canonical(input.signingRequest) !== canonical(expected)) throw new Error("public_mecky_signing_request_mismatch");
  const event = input.event;
  if (!validateEvent(event) || getEventHash(event) !== event.id || !verifyEvent(event)) {
    throw new Error("public_mecky_signature_invalid");
  }
  if (
    event.pubkey !== expected.citizenPubkey ||
    event.kind !== expected.unsignedEvent.kind ||
    event.created_at !== expected.unsignedEvent.created_at ||
    event.content !== expected.unsignedEvent.content ||
    canonical(event.tags) !== canonical(expected.unsignedEvent.tags)
  ) throw new Error("public_mecky_signature_binding_invalid");
  return {
    schemaVersion: "citizen_signed_suggestion_v1",
    candidateId: `urn:stadtstack:signed-suggestion:${event.id}`,
    signerPubkey: event.pubkey,
    draft: structuredClone(expected.draft),
    event: {
      id: event.id,
      pubkey: event.pubkey,
      createdAt: event.created_at,
      kind: 1,
      tags: event.tags.map((tag) => [...tag]),
      content: event.content,
      signature: event.sig,
    },
    verification: { kind: "nostr_nip01", verified: true },
    entryState: "awaiting_human_case_admission",
    authorityBinding: "none",
    submittedToCivicWorkflow: false,
  };
}

export function createPublicMecky(config: PublicMeckyConfig): PublicMecky {
  if (!config?.runtime || typeof config.runtime.prepareTask !== "function") throw new Error("public_mecky_runtime_required");
  if (!config?.worker || typeof config.worker.run !== "function") throw new Error("public_mecky_worker_required");

  return {
    async answer(request: PublicMeckyRequestV1): Promise<PublicMeckyTurnV1> {
      let question: string | null;
      try {
        assertSafePlainData(request);
        question = questionFor(request);
      } catch (error) {
        return unavailable(error);
      }
      if (question === null) {
        return {
          schemaVersion: "public_mecky_turn_v1",
          status: "not_invoked",
          reason: "explicit_trigger_required",
          authorityBinding: "none",
        };
      }
      try {
        const discussion = verifiedDiscussion(request.discussion);
        const task = config.runtime.prepareTask({ profile: "public", question });
        assertSafePlainData(task);
        const evidence = evidenceFor(task, discussion);
        const knowledge = config.knowledge?.project();
        if (knowledge) {
          assertSafePlainData(knowledge);
          const { knowledgeChecksum, ...knowledgeCore } = knowledge;
          if (
            knowledge.caseId !== evidence.caseId ||
            knowledge.municipalityId !== evidence.municipalityId ||
            knowledge.sourceCaseId !== evidence.sourceCaseId ||
            knowledge.caseVersion !== evidence.caseVersion ||
            knowledge.journalHeadChecksum !== evidence.journalHeadChecksum ||
            knowledge.sourceProjectionChecksum !== evidence.projectionChecksum ||
            knowledge.discussion.id !== discussion.id ||
            knowledge.discussion.sourceRef !== discussion.sourceRef ||
            knowledge.authorityBinding !== "none" ||
            knowledgeChecksum !== publicKnowledgeChecksum(knowledgeCore)
          ) throw new Error("stale_evidence");
        }
        const result = await config.worker.run(task);
        assertSafePlainData(result);
        validateWorkerBinding(result, task, evidence);
        const draft = answerDraft(result.answer, evidence);
        const usedCitationRefs = [...new Set(draft.facts.flatMap((fact) => fact.citationRefs))].sort();
        const receiptCore = {
          schemaVersion: "public_mecky_answer_receipt_v1" as const,
          taskId: result.taskId,
          caseId: evidence.caseId,
          municipalityId: evidence.municipalityId,
          sourceCaseId: evidence.sourceCaseId,
          discussionId: discussion.id,
          caseVersion: evidence.caseVersion,
          journalHeadChecksum: evidence.journalHeadChecksum,
          projectionChecksum: evidence.projectionChecksum,
          ...(knowledge ? { publicKnowledgeChecksum: knowledge.knowledgeChecksum } : {}),
          contextChecksum: result.contextChecksum,
          workerIdentityId: result.aiAttribution.workerIdentityId,
          availableCitationRefs: [...evidence.citations.keys()].sort(),
          usedCitationRefs,
          administrationAnswerReviewRequired: false as const,
          sourceArtifactReviewRequired: true as const,
          answerValidity: "current_projection_only" as const,
          authorityBinding: "none" as const,
          effects: {
            privateToolAccess: false as const,
            civicStateMutation: false as const,
            publication: false as const,
            suggestionSubmission: false as const,
            vote: false as const,
          },
        };
        const receiptChecksum = sha256(receiptCore);
        const receipt: PublicMeckyAnswerReceiptV1 = {
          ...receiptCore,
          receiptId: `urn:stadtstack:mecky-answer:${receiptChecksum.slice("sha256:".length)}`,
          receiptChecksum,
        };
        const suggestionCore = {
          sourceAnswerReceiptId: receipt.receiptId,
          sourceDiscussionId: discussion.id,
          sourceDiscussionRef: discussion.sourceRef,
          municipalityId: evidence.municipalityId,
          sourceCaseId: evidence.sourceCaseId,
          caseId: evidence.caseId,
          citizenPubkey: discussion.event.pubkey,
          title: draft.suggestion.title,
          summary: draft.suggestion.summary,
        };
        return {
          schemaVersion: "public_mecky_turn_v1",
          status: "answered",
          answer: {
            text: draft.answer,
            facts: draft.facts,
            uncertainty: draft.uncertainty,
            reasoningSummary: draft.reasoningSummary,
          },
          citations: usedCitationRefs.map((ref) => structuredClone(evidence.citations.get(ref)!)),
          suggestionDraft: {
            schemaVersion: "public_mecky_suggestion_draft_v1",
            draftId: `urn:stadtstack:suggestion-draft:${sha256(suggestionCore).slice("sha256:".length)}`,
            ...suggestionCore,
            entryState: "citizen_signature_required",
            authorityBinding: "none",
            submittedToCivicWorkflow: false,
          },
          receipt,
          authorityBinding: "none",
        };
      } catch (error) {
        return unavailable(error);
      }
    },
    prepareSuggestion,
    acceptSignedSuggestion,
  };
}
