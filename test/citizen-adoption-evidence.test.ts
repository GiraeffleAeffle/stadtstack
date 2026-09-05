import assert from "node:assert/strict";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { finalizeEvent, getEventHash, type Event as NostrEvent } from "nostr-tools/pure";

import {
  createCitizenAdoptionEvidenceVerifier,
  type CitizenAdoptionEvidencePolicy,
} from "../src/citizen-adoption-evidence.ts";

type Proof = { algorithm: string; keyId: string; signature: string };
type Status = { statusCore: Record<string, unknown>; statusChecksum: string; proof: Proof };
type Vector = {
  verifiedAt: number;
  policy: CitizenAdoptionEvidencePolicy;
  bundle: {
    schemaVersion: string;
    sourceDiscussion: NostrEvent;
    sourceAnswer: NostrEvent;
    participantSuggestionEvent: NostrEvent;
    adoptionEvent: NostrEvent;
    eligibilityReceipt: {
      schemaVersion: string;
      eligibilityCore: Record<string, unknown>;
      receiptId: string;
      payloadChecksum: string;
      statusRef: string;
      proof: Proof;
    };
  };
  adoptionAcceptance: Record<string, unknown>;
  signedStatusVector: Status;
};
const vectorJson = readFileSync(new URL("./fixtures/citizen-adoption-roebel-v1.json", import.meta.url), "utf8");
const fixture = (): Vector => JSON.parse(vectorJson) as Vector;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
const checksum = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

// Deliberately public synthetic seeds. Never read issuer or wallet material.
function issuerProof(input: unknown, seed = 84): Proof {
  const key = createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, seed)]),
    format: "der", type: "pkcs8",
  });
  return { algorithm: "Ed25519", keyId: "example-issuer-key-v1", signature: sign(null, Buffer.from(canonical(input)), key).toString("base64url") };
}
function status(v: Vector, nonce: string, changes: Record<string, unknown> = {}): Status {
  const statusCore = { ...v.signedStatusVector.statusCore, requestNonce: nonce, ...changes };
  const statusChecksum = checksum(statusCore);
  return { statusCore, statusChecksum, proof: issuerProof({
    domain: "municipal-civic-eligibility-status/v1", schemaVersion: "municipal_civic_eligibility_status_v1", statusChecksum,
  }) };
}
function reSign(event: NostrEvent, seed: number): NostrEvent {
  return JSON.parse(JSON.stringify(finalizeEvent({
    kind: event.kind, created_at: event.created_at, content: event.content, tags: event.tags,
  }, new Uint8Array(32).fill(seed)))) as NostrEvent;
}
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json; charset=utf-8" } });
const nonceOf = (options?: RequestInit) => new Headers(options?.headers).get("x-stadtstack-status-nonce")!;

function harness(v = fixture(), changes: Partial<Parameters<typeof createCitizenAdoptionEvidenceVerifier>[0]> = {}) {
  const reads: Array<{ adoptionEventId: string; signal: AbortSignal }> = [];
  const requests: Array<{ url: string; options?: RequestInit }> = [];
  const verifier = createCitizenAdoptionEvidenceVerifier({
    policy: v.policy, now: () => new Date(v.verifiedAt * 1_000),
    acceptance: { resolve: async (input) => { reads.push(input); return v.adoptionAcceptance; } },
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      return response(status(v, nonceOf(options)));
    },
    ...changes,
  });
  return { v, reads, requests, verifier };
}

test("verifies a Röbel-generated adoption, trusted acceptance and independently signed fresh status", async () => {
  const h = harness();
  const verified = await h.verifier.verify(h.v.bundle);
  assert.deepEqual(verified.bundle, h.v.bundle);
  assert.deepEqual(verified.adoptionAcceptance, h.v.adoptionAcceptance);
  assert.equal(verified.authorityBinding, "none");
  assert.equal(verified.verifiedAt, h.v.verifiedAt);
  assert.equal(verified.validUntil, h.v.verifiedAt + h.v.policy.statusMaxAgeSeconds);
  assert.ok(Object.isFrozen(verified.bundle.adoptionEvent.tags[0]));
  assert.ok(Object.isFrozen(verified.adoptionAcceptance));
  assert.ok(Object.isFrozen(verified.eligibilityStatus.statusCore));
  // Original acceptance was timely; later verification does not reapply event skew.
  assert.ok(h.v.verifiedAt - h.v.bundle.adoptionEvent.created_at > h.v.policy.maxEventClockSkewSeconds);
  assert.equal(h.reads.length, 1);
  assert.equal(h.reads[0]!.adoptionEventId, h.v.bundle.adoptionEvent.id);
  assert.equal(h.requests[0]!.url, h.v.bundle.eligibilityReceipt.statusRef);
  const options = h.requests[0]!.options!;
  assert.equal(options.method, "GET");
  assert.equal(options.redirect, "error");
  assert.equal(options.credentials, "omit");
  assert.equal(options.cache, "no-store");
  assert.equal(options.body, undefined);
  assert.deepEqual([...new Headers(options.headers).keys()], ["accept", "x-stadtstack-status-nonce"]);
  assert.match(nonceOf(options), /^[0-9a-f]{64}$/u);
  await h.verifier.verify(h.v.bundle);
  assert.notEqual(nonceOf(h.requests[0]!.options), nonceOf(h.requests[1]!.options));
  // Node crypto produces the same Ed25519 proof as the independent Röbel signer.
  assert.deepEqual(status(h.v, String(h.v.signedStatusVector.statusCore.requestNonce)), h.v.signedStatusVector);
});

test("snapshots request and pinned policy before awaiting the trusted ledger", async () => {
  const v = fixture();
  const original = structuredClone(v.bundle);
  let release!: (value: unknown) => void;
  const h = harness(v, { acceptance: { resolve: () => new Promise((resolve) => { release = resolve; }) } });
  const pending = h.verifier.verify(v.bundle);
  v.bundle.adoptionEvent.content = "changed after verification started";
  (v.policy as { municipalityId: string }).municipalityId = "other-city";
  release(v.adoptionAcceptance);
  const result = await pending;
  assert.deepEqual(result.bundle, original);
  assert.throws(() => { result.bundle.adoptionEvent.tags[0]![0] = "case"; }, TypeError);
});

test("preserves Röbel's selected post/comment provenance and rejects mismatched answer provenance", async () => {
  const v = JSON.parse(readFileSync(new URL("./fixtures/citizen-adoption-roebel-conversation-v1.json", import.meta.url), "utf8")) as Vector;
  const h = harness(v);
  const result = await h.verifier.verify(v.bundle);
  assert.deepEqual(result.bundle.sourceDiscussion.tags, v.bundle.sourceDiscussion.tags);
  assert.ok(result.bundle.sourceDiscussion.tags.some((tag) => tag[0] === "source-app-comment"));
  v.bundle.sourceAnswer.tags.find((tag) => tag[0] === "source-app-post")![1] = "b6a97f3d-e16f-4cf2-8e78-8c1f8e5ec225";
  v.bundle.sourceAnswer = reSign(v.bundle.sourceAnswer, 82);
  await assert.rejects(h.verifier.verify(v.bundle), /citizen_adoption_binding_invalid/u);
  assert.equal(h.reads.length, 1);
  v.bundle.sourceDiscussion.tags = v.bundle.sourceDiscussion.tags.filter((tag) => tag[0] !== "source-conversation-mention");
  v.bundle.sourceDiscussion = reSign(v.bundle.sourceDiscussion, 81);
  await assert.rejects(h.verifier.verify(v.bundle), /citizen_adoption_discussion_invalid/u);
});

test("checks all four signatures without trusting a supplied verification cache", async (t) => {
  for (const name of ["sourceDiscussion", "sourceAnswer", "participantSuggestionEvent", "adoptionEvent"] as const) {
    await t.test(name, async () => {
      const h = harness();
      h.v.bundle[name].content += "tampered";
      h.v.bundle[name].id = getEventHash(h.v.bundle[name]);
      await assert.rejects(h.verifier.verify(h.v.bundle), /citizen_adoption_event_invalid/u);
      assert.equal(h.reads.length, 0);
    });
  }
  const h = harness();
  Object.defineProperty(h.v.bundle.adoptionEvent, Symbol.for("verified"), { value: true });
  await assert.rejects(h.verifier.verify(h.v.bundle), /citizen_adoption_shape_invalid/u);
  assert.equal(h.reads.length, 0);
});

test("rejects unknown authority, malformed scopes and changed signed source bindings", async (t) => {
  const mutations: Record<string, (v: Vector) => void> = {
    "extra topic segment": (v) => {
      v.bundle.sourceDiscussion.tags.find((tag) => tag[0] === "topic")![1] += ":extra";
      v.bundle.sourceDiscussion = reSign(v.bundle.sourceDiscussion, 81);
    },
    "root authority tag": (v) => {
      v.bundle.sourceDiscussion.tags.push(["case", "caller-case"]);
      v.bundle.sourceDiscussion = reSign(v.bundle.sourceDiscussion, 81);
    },
    "unlabelled agent answer": (v) => {
      v.bundle.sourceAnswer.tags.shift(); v.bundle.sourceAnswer = reSign(v.bundle.sourceAnswer, 82);
    },
    "answer tag order": (v) => {
      v.bundle.sourceAnswer.tags.reverse(); v.bundle.sourceAnswer = reSign(v.bundle.sourceAnswer, 82);
    },
    "answer points elsewhere": (v) => {
      v.bundle.sourceAnswer.tags[1]![1] = "d".repeat(64); v.bundle.sourceAnswer = reSign(v.bundle.sourceAnswer, 82);
    },
    "duplicate evidence": (v) => {
      v.bundle.sourceAnswer.tags.push([...v.bundle.sourceAnswer.tags.at(-1)!]);
      v.bundle.sourceAnswer = reSign(v.bundle.sourceAnswer, 82);
    },
    "changed draft": (v) => {
      const draft = JSON.parse(v.bundle.participantSuggestionEvent.content) as Record<string, unknown>;
      draft.summary = "Different wording";
      v.bundle.participantSuggestionEvent.content = canonical(draft);
      v.bundle.participantSuggestionEvent = reSign(v.bundle.participantSuggestionEvent, 81);
    },
    "changed adoption": (v) => {
      const adoption = JSON.parse(v.bundle.adoptionEvent.content) as Record<string, unknown>;
      adoption.title = "Different wording";
      v.bundle.adoptionEvent.content = canonical(adoption);
      v.bundle.adoptionEvent = reSign(v.bundle.adoptionEvent, 83);
    },
    "other adopter key": (v) => { v.bundle.adoptionEvent = reSign(v.bundle.adoptionEvent, 85); },
    "adoption extra command": (v) => {
      v.bundle.adoptionEvent.tags.push(["vote", "yes"]); v.bundle.adoptionEvent = reSign(v.bundle.adoptionEvent, 83);
    },
    "noncanonical adoption content": (v) => {
      v.bundle.adoptionEvent.content = JSON.stringify(JSON.parse(v.bundle.adoptionEvent.content), null, 2);
      v.bundle.adoptionEvent = reSign(v.bundle.adoptionEvent, 83);
    },
    "caller acceptance": (v) => Object.assign(v.bundle, { adoptionAcceptance: v.adoptionAcceptance }),
    "caller wallet": (v) => Object.assign(v.bundle, { walletAddress: "test-only-override" }),
    "caller nonce": (v) => Object.assign(v.bundle, { requestNonce: "f".repeat(64) }),
    "legacy direct candidate": (v) => { v.bundle.schemaVersion = "citizen_signed_topic_suggestion_v1"; },
    "synthetic test pass": (v) => { v.bundle.schemaVersion = "synthetic_citizen_adoption_v1"; },
    "substituted status endpoint": (v) => { v.bundle.eligibilityReceipt.statusRef = "https://elsewhere.example/status"; },
    "expired receipt": (v) => { v.verifiedAt = Number(v.bundle.eligibilityReceipt.eligibilityCore.expiresAt); },
    "padded issuer proof": (v) => { v.bundle.eligibilityReceipt.proof.signature += "=="; },
    "different issuer key": (v) => { v.bundle.eligibilityReceipt.proof.keyId = "another-issuer"; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    await t.test(name, async () => {
      const h = harness(); mutate(h.v);
      await assert.rejects(h.verifier.verify(h.v.bundle), /citizen_adoption_/u);
      assert.equal(h.reads.length, 0);
      assert.equal(h.requests.length, 0);
    });
  }
});

test("rejects executable objects, getters and oversized input without evaluating them", async () => {
  const h = harness(); let evaluated = 0;
  Object.defineProperty(h.v.bundle, "adoptionEvent", { enumerable: true, get() { evaluated++; return null; } });
  await assert.rejects(h.verifier.verify(h.v.bundle), /citizen_adoption_shape_invalid/u);
  await assert.rejects(h.verifier.verify(new Proxy({}, { ownKeys() { evaluated++; return []; } })), /citizen_adoption_shape_invalid/u);
  await assert.rejects(h.verifier.verify({ toJSON() { evaluated++; return {}; } }), /citizen_adoption_shape_invalid/u);
  const large = fixture(); large.bundle.sourceAnswer.content = "a".repeat(65_537);
  await assert.rejects(h.verifier.verify(large.bundle), /citizen_adoption_shape_invalid/u);
  assert.equal(evaluated, 0);
  assert.equal(h.reads.length, 0);
});

test("requires one matching trusted acceptance and checks its original time and checksum", async (t) => {
  for (const changes of [
    { adoptionEventId: "d".repeat(64) }, { receivedAt: fixture().verifiedAt + 1 },
    { receivedAt: fixture().bundle.adoptionEvent.created_at + 121 },
    { requestChecksum: "e".repeat(64) }, { receiptChecksum: "f".repeat(64) },
    { authorityBinding: "municipal_approval" }, { municipalityId: "other-city" },
  ]) {
    await t.test(Object.keys(changes).join(","), async () => {
      const h = harness(); Object.assign(h.v.adoptionAcceptance, changes);
      await assert.rejects(h.verifier.verify(h.v.bundle), /citizen_adoption_/u);
      assert.equal(h.requests.length, 0);
    });
  }
  for (const value of [null, [], [fixture().adoptionAcceptance, fixture().adoptionAcceptance]]) {
    const h = harness(fixture(), { acceptance: { resolve: async () => value } });
    await assert.rejects(h.verifier.verify(h.v.bundle), /^Error: citizen_adoption_acceptance_unavailable$/u);
    assert.equal(h.requests.length, 0);
  }
  const h = harness(fixture(), { acceptance: { resolve: async () => { throw new Error("private database details"); } } });
  await assert.rejects(h.verifier.verify(h.v.bundle), /^Error: citizen_adoption_acceptance_unavailable$/u);
});

test("rejects signed revoked, stale, future, replayed and mismatched status", async (t) => {
  const changes: Record<string, Record<string, unknown>> = {
    revoked: { state: "revoked" }, unknown: { state: "unknown" },
    replayed: { requestNonce: "c".repeat(64) }, audience: { audience: "other-service" },
    receipt: { receiptId: `urn:stadtstack:municipal-civic-eligibility-receipt:${"d".repeat(64)}` },
    policy: { policyVersion: "other-policy-v1" },
    stale: { observedAt: fixture().verifiedAt - 1 },
    future: { observedAt: fixture().verifiedAt + 1 },
    "future effective time": { effectiveAt: fixture().verifiedAt + 1 },
  };
  for (const [name, update] of Object.entries(changes)) {
    await t.test(name, async () => {
      const v = fixture();
      const h = harness(v, { fetch: async (_url, options) => response(status(v, nonceOf(options), update)) });
      await assert.rejects(h.verifier.verify(v.bundle), /citizen_adoption_/u);
    });
  }
  for (const tamper of [
    (value: Status) => { value.statusChecksum = "d".repeat(64); },
    (value: Status) => { value.proof.signature = value.proof.signature.slice(0, -1) + "!"; },
    (value: Status) => { value.proof = issuerProof({ domain: "municipal-civic-eligibility-status/v1", schemaVersion: "municipal_civic_eligibility_status_v1", statusChecksum: value.statusChecksum }, 85); },
    (value: Status) => { value.proof = fixture().bundle.eligibilityReceipt.proof; },
    (value: Status) => { Object.assign(value.statusCore, { walletAddress: "not-public" }); },
  ]) {
    const v = fixture();
    const h = harness(v, { fetch: async (_url, options) => { const value = status(v, nonceOf(options)); tamper(value); return response(value); } });
    await assert.rejects(h.verifier.verify(v.bundle), /citizen_adoption_/u);
  }
});

test("rechecks expiry, status age and clock movement after each asynchronous read", async (t) => {
  for (const [name, times] of Object.entries({
    "expires at ledger read": [300, 904], "clock reverses at ledger read": [300, 299],
    "expires at status read": [300, 300, 904], "clock reverses at status read": [300, 300, 299],
    "status age limit": [300, 300, 330],
  })) {
    await t.test(name, async () => {
      const v = fixture(); const base = v.verifiedAt - 300;
      const h = harness(v, { now: () => new Date((base + times.shift()!) * 1_000) });
      await assert.rejects(h.verifier.verify(v.bundle), /citizen_adoption_(receipt_expired|status_stale)/u);
      assert.equal(h.requests.length, name.includes("ledger") ? 0 : 1);
    });
  }
  const v = fixture();
  v.verifiedAt = Number(v.bundle.eligibilityReceipt.eligibilityCore.expiresAt) - 1;
  const h = harness(v, { fetch: async (_url, options) => response(status(v, nonceOf(options), { observedAt: v.verifiedAt, effectiveAt: v.verifiedAt })) });
  assert.equal((await h.verifier.verify(v.bundle)).validUntil, v.verifiedAt + 1);
});

test("redacts transport errors and rejects redirects, non-JSON and excessive responses", async () => {
  for (const makeResponse of [
    () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example" } }),
    () => new Response("private service error", { status: 503 }),
    () => new Response("<html>not JSON</html>", { headers: { "content-type": "text/html" } }),
    () => new Response("invalid JSON", { headers: { "content-type": "application/json" } }),
    () => new Response("a".repeat(16_385), { headers: { "content-type": "application/json" } }),
    () => { throw new Error("private transport details"); },
  ]) {
    const h = harness(fixture(), { fetch: async () => makeResponse() });
    await assert.rejects(h.verifier.verify(h.v.bundle), /^Error: citizen_adoption_status_unavailable$/u);
  }
});

test("bounds hung reads and prevents late ledger completion from starting a status request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let release!: (value: unknown) => void;
  let ledgerSignal!: AbortSignal;
  const h = harness(fixture(), { acceptance: { resolve: ({ signal }) => {
    ledgerSignal = signal; return new Promise((resolve) => { release = resolve; });
  } } });
  const pending = h.verifier.verify(h.v.bundle);
  t.mock.timers.tick(10_000);
  await assert.rejects(pending, /citizen_adoption_verification_timeout/u);
  assert.equal(ledgerSignal.aborted, true);
  release(h.v.adoptionAcceptance);
  await setImmediate();
  assert.equal(h.requests.length, 0);
  let statusSignal: AbortSignal | null | undefined;
  const second = harness(fixture(), { fetch: async (_url, options) => {
    statusSignal = options?.signal; return new Promise<Response>(() => {});
  } });
  const statusPending = second.verifier.verify(second.v.bundle);
  await setImmediate();
  assert.ok(statusSignal);
  t.mock.timers.tick(10_000);
  await assert.rejects(statusPending, /citizen_adoption_verification_timeout/u);
  assert.equal(statusSignal?.aborted, true);
});

test("cannot finish after the budget when a dependency delays the event-loop timer", async (t) => {
  let elapsed = 0;
  t.mock.method(performance, "now", () => elapsed);
  const v = fixture();
  const h = harness(v, { acceptance: { resolve: async () => {
    elapsed = 10_000;
    return v.adoptionAcceptance;
  } } });
  await assert.rejects(h.verifier.verify(v.bundle), /citizen_adoption_verification_timeout/u);
  assert.equal(h.requests.length, 0);
});

test("fails before use for invalid pinned configuration", () => {
  for (const changes of [
    { statusBaseUrl: "http://issuer.example/status" }, { statusBaseUrl: "https://issuer.example/status/" },
    { statusBaseUrl: "https://issuer.example/status?wallet=override" },
    { allowedAgentPubkeys: [] }, { issuerPublicKey: "d".repeat(63) },
    { statusMaxAgeSeconds: 0 }, { receiptTtlSeconds: 3_601 }, { maxEventClockSkewSeconds: 301 },
  ]) {
    const v = fixture(); Object.assign(v.policy, changes);
    assert.throws(() => harness(v), /citizen_adoption_policy_invalid/u);
  }
});
