import assert from "node:assert/strict";
import test from "node:test";

import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import {
  createInMemoryNostrRelayTransport,
  createNostrRelayTransport,
  type NostrRelayClient,
} from "../../src/adapters/nostr-relay-transport.ts";

const scope = { municipalityId: "sample-municipality", caseId: "sample-case" };
const relayUrl = "wss://relay.synthetic.invalid";

function signedEvent(kind = 1) {
  const secretKey = generateSecretKey();
  const event = finalizeEvent({
    kind,
    created_at: 1_754_035_200,
    tags: [
      ["municipality", scope.municipalityId],
      ["case", scope.caseId],
      ["t", "stadtstack-e2e-fixture"],
    ],
    content: "Could the crossing be made safer?",
  }, secretKey);
  return event;
}

function signedEventWithTags(tags: string[][], content = "Could the crossing be made safer?") {
  const secretKey = generateSecretKey();
  return finalizeEvent({
    kind: 1,
    created_at: 1_754_035_200,
    tags,
    content,
  }, secretKey);
}

function transportFor(event = signedEvent()) {
  return {
    event,
    transport: createInMemoryNostrRelayTransport({
      relayUrl,
      scope,
      fixtureSignerPubkey: event.pubkey,
    }),
  };
}

test("validated in-memory relay requires explicit OK/EOSE and is replay-idempotent", async () => {
  const { event, transport } = transportFor();
  const receipt = await transport.publishAndQuery(event, { eventId: event.id, scope });
  assert.equal(receipt.publish.ok, true);
  assert.equal(receipt.query.eose, true);
  assert.equal(receipt.event.id, event.id);
  assert.equal(transport.publishCount, 1);
  assert.equal(transport.queryCount, 1);

  await transport.publish(event);
  assert.equal(transport.publishCount, 1);
  await transport.query({ eventId: event.id, scope });
  assert.equal(transport.queryCount, 2);
});

test("relay transport rejects public relay URLs, unallowlisted signers, and forbidden kinds", () => {
  const event = signedEvent();
  assert.throws(() => createNostrRelayTransport({
    relayUrl: "wss://relay.example.com",
    fixtureSignerPubkey: event.pubkey,
    client: { publish: () => ({ ok: true, eventId: event.id }), query: () => ({ events: [event], eose: true }) },
  }), /nostr_relay_external_url_forbidden/);
  assert.throws(
    () =>
      createInMemoryNostrRelayTransport({
        relayUrl,
        scope,
        fixtureSignerPubkey: event.pubkey,
        allowedKinds: [42],
      }),
    /nostr_relay_allowed_kinds_invalid/,
  );
});

test("relay transport requires exact fixture marker and a matching event id in the publish ACK", async () => {
  const secretKey = generateSecretKey();
  const eventWithLongMarker = finalizeEvent({
    kind: 1,
    created_at: 1_754_035_200,
    tags: [["municipality", scope.municipalityId], ["case", scope.caseId], ["t", "stadtstack-e2e-fixture", "unexpected"]],
    content: "fixture",
  }, secretKey);
  const badMarkerTransport = createInMemoryNostrRelayTransport({ relayUrl, scope, fixtureSignerPubkey: eventWithLongMarker.pubkey });
  await assert.rejects(() => badMarkerTransport.publish(eventWithLongMarker), /nostr_relay_fixture_marker_invalid/);

  const event = signedEvent();
  const noIdClient: NostrRelayClient = {
    publish: () => ({ ok: true }),
    query: () => ({ events: [event], eose: true }),
  };
  const transport = createNostrRelayTransport({ relayUrl, scope, fixtureSignerPubkey: event.pubkey, client: noIdClient });
  await assert.rejects(() => transport.publish(event), /nostr_relay_ok_required/);
});

test("relay transport rejects tag aliases, extra marker tags, oversized content, tags, and malformed IDs", async () => {
  const requiredTags = [
    ["municipality", scope.municipalityId],
    ["case", scope.caseId],
    ["t", "stadtstack-e2e-fixture"],
  ];
  const candidates = [
    [...requiredTags, ["t", "another-topic"]],
    [...requiredTags, ["municipality_id", scope.municipalityId]],
    [...requiredTags, ["municipalityId", scope.municipalityId]],
    [...requiredTags, ["case_id", scope.caseId]],
    [...requiredTags, ["caseId", scope.caseId]],
    [...requiredTags, ["scope", scope.municipalityId, scope.caseId]],
  ];
  for (const tags of candidates) {
    const event = signedEventWithTags(tags);
    const transport = createInMemoryNostrRelayTransport({
      relayUrl,
      scope,
      fixtureSignerPubkey: event.pubkey,
    });
    await assert.rejects(
      () => transport.publish(event),
      /nostr_relay_(fixture_marker_invalid|scope_tag_forbidden)/,
    );
  }

  const contentEvent = signedEventWithTags(requiredTags, "x".repeat(65_537));
  const contentTransport = createInMemoryNostrRelayTransport({
    relayUrl,
    scope,
    fixtureSignerPubkey: contentEvent.pubkey,
  });
  await assert.rejects(
    () => contentTransport.publish(contentEvent),
    /nostr_relay_event_content_too_large/,
  );

  const tagEvent = signedEventWithTags([
    ["municipality", scope.municipalityId],
    ["case", scope.caseId],
    ["t", "stadtstack-e2e-fixture"],
    ["note", "x".repeat(1_025)],
  ]);
  const tagTransport = createInMemoryNostrRelayTransport({
    relayUrl,
    scope,
    fixtureSignerPubkey: tagEvent.pubkey,
  });
  await assert.rejects(
    () => tagTransport.publish(tagEvent),
    /nostr_relay_event_tag_value_too_large/,
  );

  const manyTags = [
    ...requiredTags,
    ...Array.from({ length: 1_998 }, () => ["note", "bounded"]),
  ];
  const manyTagEvent = signedEventWithTags(manyTags);
  const manyTagTransport = createInMemoryNostrRelayTransport({
    relayUrl,
    scope,
    fixtureSignerPubkey: manyTagEvent.pubkey,
  });
  await assert.rejects(
    () => manyTagTransport.publish(manyTagEvent),
    /nostr_relay_event_tags_too_many/,
  );

  const malformedIdEvent = { ...signedEvent(), id: "not-a-64-hex-id" };
  const malformedIdTransport = createInMemoryNostrRelayTransport({
    relayUrl,
    scope,
    fixtureSignerPubkey: malformedIdEvent.pubkey,
  });
  await assert.rejects(
    () => malformedIdTransport.publish(malformedIdEvent),
    /nostr_relay_event_id_invalid/,
  );
});

test("relay transport bounds JSON acknowledgements and rejects exact-scope/query ID smuggling", async () => {
  const event = signedEvent();
  const transport = createNostrRelayTransport({
    relayUrl,
    scope,
    fixtureSignerPubkey: event.pubkey,
    client: {
      publish: () => ["OK", event.id, true, "x".repeat(131_073)],
      query: () => ({ events: [event], eose: true }),
    },
  });
  await assert.rejects(() => transport.publish(event), /nostr_relay_frame_too_large/);
  await assert.rejects(
    () => transport.query({ eventId: "not-an-event-id", scope }),
    /nostr_relay_query_event_id_invalid/,
  );
  assert.throws(
    () =>
      createNostrRelayTransport({
        relayUrl,
        scope: { municipalityId: "other-city", caseId: scope.caseId },
        fixtureSignerPubkey: event.pubkey,
        client: { publish: () => ["OK", event.id, true], query: () => ({ events: [event], eose: true }) },
      }),
    /nostr_relay_scope_invalid/,
  );
});

test("relay query fails closed on missing EOSE, extra events, and wrong event id", async () => {
  const event = signedEvent();
  let response: unknown = { events: [event] };
  const transport = createNostrRelayTransport({
    relayUrl,
    scope,
    fixtureSignerPubkey: event.pubkey,
    client: {
      publish: () => ({ ok: true, eventId: event.id }),
      query: () => response,
    },
  });
  await transport.publish(event);
  await assert.rejects(() => transport.query({ eventId: event.id, scope }), /nostr_relay_eose_required/);
  response = { events: [event, event], eose: true };
  await assert.rejects(() => transport.query({ eventId: event.id, scope }), /nostr_relay_extra_events/);
  const other = signedEvent();
  response = { events: [other], eose: true };
  await assert.rejects(() => transport.query({ eventId: event.id, scope }), /nostr_relay_event_id_mismatch|nostr_relay_signer_not_allowed/);
});
