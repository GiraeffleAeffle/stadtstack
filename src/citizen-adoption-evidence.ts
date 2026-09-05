import { createHash, createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import { types as utilTypes } from "node:util";
import { getEventHash, validateEvent, verifyEvent, type Event as NostrEvent } from "nostr-tools/pure";

/** Deployment policy, never a field in a citizen or staff request. */
export type CitizenAdoptionEvidencePolicy = Readonly<{
  municipalityId: string;
  policyVersion: string;
  issuer: string;
  issuerKeyId: string;
  issuerPublicKey: string;
  allowedAgentPubkeys: readonly string[];
  receiptTtlSeconds: number;
  statusBaseUrl: string;
  statusMaxAgeSeconds: number;
  maxEventClockSkewSeconds: number;
}>;

/** Four complete signed events and one issuer receipt, without duplicated signer claims. */
export type CitizenAdoptionEvidenceBundle = Readonly<{
  schemaVersion: "eligible_citizen_adopted_topic_suggestion_v1";
  sourceDiscussion: NostrEvent;
  sourceAnswer: NostrEvent;
  participantSuggestionEvent: NostrEvent;
  eligibilityReceipt: Readonly<Record<string, unknown>>;
  adoptionEvent: NostrEvent;
}>;

/** This exact-event read must come from the configured issuer's adoption ledger. */
export type CitizenAdoptionAcceptanceReader = Readonly<{
  resolve(input: Readonly<{ adoptionEventId: string; signal: AbortSignal }>): Promise<unknown>;
}>;

/**
 * Verified evidence is not an admission capability. The atomic writer must
 * recheck the deadline and consume the nonce with the root claim/journal/outbox.
 */
export type VerifiedCitizenAdoptionEvidence = Readonly<{
  schemaVersion: "verified_citizen_adoption_evidence_v1";
  bundle: CitizenAdoptionEvidenceBundle;
  adoptionAcceptance: Readonly<Record<string, unknown>>;
  eligibilityStatus: Readonly<Record<string, unknown>>;
  verifiedAt: number;
  validUntil: number;
  authorityBinding: "none";
}>;

const HEX = /^[0-9a-f]{64}$/u;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const POLICY = /^[a-z0-9][a-z0-9._-]{2,99}$/u;
const EVENT_KEYS = ["id", "pubkey", "created_at", "kind", "tags", "content", "sig"];
const BUNDLE_KEYS = ["schemaVersion", "sourceDiscussion", "sourceAnswer", "participantSuggestionEvent", "eligibilityReceipt", "adoptionEvent"];
const RECEIPT_KEYS = ["schemaVersion", "eligibilityCore", "receiptId", "payloadChecksum", "statusRef", "proof"];
const CORE_KEYS = ["municipalityId", "eligibilityClass", "subjectPubkey", "participantSuggestionId", "topicId", "policyVersion", "issuer", "issuedAt", "expiresAt", "authorityBinding"];
const ACCEPTANCE_KEYS = ["schemaVersion", "adoptionId", "adoptionEventId", "municipalityId", "topicId", "participantSuggestionId", "adopterPubkey", "eligibilityReceiptId", "requestChecksum", "eventCreatedAt", "receivedAt", "policyVersion", "status", "authorityBinding", "receiptChecksum"];

function fail(code: string): never { throw new Error(code); }
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("citizen_adoption_shape_invalid");
  return value as Record<string, unknown>;
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const result = object(value);
  if (Object.keys(result).length !== keys.length || keys.some((key) => !Object.hasOwn(result, key))) fail("citizen_adoption_shape_invalid");
  return result;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function digest(value: unknown): string { return createHash("sha256").update(canonical(value), "utf8").digest("hex"); }
function same(actual: unknown, expected: unknown): void {
  if (canonical(actual) !== canonical(expected)) fail("citizen_adoption_binding_invalid");
}

/** Copy only bounded JSON data; never evaluate getters, toJSON, proxies or cached verification symbols. */
function snapshot(input: unknown): unknown {
  let nodes = 0;
  let bytes = 0;
  const account = (size: number) => {
    bytes += size;
    if (bytes > 262_144) fail("citizen_adoption_shape_invalid");
  };
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > 6_000 || depth > 16) fail("citizen_adoption_shape_invalid");
    account(2);
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return value;
    if (typeof value === "string" && value.length <= 65_536) {
      const size = Buffer.byteLength(value, "utf8");
      if (size > 65_536) fail("citizen_adoption_shape_invalid");
      account(size);
      return value;
    }
    if (!value || typeof value !== "object" || utilTypes.isProxy(value)) fail("citizen_adoption_shape_invalid");
    const array = Array.isArray(value);
    if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) fail("citizen_adoption_shape_invalid");
    const keys = Reflect.ownKeys(value);
    if (keys.length > 6_000 - nodes || keys.some((key) => typeof key !== "string" || key.length > 128)) fail("citizen_adoption_shape_invalid");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (array && (value.length > 512 || keys.length !== value.length + 1)) fail("citizen_adoption_shape_invalid");
    const fields = array ? Array.from({ length: value.length }, (_, i) => String(i)) : keys as string[];
    const entries = fields.map((key) => {
      account(Buffer.byteLength(key, "utf8"));
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail("citizen_adoption_shape_invalid");
      return [key, visit(descriptor.value, depth + 1)] as const;
    });
    return Object.freeze(array ? entries.map(([, child]) => child) : Object.fromEntries(entries));
  };
  const result = visit(input, 0);
  if (Buffer.byteLength(canonical(result), "utf8") > 262_144) fail("citizen_adoption_shape_invalid");
  return result;
}

function event(value: unknown): NostrEvent {
  const parsed = exact(value, EVENT_KEYS);
  if (parsed.kind !== 1 || !integer(parsed.created_at) || typeof parsed.id !== "string" || !HEX.test(parsed.id) ||
    typeof parsed.pubkey !== "string" || !HEX.test(parsed.pubkey) || typeof parsed.sig !== "string" ||
    !/^[0-9a-f]{128}$/u.test(parsed.sig) || typeof parsed.content !== "string" ||
    !Array.isArray(parsed.tags) || parsed.tags.length > 32 ||
    parsed.tags.some((tag) => !Array.isArray(tag) || tag.length > 8 || tag.some((entry) => typeof entry !== "string"))
  ) fail("citizen_adoption_event_invalid");
  // nostr-tools may cache a verification symbol. Verify a separate mutable
  // object so neither untrusted cache state nor a later mutation can be reused.
  const signed = structuredClone(parsed) as NostrEvent;
  if (!validateEvent(signed) || getEventHash(signed) !== signed.id || !verifyEvent(signed)) fail("citizen_adoption_event_invalid");
  return parsed as NostrEvent;
}
function tag(event: NostrEvent, name: string): string[] | undefined {
  const matches = event.tags.filter((entry) => entry[0] === name);
  if (matches.length > 1) fail("citizen_adoption_binding_invalid");
  return matches[0];
}
function content(event: NostrEvent): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = snapshot(JSON.parse(event.content)); } catch { fail("citizen_adoption_content_invalid"); }
  if (canonical(parsed) !== event.content) fail("citizen_adoption_content_invalid");
  return object(parsed);
}
function boundedText(value: unknown, limit: number, multiline = false): string {
  const forbidden = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u;
  if (typeof value !== "string" || value.trim() !== value || !value || value.length > limit || forbidden.test(value)) fail("citizen_adoption_content_invalid");
  return value;
}

function discussion(root: NostrEvent, policy: CitizenAdoptionEvidencePolicy): string {
  const agent = tag(root, "p")?.[1];
  const source = tag(root, "source-post")?.[1];
  const topic = tag(root, "topic")?.[1];
  const title = tag(root, "topic-title")?.[1];
  if (!agent || !policy.allowedAgentPubkeys.includes(agent) || !source || !HEX.test(source) ||
    !topic || topic.split(":").length !== 6 || !topic.startsWith(`urn:stadtstack:topic:municipality:${policy.municipalityId}:`) ||
    !SLUG.test(topic.split(":").at(-1)!) || !title || title.length < 3 || !/@mecky\b/iu.test(root.content)
  ) fail("citizen_adoption_discussion_invalid");
  boundedText(title, 120);
  boundedText(root.content, 2_000, true);
  const expected: string[][] = [["p", agent], ["q", source, "", root.pubkey], ["source-post", source]];
  if (tag(root, "source-app-post")) {
    const sourcePost = tag(root, "source-app-post")![1];
    const comment = tag(root, "source-app-comment")?.[1];
    const mention = tag(root, "source-conversation-mention")?.[1];
    const reply = tag(root, "source-mecky-reply")?.[1];
    const receipt = tag(root, "source-mecky-receipt")?.[1];
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
    if (!sourcePost || !uuid.test(sourcePost) || (comment !== undefined && !uuid.test(comment)) ||
      mention !== source || !reply || !HEX.test(reply) ||
      (receipt !== undefined && !/^urn:stadtstack:mecky-answer:[0-9a-f]{64}$/u.test(receipt))
    ) fail("citizen_adoption_discussion_invalid");
    expected.push(["source-app-post", sourcePost]);
    if (comment) expected.push(["source-app-comment", comment]);
    expected.push(["source-conversation-mention", mention], ["source-mecky-reply", reply]);
    if (receipt) expected.push(["source-mecky-receipt", receipt]);
  }
  expected.push(["t", "stadtstack-civic-discussion"], ["municipality", policy.municipalityId],
    ["topic", topic], ["topic-title", title], ["stance", "root"], ["argument-root", "self"]);
  same(root.tags, expected);
  return topic;
}

function sources(bundle: CitizenAdoptionEvidenceBundle, policy: CitizenAdoptionEvidencePolicy) {
  const root = event(bundle.sourceDiscussion);
  const answer = event(bundle.sourceAnswer);
  const suggestion = event(bundle.participantSuggestionEvent);
  const adoption = event(bundle.adoptionEvent);
  const topicId = discussion(root, policy);
  const receiptId = tag(answer, "mecky-receipt")?.[1];
  const evidence = answer.tags.filter((entry) => entry[0] === "evidence");
  if (answer.pubkey !== tag(root, "p")![1] || answer.created_at < root.created_at ||
    !receiptId || !/^urn:stadtstack:mecky-answer:[0-9a-f]{64}$/u.test(receiptId) ||
    evidence.length < 1 || evidence.length > 3 || new Set(evidence.map((entry) => entry[1])).size !== evidence.length ||
    evidence.some((entry) => {
      if (entry.length !== 3 || !/^sha256:[0-9a-f]{64}$/u.test(entry[1]!)) return true;
      try { const url = new URL(entry[2]!); return url.protocol !== "https:" || Boolean(url.username || url.password); }
      catch { return true; }
    })
  ) fail("citizen_adoption_answer_invalid");
  const agent = tag(answer, "netizen_agent");
  if (!agent || agent.length !== 3) fail("citizen_adoption_answer_invalid");
  boundedText(agent[1], 120);
  boundedText(agent[2], 120);
  boundedText(answer.content, 2_000, true);
  const expectedAnswerTags = [agent, ["e", root.id, "", "reply"], ["p", root.pubkey]];
  for (const name of ["source-app-post", "source-app-comment"]) {
    const selected = tag(root, name);
    if (selected) expectedAnswerTags.push(selected);
  }
  expectedAnswerTags.push(["mecky-receipt", receiptId], ["municipality", policy.municipalityId], ["topic", topicId], ...evidence);
  same(answer.tags, expectedAnswerTags);
  if (suggestion.pubkey !== root.pubkey || suggestion.created_at <= answer.created_at ||
    suggestion.created_at <= root.created_at || adoption.created_at < suggestion.created_at
  ) fail("citizen_adoption_binding_invalid");
  const draft = content(suggestion);
  const draftCore = {
    sourceAnswerId: answer.id, sourceAnswerRef: `nostr://event/${answer.id}`,
    sourceAnswerReceiptId: receiptId, sourceDiscussionId: root.id, sourceDiscussionRef: `nostr://event/${root.id}`,
    municipalityId: policy.municipalityId, topicId, participantPubkey: root.pubkey,
    title: boundedText(draft.title, 240), summary: boundedText(draft.summary, 2_000, true),
  };
  same(draft, { schemaVersion: "public_participant_topic_suggestion_draft_v1",
    draftId: `urn:stadtstack:participant-topic-suggestion-draft:${digest(draftCore)}`, ...draftCore,
    entryState: "citizen_adoption_required", authorityBinding: "none", submittedToCivicWorkflow: false });
  same(suggestion.tags, [
    ["schema", "staging_participant_signed_topic_suggestion_v1"], ["municipality", policy.municipalityId],
    ["topic", topicId], ["e", root.id, "", "root"], ["mecky-receipt", receiptId], ["credential-class", "staging-participant"],
  ]);
  return { root, answer, suggestion, adoption, draftCore, topicId };
}

async function responseJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok || response.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json" || !response.body) fail("citizen_adoption_status_unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16_384) fail("citizen_adoption_status_unavailable");
      chunks.push(chunk.value);
    }
    return snapshot(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))));
  } finally { await reader.cancel().catch(() => {}); }
}

export function createCitizenAdoptionEvidenceVerifier(dependencies: Readonly<{
  policy: CitizenAdoptionEvidencePolicy;
  acceptance: CitizenAdoptionAcceptanceReader;
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}>): Readonly<{ verify(bundle: unknown): Promise<VerifiedCitizenAdoptionEvidence> }> {
  const policy = snapshot(dependencies.policy) as CitizenAdoptionEvidencePolicy;
  exact(policy, ["municipalityId", "policyVersion", "issuer", "issuerKeyId", "issuerPublicKey", "allowedAgentPubkeys",
    "receiptTtlSeconds", "statusBaseUrl", "statusMaxAgeSeconds", "maxEventClockSkewSeconds"]);
  const timeoutMs = dependencies.timeoutMs ?? 10_000;
  let statusBase: URL;
  try { statusBase = new URL(policy.statusBaseUrl); } catch { fail("citizen_adoption_policy_invalid"); }
  if (typeof policy.municipalityId !== "string" || !SLUG.test(policy.municipalityId) ||
    typeof policy.policyVersion !== "string" || !POLICY.test(policy.policyVersion) ||
    typeof policy.issuer !== "string" || !policy.issuer || policy.issuer.trim() !== policy.issuer ||
    typeof policy.issuerKeyId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u.test(policy.issuerKeyId) ||
    typeof policy.issuerPublicKey !== "string" || !HEX.test(policy.issuerPublicKey) ||
    !Array.isArray(policy.allowedAgentPubkeys) || !policy.allowedAgentPubkeys.length ||
    policy.allowedAgentPubkeys.some((key) => typeof key !== "string" || !HEX.test(key)) || new Set(policy.allowedAgentPubkeys).size !== policy.allowedAgentPubkeys.length ||
    !integer(policy.receiptTtlSeconds) || policy.receiptTtlSeconds < 60 || policy.receiptTtlSeconds > 3_600 ||
    !integer(policy.statusMaxAgeSeconds) || policy.statusMaxAgeSeconds < 1 || policy.statusMaxAgeSeconds > 300 ||
    !integer(policy.maxEventClockSkewSeconds) || policy.maxEventClockSkewSeconds > 300 ||
    statusBase.protocol !== "https:" || statusBase.username || statusBase.password || statusBase.hash || statusBase.search ||
    statusBase.pathname.endsWith("/") || statusBase.href !== policy.statusBaseUrl ||
    !integer(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000 ||
    typeof dependencies.acceptance?.resolve !== "function" || typeof (dependencies.fetch ?? globalThis.fetch) !== "function" ||
    (dependencies.now !== undefined && typeof dependencies.now !== "function")
  ) fail("citizen_adoption_policy_invalid");
  const request = dependencies.fetch ?? globalThis.fetch;
  const readAcceptance = dependencies.acceptance.resolve.bind(dependencies.acceptance);
  const now = dependencies.now ?? (() => new Date());
  const timestamp = () => {
    const value = Math.floor(now().getTime() / 1_000);
    if (!integer(value)) fail("citizen_adoption_time_invalid");
    return value;
  };
  const key = createPublicKey({ key: Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(policy.issuerPublicKey, "hex"),
  ]), format: "der", type: "spki" });
  const proof = (value: unknown, message: unknown) => {
    const parsed = exact(value, ["algorithm", "keyId", "signature"]);
    if (parsed.algorithm !== "Ed25519" || parsed.keyId !== policy.issuerKeyId || typeof parsed.signature !== "string" ||
      !/^[A-Za-z0-9_-]{86}$/u.test(parsed.signature)
    ) fail("citizen_adoption_proof_invalid");
    const signature = Buffer.from(parsed.signature, "base64url");
    if (signature.toString("base64url") !== parsed.signature || !verifySignature(null, Buffer.from(canonical(message)), key, signature)) fail("citizen_adoption_proof_invalid");
  };

  const inspect = async (input: unknown, signal: AbortSignal, checkBudget: () => void): Promise<VerifiedCitizenAdoptionEvidence> => {
    const parsed = exact(snapshot(input), BUNDLE_KEYS);
    if (parsed.schemaVersion !== "eligible_citizen_adopted_topic_suggestion_v1") fail("citizen_adoption_bundle_invalid");
    const bundle = parsed as CitizenAdoptionEvidenceBundle;
    const source = sources(bundle, policy);
    const receipt = exact(bundle.eligibilityReceipt, RECEIPT_KEYS);
    const core = exact(receipt.eligibilityCore, CORE_KEYS);
    const startedAt = timestamp();
    if (!integer(core.issuedAt) || !integer(core.expiresAt) || core.expiresAt - core.issuedAt !== policy.receiptTtlSeconds ||
      core.issuedAt > startedAt || core.expiresAt <= startedAt || core.issuedAt < source.suggestion.created_at
    ) fail("citizen_adoption_receipt_expired");
    same(core, {
      municipalityId: policy.municipalityId, eligibilityClass: "municipal_civic_participation",
      subjectPubkey: source.adoption.pubkey, participantSuggestionId: source.suggestion.id, topicId: source.topicId,
      policyVersion: policy.policyVersion, issuer: policy.issuer, issuedAt: core.issuedAt, expiresAt: core.expiresAt,
      authorityBinding: "civic_eligibility_only",
    });
    const payloadChecksum = digest(core);
    const receiptId = `urn:stadtstack:municipal-civic-eligibility-receipt:${payloadChecksum}`;
    const statusRef = `${policy.statusBaseUrl}/${payloadChecksum}`;
    same({ ...receipt, proof: null }, {
      schemaVersion: "municipal_civic_eligibility_receipt_v1", eligibilityCore: core,
      receiptId, payloadChecksum, statusRef, proof: null,
    });
    proof(receipt.proof, { domain: "municipal-civic-eligibility-receipt/v1",
      schemaVersion: "municipal_civic_eligibility_receipt_v1", receiptId, payloadChecksum, statusRef });
    const adoptionCore = {
      municipalityId: policy.municipalityId, topicId: source.topicId,
      participantSuggestionId: source.suggestion.id, participantSuggestionRef: `nostr://event/${source.suggestion.id}`,
      participantPubkey: source.root.pubkey, sourceDiscussionId: source.root.id,
      sourceAnswerReceiptId: source.draftCore.sourceAnswerReceiptId, adopterPubkey: source.adoption.pubkey,
      eligibilityReceiptId: receiptId, eligibilityReceiptChecksum: payloadChecksum,
      title: source.draftCore.title, summary: source.draftCore.summary,
    };
    const adoptionId = `urn:stadtstack:citizen-topic-suggestion-adoption:${digest(adoptionCore)}`;
    same(content(source.adoption), { schemaVersion: "public_citizen_topic_suggestion_adoption_v1", adoptionId,
      ...adoptionCore, entryState: "case_steward_review_required", authorityBinding: "civic_eligibility_only", submittedToCivicWorkflow: false });
    same(source.adoption.tags, [
      ["schema", "citizen_adopted_topic_suggestion_v1"], ["municipality", policy.municipalityId], ["topic", source.topicId],
      ["e", source.suggestion.id, "", "adopted-suggestion"], ["e", source.root.id, "", "root"], ["p", source.root.pubkey],
      ["eligibility-receipt", receiptId], ["credential-class", "municipal-civic-eligibility"],
    ]);
    checkBudget();
    let acceptance: Record<string, unknown>;
    try { acceptance = exact(snapshot(await readAcceptance({ adoptionEventId: source.adoption.id, signal })), ACCEPTANCE_KEYS); }
    catch { fail("citizen_adoption_acceptance_unavailable"); }
    checkBudget();
    if (!integer(acceptance.receivedAt) || acceptance.receivedAt > startedAt ||
      acceptance.receivedAt < core.issuedAt || acceptance.receivedAt >= core.expiresAt ||
      source.adoption.created_at < core.issuedAt || source.adoption.created_at >= core.expiresAt ||
      Math.abs(acceptance.receivedAt - source.adoption.created_at) > policy.maxEventClockSkewSeconds
    ) fail("citizen_adoption_acceptance_invalid");
    const acceptanceCore = {
      schemaVersion: "citizen_topic_suggestion_adoption_acceptance_receipt_v1",
      adoptionId, adoptionEventId: source.adoption.id, municipalityId: policy.municipalityId,
      topicId: source.topicId, participantSuggestionId: source.suggestion.id, adopterPubkey: source.adoption.pubkey,
      eligibilityReceiptId: receiptId,
      requestChecksum: digest({ schemaVersion: "citizen_topic_suggestion_adoption_request_v1", adoptionEvent: source.adoption }),
      eventCreatedAt: source.adoption.created_at, receivedAt: acceptance.receivedAt,
      policyVersion: policy.policyVersion, status: "accepted", authorityBinding: "civic_eligibility_only",
    };
    same(acceptance, { ...acceptanceCore, receiptChecksum: digest(acceptanceCore) });
    const requestNonce = randomBytes(32).toString("hex");
    const requestedAt = timestamp();
    if (requestedAt < startedAt || requestedAt >= core.expiresAt) fail("citizen_adoption_receipt_expired");
    let status: Record<string, unknown>;
    try {
      status = exact(await responseJson(await request(statusRef, {
        method: "GET", redirect: "error", credentials: "omit", cache: "no-store", signal,
        headers: { accept: "application/json", "x-stadtstack-status-nonce": requestNonce },
      }), signal), ["statusCore", "statusChecksum", "proof"]);
    } catch { fail("citizen_adoption_status_unavailable"); }
    checkBudget();
    const verifiedAt = timestamp();
    const observed = exact(status.statusCore, ["schemaVersion", "receiptId", "payloadChecksum", "policyVersion", "state", "effectiveAt", "observedAt", "audience", "requestNonce"]);
    if (verifiedAt < requestedAt || requestedAt < startedAt || verifiedAt >= core.expiresAt ||
      !integer(observed.observedAt) || !integer(observed.effectiveAt) ||
      observed.observedAt < requestedAt || observed.observedAt > verifiedAt ||
      observed.effectiveAt > observed.observedAt || observed.effectiveAt < core.issuedAt ||
      verifiedAt - observed.observedAt >= policy.statusMaxAgeSeconds
    ) fail("citizen_adoption_status_stale");
    same(observed, { schemaVersion: "municipal_civic_eligibility_status_v1", receiptId, payloadChecksum,
      policyVersion: policy.policyVersion, state: "active", effectiveAt: observed.effectiveAt, observedAt: observed.observedAt,
      audience: "stadtstack-case-steward-admission", requestNonce });
    if (status.statusChecksum !== digest(observed)) fail("citizen_adoption_status_invalid");
    proof(status.proof, { domain: "municipal-civic-eligibility-status/v1",
      schemaVersion: "municipal_civic_eligibility_status_v1", statusChecksum: status.statusChecksum });
    checkBudget();
    return Object.freeze({ schemaVersion: "verified_citizen_adoption_evidence_v1", bundle,
      adoptionAcceptance: acceptance, eligibilityStatus: status, verifiedAt,
      validUntil: Math.min(core.expiresAt, observed.observedAt + policy.statusMaxAgeSeconds), authorityBinding: "none" });
  };

  return Object.freeze({
    async verify(bundle: unknown): Promise<VerifiedCitizenAdoptionEvidence> {
      const controller = new AbortController();
      const deadline = performance.now() + timeoutMs;
      const checkBudget = () => {
        if (controller.signal.aborted || performance.now() >= deadline) fail("citizen_adoption_verification_timeout");
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new Error("citizen_adoption_verification_timeout"));
            }, timeoutMs);
          }),
          inspect(bundle, controller.signal, checkBudget),
        ]);
      } finally { if (timer) clearTimeout(timer); controller.abort(); }
    },
  });
}
