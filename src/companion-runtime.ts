import type {
  CivicKernelConfig,
  CivicProjection,
} from "./civic-kernel.ts";

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
];

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
    identities[profile] = identity.trim();
  }
  if (new Set(Object.values(identities)).size !== COMPANION_PROFILES.length) {
    throw new Error("worker_identity_unique");
  }
  return identities;
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

// Keep this import in the public type surface for consumers that want to
// configure the runtime from the kernel's municipality metadata without
// importing a concrete implementation.
export type { CivicKernelConfig };
