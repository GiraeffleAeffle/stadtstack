import { request as httpRequest } from "node:http";
import { types as utilTypes } from "node:util";

import type {
  CaseBindingOutboxEntryV1,
  CaseBindingOutboxReplayInput,
  CredentialFreeCaseBindingOutboxReader,
} from "./case-binding-outbox.ts";
import {
  CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_LIMIT,
  CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_PAGE_BYTES,
  CREDENTIAL_FREE_CASE_BINDING_OUTBOX_PATH,
  parseAndVerifyCredentialFreeCaseBindingOutboxPage,
} from "./credential-free-case-binding-outbox-server.ts";

/** A deployment-pinned private origin; it is never supplied by an HTTP caller. */
export type CredentialFreeCaseBindingOutboxHttpClientConfig = Readonly<{
  origin: string;
}>;

/** The asynchronous form of the credential-free replay port. */
export type CredentialFreeCaseBindingOutboxHttpClient = Readonly<{
  replay(input?: CaseBindingOutboxReplayInput): Promise<readonly CaseBindingOutboxEntryV1[]>;
}>;

const RESPONSE_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_HEADER_BYTES = 8_192;
const CONTENT_TYPE = "application/json; charset=utf-8";
const CONTENT_LENGTH = /^(?:[1-9][0-9]*)$/u;

function fail(code: string): never { throw new Error(code); }

function exactRecord(value: unknown, fields: readonly string[], code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" || !fields.includes(key))) fail(code);
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail(code);
  }
  return value as Record<string, unknown>;
}

type CapturedOrigin = Readonly<{ hostname: string; hostHeader: string; port: number }>;

function captureOrigin(value: unknown): CapturedOrigin {
  const parsed = exactRecord(value, ["origin"], "case_binding_outbox_http_client_config_invalid");
  const descriptor = Object.getOwnPropertyDescriptor(parsed, "origin");
  if (!descriptor || descriptor.get || descriptor.set || typeof descriptor.value !== "string" ||
    Buffer.byteLength(descriptor.value, "utf8") === 0 || Buffer.byteLength(descriptor.value, "utf8") > 512) {
    fail("case_binding_outbox_http_client_config_invalid");
  }
  let origin: URL;
  try {
    origin = new URL(descriptor.value);
  } catch {
    fail("case_binding_outbox_http_client_config_invalid");
  }
  if (origin.protocol !== "http:" || origin.username !== "" || origin.password !== "" ||
    origin.hostname === "" || origin.pathname !== "/" || origin.search !== "" || origin.hash !== "") {
    fail("case_binding_outbox_http_client_config_invalid");
  }
  const port = origin.port === "" ? 80 : Number(origin.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) fail("case_binding_outbox_http_client_config_invalid");
  // Host deliberately omits the transport port. The control listener's allow
  // list is a Service identity, while this client still dials the pinned port.
  return Object.freeze({ hostname: origin.hostname, hostHeader: origin.hostname, port });
}

function captureReplayInput(
  value: unknown = Object.freeze({}),
): Readonly<{ afterSequence: number; limit: number }> {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) {
    fail("case_binding_outbox_http_client_request_invalid");
  }
  const parsed = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(parsed);
  if (keys.length > 2 || keys.some((key) => typeof key !== "string" ||
    !["afterSequence", "limit"].includes(key))) fail("case_binding_outbox_http_client_request_invalid");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(parsed, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      fail("case_binding_outbox_http_client_request_invalid");
    }
  }
  const afterSequence = Object.hasOwn(parsed, "afterSequence") ? parsed.afterSequence : 0;
  const limit = Object.hasOwn(parsed, "limit") ? parsed.limit : CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_LIMIT;
  if (!Number.isSafeInteger(afterSequence) || (afterSequence as number) < 0 ||
    !Number.isSafeInteger(limit) || (limit as number) < 1 ||
    (limit as number) > CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_LIMIT) {
    fail("case_binding_outbox_http_client_request_invalid");
  }
  return Object.freeze({ afterSequence: afterSequence as number, limit: limit as number });
}

function rawHeaderValues(rawHeaders: readonly string[], name: string): readonly string[] {
  const values: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === name) values.push(rawHeaders[index + 1] ?? "");
  }
  return values;
}

function expectedResponseLength(statusCode: number | undefined, rawHeaders: readonly string[]): number | null {
  if (statusCode !== 200) return null;
  if (rawHeaderValues(rawHeaders, "transfer-encoding").length !== 0 || rawHeaderValues(rawHeaders, "content-encoding").length !== 0) {
    return null;
  }
  const contentTypes = rawHeaderValues(rawHeaders, "content-type");
  const lengths = rawHeaderValues(rawHeaders, "content-length");
  if (contentTypes.length !== 1 || contentTypes[0] !== CONTENT_TYPE || lengths.length !== 1 || !CONTENT_LENGTH.test(lengths[0]!)) {
    return null;
  }
  const length = Number(lengths[0]);
  if (!Number.isSafeInteger(length) || length > CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_PAGE_BYTES) return null;
  return length;
}

/**
 * Creates a single-origin, fail-closed HTTP client for the control workload's
 * private outbox listener. It never follows redirects, sends no credentials,
 * and returns entries only after the canonical page and every receipt verify.
 */
export function createCredentialFreeCaseBindingOutboxHttpClient(
  config: CredentialFreeCaseBindingOutboxHttpClientConfig,
): CredentialFreeCaseBindingOutboxHttpClient {
  const origin = captureOrigin(config);

  const replay = async (input?: CaseBindingOutboxReplayInput): Promise<readonly CaseBindingOutboxEntryV1[]> => {
    const request = captureReplayInput(input);
    const target = `${CREDENTIAL_FREE_CASE_BINDING_OUTBOX_PATH}?afterSequence=${request.afterSequence}&limit=${request.limit}`;
    return new Promise((resolve, reject) => {
      let settled = false;
      let client: ReturnType<typeof httpRequest> | undefined;
      const complete = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        callback();
      };
      const unavailable = (): void => complete(() => reject(new Error("case_binding_outbox_transport_unavailable")));
      const deadline = setTimeout(() => {
        client?.destroy();
        unavailable();
      }, RESPONSE_TIMEOUT_MS);

      try {
        client = httpRequest({
          protocol: "http:",
          hostname: origin.hostname,
          port: origin.port,
          method: "GET",
          path: target,
          // `agent: false` prevents connection-pool state from becoming a
          // hidden cross-request channel. There is no proxy setting in Node's
          // core http client and no caller-controllable request option.
          agent: false,
          maxHeaderSize: MAX_RESPONSE_HEADER_BYTES,
          headers: {
            accept: "application/json",
            connection: "close",
            host: origin.hostHeader,
          },
        }, (response) => {
          const expectedLength = expectedResponseLength(response.statusCode, response.rawHeaders);
          if (expectedLength === null) {
            response.resume();
            response.destroy();
            unavailable();
            return;
          }
          const chunks: Buffer[] = [];
          let received = 0;
          response.on("data", (chunk: Buffer) => {
            if (settled || !Buffer.isBuffer(chunk)) {
              response.destroy();
              unavailable();
              return;
            }
            received += chunk.byteLength;
            if (received > expectedLength || received > CREDENTIAL_FREE_CASE_BINDING_OUTBOX_MAX_PAGE_BYTES) {
              response.destroy();
              unavailable();
              return;
            }
            chunks.push(chunk);
          });
          response.once("aborted", unavailable);
          response.once("error", unavailable);
          response.once("end", () => {
            if (!response.complete || received !== expectedLength || response.rawTrailers.length !== 0) {
              unavailable();
              return;
            }
            try {
              const page = parseAndVerifyCredentialFreeCaseBindingOutboxPage(Buffer.concat(chunks, received), {
                expectedAfterSequence: request.afterSequence,
                requestedLimit: request.limit,
              });
              complete(() => resolve(page.entries));
            } catch {
              unavailable();
            }
          });
        });
        client.once("error", unavailable);
        client.end();
      } catch {
        client?.destroy();
        unavailable();
      }
    });
  };

  return Object.freeze({ replay }) satisfies CredentialFreeCaseBindingOutboxReader;
}
