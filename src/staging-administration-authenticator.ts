import { createHash, timingSafeEqual } from "node:crypto";
import type { ActorBinding } from "./civic-case-coordinator.ts";
import type { DurableContinuationRoleAuthenticator } from "./durable-case-continuation.ts";
import { parseSyntheticCaseId } from "./case-id.ts";

export type StagingAdministrationGrant = {
  token: string;
  caseId: string;
  actor: ActorBinding;
  notBefore: number;
  expiresAt: number;
};

/** Server-only staging identity Adapter. Each random 32-byte bearer binds one
 * actor, one synthetic Case and one validity interval. This is attributable
 * staging possession, not proof of a person's employment or human identity.
 * Production OIDC/EUDI verification replaces this Adapter, not the Case rules. */
export function createStagingAdministrationAuthenticator(config: {
  deploymentEnvironment: "staging";
  grants: readonly StagingAdministrationGrant[];
  now?: () => number;
}): DurableContinuationRoleAuthenticator {
  const invalid = () => { throw new Error("staging_administration_authenticator_config_invalid"); };
  if (config.deploymentEnvironment !== "staging" || !Array.isArray(config.grants) ||
    config.grants.length < 1 || config.grants.length > 64 || (config.now !== undefined && typeof config.now !== "function")) invalid();
  const now = config.now ?? Date.now;
  const usedTokens = new Set<string>();
  const entries = config.grants.map((grant) => {
    if (!grant || Object.keys(grant).sort().join(",") !== "actor,caseId,expiresAt,notBefore,token" ||
      !parseSyntheticCaseId(grant.caseId) || !grant.actor ||
      Object.keys(grant.actor).sort().join(",") !== "actorClass,actorId" ||
      !/^[A-Za-z0-9:._-]{1,256}$/u.test(grant.actor.actorId) ||
      !["case_steward", "administration", "department_agent", "department_reviewer"].includes(grant.actor.actorClass) ||
      !Number.isSafeInteger(grant.notBefore) || !Number.isSafeInteger(grant.expiresAt) ||
      grant.notBefore < 0 || grant.expiresAt <= grant.notBefore ||
      typeof grant.token !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(grant.token) ||
      Buffer.from(grant.token, "base64url").length !== 32 ||
      Buffer.from(grant.token, "base64url").toString("base64url") !== grant.token || usedTokens.has(grant.token)) invalid();
    usedTokens.add(grant.token);
    return Object.freeze({
      digest: createHash("sha256").update(grant.token).digest(),
      caseId: grant.caseId, actor: Object.freeze({ ...grant.actor }),
      notBefore: grant.notBefore, expiresAt: grant.expiresAt,
    });
  });
  return Object.freeze({
    async authenticate(input) {
      if (typeof input.authorization !== "string" || !/^Bearer [A-Za-z0-9_-]{43}$/u.test(input.authorization)) return null;
      const digest = createHash("sha256").update(input.authorization.slice(7)).digest();
      const time = now();
      if (!Number.isSafeInteger(time)) return null;
      let principal: ActorBinding | null = null;
      for (const entry of entries) {
        const matches = timingSafeEqual(digest, entry.digest);
        if (matches && entry.caseId === input.caseId && time >= entry.notBefore && time < entry.expiresAt) principal = entry.actor;
      }
      return principal ? { ...principal } : null;
    },
  });
}
