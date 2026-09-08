import type { DurableCaseContinuation } from "./durable-case-continuation.ts";
import type { DepartmentDraftInput, DepartmentPackageInput, DepartmentReviewInput } from "./civic-case-coordinator.ts";
import { parseSyntheticCaseId } from "./case-id.ts";

export const ADMINISTRATION_REVIEW_PATH = "/v1/staging/administration/review";
export const ADMINISTRATION_REVIEW_MAX_BODY_BYTES = 65_536;

type ReviewPort = Pick<DurableCaseContinuation,
  "administrationView" | "assignDepartmentPackage" | "recordDepartmentDraft" | "attestDepartmentReview">;
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

/** One pinned synthetic Case. Trusted identity comes solely from the injected
 * continuation authenticator; a request cannot supply actor or Case bindings.
 * This service has no admission, participation, publication or public-read port. */
export function createAdministrationReviewService(config: {
  deploymentEnvironment: "staging";
  caseId: string;
  continuation: ReviewPort;
}): AdministrationReviewService {
  if (config.deploymentEnvironment !== "staging" || !parseSyntheticCaseId(config.caseId)) {
    throw new Error("administration_review_config_invalid");
  }
  const caseId = config.caseId;
  const port: ReviewPort = Object.freeze({
    administrationView: config.continuation.administrationView.bind(config.continuation),
    assignDepartmentPackage: config.continuation.assignDepartmentPackage.bind(config.continuation),
    recordDepartmentDraft: config.continuation.recordDepartmentDraft.bind(config.continuation),
    attestDepartmentReview: config.continuation.attestDepartmentReview.bind(config.continuation),
  });
  return Object.freeze({
    async respond(request) {
      if (request.path !== ADMINISTRATION_REVIEW_PATH) return error(404, "not_found");
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
        } else return error(400, "operation_invalid");
        return response(200, { schemaVersion: "synthetic_administration_review_receipt_v1", caseId,
          environment: "staging", testOnly: true, authorityBinding: "none", receipt });
      } catch (failure) {
        const code = failure instanceof Error ? failure.message : "";
        if (code === "durable_continuation_authentication_required") return error(401, "authentication_required");
        if (code === "durable_continuation_actor_forbidden" || code === "actor_role_forbidden") return error(403, "role_forbidden");
        if (failure instanceof SyntaxError || code === "review_request_invalid") return error(400, "request_invalid");
        if (/^(?:case_version_conflict|idempotency_conflict|department_|durable_continuation_(?:draft|assignment|review|package))/.test(code)) {
          return error(409, "review_conflict");
        }
        return error(500, "review_unavailable");
      }
    },
  });
}
