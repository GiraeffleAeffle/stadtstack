import { createHash } from "node:crypto";
import type {
  CivicKernelConfig,
  CivicProjection,
} from "./civic-kernel.ts";
import type {
  ActorBinding,
  CaseProjection,
  CivicCaseCoordinator,
  ProjectionEnvelope,
} from "./civic-case-coordinator.ts";

/**
 * The three companion profiles intentionally share a contract but never a
 * worker identity or context policy.  The runtime only prepares a bounded
 * task; it never invokes a model or an external tool.
 */
export const COMPANION_PROFILES = [
  "administration",
  "council",
  "public",
] as const;

export type CompanionProfile = (typeof COMPANION_PROFILES)[number];

export type CompanionCaseReader = {
  project(viewer: { role: CompanionProfile }): CivicProjection;
};

export type CompanionRuntimeConfig = {
  caseReader: CompanionCaseReader;
  identities: Readonly<Record<CompanionProfile, string>>;
};

export type CompanionContext = CivicProjection & {
  profile: CompanionProfile;
  visibility:
    | "administration_internal"
    | "council_restricted"
    | "public_reviewed";
  /** Coordinator bridge metadata; absent on the legacy kernel reader. */
  projection?: CaseProjection;
  caseVersion?: number;
  journalHeadChecksum?: string;
  projectionChecksum?: string;
  policyVersion?: string;
  citations?: readonly string[];
  artifactBindings?: readonly { ref: string; checksum: string }[];
  aiAttribution?: {
    schemaVersion: "ai_attribution_v1";
    kind: "agent_contribution";
    workerIdentityId: string;
    profile: CompanionProfile;
    adapterKind: "deterministic-local" | "openclaw";
    authorityBinding: "none";
  };
};

export type CompanionTaskRequest = {
  profile: CompanionProfile;
  question: string;
};

export type CompanionTask = {
  profile: CompanionProfile;
  question: string;
  workerIdentity: string;
  context: CompanionContext;
  allowedTools: readonly string[];
  prohibitedEffects: readonly string[];
  /** Explicit role-bound session and case metadata for coordinator tasks. */
  sessionKey?: string;
  caseId?: string;
  policyVersion?: string;
};

export type CompanionRuntime = {
  prepareTask(request: CompanionTaskRequest): CompanionTask;
};

const PROHIBITED_EFFECTS: readonly string[] = [
  "approve",
  "change_case_stage",
  "publish",
  "submit_to_council",
  "vote",
  "write_source",
  "write_nostr",
  "invoke_tool",
];

const COORDINATOR_PROHIBITED_EFFECTS: readonly string[] = PROHIBITED_EFFECTS;

const VISIBILITY_BY_PROFILE: Record<
  CompanionProfile,
  CompanionContext["visibility"]
> = {
  administration: "administration_internal",
  council: "council_restricted",
  public: "public_reviewed",
};

function isCompanionProfile(value: string): value is CompanionProfile {
  return (COMPANION_PROFILES as readonly string[]).includes(value);
}

function clone<T>(value: T): T {
  // The projections are JSON-compatible by contract.  A structured clone
  // keeps a task immutable even if a caller mutates the returned context.
  return structuredClone(value);
}

function snapshotIdentities(
  input: Readonly<Record<CompanionProfile, string>> | undefined,
): Readonly<Record<CompanionProfile, string>> {
  const identities = {} as Record<CompanionProfile, string>;

  for (const profile of COMPANION_PROFILES) {
    const identity = input?.[profile];
    if (typeof identity !== "string" || identity.trim().length === 0) {
      throw new Error(`worker_identity_required:${profile}`);
    }
    if (/(?:nsec1|private[_ -]?key|secret[_ -]?key|password|credential|0x[a-f0-9]{40,64})/i.test(identity)) {
      throw new Error(`worker_identity_secret_material:${profile}`);
    }
    identities[profile] = identity.trim();
  }
  if (new Set(Object.values(identities)).size !== COMPANION_PROFILES.length) {
    throw new Error("worker_identity_unique");
  }
  return identities;
}

export type CoordinatorCompanionActor = ActorBinding & {
  actorClass: "public" | "administration" | "council";
};

/**
 * The worker bridge receives only the read operation.  A coordinator handle,
 * journal, or command callback is deliberately absent from this dependency.
 */
export type CoordinatorCaseReader = Pick<CivicCaseCoordinator, "project">;

export type CoordinatorCompanionRuntimeConfig = {
  coordinator: CoordinatorCaseReader;
  caseId: string;
  policyVersion: string;
  actors: Readonly<Record<CompanionProfile, CoordinatorCompanionActor>>;
  identities: Readonly<Record<CompanionProfile, string>>;
  sessions: Readonly<Record<CompanionProfile, string>>;
};

const COORDINATOR_VISIBILITY: Record<CompanionProfile, CompanionProfile> = {
  public: "public",
  administration: "administration",
  council: "council",
};

function requireCoordinatorString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(code);
  return value.trim();
}

function assertCoordinatorProfileRecord(value: unknown, code: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const expected = [...COMPANION_PROFILES].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error(code);
  }
}

function coordinatorReferences(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const child of value) coordinatorReferences(child, refs);
    return refs;
  }
  if (!value || typeof value !== "object") return refs;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === "string" && ["sourceRef", "resultArtifactRef", "minorityReportRef", "ref"].includes(key) && /^[a-z][a-z0-9+.-]*:\S+$/i.test(child)) {
      refs.push(child.trim());
    }
    if (key === "publicCitations" && Array.isArray(child)) {
      for (const citation of child) if (typeof citation === "string" && /^[a-z][a-z0-9+.-]*:\S+$/i.test(citation)) refs.push(citation.trim());
    }
    coordinatorReferences(child, refs);
  }
  return [...new Set(refs)].sort();
}

function coordinatorSha256(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (!input || typeof input !== "object") return input;
    return Object.fromEntries(Object.keys(input as Record<string, unknown>).sort().map((key) => [key, canonical((input as Record<string, unknown>)[key])]));
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex")}`;
}

function assertConfiguration(config: CompanionRuntimeConfig): Readonly<Record<CompanionProfile, string>> {
  if (!config.caseReader || typeof config.caseReader.project !== "function") {
    throw new Error("case_reader_required");
  }
  return snapshotIdentities(config.identities);
}

/**
 * Create a read-only, role-scoped companion runtime.
 *
 * `caseReader` is deliberately the only dependency.  The runtime knows no
 * storage, provider, model, network, or civic mutation interface.  A caller
 * may therefore use the same contract with the in-memory synthetic kernel or
 * a later authoritative reader adapter.
 */
export function createCompanionRuntime(
  config: CompanionRuntimeConfig,
): CompanionRuntime {
  const identities = assertConfiguration(config);

  return {
    prepareTask(request: CompanionTaskRequest): CompanionTask {
      if (!isCompanionProfile(request.profile)) {
        throw new Error("companion_profile_invalid");
      }
      if (typeof request.question !== "string" || request.question.trim() === "") {
        throw new Error("companion_question_required");
      }

      const projection = config.caseReader.project({ role: request.profile });
      const context = {
        ...clone(projection),
        profile: request.profile,
        visibility: VISIBILITY_BY_PROFILE[request.profile],
      } as CompanionContext;

      return {
        profile: request.profile,
        question: request.question,
        workerIdentity: identities[request.profile],
        context,
        // The first slice is intentionally model/provider neutral and
        // mutation-free.  Read capabilities can be added behind this same
        // interface after their own policy and receipt contracts exist.
        allowedTools: [],
        prohibitedEffects: [...PROHIBITED_EFFECTS],
      };
    },
  };
}

/**
 * Coordinator-backed role reader for the Issue #6 conformance path.  This is
 * intentionally an Adapter at the existing runtime seam: it only calls the
 * coordinator's public `project` operation and never receives a handle, journal,
 * storage, relay, or mutation callback in a task.
 */
export function createCoordinatorCompanionRuntime(
  config: CoordinatorCompanionRuntimeConfig,
): CompanionRuntime {
  if (!config?.coordinator || typeof config.coordinator.project !== "function") {
    throw new Error("coordinator_required");
  }
  const caseId = requireCoordinatorString(config.caseId, "coordinator_case_id_required");
  const policyVersion = requireCoordinatorString(config.policyVersion, "coordinator_policy_version_required");
  assertCoordinatorProfileRecord(config.actors, "coordinator_actor_bindings_invalid");
  assertCoordinatorProfileRecord(config.identities, "coordinator_identities_invalid");
  assertCoordinatorProfileRecord(config.sessions, "coordinator_sessions_invalid");
  const identities = snapshotIdentities(config.identities);
  const actors = {} as Record<CompanionProfile, CoordinatorCompanionActor>;
  const sessions = {} as Record<CompanionProfile, string>;
  const actorIds = new Set<string>();
  const sessionIds = new Set<string>();
  for (const profile of COMPANION_PROFILES) {
    const actor = config.actors?.[profile];
    if (!actor || actor.actorClass !== profile) throw new Error(`coordinator_actor_binding_invalid:${profile}`);
    const actorKeys = Object.keys(actor).sort();
    if (actorKeys.length !== 2 || actorKeys[0] !== "actorClass" || actorKeys[1] !== "actorId") {
      throw new Error(`coordinator_actor_binding_invalid:${profile}`);
    }
    const actorId = requireCoordinatorString(actor.actorId, `coordinator_actor_required:${profile}`);
    if (actorIds.has(actorId)) throw new Error("coordinator_actor_unique");
    actorIds.add(actorId);
    actors[profile] = { actorId, actorClass: profile };
    const session = requireCoordinatorString(config.sessions?.[profile], `worker_session_required:${profile}`);
    if (/(?:nsec1|private[_ -]?key|secret[_ -]?key|password|credential|0x[a-f0-9]{40,64})/i.test(session)) {
      throw new Error(`worker_session_secret_material:${profile}`);
    }
    if (!new RegExp(`(?:^|:)${profile}(?:$|:)`).test(session)) {
      throw new Error(`worker_session_not_allowed:${profile}`);
    }
    if (sessionIds.has(session)) throw new Error("worker_session_unique");
    sessionIds.add(session);
    sessions[profile] = session;
  }

  return {
    prepareTask(request: CompanionTaskRequest): CompanionTask {
      if (!isCompanionProfile(request.profile)) throw new Error("companion_profile_invalid");
      const question = requireCoordinatorString(request.question, "companion_question_required");
      const actor = actors[request.profile];
      const envelope: ProjectionEnvelope = config.coordinator.project({
        schemaVersion: "query_envelope_v1",
        queryType: "case_projection_v1",
        caseId,
        actorBinding: actor,
        visibility: COORDINATOR_VISIBILITY[request.profile],
        policyVersion,
        atCaseVersion: null,
      });
      const projection = clone(envelope.projection);
      const refs = coordinatorReferences(projection);
      const citations = refs.length > 0
        ? refs
        : [`synthetic://context/${projection.municipalityId}/${projection.caseId}`];
      const artifactBindings = citations.map((ref) => ({
        ref,
        checksum: coordinatorSha256({ ref, projectionChecksum: envelope.projectionChecksum }),
      }));
      const context = {
        projection,
        caseVersion: envelope.caseVersion,
        journalHeadChecksum: envelope.journalHeadChecksum,
        projectionChecksum: envelope.projectionChecksum,
        visibility: COORDINATOR_VISIBILITY[request.profile],
        policyVersion: envelope.policyVersion,
        profile: request.profile,
        municipalityId: projection.municipalityId,
        caseId: projection.caseId,
        citations,
        artifactBindings,
        aiAttribution: {
          schemaVersion: "ai_attribution_v1" as const,
          kind: "agent_contribution" as const,
          workerIdentityId: identities[request.profile],
          profile: request.profile,
          adapterKind: "deterministic-local" as const,
          authorityBinding: "none" as const,
        },
      } as unknown as CompanionContext;
      return {
        profile: request.profile,
        question,
        workerIdentity: identities[request.profile],
        context,
        allowedTools: [],
        prohibitedEffects: [...COORDINATOR_PROHIBITED_EFFECTS],
        sessionKey: sessions[request.profile],
        caseId,
        policyVersion,
      };
    },
  };
}

// Keep this import in the public type surface for consumers that want to
// configure the runtime from the kernel's municipality metadata without
// importing a concrete implementation.
export type { CivicKernelConfig };
