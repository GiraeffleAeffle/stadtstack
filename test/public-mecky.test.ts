import assert from "node:assert/strict";
import test from "node:test";

import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

import type { CompanionRuntime, CompanionTask } from "../src/companion-runtime.ts";
import type {
  CompanionHarnessAdapter,
  WorkerResultV1,
} from "../src/adapters/companion-harness.ts";
import type { DiscussionArtifact } from "../src/adapters/discussion-adapter.ts";
import { createPublicMecky } from "../src/public-mecky.ts";

const CITATION_REF = "https://roebel.example/reviewed/crossing-safety";
const CASE_ID = "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001";
const CHECKSUM = `sha256:${"a".repeat(64)}`;
const DISCUSSION_SECRET = new Uint8Array(32).fill(7);
const BASE_DISCUSSION_EVENT = finalizeEvent({
  kind: 1,
  created_at: 1_786_204_800,
  content: "@Mecky Which crossing measure is supported by the reviewed material?",
  tags: [
    ["municipality", "roebel-mueritz"],
    ["case", "marienfelder-strasse"],
  ],
}, DISCUSSION_SECRET);
const DISCUSSION_ID = BASE_DISCUSSION_EVENT.id;

function discussion(content = "@Mecky Which crossing measure is supported by the reviewed material?"): DiscussionArtifact {
  const event = content === BASE_DISCUSSION_EVENT.content
    ? BASE_DISCUSSION_EVENT
    : finalizeEvent({
        kind: 1,
        created_at: 1_786_204_800,
        content,
        tags: [
          ["municipality", "roebel-mueritz"],
          ["case", "marienfelder-strasse"],
        ],
      }, DISCUSSION_SECRET);
  return {
    schemaVersion: "discussion_artifact_v1",
    id: event.id,
    source: "nostr",
    sourceRef: `nostr://event/${event.id}`,
    municipalityId: "roebel-mueritz",
    caseId: "marienfelder-strasse",
    authorityBinding: "none",
    verificationProof: {
      kind: "nostr_nip01",
      verified: true,
      signature: event.sig,
    },
    event: {
      id: event.id,
      pubkey: event.pubkey,
      createdAt: event.created_at,
      kind: event.kind,
      content: event.content,
      tags: event.tags.map((tag) => [...tag]),
      relayRefs: [],
    },
  };
}

function publicTask(question: string, sourceDiscussion = discussion()): CompanionTask {
  return {
    profile: "public",
    question,
    workerIdentity: "did:stadtstack:roebel:mecky-public",
    sessionKey: "session:public:marienfelder-strasse",
    caseId: CASE_ID,
    policyVersion: "case-intake-v1",
    allowedTools: [],
    prohibitedEffects: [
      "approve",
      "change_case_stage",
      "publish",
      "submit_to_council",
      "vote",
      "write_source",
      "write_nostr",
      "invoke_tool",
    ],
    context: {
      schemaVersion: "case_projection_v1",
      profile: "public",
      visibility: "public_reviewed",
      municipalityId: "roebel-mueritz",
      caseId: CASE_ID,
      caseVersion: 28,
      journalHeadChecksum: CHECKSUM,
      projectionChecksum: CHECKSUM,
      policyVersion: "case-intake-v1",
      citations: [sourceDiscussion.sourceRef, CITATION_REF],
      artifactBindings: [],
      jurisdiction: { scheme: "municipality", value: "roebel-mueritz" },
      sourceScope: {
        municipalityId: "roebel-mueritz",
        caseId: "marienfelder-strasse",
      },
      authorityBinding: "none",
      formalDecision: null,
      discussion: {
        id: sourceDiscussion.id,
        sourceRef: sourceDiscussion.sourceRef,
        content: sourceDiscussion.event.content,
        event: {
          id: sourceDiscussion.event.id,
          pubkey: sourceDiscussion.event.pubkey,
        },
      },
      reviewedCitizenBrief: {
        schemaVersion: "citizen_brief_projection_v1",
        id: "brief-marienfelder-strasse",
        title: "Reviewed citizen brief for Marienfelder Straße",
        summary: "Reviewed information supports a safer marked crossing.",
        responses: [
          {
            departmentId: "traffic",
            publicSummary: "The reviewed traffic response supports a safer marked crossing.",
            publicCitations: [CITATION_REF],
          },
        ],
        provenance: {
          sourceDiscussionRef: {
            type: "nostr_event",
            id: sourceDiscussion.id,
            ref: sourceDiscussion.sourceRef,
          },
          suggestionId: `urn:stadtstack:suggestion:${sourceDiscussion.id}`,
          packageBindings: [],
        },
        policyVersion: "case-intake-v1",
        correctionState: "current",
        briefChecksum: CHECKSUM,
        authorityBinding: "none",
      },
    } as never,
  };
}

function workerResult(task: CompanionTask): WorkerResultV1 {
  const direct = task.context as unknown as Record<string, unknown>;
  const projection = (direct.projection ?? direct) as Record<string, unknown>;
  const projectedDiscussion = projection.discussion as Record<string, unknown>;
  const discussionRef = projectedDiscussion.sourceRef as string;
  return {
    schemaVersion: "worker_result_v1",
    status: "completed",
    taskId: "worker-task:fixture",
    caseId: CASE_ID,
    sessionKey: task.sessionKey!,
    profile: "public",
    identity: {
      id: "did:stadtstack:roebel:mecky-public",
      profile: "public",
    },
    contextChecksum: CHECKSUM,
    answer: JSON.stringify({
      schemaVersion: "public_mecky_answer_draft_v1",
      answer: "The reviewed traffic response supports a safer marked crossing.",
      facts: [
        {
          text: "A citizen explicitly asked Mecky about a safer crossing measure.",
          citationRefs: [discussionRef],
        },
        {
          text: "The reviewed traffic response supports a safer marked crossing.",
          citationRefs: [CITATION_REF],
        },
      ],
      uncertainty: ["The material does not yet establish a construction date."],
      reasoningSummary: ["The answer uses the current reviewed traffic response."],
      suggestion: {
        title: "Review a safer marked crossing",
        summary: "Ask the city to review a safer marked crossing on Marienfelder Straße.",
      },
    }),
    citations: [
      { ref: discussionRef },
      { ref: CITATION_REF },
    ],
    artifactBindings: [
      { ref: discussionRef, checksum: CHECKSUM },
      { ref: CITATION_REF, checksum: CHECKSUM },
    ],
    aiAttribution: {
      schemaVersion: "ai_attribution_v1",
      kind: "agent_contribution",
      workerIdentityId: "did:stadtstack:roebel:mecky-public",
      profile: "public",
      adapterKind: "deterministic-local",
      authorityBinding: "none",
    },
    allowedTools: [],
    tools: { mode: "default-deny", allow: [], deny: ["*"] },
    prohibitedEffects: [...task.prohibitedEffects],
    limits: { maxOutputTokens: 512, timeoutMs: 5_000, maxCostUsd: 0 },
  };
}

test("an explicit public @Mecky invocation returns a cited answer and unsigned citizen draft", async () => {
  let prepared = 0;
  let called = 0;
  const runtime: CompanionRuntime = {
    prepareTask(request) {
      prepared += 1;
      assert.deepEqual(request, {
        profile: "public",
        question: "Which crossing measure is supported by the reviewed material?",
      });
      return publicTask(request.question);
    },
  };
  const worker: CompanionHarnessAdapter = {
    kind: "deterministic-local",
    async run(task) {
      called += 1;
      return workerResult(task);
    },
  };
  const mecky = createPublicMecky({ runtime, worker });

  const turn = await mecky.answer({
    schemaVersion: "public_mecky_request_v1",
    invocation: "discussion",
    discussion: discussion(),
  });

  assert.equal(prepared, 1);
  assert.equal(called, 1);
  assert.equal(turn.status, "answered");
  if (turn.status !== "answered") throw new Error("expected_answered_turn");
  assert.equal(turn.answer.text, "The reviewed traffic response supports a safer marked crossing.");
  assert.deepEqual(turn.answer.facts.map((fact) => fact.citationRefs), [
    [`nostr://event/${DISCUSSION_ID}`],
    [CITATION_REF],
  ]);
  assert.deepEqual(turn.answer.uncertainty, ["The material does not yet establish a construction date."]);
  assert.deepEqual(turn.answer.reasoningSummary, ["The answer uses the current reviewed traffic response."]);
  assert.deepEqual(turn.citations, [
    {
      ref: CITATION_REF,
      kind: "reviewed_public_artifact",
      label: "Reviewed traffic response",
      excerpt: "The reviewed traffic response supports a safer marked crossing.",
      attributedTo: null,
    },
    {
      ref: `nostr://event/${DISCUSSION_ID}`,
      kind: "public_discussion",
      label: "Public discussion contribution",
      excerpt: BASE_DISCUSSION_EVENT.content,
      attributedTo: BASE_DISCUSSION_EVENT.pubkey,
    },
  ]);
  assert.equal(turn.suggestionDraft.entryState, "citizen_signature_required");
  assert.equal(turn.suggestionDraft.authorityBinding, "none");
  assert.equal(turn.suggestionDraft.submittedToCivicWorkflow, false);
  assert.equal(turn.receipt.workerIdentityId, "did:stadtstack:roebel:mecky-public");
  assert.deepEqual(turn.receipt.usedCitationRefs, [CITATION_REF, `nostr://event/${DISCUSSION_ID}`].sort());
  assert.equal(turn.receipt.administrationAnswerReviewRequired, false);
  assert.equal(turn.receipt.authorityBinding, "none");
  assert.deepEqual(turn.receipt.effects, {
    privateToolAccess: false,
    civicStateMutation: false,
    publication: false,
    suggestionSubmission: false,
    vote: false,
  });
});

test("ordinary discussion remains untouched without an explicit Mecky trigger", async () => {
  let calls = 0;
  const mecky = createPublicMecky({
    runtime: {
      prepareTask() {
        calls += 1;
        throw new Error("runtime_must_not_be_called");
      },
    },
    worker: {
      async run() {
        calls += 1;
        throw new Error("worker_must_not_be_called");
      },
    },
  });

  const turn = await mecky.answer({
    schemaVersion: "public_mecky_request_v1",
    invocation: "discussion",
    discussion: discussion("Which crossing measure is supported by the reviewed material?"),
  });

  assert.deepEqual(turn, {
    schemaVersion: "public_mecky_turn_v1",
    status: "not_invoked",
    reason: "explicit_trigger_required",
    authorityBinding: "none",
  });
  assert.equal(calls, 0);
});

test("the explicit ask-Mecky button invokes the same bounded public path", async () => {
  let preparedQuestion = "";
  const sourceDiscussion = discussion("The crossing feels unsafe after dark.");
  const mecky = createPublicMecky({
    runtime: {
      prepareTask(request) {
        preparedQuestion = request.question;
        return publicTask(request.question, sourceDiscussion);
      },
    },
    worker: { async run(task) { return workerResult(task); } },
  });

  const turn = await mecky.answer({
    schemaVersion: "public_mecky_request_v1",
    invocation: "button",
    discussion: sourceDiscussion,
    question: "Which reviewed measures address this concern?",
  });

  assert.equal(turn.status, "answered");
  assert.equal(preparedQuestion, "Which reviewed measures address this concern?");
});

test("only the citizen signs an edited suggestion before human case admission", async () => {
  const citizenSecret = DISCUSSION_SECRET;
  const citizenPubkey = getPublicKey(citizenSecret);
  const sourceDiscussion = discussion();
  const mecky = createPublicMecky({
    runtime: { prepareTask: (request) => publicTask(request.question) },
    worker: {
      async run(task) {
        return workerResult(task);
      },
    },
  });
  const turn = await mecky.answer({
    schemaVersion: "public_mecky_request_v1",
    invocation: "discussion",
    discussion: sourceDiscussion,
  });
  assert.equal(turn.status, "answered");
  if (turn.status !== "answered") throw new Error("expected_answered_turn");

  const signingRequest = mecky.prepareSuggestion({
    turn,
    edits: {
      title: "Review a safer crossing on Marienfelder Straße",
      summary: "Please review a safer marked crossing and publish the assessed options.",
    },
    createdAt: 1_786_204_860,
  });
  assert.equal(signingRequest.citizenPubkey, citizenPubkey);
  assert.equal(signingRequest.draft.title, "Review a safer crossing on Marienfelder Straße");
  assert.equal(signingRequest.draft.entryState, "citizen_signature_required");
  assert.equal(signingRequest.unsignedEvent.kind, 1);
  assert.equal(signingRequest.unsignedEvent.content, JSON.stringify(signingRequest.draft));

  const event = finalizeEvent(structuredClone(signingRequest.unsignedEvent), citizenSecret);
  const candidate = mecky.acceptSignedSuggestion({ turn, signingRequest, event });

  assert.equal(candidate.schemaVersion, "citizen_signed_suggestion_v1");
  assert.equal(candidate.signerPubkey, citizenPubkey);
  assert.equal(candidate.verification.verified, true);
  assert.equal(candidate.entryState, "awaiting_human_case_admission");
  assert.equal(candidate.authorityBinding, "none");
  assert.equal(candidate.submittedToCivicWorkflow, false);
  assert.equal(candidate.event.id, event.id);
  assert.equal(candidate.draft.sourceAnswerReceiptId, turn.receipt.receiptId);
  assert.deepEqual(Object.keys(mecky).sort(), ["acceptSignedSuggestion", "answer", "prepareSuggestion"]);
});

test("a forged discussion proof fails closed before the worker runs", async () => {
  let workerCalls = 0;
  const forged = discussion();
  if (forged.verificationProof.kind !== "nostr_nip01") throw new Error("expected_nostr_proof");
  forged.verificationProof.signature = "0".repeat(128);
  const mecky = createPublicMecky({
    runtime: { prepareTask: (request) => publicTask(request.question) },
    worker: {
      async run(task) {
        workerCalls += 1;
        return workerResult(task);
      },
    },
  });

  const turn = await mecky.answer({
    schemaVersion: "public_mecky_request_v1",
    invocation: "discussion",
    discussion: forged,
  });

  assert.equal(turn.status, "unavailable");
  assert.equal(workerCalls, 0);
});

test("administration-only evidence in a public projection is rejected before generation", async () => {
  let workerCalls = 0;
  const mecky = createPublicMecky({
    runtime: {
      prepareTask(request) {
        const task = publicTask(request.question);
        const projection = task.context as unknown as Record<string, unknown>;
        const brief = projection.reviewedCitizenBrief as { responses: Array<Record<string, unknown>> };
        brief.responses[0]!.privateEvidenceRefs = ["private://traffic/raw-assessment"];
        return task;
      },
    },
    worker: {
      async run(task) {
        workerCalls += 1;
        return workerResult(task);
      },
    },
  });

  const turn = await mecky.answer({
    schemaVersion: "public_mecky_request_v1",
    invocation: "discussion",
    discussion: discussion(),
  });

  assert.equal(turn.status, "unavailable");
  assert.equal(workerCalls, 0);
});

test("the signed discussion must be the exact discussion in the public case projection", async () => {
  let workerCalls = 0;
  const mecky = createPublicMecky({
    runtime: {
      prepareTask(request) {
        const task = publicTask(request.question);
        const projection = task.context as unknown as Record<string, unknown>;
        const projectedDiscussion = projection.discussion as Record<string, unknown>;
        projectedDiscussion.id = "f".repeat(64);
        projectedDiscussion.sourceRef = `nostr://event/${"f".repeat(64)}`;
        return task;
      },
    },
    worker: {
      async run(task) {
        workerCalls += 1;
        return workerResult(task);
      },
    },
  });

  const turn = await mecky.answer({
    schemaVersion: "public_mecky_request_v1",
    invocation: "discussion",
    discussion: discussion(),
  });

  assert.equal(turn.status, "unavailable");
  assert.equal(workerCalls, 0);
});

test("missing, stale, and conflicting reviewed evidence fail closed before generation", async (context) => {
  const cases = [
    {
      name: "missing brief",
      expected: "insufficient_evidence",
      mutate(projection: Record<string, unknown>) {
        delete projection.reviewedCitizenBrief;
      },
    },
    {
      name: "stale brief",
      expected: "stale_evidence",
      mutate(projection: Record<string, unknown>) {
        (projection.reviewedCitizenBrief as Record<string, unknown>).correctionState = "invalidated";
      },
    },
    {
      name: "conflicting citation",
      expected: "conflicting_evidence",
      mutate(projection: Record<string, unknown>) {
        const brief = projection.reviewedCitizenBrief as { responses: Array<Record<string, unknown>> };
        brief.responses.push({
          departmentId: "planning",
          publicSummary: "A different reviewed conclusion.",
          publicCitations: [CITATION_REF],
        });
      },
    },
  ];

  for (const fixture of cases) {
    await context.test(fixture.name, async () => {
      let workerCalls = 0;
      const mecky = createPublicMecky({
        runtime: {
          prepareTask(request) {
            const task = publicTask(request.question);
            fixture.mutate(task.context as unknown as Record<string, unknown>);
            return task;
          },
        },
        worker: {
          async run(task) {
            workerCalls += 1;
            return workerResult(task);
          },
        },
      });

      const turn = await mecky.answer({
        schemaVersion: "public_mecky_request_v1",
        invocation: "discussion",
        discussion: discussion(),
      });

      assert.equal(turn.status, "unavailable");
      if (turn.status !== "unavailable") throw new Error("expected_unavailable_turn");
      assert.equal(turn.reason, fixture.expected);
      assert.equal(workerCalls, 0);
    });
  }
});

test("an answer without a reviewed citation or with an unknown citation fails closed", async (context) => {
  const cases = [
    {
      name: "discussion-only answer",
      mutate(result: WorkerResultV1) {
        const answer = JSON.parse(result.answer) as Record<string, unknown>;
        answer.facts = [{
          text: "A citizen asked a question.",
          citationRefs: [`nostr://event/${DISCUSSION_ID}`],
        }];
        result.answer = JSON.stringify(answer);
      },
    },
    {
      name: "unknown citation",
      mutate(result: WorkerResultV1) {
        const answer = JSON.parse(result.answer) as { facts: Array<Record<string, unknown>> };
        answer.facts[1]!.citationRefs = ["https://unreviewed.example/claim"];
        result.answer = JSON.stringify(answer);
      },
    },
  ];

  for (const fixture of cases) {
    await context.test(fixture.name, async () => {
      const mecky = createPublicMecky({
        runtime: { prepareTask: (request) => publicTask(request.question) },
        worker: {
          async run(task) {
            const result = workerResult(task);
            fixture.mutate(result);
            return result;
          },
        },
      });
      const turn = await mecky.answer({
        schemaVersion: "public_mecky_request_v1",
        invocation: "discussion",
        discussion: discussion(),
      });
      assert.equal(turn.status, "unavailable");
      if (turn.status !== "unavailable") throw new Error("expected_unavailable_turn");
      assert.equal(turn.reason, "answer_unavailable");
    });
  }
});

test("a signature from anyone except the discussion author is rejected", async () => {
  const mecky = createPublicMecky({
    runtime: { prepareTask: (request) => publicTask(request.question) },
    worker: { async run(task) { return workerResult(task); } },
  });
  const turn = await mecky.answer({
    schemaVersion: "public_mecky_request_v1",
    invocation: "discussion",
    discussion: discussion(),
  });
  if (turn.status !== "answered") throw new Error("expected_answered_turn");
  const signingRequest = mecky.prepareSuggestion({
    turn,
    edits: {
      title: turn.suggestionDraft.title,
      summary: turn.suggestionDraft.summary,
    },
    createdAt: 1_786_204_860,
  });
  const otherCitizen = new Uint8Array(32).fill(9);
  const event = finalizeEvent(structuredClone(signingRequest.unsignedEvent), otherCitizen);

  assert.throws(
    () => mecky.acceptSignedSuggestion({ turn, signingRequest, event }),
    /public_mecky_signature_binding_invalid/,
  );
});

test("suggestion signing rejects a forged Mecky receipt before creating a request", async () => {
  const mecky = createPublicMecky({
    runtime: { prepareTask: (request) => publicTask(request.question) },
    worker: { async run(task) { return workerResult(task); } },
  });
  const turn = await mecky.answer({
    schemaVersion: "public_mecky_request_v1",
    invocation: "discussion",
    discussion: discussion(),
  });
  if (turn.status !== "answered") throw new Error("expected_answered_turn");
  const forged = structuredClone(turn);
  forged.receipt.projectionChecksum = `sha256:${"b".repeat(64)}`;

  assert.throws(
    () => mecky.prepareSuggestion({
      turn: forged,
      edits: { title: forged.suggestionDraft.title, summary: forged.suggestionDraft.summary },
      createdAt: 1_786_204_860,
    }),
    /public_mecky_answer_receipt_invalid/,
  );
});

test("worker identity, role, case, context, and citation metadata remain bound", async (context) => {
  const cases = [
    {
      name: "wrong role",
      mutate(result: WorkerResultV1) { result.profile = "administration"; },
    },
    {
      name: "wrong case",
      mutate(result: WorkerResultV1) { result.caseId = `${CASE_ID}:other`; },
    },
    {
      name: "wrong identity",
      mutate(result: WorkerResultV1) { result.aiAttribution.workerIdentityId = "did:stadtstack:roebel:mecky-administration"; },
    },
    {
      name: "missing reviewed citation metadata",
      mutate(result: WorkerResultV1) {
        result.citations = result.citations.filter((citation) => citation.ref !== CITATION_REF);
        result.artifactBindings = result.artifactBindings.filter((binding) => binding.ref !== CITATION_REF);
      },
    },
  ];

  for (const fixture of cases) {
    await context.test(fixture.name, async () => {
      const mecky = createPublicMecky({
        runtime: { prepareTask: (request) => publicTask(request.question) },
        worker: {
          async run(task) {
            const result = workerResult(task);
            fixture.mutate(result);
            return result;
          },
        },
      });
      const turn = await mecky.answer({
        schemaVersion: "public_mecky_request_v1",
        invocation: "discussion",
        discussion: discussion(),
      });
      assert.equal(turn.status, "unavailable");
    });
  }
});

test("unknown fields, accessors, and proxies fail closed before any dependency call", async (context) => {
  await context.test("unknown field", async () => {
    let calls = 0;
    const mecky = createPublicMecky({
      runtime: { prepareTask() { calls += 1; throw new Error("unexpected_runtime_call"); } },
      worker: { async run() { calls += 1; throw new Error("unexpected_worker_call"); } },
    });
    const request = {
      schemaVersion: "public_mecky_request_v1",
      invocation: "discussion",
      discussion: discussion(),
      privateTool: "administration-search",
    } as never;
    const turn = await mecky.answer(request);
    assert.equal(turn.status, "unavailable");
    assert.equal(calls, 0);
  });

  await context.test("accessor", async () => {
    let getterCalls = 0;
    let dependencyCalls = 0;
    const request = {
      schemaVersion: "public_mecky_request_v1",
      invocation: "discussion",
      get discussion() {
        getterCalls += 1;
        return discussion();
      },
    } as never;
    const mecky = createPublicMecky({
      runtime: { prepareTask() { dependencyCalls += 1; throw new Error("unexpected_runtime_call"); } },
      worker: { async run() { dependencyCalls += 1; throw new Error("unexpected_worker_call"); } },
    });
    const turn = await mecky.answer(request);
    assert.equal(turn.status, "unavailable");
    assert.equal(getterCalls, 0);
    assert.equal(dependencyCalls, 0);
  });

  await context.test("proxy", async () => {
    let trapCalls = 0;
    let dependencyCalls = 0;
    const request = new Proxy({
      schemaVersion: "public_mecky_request_v1" as const,
      invocation: "discussion" as const,
      discussion: discussion(),
    }, {
      getPrototypeOf() { trapCalls += 1; throw new Error("proxy_trap"); },
      ownKeys() { trapCalls += 1; throw new Error("proxy_trap"); },
      get() { trapCalls += 1; throw new Error("proxy_trap"); },
    });
    const mecky = createPublicMecky({
      runtime: { prepareTask() { dependencyCalls += 1; throw new Error("unexpected_runtime_call"); } },
      worker: { async run() { dependencyCalls += 1; throw new Error("unexpected_worker_call"); } },
    });
    const turn = await mecky.answer(request);
    assert.equal(turn.status, "unavailable");
    assert.equal(trapCalls, 0);
    assert.equal(dependencyCalls, 0);
  });
});
