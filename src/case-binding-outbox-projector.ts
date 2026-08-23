import { types as utilTypes } from "node:util";

import {
  createInMemoryCaseBindingProjection,
  verifyPublicCaseBindingReceipt,
  type CaseBindingProjectionReader,
  type PublicCaseBindingReceiptV1,
} from "./case-binding-projection.ts";
import type {
  CaseBindingOutboxEntryV1,
  CredentialFreeCaseBindingOutboxReader,
} from "./case-binding-outbox.ts";

/** The largest replay page we request from an outbox. */
export const CASE_BINDING_OUTBOX_PAGE_SIZE = 256;
/** A public projection is intentionally bounded, rather than becoming a sink
 * for an accidentally unbounded or hostile replay source. */
export const CASE_BINDING_OUTBOX_MAX_RECEIPTS = 10_000;

export type CaseBindingOutboxProjection = Readonly<{
  /** Credential-free public read model. It has no replay, writer, or admission seam. */
  reader: Pick<CaseBindingProjectionReader, "get" | "getByRootEventId">;
  /** Composition-root operation; this object is never an HTTP handler. */
  reconcile(): Promise<Readonly<{ afterSequence: number; applied: number }>>;
}>;

type Replay = (
  input?: { afterSequence?: number; limit?: number },
) => readonly CaseBindingOutboxEntryV1[] | Promise<readonly CaseBindingOutboxEntryV1[]>;

function fail(code: string): never { throw new Error(code); }

function plainRecord(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  return value as Record<string, unknown>;
}

function exactRecord(value: unknown, fields: readonly string[], code: string): Record<string, unknown> {
  const parsed = plainRecord(value, code);
  const keys = Reflect.ownKeys(parsed);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" || !fields.includes(key))) fail(code);
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(parsed, field);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail(code);
  }
  return parsed;
}

function strictArray(value: unknown, code: string): readonly unknown[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail(code);
  // Read the intrinsic array length before enumerating keys. A hostile sparse
  // page with a multi-billion logical length must fail in constant space.
  if (value.length > CASE_BINDING_OUTBOX_PAGE_SIZE) fail("case_binding_outbox_page_oversized");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" &&
    (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)))) fail(code);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail(code);
  }
  return value;
}

function captureReplay(value: CredentialFreeCaseBindingOutboxReader): Replay {
  const parsed = exactRecord(value, ["replay"], "case_binding_outbox_dependency_invalid");
  const descriptor = Object.getOwnPropertyDescriptor(parsed, "replay");
  if (!descriptor || descriptor.get || descriptor.set || typeof descriptor.value !== "function" || utilTypes.isProxy(descriptor.value)) {
    fail("case_binding_outbox_dependency_invalid");
  }
  return descriptor.value as Replay;
}

function entry(value: unknown, previousSequence: number): Readonly<CaseBindingOutboxEntryV1> {
  const parsed = exactRecord(value, ["sequence", "receipt"], "case_binding_outbox_entry_invalid");
  // The sequence is an opaque, strictly monotonic durable cursor. It is not a
  // row count: databases may legitimately leave gaps in generated keys.
  if (!Number.isSafeInteger(parsed.sequence) || (parsed.sequence as number) <= previousSequence) {
    fail("case_binding_outbox_sequence_invalid");
  }
  const receipt = verifyPublicCaseBindingReceipt(parsed.receipt);
  return Object.freeze({ sequence: parsed.sequence as number, receipt });
}

/**
 * Rebuilds a public Case-binding projection from a deliberately credential-free
 * replay port. It never receives a database, Case coordinator, admission port,
 * or an authentication capability. All reads are validated before they replace
 * the active projection, so a faulty incremental replay leaves the prior view
 * intact.
 */
export async function createCaseBindingOutboxProjector(
  outbox: CredentialFreeCaseBindingOutboxReader,
): Promise<CaseBindingOutboxProjection> {
  const replay = captureReplay(outbox);
  let receipts: readonly PublicCaseBindingReceiptV1[] = Object.freeze([]);
  let afterSequence = 0;
  let active = createInMemoryCaseBindingProjection();

  const readPending = async (): Promise<ReadonlyArray<Readonly<CaseBindingOutboxEntryV1>>> => {
    let cursor = afterSequence;
    const pending: Readonly<CaseBindingOutboxEntryV1>[] = [];
    const seenReceiptChecksums = new Set(receipts.map((receipt) => receipt.receiptChecksum));
    for (;;) {
      const page = strictArray(
        await replay(Object.freeze({
          afterSequence: cursor,
          limit: CASE_BINDING_OUTBOX_PAGE_SIZE,
        })),
        "case_binding_outbox_page_invalid",
      );
      if (page.length > CASE_BINDING_OUTBOX_PAGE_SIZE) fail("case_binding_outbox_page_oversized");
      if (page.length === 0) return Object.freeze(pending);
      for (const value of page) {
        const parsed = entry(value, cursor);
        if (seenReceiptChecksums.has(parsed.receipt.receiptChecksum)) fail("case_binding_outbox_duplicate_receipt");
        if (receipts.length + pending.length >= CASE_BINDING_OUTBOX_MAX_RECEIPTS) fail("case_binding_outbox_limit_exceeded");
        seenReceiptChecksums.add(parsed.receipt.receiptChecksum);
        pending.push(parsed);
        cursor = parsed.sequence;
      }
    }
  };

  let reconciliation: Promise<Readonly<{ afterSequence: number; applied: number }>> | null = null;

  const reconcile = (): Promise<Readonly<{ afterSequence: number; applied: number }>> => {
    if (reconciliation) return reconciliation;
    const operation = (async (): Promise<Readonly<{ afterSequence: number; applied: number }>> => {
      // Do all untrusted and asynchronous work before replacing the active
      // projection/cursor. Concurrent callers share this one operation.
      const pending = await readPending();
      if (pending.length === 0) return Object.freeze({ afterSequence, applied: 0 });
      const nextReceipts = Object.freeze([...receipts, ...pending.map((value) => value.receipt)]);
      const next = createInMemoryCaseBindingProjection(nextReceipts);
      const nextAfterSequence = pending[pending.length - 1]!.sequence;
      active = next;
      receipts = nextReceipts;
      afterSequence = nextAfterSequence;
      return Object.freeze({ afterSequence, applied: pending.length });
    })();
    reconciliation = operation;
    void operation.then(
      () => { if (reconciliation === operation) reconciliation = null; },
      () => { if (reconciliation === operation) reconciliation = null; },
    );
    return operation;
  };

  // Hydration has the same all-or-nothing semantics as later reconciliation:
  // callers never receive a half-replayed reader.
  await reconcile();

  const reader: Pick<CaseBindingProjectionReader, "get" | "getByRootEventId"> = Object.freeze({
    get(caseId: string) { return active.reader.get(caseId); },
    getByRootEventId(rootEventId: string) { return active.reader.getByRootEventId(rootEventId); },
  });
  return Object.freeze({ reader, reconcile });
}
