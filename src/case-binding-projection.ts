import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

/**
 * A public, post-hoc receipt.  It does not mutate the signed Nostr root and
 * does not itself confer civic authority.
 */
export type PublicCaseBindingReceiptV1 = {
  schemaVersion: "public_case_binding_receipt_v1";
  rootEventId: string;
  topicId: string;
  candidateId: string;
  candidateEventId: string;
  sourceAnswerEventId: string;
  caseId: string;
  caseVersion: 3;
  caseEventIds: readonly [string, string, string];
  journalHeadChecksum: string;
  admissionEventChecksum: string;
  receiptChecksum: string;
  authorityBinding: "none";
  openDeskWrite: false;
};

export type CaseBindingProjectionReader = {
  get(caseId: string): PublicCaseBindingReceiptV1 | null;
  getByRootEventId(rootEventId: string): PublicCaseBindingReceiptV1 | null;
  respond(request: CaseBindingProjectionRequest): CaseBindingProjectionResponse;
};

export type CaseBindingProjectionWriter = {
  record(receipt: PublicCaseBindingReceiptV1): void;
};

export type InMemoryCaseBindingProjection = {
  readonly reader: CaseBindingProjectionReader;
  readonly writer: CaseBindingProjectionWriter;
};

export type CaseBindingProjectionRequest = { method: string; path: string };
export type CaseBindingProjectionResponse = {
  status: 200 | 400 | 404 | 405;
  headers: Readonly<Record<string, string>>;
  body: string;
};

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CASE_ID = /^urn:stadtstack:case:test:([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?):([0-9a-f-]{36})$/u;

function fail(code: string): never { throw new Error(code); }

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  return value as Record<string, unknown>;
}

function exact(value: unknown, fields: readonly string[], code: string): Record<string, unknown> {
  const parsed = record(value, code);
  const keys = Reflect.ownKeys(parsed);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" || !fields.includes(key))) fail(code);
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(parsed, field);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail(code);
  }
  return parsed;
}

function strictStringArray(value: unknown, code: string): readonly string[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" &&
    (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)))) fail(code);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable || typeof descriptor.value !== "string") fail(code);
  }
  return value as readonly string[];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function checksum(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function text(value: unknown, code: string, expression: RegExp, maxBytes: number): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > maxBytes || !expression.test(value)) fail(code);
  return value;
}

function clone<T>(value: T): T { return structuredClone(value); }

export function verifyPublicCaseBindingReceipt(value: unknown): PublicCaseBindingReceiptV1 {
  const parsed = exact(value, [
    "schemaVersion", "rootEventId", "topicId", "candidateId", "candidateEventId",
    "sourceAnswerEventId", "caseId", "caseVersion", "caseEventIds", "journalHeadChecksum",
    "admissionEventChecksum", "receiptChecksum", "authorityBinding", "openDeskWrite",
  ], "case_binding_receipt_invalid");
  if (parsed.schemaVersion !== "public_case_binding_receipt_v1" ||
    parsed.authorityBinding !== "none" || parsed.openDeskWrite !== false) {
    fail("case_binding_receipt_invalid");
  }
  const rootEventId = text(parsed.rootEventId, "case_binding_receipt_invalid", /^[0-9a-f]{64}$/u, 64);
  const topicId = text(parsed.topicId, "case_binding_receipt_invalid", /^urn:stadtstack:topic:municipality:[a-z0-9-]+:[a-z0-9-]+$/u, 256);
  const candidateId = text(parsed.candidateId, "case_binding_receipt_invalid", /^urn:stadtstack:signed-topic-suggestion:[0-9a-f]{64}$/u, 128);
  const candidateEventId = text(parsed.candidateEventId, "case_binding_receipt_invalid", /^[0-9a-f]{64}$/u, 64);
  const sourceAnswerEventId = text(parsed.sourceAnswerEventId, "case_binding_receipt_invalid", /^[0-9a-f]{64}$/u, 64);
  const caseId = text(parsed.caseId, "case_binding_receipt_invalid", CASE_ID, 256);
  const caseIdMatch = CASE_ID.exec(caseId);
  if (!caseIdMatch || !UUID_V7.test(caseIdMatch[2]!)) fail("case_binding_receipt_invalid");
  if (parsed.caseVersion !== 3) fail("case_binding_receipt_invalid");
  const caseVersion = 3 as const;
  const caseEventIds = strictStringArray(parsed.caseEventIds, "case_binding_receipt_invalid");
  if (caseEventIds.length !== 3 || caseEventIds.some((id, index) =>
    id !== `urn:stadtstack:case-event:${caseId}:${index + 1}`)) fail("case_binding_receipt_invalid");
  const journalHeadChecksum = text(parsed.journalHeadChecksum, "case_binding_receipt_invalid", SHA256, 71);
  const admissionEventChecksum = text(parsed.admissionEventChecksum, "case_binding_receipt_invalid", SHA256, 71);
  const receiptChecksum = text(parsed.receiptChecksum, "case_binding_receipt_invalid", SHA256, 71);
  if (candidateId !== `urn:stadtstack:signed-topic-suggestion:${candidateEventId}` ||
    admissionEventChecksum !== journalHeadChecksum) fail("case_binding_receipt_invalid");
  const exactCaseEventIds = [caseEventIds[0]!, caseEventIds[1]!, caseEventIds[2]!] as const;
  const unsigned = {
    schemaVersion: "public_case_binding_receipt_v1" as const,
    rootEventId, topicId, candidateId, candidateEventId, sourceAnswerEventId, caseId,
    caseVersion, caseEventIds: exactCaseEventIds, journalHeadChecksum,
    admissionEventChecksum, authorityBinding: "none" as const, openDeskWrite: false as const,
  };
  if (checksum(unsigned) !== receiptChecksum) fail("case_binding_receipt_checksum_invalid");
  const frozenEventIds = Object.freeze([...unsigned.caseEventIds]) as readonly [string, string, string];
  return Object.freeze({ ...unsigned, caseEventIds: frozenEventIds, receiptChecksum });
}

export function createPublicCaseBindingReceipt(input: Omit<PublicCaseBindingReceiptV1, "schemaVersion" | "receiptChecksum" | "authorityBinding" | "openDeskWrite">): PublicCaseBindingReceiptV1 {
  const unsigned = {
    schemaVersion: "public_case_binding_receipt_v1" as const,
    ...clone(input),
    authorityBinding: "none" as const,
    openDeskWrite: false as const,
  };
  return verifyPublicCaseBindingReceipt({ ...unsigned, receiptChecksum: checksum(unsigned) });
}

function response(status: CaseBindingProjectionResponse["status"], body: string, extra: Readonly<Record<string, string>> = {}): CaseBindingProjectionResponse {
  return Object.freeze({
    status,
    headers: Object.freeze({
      "cache-control": "no-store",
      "content-type": status === 200 ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
      "content-length": String(Buffer.byteLength(body, "utf8")),
      "x-content-type-options": "nosniff",
      ...extra,
    }),
    body,
  });
}

/**
 * Rebuildable in-memory reference projection. Production readers replay the
 * durable Case admission outbox before serving; this object is not a journal.
 */
export function createInMemoryCaseBindingProjection(
  initialReceipts: readonly PublicCaseBindingReceiptV1[] = [],
): InMemoryCaseBindingProjection {
  if (!Array.isArray(initialReceipts) || utilTypes.isProxy(initialReceipts)) fail("case_binding_projection_invalid");
  const receipts = new Map<string, PublicCaseBindingReceiptV1>();
  const receiptsByRootEventId = new Map<string, PublicCaseBindingReceiptV1>();
  const recordReceipt = (value: PublicCaseBindingReceiptV1): void => {
    const receipt = verifyPublicCaseBindingReceipt(value);
    const existingCase = receipts.get(receipt.caseId);
    if (existingCase && canonical(existingCase) !== canonical(receipt)) fail("case_binding_conflict");
    const existingRoot = receiptsByRootEventId.get(receipt.rootEventId);
    if (existingRoot && canonical(existingRoot) !== canonical(receipt)) fail("case_binding_root_conflict");
    // Only mutate after both uniqueness checks: the two indexes stay atomic.
    receipts.set(receipt.caseId, receipt);
    receiptsByRootEventId.set(receipt.rootEventId, receipt);
  };
  const reader = Object.freeze({
    get(caseId: string) {
      if (typeof caseId !== "string" || !CASE_ID.test(caseId)) return null;
      const receipt = receipts.get(caseId);
      return receipt ? clone(receipt) : null;
    },
    getByRootEventId(rootEventId: string) {
      if (typeof rootEventId !== "string" || !/^[0-9a-f]{64}$/u.test(rootEventId)) return null;
      const receipt = receiptsByRootEventId.get(rootEventId);
      return receipt ? clone(receipt) : null;
    },
    respond(request: CaseBindingProjectionRequest) {
      const parsed = exact(request, ["method", "path"], "case_binding_request_invalid");
      if (typeof parsed.method !== "string" || typeof parsed.path !== "string") fail("case_binding_request_invalid");
      if (parsed.method !== "GET") return response(405, "method_not_allowed\n", { allow: "GET" });
      if (/[?#]/u.test(parsed.path)) return response(400, "query_not_allowed\n");
      const byDiscussion = /^\/v1\/public\/case-bindings\/by-discussion\/([0-9a-f]{64})$/u.exec(parsed.path);
      if (byDiscussion) {
        const receipt = receiptsByRootEventId.get(byDiscussion[1]!);
        if (!receipt) return response(404, "binding_not_found\n");
        const body = `${canonical(receipt)}\n`;
        return response(200, body, { "x-stadtstack-receipt-sha256": receipt.receiptChecksum });
      }
      const match = /^\/v1\/public\/case-bindings\/(urn:stadtstack:case:test:[a-z0-9-]+:[0-9a-f-]{36})$/u.exec(parsed.path);
      if (!match) return response(404, "binding_not_found\n");
      const receipt = receipts.get(match[1]!);
      if (!receipt) return response(404, "binding_not_found\n");
      const body = `${canonical(receipt)}\n`;
      return response(200, body, { "x-stadtstack-receipt-sha256": receipt.receiptChecksum });
    },
  });
  const writer = Object.freeze({ record: recordReceipt });
  for (const receipt of initialReceipts) writer.record(receipt);
  return Object.freeze({ reader, writer });
}
