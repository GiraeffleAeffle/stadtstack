import type { DurableCaseContinuation } from "./durable-case-continuation.ts";
import type { DepartmentDraftInput, DepartmentPackageInput, DepartmentReviewInput } from "./civic-case-coordinator.ts";
import { parseSyntheticCaseId } from "./case-id.ts";

export const ADMINISTRATION_REVIEW_PATH = "/v1/staging/administration/review";
export const SYNTHETIC_CITIZEN_BRIEF_PATH = "/v1/staging/administration/citizen-brief";
export const ADMINISTRATION_REVIEW_MAX_BODY_BYTES = 65_536;

/** Canonical path only: a selector never conveys a role or admits a Case. */
export function administrationReviewCasePath(caseId: string, operation: "review" | "citizen-brief" = "review"): string {
  if (!parseSyntheticCaseId(caseId)) throw new Error("administration_review_config_invalid");
  return `/v1/staging/administration/cases/${encodeURIComponent(caseId)}/${operation}`;
}

export function parseAdministrationReviewPath(path: string): { caseId: string | null; operation: "review" | "citizen-brief" } | null {
  if (path === ADMINISTRATION_REVIEW_PATH) return { caseId: null, operation: "review" };
  if (path === SYNTHETIC_CITIZEN_BRIEF_PATH) return { caseId: null, operation: "citizen-brief" };
  const match = /^\/v1\/staging\/administration\/cases\/([^/]+)\/(review|citizen-brief)$/u.exec(path);
  if (!match) return null;
  try {
    const caseId = decodeURIComponent(match[1]!);
    const operation = match[2] as "review" | "citizen-brief";
    return administrationReviewCasePath(caseId, operation) === path ? { caseId, operation } : null;
  } catch { return null; }
}

type ReviewPort = Pick<DurableCaseContinuation,
  "administrationView" | "assignDepartmentPackage" | "recordDepartmentDraft" | "attestDepartmentReview" |
  "prepareCitizenBrief" | "applyCitizenBrief" | "currentSyntheticCitizenBrief">;
export type AdministrationReviewRequest = {
  method: string;
  path: string;
  authorization: unknown;
  /** Raw UTF-8 JSON; authentication precedes decoding. */
  body: string | null;
};
export type AdministrationReviewResponse = {
  status: 200 | 400 | 401 | 403 | 404 | 405 | 409 | 413 | 500;
  headers: Readonly<Record<string, string>>;
  body: string;
};
export type AdministrationReviewService = {
  respond(request: AdministrationReviewRequest): Promise<AdministrationReviewResponse>;
};

function response(status: AdministrationReviewResponse["status"], value: unknown): AdministrationReviewResponse {
  return { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff" }, body: JSON.stringify(value) };
}
function error(status: AdministrationReviewResponse["status"], code: string): AdministrationReviewResponse {
  return response(status, { error: code });
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error("review_request_invalid");
  }
  return value as Record<string, unknown>;
}

/** Explicitly pinned synthetic Cases. Trusted identity comes solely from the
 * continuation authenticator; selecting a Case does not authorize access.
 * The separate credential-free GET returns only the synthetic Brief projection.
 * No admission, participation, municipal publication or treasury port exists. */
export function createAdministrationReviewService(config: {
  deploymentEnvironment: "staging";
  caseId: string;
  additionalCaseIds?: readonly string[];
  continuation: ReviewPort;
}): AdministrationReviewService {
  const identity = parseSyntheticCaseId(config.caseId);
  const extra = config.additionalCaseIds === undefined ? [] : config.additionalCaseIds;
  if (config.deploymentEnvironment !== "staging" || !identity || !Array.isArray(extra) || extra.length > 7 ||
    extra.some(id => parseSyntheticCaseId(id)?.municipalityId !== identity.municipalityId) ||
    new Set([config.caseId, ...extra]).size !== extra.length + 1) {
    throw new Error("administration_review_config_invalid");
  }
  const defaultCaseId = config.caseId;
  const caseIds = new Set([defaultCaseId, ...extra]);
  const port: ReviewPort = Object.freeze({
    administrationView: config.continuation.administrationView.bind(config.continuation),
    assignDepartmentPackage: config.continuation.assignDepartmentPackage.bind(config.continuation),
    recordDepartmentDraft: config.continuation.recordDepartmentDraft.bind(config.continuation),
    attestDepartmentReview: config.continuation.attestDepartmentReview.bind(config.continuation),
    prepareCitizenBrief: config.continuation.prepareCitizenBrief.bind(config.continuation),
    applyCitizenBrief: config.continuation.applyCitizenBrief.bind(config.continuation),
    currentSyntheticCitizenBrief: config.continuation.currentSyntheticCitizenBrief.bind(config.continuation),
  });
  return Object.freeze({
    async respond(request) {
      const route = parseAdministrationReviewPath(request.path);
      if (!route) return error(404, "not_found");
      const caseId = route.caseId ?? defaultCaseId;
      if (!caseIds.has(caseId)) return error(404, "not_found");
      if (route.operation === "citizen-brief") {
        if (request.method !== "GET") return error(405, "method_not_allowed");
        if (request.body !== null || request.authorization != null) return error(400, "request_invalid");
        try { return response(200, port.currentSyntheticCitizenBrief({ caseId })); }
        catch { return error(500, "brief_unavailable"); }
      }
      if (request.method !== "GET" && request.method !== "POST") return error(405, "method_not_allowed");
      if (request.body !== null && (typeof request.body !== "string" ||
        Buffer.byteLength(request.body, "utf8") > ADMINISTRATION_REVIEW_MAX_BODY_BYTES)) return error(413, "request_too_large");
      const authorized = { authorization: request.authorization, caseId };
      try {
        const view = await port.administrationView(authorized);
        if (view.caseId !== caseId || view.caseKind !== "synthetic_case" || view.testOnly !== true || view.authorityBinding !== "none") {
          return error(500, "review_unavailable");
        }
        if (request.method === "GET") return request.body === null
          ? response(200, view) : error(400, "request_invalid");
        if (request.body === null) return error(400, "request_invalid");
        const body = exact(JSON.parse(request.body), ["schemaVersion", "operation", "expectedCaseVersion", "payload"]);
        if (body.schemaVersion !== "administration_review_request_v1" ||
          !Number.isSafeInteger(body.expectedCaseVersion) || (body.expectedCaseVersion as number) < 3) {
          return error(400, "request_invalid");
        }
        const input = { ...authorized, expectedCaseVersion: body.expectedCaseVersion as number };
        let receipt;
        if (body.operation === "assign") {
          const payload = exact(body.payload, ["departmentPackage"]);
          receipt = await port.assignDepartmentPackage({ ...input, departmentPackage: payload.departmentPackage as DepartmentPackageInput });
        } else if (body.operation === "draft") {
          const payload = exact(body.payload, ["packageId", "packageChecksum", "draft"]);
          receipt = await port.recordDepartmentDraft({ ...input, packageId: payload.packageId as string,
            packageChecksum: payload.packageChecksum as string, draft: payload.draft as DepartmentDraftInput });
        } else if (body.operation === "review") {
          const payload = exact(body.payload, ["review"]);
          receipt = await port.attestDepartmentReview({ ...input, review: payload.review as DepartmentReviewInput });
        } else if (body.operation === "prepare_brief" || body.operation === "apply_brief") {
          if (view.caseVersion !== input.expectedCaseVersion) return error(409, "review_conflict");
          if (body.operation === "prepare_brief") {
            const payload = exact(body.payload, ["briefId"]);
            const prepared = await port.prepareCitizenBrief({ ...authorized, briefId: payload.briefId as string });
            // The preview must be exactly the snapshot sealed by preparation.
            if (prepared.command.expectedCaseVersion !== view.caseVersion) return error(409, "review_conflict");
            return response(200, { schemaVersion: "synthetic_citizen_brief_preparation_v1", caseId,
              environment: "staging", testOnly: true, authorityBinding: "none", state: "prepared_not_applied",
              caseVersion: view.caseVersion, briefId: prepared.command.payload.brief.id,
              preparationChecksum: prepared.preparationChecksum,
              preview: { title: view.suggestion.title, responses: view.departmentPackages
                .filter(item => item.reviewState === "accepted" && item.correctionState === "current" && item.draft)
                .map(item => ({ departmentId: item.departmentId, publicSummary: item.draft!.publicSummary,
                  publicCitations: [...new Set(item.draft!.publicCitations)].sort() })) } });
          }
          const payload = exact(body.payload, ["briefId", "preparationChecksum"]);
          receipt = await port.applyCitizenBrief({ ...authorized, briefId: payload.briefId as string,
            preparationChecksum: payload.preparationChecksum as string });
        } else return error(400, "operation_invalid");
        return response(200, { schemaVersion: "synthetic_administration_review_receipt_v1", caseId,
          environment: "staging", testOnly: true, authorityBinding: "none", receipt });
      } catch (failure) {
        const code = failure instanceof Error ? failure.message : "";
        if (code === "durable_continuation_authentication_required") return error(401, "authentication_required");
        if (code === "durable_continuation_actor_forbidden" || code === "actor_role_forbidden") return error(403, "role_forbidden");
        if (failure instanceof SyntaxError || code === "review_request_invalid") return error(400, "request_invalid");
        if (/^(?:case_version_conflict|idempotency_conflict|department_|citizen_brief_|durable_continuation_(?:draft|assignment|review|package|brief))/.test(code)) {
          return error(409, "review_conflict");
        }
        return error(500, "review_unavailable");
      }
    },
  });
}
