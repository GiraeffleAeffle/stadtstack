import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { finalizeEvent } from "nostr-tools/pure";
import { hexToBytes } from "@noble/hashes/utils.js";

import {
  createLocalPublicExchangeRelay,
  createPublicExchangeAdapter,
  createPublicExchangeRecord,
  reimportPublicExchangeEvent,
  signPublicExchangeRecord,
  verifyRegistrySnapshot,
  PUBLIC_EXCHANGE_DISCLOSURE_POLICY,
  PUBLIC_EXCHANGE_KIND,
} from "../src/adapters/public-exchange-adapter.ts";

const caseId = "urn:stadtstack:case:municipality:sample-municipality:018f0000-0000-7000-8000-000000000001";
const municipalityId = "sample-municipality";
const policyVersion = "case-intake-v1";
const signer = {
  seed: "stadtstack-public-exchange-fixture-seed",
  workerIdentityId: "did:stadtstack:sample:exchange-agent",
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex")}`;
}

function fixtureSecretKey(): Uint8Array {
  return hexToBytes(createHash("sha256").update(signer.seed, "utf8").digest("hex"));
}

function reviewedProjection(summary = "Reviewed crossing safety responses.", caseVersion = 27) {
  const sourceBindings = ["planning", "traffic", "environment", "finance", "legal", "public-order", "social-affairs", "public-works"].map((departmentId) => ({
    packageId: `package-${departmentId}`,
    departmentId,
    packageChecksum: sha256({ packageId: `package-${departmentId}` }),
    draftArtifactChecksum: sha256({ draft: departmentId }),
    reviewAttestationChecksum: sha256({ review: departmentId }),
    reviewedAt: "2026-08-08T00:00:05.000Z",
  }));
  const briefBase = {
    schemaVersion: "citizen_brief_projection_v1",
    id: "urn:stadtstack:citizen-brief:sample-case:1",
    title: "Crossing safety",
    summary,
    responses: sourceBindings.map(({ departmentId }) => ({
      departmentId,
      publicSummary: `Reviewed ${departmentId} response.`,
      publicCitations: [`synthetic://${departmentId}/evidence-1`],
    })),
    provenance: {
      sourceDiscussionRef: {
        type: "nostr_event",
        id: "44ac22db49995e6ec96344b624d3ee01eb50ad814cf80f51af05959bb305412c",
        ref: "nostr://event/44ac22db49995e6ec96344b624d3ee01eb50ad814cf80f51af05959bb305412c",
      },
      suggestionId: "urn:stadtstack:suggestion:44ac22db49995e6ec96344b624d3ee01eb50ad814cf80f51af05959bb305412c",
      packageBindings: sourceBindings,
    },
    policyVersion,
    correctionState: "current",
    authorityBinding: "none",
  };
  const brief = { ...briefBase, briefChecksum: sha256(briefBase) };
  const projection = {
    schemaVersion: "case_projection_v1",
    caseId,
    municipalityId,
    authorityBinding: "none",
    formalDecision: null,
    reviewedCitizenBrief: brief,
  };
  const projectionChecksum = sha256({
    schemaVersion: "projection_envelope_v1",
    caseId,
    caseVersion,
    visibility: "public",
    policyVersion,
    projection,
  });
  return {
    schemaVersion: "projection_envelope_v1",
    caseId,
    caseVersion,
    journalHeadChecksum: sha256("journal-head"),
    projectionChecksum,
    visibility: "public",
    policyVersion,
    projection,
  } as any;
}

function recomputeProjectionChecksum(envelope: any): any {
  envelope.projectionChecksum = sha256({
    schemaVersion: "projection_envelope_v1",
    caseId: envelope.caseId,
    caseVersion: envelope.caseVersion,
    visibility: envelope.visibility,
    policyVersion: envelope.policyVersion,
    projection: envelope.projection,
  });
  return envelope;
}

test("maps the current public reviewed brief into a closed exchange record", () => {
  const record = createPublicExchangeRecord(reviewedProjection(), {
    signer: {
      seed: "stadtstack-public-exchange-fixture-seed",
      workerIdentityId: "did:stadtstack:sample:exchange-agent",
    },
  });

  assert.equal(record.schemaVersion, "public_exchange_record_v1");
  assert.equal(record.eventKind, PUBLIC_EXCHANGE_KIND);
  assert.equal(record.canonicalCaseId, caseId);
  assert.equal(record.municipalityId, municipalityId);
  assert.equal(record.visibility, "public");
  assert.equal(record.disclosurePolicy, PUBLIC_EXCHANGE_DISCLOSURE_POLICY);
  assert.equal(record.authorityBinding, "none");
  assert.equal(record.artifact.kind, "reviewed_citizen_brief_v1");
  assert.equal(record.artifact.correctionState, "current");
  assert.ok(record.artifact.public);
  assert.equal(record.signer.bot, true);
  assert.equal(record.aiAttribution.authorityBinding, "none");
  assert.match(record.recordChecksum, /^sha256:[a-f0-9]{64}$/);
});

test("rejects legacy and cross-municipality Case IDs even after checksum recomputation", () => {
  const legacyCaseId = "urn:stadtstack:case:test:sample-municipality:018f0000-0000-7000-8000-000000000001";
  const otherMunicipalityCaseId = "urn:stadtstack:case:municipality:other-municipality:018f0000-0000-7000-8000-000000000001";
  const valid = createPublicExchangeRecord(reviewedProjection(), { signer });

  for (const [reboundCaseId, municipality] of [
    [legacyCaseId, municipalityId],
    [otherMunicipalityCaseId, municipalityId],
  ] as const) {
    const rebound = structuredClone(valid);
    rebound.canonicalCaseId = reboundCaseId;
    rebound.municipalityId = municipality;
    rebound.recordId = `urn:stadtstack:public-exchange:${sha256({ caseId: reboundCaseId, artifactKind: "reviewed_citizen_brief_v1" }).slice("sha256:".length)}`;
    rebound.recordChecksum = sha256(Object.fromEntries(Object.entries(rebound).filter(([key]) => key !== "recordChecksum")));
    assert.throws(
      () => signPublicExchangeRecord(rebound, signer),
      /public_exchange_case_id_invalid|public_exchange_case_municipality_mismatch/u,
    );
  }

  const relay = createLocalPublicExchangeRelay();
  assert.throws(() => createPublicExchangeAdapter({
    source: { project: () => reviewedProjection() },
    caseId: legacyCaseId,
    policyVersion,
    publicActor: { actorId: "synthetic:public-1", actorClass: "public" },
    signer,
    relay,
  }), /public_exchange_case_id_invalid/u);

  const crossMunicipality = createPublicExchangeAdapter({
    source: {
      project: () => {
        const envelope = reviewedProjection();
        envelope.caseId = otherMunicipalityCaseId;
        envelope.projection.caseId = otherMunicipalityCaseId;
        return recomputeProjectionChecksum(envelope);
      },
    },
    caseId: otherMunicipalityCaseId,
    policyVersion,
    publicActor: { actorId: "synthetic:public-1", actorClass: "public" },
    signer,
    relay,
  });
  assert.throws(
    () => crossMunicipality.createCurrentRecord(),
    /public_exchange_case_municipality_mismatch/u,
  );
});

test("signs an exact kind-39999 event and reimports its canonical content", () => {
  const record = createPublicExchangeRecord(reviewedProjection(), { signer });
  const event = signPublicExchangeRecord(record, signer);
  assert.equal(event.kind, PUBLIC_EXCHANGE_KIND);
  assert.equal(event.created_at, 1_754_035_205);
  assert.deepEqual(event.tags, [
    ["d", record.recordId],
    ["t", "stadtstack-e2e-fixture"],
    ["schema", "public_exchange_record_v1"],
    ["municipality", "sample-municipality"],
    ["case", "sample-case"],
    ["artifact", "reviewed_citizen_brief_v1"],
    ["bot", "true"],
    ["node", "stadtstack-public-exchange-test"],
    ["agent", "stadtstack-public-exchange-v1"],
  ]);
  assert.deepEqual(reimportPublicExchangeEvent(event), record);
  assert.throws(() => signPublicExchangeRecord(record, { seed: "different-fixture-seed", workerIdentityId: signer.workerIdentityId }), /signer_mismatch/);
});

test("local exchange relay provides OK, addressable REQ/EOSE, and idempotent reimport", async () => {
  const relay = createLocalPublicExchangeRelay();
  const record = createPublicExchangeRecord(reviewedProjection(), { signer });
  const event = signPublicExchangeRecord(record, signer);
  const first = await relay.publish(event);
  const second = await relay.publish(event);
  const query = await relay.query({ kind: PUBLIC_EXCHANGE_KIND, pubkey: event.pubkey, d: record.recordId });
  assert.deepEqual(first.ack, ["OK", event.id, true]);
  assert.deepEqual(second.ack, first.ack);
  assert.equal(query.eose, true);
  assert.equal(query.events.length, 1);
  assert.deepEqual(relay.reimport(query.events[0]!), record);
  assert.equal(relay.publishCount, 2);
  assert.equal(relay.queryCount, 1);
  await assert.rejects(relay.query({ recordId: record.recordId, extra: "unknown" } as any), /query_invalid/);
  await assert.rejects(relay.query({ kind: 30078, pubkey: event.pubkey, d: record.recordId }), /query_invalid/);
});

test("reimport rejects a validly signed partial record even after checksum recomputation", async () => {
  const record = createPublicExchangeRecord(reviewedProjection(), { signer });
  const partial = structuredClone(record);
  assert.ok(partial.artifact.public);
  partial.artifact.public.responses = partial.artifact.public.responses.slice(0, 7);
  partial.provenance.sourceBindings = partial.provenance.sourceBindings.slice(0, 7);
  partial.reviewAttestations = partial.reviewAttestations.slice(0, 7);
  partial.recordChecksum = sha256(Object.fromEntries(Object.entries(partial).filter(([key]) => key !== "recordChecksum")));
  const event = finalizeEvent({
    kind: PUBLIC_EXCHANGE_KIND,
    created_at: 1_754_035_205,
    tags: [["d", partial.recordId], ["t", "stadtstack-e2e-fixture"], ["schema", "public_exchange_record_v1"], ["municipality", "sample-municipality"], ["case", "sample-case"], ["artifact", "reviewed_citizen_brief_v1"], ["bot", "true"], ["node", "stadtstack-public-exchange-test"], ["agent", "stadtstack-public-exchange-v1"]],
    content: JSON.stringify(canonical(partial)),
  }, fixtureSecretKey());
  assert.throws(() => reimportPublicExchangeEvent(event), /provenance_invalid|review_attestations_invalid|artifact_responses_invalid/);

  const mismatchedSigner = structuredClone(record);
  mismatchedSigner.signer.pubkey = "00".repeat(64);
  mismatchedSigner.recordChecksum = sha256(Object.fromEntries(Object.entries(mismatchedSigner).filter(([key]) => key !== "recordChecksum")));
  const mismatchedEvent = finalizeEvent({
    kind: PUBLIC_EXCHANGE_KIND,
    created_at: 1_754_035_205,
    tags: [["d", mismatchedSigner.recordId], ["t", "stadtstack-e2e-fixture"], ["schema", "public_exchange_record_v1"], ["municipality", "sample-municipality"], ["case", "sample-case"], ["artifact", "reviewed_citizen_brief_v1"], ["bot", "true"], ["node", "stadtstack-public-exchange-test"], ["agent", "stadtstack-public-exchange-v1"]],
    content: JSON.stringify(canonical(mismatchedSigner)),
  }, fixtureSecretKey());
  assert.throws(() => reimportPublicExchangeEvent(mismatchedEvent), /signer_invalid|event_signer_mismatch/);
  const relay = createLocalPublicExchangeRelay();
  await assert.rejects(relay.publish(mismatchedEvent), /signer_invalid|event_signer_mismatch/);
});

test("adapter corrections and retractions replace the same addressable coordinate", async () => {
  let envelope = reviewedProjection();
  const relay = createLocalPublicExchangeRelay();
  const adapter = createPublicExchangeAdapter({
    source: { project: () => envelope },
    caseId,
    policyVersion,
    publicActor: { actorId: "synthetic:public-1", actorClass: "public" },
    signer,
    relay,
  });
  const initial = adapter.createCurrentRecord();
  await adapter.publishAndQuery(initial);
  envelope = reviewedProjection("Reviewed crossing safety correction.", 28);
  const correction = adapter.createCorrectionRecord(initial);
  assert.equal(correction.recordId, initial.recordId);
  assert.equal(correction.artifact.version, initial.artifact.version + 1);
  assert.equal(correction.correctionReference.relation, "corrects");
  await adapter.publishAndQuery(correction);
  const retraction = adapter.createRetractionRecord(correction);
  assert.equal(retraction.artifact.correctionState, "retracted");
  assert.equal(retraction.artifact.public, null);
  assert.equal(retraction.correctionReference.relation, "retracts");
  await adapter.publishAndQuery(retraction);
  const query = await relay.query(retraction.recordId);
  assert.equal(query.events[0]!.id, adapter.sign(retraction).id);

  const lateCorrection = structuredClone(retraction);
  lateCorrection.artifact.correctionState = "current";
  assert.ok(correction.artifact.public);
  lateCorrection.artifact.public = correction.artifact.public;
  lateCorrection.artifact.version += 1;
  lateCorrection.correctionReference = { relation: "corrects", recordId: correction.recordId, priorChecksum: retraction.recordChecksum };
  lateCorrection.recordChecksum = sha256(Object.fromEntries(Object.entries(lateCorrection).filter(([key]) => key !== "recordChecksum")));
  assert.rejects(relay.publish(adapter.sign(lateCorrection)), /coordinate_retracted/);
});

test("registry snapshot verification is injected and fail-closed on collision", () => {
  const rawYaml = "kinds:\n  1:\n    name: Example\n  30078:\n    name: Application-specific Data\n";
  const bytes = new TextEncoder().encode(rawYaml);
  const blobSha1 = createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${bytes.byteLength}\0`, "utf8"), Buffer.from(bytes)])).digest("hex");
  const rawSha256 = createHash("sha256").update(bytes).digest("hex");
  const proof = { rawYaml, sourceUrl: "synthetic://registry", gitBlobSha1: blobSha1, rawSha256, byteLength: bytes.byteLength, observedAt: "2026-08-08" };
  assert.deepEqual(verifyRegistrySnapshot(proof, { candidateKind: 39999 }), { parsedKindCount: 2, candidateAbsent: true });
  assert.throws(() => verifyRegistrySnapshot({ ...proof, rawYaml: rawYaml.replace("  1:", "  39999:") }, { candidateKind: 39999 }), /snapshot_digest|kind_occupied/);
});

test("mapper fails closed for non-public, invalidated, private, and unknown projection data", () => {
  const invalidated = recomputeProjectionChecksum(reviewedProjection());
  invalidated.projection.reviewedCitizenBrief.correctionState = "invalidated";
  recomputeProjectionChecksum(invalidated);
  assert.throws(() => createPublicExchangeRecord(invalidated, { signer }), /brief_not_current/);

  const privateProjection = recomputeProjectionChecksum(reviewedProjection());
  privateProjection.projection.privateEvidenceRefs = ["synthetic://private/evidence"];
  recomputeProjectionChecksum(privateProjection);
  assert.throws(() => createPublicExchangeRecord(privateProjection, { signer }), /disclosure_forbidden/);

  const unknownBrief = recomputeProjectionChecksum(reviewedProjection());
  unknownBrief.projection.reviewedCitizenBrief.unexpected = "no aliases";
  recomputeProjectionChecksum(unknownBrief);
  assert.throws(() => createPublicExchangeRecord(unknownBrief, { signer }), /artifact_invalid/);

  const administration = recomputeProjectionChecksum(reviewedProjection());
  administration.visibility = "administration";
  recomputeProjectionChecksum(administration);
  assert.throws(() => createPublicExchangeRecord(administration, { signer }), /projection_scope_invalid/);
});
