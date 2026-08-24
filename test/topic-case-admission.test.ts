import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { finalizeEvent, getPublicKey, type Event as NostrEvent } from "nostr-tools/pure";

import type { CitizenSignedTopicSuggestionV1 } from "../src/citizen-suggestion.ts";
import { createSqliteJournalStore } from "../src/adapters/sqlite-journal-adapter.ts";
import {
  createCivicCaseCoordinator,
  createDurableCivicCaseCoordinator,
} from "../src/civic-case-coordinator.ts";
import {
  deriveTopicCaseIdentity,
  verifyTopicCaseAdmission,
} from "../src/topic-case-admission.ts";

const MUNICIPALITY_ID = "roebel-mueritz";
const TOPIC_ID =
  "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse";
const POLICY_VERSION = "case-intake-v1";
const CITIZEN_SECRET = new Uint8Array(32).fill(21);
const AGENT_SECRET = new Uint8Array(32).fill(22);
const CITIZEN_PUBKEY = getPublicKey(CITIZEN_SECRET);
const AGENT_PUBKEY = getPublicKey(AGENT_SECRET);
const RECEIPT_ID = `urn:stadtstack:mecky-answer:${"a".repeat(64)}`;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function plainEvent(event: NostrEvent): NostrEvent {
  return JSON.parse(JSON.stringify(event)) as NostrEvent;
}

function fixture(): {
  sourceDiscussion: NostrEvent;
  sourceAnswer: NostrEvent;
  signedSuggestion: CitizenSignedTopicSuggestionV1;
} {
  const sourceDiscussion = plainEvent(finalizeEvent(
    {
      kind: 1,
      created_at: 1_787_356_800,
      content:
        "@Mecky Welche geprüften Möglichkeiten gibt es für eine sichere Querung?",
      tags: [
        ["p", AGENT_PUBKEY],
        ["q", "b".repeat(64), "", CITIZEN_PUBKEY],
        ["source-post", "b".repeat(64)],
        ["t", "stadtstack-civic-discussion"],
        ["municipality", MUNICIPALITY_ID],
        ["topic", TOPIC_ID],
        ["topic-title", "Sichere Querung Marienfelder Straße"],
        ["stance", "root"],
        ["argument-root", "self"],
      ],
    },
    CITIZEN_SECRET,
  ));
  const sourceAnswer = plainEvent(finalizeEvent(
    {
      kind: 1,
      created_at: sourceDiscussion.created_at + 1,
      content:
        "Geprüfte Unterlagen beschreiben mehrere Varianten; die Abwägung bleibt offen.",
      tags: [
        ["e", sourceDiscussion.id, "", "reply"],
        ["p", CITIZEN_PUBKEY],
        ["municipality", MUNICIPALITY_ID],
        ["topic", TOPIC_ID],
        ["mecky-receipt", RECEIPT_ID],
        [
          "evidence",
          `sha256:${"c".repeat(64)}`,
          "https://roebel.example/reviewed/crossing-options",
        ],
      ],
    },
    AGENT_SECRET,
  ));
  const core = {
    sourceAnswerReceiptId: RECEIPT_ID,
    sourceDiscussionId: sourceDiscussion.id,
    sourceDiscussionRef: `nostr://event/${sourceDiscussion.id}`,
    municipalityId: MUNICIPALITY_ID,
    topicId: TOPIC_ID,
    citizenPubkey: CITIZEN_PUBKEY,
    title: "Sichere Querung gemeinsam prüfen",
    summary:
      "Die geprüften Varianten sollen öffentlich abgewogen und anschließend menschlich in den Civic-Case-Prozess aufgenommen werden.",
  };
  const draft = {
    schemaVersion: "public_mecky_topic_suggestion_draft_v1" as const,
    draftId: `urn:stadtstack:topic-suggestion-draft:${digest(core).slice("sha256:".length)}`,
    ...core,
    entryState: "citizen_signature_required" as const,
    authorityBinding: "none" as const,
    submittedToCivicWorkflow: false as const,
  };
  const event = {
    ...plainEvent(finalizeEvent(
      {
        kind: 1,
        created_at: sourceAnswer.created_at + 1,
        content: JSON.stringify(draft),
        tags: [
          ["schema", "citizen_signed_topic_suggestion_v1"],
          ["municipality", MUNICIPALITY_ID],
          ["topic", TOPIC_ID],
          ["e", sourceDiscussion.id, "", "root"],
          ["mecky-receipt", RECEIPT_ID],
        ],
      },
      CITIZEN_SECRET,
    )),
    kind: 1 as const,
  };
  return {
    sourceDiscussion,
    sourceAnswer,
    signedSuggestion: {
      schemaVersion: "citizen_signed_topic_suggestion_v1",
      candidateId: `urn:stadtstack:signed-topic-suggestion:${event.id}`,
      signerPubkey: event.pubkey,
      draft,
      event,
      verification: { kind: "nostr_nip01", verified: true },
      entryState: "awaiting_human_case_admission",
      authorityBinding: "none",
      submittedToCivicWorkflow: false,
    },
  };
}

function coordinatorOptions(signedSuggestion: CitizenSignedTopicSuggestionV1) {
  const identity = deriveTopicCaseIdentity(signedSuggestion);
  return {
    identity,
    options: {
      jurisdictionValue: identity.municipalityId,
      uuidV7: identity.caseUuidV7,
      canonicalCaseId: identity.caseId,
      policyVersion: POLICY_VERSION,
      syntheticFixtureOnly: true,
      requireSignedSuggestionAdmission: true,
      allowedSignerPubkeys: [CITIZEN_PUBKEY],
      allowedAgentPubkeys: [AGENT_PUBKEY],
      actors: [
        {
          actorId: "roebel:case-steward",
          actorClass: "case_steward" as const,
        },
        { actorId: "roebel:citizen", actorClass: "citizen" as const },
        { actorId: "roebel:public", actorClass: "public" as const },
      ],
    },
  };
}

function coordinatorFor(signedSuggestion: CitizenSignedTopicSuggestionV1) {
  const { identity, options } = coordinatorOptions(signedSuggestion);
  return { identity, coordinator: createCivicCaseCoordinator(options) };
}

test("a human steward atomically admits one signed topic proposal as one Civic Case", () => {
  const value = fixture();
  const verified = verifyTopicCaseAdmission({
    ...value,
    allowedAgentPubkeys: [AGENT_PUBKEY],
  });
  const { identity, coordinator } = coordinatorFor(value.signedSuggestion);
  assert.deepEqual(verified.identity, identity);

  const command = {
    schemaVersion: "command_envelope_v1" as const,
    commandType: "admit_signed_topic_suggestion_v1" as const,
    caseId: identity.caseId,
    actorBinding: {
      actorId: "roebel:case-steward",
      actorClass: "case_steward" as const,
    },
    expectedCaseVersion: 0,
    idempotencyKey: `topic-admission:${value.signedSuggestion.candidateId}`,
    visibility: "private_case" as const,
    policyVersion: POLICY_VERSION,
    payload: value,
  };
  const admitted = coordinator.handle(command);
  assert.equal(admitted.caseVersion, 3);
  assert.equal(admitted.eventIds.length, 3);
  assert.deepEqual(coordinator.handle(command), admitted);

  const projection = coordinator.project({
    schemaVersion: "query_envelope_v1",
    queryType: "case_projection_v1",
    caseId: identity.caseId,
    actorBinding: { actorId: "roebel:public", actorClass: "public" },
    visibility: "public",
    policyVersion: POLICY_VERSION,
    atCaseVersion: null,
  });
  assert.equal(projection.caseVersion, 3);
  assert.equal(projection.projection.caseId, identity.caseId);
  assert.equal(projection.projection.suggestion.status, "admitted");
  assert.equal(
    projection.projection.suggestion.admission?.candidateId,
    value.signedSuggestion.candidateId,
  );
  assert.equal(
    projection.projection.suggestion.admission?.sourceTopicId,
    TOPIC_ID,
  );
  assert.equal(
    projection.projection.suggestion.admission?.admittedByActorClass,
    "case_steward",
  );
  assert.equal(projection.projection.discussion.id, value.sourceDiscussion.id);
  assert.equal(
    projection.projection.discussion.event.tags.some((tag) => tag[0] === "case"),
    false,
  );
});

test("the candidate deterministically derives the only admissible Case identity", () => {
  const value = fixture();
  const first = deriveTopicCaseIdentity(value.signedSuggestion);
  const second = deriveTopicCaseIdentity(structuredClone(value.signedSuggestion));
  assert.deepEqual(second, first);
  assert.match(
    first.caseId,
    /^urn:stadtstack:case:municipality:roebel-mueritz:[0-9a-f-]{36}$/,
  );

  const wrongIdentity = {
    ...first,
    caseUuidV7: "018f0000-0000-7000-8000-000000000001",
    caseId:
      "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
  };
  const coordinator = createCivicCaseCoordinator({
    jurisdictionValue: MUNICIPALITY_ID,
    uuidV7: wrongIdentity.caseUuidV7,
    canonicalCaseId: wrongIdentity.caseId,
    policyVersion: POLICY_VERSION,
    syntheticFixtureOnly: true,
    allowedSignerPubkeys: [CITIZEN_PUBKEY],
    allowedAgentPubkeys: [AGENT_PUBKEY],
    actors: [{ actorId: "roebel:case-steward", actorClass: "case_steward" }],
  });
  assert.throws(
    () =>
      coordinator.handle({
        schemaVersion: "command_envelope_v1",
        commandType: "admit_signed_topic_suggestion_v1",
        caseId: wrongIdentity.caseId,
        actorBinding: {
          actorId: "roebel:case-steward",
          actorClass: "case_steward",
        },
        expectedCaseVersion: 0,
        idempotencyKey: "wrong-case",
        visibility: "private_case",
        policyVersion: POLICY_VERSION,
        payload: value,
      }),
    /topic_case_binding_invalid/,
  );
});

test("the atomic topic admission recovers byte-identically from the durable Case journal", () => {
  const value = fixture();
  const { identity, options } = coordinatorOptions(value.signedSuggestion);
  const rootDir = mkdtempSync(join(tmpdir(), "stadtstack-topic-admission-"));
  const command = {
    schemaVersion: "command_envelope_v1" as const,
    commandType: "admit_signed_topic_suggestion_v1" as const,
    caseId: identity.caseId,
    actorBinding: {
      actorId: "roebel:case-steward",
      actorClass: "case_steward" as const,
    },
    expectedCaseVersion: 0,
    idempotencyKey: `topic-admission:${value.signedSuggestion.candidateId}`,
    visibility: "private_case" as const,
    policyVersion: POLICY_VERSION,
    payload: value,
  };
  const query = {
    schemaVersion: "query_envelope_v1" as const,
    queryType: "case_projection_v1" as const,
    caseId: identity.caseId,
    actorBinding: { actorId: "roebel:public", actorClass: "public" as const },
    visibility: "public" as const,
    policyVersion: POLICY_VERSION,
    atCaseVersion: null,
  };

  const firstStore = createSqliteJournalStore({
    rootDir,
    namespace: "topic-admission",
  });
  const first = createDurableCivicCaseCoordinator(options, firstStore);
  const receipt = first.handle(command);
  const projection = first.project(query);
  firstStore.close();

  const secondStore = createSqliteJournalStore({
    rootDir,
    namespace: "topic-admission",
  });
  const recovered = createDurableCivicCaseCoordinator(options, secondStore);
  assert.deepEqual(recovered.handle(command), receipt);
  assert.deepEqual(recovered.project(query), projection);
  secondStore.close();
});

test("forgery, a case-bearing topic, or a non-steward cannot create a Case", () => {
  const value = fixture();
  const tampered = structuredClone(value);
  tampered.signedSuggestion.draft.summary = "Changed after the citizen signed";
  assert.throws(
    () =>
      verifyTopicCaseAdmission({
        ...tampered,
        allowedAgentPubkeys: [AGENT_PUBKEY],
      }),
    /topic_suggestion_signature_invalid/,
  );

  const caseBearingDiscussion = plainEvent(finalizeEvent(
    {
      ...value.sourceDiscussion,
      tags: [
        ...value.sourceDiscussion.tags,
        ["case", "smuggled-case"],
        ["case", "duplicate-smuggled-case"],
      ],
    },
    CITIZEN_SECRET,
  ));
  assert.throws(
    () =>
      verifyTopicCaseAdmission({
        ...value,
        sourceDiscussion: caseBearingDiscussion,
        allowedAgentPubkeys: [AGENT_PUBKEY],
      }),
    /topic_suggestion_discussion_invalid/,
  );

  const { identity, coordinator } = coordinatorFor(value.signedSuggestion);
  assert.throws(
    () =>
      coordinator.handle({
        schemaVersion: "command_envelope_v1",
        commandType: "admit_signed_topic_suggestion_v1",
        caseId: identity.caseId,
        actorBinding: { actorId: "roebel:citizen", actorClass: "citizen" },
        expectedCaseVersion: 0,
        idempotencyKey: "citizen-cannot-admit",
        visibility: "private_case",
        policyVersion: POLICY_VERSION,
        payload: value,
      }),
    /actor_role_forbidden/,
  );
  assert.throws(
    () =>
      coordinator.project({
        schemaVersion: "query_envelope_v1",
        queryType: "case_projection_v1",
        caseId: identity.caseId,
        actorBinding: { actorId: "roebel:public", actorClass: "public" },
        visibility: "public",
        policyVersion: POLICY_VERSION,
        atCaseVersion: null,
      }),
    /case_not_found/,
  );
});
