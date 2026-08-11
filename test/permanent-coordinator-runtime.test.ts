import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { finalizeEvent } from "nostr-tools/pure";

import { createNostrDiscussionAdapter } from "../src/adapters/discussion-adapter.ts";
import {
  createPermanentCoordinatorRuntime,
  parsePermanentCoordinatorRuntimeConfig,
  type PermanentCoordinatorRuntimeConfig,
} from "../src/permanent-coordinator-runtime.ts";

const municipalityId = "roebel-mueritz";
const sourceCaseId = "marienfelder-strasse";
const canonicalCaseId = "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001";
const policyVersion = "roebel-permanent-v1";
const departments = ["planning", "traffic", "environment", "finance", "legal", "public-order", "social-affairs", "public-works"] as const;

function actors() {
  return [
    { actorId: "roebel:nostr-ingestor", actorClass: "citizen" as const },
    { actorId: "roebel:case-steward", actorClass: "case_steward" as const },
    { actorId: "roebel:public-reader", actorClass: "public" as const },
    { actorId: "roebel:administration-reader", actorClass: "administration" as const },
    { actorId: "roebel:council-reader", actorClass: "council" as const },
    { actorId: "roebel:participation-reviewer", actorClass: "participation_reviewer" as const },
    ...departments.flatMap((departmentId) => [
      { actorId: `roebel:${departmentId}:agent`, actorClass: "department_agent" as const, departmentId },
      { actorId: `roebel:${departmentId}:reviewer`, actorClass: "department_reviewer" as const, departmentId },
    ]),
  ];
}

function config(rootDir: string): PermanentCoordinatorRuntimeConfig {
  return {
    schemaVersion: "stadtstack_permanent_coordinator_runtime_v1",
    scope: { municipalityId, sourceCaseId },
    canonicalCaseId,
    policyVersion,
    journal: { rootDir, namespace: "roebel-workflow" },
    requiredDepartmentIds: [...departments],
    actors: actors(),
    publicActor: { actorId: "roebel:public-reader", actorClass: "public" },
    publicMecky: { pubkey: "a".repeat(64), agentName: "mecky", nodeId: "roebel" },
    municipality: { id: municipalityId, name: "Röbel/Müritz", state: "Mecklenburg-Vorpommern", country: "DE" },
    decisionCaseSlug: sourceCaseId,
    publicCasePath: "/kommunen/roebel-mueritz/entscheidungen/marienfelder-strasse",
    owner: { id: "stadt-roebel-mueritz", label: "Stadt Röbel/Müritz", kind: "municipal_body" },
    publicHttp: { bindHost: "127.0.0.1", port: 0, allowedHosts: ["127.0.0.1", "localhost"], allowedOrigins: ["https://roebel.app"] },
    controlHttp: { bindHost: "127.0.0.1", port: 0, allowedHosts: ["127.0.0.1", "localhost"], maxBodyBytes: 262_144 },
  };
}

function tokens() {
  return Object.fromEntries(
    actors()
      .filter((actor) => !["public", "administration", "council"].includes(actor.actorClass))
      .map((actor, index) => [actor.actorId, `${String(index).padStart(2, "0")}-${"x".repeat(40)}`]),
  );
}

function discussion() {
  const event = finalizeEvent({
    kind: 1,
    created_at: 1_786_454_400,
    tags: [["municipality", municipalityId], ["case", sourceCaseId]],
    content: "@Mecky Wie kann die Querung der Marienfelder Straße sicherer werden?",
  }, new Uint8Array(32).fill(31));
  return createNostrDiscussionAdapter({ scope: { municipalityId, caseId: sourceCaseId } }).normalize(event);
}

function intakeCommand() {
  const artifact = discussion();
  return {
    schemaVersion: "command_envelope_v1",
    commandType: "intake_discussion_v1",
    caseId: canonicalCaseId,
    actorBinding: { actorId: "roebel:nostr-ingestor", actorClass: "citizen" },
    expectedCaseVersion: 0,
    idempotencyKey: `roebel:discussion:${artifact.event.id}`,
    visibility: "private_case",
    policyVersion,
    payload: { discussion: artifact },
  };
}

async function command(origin: string, actorId: string, token: string, body: unknown) {
  return fetch(`${origin}/v1/commands`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-stadtstack-actor-id": actorId,
    },
    body: JSON.stringify(body),
  });
}

test("keeps writes on an actor-bound internal server and replays them durably", async () => {
  const root = mkdtempSync(join(tmpdir(), "stadtstack-permanent-runtime-"));
  const actorTokens = tokens();
  const retryCommand = intakeCommand();
  try {
    const first = createPermanentCoordinatorRuntime(config(root), { actorTokens });
    const firstAddress = await first.start();
    const publicOrigin = `http://${firstAddress.public.host}:${firstAddress.public.port}`;
    const controlOrigin = `http://${firstAddress.control.host}:${firstAddress.control.port}`;
    try {
      assert.equal((await fetch(`${publicOrigin}/v1/commands`, { method: "POST" })).status, 404);
      assert.equal((await command(controlOrigin, "roebel:nostr-ingestor", "wrong-token-that-is-long-enough-000000", retryCommand)).status, 401);
      assert.equal((await command(controlOrigin, "roebel:case-steward", actorTokens["roebel:nostr-ingestor"]!, retryCommand)).status, 401);

      const rejected = await command(controlOrigin, "roebel:nostr-ingestor", actorTokens["roebel:nostr-ingestor"]!, {
        ...retryCommand,
        commandType: "unreviewed_command_v1",
      });
      assert.equal(rejected.status, 422);
      assert.deepEqual(await rejected.json(), { error: "command_rejected" });

      const oversized = await fetch(`${controlOrigin}/v1/commands`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${actorTokens["roebel:nostr-ingestor"]}`,
          "content-type": "application/json",
          "x-stadtstack-actor-id": "roebel:nostr-ingestor",
        },
        body: JSON.stringify({ padding: "x".repeat(262_144) }),
      });
      assert.equal(oversized.status, 413);
      assert.deepEqual(await oversized.json(), { error: "body_too_large" });

      const accepted = await command(controlOrigin, "roebel:nostr-ingestor", actorTokens["roebel:nostr-ingestor"]!, retryCommand);
      if (accepted.status !== 200) throw new Error(await accepted.text());
      const receipt = await accepted.json() as { caseVersion: number; eventIds: string[]; journalHeadChecksum: string };
      assert.equal(receipt.caseVersion, 2);

      const duplicate = await command(controlOrigin, "roebel:nostr-ingestor", actorTokens["roebel:nostr-ingestor"]!, retryCommand);
      if (duplicate.status !== 200) throw new Error(await duplicate.text());
      assert.deepEqual(await duplicate.json(), receipt);

      const index = await (await fetch(`${publicOrigin}/api/federation/v1/municipalities/roebel-mueritz/cases`)).json() as { cases: unknown[] };
      assert.deepEqual(index.cases, []);
    } finally {
      await first.close();
    }

    const reopened = createPermanentCoordinatorRuntime(config(root), { actorTokens });
    const reopenedAddress = await reopened.start();
    try {
      const controlOrigin = `http://${reopenedAddress.control.host}:${reopenedAddress.control.port}`;
      const replay = await command(controlOrigin, "roebel:nostr-ingestor", actorTokens["roebel:nostr-ingestor"]!, retryCommand);
      assert.equal(replay.status, 200);
      assert.equal((await replay.json() as { caseVersion: number }).caseVersion, 2);
    } finally {
      await reopened.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects missing actor credentials and public/control port aliasing before opening SQLite", () => {
  const root = mkdtempSync(join(tmpdir(), "stadtstack-permanent-runtime-config-"));
  try {
    const missing = tokens();
    delete missing["roebel:case-steward"];
    assert.throws(() => createPermanentCoordinatorRuntime(config(root), { actorTokens: missing }), /permanent_actor_tokens_invalid/);
    const aliased = config(root);
    aliased.publicHttp.port = 18080;
    aliased.controlHttp.port = 18080;
    assert.throws(() => createPermanentCoordinatorRuntime(aliased, { actorTokens: tokens() }), /permanent_http_ports_not_distinct/);

    const nestedUnknown = config(root);
    (nestedUnknown.publicActor as typeof nestedUnknown.publicActor & { extra?: boolean }).extra = true;
    assert.throws(() => parsePermanentCoordinatorRuntimeConfig(nestedUnknown), /permanent_runtime_public_actor_invalid/);

    const actorUnknown = config(root);
    (actorUnknown.actors[0] as typeof actorUnknown.actors[0] & { extra?: boolean }).extra = true;
    assert.throws(() => parsePermanentCoordinatorRuntimeConfig(actorUnknown), /permanent_runtime_actors_invalid/);

    const aliasedHost = config(root);
    aliasedHost.controlHttp.allowedHosts.push("localhost");
    assert.throws(() => parsePermanentCoordinatorRuntimeConfig(aliasedHost), /permanent_runtime_http_invalid/);

    const arrayAlias = config(root);
    (arrayAlias.requiredDepartmentIds as string[] & { extra?: string }).extra = "unreviewed";
    assert.throws(() => parsePermanentCoordinatorRuntimeConfig(arrayAlias), /permanent_runtime_departments_invalid/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
