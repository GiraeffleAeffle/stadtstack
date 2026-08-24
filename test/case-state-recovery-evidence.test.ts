import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createCaseStateRecoveryEvidence,
  verifyCaseStateRecoveryEvidence,
  type CaseStateRecoveryJournalHeadV1,
} from "../src/case-state-recovery-evidence.ts";
import { createPublicCaseBindingReceipt, type PublicCaseBindingReceiptV1 } from "../src/case-binding-projection.ts";
import type { CaseBindingOutboxEntryV1 } from "../src/case-binding-outbox.ts";

const digest = (value: unknown): `sha256:${string}` => `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
const hex = (value: number): string => value.toString(16).padStart(64, "0");

function caseId(value: number): string {
  return `urn:stadtstack:case:municipality:roebel-mueritz:01983a00-0000-7000-8000-${value.toString(16).padStart(12, "0")}`;
}

function receipt(value: number): PublicCaseBindingReceiptV1 {
  const id = caseId(value);
  const candidateEventId = hex(100_000 + value);
  const head = digest(`journal-${value}`);
  return createPublicCaseBindingReceipt({
    rootEventId: hex(value),
    topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse",
    candidateId: `urn:stadtstack:signed-topic-suggestion:${candidateEventId}`,
    candidateEventId,
    sourceAnswerEventId: hex(200_000 + value),
    caseId: id,
    caseVersion: 3,
    caseEventIds: [
      `urn:stadtstack:case-event:${id}:1`,
      `urn:stadtstack:case-event:${id}:2`,
      `urn:stadtstack:case-event:${id}:3`,
    ] as const,
    journalHeadChecksum: head,
    admissionEventChecksum: head,
  });
}

function entry(sequence: number, value: number): CaseBindingOutboxEntryV1 {
  return Object.freeze({ sequence, receipt: receipt(value) });
}

function head(value: number): CaseStateRecoveryJournalHeadV1 {
  const item = receipt(value);
  return Object.freeze({ caseId: item.caseId, caseVersion: item.caseVersion, journalHeadChecksum: item.journalHeadChecksum });
}

test("creates deterministic, deeply frozen evidence from the ordered journal and outbox", () => {
  const input = {
    caseJournalHeads: [head(1), head(2)],
    outboxEntries: [entry(4, 1), entry(9, 2)],
  } as const;
  const evidence = createCaseStateRecoveryEvidence(input);
  const replay = createCaseStateRecoveryEvidence(structuredClone(input));

  assert.equal(evidence.schemaVersion, "case_state_recovery_evidence_v1");
  assert.equal(evidence.outboxCursor, 9);
  assert.equal(evidence.projectionEntryCount, 2);
  assert.deepEqual(evidence, replay);
  assert.match(evidence.headsAggregateChecksum, /^sha256:[0-9a-f]{64}$/u);
  assert.match(evidence.publicProjectionChecksum, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(evidence.orderedBindingEvidence[0]!.caseId, caseId(1));
  assert.match(evidence.orderedBindingEvidence[0]!.caseIdResponseBodyChecksum, /^sha256:[0-9a-f]{64}$/u);
  assert.match(evidence.orderedBindingEvidence[0]!.discussionRootResponseBodyChecksum, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(Object.isFrozen(evidence.orderedHeads), true);
  assert.equal(Object.isFrozen(evidence.orderedHeads[0]), true);
  assert.equal(Object.isFrozen(evidence.orderedBindingEvidence), true);
  assert.equal(Object.isFrozen(evidence.orderedBindingEvidence[0]), true);
});

test("strict verification normalizes valid evidence and rejects forged aggregates or transport metadata", () => {
  const evidence = createCaseStateRecoveryEvidence({ caseJournalHeads: [head(1)], outboxEntries: [entry(3, 1)] });
  assert.deepEqual(verifyCaseStateRecoveryEvidence(evidence), evidence);

  const forged = structuredClone(evidence) as { publicProjectionChecksum: string };
  forged.publicProjectionChecksum = digest("forged");
  assert.throws(() => verifyCaseStateRecoveryEvidence(forged), /case_state_recovery_projection_checksum_invalid/u);

  const withHeaders = structuredClone(evidence) as Record<string, unknown>;
  withHeaders.headers = {};
  assert.throws(() => verifyCaseStateRecoveryEvidence(withHeaders), /case_state_recovery_evidence_invalid/u);
});

test("recovery rejects non-canonical order, duplicates, gaps in case sets, and mismatched heads", () => {
  assert.throws(() => createCaseStateRecoveryEvidence({
    caseJournalHeads: [head(2), head(1)],
    outboxEntries: [entry(1, 1), entry(2, 2)],
  }), /case_state_recovery_heads_not_canonical/u);
  assert.throws(() => createCaseStateRecoveryEvidence({
    caseJournalHeads: [head(1), head(1)],
    outboxEntries: [entry(1, 1), entry(2, 1)],
  }), /case_state_recovery_head_duplicate/u);
  assert.throws(() => createCaseStateRecoveryEvidence({
    caseJournalHeads: [head(1)],
    outboxEntries: [entry(1, 2)],
  }), /case_state_recovery_case_set_mismatch|case_state_recovery_case_mismatch/u);
  const wrongHead = { ...head(1), journalHeadChecksum: digest("wrong") };
  assert.throws(() => createCaseStateRecoveryEvidence({
    caseJournalHeads: [wrongHead],
    outboxEntries: [entry(1, 1)],
  }), /case_state_recovery_case_mismatch/u);
  const regressedHead = { ...head(1), caseVersion: 2 };
  assert.throws(() => createCaseStateRecoveryEvidence({
    caseJournalHeads: [regressedHead],
    outboxEntries: [entry(1, 1)],
  }), /case_state_recovery_head_invalid/u);
  assert.throws(() => createCaseStateRecoveryEvidence({
    caseJournalHeads: [head(1), head(2)],
    outboxEntries: [entry(2, 1), entry(1, 2)],
  }), /case_state_recovery_outbox_sequence_invalid/u);
});

test("keeps the current journal head separate from the immutable admission receipt", () => {
  const continuedHead = {
    ...head(1),
    caseVersion: 5,
    journalHeadChecksum: digest("continued-journal-head"),
  };
  const evidence = createCaseStateRecoveryEvidence({
    caseJournalHeads: [continuedHead],
    outboxEntries: [entry(1, 1)],
  });

  assert.deepEqual(evidence.orderedHeads, [continuedHead]);
  assert.equal(evidence.orderedBindingEvidence[0]!.receiptChecksum, receipt(1).receiptChecksum);
  assert.deepEqual(verifyCaseStateRecoveryEvidence(evidence), evidence);
});

test("empty journal and outbox produce a valid zero-cursor, zero-entry seal", () => {
  const evidence = createCaseStateRecoveryEvidence({ caseJournalHeads: [], outboxEntries: [] });
  assert.equal(evidence.outboxCursor, 0);
  assert.equal(evidence.projectionEntryCount, 0);
  assert.deepEqual(evidence.orderedHeads, []);
  assert.deepEqual(evidence.orderedBindingEvidence, []);
  assert.deepEqual(verifyCaseStateRecoveryEvidence(evidence), evidence);
});

test("fails closed on proxies, accessors, malformed checksums, and more than ten thousand entries", () => {
  const proxy = new Proxy([head(1)], {});
  assert.throws(() => createCaseStateRecoveryEvidence({ caseJournalHeads: proxy, outboxEntries: [entry(1, 1)] }), /case_state_recovery_heads_invalid/u);

  const accessor: Record<string, unknown> = {};
  Object.defineProperty(accessor, "caseId", { enumerable: true, get() { throw new Error("getter_ran"); } });
  Object.defineProperty(accessor, "caseVersion", { enumerable: true, value: 3 });
  Object.defineProperty(accessor, "journalHeadChecksum", { enumerable: true, value: digest("head") });
  assert.throws(() => createCaseStateRecoveryEvidence({ caseJournalHeads: [accessor as unknown as CaseStateRecoveryJournalHeadV1], outboxEntries: [] }), /case_state_recovery_head_invalid/u);

  const malformed = { ...head(1), journalHeadChecksum: "sha256:bad" };
  assert.throws(() => createCaseStateRecoveryEvidence({ caseJournalHeads: [malformed], outboxEntries: [entry(1, 1)] }), /case_state_recovery_head_invalid/u);

  const preAdmission = { ...head(1), caseVersion: 2 };
  assert.throws(() => createCaseStateRecoveryEvidence({ caseJournalHeads: [preAdmission], outboxEntries: [entry(1, 1)] }), /case_state_recovery_head_invalid/u);

  const tooMany = new Array(10_001);
  assert.throws(() => createCaseStateRecoveryEvidence({ caseJournalHeads: tooMany, outboxEntries: [] }), /case_state_recovery_entry_limit_exceeded/u);
});
