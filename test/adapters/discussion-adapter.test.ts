import assert from "node:assert/strict";
import test from "node:test";

import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
} from "nostr-tools/pure";
import {
  createNostrDiscussionAdapter,
  createSyntheticDiscussionAdapter,
  STADTSTACK_E2E_FIXTURE_TAG,
  type DiscussionScope,
} from "../../src/adapters/discussion-adapter.ts";

const scope: DiscussionScope = {
  municipalityId: "sample-municipality",
  caseId: "sample-case",
};

function signedDiscussionEvent(kind = 1) {
  const secretKey = generateSecretKey();
  const event = finalizeEvent(
    {
      kind,
      created_at: 1_754_035_200,
      tags: [
        ["municipality", scope.municipalityId],
        ["case", scope.caseId],
      ],
      content: "Could the crossing be made safer?",
    },
    secretKey,
  );
  return { event, secretKey };
}

test("synthetic discussion fixtures normalize deterministically into an authority-free scoped artifact", () => {
  const adapter = createSyntheticDiscussionAdapter({ scope, allowedKinds: [1] });
  const fixture = {
    fixtureId: "fixture-crossing-1",
    scope,
    kind: 1,
    createdAt: 1_754_035_200,
    content: "Could the crossing be made safer?",
    tags: [["municipality", scope.municipalityId], ["case", scope.caseId], ["t", "crossing"]],
    relayRefs: ["wss://relay.example.test"],
    pubkey: "synthetic-pubkey-1",
  };

  const first = adapter.normalize(fixture);
  const second = adapter.ingest({ ...fixture, tags: fixture.tags.map((tag) => [...tag]) });

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    schemaVersion: "discussion_artifact_v1",
    id: "synthetic:fixture-crossing-1",
    source: "synthetic_fixture",
    sourceRef: "synthetic://discussion/fixture-crossing-1",
    municipalityId: scope.municipalityId,
    caseId: scope.caseId,
    authorityBinding: "none",
    verificationProof: {
      kind: "synthetic_fixture",
      deterministic: true,
      fixtureId: "fixture-crossing-1",
    },
    event: {
      id: "synthetic:fixture-crossing-1",
      pubkey: "synthetic-pubkey-1",
      createdAt: 1_754_035_200,
      kind: 1,
      content: "Could the crossing be made safer?",
      tags: [
        ["municipality", scope.municipalityId],
        ["case", scope.caseId],
        ["t", "crossing"],
      ],
      relayRefs: ["wss://relay.example.test"],
    },
  });
  assert.equal(first.authorityBinding, "none");
});

test("the synthetic fixture lane requires the standards-compatible app marker", () => {
  const { event } = signedDiscussionEvent();
  const fixtureEvent = finalizeEvent(
    {
      kind: event.kind,
      created_at: event.created_at,
      tags: [...event.tags, [...STADTSTACK_E2E_FIXTURE_TAG]],
      content: event.content,
    },
    generateSecretKey(),
  );

  const fixtureAdapter = createNostrDiscussionAdapter({
    scope,
    syntheticFixtureOnly: true,
  });
  const artifact = fixtureAdapter.normalize(fixtureEvent);
  assert.ok(
    artifact.event.tags.some(
      ([name, value]) => name === STADTSTACK_E2E_FIXTURE_TAG[0] && value === STADTSTACK_E2E_FIXTURE_TAG[1],
    ),
  );

  assert.throws(
    () =>
      createNostrDiscussionAdapter({
        scope,
        syntheticFixtureOnly: true,
      }).normalize(event),
    /discussion_fixture_marker_required/,
  );

  const legacyMarkerEvent = finalizeEvent(
    {
      kind: event.kind,
      created_at: event.created_at,
      tags: [...event.tags, ["e", STADTSTACK_E2E_FIXTURE_TAG[1]]],
      content: event.content,
    },
    generateSecretKey(),
  );
  assert.throws(
    () =>
      createNostrDiscussionAdapter({
        scope,
        syntheticFixtureOnly: true,
      }).normalize(legacyMarkerEvent),
    /discussion_fixture_marker_required/,
  );

  const syntheticAdapter = createSyntheticDiscussionAdapter({
    scope,
    syntheticFixtureOnly: true,
  });
  assert.throws(
    () =>
      syntheticAdapter.normalize({
        fixtureId: "fixture-marker-required",
        scope,
        createdAt: 1_754_035_200,
        content: "A marker is required at the synthetic boundary.",
      }),
    /discussion_fixture_marker_required/,
  );
  assert.equal(
    syntheticAdapter.normalize({
      fixtureId: "fixture-marker-required",
      scope,
      createdAt: 1_754_035_200,
      content: "A marker is required at the synthetic boundary.",
      tags: [[...STADTSTACK_E2E_FIXTURE_TAG]],
    }).verificationProof.kind,
    "synthetic_fixture",
  );
});

test("a signed Nostr discussion verifies its NIP-01 id and signature before normalization", () => {
  const secretKey = generateSecretKey();
  const event = finalizeEvent(
    {
      kind: 1,
      created_at: 1_754_035_200,
      tags: [
        ["municipality", scope.municipalityId],
        ["case", scope.caseId],
        ["relay", "wss://relay.example.test"],
      ],
      content: "Could the crossing be made safer?",
    },
    secretKey,
  );
  assert.equal(verifyEvent(event), true);
  assert.equal(event.pubkey, getPublicKey(secretKey));

  const artifact = createNostrDiscussionAdapter({
    scope,
    allowedKinds: [1, 42],
  }).normalize({
    event,
    relayRefs: ["wss://relay.example.test"],
  });

  assert.equal(artifact.source, "nostr");
  assert.equal(artifact.id, event.id);
  assert.equal(artifact.sourceRef, `nostr://event/${event.id}`);
  assert.equal(artifact.municipalityId, scope.municipalityId);
  assert.equal(artifact.caseId, scope.caseId);
  assert.equal(artifact.authorityBinding, "none");
  assert.deepEqual(artifact.event, {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    kind: 1,
    content: event.content,
    tags: event.tags,
    relayRefs: ["wss://relay.example.test"],
  });
});

test("normalized Nostr artifacts retain a clone-safe public NIP-01 verification proof", () => {
  const { event } = signedDiscussionEvent();
  const adapter = createNostrDiscussionAdapter({ scope });
  const artifact = adapter.normalize(event);

  assert.deepEqual(artifact.verificationProof, {
    kind: "nostr_nip01",
    verified: true,
    signature: event.sig,
  });
  assert.equal(artifact.verificationProof.kind, "nostr_nip01");
  if (artifact.verificationProof.kind !== "nostr_nip01") {
    throw new Error("expected_nostr_verification_proof");
  }
  const proof = artifact.verificationProof;
  const reconstructedEvent = {
    id: artifact.id,
    pubkey: artifact.event.pubkey,
    created_at: artifact.event.createdAt,
    kind: artifact.event.kind,
    tags: artifact.event.tags,
    content: artifact.event.content,
    sig: proof.signature,
  };
  assert.equal(verifyEvent(reconstructedEvent), true);

  const mutated = adapter.normalize(event);
  assert.equal(mutated.verificationProof.kind, "nostr_nip01");
  if (mutated.verificationProof.kind !== "nostr_nip01") {
    throw new Error("expected_nostr_verification_proof");
  }
  mutated.verificationProof.signature = "tampered";
  mutated.event.tags[0]![1] = "tampered";
  const replay = adapter.normalize(event);
  if (replay.verificationProof.kind !== "nostr_nip01") {
    throw new Error("expected_nostr_verification_proof");
  }
  assert.equal(replay.verificationProof.signature, event.sig);
  assert.equal(replay.event.tags[0]![1], scope.municipalityId);
});

test("signed Nostr discussions reject an invalid id or signature", () => {
  const adapter = createNostrDiscussionAdapter({ scope });
  const { event } = signedDiscussionEvent();

  assert.throws(
    () =>
      adapter.normalize({
        event: { ...event, id: "0".repeat(64) },
      }),
    /discussion_event_id_invalid|id_invalid/,
  );
  assert.throws(
    () =>
      adapter.normalize({
        event: { ...event, sig: "0".repeat(128) },
      }),
    /discussion_event_signature_invalid|signature_invalid/,
  );
});

test("discussion adapters enforce configured event kinds without changing authority", () => {
  const { event } = signedDiscussionEvent(42);
  assert.throws(
    () => createNostrDiscussionAdapter({ scope }).normalize(event),
    /discussion_kind_forbidden|kind/,
  );

  const artifact = createNostrDiscussionAdapter({
    scope,
    allowedKinds: [1, 42],
  }).normalize(event);
  assert.equal(artifact.event.kind, 42);
  assert.equal(artifact.authorityBinding, "none");
});

test("discussion adapters fail closed when municipality or case scope is missing or mismatched", () => {
  const { event } = signedDiscussionEvent();
  assert.throws(
    () =>
      createNostrDiscussionAdapter({
        scope: { municipalityId: scope.municipalityId, caseId: "other-case" },
      }).normalize(event),
    /discussion_scope_mismatch|scope/,
  );

  const secretKey = generateSecretKey();
  const unscopedEvent = finalizeEvent(
    {
      kind: 1,
      created_at: 1_754_035_200,
      tags: [["t", "crossing"]],
      content: "An event without a municipality and case scope.",
    },
    secretKey,
  );
  assert.throws(
    () =>
      createNostrDiscussionAdapter({ scope }).normalize(unscopedEvent),
    /discussion_scope_missing|scope/,
  );
});

test("discussion adapters are idempotent for identical events and reject duplicate conflicts", () => {
  const adapter = createSyntheticDiscussionAdapter({ scope });
  const fixture = {
    fixtureId: "fixture-duplicate-1",
    scope,
    createdAt: 1_754_035_200,
    content: "Original synthetic discussion.",
  };
  const first = adapter.normalize(fixture);
  const replay = adapter.normalize({ ...fixture });
  assert.deepEqual(replay, first);

  assert.throws(
    () =>
      adapter.normalize({
        ...fixture,
        content: "Conflicting synthetic discussion.",
      }),
    /discussion_duplicate_conflict|duplicate_conflict/,
  );
  assert.deepEqual(adapter.normalize(fixture), first);
});

test("signed-event replay canonicalizes relay-reference order but rejects real metadata changes", () => {
  const { event } = signedDiscussionEvent();
  const adapter = createNostrDiscussionAdapter({ scope });
  const first = adapter.normalize({
    event,
    relayRefs: ["wss://relay-z.example.test", "wss://relay-a.example.test", "wss://relay-z.example.test"],
  });
  const replay = adapter.normalize({
    event,
    relayRefs: ["wss://relay-a.example.test", "wss://relay-z.example.test", "wss://relay-a.example.test"],
  });

  assert.deepEqual(replay, first);
  assert.deepEqual(first.event.relayRefs, [
    "wss://relay-a.example.test",
    "wss://relay-z.example.test",
  ]);
  assert.deepEqual(first.event.tags, event.tags);

  assert.throws(
    () =>
      adapter.normalize({
        event,
        relayRefs: ["wss://relay-a.example.test", "wss://relay-new.example.test"],
      }),
    /discussion_duplicate_conflict|duplicate_conflict/,
  );
});
