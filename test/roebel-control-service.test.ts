import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { finalizeEvent, getPublicKey, type Event as NostrEvent } from "nostr-tools/pure";

import {
  createInMemoryCaseBindingProjection,
  createPublicCaseBindingReceipt,
  type PublicCaseBindingReceiptV1,
} from "../src/case-binding-projection.ts";
import type { CitizenSignedTopicSuggestionV1 } from "../src/citizen-suggestion.ts";
import { createCivicCaseCoordinator } from "../src/civic-case-coordinator.ts";
import {
  createRoebelCaseStewardControlService,
  type AtomicCaseAdmissionPort,
  type AtomicTopicCaseAdmissionV1,
} from "../src/roebel-control-service.ts";

const MUNICIPALITY_ID = "roebel-mueritz";
const TOPIC_ID = "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse";
const POLICY_VERSION = "case-intake-v1";
const CITIZEN_SECRET = new Uint8Array(32).fill(21);
const AGENT_SECRET = new Uint8Array(32).fill(22);
const CITIZEN_PUBKEY = getPublicKey(CITIZEN_SECRET);
const AGENT_PUBKEY = getPublicKey(AGENT_SECRET);
const RECEIPT_ID = `urn:stadtstack:mecky-answer:${"a".repeat(64)}`;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const digest = (value: unknown) => `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
const plainEvent = (event: NostrEvent): NostrEvent => JSON.parse(JSON.stringify(event)) as NostrEvent;

function fixture(title = "Sichere Querung gemeinsam prüfen"): {
  sourceDiscussion: NostrEvent;
  sourceAnswer: NostrEvent;
  signedSuggestion: CitizenSignedTopicSuggestionV1;
} {
  const sourceDiscussion = plainEvent(finalizeEvent({
    kind: 1,
    created_at: 1_787_356_800,
    content: "@Mecky Welche geprüften Möglichkeiten gibt es für eine sichere Querung?",
    tags: [["p", AGENT_PUBKEY], ["t", "stadtstack-civic-discussion"], ["municipality", MUNICIPALITY_ID], ["topic", TOPIC_ID], ["stance", "root"], ["argument-root", "self"]],
  }, CITIZEN_SECRET));
  const sourceAnswer = plainEvent(finalizeEvent({
    kind: 1,
    created_at: sourceDiscussion.created_at + 1,
    content: "Geprüfte Unterlagen beschreiben mehrere Varianten.",
    tags: [["e", sourceDiscussion.id, "", "reply"], ["p", CITIZEN_PUBKEY], ["municipality", MUNICIPALITY_ID], ["topic", TOPIC_ID], ["mecky-receipt", RECEIPT_ID], ["evidence", `sha256:${"c".repeat(64)}`, "https://roebel.example/reviewed/crossing-options"]],
  }, AGENT_SECRET));
  const core = {
    sourceAnswerReceiptId: RECEIPT_ID,
    sourceDiscussionId: sourceDiscussion.id,
    sourceDiscussionRef: `nostr://event/${sourceDiscussion.id}`,
    municipalityId: MUNICIPALITY_ID,
    topicId: TOPIC_ID,
    citizenPubkey: CITIZEN_PUBKEY,
    title,
    summary: "Die geprüften Varianten sollen öffentlich abgewogen und anschließend menschlich in den Civic-Case-Prozess aufgenommen werden.",
  };
  const draft = {
    schemaVersion: "public_mecky_topic_suggestion_draft_v1" as const,
    draftId: `urn:stadtstack:topic-suggestion-draft:${digest(core).slice("sha256:".length)}`,
    ...core,
    entryState: "citizen_signature_required" as const,
    authorityBinding: "none" as const,
    submittedToCivicWorkflow: false as const,
  };
  const event = plainEvent(finalizeEvent({
    kind: 1,
    created_at: sourceAnswer.created_at + 1,
    content: JSON.stringify(draft),
    tags: [["schema", "citizen_signed_topic_suggestion_v1"], ["municipality", MUNICIPALITY_ID], ["topic", TOPIC_ID], ["e", sourceDiscussion.id, "", "root"], ["mecky-receipt", RECEIPT_ID]],
  }, CITIZEN_SECRET));
  return {
    sourceDiscussion,
    sourceAnswer,
    signedSuggestion: {
      schemaVersion: "citizen_signed_topic_suggestion_v1",
      candidateId: `urn:stadtstack:signed-topic-suggestion:${event.id}`,
      signerPubkey: event.pubkey,
      draft,
      event: { ...event, kind: 1 },
      verification: { kind: "nostr_nip01", verified: true },
      entryState: "awaiting_human_case_admission",
      authorityBinding: "none",
      submittedToCivicWorkflow: false,
    },
  };
}

function admissionBody(title?: string) {
  return { schemaVersion: "roebel_case_steward_admission_request_v1" as const, ...fixture(title) };
}

function atomicHarness(): {
  port: AtomicCaseAdmissionPort;
  projection: ReturnType<typeof createInMemoryCaseBindingProjection>;
  coordinatorCreations(): number;
} {
  const projection = createInMemoryCaseBindingProjection();
  const receiptsByRoot = new Map<string, PublicCaseBindingReceiptV1>();
  let creations = 0;
  return {
    projection,
    coordinatorCreations: () => creations,
    port: {
      async admit(input: AtomicTopicCaseAdmissionV1): Promise<PublicCaseBindingReceiptV1> {
        const existing = receiptsByRoot.get(input.rootEventId);
        if (existing) {
          if (existing.candidateId !== input.verifiedAdmission.signedSuggestion.candidateId) {
            throw new Error("case_binding_root_conflict");
          }
          return existing;
        }
        creations += 1;
        const verified = input.verifiedAdmission;
        const coordinator = createCivicCaseCoordinator({
          jurisdictionValue: verified.identity.municipalityId,
          uuidV7: verified.identity.caseUuidV7,
          canonicalCaseId: verified.identity.caseId,
          policyVersion: POLICY_VERSION,
          syntheticFixtureOnly: true,
          requireSignedSuggestionAdmission: true,
          allowedSignerPubkeys: [CITIZEN_PUBKEY],
          allowedAgentPubkeys: [AGENT_PUBKEY],
          actors: [{ actorId: "roebel:case-steward", actorClass: "case_steward" }],
        });
        const result = coordinator.handle({
          schemaVersion: "command_envelope_v1",
          commandType: "admit_signed_topic_suggestion_v1",
          caseId: input.caseId,
          actorBinding: input.actorBinding,
          expectedCaseVersion: input.expectedCaseVersion,
          idempotencyKey: input.idempotencyKey,
          visibility: "private_case",
          policyVersion: input.policyVersion,
          payload: {
            sourceDiscussion: input.sourceDiscussion,
            sourceAnswer: verified.sourceAnswer,
            signedSuggestion: verified.signedSuggestion,
          },
        });
        if (result.caseVersion !== 3 || result.eventIds.length !== 3) {
          throw new Error("test_atomic_admission_receipt_invalid");
        }
        const receipt = createPublicCaseBindingReceipt({
          rootEventId: verified.discussion.id,
          topicId: verified.identity.topicId,
          candidateId: verified.signedSuggestion.candidateId,
          candidateEventId: verified.signedSuggestion.event.id,
          sourceAnswerEventId: verified.sourceAnswer.id,
          caseId: verified.identity.caseId,
          caseVersion: 3,
          caseEventIds: [result.eventIds[0]!, result.eventIds[1]!, result.eventIds[2]!],
          journalHeadChecksum: result.journalHeadChecksum,
          admissionEventChecksum: result.journalHeadChecksum,
        });
        projection.writer.record(receipt);
        receiptsByRoot.set(input.rootEventId, receipt);
        return receipt;
      },
    },
  };
}

function service(port: AtomicCaseAdmissionPort, allowedAgentPubkeys: string[] = [AGENT_PUBKEY]) {
  return createRoebelCaseStewardControlService({
    municipalityId: MUNICIPALITY_ID,
    policyVersion: POLICY_VERSION,
    allowedAgentPubkeys,
    caseStewardAuthenticator: {
      async authenticate({ authorization }) {
        return authorization === "steward-token"
          ? { actorId: "roebel:case-steward", actorClass: "case_steward", municipalityIds: [MUNICIPALITY_ID] }
          : null;
      },
    },
    atomicAdmission: port,
  });
}

test("authenticated Röbel Case Steward delegates to the atomic port and its public reader is separate", async () => {
  const harness = atomicHarness();
  const control = service(harness.port);
  const denied = await control.respond({ method: "POST", path: "/v1/nostr/suggestions/admit", authorization: "citizen-token", body: admissionBody() });
  assert.equal(denied.status, 401);
  const body = admissionBody();
  const accepted = await control.respond({ method: "POST", path: "/v1/nostr/suggestions/admit", authorization: "steward-token", body });
  assert.equal(accepted.status, 200);
  const receipt = JSON.parse(accepted.body) as PublicCaseBindingReceiptV1;
  assert.equal(receipt.rootEventId, body.sourceDiscussion.id);
  assert.equal(receipt.candidateId, body.signedSuggestion.candidateId);
  assert.equal(receipt.authorityBinding, "none");
  assert.equal(receipt.openDeskWrite, false);
  assert.equal(harness.coordinatorCreations(), 1);
  const replay = await control.respond({ method: "POST", path: "/v1/nostr/suggestions/admit", authorization: "steward-token", body });
  assert.equal(replay.status, 200);
  assert.equal(replay.body, accepted.body);
  assert.equal(harness.coordinatorCreations(), 1);
  const conflict = await control.respond({ method: "POST", path: "/v1/nostr/suggestions/admit", authorization: "steward-token", body: admissionBody("Andere Formulierung") });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body, "case_binding_root_conflict\n");
  assert.equal(await control.respond({ method: "GET", path: `/v1/public/case-bindings/${receipt.caseId}`, authorization: null, body: null }).then((value) => value.status), 404);
  assert.equal("record" in harness.projection.reader, false);
  const publicRead = harness.projection.reader.respond({ method: "GET", path: `/v1/public/case-bindings/${receipt.caseId}` });
  assert.equal(publicRead.status, 200);
  assert.deepEqual(JSON.parse(publicRead.body), receipt);
});

test("control rejects self-asserted authority, caller-selected command fields, and wrong municipality scope", async () => {
  const harness = atomicHarness();
  const wrongScope = createRoebelCaseStewardControlService({
    municipalityId: MUNICIPALITY_ID,
    policyVersion: POLICY_VERSION,
    allowedAgentPubkeys: [AGENT_PUBKEY],
    caseStewardAuthenticator: { async authenticate() {
      return { actorId: "strausberg:case-steward", actorClass: "case_steward", municipalityIds: ["strausberg"] };
    } },
    atomicAdmission: harness.port,
  });
  assert.equal((await wrongScope.respond({ method: "POST", path: "/v1/nostr/suggestions/admit", authorization: "token", body: admissionBody() })).status, 401);
  const control = service(harness.port);
  assert.equal((await control.respond({ method: "POST", path: "/v1/nostr/suggestions/admit", authorization: "steward-token", body: { ...admissionBody(), actorBinding: { actorClass: "case_steward" } } })).status, 400);
  assert.equal((await control.respond({ method: "POST", path: "/v1/nostr/suggestions/admit", authorization: "steward-token", body: { ...admissionBody(), expectedCaseVersion: 0 } })).status, 400);
  assert.equal((await control.respond({ method: "POST", path: "/v1/nostr/suggestions/admit", authorization: "steward-token", body: { ...admissionBody(), idempotencyKey: "caller-selected" } })).status, 400);
});

test("authentication precedes body cloning, trust roots are snapshotted, and internal errors are redacted", async () => {
  const harness = atomicHarness();
  const allowlist = [AGENT_PUBKEY];
  const control = service(harness.port, allowlist);
  allowlist[0] = "d".repeat(64);
  const hostileBody = new Proxy({}, { ownKeys() { throw new Error("body_inspected"); } });
  assert.equal((await control.respond({ method: "POST", path: "/v1/nostr/suggestions/admit", authorization: null, body: hostileBody })).status, 401);
  assert.equal((await control.respond({ method: "POST", path: "/v1/nostr/suggestions/admit", authorization: "steward-token", body: admissionBody() })).status, 200);

  const failing = service({ async admit() { throw new Error("postgres://secret@internal"); } });
  const unavailable = await failing.respond({ method: "POST", path: "/v1/nostr/suggestions/admit", authorization: "steward-token", body: admissionBody() });
  assert.equal(unavailable.status, 500);
  assert.equal(unavailable.body, "admission_unavailable\n");
  assert.doesNotMatch(unavailable.body, /postgres|secret|internal/u);
});
