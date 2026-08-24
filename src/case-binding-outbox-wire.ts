import { types as utilTypes } from "node:util";

import { verifyPublicCaseBindingReceipt } from "./case-binding-projection.ts";
import type { CaseBindingOutboxEntryV1 } from "./case-binding-outbox.ts";

/** Shared, unprivileged canonical wire contract for private outbox replay. */
export type CredentialFreeCaseBindingOutboxPageV1 = Readonly<{
  schemaVersion: "public_case_binding_outbox_page_v1";
  afterSequence: number;
  nextSequence: number | null;
  entries: readonly CaseBindingOutboxEntryV1[];
}>;

export type CredentialFreeCaseBindingOutboxPageVerificationOptions = Readonly<{
  expectedAfterSequence?: number;
  requestedLimit?: number;
}>;

export const CREDENTIAL_FREE_CASE_BINDING_OUTBOX_PATH =
  "/v1/internal/public-case-bindings/outbox" as const;
export const CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_LIMIT = 256 as const;
export const CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_PAGE_BYTES = 1_048_576 as const;
export const CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_PAGE_NODES = 4_096 as const;

const PAGE_SCHEMA_VERSION = "public_case_binding_outbox_page_v1" as const;

function fail(code: string): never { throw new Error(code); }

function exactRecord(value: unknown, fields: readonly string[], code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" || !fields.includes(key))) fail(code);
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail(code);
  }
  return value as Record<string, unknown>;
}

function strictArray(value: unknown, maxLength: number, code: string): readonly unknown[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail(code);
  if (!Number.isSafeInteger(value.length) || value.length > maxLength) fail(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" &&
    (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)))) fail(code);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail(code);
  }
  return value;
}

function strictNonNegativeSafeInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(code);
  return value as number;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) fail("case_binding_outbox_page_invalid");
  return serialized;
}

function strictEntry(value: unknown, previousSequence: number, seenChecksums: Set<string>, seenCases: Set<string>, seenRoots: Set<string>): Readonly<CaseBindingOutboxEntryV1> {
  const parsed = exactRecord(value, ["sequence", "receipt"], "case_binding_outbox_replay_invalid");
  const sequence = strictNonNegativeSafeInteger(parsed.sequence, "case_binding_outbox_sequence_invalid");
  if (sequence <= previousSequence || sequence === 0) fail("case_binding_outbox_sequence_invalid");
  const receipt = verifyPublicCaseBindingReceipt(parsed.receipt);
  if (seenChecksums.has(receipt.receiptChecksum)) fail("case_binding_outbox_duplicate_receipt");
  if (seenCases.has(receipt.caseId)) fail("case_binding_outbox_case_conflict");
  if (seenRoots.has(receipt.rootEventId)) fail("case_binding_outbox_root_conflict");
  seenChecksums.add(receipt.receiptChecksum);
  seenCases.add(receipt.caseId);
  seenRoots.add(receipt.rootEventId);
  return Object.freeze({ sequence, receipt });
}

export function verifyCredentialFreeCaseBindingOutboxEntries(
  value: unknown,
  afterSequence: number,
  requestedLimit: number,
): readonly CaseBindingOutboxEntryV1[] {
  const values = strictArray(value, requestedLimit, "case_binding_outbox_replay_invalid");
  const seenChecksums = new Set<string>();
  const seenCases = new Set<string>();
  const seenRoots = new Set<string>();
  const entries: CaseBindingOutboxEntryV1[] = [];
  let previous = afterSequence;
  for (let index = 0; index < values.length; index += 1) {
    const parsed = strictEntry(values[index], previous, seenChecksums, seenCases, seenRoots);
    entries.push(parsed);
    previous = parsed.sequence;
  }
  return Object.freeze(entries);
}

export function verifyCredentialFreeCaseBindingOutboxPage(
  value: unknown,
  options: CredentialFreeCaseBindingOutboxPageVerificationOptions = {},
): CredentialFreeCaseBindingOutboxPageV1 {
  const parsed = exactRecord(value, ["schemaVersion", "afterSequence", "nextSequence", "entries"], "case_binding_outbox_page_invalid");
  if (parsed.schemaVersion !== PAGE_SCHEMA_VERSION) fail("case_binding_outbox_page_invalid");
  const afterSequence = strictNonNegativeSafeInteger(parsed.afterSequence, "case_binding_outbox_page_invalid");
  if (options.expectedAfterSequence !== undefined && parsed.afterSequence !== options.expectedAfterSequence) fail("case_binding_outbox_cursor_invalid");
  const requestedLimit = options.requestedLimit ?? CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_LIMIT;
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_LIMIT) {
    fail("case_binding_outbox_page_invalid");
  }
  const entries = verifyCredentialFreeCaseBindingOutboxEntries(parsed.entries, afterSequence, requestedLimit);
  const nextSequenceValue = parsed.nextSequence;
  if (nextSequenceValue !== null && (typeof nextSequenceValue !== "number" ||
    !Number.isSafeInteger(nextSequenceValue) || nextSequenceValue <= afterSequence)) fail("case_binding_outbox_cursor_invalid");
  const nextSequence = nextSequenceValue as number | null;
  if ((entries.length === 0 && nextSequence !== null) ||
    (entries.length > 0 && nextSequence !== entries[entries.length - 1]!.sequence)) fail("case_binding_outbox_cursor_invalid");
  let nodes = 2;
  for (const entry of entries) {
    nodes += 3 + entry.receipt.caseEventIds.length;
    if (nodes > CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_PAGE_NODES) fail("case_binding_outbox_page_nodes_exceeded");
  }
  const page = Object.freeze({ schemaVersion: PAGE_SCHEMA_VERSION, afterSequence, nextSequence, entries });
  if (Buffer.byteLength(canonical(page), "utf8") + 1 > CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_PAGE_BYTES) {
    fail("case_binding_outbox_page_too_large");
  }
  return page;
}

export function serializeCredentialFreeCaseBindingOutboxPage(value: CredentialFreeCaseBindingOutboxPageV1): string {
  const page = verifyCredentialFreeCaseBindingOutboxPage(value);
  return `${canonical(page)}\n`;
}

export function parseAndVerifyCredentialFreeCaseBindingOutboxPage(
  body: string | Uint8Array,
  options: CredentialFreeCaseBindingOutboxPageVerificationOptions = {},
): CredentialFreeCaseBindingOutboxPageV1 {
  let text: string;
  try {
    if (typeof body === "string") {
      if (Buffer.byteLength(body, "utf8") > CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_PAGE_BYTES) fail("case_binding_outbox_page_too_large");
      text = body;
    } else {
      if (!(body instanceof Uint8Array) || body.byteLength > CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_PAGE_BYTES) fail("case_binding_outbox_page_too_large");
      text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    }
    if (!text.endsWith("\n")) fail("case_binding_outbox_page_noncanonical");
    const parsed = JSON.parse(text) as unknown;
    const page = verifyCredentialFreeCaseBindingOutboxPage(parsed, options);
    if (serializeCredentialFreeCaseBindingOutboxPage(page) !== text) fail("case_binding_outbox_page_noncanonical");
    return page;
  } catch (error) {
    if (error instanceof Error && /^case_binding_outbox_/u.test(error.message)) throw error;
    fail("case_binding_outbox_page_invalid");
  }
}

export const parseCredentialFreeCaseBindingOutboxPage = parseAndVerifyCredentialFreeCaseBindingOutboxPage;
