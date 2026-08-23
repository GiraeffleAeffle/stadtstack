import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CASE_STEWARD_ADMISSION_PATH,
  createStagingCaseStewardTokenAuthenticator,
} from "../src/staging-case-steward-token-authenticator.ts";

const token = (seed: string): string => createHash("sha256").update(`staging-test:${seed}`).digest("base64url");
const principal = (actorId: string, municipalityIds: readonly string[] = ["roebel-mueritz"]) => ({
  actorId,
  actorClass: "case_steward" as const,
  municipalityIds,
});
const credential = (actorId: string, seed: string, municipalityIds?: readonly string[]) => ({
  principal: principal(actorId, municipalityIds),
  token: token(seed),
});
const createAuthenticator = (
  credentials: Parameters<typeof createStagingCaseStewardTokenAuthenticator>[0]["credentials"],
) => createStagingCaseStewardTokenAuthenticator({
  deploymentEnvironment: "staging",
  credentials,
});
const request = (authorization: unknown, extras: Record<string, unknown> = {}) => ({
  authorization,
  method: "POST",
  path: CASE_STEWARD_ADMISSION_PATH,
  ...extras,
}) as never;

test("maps each exact bearer token to its pinned principal and municipality scope", async () => {
  const first = credential("roebel:steward-one", "one", ["roebel-mueritz", "roebel-archipelago"]);
  const second = credential("roebel:steward-two", "two", ["roebel-mueritz"]);
  const authenticator = createAuthenticator([first, second]);

  assert.deepEqual(await authenticator.authenticate(request(`Bearer ${first.token}`)), {
    actorId: "roebel:steward-one",
    actorClass: "case_steward",
    municipalityIds: ["roebel-mueritz", "roebel-archipelago"],
  });
  assert.deepEqual(await authenticator.authenticate(request(`Bearer ${second.token}`)), {
    actorId: "roebel:steward-two",
    actorClass: "case_steward",
    municipalityIds: ["roebel-mueritz"],
  });
});

test("wrong, missing, malformed, out-of-route, and rotated-out tokens return null", async () => {
  const old = credential("roebel:steward-old", "old");
  const current = credential("roebel:steward-current", "current");
  const authenticator = createAuthenticator([current]);
  const malformed = [
    undefined,
    "",
    "Bearer",
    `bearer ${current.token}`,
    `Bearer  ${current.token}`,
    `Bearer ${current.token} `,
    `Bearer ${current.token}=`,
    `Bearer ${"a".repeat(43)}`,
    `Bearer ${current.token}\nX-Leak: yes`,
    { toString: () => `Bearer ${current.token}` },
  ];
  for (const authorization of malformed) {
    assert.equal(await authenticator.authenticate(request(authorization)), null);
  }
  assert.equal(await authenticator.authenticate(request(`Bearer ${old.token}`)), null);
  assert.equal(await authenticator.authenticate(request(`Bearer ${current.token}`,
    { method: "GET" })), null);
  assert.equal(await authenticator.authenticate(request(`Bearer ${current.token}`,
    { path: `${CASE_STEWARD_ADMISSION_PATH}?x=1` })), null);
  assert.equal(await authenticator.authenticate(request(`Bearer ${current.token}`,
    { path: "/v1/public/case-bindings/example" })), null);
});

test("rejects duplicate credentials, token reuse, actor reuse, sparse arrays, accessors, proxies, and oversize config", () => {
  const first = credential("roebel:steward-one", "one");
  const second = credential("roebel:steward-two", "two");
  assert.throws(() => createAuthenticator([]), /config_invalid/u);
  assert.throws(() => createAuthenticator([
    ...Array.from({ length: 17 }, (_, index) => credential(`roebel:steward-${index}`, `seed-${index}`)),
  ]), /config_invalid/u);
  assert.throws(() => createAuthenticator([first, first]), /config_invalid/u);
  assert.throws(() => createAuthenticator([
    first,
    { ...second, token: first.token },
  ]), /config_invalid/u);
  assert.throws(() => createAuthenticator([
    first,
    { ...second, principal: principal(first.principal.actorId) },
  ]), /config_invalid/u);

  const sparse = [] as unknown as Array<unknown>;
  sparse.length = 1;
  assert.throws(() => createAuthenticator(sparse as never), /config_invalid/u);

  let configAccessorRead = false;
  const accessorConfig = { deploymentEnvironment: "staging" } as {
    deploymentEnvironment: "staging";
    credentials: readonly unknown[];
  };
  Object.defineProperty(accessorConfig, "credentials", {
    enumerable: true,
    get() {
      configAccessorRead = true;
      return [first];
    },
  });
  assert.throws(() => createStagingCaseStewardTokenAuthenticator(accessorConfig as never), /config_invalid/u);
  assert.equal(configAccessorRead, false);
  assert.throws(() => createStagingCaseStewardTokenAuthenticator({
    deploymentEnvironment: "production",
    credentials: [first],
  } as never), /config_invalid/u);

  let arrayAccessorRead = false;
  const accessorCredentials = [first];
  Object.defineProperty(accessorCredentials, "0", {
    enumerable: true,
    get() {
      arrayAccessorRead = true;
      return first;
    },
  });
  assert.throws(() => createAuthenticator(accessorCredentials), /config_invalid/u);
  assert.equal(arrayAccessorRead, false);

  const principalProxy = new Proxy(first.principal, { ownKeys() { throw new Error("proxy invoked"); } });
  assert.throws(() => createAuthenticator([{
    token: first.token,
    principal: principalProxy,
  }]), /config_invalid/u);
});

test("rejects malformed principal scopes and non-canonical or short bearer secrets", () => {
  const base = credential("roebel:steward", "one");
  const badPrincipals = [
    { ...base, principal: { ...base.principal, actorClass: "administration" } },
    { ...base, principal: { ...base.principal, municipalityIds: [] } },
    { ...base, principal: { ...base.principal, municipalityIds: ["roebel-mueritz", "roebel-mueritz"] } },
    { ...base, principal: { ...base.principal, municipalityIds: Array.from({ length: 17 }, () => "roebel-mueritz") } },
    { ...base, principal: { ...base.principal, actorId: "contains spaces" } },
    { ...base, token: "short" },
    { ...base, token: `${token("one")}=` },
  ];
  for (const bad of badPrincipals) {
    assert.throws(() => createAuthenticator([bad] as never), /config_invalid/u);
  }
});

test("canonical capacity is validated while CSPRNG entropy remains a provisioning obligation", async () => {
  const canonicalZeroBytes = "A".repeat(43);
  const authenticator = createAuthenticator([{
    principal: principal("roebel:provisioning-test"),
    token: canonicalZeroBytes,
  }]);
  assert.deepEqual(
    await authenticator.authenticate(request(`Bearer ${canonicalZeroBytes}`)),
    {
      actorId: "roebel:provisioning-test",
      actorClass: "case_steward",
      municipalityIds: ["roebel-mueritz"],
    },
  );
});

test("does not execute request accessors or proxies and accepts only exact data properties", async () => {
  const current = credential("roebel:steward", "current");
  const authenticator = createAuthenticator([current]);
  let methodRead = false;
  const accessorRequest = {} as Record<string, unknown>;
  Object.defineProperties(accessorRequest, {
    authorization: { enumerable: true, value: `Bearer ${current.token}` },
    method: { enumerable: true, get() { methodRead = true; return "POST"; } },
    path: { enumerable: true, value: CASE_STEWARD_ADMISSION_PATH },
  });
  assert.equal(await authenticator.authenticate(accessorRequest as never), null);
  assert.equal(methodRead, false);
  const proxied = new Proxy(request(`Bearer ${current.token}`), {
    ownKeys() { throw new Error("request proxy invoked"); },
  });
  assert.equal(await authenticator.authenticate(proxied as never), null);
  assert.equal(await authenticator.authenticate({
    authorization: `Bearer ${current.token}`,
    method: "POST",
    path: CASE_STEWARD_ADMISSION_PATH,
    extra: true,
  } as never), null);
});

test("caller mutation cannot alter the pinned result and the capability has no secret surface", async () => {
  const configured = credential("roebel:steward", "current", ["roebel-mueritz"]);
  const authenticator = createAuthenticator([configured]);
  configured.principal.actorId = "caller-mutated";
  (configured.principal.municipalityIds as string[])[0] = "caller-mutated";
  configured.token = token("caller-mutated");

  const result = await authenticator.authenticate(request(`Bearer ${token("current")}`));
  assert.ok(result);
  assert.deepEqual(result, {
    actorId: "roebel:steward",
    actorClass: "case_steward",
    municipalityIds: ["roebel-mueritz"],
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.municipalityIds), true);
  assert.deepEqual(Object.keys(authenticator), ["authenticate"]);
  assert.deepEqual(Object.getOwnPropertyNames(authenticator), ["authenticate"]);
  assert.deepEqual(Object.getOwnPropertySymbols(authenticator), []);
  assert.equal("token" in authenticator, false);
  assert.equal("digest" in authenticator, false);
  assert.doesNotMatch(JSON.stringify(authenticator), /current|sha256|digest|token/u);
  assert.doesNotMatch(String(authenticator.authenticate), /current|sha256|staging-test/u);
});
