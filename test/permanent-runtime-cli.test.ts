import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  parsePermanentRuntimeCliArgs,
  readPermanentRuntimeInputs,
} from "../src/permanent-runtime-cli.ts";
import type { PermanentCoordinatorRuntimeConfig } from "../src/permanent-coordinator-runtime.ts";

const departments = ["planning", "traffic", "environment", "finance", "legal", "public-order", "social-affairs", "public-works"];

function runtimeConfig(rootDir: string): PermanentCoordinatorRuntimeConfig {
  const actors = [
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
  return {
    schemaVersion: "stadtstack_permanent_coordinator_runtime_v1",
    scope: { municipalityId: "roebel-mueritz", sourceCaseId: "marienfelder-strasse" },
    canonicalCaseId: "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
    policyVersion: "roebel-permanent-v1",
    journal: { rootDir, namespace: "roebel-workflow" },
    requiredDepartmentIds: departments,
    actors,
    publicActor: { actorId: "roebel:public-reader", actorClass: "public" },
    municipality: { id: "roebel-mueritz", name: "Röbel/Müritz", state: "Mecklenburg-Vorpommern", country: "DE" },
    decisionCaseSlug: "marienfelder-strasse",
    publicCasePath: "/kommunen/roebel-mueritz/entscheidungen/marienfelder-strasse",
    owner: { id: "stadt-roebel-mueritz", label: "Stadt Röbel/Müritz", kind: "municipal_body" },
    publicHttp: { bindHost: "127.0.0.1", port: 18080, allowedHosts: ["127.0.0.1", "localhost"], allowedOrigins: ["https://roebel.app"] },
    controlHttp: { bindHost: "127.0.0.1", port: 18081, allowedHosts: ["127.0.0.1", "localhost"], maxBodyBytes: 262_144 },
  };
}

function actorTokens(config: PermanentCoordinatorRuntimeConfig) {
  return Object.fromEntries(config.actors
    .filter((actor) => !["public", "administration", "council"].includes(actor.actorClass))
    .map((actor, index) => [actor.actorId, `${index.toString().padStart(2, "0")}-${"s".repeat(40)}`]));
}

test("accepts only the closed serve/config/actor-token file interface", () => {
  assert.deepEqual(parsePermanentRuntimeCliArgs([
    "serve", "--config", "/etc/stadtstack/runtime.json", "--actor-tokens", "/var/run/secrets/stadtstack/actor-tokens.json",
  ]), {
    command: "serve",
    configPath: "/etc/stadtstack/runtime.json",
    actorTokensPath: "/var/run/secrets/stadtstack/actor-tokens.json",
  });
  assert.throws(() => parsePermanentRuntimeCliArgs(["serve"]), /stadtstack_permanent_cli_args_invalid/);
  assert.throws(() => parsePermanentRuntimeCliArgs(["serve", "--config", "relative.json", "--actor-tokens", "/tmp/tokens.json"]), /stadtstack_permanent_cli_path_invalid/);
  assert.throws(() => parsePermanentRuntimeCliArgs(["serve", "--config", "/tmp/same.json", "--actor-tokens", "/tmp/same.json"]), /stadtstack_permanent_cli_paths_not_distinct/);
});

test("reads exact regular JSON files and never places secret values in the public config", async () => {
  const root = mkdtempSync(join(tmpdir(), "stadtstack-permanent-cli-"));
  try {
    const configPath = join(root, "runtime.json");
    const tokenPath = join(root, "actor-tokens.json");
    const config = runtimeConfig(root);
    const tokens = actorTokens(config);
    writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
    writeFileSync(tokenPath, JSON.stringify(tokens), { mode: 0o600 });
    const result = await readPermanentRuntimeInputs({ command: "serve", configPath, actorTokensPath: tokenPath });
    assert.deepEqual(result.config, config);
    assert.deepEqual(result.options.actorTokens, tokens);
    assert.doesNotMatch(JSON.stringify(result.config), /00-s{8}|actor-tokens/i);

    const linkPath = join(root, "tokens-link.json");
    symlinkSync(tokenPath, linkPath);
    await assert.rejects(
      readPermanentRuntimeInputs({ command: "serve", configPath, actorTokensPath: linkPath }),
      /stadtstack_permanent_cli_file_invalid/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
