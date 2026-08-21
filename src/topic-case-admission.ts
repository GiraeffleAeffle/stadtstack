import { createHash } from "node:crypto";

import {
  getEventHash,
  validateEvent,
  verifyEvent,
  type Event as NostrEvent,
} from "nostr-tools/pure";

import type { DiscussionArtifact } from "./adapters/discussion-adapter.ts";
import type { CitizenSignedTopicSuggestionV1 } from "./citizen-suggestion.ts";

export type TopicCaseIdentityV1 = {
  schemaVersion: "topic_case_identity_v1";
  municipalityId: string;
  topicId: string;
  candidateId: string;
  caseUuidV7: string;
  caseId: string;
};

export type VerifyTopicCaseAdmissionInput = {
  sourceDiscussion: NostrEvent;
  sourceAnswer: NostrEvent;
  signedSuggestion: CitizenSignedTopicSuggestionV1;
  allowedAgentPubkeys: readonly string[];
};

export type VerifiedTopicCaseAdmissionV1 = {
  schemaVersion: "verified_topic_case_admission_v1";
  identity: TopicCaseIdentityV1;
  discussion: DiscussionArtifact;
  sourceAnswer: NostrEvent;
  signedSuggestion: CitizenSignedTopicSuggestionV1;
  authorityBinding: "none";
};

const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TOPIC_ID =
  /^urn:stadtstack:topic:municipality:([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?):([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;
const MECKY_RECEIPT = /^urn:stadtstack:mecky-answer:[0-9a-f]{64}$/;

const CANDIDATE_KEYS = new Set([
  "schemaVersion",
  "candidateId",
  "signerPubkey",
  "draft",
  "event",
  "verification",
  "entryState",
  "authorityBinding",
  "submittedToCivicWorkflow",
]);
const DRAFT_KEYS = new Set([
  "schemaVersion",
  "draftId",
  "sourceAnswerReceiptId",
  "sourceDiscussionId",
  "sourceDiscussionRef",
  "municipalityId",
  "topicId",
  "citizenPubkey",
  "title",
  "summary",
  "entryState",
  "authorityBinding",
  "submittedToCivicWorkflow",
]);
const EVENT_KEYS = new Set([
  "id",
  "pubkey",
  "created_at",
  "kind",
  "tags",
  "content",
  "sig",
]);
const VERIFICATION_KEYS = new Set(["kind", "verified"]);

function fail(code: string): never {
  throw new Error(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: unknown, allowed: ReadonlySet<string>, code: string): void {
  if (!isRecord(value)) fail(code);
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== allowed.size ||
    keys.some((key) => typeof key !== "string" || !allowed.has(key))
  ) {
    fail(code);
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function singleTag(event: NostrEvent, name: string): string | null {
  const tags = event.tags.filter(
    (tag) => tag.length >= 2 && tag[0] === name && typeof tag[1] === "string",
  );
  return tags.length === 1 ? tags[0]![1]! : null;
}

function exactReplyTag(event: NostrEvent, sourceDiscussionId: string): boolean {
  const tags = event.tags.filter(
    (tag) => tag[0] === "e" && tag[1] === sourceDiscussionId && tag[3] === "reply",
  );
  return tags.length === 1 && tags[0]!.length === 4;
}

function hasNoTag(event: NostrEvent, ...names: string[]): boolean {
  const forbidden = new Set(names);
  return !event.tags.some((tag) => forbidden.has(tag[0] ?? ""));
}

function validEvidence(event: NostrEvent): boolean {
  const tags = event.tags.filter((tag) => tag[0] === "evidence");
  if (
    tags.length < 1 ||
    tags.length > 3 ||
    new Set(tags.map((tag) => tag[1])).size !== tags.length
  ) {
    return false;
  }
  return tags.every((tag) => {
    if (tag.length !== 3 || !/^sha256:[0-9a-f]{64}$/.test(tag[1] ?? "")) {
      return false;
    }
    try {
      const url = new URL(tag[2]!);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  });
}

function validSignedEvent(event: NostrEvent): boolean {
  return (
    validateEvent(event) &&
    getEventHash(event) === event.id &&
    verifyEvent(event) &&
    event.kind === 1 &&
    HEX_64.test(event.id) &&
    HEX_64.test(event.pubkey) &&
    HEX_128.test(event.sig)
  );
}

function cloneEvent(event: NostrEvent): NostrEvent {
  return {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags.map((tag) => [...tag]),
    content: event.content,
    sig: event.sig,
  };
}

function normalizeText(value: unknown, max: number, code: string): string {
  if (typeof value !== "string" || value !== value.trim() || !value || value.length > max) {
    fail(code);
  }
  if (/[^\P{Cc}\n\t]/u.test(value)) fail(code);
  return value;
}

function deriveUuidV7(event: NostrEvent): string {
  if (!Number.isSafeInteger(event.created_at) || event.created_at < 0) {
    fail("topic_case_timestamp_invalid");
  }
  const timestampMs = event.created_at * 1_000;
  if (!Number.isSafeInteger(timestampMs) || timestampMs > 0xffffffffffff) {
    fail("topic_case_timestamp_invalid");
  }
  const time = timestampMs.toString(16).padStart(12, "0");
  const entropy = createHash("sha256").update(event.id, "utf8").digest("hex");
  const variant = ((Number.parseInt(entropy[3]!, 16) & 0x3) | 0x8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8)}-7${entropy.slice(0, 3)}-${variant}${entropy.slice(4, 7)}-${entropy.slice(7, 19)}`;
}

export function deriveTopicCaseIdentity(
  signedSuggestion: CitizenSignedTopicSuggestionV1,
): TopicCaseIdentityV1 {
  const municipalityId = signedSuggestion.draft.municipalityId;
  const topicId = signedSuggestion.draft.topicId;
  const match = TOPIC_ID.exec(topicId);
  if (!SLUG.test(municipalityId) || !match || match[1] !== municipalityId) {
    fail("topic_case_scope_invalid");
  }
  const caseUuidV7 = deriveUuidV7(signedSuggestion.event as NostrEvent);
  return {
    schemaVersion: "topic_case_identity_v1",
    municipalityId,
    topicId,
    candidateId: signedSuggestion.candidateId,
    caseUuidV7,
    caseId: `urn:stadtstack:case:test:${municipalityId}:${caseUuidV7}`,
  };
}

export function verifyTopicCaseAdmission(
  input: VerifyTopicCaseAdmissionInput,
): VerifiedTopicCaseAdmissionV1 {
  exactKeys(input.sourceDiscussion, EVENT_KEYS, "topic_suggestion_discussion_invalid");
  exactKeys(input.sourceAnswer, EVENT_KEYS, "topic_suggestion_answer_invalid");
  exactKeys(input.signedSuggestion, CANDIDATE_KEYS, "topic_suggestion_invalid");
  exactKeys(input.signedSuggestion.draft, DRAFT_KEYS, "topic_suggestion_draft_invalid");
  exactKeys(input.signedSuggestion.event, EVENT_KEYS, "topic_suggestion_event_invalid");
  exactKeys(input.signedSuggestion.verification, VERIFICATION_KEYS, "topic_suggestion_invalid");
  if (
    !Array.isArray(input.allowedAgentPubkeys) ||
    input.allowedAgentPubkeys.length === 0 ||
    input.allowedAgentPubkeys.some((pubkey) => !HEX_64.test(pubkey)) ||
    new Set(input.allowedAgentPubkeys).size !== input.allowedAgentPubkeys.length
  ) {
    fail("topic_suggestion_agent_registry_invalid");
  }
  const allowedAgents = new Set(input.allowedAgentPubkeys);
  const candidate = input.signedSuggestion;
  const draft = candidate.draft;
  const sourceDiscussion = cloneEvent(input.sourceDiscussion);
  const sourceAnswer = cloneEvent(input.sourceAnswer);
  const candidateEvent = cloneEvent(candidate.event as NostrEvent);
  if (
    candidate.schemaVersion !== "citizen_signed_topic_suggestion_v1" ||
    draft.schemaVersion !== "public_mecky_topic_suggestion_draft_v1" ||
    candidate.verification.kind !== "nostr_nip01" ||
    candidate.verification.verified !== true ||
    candidate.entryState !== "awaiting_human_case_admission" ||
    candidate.authorityBinding !== "none" ||
    candidate.submittedToCivicWorkflow !== false ||
    draft.entryState !== "citizen_signature_required" ||
    draft.authorityBinding !== "none" ||
    draft.submittedToCivicWorkflow !== false
  ) {
    fail("topic_suggestion_invalid");
  }

  if (!validSignedEvent(sourceDiscussion)) {
    fail("topic_suggestion_discussion_invalid");
  }
  const discussionTopic = singleTag(sourceDiscussion, "topic");
  const agentPubkey = singleTag(sourceDiscussion, "p");
  if (
    sourceDiscussion.pubkey !== draft.citizenPubkey ||
    singleTag(sourceDiscussion, "t") !== "stadtstack-civic-discussion" ||
    singleTag(sourceDiscussion, "municipality") !== draft.municipalityId ||
    discussionTopic !== draft.topicId ||
    singleTag(sourceDiscussion, "stance") !== "root" ||
    singleTag(sourceDiscussion, "argument-root") !== "self" ||
    !hasNoTag(
      sourceDiscussion,
      "case",
      "case_id",
      "caseId",
      "stadtstack-case",
    ) ||
    !agentPubkey ||
    !allowedAgents.has(agentPubkey)
  ) {
    fail("topic_suggestion_discussion_invalid");
  }

  if (!validSignedEvent(sourceAnswer)) {
    fail("topic_suggestion_answer_invalid");
  }
  const receiptId = singleTag(sourceAnswer, "mecky-receipt");
  if (
    sourceAnswer.pubkey !== agentPubkey ||
    sourceAnswer.created_at < sourceDiscussion.created_at ||
    !exactReplyTag(sourceAnswer, sourceDiscussion.id) ||
    singleTag(sourceAnswer, "p") !== sourceDiscussion.pubkey ||
    singleTag(sourceAnswer, "municipality") !== draft.municipalityId ||
    singleTag(sourceAnswer, "topic") !== draft.topicId ||
    !hasNoTag(sourceAnswer, "case", "case_id", "caseId", "stadtstack-case") ||
    !receiptId ||
    !MECKY_RECEIPT.test(receiptId) ||
    !validEvidence(sourceAnswer)
  ) {
    fail("topic_suggestion_answer_invalid");
  }

  const title = normalizeText(draft.title, 240, "topic_suggestion_content_invalid");
  const summary = normalizeText(draft.summary, 2_000, "topic_suggestion_content_invalid");
  const draftCore = {
    sourceAnswerReceiptId: receiptId,
    sourceDiscussionId: sourceDiscussion.id,
    sourceDiscussionRef: `nostr://event/${sourceDiscussion.id}`,
    municipalityId: draft.municipalityId,
    topicId: draft.topicId,
    citizenPubkey: sourceDiscussion.pubkey,
    title,
    summary,
  };
  const expectedDraft = {
    schemaVersion: "public_mecky_topic_suggestion_draft_v1" as const,
    draftId: `urn:stadtstack:topic-suggestion-draft:${sha256(draftCore).slice("sha256:".length)}`,
    ...draftCore,
    entryState: "citizen_signature_required" as const,
    authorityBinding: "none" as const,
    submittedToCivicWorkflow: false as const,
  };
  const expectedTags = [
    ["schema", "citizen_signed_topic_suggestion_v1"],
    ["municipality", expectedDraft.municipalityId],
    ["topic", expectedDraft.topicId],
    ["e", expectedDraft.sourceDiscussionId, "", "root"],
    ["mecky-receipt", expectedDraft.sourceAnswerReceiptId],
  ];
  let eventDraft: unknown;
  try {
    eventDraft = JSON.parse(candidateEvent.content) as unknown;
  } catch {
    fail("topic_suggestion_draft_invalid");
  }
  if (
    !validSignedEvent(candidateEvent) ||
    candidateEvent.pubkey !== sourceDiscussion.pubkey ||
    candidateEvent.created_at <= sourceDiscussion.created_at ||
    candidateEvent.created_at <= sourceAnswer.created_at ||
    candidate.signerPubkey !== candidateEvent.pubkey ||
    candidate.candidateId !== `urn:stadtstack:signed-topic-suggestion:${candidateEvent.id}` ||
    canonical(candidateEvent.tags) !== canonical(expectedTags) ||
    canonical(eventDraft) !== canonical(expectedDraft) ||
    canonical(draft) !== canonical(expectedDraft)
  ) {
    fail("topic_suggestion_signature_invalid");
  }

  const normalizedCandidate: CitizenSignedTopicSuggestionV1 = {
    schemaVersion: "citizen_signed_topic_suggestion_v1",
    candidateId: candidate.candidateId,
    signerPubkey: candidateEvent.pubkey,
    draft: expectedDraft,
    event: { ...cloneEvent(candidateEvent), kind: 1 },
    verification: { kind: "nostr_nip01", verified: true },
    entryState: "awaiting_human_case_admission",
    authorityBinding: "none",
    submittedToCivicWorkflow: false,
  };
  const identity = deriveTopicCaseIdentity(normalizedCandidate);
  return {
    schemaVersion: "verified_topic_case_admission_v1",
    identity,
    discussion: {
      schemaVersion: "discussion_artifact_v1",
      id: sourceDiscussion.id,
      source: "nostr",
      sourceRef: `nostr://event/${sourceDiscussion.id}`,
      municipalityId: identity.municipalityId,
      caseId: identity.caseId,
      authorityBinding: "none",
      verificationProof: {
        kind: "nostr_nip01",
        verified: true,
        signature: sourceDiscussion.sig,
      },
      event: {
        id: sourceDiscussion.id,
        pubkey: sourceDiscussion.pubkey,
        createdAt: sourceDiscussion.created_at,
        kind: 1,
        content: sourceDiscussion.content,
        tags: sourceDiscussion.tags.map((tag) => [...tag]),
        relayRefs: [],
      },
    },
    sourceAnswer: cloneEvent(sourceAnswer),
    signedSuggestion: normalizedCandidate,
    authorityBinding: "none",
  };
}
