import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { finalizeEvent } from "nostr-tools/pure";

import {
  createPermanentCoordinatorRuntime,
  type PermanentCoordinatorRuntimeConfig,
} from "../src/permanent-coordinator-runtime.ts";
import type { CitizenSignedSuggestionV1 } from "../src/citizen-suggestion.ts";

const municipalityId = "roebel-mueritz";
const sourceCaseId = "marienfelder-strasse";
const canonicalCaseId = "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001";
const policyVersion = "roebel-permanent-v1";
const departments = ["planning", "traffic", "environment", "finance", "legal", "public-order", "social-affairs", "public-works"] as const;
const citizenSecret = new Uint8Array(32).fill(41);
const meckySecret = new Uint8Array(32).fill(42);

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

function actorRegistrations() {
  return [
    { actorId: "roebel:nostr-ingestor", actorClass: "citizen" as const },
    { actorId: "roebel:case-steward", actorClass: "case_steward" as const },
    { actorId: "roebel:public-reader", actorClass: "public" as const },
    { actorId: "roebel:administration-reader", actorClass: "administration" as const },
    { actorId: "roebel:council-reader", actorClass: "council" as const },
    { actorId: "roebel:participation-reviewer", actorClass: "participation_reviewer" as const },
    ...departments.flatMap((departmentId) => [
      { actorId: `roebel:${departmentId}:agent`, actorClass: "department_agent" as const, departmentId },
      { actorId: `roebel:${departmentId}:reviewer`, actorClass: "department_reviewer" as const, departmentId },
    ]),
  ];
}

function discussion() {
  const meckyPubkey = finalizeEvent({ kind: 1, created_at: 1, tags: [], content: "key" }, meckySecret).pubkey;
  return finalizeEvent({
    kind: 1,
    created_at: 1_786_454_400,
    tags: [
      ["p", meckyPubkey],
      ["t", "stadtstack-civic-discussion"],
      ["municipality", municipalityId],
      ["case", sourceCaseId],
      ["stadtstack-case", canonicalCaseId],
    ],
    content: "@Mecky Wie kann die Querung der Marienfelder Straße sicherer werden?",
  }, citizenSecret);
}

function discussionWithArgumentTreeRoot() {
  const meckyPubkey = finalizeEvent({ kind: 1, created_at: 1, tags: [], content: "key" }, meckySecret).pubkey;
  return finalizeEvent({
    kind: 1,
    created_at: 1_786_454_410,
    tags: [
      ["p", meckyPubkey],
      ["t", "stadtstack-civic-discussion"],
      ["municipality", municipalityId],
      ["case", sourceCaseId],
      ["stadtstack-case", canonicalCaseId],
      ["stance", "root"],
      ["argument-root", "self"],
    ],
    content: "@Mecky Welche geprüften Informationen gehören in diesen Pro/Contra-Baum?",
  }, citizenSecret);
}

function answer(sourceDiscussion: ReturnType<typeof discussion>) {
  const receiptId = `urn:stadtstack:mecky-answer:${"b".repeat(64)}`;
  return finalizeEvent({
    kind: 1,
    created_at: sourceDiscussion.created_at + 10,
    tags: [
      ["netizen_agent", "mecky", "roebel"],
      ["e", sourceDiscussion.id, "", "reply"],
      ["p", sourceDiscussion.pubkey],
      ["mecky-receipt", receiptId],
      ["municipality", municipalityId],
      ["case", sourceCaseId],
      ["stadtstack-case", canonicalCaseId],
      ["evidence", `sha256:${"a".repeat(64)}`, "https://roebel.app/mitmachen/marienfelder-strasse"],
    ],
    content: "Geprüfte Hinweise sprechen für eine sichere Querungsvariante; eine amtliche Entscheidung ist das nicht.\n\nGeprüfte Quelle: Öffentliche Falldokumentation.",
  }, meckySecret);
}

function signedSuggestion(sourceDiscussion: ReturnType<typeof discussion>, sourceAnswer: ReturnType<typeof answer>): CitizenSignedSuggestionV1 {
  const receiptId = sourceAnswer.tags.find((tag) => tag[0] === "mecky-receipt")![1]!;
  const core = {
    sourceAnswerReceiptId: receiptId,
    sourceDiscussionId: sourceDiscussion.id,
    sourceDiscussionRef: `nostr://event/${sourceDiscussion.id}`,
    municipalityId,
    sourceCaseId,
    caseId: canonicalCaseId,
    citizenPubkey: sourceDiscussion.pubkey,
    title: "Sichere Querung prüfen",
    summary: "Die Stadt soll geprüfte Varianten für eine sichere Querung öffentlich abwägen.",
  };
  const draft = {
    schemaVersion: "public_mecky_suggestion_draft_v1" as const,
    draftId: `urn:stadtstack:suggestion-draft:${sha256(core).slice("sha256:".length)}`,
    ...core,
    entryState: "citizen_signature_required" as const,
    authorityBinding: "none" as const,
    submittedToCivicWorkflow: false as const,
  };
  const event = finalizeEvent({
    kind: 1,
    created_at: sourceAnswer.created_at + 10,
    tags: [
      ["schema", "citizen_signed_suggestion_v1"],
      ["municipality", municipalityId],
      ["case", sourceCaseId],
      ["e", sourceDiscussion.id, "", "root"],
      ["mecky-receipt", receiptId],
    ],
    content: JSON.stringify(draft),
  }, citizenSecret);
  return {
    schemaVersion: "citizen_signed_suggestion_v1",
    candidateId: `urn:stadtstack:signed-suggestion:${event.id}`,
    signerPubkey: event.pubkey,
    draft,
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

function runtimeConfig(rootDir: string): PermanentCoordinatorRuntimeConfig {
  const meckyPubkey = finalizeEvent({ kind: 1, created_at: 1, tags: [], content: "key" }, meckySecret).pubkey;
  return {
    schemaVersion: "stadtstack_permanent_coordinator_runtime_v1",
    scope: { municipalityId, sourceCaseId },
    canonicalCaseId,
    policyVersion,
    journal: { rootDir, namespace: "roebel-workflow" },
    requiredDepartmentIds: [...departments],
    actors: actorRegistrations(),
    publicActor: { actorId: "roebel:public-reader", actorClass: "public" },
    publicMecky: { pubkey: meckyPubkey, agentName: "mecky", nodeId: "roebel" },
    municipality: { id: municipalityId, name: "Röbel/Müritz", state: "Mecklenburg-Vorpommern", country: "DE" },
    decisionCaseSlug: sourceCaseId,
    publicCasePath: "/kommunen/roebel-mueritz/entscheidungen/marienfelder-strasse",
    owner: { id: "stadt-roebel-mueritz", label: "Stadt Röbel/Müritz", kind: "municipal_body" },
    publicHttp: { bindHost: "127.0.0.1", port: 0, allowedHosts: ["127.0.0.1", "localhost"], allowedOrigins: ["https://roebel.app"] },
    controlHttp: { bindHost: "127.0.0.1", port: 0, allowedHosts: ["127.0.0.1", "localhost"], maxBodyBytes: 262_144 },
  };
}

function actorTokens() {
  return Object.fromEntries(actorRegistrations()
    .filter((actor) => !["public", "administration", "council"].includes(actor.actorClass))
    .map((actor, index) => [actor.actorId, `${index.toString().padStart(2, "0")}-${"x".repeat(40)}`]));
}

async function post(origin: string, path: string, actorId: string, token: string, value: unknown) {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-stadtstack-actor-id": actorId,
    },
    body: JSON.stringify(value),
  });
}

test("bridges a signed Röbel discussion and Mecky-backed citizen suggestion through distinct actor boundaries", async () => {
  const root = mkdtempSync(join(tmpdir(), "stadtstack-permanent-nostr-intake-"));
  const tokens = actorTokens();
  const runtime = createPermanentCoordinatorRuntime(runtimeConfig(root), { actorTokens: tokens, syntheticE2e: true });
  try {
    const address = await runtime.start();
    const origin = `http://${address.control.host}:${address.control.port}`;
    const sourceDiscussion = discussion();
    const sourceAnswer = answer(sourceDiscussion);
    const candidate = signedSuggestion(sourceDiscussion, sourceAnswer);

    const intake = await post(origin, "/v1/nostr/discussions", "roebel:nostr-ingestor", tokens["roebel:nostr-ingestor"]!, {
      event: sourceDiscussion,
      relayRefs: ["wss://relay.roebel.app"],
    });
    if (intake.status !== 200) throw new Error(await intake.text());
    assert.equal((await intake.json() as { caseVersion: number }).caseVersion, 2);

    const wrongActor = await post(origin, "/v1/nostr/suggestions/admit", "roebel:nostr-ingestor", tokens["roebel:nostr-ingestor"]!, {
      expectedCaseVersion: 2,
      sourceDiscussion,
      sourceAnswer,
      signedSuggestion: candidate,
    });
    assert.equal(wrongActor.status, 403);

    const forgedAnswer = finalizeEvent({ ...sourceAnswer, content: "Unbound answer" }, citizenSecret);
    const rejected = await post(origin, "/v1/nostr/suggestions/admit", "roebel:case-steward", tokens["roebel:case-steward"]!, {
      expectedCaseVersion: 2,
      sourceDiscussion,
      sourceAnswer: forgedAnswer,
      signedSuggestion: candidate,
    });
    assert.equal(rejected.status, 422);

    const controlCharacterAnswer = finalizeEvent({ ...sourceAnswer, content: "Geprüfte Antwort\rVerbotene Steuersequenz" }, meckySecret);
    const rejectedControlCharacter = await post(origin, "/v1/nostr/suggestions/admit", "roebel:case-steward", tokens["roebel:case-steward"]!, {
      expectedCaseVersion: 2,
      sourceDiscussion,
      sourceAnswer: controlCharacterAnswer,
      signedSuggestion: candidate,
    });
    assert.equal(rejectedControlCharacter.status, 422);

    const admitted = await post(origin, "/v1/nostr/suggestions/admit", "roebel:case-steward", tokens["roebel:case-steward"]!, {
      expectedCaseVersion: 2,
      sourceDiscussion,
      sourceAnswer,
      signedSuggestion: candidate,
    });
    if (admitted.status !== 200) throw new Error(await admitted.text());
    const receipt = await admitted.json() as { caseVersion: number };
    assert.equal(receipt.caseVersion, 3);

    const replay = await post(origin, "/v1/nostr/suggestions/admit", "roebel:case-steward", tokens["roebel:case-steward"]!, {
      expectedCaseVersion: 2,
      sourceDiscussion,
      sourceAnswer,
      signedSuggestion: candidate,
    });
    if (replay.status !== 200) throw new Error(await replay.text());
    assert.deepEqual(await replay.json(), receipt);

    const completed = await post(origin, "/v1/e2e/complete", "roebel:case-steward", tokens["roebel:case-steward"]!, {});
    if (completed.status !== 200) throw new Error(await completed.text());
    const completedReceipt = await completed.json() as {
      caseVersion: number;
      reviewedDepartmentCount: number;
      formalVoteStarted: boolean;
      externalPublication: boolean;
      projectionChecksums: Record<string, string>;
    };
    assert.equal(completedReceipt.caseVersion, 30);
    assert.equal(completedReceipt.reviewedDepartmentCount, 8);
    assert.equal(completedReceipt.formalVoteStarted, false);
    assert.equal(completedReceipt.externalPublication, false);
    assert.deepEqual(Object.keys(completedReceipt.projectionChecksums).sort(), ["administration", "council", "public"]);

    const completedReplay = await post(origin, "/v1/e2e/complete", "roebel:case-steward", tokens["roebel:case-steward"]!, {});
    assert.equal(completedReplay.status, 200);
    assert.deepEqual(await completedReplay.json(), completedReceipt);

    const [publicView, administrationView, councilView] = await Promise.all([
      post(origin, "/v1/e2e/view", "roebel:case-steward", tokens["roebel:case-steward"]!, { profile: "public" }),
      post(origin, "/v1/e2e/view", "roebel:case-steward", tokens["roebel:case-steward"]!, { profile: "administration" }),
      post(origin, "/v1/e2e/view", "roebel:case-steward", tokens["roebel:case-steward"]!, { profile: "council" }),
    ]);
    assert.deepEqual([publicView.status, administrationView.status, councilView.status], [200, 200, 200]);
    const [publicJson, administrationJson, councilJson] = await Promise.all([publicView.json(), administrationView.json(), councilView.json()]);
    assert.doesNotMatch(JSON.stringify(publicJson), /privateEvidenceRefs|assignedAgentActorId|reviewerActorId/);
    assert.match(JSON.stringify(administrationJson), /privateEvidenceRefs/);
    assert.doesNotMatch(JSON.stringify(councilJson), /privateEvidenceRefs|assignedAgentActorId|reviewerActorId/);
  } finally {
    await runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects unknown intake fields and a Mecky key that is not the configured public identity", async () => {
  const root = mkdtempSync(join(tmpdir(), "stadtstack-permanent-nostr-negative-"));
  const tokens = actorTokens();
  const runtime = createPermanentCoordinatorRuntime(runtimeConfig(root), { actorTokens: tokens });
  try {
    const address = await runtime.start();
    const origin = `http://${address.control.host}:${address.control.port}`;
    const sourceDiscussion = discussion();
    const unknown = await post(origin, "/v1/nostr/discussions", "roebel:nostr-ingestor", tokens["roebel:nostr-ingestor"]!, {
      event: sourceDiscussion,
      relayRefs: [],
      autoAdmit: true,
    });
    assert.equal(unknown.status, 422);

    const wrongMecky = finalizeEvent({
      ...sourceDiscussion,
      tags: sourceDiscussion.tags.map((tag) => tag[0] === "p" ? ["p", "f".repeat(64)] : [...tag]),
    }, citizenSecret);
    const rejected = await post(origin, "/v1/nostr/discussions", "roebel:nostr-ingestor", tokens["roebel:nostr-ingestor"]!, {
      event: wrongMecky,
      relayRefs: [],
    });
    assert.equal(rejected.status, 422);
  } finally {
    await runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("admits the exact signed discussion root used by the Röbel pro/con feed", async () => {
  const root = mkdtempSync(join(tmpdir(), "stadtstack-permanent-nostr-tree-root-"));
  const tokens = actorTokens();
  const runtime = createPermanentCoordinatorRuntime(runtimeConfig(root), { actorTokens: tokens });
  try {
    const address = await runtime.start();
    const response = await post(
      `http://${address.control.host}:${address.control.port}`,
      "/v1/nostr/discussions",
      "roebel:nostr-ingestor",
      tokens["roebel:nostr-ingestor"]!,
      { event: discussionWithArgumentTreeRoot(), relayRefs: ["wss://relay.roebel.app"] },
    );
    const responseBody = await response.json() as { caseVersion?: number; error?: string };
    assert.equal(response.status, 200, JSON.stringify(responseBody));
    assert.equal(responseBody.caseVersion, 2);
  } finally {
    await runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});
