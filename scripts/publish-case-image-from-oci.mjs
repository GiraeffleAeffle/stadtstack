#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const sourceTagPattern = /^source-[a-f0-9]{40}$/u;
const componentPattern = /^case-(?:steward-control|public-binding|restore-verifier)$/u;
const retryDelaysMilliseconds = Object.freeze([1_000, 2_000, 4_000]);
const anonymousAuthConfigCanonicalJson = '{"auths":{}}';
const anonymousAuthConfigCanonicalSha256 = "sha256:ec21c035eccb78eb5ca20ec95628eb351633621e09a130ac8d7e663714d40c7a";

function usage() {
  return "usage: publish-case-image-from-oci.mjs --archive <oci.tar> --local-reference <source-40-hex> --component <case-component> --image <registry/repository> --tag <source-40-hex> [--anonymous-registry-config <config.json>]";
}

function required(value, name) {
  if (typeof value !== "string" || value === "") throw new Error(`publisher_argument_invalid:${name}`);
  return value;
}

export function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!/^--(?:archive|local-reference|component|image|tag|anonymous-registry-config)$/u.test(flag ?? "")) {
      throw new Error(`publisher_argument_unknown:${String(flag)}`);
    }
    if (value === undefined || String(value).startsWith("--")) throw new Error(`publisher_argument_missing:${String(flag)}`);
    const key = String(flag).slice(2).replace(/-([a-z])/gu, (_, character) => character.toUpperCase());
    if (Object.hasOwn(values, key)) throw new Error(`publisher_argument_duplicate:${String(flag)}`);
    values[key] = value;
  }
  const archive = required(values.archive, "archive");
  const localReference = required(values.localReference, "local-reference");
  const component = required(values.component, "component");
  const image = required(values.image, "image");
  const tag = required(values.tag, "tag");
  const anonymousRegistryConfig = values.anonymousRegistryConfig === undefined ? undefined : required(values.anonymousRegistryConfig, "anonymous-registry-config");
  if (!sourceTagPattern.test(tag) || !sourceTagPattern.test(localReference)) throw new Error("publisher_tag_invalid");
  if (localReference !== tag) throw new Error("publisher_local_tag_mismatch");
  if (!componentPattern.test(component)) throw new Error("publisher_component_invalid");
  if (/\s|@/u.test(archive) || /\s|@/u.test(image) || !image.includes("/")) {
    throw new Error("publisher_reference_invalid");
  }
  return Object.freeze({ archive, localReference, component, image, tag, anonymousRegistryConfig });
}

function defaultRun(command, argumentsList) {
  const result = spawnSync(command, argumentsList, { encoding: "utf8", shell: false });
  return Object.freeze({
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  });
}

function combined(result) {
  return `${result.stdout}\n${result.stderr}`.trim();
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Canonical(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function defaultReadRegistryConfig(path) {
  return readFileSync(path, "utf8");
}

function validateAnonymousRegistryConfig(path, readRegistryConfig) {
  let raw;
  try {
    raw = readRegistryConfig(path);
  } catch (error) {
    throw new Error(`anonymous_registry_config_unavailable:${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof raw !== "string") throw new Error("anonymous_registry_config_content_invalid");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("anonymous_registry_config_json_invalid");
  }
  if (canonicalJson(parsed) !== anonymousAuthConfigCanonicalJson || raw !== anonymousAuthConfigCanonicalJson) {
    throw new Error("anonymous_registry_config_not_exact_empty_auth");
  }
  const checksum = `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}`;
  if (checksum !== anonymousAuthConfigCanonicalSha256) throw new Error("anonymous_registry_config_checksum_invalid");
}

function defaultWait(delayMilliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMilliseconds);
}

function requireSuccess(result, operation) {
  if (result.status === 0 && !result.error) return;
  throw new Error(`${operation}_failed:${combined(result) || result.error?.message || "unknown"}`);
}

function exactDigest(result, operation) {
  requireSuccess(result, operation);
  const matches = combined(result).match(/sha256:[a-f0-9]{64}/gu) ?? [];
  const digest = matches.at(-1);
  if (!digest || !digestPattern.test(digest)) throw new Error(`${operation}_digest_invalid`);
  return digest;
}

export function classifyRemoteResolveFailure(result) {
  if (result.status === 0 && !result.error) return "success";
  const diagnostic = combined(result);
  if (/(?:\b401\b|\b403\b|UNAUTHORIZED|DENIED|FORBIDDEN|authentication required|invalid (?:token|credential))/iu.test(diagnostic)) return "error";
  if (
    /(?:\b404\b|MANIFEST_UNKNOWN|NAME_UNKNOWN)/iu.test(diagnostic) ||
    /(?:^|\n)Error response from registry: failed to resolve digest: ghcr\.io\/giraeffleaeffle\/stadtstack-case-(?:steward-control|public-binding|restore-verifier):source-[a-f0-9]{40}: not found(?:\n|$)/iu.test(diagnostic)
  ) return "absent";
  if (/(?:\b429\b|\b5\d\d\b|TOOMANYREQUESTS|UNAVAILABLE|connection (?:reset|refused)|timed?\s*out|timeout|temporary|TLS handshake|no such host|network is unreachable|unexpected EOF|\bEOF\b)/iu.test(diagnostic)) return "retryable";
  return "error";
}

function resolveRemote(run, imageReference, registryConfig) {
  const argumentsList = ["resolve"];
  if (registryConfig) argumentsList.push("--registry-config", registryConfig);
  argumentsList.push(imageReference);
  return run("oras", argumentsList);
}

function resolveRemoteWithRetries(run, wait, imageReference, registryConfig, retryAbsence, operation) {
  for (let attempt = 0; attempt <= retryDelaysMilliseconds.length; attempt += 1) {
    const result = resolveRemote(run, imageReference, registryConfig);
    const state = classifyRemoteResolveFailure(result);
    if (state === "success" || (state === "absent" && !retryAbsence) || state === "error") return result;
    if (attempt === retryDelaysMilliseconds.length) return result;
    wait(retryDelaysMilliseconds[attempt], Object.freeze({ operation, attempt: attempt + 1, state }));
  }
  throw new Error(`${operation}_retry_state_invalid`);
}

function publishArchiveWithRetries(run, wait, archiveReference, remoteTag, localDigest) {
  for (let attempt = 0; attempt <= retryDelaysMilliseconds.length; attempt += 1) {
    const result = run("oras", ["cp", "--from-oci-layout", archiveReference, remoteTag]);
    if (result.status === 0 && !result.error) return;
    if (classifyRemoteResolveFailure(result) !== "retryable") requireSuccess(result, "remote_source_tag_publish");
    const probe = resolveRemote(run, remoteTag);
    const probeState = classifyRemoteResolveFailure(probe);
    if (probeState === "success") {
      const remoteDigest = exactDigest(probe, "remote_source_tag_publish_recovery_resolve");
      if (remoteDigest !== localDigest) throw new Error("immutable_source_tag_publish_recovery_digest_mismatch");
      return;
    }
    if (probeState === "error") throw new Error(`remote_source_tag_publish_recovery_error:${combined(probe) || probe.error?.message || "unknown"}`);
    if (attempt === retryDelaysMilliseconds.length) requireSuccess(result, "remote_source_tag_publish_retry_exhausted");
    wait(retryDelaysMilliseconds[attempt], Object.freeze({ operation: "remote_source_tag_publish", attempt: attempt + 1, state: probeState }));
  }
}

function createAnonymousDigestPullReceipt({ component, image, digest, sourceRevision, resolvedManifestDigest }) {
  const payload = Object.freeze({
    schemaVersion: "stadtstack_case_anonymous_digest_pull_receipt_v1",
    canonicalEncoding: "canonical-json",
    component,
    imageRepository: image,
    manifestDigest: digest,
    sourceRevision,
    authContext: "clean-empty-auth-config",
    authConfigCanonicalSha256: anonymousAuthConfigCanonicalSha256,
    resolverIdentity: "oras-resolve-anonymous",
    resolvedManifestDigest,
  });
  return Object.freeze({ ...payload, receiptDigest: sha256Canonical(payload) });
}

export function publishCaseImageFromOci(input, run = defaultRun, wait = defaultWait, readRegistryConfig = defaultReadRegistryConfig) {
  const { archive, localReference, component, image, tag, anonymousRegistryConfig } = input;
  const anonymousConfigRequested = anonymousRegistryConfig !== undefined;
  if (anonymousConfigRequested) validateAnonymousRegistryConfig(required(anonymousRegistryConfig, "anonymous-registry-config"), readRegistryConfig);
  const archiveReference = `${archive}:${localReference}`;
  const localDigest = exactDigest(run("oras", ["resolve", "--oci-layout", archiveReference]), "local_oci_archive_resolve");
  const remoteTag = `${image}:${tag}`;
  const current = resolveRemoteWithRetries(run, wait, remoteTag, undefined, false, "remote_source_tag_resolve");
  const state = classifyRemoteResolveFailure(current);
  let publication;
  if (state === "success") {
    const remoteDigest = exactDigest(current, "remote_source_tag_resolve");
    if (remoteDigest !== localDigest) throw new Error("immutable_source_tag_digest_mismatch");
    publication = "reused";
  } else if (state === "absent") {
    publishArchiveWithRetries(run, wait, archiveReference, remoteTag, localDigest);
    const remoteDigest = exactDigest(resolveRemoteWithRetries(run, wait, remoteTag, undefined, true, "remote_source_tag_post_publish_resolve"), "remote_source_tag_post_publish_resolve");
    if (remoteDigest !== localDigest) throw new Error("immutable_source_tag_post_publish_digest_mismatch");
    publication = "pushed";
  } else {
    throw new Error(`remote_source_tag_resolve_error:${combined(current) || current.error?.message || "unknown"}`);
  }
  let anonymousDigestPullReceipt = null;
  if (anonymousConfigRequested) {
    const anonymousTag = exactDigest(resolveRemoteWithRetries(run, wait, remoteTag, anonymousRegistryConfig, true, "anonymous_source_tag_resolve"), "anonymous_source_tag_resolve");
    const anonymousDigest = exactDigest(resolveRemoteWithRetries(run, wait, `${image}@${localDigest}`, anonymousRegistryConfig, true, "anonymous_digest_resolve"), "anonymous_digest_resolve");
    if (anonymousTag !== localDigest || anonymousDigest !== localDigest) throw new Error("anonymous_digest_pull_verification_mismatch");
    anonymousDigestPullReceipt = createAnonymousDigestPullReceipt({ component, image, digest: localDigest, sourceRevision: tag.slice("source-".length), resolvedManifestDigest: anonymousDigest });
  }
  return Object.freeze({
    status: publication,
    digest: localDigest,
    component,
    image,
    sourceTag: tag,
    packageVisibility: anonymousDigestPullReceipt ? "public" : null,
    anonymousDigestPullReceipt,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = publishCaseImageFromOci(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${usage()}\n`);
    process.exitCode = 1;
  }
}
