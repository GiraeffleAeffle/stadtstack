import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import { MUNICIPAL_CASE_ID, UUID_V7 } from "./case-id.ts";

import {
  createInMemoryCaseBindingProjection,
  verifyPublicCaseBindingReceipt,
} from "./case-binding-projection.ts";
import type { CaseBindingOutboxEntryV1 } from "./case-binding-outbox.ts";

/** A canonical durable-journal head used by a staging recovery manifest. */
export type CaseStateRecoveryJournalHeadV1 = Readonly<{
  caseId: string;
  caseVersion: number;
  journalHeadChecksum: string;
}>;

/**
 * The public, civic-content-free part of one outbox binding in a recovery
 * manifest. The receipt itself is deliberately not copied into the manifest:
 * its verified checksum identifies the exact receipt, while canonical route
 * digests prove the two public responses a restore must reproduce.
 */
export type CaseStateRecoveryBindingEvidenceV1 = Readonly<{
  sequence: number;
  caseId: string;
  rootEventId: string;
  receiptChecksum: string;
  caseIdResponseBodyChecksum: string;
  discussionRootResponseBodyChecksum: string;
}>;

/** Deterministic, civic-content-free evidence for one recovered Case store. */
export type CaseStateRecoveryEvidenceV1 = Readonly<{
  schemaVersion: "case_state_recovery_evidence_v1";
  orderedHeads: readonly CaseStateRecoveryJournalHeadV1[];
  headsAggregateChecksum: string;
  outboxCursor: number;
  projectionEntryCount: number;
  orderedBindingEvidence: readonly CaseStateRecoveryBindingEvidenceV1[];
  publicProjectionChecksum: string;
}>;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const EVENT_ID = /^[0-9a-f]{64}$/u;
const CASE_ID = MUNICIPAL_CASE_ID;
/** Reviewed staging-store capacity. The durable admission adapter enforces the
 * same bound before commit so a valid store can never become unsealable. */
export const CASE_STATE_RECOVERY_MAX_CASES = 10_000;

function fail(code: string): never { throw new Error(code); }

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    !utilTypes.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactRecord(value: unknown, fields: readonly string[], code: string): Record<string, unknown> {
  if (!isPlainRecord(value)) fail(code);
  const parsed = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(parsed);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" || !fields.includes(key))) fail(code);
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(parsed, field);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail(code);
  }
  return parsed;
}

/** Accept only an ordinary dense array with no extra properties/accessors. */
function exactArray(value: unknown, code: string): readonly unknown[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail(code);
  if (value.length > CASE_STATE_RECOVERY_MAX_CASES) fail("case_state_recovery_entry_limit_exceeded");
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || lengthDescriptor.get || lengthDescriptor.set || typeof lengthDescriptor.value !== "number") fail(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" &&
    (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)))) fail(code);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail(code);
  }
  return value;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isPlainRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))) return JSON.stringify(value);
  fail("case_state_recovery_value_invalid");
}

function checksum(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function bodyChecksum(body: string): string {
  return `sha256:${createHash("sha256").update(body, "utf8").digest("hex")}`;
}

function clone<T>(value: T): T { return structuredClone(value); }

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function validCaseId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = CASE_ID.exec(value);
  return match !== null && UUID_V7.test(match[2]!);
}

function validChecksum(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function validEventId(value: unknown): value is string {
  return typeof value === "string" && EVENT_ID.test(value);
}

function parseHead(value: unknown): CaseStateRecoveryJournalHeadV1 {
  const parsed = exactRecord(value, ["caseId", "caseVersion", "journalHeadChecksum"], "case_state_recovery_head_invalid");
  if (!validCaseId(parsed.caseId) || !Number.isSafeInteger(parsed.caseVersion) ||
    (parsed.caseVersion as number) < 3 || !validChecksum(parsed.journalHeadChecksum)) fail("case_state_recovery_head_invalid");
  return Object.freeze({ caseId: parsed.caseId, caseVersion: parsed.caseVersion as number, journalHeadChecksum: parsed.journalHeadChecksum });
}

function parseHeads(value: unknown): readonly CaseStateRecoveryJournalHeadV1[] {
  const values = exactArray(value, "case_state_recovery_heads_invalid");
  const heads: CaseStateRecoveryJournalHeadV1[] = [];
  let previousCaseId: string | null = null;
  for (const item of values) {
    const head = parseHead(item);
    if (previousCaseId !== null && head.caseId <= previousCaseId) {
      fail(head.caseId === previousCaseId ? "case_state_recovery_head_duplicate" : "case_state_recovery_heads_not_canonical");
    }
    previousCaseId = head.caseId;
    heads.push(head);
  }
  return Object.freeze(heads);
}

function parseOutboxEntry(value: unknown, previousSequence: number): Readonly<CaseBindingOutboxEntryV1> {
  const parsed = exactRecord(value, ["sequence", "receipt"], "case_state_recovery_outbox_entry_invalid");
  if (!Number.isSafeInteger(parsed.sequence) || (parsed.sequence as number) < 1 ||
    (parsed.sequence as number) <= previousSequence) fail("case_state_recovery_outbox_sequence_invalid");
  const receipt = verifyPublicCaseBindingReceipt(parsed.receipt);
  return Object.freeze({ sequence: parsed.sequence as number, receipt });
}

function parseOutboxEntries(value: unknown): readonly Readonly<CaseBindingOutboxEntryV1>[] {
  const values = exactArray(value, "case_state_recovery_outbox_invalid");
  const entries: Readonly<CaseBindingOutboxEntryV1>[] = [];
  const caseIds = new Set<string>();
  const roots = new Set<string>();
  const receiptChecksums = new Set<string>();
  let previousSequence = 0;
  for (const item of values) {
    const parsed = parseOutboxEntry(item, previousSequence);
    previousSequence = parsed.sequence;
    if (caseIds.has(parsed.receipt.caseId)) fail("case_state_recovery_case_duplicate");
    if (roots.has(parsed.receipt.rootEventId)) fail("case_state_recovery_root_duplicate");
    if (receiptChecksums.has(parsed.receipt.receiptChecksum)) fail("case_state_recovery_receipt_duplicate");
    caseIds.add(parsed.receipt.caseId);
    roots.add(parsed.receipt.rootEventId);
    receiptChecksums.add(parsed.receipt.receiptChecksum);
    entries.push(parsed);
  }
  return Object.freeze(entries);
}

function assertCaseSetsMatch(
  heads: readonly CaseStateRecoveryJournalHeadV1[],
  entries: readonly Readonly<CaseBindingOutboxEntryV1>[],
): void {
  if (heads.length !== entries.length) fail("case_state_recovery_case_set_mismatch");
  const byCaseId = new Map(heads.map((head) => [head.caseId, head] as const));
  for (const entry of entries) {
    const receipt = entry.receipt;
    const head = byCaseId.get(receipt.caseId);
    if (!head || head.caseVersion < receipt.caseVersion ||
      (head.caseVersion === receipt.caseVersion && head.journalHeadChecksum !== receipt.journalHeadChecksum)) {
      fail("case_state_recovery_case_mismatch");
    }
  }
}

function responseBodyChecksum(
  projection: ReturnType<typeof createInMemoryCaseBindingProjection>,
  path: string,
): string {
  const response = projection.reader.respond({ method: "GET", path });
  // Transport headers are deliberately not read: only the canonical body is evidence.
  if (response.status !== 200 || typeof response.body !== "string") fail("case_state_recovery_projection_response_invalid");
  return bodyChecksum(response.body);
}

function bindingEvidence(
  projection: ReturnType<typeof createInMemoryCaseBindingProjection>,
  entry: Readonly<CaseBindingOutboxEntryV1>,
): CaseStateRecoveryBindingEvidenceV1 {
  const receipt = entry.receipt;
  return Object.freeze({
    sequence: entry.sequence,
    caseId: receipt.caseId,
    rootEventId: receipt.rootEventId,
    receiptChecksum: receipt.receiptChecksum,
    caseIdResponseBodyChecksum: responseBodyChecksum(projection, `/v1/public/case-bindings/${receipt.caseId}`),
    discussionRootResponseBodyChecksum: responseBodyChecksum(projection, `/v1/public/case-bindings/by-discussion/${receipt.rootEventId}`),
  });
}

function parseBindingEvidence(value: unknown, previousSequence: number): CaseStateRecoveryBindingEvidenceV1 {
  const parsed = exactRecord(value, [
    "sequence", "caseId", "rootEventId", "receiptChecksum", "caseIdResponseBodyChecksum", "discussionRootResponseBodyChecksum",
  ], "case_state_recovery_binding_evidence_invalid");
  if (!Number.isSafeInteger(parsed.sequence) || (parsed.sequence as number) < 1 ||
    (parsed.sequence as number) <= previousSequence || !validCaseId(parsed.caseId) || !validEventId(parsed.rootEventId) ||
    !validChecksum(parsed.receiptChecksum) || !validChecksum(parsed.caseIdResponseBodyChecksum) || !validChecksum(parsed.discussionRootResponseBodyChecksum)) {
    fail("case_state_recovery_binding_evidence_invalid");
  }
  return Object.freeze({
    sequence: parsed.sequence as number,
    caseId: parsed.caseId,
    rootEventId: parsed.rootEventId,
    receiptChecksum: parsed.receiptChecksum,
    caseIdResponseBodyChecksum: parsed.caseIdResponseBodyChecksum,
    discussionRootResponseBodyChecksum: parsed.discussionRootResponseBodyChecksum,
  });
}

function parseBindingEvidenceArray(value: unknown): readonly CaseStateRecoveryBindingEvidenceV1[] {
  const values = exactArray(value, "case_state_recovery_binding_evidence_invalid");
  const result: CaseStateRecoveryBindingEvidenceV1[] = [];
  const cases = new Set<string>();
  const roots = new Set<string>();
  const receipts = new Set<string>();
  let previousSequence = 0;
  for (const item of values) {
    const evidence = parseBindingEvidence(item, previousSequence);
    previousSequence = evidence.sequence;
    if (cases.has(evidence.caseId)) fail("case_state_recovery_case_duplicate");
    if (roots.has(evidence.rootEventId)) fail("case_state_recovery_root_duplicate");
    if (receipts.has(evidence.receiptChecksum)) fail("case_state_recovery_receipt_duplicate");
    cases.add(evidence.caseId);
    roots.add(evidence.rootEventId);
    receipts.add(evidence.receiptChecksum);
    result.push(evidence);
  }
  return Object.freeze(result);
}

function buildEvidence(
  heads: readonly CaseStateRecoveryJournalHeadV1[],
  entries: readonly Readonly<CaseBindingOutboxEntryV1>[],
): CaseStateRecoveryEvidenceV1 {
  assertCaseSetsMatch(heads, entries);
  const projection = createInMemoryCaseBindingProjection(entries.map((entry) => entry.receipt));
  const orderedBindingEvidence = Object.freeze(entries.map((entry) => bindingEvidence(projection, entry)));
  const outboxCursor = entries.length === 0 ? 0 : entries[entries.length - 1]!.sequence;
  const publicProjectionChecksum = checksum({ schemaVersion: "case_state_recovery_public_projection_v1", orderedBindingEvidence });
  return deepFreeze({
    schemaVersion: "case_state_recovery_evidence_v1" as const,
    orderedHeads: clone(heads),
    headsAggregateChecksum: checksum({ schemaVersion: "case_state_recovery_heads_v1", orderedHeads: heads }),
    outboxCursor,
    projectionEntryCount: orderedBindingEvidence.length,
    orderedBindingEvidence,
    publicProjectionChecksum,
  });
}

function verifyParsedEvidence(value: unknown): CaseStateRecoveryEvidenceV1 {
  const parsed = exactRecord(value, [
    "schemaVersion", "orderedHeads", "headsAggregateChecksum", "outboxCursor", "projectionEntryCount", "orderedBindingEvidence", "publicProjectionChecksum",
  ], "case_state_recovery_evidence_invalid");
  if (parsed.schemaVersion !== "case_state_recovery_evidence_v1" || !validChecksum(parsed.headsAggregateChecksum) || !validChecksum(parsed.publicProjectionChecksum) ||
    !Number.isSafeInteger(parsed.outboxCursor) || (parsed.outboxCursor as number) < 0 || !Number.isSafeInteger(parsed.projectionEntryCount) ||
    (parsed.projectionEntryCount as number) < 0 || (parsed.projectionEntryCount as number) > CASE_STATE_RECOVERY_MAX_CASES) fail("case_state_recovery_evidence_invalid");
  const orderedHeads = parseHeads(parsed.orderedHeads);
  const orderedBindingEvidence = parseBindingEvidenceArray(parsed.orderedBindingEvidence);
  if (orderedBindingEvidence.length !== parsed.projectionEntryCount) fail("case_state_recovery_projection_count_invalid");
  const expectedCursor = orderedBindingEvidence.length === 0 ? 0 : orderedBindingEvidence.at(-1)!.sequence;
  if (expectedCursor !== parsed.outboxCursor) fail("case_state_recovery_outbox_cursor_invalid");
  const headByCaseId = new Map(orderedHeads.map((head) => [head.caseId, head] as const));
  if (headByCaseId.size !== orderedBindingEvidence.length) fail("case_state_recovery_case_set_mismatch");
  for (const binding of orderedBindingEvidence) if (!headByCaseId.has(binding.caseId)) fail("case_state_recovery_case_mismatch");
  if (checksum({ schemaVersion: "case_state_recovery_heads_v1", orderedHeads }) !== parsed.headsAggregateChecksum) fail("case_state_recovery_heads_checksum_invalid");
  if (checksum({ schemaVersion: "case_state_recovery_public_projection_v1", orderedBindingEvidence }) !== parsed.publicProjectionChecksum) fail("case_state_recovery_projection_checksum_invalid");
  return deepFreeze({
    schemaVersion: "case_state_recovery_evidence_v1" as const,
    orderedHeads,
    headsAggregateChecksum: parsed.headsAggregateChecksum,
    outboxCursor: parsed.outboxCursor as number,
    projectionEntryCount: parsed.projectionEntryCount as number,
    orderedBindingEvidence,
    publicProjectionChecksum: parsed.publicProjectionChecksum,
  });
}

/** Creates evidence without any file, network, clock, storage, Kubernetes or credential behavior. */
export function createCaseStateRecoveryEvidence(input: Readonly<{
  caseJournalHeads: readonly CaseStateRecoveryJournalHeadV1[];
  outboxEntries: readonly CaseBindingOutboxEntryV1[];
}>): CaseStateRecoveryEvidenceV1 {
  const parsed = exactRecord(input, ["caseJournalHeads", "outboxEntries"], "case_state_recovery_input_invalid");
  const heads = parseHeads(parsed.caseJournalHeads);
  const entries = parseOutboxEntries(parsed.outboxEntries);
  return verifyParsedEvidence(buildEvidence(heads, entries));
}

/** Strictly verifies and normalizes an evidence value without trusting aggregates. */
export function verifyCaseStateRecoveryEvidence(value: unknown): CaseStateRecoveryEvidenceV1 {
  return verifyParsedEvidence(value);
}
