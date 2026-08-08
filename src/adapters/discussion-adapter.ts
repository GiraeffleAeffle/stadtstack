import {
  getEventHash,
  validateEvent,
  verifyEvent,
  type Event as NostrEvent,
} from "nostr-tools/pure";

export const DISCUSSION_ARTIFACT_SCHEMA_VERSION = "discussion_artifact_v1" as const;

/** App-specific, standards-compatible marker for the disposable fixture lane. */
export const STADTSTACK_E2E_FIXTURE_TAG = ["t", "stadtstack-e2e-fixture"] as const;

export type DiscussionSource = "synthetic_fixture" | "nostr";

export type DiscussionScope = {
  municipalityId: string;
  caseId: string;
};

export type DiscussionEvent = {
  id: string;
  pubkey: string;
  createdAt: number;
  kind: number;
  content: string;
  tags: string[][];
  relayRefs: string[];
};

export type DiscussionVerificationProof =
  | {
      kind: "nostr_nip01";
      verified: true;
      signature: string;
    }
  | {
      kind: "synthetic_fixture";
      deterministic: true;
      fixtureId: string;
    };

/**
 * A source-normalized discussion record.  This artifact is deliberately
 * advisory: it carries no proposal, suggestion, vote, publication, or legal
 * authority transition.
 */
export type DiscussionArtifact = {
  schemaVersion: typeof DISCUSSION_ARTIFACT_SCHEMA_VERSION;
  id: string;
  source: DiscussionSource;
  sourceRef: string;
  municipalityId: string;
  caseId: string;
  authorityBinding: "none";
  verificationProof: DiscussionVerificationProof;
  event: DiscussionEvent;
};

export type SyntheticDiscussionFixture = {
  fixtureId?: string;
  id?: string;
  scope?: DiscussionScope;
  municipalityId?: string;
  caseId?: string;
  kind?: number;
  createdAt?: number;
  content?: string;
  tags?: readonly (readonly string[])[];
  relayRefs?: readonly string[];
  pubkey?: string;
};

export type NostrDiscussionInput = {
  event: NostrEvent;
  scope?: DiscussionScope;
  relayRefs?: readonly string[];
};

export type DiscussionAdapterOptions = {
  scope?: DiscussionScope;
  municipalityId?: string;
  caseId?: string;
  allowedKinds?: readonly number[];
  /** Require the explicit app marker before accepting a synthetic fixture. */
  syntheticFixtureOnly?: boolean;
};

export interface DiscussionAdapter<Input> {
  readonly source: DiscussionSource;
  normalize(input: Input, scope?: DiscussionScope): DiscussionArtifact;
  ingest(input: Input, scope?: DiscussionScope): DiscussionArtifact;
  adapt(input: Input, scope?: DiscussionScope): DiscussionArtifact;
}

type InternalDiscussionAdapterOptions = {
  configuredScope?: DiscussionScope;
  allowedKinds: ReadonlySet<number>;
  syntheticFixtureOnly: boolean;
};

const DEFAULT_ALLOWED_KINDS = [1] as const;
const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeNonEmptyString(value: unknown, error: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(error);
  }
  return value.trim();
}

function normalizeScope(value: unknown, error = "discussion_scope_required"): DiscussionScope {
  if (!isRecord(value)) {
    throw new Error(error);
  }
  return {
    municipalityId: normalizeNonEmptyString(value.municipalityId, error),
    caseId: normalizeNonEmptyString(value.caseId, error),
  };
}

function scopesEqual(left: DiscussionScope, right: DiscussionScope): boolean {
  return (
    left.municipalityId === right.municipalityId &&
    left.caseId === right.caseId
  );
}

function resolveScope(candidates: readonly (DiscussionScope | undefined)[]): DiscussionScope {
  const present = candidates.filter(
    (candidate): candidate is DiscussionScope => candidate !== undefined,
  );
  if (present.length === 0) {
    throw new Error("discussion_scope_required");
  }
  const first = present[0]!;
  if (present.some((candidate) => !scopesEqual(first, candidate))) {
    throw new Error("discussion_scope_mismatch");
  }
  return { ...first };
}

function configuredScopeFromOptions(
  options: DiscussionAdapterOptions,
): DiscussionScope | undefined {
  const directScope =
    options.municipalityId !== undefined || options.caseId !== undefined
      ? normalizeScope(
          {
            municipalityId: options.municipalityId,
            caseId: options.caseId,
          },
          "discussion_scope_invalid",
        )
      : undefined;
  const explicitScope =
    options.scope === undefined ? undefined : normalizeScope(options.scope, "discussion_scope_invalid");
  return resolveOptionalScopes(directScope, explicitScope);
}

function resolveOptionalScopes(
  ...candidates: readonly (DiscussionScope | undefined)[]
): DiscussionScope | undefined {
  const present = candidates.filter(
    (candidate): candidate is DiscussionScope => candidate !== undefined,
  );
  if (present.length === 0) {
    return undefined;
  }
  const first = present[0]!;
  if (present.some((candidate) => !scopesEqual(first, candidate))) {
    throw new Error("discussion_scope_invalid");
  }
  return { ...first };
}

function normalizeAdapterOptions(
  options: DiscussionAdapterOptions = {},
): InternalDiscussionAdapterOptions {
  const allowedKinds = options.allowedKinds ?? DEFAULT_ALLOWED_KINDS;
  if (
    !Array.isArray(allowedKinds) ||
    allowedKinds.length === 0 ||
    allowedKinds.some(
      (kind) =>
        !Number.isInteger(kind) || kind < 0 || kind > 65_535,
    )
  ) {
    throw new Error("discussion_allowed_kinds_invalid");
  }
  return {
    configuredScope: configuredScopeFromOptions(options),
    allowedKinds: new Set(allowedKinds),
    syntheticFixtureOnly: options.syntheticFixtureOnly === true,
  };
}

function assertSyntheticFixtureMarker(
  tags: readonly (readonly string[])[],
  required: boolean,
): void {
  if (!required) return;
  const [name, value] = STADTSTACK_E2E_FIXTURE_TAG;
  if (!tags.some((tag) => tag[0] === name && tag[1] === value)) {
    throw new Error("discussion_fixture_marker_required");
  }
}

function normalizeTags(value: unknown): string[][] {
  if (!Array.isArray(value)) {
    throw new Error("discussion_tags_invalid");
  }
  return value.map((tag) => {
    if (
      !Array.isArray(tag) ||
      tag.length === 0 ||
      tag.some((part) => typeof part !== "string")
    ) {
      throw new Error("discussion_tags_invalid");
    }
    return [...tag];
  });
}

function collectUniqueNonEmptyStrings(value: unknown, error: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(error);
  }
  const normalized = value.map((item) => normalizeNonEmptyString(item, error));
  return [...new Set(normalized)];
}

function normalizeRelayRefs(value: unknown): string[] {
  const refs = collectUniqueNonEmptyStrings(value, "discussion_relay_invalid");
  for (const ref of refs) {
    let parsed: URL;
    try {
      parsed = new URL(ref);
    } catch {
      throw new Error("discussion_relay_invalid");
    }
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      throw new Error("discussion_relay_invalid");
    }
  }
  return refs.sort();
}

function canonicalizeRelayRefs(refs: readonly string[]): string[] {
  return [...new Set(refs)].sort();
}

function relayRefsFromTags(tags: readonly (readonly string[])[]): string[] {
  const refs: string[] = [];
  for (const tag of tags) {
    if (tag[0] === "relay" && tag[1]) {
      refs.push(tag[1]);
    }
    if ((tag[0] === "e" || tag[0] === "p" || tag[0] === "a") && tag[2]) {
      refs.push(tag[2]);
    }
  }
  return normalizeRelayRefs(refs);
}

const MUNICIPALITY_TAG_NAMES = new Set([
  "municipality",
  "municipality_id",
  "municipalityId",
]);
const CASE_TAG_NAMES = new Set(["case", "case_id", "caseId"]);

function extractScopeFromTags(tags: readonly (readonly string[])[]): DiscussionScope | undefined {
  const municipalities: string[] = [];
  const cases: string[] = [];
  const pairScopes: DiscussionScope[] = [];
  for (const tag of tags) {
    const name = tag[0];
    if (name === "scope" && tag.length >= 3) {
      pairScopes.push(
        normalizeScope(
          { municipalityId: tag[1], caseId: tag[2] },
          "discussion_scope_invalid",
        ),
      );
    }
    if (MUNICIPALITY_TAG_NAMES.has(name) && tag[1] !== undefined) {
      municipalities.push(normalizeNonEmptyString(tag[1], "discussion_scope_invalid"));
    }
    if (CASE_TAG_NAMES.has(name) && tag[1] !== undefined) {
      cases.push(normalizeNonEmptyString(tag[1], "discussion_scope_invalid"));
    }
  }
  const municipalityValues = [...new Set(municipalities)];
  const caseValues = [...new Set(cases)];
  if (pairScopes.length > 0) {
    const pairScope = pairScopes[0]!;
    if (
      pairScopes.some((candidate) => !scopesEqual(pairScope, candidate)) ||
      municipalityValues.some((value) => value !== pairScope.municipalityId) ||
      caseValues.some((value) => value !== pairScope.caseId)
    ) {
      throw new Error("discussion_scope_mismatch");
    }
    return pairScope;
  }
  if (municipalityValues.length === 0 && caseValues.length === 0) {
    return undefined;
  }
  if (
    municipalityValues.length !== 1 ||
    caseValues.length !== 1
  ) {
    throw new Error("discussion_scope_invalid");
  }
  return {
    municipalityId: municipalityValues[0]!,
    caseId: caseValues[0]!,
  };
}

function ensureSyntheticScopeTags(tags: string[][], scope: DiscussionScope): string[][] {
  const normalized = tags.map((tag) => [...tag]);
  const tagScope = extractScopeFromTags(normalized);
  if (tagScope) {
    return normalized;
  }
  normalized.push(["municipality", scope.municipalityId]);
  normalized.push(["case", scope.caseId]);
  return normalized;
}

function normalizeContent(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("discussion_content_required");
  }
  return value;
}

function normalizeCreatedAt(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("discussion_timestamp_invalid");
  }
  return value as number;
}

function normalizeKind(
  value: unknown,
  allowedKinds: ReadonlySet<number>,
): number {
  const kind = normalizeEventKind(value);
  if (!allowedKinds.has(kind)) {
    throw new Error("discussion_kind_forbidden");
  }
  return kind;
}

function normalizeEventKind(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 65_535) {
    throw new Error("discussion_kind_invalid");
  }
  return value as number;
}

function cloneArtifact(artifact: DiscussionArtifact): DiscussionArtifact {
  return {
    ...artifact,
    verificationProof:
      artifact.verificationProof.kind === "nostr_nip01"
        ? { ...artifact.verificationProof }
        : { ...artifact.verificationProof },
    event: {
      ...artifact.event,
      tags: artifact.event.tags.map((tag) => [...tag]),
      relayRefs: [...artifact.event.relayRefs],
    },
  };
}

function artifactDigest(artifact: DiscussionArtifact): string {
  return JSON.stringify(artifact);
}

abstract class StatefulDiscussionAdapter<Input> implements DiscussionAdapter<Input> {
  abstract readonly source: DiscussionSource;
  private readonly seen = new Map<string, DiscussionArtifact>();
  protected readonly options: InternalDiscussionAdapterOptions;

  protected constructor(options: InternalDiscussionAdapterOptions) {
    this.options = options;
  }

  protected abstract buildArtifact(
    input: Input,
    requestedScope?: DiscussionScope,
  ): DiscussionArtifact;

  normalize(input: Input, scope?: DiscussionScope): DiscussionArtifact {
    const artifact = this.buildArtifact(input, scope);
    const existing = this.seen.get(artifact.id);
    if (existing) {
      if (artifactDigest(existing) === artifactDigest(artifact)) {
        return cloneArtifact(existing);
      }
      throw new Error("discussion_duplicate_conflict");
    }
    this.seen.set(artifact.id, cloneArtifact(artifact));
    return cloneArtifact(artifact);
  }

  ingest(input: Input, scope?: DiscussionScope): DiscussionArtifact {
    return this.normalize(input, scope);
  }

  adapt(input: Input, scope?: DiscussionScope): DiscussionArtifact {
    return this.normalize(input, scope);
  }
}

export class SyntheticDiscussionAdapter extends StatefulDiscussionAdapter<SyntheticDiscussionFixture> {
  readonly source = "synthetic_fixture" as const;

  constructor(options: DiscussionAdapterOptions = {}) {
    super(normalizeAdapterOptions(options));
  }

  protected buildArtifact(
    input: SyntheticDiscussionFixture,
    requestedScope?: DiscussionScope,
  ): DiscussionArtifact {
    if (!isRecord(input)) {
      throw new Error("discussion_fixture_invalid");
    }
    const fixtureId = normalizeNonEmptyString(
      input.fixtureId ?? input.id,
      "discussion_fixture_id_required",
    );
    const fixtureScope = resolveOptionalScopes(
      input.scope === undefined ? undefined : normalizeScope(input.scope),
      input.municipalityId === undefined && input.caseId === undefined
        ? undefined
        : normalizeScope({
            municipalityId: input.municipalityId,
            caseId: input.caseId,
          }),
    );
    const rawTags = normalizeTags(input.tags ?? []);
    assertSyntheticFixtureMarker(rawTags, this.options.syntheticFixtureOnly);
    const tagScope = extractScopeFromTags(rawTags);
    const scope = resolveScope([
      this.options.configuredScope,
      requestedScope === undefined ? undefined : normalizeScope(requestedScope),
      fixtureScope,
      tagScope,
    ]);
    const tags = ensureSyntheticScopeTags(rawTags, scope);
    const kind = normalizeKind(input.kind ?? 1, this.options.allowedKinds);
    const createdAt = normalizeCreatedAt(input.createdAt);
    const content = normalizeContent(input.content);
    const pubkey = normalizeNonEmptyString(
      input.pubkey ?? "synthetic:pubkey",
      "discussion_pubkey_required",
    );
    const relayRefs = [
      ...normalizeRelayRefs(input.relayRefs),
      ...relayRefsFromTags(tags),
    ];
    const eventRelayRefs = canonicalizeRelayRefs(relayRefs);
    const id = `synthetic:${fixtureId}`;
    return {
      schemaVersion: DISCUSSION_ARTIFACT_SCHEMA_VERSION,
      id,
      source: this.source,
      sourceRef: `synthetic://discussion/${encodeURIComponent(fixtureId)}`,
      municipalityId: scope.municipalityId,
      caseId: scope.caseId,
      authorityBinding: "none",
      verificationProof: {
        kind: "synthetic_fixture",
        deterministic: true,
        fixtureId,
      },
      event: {
        id,
        pubkey,
        createdAt,
        kind,
        content,
        tags,
        relayRefs: eventRelayRefs,
      },
    };
  }
}

export class NostrDiscussionAdapter extends StatefulDiscussionAdapter<
  NostrDiscussionInput | NostrEvent
> {
  readonly source = "nostr" as const;

  constructor(options: DiscussionAdapterOptions = {}) {
    super(normalizeAdapterOptions(options));
  }

  protected buildArtifact(
    input: NostrDiscussionInput | NostrEvent,
    requestedScope?: DiscussionScope,
  ): DiscussionArtifact {
    const wrapper = isRecord(input) && "event" in input
      ? input
      : { event: input };
    const event = normalizeAndVerifyNostrEvent(wrapper.event);
    const kind = normalizeKind(event.kind, this.options.allowedKinds);
    assertSyntheticFixtureMarker(event.tags, this.options.syntheticFixtureOnly);
    const tagScope = extractScopeFromTags(event.tags);
    if (!tagScope) {
      throw new Error("discussion_scope_missing");
    }
    const inputScope =
      wrapper.scope === undefined ? undefined : normalizeScope(wrapper.scope);
    const scope = resolveScope([
      this.options.configuredScope,
      requestedScope === undefined ? undefined : normalizeScope(requestedScope),
      inputScope,
      tagScope,
    ]);
    const explicitRelayRefs = normalizeRelayRefs(wrapper.relayRefs);
    const relayRefs = [
      ...explicitRelayRefs,
      ...relayRefsFromTags(event.tags),
    ];
    return {
      schemaVersion: DISCUSSION_ARTIFACT_SCHEMA_VERSION,
      id: event.id,
      source: this.source,
      sourceRef: `nostr://event/${event.id}`,
      municipalityId: scope.municipalityId,
      caseId: scope.caseId,
      authorityBinding: "none",
      verificationProof: {
        kind: "nostr_nip01",
        verified: true,
        signature: event.sig,
      },
      event: {
        id: event.id,
        pubkey: event.pubkey,
        createdAt: event.created_at,
        kind,
        content: event.content,
        tags: event.tags.map((tag) => [...tag]),
        relayRefs: canonicalizeRelayRefs(relayRefs),
      },
    };
  }
}

function normalizeAndVerifyNostrEvent(value: unknown): NostrEvent {
  if (!isRecord(value)) {
    throw new Error("discussion_event_invalid");
  }
  if (
    typeof value.id !== "string" ||
    !HEX_64.test(value.id)
  ) {
    throw new Error("discussion_event_id_invalid");
  }
  if (
    typeof value.pubkey !== "string" ||
    !HEX_64.test(value.pubkey)
  ) {
    throw new Error("discussion_event_pubkey_invalid");
  }
  if (
    typeof value.sig !== "string" ||
    !HEX_128.test(value.sig)
  ) {
    throw new Error("discussion_event_signature_invalid");
  }
  const createdAt = normalizeCreatedAt(value.created_at);
  const kind = normalizeEventKind(value.kind);
  const tags = normalizeTags(value.tags);
  const content = normalizeContent(value.content);
  const candidate = {
    id: value.id,
    pubkey: value.pubkey,
    created_at: createdAt,
    kind,
    tags,
    content,
    sig: value.sig,
  } as NostrEvent;
  if (!validateEvent(candidate)) {
    throw new Error("discussion_event_invalid");
  }
  let calculatedId: string;
  try {
    calculatedId = getEventHash(candidate);
  } catch {
    throw new Error("discussion_event_id_invalid");
  }
  if (calculatedId !== candidate.id) {
    throw new Error("discussion_event_id_invalid");
  }
  let validSignature = false;
  try {
    validSignature = verifyEvent(candidate);
  } catch {
    validSignature = false;
  }
  if (!validSignature) {
    throw new Error("discussion_event_signature_invalid");
  }
  return candidate;
}

export function createSyntheticDiscussionAdapter(
  options: DiscussionAdapterOptions = {},
): SyntheticDiscussionAdapter {
  return new SyntheticDiscussionAdapter(options);
}

export function createNostrDiscussionAdapter(
  options: DiscussionAdapterOptions = {},
): NostrDiscussionAdapter {
  return new NostrDiscussionAdapter(options);
}

export const createSignedNostrDiscussionAdapter = createNostrDiscussionAdapter;
export { SyntheticDiscussionAdapter as SyntheticFixtureDiscussionAdapter };
export { NostrDiscussionAdapter as SignedNostrDiscussionAdapter };
