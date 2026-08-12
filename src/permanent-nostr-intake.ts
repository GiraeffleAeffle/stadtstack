import { types as utilTypes } from "node:util";

import {
  getEventHash,
  validateEvent,
  verifyEvent,
  type Event as NostrEvent,
} from "nostr-tools/pure";

import { createNostrDiscussionAdapter } from "./adapters/discussion-adapter.ts";
import type { CitizenSignedSuggestionV1 } from "./citizen-suggestion.ts";
import type { CommandEnvelope } from "./civic-case-coordinator.ts";

const HEX_64 = /^[0-9a-f]{64}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const ANSWER_RECEIPT = /^urn:stadtstack:mecky-answer:[0-9a-f]{64}$/;
const ACTOR_ID = /^[a-z0-9][a-z0-9:._-]{0,159}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
const EVENT_KEYS = ["id", "pubkey", "created_at", "kind", "tags", "content", "sig"] as const;

export type PermanentNostrIntakeConfig = {
  scope: { municipalityId: string; sourceCaseId: string };
  canonicalCaseId: string;
  policyVersion: string;
  discussionActorId: string;
  caseStewardActorId: string;
  publicMecky: { pubkey: string; agentName: string; nodeId: string };
};

export type PermanentDiscussionIntakeInput = {
  event: NostrEvent;
  relayRefs: string[];
};

export type PermanentSuggestionAdmissionInput = {
  expectedCaseVersion: number;
  sourceDiscussion: NostrEvent;
  sourceAnswer: NostrEvent;
  signedSuggestion: CitizenSignedSuggestionV1;
};

export type PermanentNostrIntake = {
  discussionActorId: string;
  caseStewardActorId: string;
  discussionCommand(value: unknown): CommandEnvelope;
  suggestionAdmissionCommand(value: unknown): CommandEnvelope;
};

function fail(code: string): never {
  throw new Error(`permanent_nostr_${code}`);
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeData(value: unknown, seen = new Set<object>()): void {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
  if (!value || typeof value !== "object" || utilTypes.isProxy(value) || seen.has(value)) fail("input_unsafe");
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail("input_unsafe");
  } else if (!plainRecord(value)) {
    fail("input_unsafe");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail("input_unsafe");
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail("input_unsafe");
    safeData(descriptor.value, seen);
  }
}

function exactKeys(value: unknown, expected: readonly string[], code: string): asserts value is Record<string, unknown> {
  if (!plainRecord(value)) fail(code);
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) fail(code);
}

function nonEmpty(value: unknown, code: string, max = 2_000): string {
  if (typeof value !== "string" || value !== value.trim() || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail(code);
  return value;
}

function answerContent(value: unknown): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length === 0 ||
    value.length > 2_000 ||
    /[\u0000-\u0009\u000b-\u001f\u007f]/.test(value)
  ) fail("answer_content_invalid");
  return value;
}

function exactEvent(value: unknown, code: string): NostrEvent {
  exactKeys(value, EVENT_KEYS, code);
  if (
    !HEX_64.test(String(value.id)) ||
    !HEX_64.test(String(value.pubkey)) ||
    !/^[0-9a-f]{128}$/.test(String(value.sig)) ||
    value.kind !== 1 ||
    !Number.isSafeInteger(value.created_at) ||
    (value.created_at as number) < 0 ||
    !Array.isArray(value.tags) ||
    value.tags.length === 0 ||
    value.tags.some((tag) => !Array.isArray(tag) || tag.length === 0 || tag.some((part) => typeof part !== "string")) ||
    typeof value.content !== "string" ||
    value.content.length === 0 ||
    value.content.length > 8_192
  ) fail(code);
  const event = value as unknown as NostrEvent;
  if (!validateEvent(event) || getEventHash(event) !== event.id || !verifyEvent(event)) fail(code);
  return structuredClone(event);
}

function singleTag(event: NostrEvent, name: string): string | null {
  const values = event.tags.filter((tag) => tag[0] === name && typeof tag[1] === "string").map((tag) => tag[1]!);
  return values.length === 1 ? values[0]! : null;
}

function civicDiscussion(event: NostrEvent, config: PermanentNostrIntakeConfig): void {
  const expected = [
    ["p", config.publicMecky.pubkey],
    ["t", "stadtstack-civic-discussion"],
    ["municipality", config.scope.municipalityId],
    ["case", config.scope.sourceCaseId],
    ["stadtstack-case", config.canonicalCaseId],
  ];
  if (
    event.tags.length !== expected.length ||
    JSON.stringify(event.tags) !== JSON.stringify(expected) ||
    !/@mecky\b/i.test(event.content)
  ) fail("discussion_binding_invalid");
}

function reviewedEvidenceTags(event: NostrEvent): string[][] {
  const tags = event.tags.filter((tag) => tag[0] === "evidence");
  if (tags.length < 1 || tags.length > 3) fail("answer_evidence_invalid");
  for (const tag of tags) {
    if (tag.length !== 3 || !SHA256.test(tag[1] ?? "")) fail("answer_evidence_invalid");
    let url: URL;
    try {
      url = new URL(tag[2]!);
    } catch {
      fail("answer_evidence_invalid");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.hash) fail("answer_evidence_invalid");
  }
  return tags.map((tag) => [...tag]);
}

function meckyAnswer(
  event: NostrEvent,
  discussion: NostrEvent,
  config: PermanentNostrIntakeConfig,
): string {
  const evidence = reviewedEvidenceTags(event);
  const expectedPrefix = [
    ["netizen_agent", config.publicMecky.agentName, config.publicMecky.nodeId],
    ["e", discussion.id, "", "reply"],
    ["p", discussion.pubkey],
  ];
  const receipt = singleTag(event, "mecky-receipt");
  const expectedMiddle = [
    ["mecky-receipt", receipt],
    ["municipality", config.scope.municipalityId],
    ["case", config.scope.sourceCaseId],
    ["stadtstack-case", config.canonicalCaseId],
  ];
  if (
    event.pubkey !== config.publicMecky.pubkey ||
    event.created_at < discussion.created_at ||
    !receipt ||
    !ANSWER_RECEIPT.test(receipt) ||
    event.tags.length !== expectedPrefix.length + expectedMiddle.length + evidence.length ||
    JSON.stringify(event.tags) !== JSON.stringify([...expectedPrefix, ...expectedMiddle, ...evidence]) ||
    answerContent(event.content).length === 0
  ) fail("answer_binding_invalid");
  return receipt;
}

function configValue(value: PermanentNostrIntakeConfig): PermanentNostrIntakeConfig {
  safeData(value);
  exactKeys(value, ["scope", "canonicalCaseId", "policyVersion", "discussionActorId", "caseStewardActorId", "publicMecky"], "config_invalid");
  exactKeys(value.scope, ["municipalityId", "sourceCaseId"], "config_invalid");
  exactKeys(value.publicMecky, ["pubkey", "agentName", "nodeId"], "config_invalid");
  if (
    !SLUG.test(String(value.scope.municipalityId)) ||
    !SLUG.test(String(value.scope.sourceCaseId)) ||
    !HEX_64.test(String(value.publicMecky.pubkey)) ||
    !SLUG.test(String(value.publicMecky.agentName)) ||
    !SLUG.test(String(value.publicMecky.nodeId)) ||
    !ACTOR_ID.test(String(value.discussionActorId)) ||
    !ACTOR_ID.test(String(value.caseStewardActorId)) ||
    value.discussionActorId === value.caseStewardActorId ||
    !nonEmpty(value.canonicalCaseId, "config_invalid", 240) ||
    !nonEmpty(value.policyVersion, "config_invalid", 80)
  ) fail("config_invalid");
  return structuredClone(value);
}

function admissionBindings(
  value: Record<string, unknown>,
  config: PermanentNostrIntakeConfig,
): { sourceDiscussion: NostrEvent; sourceAnswer: NostrEvent; signedSuggestion: CitizenSignedSuggestionV1; expectedCaseVersion: number } {
  const sourceDiscussion = exactEvent(value.sourceDiscussion, "discussion_invalid");
  civicDiscussion(sourceDiscussion, config);
  const sourceAnswer = exactEvent(value.sourceAnswer, "answer_invalid");
  const receipt = meckyAnswer(sourceAnswer, sourceDiscussion, config);
  const signedSuggestion = value.signedSuggestion;
  if (!plainRecord(signedSuggestion) || !plainRecord(signedSuggestion.draft) || !plainRecord(signedSuggestion.event)) fail("suggestion_invalid");
  const signedEventCreatedAt = signedSuggestion.event.createdAt;
  const expectedCaseVersion = value.expectedCaseVersion;
  if (!Number.isSafeInteger(expectedCaseVersion) || (expectedCaseVersion as number) < 2) fail("case_version_invalid");
  if (!Number.isSafeInteger(signedEventCreatedAt) || (signedEventCreatedAt as number) < 0) fail("suggestion_invalid");
  if (
    signedSuggestion.draft.sourceAnswerReceiptId !== receipt ||
    signedSuggestion.draft.sourceDiscussionId !== sourceDiscussion.id ||
    signedSuggestion.draft.sourceDiscussionRef !== `nostr://event/${sourceDiscussion.id}` ||
    signedSuggestion.draft.citizenPubkey !== sourceDiscussion.pubkey ||
    signedSuggestion.draft.municipalityId !== config.scope.municipalityId ||
    signedSuggestion.draft.sourceCaseId !== config.scope.sourceCaseId ||
    signedSuggestion.draft.caseId !== config.canonicalCaseId ||
    (signedEventCreatedAt as number) < sourceAnswer.created_at
  ) fail("suggestion_binding_invalid");
  return {
    sourceDiscussion,
    sourceAnswer,
    signedSuggestion: structuredClone(signedSuggestion) as CitizenSignedSuggestionV1,
    expectedCaseVersion: expectedCaseVersion as number,
  };
}

export function createPermanentNostrIntake(input: PermanentNostrIntakeConfig): PermanentNostrIntake {
  const config = configValue(input);
  const discussionAdapter = createNostrDiscussionAdapter({
    scope: { municipalityId: config.scope.municipalityId, caseId: config.scope.sourceCaseId },
    allowedKinds: [1],
  });
  return Object.freeze({
    discussionActorId: config.discussionActorId,
    caseStewardActorId: config.caseStewardActorId,
    discussionCommand(value: unknown): CommandEnvelope {
      safeData(value);
      exactKeys(value, ["event", "relayRefs"], "discussion_input_invalid");
      const event = exactEvent(value.event, "discussion_invalid");
      civicDiscussion(event, config);
      if (!Array.isArray(value.relayRefs)) fail("discussion_relay_invalid");
      const discussion = discussionAdapter.normalize({ event, relayRefs: value.relayRefs as string[] });
      return {
        schemaVersion: "command_envelope_v1",
        commandType: "intake_discussion_v1",
        caseId: config.canonicalCaseId,
        actorBinding: { actorId: config.discussionActorId, actorClass: "citizen" },
        expectedCaseVersion: 0,
        idempotencyKey: `roebel:discussion:${event.id}`,
        visibility: "private_case",
        policyVersion: config.policyVersion,
        payload: { discussion },
      };
    },
    suggestionAdmissionCommand(value: unknown): CommandEnvelope {
      safeData(value);
      exactKeys(value, ["expectedCaseVersion", "sourceDiscussion", "sourceAnswer", "signedSuggestion"], "suggestion_input_invalid");
      const admission = admissionBindings(value, config);
      return {
        schemaVersion: "command_envelope_v1",
        commandType: "admit_signed_suggestion_v1",
        caseId: config.canonicalCaseId,
        actorBinding: { actorId: config.caseStewardActorId, actorClass: "case_steward" },
        expectedCaseVersion: admission.expectedCaseVersion,
        idempotencyKey: `roebel:suggestion:${admission.signedSuggestion.candidateId}`,
        visibility: "private_case",
        policyVersion: config.policyVersion,
        payload: { signedSuggestion: admission.signedSuggestion },
      };
    },
  });
}
