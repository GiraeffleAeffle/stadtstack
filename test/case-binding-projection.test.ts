import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createInMemoryCaseBindingProjection,
  createPublicCaseBindingReceipt,
  verifyPublicCaseBindingReceipt,
} from "../src/case-binding-projection.ts";

const CASE_ID = "urn:stadtstack:case:test:roebel-mueritz:01983a00-0000-7000-8000-000000000001";
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function receipt(
  caseId = CASE_ID,
  rootEventId = "a".repeat(64),
) {
  return createPublicCaseBindingReceipt({
    rootEventId,
    topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse",
    candidateId: `urn:stadtstack:signed-topic-suggestion:${"b".repeat(64)}`,
    candidateEventId: "b".repeat(64),
    sourceAnswerEventId: "c".repeat(64),
    caseId,
    caseVersion: 3,
    caseEventIds: [
      `urn:stadtstack:case-event:${caseId}:1`,
      `urn:stadtstack:case-event:${caseId}:2`,
      `urn:stadtstack:case-event:${caseId}:3`,
    ] as const,
    journalHeadChecksum: digest("journal"),
    admissionEventChecksum: digest("journal"),
  });
}

test("public case binding is a validated, authority-free post-hoc receipt", () => {
  const value = receipt();
  assert.equal(value.authorityBinding, "none");
  assert.equal(value.openDeskWrite, false);
  assert.deepEqual(verifyPublicCaseBindingReceipt(structuredClone(value)), value);
  assert.throws(
    () => verifyPublicCaseBindingReceipt({ ...value, openDeskWrite: true }),
    /case_binding_receipt_invalid/,
  );
  assert.throws(
    () => verifyPublicCaseBindingReceipt({ ...value, receiptChecksum: digest("forged") }),
    /case_binding_receipt_checksum_invalid/,
  );
  assert.throws(
    () => verifyPublicCaseBindingReceipt({ ...value, caseVersion: 4 }),
    /case_binding_receipt_invalid/,
  );
  assert.throws(
    () => verifyPublicCaseBindingReceipt({ ...value, admissionEventChecksum: digest("different") }),
    /case_binding_receipt_invalid/,
  );
  assert.throws(
    () => verifyPublicCaseBindingReceipt({ ...value, topicId: `urn:stadtstack:topic:municipality:roebel-mueritz:${"x".repeat(300)}` }),
    /case_binding_receipt_invalid/,
  );
});

test("binding projection exposes exact GET-only case and discussion-root lookups", () => {
  const value = receipt();
  const projection = createInMemoryCaseBindingProjection([value]);
  projection.writer.record(structuredClone(value));
  assert.equal("record" in projection.reader, false);
  assert.deepEqual(projection.reader.get(CASE_ID), value);
  assert.deepEqual(projection.reader.getByRootEventId(value.rootEventId), value);
  const result = projection.reader.respond({ method: "GET", path: `/v1/public/case-bindings/${CASE_ID}` });
  assert.equal(result.status, 200);
  assert.equal(result.headers["x-stadtstack-receipt-sha256"], value.receiptChecksum);
  assert.deepEqual(JSON.parse(result.body), value);
  const rootResult = projection.reader.respond({ method: "GET", path: `/v1/public/case-bindings/by-discussion/${value.rootEventId}` });
  assert.equal(rootResult.status, 200);
  assert.deepEqual(JSON.parse(rootResult.body), value);
  assert.equal(projection.reader.respond({ method: "POST", path: `/v1/public/case-bindings/${CASE_ID}` }).status, 405);
  assert.equal(projection.reader.respond({ method: "POST", path: `/v1/public/case-bindings/by-discussion/${value.rootEventId}` }).status, 405);
  assert.equal(projection.reader.respond({ method: "GET", path: `/v1/public/case-bindings/${CASE_ID}?x=1` }).status, 400);
  assert.equal(projection.reader.respond({ method: "GET", path: `/v1/public/case-bindings/by-discussion/${value.rootEventId}?x=1` }).status, 400);
  assert.equal(projection.reader.respond({ method: "GET", path: "/v1/public/case-bindings/unknown" }).status, 404);
});

test("a root event cannot be rebound to a different receipt", () => {
  const projection = createInMemoryCaseBindingProjection();
  const first = receipt();
  const second = receipt(
    "urn:stadtstack:case:test:roebel-mueritz:01983a00-0000-7000-8000-000000000002",
    first.rootEventId,
  );
  projection.writer.record(first);
  assert.throws(() => projection.writer.record(second), /case_binding_root_conflict/);
  assert.deepEqual(projection.reader.getByRootEventId(first.rootEventId), first);
  assert.equal(projection.reader.get(second.caseId), null);
});
