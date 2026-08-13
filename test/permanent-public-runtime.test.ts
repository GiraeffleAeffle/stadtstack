import assert from "node:assert/strict";
import { request } from "node:http";
import test from "node:test";

import {
  createPermanentPublicRuntime,
  permanentStageMapChecksum,
} from "../src/permanent-public-runtime.ts";
import {
  publicKnowledgeChecksum,
  type PublicKnowledgeProjectionV1,
} from "../src/public-knowledge.ts";

const hash = (character: string) => `sha256:${character.repeat(64)}`;

function statusWithHost(port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/healthz", headers: { host } }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode ?? 0));
    });
    req.once("error", reject);
    req.end();
  });
}

export function reviewedKnowledge(): PublicKnowledgeProjectionV1 {
  const base = {
    schemaVersion: "public_knowledge_projection_v1" as const,
    caseId: "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
    municipalityId: "roebel-mueritz",
    sourceCaseId: "marienfelder-strasse",
    policyVersion: "roebel-permanent-v1",
    caseVersion: 28,
    journalHeadChecksum: hash("1"),
    sourceProjectionChecksum: hash("2"),
    discussion: {
      id: "discussion-1",
      sourceRef: "nostr:event:discussion-1",
      content: "Wie kann die Querung der Marienfelder Straße sicherer werden?",
      signerPubkey: "a".repeat(64),
      outcomeRef: { id: "outcome-1", outcomeChecksum: hash("3") },
    },
    suggestion: {
      id: "suggestion-1",
      title: "Sichere Querung Marienfelder Straße",
      summary: "Varianten für eine sichere Querung prüfen und öffentlich abwägen.",
      status: "admitted" as const,
      signerPubkey: "a".repeat(64),
      admissionChecksum: hash("4"),
    },
    citizenBrief: {
      id: "brief-1",
      title: "Citizen Brief: sichere Querung",
      summary: "Acht Fachbereiche haben die öffentlich belegten Varianten geprüft.",
      briefChecksum: hash("5"),
      sourceDiscussionRef: "nostr:event:discussion-1",
      reviewedDepartmentCount: 8 as const,
      reviewedCitations: Array.from({ length: 8 }, (_, index) => `https://stadt.example/evidence/${index + 1}`),
    },
    participation: {
      id: "participation-1",
      question: "Welche Variante soll zuerst vertieft werden?",
      options: [
        { optionId: "crossing", label: "Querungshilfe", aggregateCount: 6 },
        { optionId: "lighting", label: "Beleuchtung", aggregateCount: 2 },
      ],
      totalAccepted: 8,
      resultSummary: "Die Querungshilfe erhielt das stärkste beratende Signal.",
      unresolvedDissent: ["Beleuchtung bleibt für zwei Teilnehmende prioritär."],
      openedAt: "2026-08-01T00:00:00.000Z",
      closedAt: "2026-08-02T00:00:00.000Z",
      reviewedAt: "2026-08-03T00:00:00.000Z",
      checksum: hash("6"),
      advisory: true as const,
    },
    reviewedOutcome: {
      id: "outcome-1",
      summary: "Das beratende Ergebnis wurde geprüft und für die weitere Bearbeitung dokumentiert.",
      resultArtifactRef: "https://stadt.example/outcomes/1",
      reviewedAt: "2026-08-04T00:00:00.000Z",
      outcomeChecksum: hash("3"),
      discussionRef: "nostr:event:discussion-1",
      externalPublication: false as const,
    },
    governance: {
      participationKind: "advisory_non_binding" as const,
      formalVoteAvailable: false as const,
      formalVoteReason: "separate_legal_authority_binding_required" as const,
      councilSubmissionCreated: false as const,
    },
    authorityBinding: "none" as const,
  };
  return { ...base, knowledgeChecksum: publicKnowledgeChecksum(base) };
}

export function config(project: () => PublicKnowledgeProjectionV1) {
  return {
    knowledge: { project },
    municipality: {
      id: "roebel-mueritz",
      name: "Röbel/Müritz",
      state: "Mecklenburg-Vorpommern",
      country: "DE",
    },
    decisionCaseSlug: "marienfelder-strasse",
    canonicalCaseId: "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
    policyVersion: "roebel-permanent-v1",
    publicCasePath: "/kommunen/roebel-mueritz/entscheidungen/marienfelder-strasse",
    owner: {
      id: "stadt-roebel-mueritz",
      label: "Stadt Röbel/Müritz",
      kind: "municipal_body" as const,
    },
    http: {
      bindHost: "127.0.0.1" as const,
      port: 0,
      allowedHosts: ["127.0.0.1", "localhost", "roebel-stadtstack.agentcart.eu"],
      allowedOrigins: ["https://roebel.app", "http://localhost:3000"],
    },
  };
}

test("projects one reviewed Case into the exact federation, Mitmachen and artifact surfaces", async () => {
  const runtime = createPermanentPublicRuntime(config(reviewedKnowledge));
  const snapshot = runtime.snapshot();
  assert.equal(snapshot.index.schemaVersion, "civic_federation_case_index_v1");
  assert.equal(snapshot.index.cases.length, 1);
  assert.equal(snapshot.index.cases[0]?.truthState, "reviewed");
  assert.equal(snapshot.index.cases[0]?.currentStage.detailStageId, "delivery");
  assert.equal(snapshot.stageMap?.caseKey.decisionCaseSlug, "marienfelder-strasse");
  assert.equal(snapshot.stageMap?.participationAuthorityState, "declared");
  assert.equal(snapshot.manifest?.stageMap.contentSha256, permanentStageMapChecksum(snapshot.stageMap!));
  assert.equal(snapshot.manifest?.artifacts.length, 1);
  assert.equal(snapshot.artifacts.size, 1);

  const address = await runtime.listen();
  try {
    const origin = `http://${address.host}:${address.port}`;
    const indexResponse = await fetch(`${origin}/api/federation/v1/municipalities/roebel-mueritz/cases`);
    assert.equal(indexResponse.status, 200);
    assert.deepEqual(await indexResponse.json(), snapshot.index);

    const corsResponse = await fetch(`${origin}/api/federation/v1/municipalities/roebel-mueritz/cases`, {
      headers: { origin: "https://roebel.app" },
    });
    assert.equal(corsResponse.status, 200);
    assert.equal(corsResponse.headers.get("access-control-allow-origin"), "https://roebel.app");
    assert.equal((await fetch(`${origin}/api/federation/v1/municipalities/roebel-mueritz/cases`, {
      headers: { origin: "https://outside.example" },
    })).status, 403);
    const preflight = await fetch(`${origin}/api/federation/v1/municipalities/roebel-mueritz/cases`, {
      method: "OPTIONS",
      headers: { origin: "https://roebel.app" },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-methods"), "GET, OPTIONS");

    const manifestResponse = await fetch(`${origin}/api/federation/v1/municipalities/roebel-mueritz/cases/marienfelder-strasse/manifest`);
    assert.equal(manifestResponse.status, 200);
    assert.deepEqual(await manifestResponse.json(), snapshot.manifest);

    const stageResponse = await fetch(`${origin}/api/federation/v1/municipalities/roebel-mueritz/cases/marienfelder-strasse/stage-map`);
    assert.equal(stageResponse.status, 200);
    assert.deepEqual(await stageResponse.json(), snapshot.stageMap);

    const casePage = await fetch(`${origin}/kommunen/roebel-mueritz/entscheidungen/marienfelder-strasse`);
    assert.equal(casePage.status, 200);
    const html = await casePage.text();
    assert.match(html, /Beratende Beteiligung/);
    assert.match(html, /Sichere Querung Marienfelder Straße/);
    assert.doesNotMatch(html, /privateEvidenceRefs|nsec1|<(?:form|script)\b/i);

    assert.equal((await fetch(`${origin}/mitmachen`)).status, 200);
    assert.equal((await fetch(`${origin}/vote`)).status, 404);
    assert.equal((await fetch(`${origin}/mitmachen?case=forged`)).status, 400);
    assert.equal((await fetch(`${origin}/mitmachen`, { method: "POST" })).status, 405);
  } finally {
    await runtime.close();
  }
});

test("returns an honest empty reviewed index until the Case has complete public knowledge", async () => {
  const runtime = createPermanentPublicRuntime(config(() => { throw new Error("public_knowledge_participation_required"); }));
  const snapshot = runtime.snapshot();
  assert.deepEqual(snapshot.index.cases, []);
  assert.equal(snapshot.manifest, null);
  assert.equal(snapshot.stageMap, null);

  const address = await runtime.listen();
  try {
    const origin = `http://${address.host}:${address.port}`;
    assert.equal((await fetch(`${origin}/api/federation/v1/municipalities/roebel-mueritz/cases`)).status, 200);
    assert.equal((await fetch(`${origin}/api/federation/v1/municipalities/roebel-mueritz/cases/marienfelder-strasse/manifest`)).status, 404);
    assert.equal((await fetch(`${origin}/mitmachen`)).status, 404);
  } finally {
    await runtime.close();
  }
});

test("fails closed on checksum, scope and host drift without exposing a write route", async () => {
  const drifted = reviewedKnowledge();
  drifted.knowledgeChecksum = hash("f");
  assert.throws(() => createPermanentPublicRuntime(config(() => drifted)), /permanent_public_knowledge_invalid/);

  const wrongScope = reviewedKnowledge();
  wrongScope.municipalityId = "other-city";
  const wrongScopeCore = { ...wrongScope };
  delete (wrongScopeCore as Partial<PublicKnowledgeProjectionV1>).knowledgeChecksum;
  wrongScope.knowledgeChecksum = publicKnowledgeChecksum(wrongScopeCore);
  assert.throws(() => createPermanentPublicRuntime(config(() => wrongScope)), /permanent_public_knowledge_scope_invalid/);

  const wrongCase = reviewedKnowledge();
  wrongCase.caseId = "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000099";
  const wrongCaseCore = { ...wrongCase };
  delete (wrongCaseCore as Partial<PublicKnowledgeProjectionV1>).knowledgeChecksum;
  wrongCase.knowledgeChecksum = publicKnowledgeChecksum(wrongCaseCore);
  assert.throws(() => createPermanentPublicRuntime(config(() => wrongCase)), /permanent_public_knowledge_scope_invalid/);

  const arrayAlias = reviewedKnowledge();
  (arrayAlias.citizenBrief.reviewedCitations as string[] & { extra?: string }).extra = "unbound";
  assert.throws(() => createPermanentPublicRuntime(config(() => arrayAlias)), /permanent_public_knowledge_invalid/);

  const secretValue = reviewedKnowledge();
  secretValue.citizenBrief.summary = `unreviewed nsec1${"a".repeat(48)}`;
  assert.throws(() => createPermanentPublicRuntime(config(() => secretValue)), /permanent_public_knowledge_invalid/);

  const nestedUnknown = reviewedKnowledge();
  (nestedUnknown.governance as typeof nestedUnknown.governance & { extra?: boolean }).extra = true;
  const nestedCore = { ...nestedUnknown };
  delete (nestedCore as Partial<PublicKnowledgeProjectionV1>).knowledgeChecksum;
  nestedUnknown.knowledgeChecksum = publicKnowledgeChecksum(nestedCore);
  assert.throws(() => createPermanentPublicRuntime(config(() => nestedUnknown)), /permanent_public_knowledge_invalid/);

  const unknownConfig = { ...config(reviewedKnowledge), extra: "unreviewed" };
  assert.throws(() => createPermanentPublicRuntime(unknownConfig as never), /permanent_public_config_invalid/);

  const testNamespace = config(reviewedKnowledge);
  testNamespace.canonicalCaseId = "urn:stadtstack:case:test:roebel-mueritz:018f0000-0000-7000-8000-000000000001";
  assert.throws(() => createPermanentPublicRuntime(testNamespace), /permanent_public_config_invalid/);

  let proxyTraps = 0;
  const proxyConfig = new Proxy(config(reviewedKnowledge), {
    ownKeys() {
      proxyTraps += 1;
      throw new Error("proxy_trap");
    },
  });
  assert.throws(() => createPermanentPublicRuntime(proxyConfig), /permanent_public_config_invalid/);
  assert.equal(proxyTraps, 0);

  const runtime = createPermanentPublicRuntime(config(reviewedKnowledge));
  const address = await runtime.listen();
  try {
    assert.equal(await statusWithHost(address.port, "outside.example"), 400);
    assert.equal((await fetch(`http://${address.host}:${address.port}/v1/commands`, { method: "POST" })).status, 404);
  } finally {
    await runtime.close();
  }
});
