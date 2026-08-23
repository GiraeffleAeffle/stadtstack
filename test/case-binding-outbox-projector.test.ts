import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CASE_BINDING_OUTBOX_MAX_RECEIPTS,
  CASE_BINDING_OUTBOX_PAGE_SIZE,
  createCaseBindingOutboxProjector,
} from "../src/case-binding-outbox-projector.ts";
import { createPublicCaseBindingReceipt, type PublicCaseBindingReceiptV1 } from "../src/case-binding-projection.ts";
import { createPublicCaseBindingServer } from "../src/public-case-binding-server.ts";
import type { CaseBindingOutboxEntryV1, CredentialFreeCaseBindingOutboxReader } from "../src/case-binding-outbox.ts";

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const hex = (value: number) => value.toString(16).padStart(64, "0");

function caseId(value: number): string {
  return `urn:stadtstack:case:test:roebel-mueritz:01983a00-0000-7000-8000-${value.toString(16).padStart(12, "0")}`;
}

function receipt(value: number, options: Readonly<{ caseId?: string; rootEventId?: string }> = {}): PublicCaseBindingReceiptV1 {
  const currentCaseId = options.caseId ?? caseId(value);
  const candidateEventId = hex(value + 100_000);
  return createPublicCaseBindingReceipt({
    rootEventId: options.rootEventId ?? hex(value),
    topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse",
    candidateId: `urn:stadtstack:signed-topic-suggestion:${candidateEventId}`,
    candidateEventId,
    sourceAnswerEventId: hex(value + 200_000),
    caseId: currentCaseId,
    caseVersion: 3,
    caseEventIds: [
      `urn:stadtstack:case-event:${currentCaseId}:1`,
      `urn:stadtstack:case-event:${currentCaseId}:2`,
      `urn:stadtstack:case-event:${currentCaseId}:3`,
    ] as const,
    journalHeadChecksum: digest(`journal-${value}`),
    admissionEventChecksum: digest(`journal-${value}`),
  });
}

function entry(sequence: number, value: PublicCaseBindingReceiptV1): CaseBindingOutboxEntryV1 {
  return Object.freeze({ sequence, receipt: structuredClone(value) });
}

function replayable(entries: readonly CaseBindingOutboxEntryV1[]): CredentialFreeCaseBindingOutboxReader {
  return Object.freeze({
    replay(input = {}) {
      const afterSequence = input.afterSequence ?? 0;
      const limit = input.limit ?? 100;
      return Object.freeze(entries.filter((value) => value.sequence > afterSequence).slice(0, limit).map((value) => Object.freeze({
        sequence: value.sequence,
        receipt: structuredClone(value.receipt),
      })));
    },
  });
}

test("hydration replays more than one bounded page and recreates byte-identically", async () => {
  const entries = Array.from({ length: CASE_BINDING_OUTBOX_PAGE_SIZE * 2 + 3 }, (_, index) => entry(index + 1, receipt(index + 1)));
  const requestedLimits: number[] = [];
  const outbox = Object.freeze({
    replay(input: { afterSequence?: number; limit?: number } = {}) {
      requestedLimits.push(input.limit ?? -1);
      const afterSequence = input.afterSequence ?? 0;
      return Object.freeze(entries.filter((value) => value.sequence > afterSequence).slice(0, input.limit).map((value) => Object.freeze({
        sequence: value.sequence,
        receipt: structuredClone(value.receipt),
      })));
    },
  });
  const projection = await createCaseBindingOutboxProjector(outbox);
  assert.deepEqual([...new Set(requestedLimits)], [CASE_BINDING_OUTBOX_PAGE_SIZE]);
  assert.equal((await projection.reconcile()).applied, 0);
  const last = entries.at(-1)!.receipt;
  const before = JSON.stringify(projection.reader.get(last.caseId));
  const recreated = await createCaseBindingOutboxProjector(replayable(entries));
  const after = JSON.stringify(recreated.reader.get(last.caseId));
  assert.equal(after, before);
  assert.deepEqual(recreated.reader.getByRootEventId(last.rootEventId), last);
  const transport = createPublicCaseBindingServer({
    allowedHosts: ["case-bindings.staging.example"],
    reader: recreated.reader,
  });
  assert.deepEqual(Object.keys(transport), ["server"]);
});

test("incremental replay atomically advances a public reader", async () => {
  const entries: CaseBindingOutboxEntryV1[] = [entry(1, receipt(1))];
  const projection = await createCaseBindingOutboxProjector(replayable(entries));
  const next = receipt(2);
  entries.push(entry(2, next));
  assert.deepEqual(await projection.reconcile(), { afterSequence: 2, applied: 1 });
  assert.deepEqual(projection.reader.get(next.caseId), next);
  assert.deepEqual(await projection.reconcile(), { afterSequence: 2, applied: 0 });
  assert.deepEqual(Object.keys(projection.reader).sort(), ["get", "getByRootEventId"]);
  assert.equal("writer" in projection.reader, false);
  assert.equal("reconcile" in projection.reader, false);
  assert.equal("admission" in projection.reader, false);
});

test("corrupt, conflicting, duplicate, non-increasing, and oversized replay faults preserve the old public view", async () => {
  const first = receipt(1);
  const entries: CaseBindingOutboxEntryV1[] = [entry(1, first)];
  let mode: "normal" | "corrupt" | "conflict" | "duplicate" | "non-increasing" | "oversized" = "normal";
  const outbox = Object.freeze({
    replay(input: { afterSequence?: number; limit?: number } = {}) {
      const afterSequence = input.afterSequence ?? 0;
      if (afterSequence === 0) return replayable(entries).replay(input);
      if (mode === "corrupt") return Object.freeze([{ sequence: 2, receipt: { ...first, receiptChecksum: digest("forged") } }]);
      if (mode === "conflict") return Object.freeze([entry(2, receipt(2, { caseId: first.caseId, rootEventId: hex(99) }))]);
      if (mode === "duplicate") return Object.freeze([entry(2, first)]);
      if (mode === "non-increasing") return Object.freeze([entry(1, receipt(2))]);
      if (mode === "oversized") return Object.freeze(Array.from({ length: CASE_BINDING_OUTBOX_PAGE_SIZE + 1 }, (_, index) => entry(index + 2, receipt(index + 2))));
      return replayable(entries).replay(input);
    },
  });
  const projection = await createCaseBindingOutboxProjector(outbox);
  const before = projection.reader.get(first.caseId);
  for (const fault of ["corrupt", "conflict", "duplicate", "non-increasing", "oversized"] as const) {
    mode = fault;
    await assert.rejects(projection.reconcile());
    assert.deepEqual(projection.reader.get(first.caseId), before);
    assert.equal(projection.reader.get(caseId(2)), null);
  }
  mode = "normal";
  const next = receipt(2);
  entries.push(entry(2, next));
  assert.deepEqual(await projection.reconcile(), { afterSequence: 2, applied: 1 });
  assert.deepEqual(projection.reader.get(next.caseId), next);
});

test("the projector rejects invalid dependencies before replay and limits each replay to ten thousand pending receipts", async () => {
  let called = false;
  const replay = () => { called = true; return Object.freeze([]); };
  await assert.rejects(createCaseBindingOutboxProjector(Object.freeze({ replay, extra: true }) as unknown as CredentialFreeCaseBindingOutboxReader), /case_binding_outbox_dependency_invalid/);
  assert.equal(called, false);
  const accessor: Record<string, unknown> = {};
  Object.defineProperty(accessor, "replay", { enumerable: true, get() { called = true; return replay; } });
  await assert.rejects(createCaseBindingOutboxProjector(accessor as CredentialFreeCaseBindingOutboxReader), /case_binding_outbox_dependency_invalid/);
  assert.equal(called, false);
  await assert.rejects(createCaseBindingOutboxProjector(new Proxy(Object.freeze({ replay }), {})), /case_binding_outbox_dependency_invalid/);

  const sparse = new Array(4_000_000_000);
  await assert.rejects(createCaseBindingOutboxProjector(Object.freeze({ replay: () => sparse })), /case_binding_outbox_page_oversized/);

  const overLimit = Object.freeze({
    replay(input: { afterSequence?: number; limit?: number } = {}) {
      const afterSequence = input.afterSequence ?? 0;
      const start = afterSequence + 1;
      if (start > CASE_BINDING_OUTBOX_MAX_RECEIPTS) return Object.freeze([entry(start, receipt(start))]);
      return Object.freeze(Array.from({ length: CASE_BINDING_OUTBOX_PAGE_SIZE }, (_, index) => entry(start + index, receipt(start + index))));
    },
  });
  await assert.rejects(createCaseBindingOutboxProjector(overLimit), /case_binding_outbox_limit_exceeded/);
});

test("durable cursor keys may contain gaps but must remain strictly increasing", async () => {
  const values = [entry(2, receipt(1)), entry(7, receipt(2))];
  const projection = await createCaseBindingOutboxProjector(replayable(values));
  assert.deepEqual(await projection.reconcile(), { afterSequence: 7, applied: 0 });
  assert.deepEqual(projection.reader.get(values[0]!.receipt.caseId), values[0]!.receipt);
  assert.deepEqual(projection.reader.get(values[1]!.receipt.caseId), values[1]!.receipt);
});

test("asynchronous replay hydrates before exposure and concurrent reconciliation is single-flight", async () => {
  const entries: CaseBindingOutboxEntryV1[] = [entry(1, receipt(1))];
  let calls = 0;
  let releasePage: () => void = () => { throw new Error("test_gate_not_initialized"); };
  const gate = (): Promise<void> => new Promise((resolve) => { releasePage = resolve; });
  let pendingGate: Promise<void> | null = null;
  const outbox: CredentialFreeCaseBindingOutboxReader = Object.freeze({
    async replay(input = {}) {
      calls += 1;
      if ((input.afterSequence ?? 0) > 0 && pendingGate) await pendingGate;
      return replayable(entries).replay(input) as readonly CaseBindingOutboxEntryV1[];
    },
  });
  const projection = await createCaseBindingOutboxProjector(outbox);
  entries.push(entry(2, receipt(2)));
  pendingGate = gate();
  const first = projection.reconcile();
  const second = projection.reconcile();
  assert.strictEqual(first, second);
  releasePage();
  assert.deepEqual(await first, { afterSequence: 2, applied: 1 });
  assert.deepEqual(projection.reader.get(entries[1]!.receipt.caseId), entries[1]!.receipt);
  assert.ok(calls >= 3);
});
