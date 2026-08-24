import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalMunicipalCaseId,
  isLegacyTestCaseId,
  parseMunicipalCaseId,
} from "../src/case-id.ts";

const MUNICIPALITY = "roebel-mueritz";
const UUID = "01983a00-0000-7000-8000-000000000001";
const CASE_ID = `urn:stadtstack:case:municipality:${MUNICIPALITY}:${UUID}`;

test("derives and parses exactly one municipality-scoped UUID-v7 Case identity", () => {
  assert.equal(canonicalMunicipalCaseId(MUNICIPALITY, UUID), CASE_ID);
  assert.deepEqual(parseMunicipalCaseId(CASE_ID), {
    municipalityId: MUNICIPALITY,
    uuidV7: UUID,
    caseId: CASE_ID,
  });
});

test("rejects legacy, malformed, cross-namespace, and non-v7 Case identities", () => {
  const legacy = `urn:stadtstack:case:test:${MUNICIPALITY}:${UUID}`;
  assert.equal(isLegacyTestCaseId(legacy), true);
  assert.equal(isLegacyTestCaseId(CASE_ID), false);
  assert.equal(parseMunicipalCaseId(legacy), null);
  assert.equal(parseMunicipalCaseId(`urn:stadtstack:case:municipality:${MUNICIPALITY}:01983a00-0000-6000-8000-000000000001`), null);
  assert.equal(canonicalMunicipalCaseId("Röbel", UUID), null);
});
