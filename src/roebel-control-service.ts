import { types as utilTypes } from "node:util";
import type { Event as NostrEvent } from "nostr-tools/pure";

import {
  verifyPublicCaseBindingReceipt,
  type PublicCaseBindingReceiptV1,
} from "./case-binding-projection.ts";
import type { CitizenSignedTopicSuggestionV1 } from "./citizen-suggestion.ts";
import type { ActorBinding } from "./civic-case-coordinator.ts";
import {
  verifyTopicCaseAdmission,
  type VerifiedTopicCaseAdmissionV1,
} from "./topic-case-admission.ts";

export type RoebelControlRequest = {
  method: string;
  path: string;
  authorization: unknown;
  body: unknown;
};

export type RoebelControlResponse = {
  status: 200 | 400 | 401 | 404 | 405 | 409 | 500;
  headers: Readonly<Record<string, string>>;
  body: string;
};

export type CaseStewardPrincipal = {
  actorId: string;
  actorClass: "case_steward";
  municipalityIds: readonly string[];
};

export type CaseStewardAuthenticator = {
  authenticate(input: {
    authorization: unknown;
    method: "POST";
    path: "/v1/nostr/suggestions/admit";
  }): Promise<CaseStewardPrincipal | null>;
};

export type AtomicTopicCaseAdmissionV1 = {
  schemaVersion: "atomic_topic_case_admission_v1";
  municipalityId: string;
  rootEventId: string;
  caseId: string;
  actorBinding: ActorBinding;
  expectedCaseVersion: 0;
  idempotencyKey: string;
  policyVersion: string;
  sourceDiscussion: NostrEvent;
  verifiedAdmission: VerifiedTopicCaseAdmissionV1;
};

/**
 * Deployment-owned durable port. Implementations must claim the immutable
 * discussion root, append the Case events, and enqueue the public receipt in
 * one transaction (or an equivalent replay-safe journal/outbox boundary).
 */
export type AtomicCaseAdmissionPort = {
  admit(input: AtomicTopicCaseAdmissionV1): Promise<PublicCaseBindingReceiptV1>;
};

export type RoebelCaseStewardControlConfig = {
  municipalityId: string;
  policyVersion: string;
  allowedAgentPubkeys: readonly string[];
  caseStewardAuthenticator: CaseStewardAuthenticator;
  atomicAdmission: AtomicCaseAdmissionPort;
};

export type RoebelCaseStewardControlService = {
  respond(request: RoebelControlRequest): Promise<RoebelControlResponse>;
};

type AdmissionBody = {
  schemaVersion: "roebel_case_steward_admission_request_v1";
  sourceDiscussion: NostrEvent;
  sourceAnswer: NostrEvent;
  signedSuggestion: CitizenSignedTopicSuggestionV1;
};

const ADMISSION_PATH = "/v1/nostr/suggestions/admit" as const;
const MUNICIPALITY_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const HEX64 = /^[0-9a-f]{64}$/u;

function fail(code: string): never { throw new Error(code); }

function plain(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  return value as Record<string, unknown>;
}

function exact(value: unknown, fields: readonly string[], code: string): Record<string, unknown> {
  const parsed = plain(value, code);
  const keys = Reflect.ownKeys(parsed);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" || !fields.includes(key))) fail(code);
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(parsed, field);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail(code);
  }
  return parsed;
}

function text(value: unknown, code: string, expression: RegExp, max = 256): string {
  if (typeof value !== "string" || value !== value.trim() || value.length === 0 ||
    value.length > max || !expression.test(value)) fail(code);
  return value;
}

function admissionBody(value: unknown): AdmissionBody {
  const parsed = exact(value, ["schemaVersion", "sourceDiscussion", "sourceAnswer", "signedSuggestion"], "roebel_admission_body_invalid");
  if (parsed.schemaVersion !== "roebel_case_steward_admission_request_v1") fail("roebel_admission_body_invalid");
  return {
    schemaVersion: "roebel_case_steward_admission_request_v1",
    sourceDiscussion: structuredClone(parsed.sourceDiscussion) as NostrEvent,
    sourceAnswer: structuredClone(parsed.sourceAnswer) as NostrEvent,
    signedSuggestion: structuredClone(parsed.signedSuggestion) as CitizenSignedTopicSuggestionV1,
  };
}

function principal(value: unknown, municipalityId: string): CaseStewardPrincipal {
  const parsed = exact(value, ["actorId", "actorClass", "municipalityIds"], "case_steward_principal_invalid");
  const actorId = text(parsed.actorId, "case_steward_principal_invalid", /^[A-Za-z0-9:._-]+$/u);
  if (parsed.actorClass !== "case_steward" || !Array.isArray(parsed.municipalityIds) ||
    utilTypes.isProxy(parsed.municipalityIds) || Object.getPrototypeOf(parsed.municipalityIds) !== Array.prototype ||
    parsed.municipalityIds.length === 0 || parsed.municipalityIds.some((entry) =>
      typeof entry !== "string" || !MUNICIPALITY_ID.test(entry)) ||
    new Set(parsed.municipalityIds).size !== parsed.municipalityIds.length ||
    !parsed.municipalityIds.includes(municipalityId)) fail("case_steward_principal_invalid");
  return Object.freeze({
    actorId,
    actorClass: "case_steward",
    municipalityIds: Object.freeze([...parsed.municipalityIds] as string[]),
  });
}

function response(status: RoebelControlResponse["status"], body: string, extra: Readonly<Record<string, string>> = {}): RoebelControlResponse {
  return Object.freeze({ status, headers: Object.freeze({
    "cache-control": "no-store",
    "content-type": status === 200 ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "content-length": String(Buffer.byteLength(body, "utf8")),
    "x-content-type-options": "nosniff",
    ...extra,
  }), body });
}

function receiptForAdmission(value: unknown, verified: VerifiedTopicCaseAdmissionV1): PublicCaseBindingReceiptV1 {
  const receipt = verifyPublicCaseBindingReceipt(value);
  if (receipt.rootEventId !== verified.discussion.id ||
    receipt.topicId !== verified.identity.topicId ||
    receipt.candidateId !== verified.signedSuggestion.candidateId ||
    receipt.candidateEventId !== verified.signedSuggestion.event.id ||
    receipt.sourceAnswerEventId !== verified.sourceAnswer.id ||
    receipt.caseId !== verified.identity.caseId) fail("atomic_admission_receipt_mismatch");
  return receipt;
}

/**
 * Staff-only protocol handler. It exposes no public GET route, projection
 * writer, listener, secret lookup, coordinator, or later civic capability.
 * The network adapter must reject oversized bodies before JSON decoding.
 */
export function createRoebelCaseStewardControlService(
  config: RoebelCaseStewardControlConfig,
): RoebelCaseStewardControlService {
  const parsed = exact(config, [
    "municipalityId", "policyVersion", "allowedAgentPubkeys",
    "caseStewardAuthenticator", "atomicAdmission",
  ], "roebel_control_config_invalid");
  const municipalityId = text(parsed.municipalityId, "roebel_control_config_invalid", MUNICIPALITY_ID);
  const policyVersion = text(parsed.policyVersion, "roebel_control_config_invalid", /^[A-Za-z0-9:._-]+$/u);
  if (!Array.isArray(parsed.allowedAgentPubkeys) || utilTypes.isProxy(parsed.allowedAgentPubkeys) ||
    Object.getPrototypeOf(parsed.allowedAgentPubkeys) !== Array.prototype || parsed.allowedAgentPubkeys.length === 0 ||
    parsed.allowedAgentPubkeys.some((value) => typeof value !== "string" || !HEX64.test(value)) ||
    new Set(parsed.allowedAgentPubkeys).size !== parsed.allowedAgentPubkeys.length) fail("roebel_control_config_invalid");
  const allowedAgentPubkeys = Object.freeze([...(parsed.allowedAgentPubkeys as readonly string[])]);
  const authenticator = parsed.caseStewardAuthenticator as CaseStewardAuthenticator;
  const atomicAdmission = parsed.atomicAdmission as AtomicCaseAdmissionPort;
  if (!authenticator || typeof authenticator.authenticate !== "function" ||
    !atomicAdmission || typeof atomicAdmission.admit !== "function") fail("roebel_control_config_invalid");

  return Object.freeze({
    async respond(request: RoebelControlRequest): Promise<RoebelControlResponse> {
      let parsedRequest: Record<string, unknown>;
      try { parsedRequest = exact(request, ["method", "path", "authorization", "body"], "roebel_control_request_invalid"); }
      catch { return response(400, "request_invalid\n"); }
      if (typeof parsedRequest.method !== "string" || typeof parsedRequest.path !== "string") return response(400, "request_invalid\n");
      if (parsedRequest.path !== ADMISSION_PATH) return response(404, "not_found\n");
      if (parsedRequest.method !== "POST") return response(405, "method_not_allowed\n", { allow: "POST" });

      let steward: CaseStewardPrincipal;
      try {
        const authenticated = await authenticator.authenticate({
          authorization: parsedRequest.authorization,
          method: "POST",
          path: ADMISSION_PATH,
        });
        steward = principal(authenticated, municipalityId);
      } catch {
        return response(401, "case_steward_required\n");
      }

      let body: AdmissionBody;
      try { body = admissionBody(parsedRequest.body); }
      catch { return response(400, "admission_body_invalid\n"); }

      let verified: VerifiedTopicCaseAdmissionV1;
      try {
        verified = verifyTopicCaseAdmission({ ...body, allowedAgentPubkeys });
        if (verified.identity.municipalityId !== municipalityId) fail("municipality_scope_mismatch");
      } catch {
        return response(400, "admission_invalid\n");
      }

      const atomicInput: AtomicTopicCaseAdmissionV1 = Object.freeze({
        schemaVersion: "atomic_topic_case_admission_v1",
        municipalityId,
        rootEventId: verified.discussion.id,
        caseId: verified.identity.caseId,
        actorBinding: Object.freeze({ actorId: steward.actorId, actorClass: "case_steward" }),
        expectedCaseVersion: 0,
        idempotencyKey: `roebel:admit-signed-topic-suggestion:${verified.signedSuggestion.event.id}`,
        policyVersion,
        sourceDiscussion: body.sourceDiscussion,
        verifiedAdmission: verified,
      });

      let candidateReceipt: PublicCaseBindingReceiptV1;
      try {
        candidateReceipt = await atomicAdmission.admit(atomicInput);
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        if (["case_binding_root_conflict", "idempotency_conflict", "case_version_conflict"].includes(code)) {
          return response(409, `${code}\n`);
        }
        return response(500, "admission_unavailable\n");
      }

      let receipt: PublicCaseBindingReceiptV1;
      try { receipt = receiptForAdmission(candidateReceipt, verified); }
      catch { return response(500, "admission_receipt_invalid\n"); }
      return response(200, `${JSON.stringify(receipt)}\n`, {
        "x-stadtstack-receipt-sha256": receipt.receiptChecksum,
      });
    },
  });
}
