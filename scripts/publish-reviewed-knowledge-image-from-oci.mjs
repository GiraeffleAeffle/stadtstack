#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const tagPattern = /^source-[a-f0-9]{40}$/u;
const component = "reviewed-public-knowledge-runtime";
const imagePattern = /^ghcr\.io\/giraeffleaeffle\/stadtstack-reviewed-public-knowledge-runtime$/u;
const delays = Object.freeze([1_000, 2_000, 4_000]);
const emptyAuth = '{"auths":{}}';
const emptyAuthChecksum = "sha256:ec21c035eccb78eb5ca20ec95628eb351633621e09a130ac8d7e663714d40c7a";

function combined(result) { return `${result.stdout}\n${result.stderr}`.trim(); }
function run(command, argumentsList) {
  const result = spawnSync(command, argumentsList, { encoding: "utf8", shell: false });
  return Object.freeze({ status: result.status, signal: result.signal, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error });
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function digest(result, operation) {
  if (result.status !== 0 || result.error) throw new Error(`${operation}_failed:${combined(result) || result.error?.message || "unknown"}`);
  const found = (combined(result).match(/sha256:[a-f0-9]{64}/gu) ?? []).at(-1);
  if (!found || !digestPattern.test(found)) throw new Error(`${operation}_digest_invalid`);
  return found;
}
export function classifyRemoteResolveFailure(result) {
  if (result.status === 0 && !result.error) return "success";
  const message = combined(result);
  if (/(?:\b401\b|\b403\b|UNAUTHORIZED|DENIED|FORBIDDEN|authentication required|invalid (?:token|credential))/iu.test(message)) return "error";
  if (/(?:\b404\b|MANIFEST_UNKNOWN|NAME_UNKNOWN)/iu.test(message) ||
    /(?:^|\n)Error response from registry: failed to resolve digest: ghcr\.io\/giraeffleaeffle\/stadtstack-reviewed-public-knowledge-runtime:source-[a-f0-9]{40}: not found(?:\n|$)/iu.test(message)) return "absent";
  if (/(?:\b429\b|\b5\d\d\b|TOOMANYREQUESTS|UNAVAILABLE|connection (?:reset|refused)|timed?\s*out|timeout|temporary|TLS handshake|no such host|network is unreachable|unexpected EOF|\bEOF\b)/iu.test(message)) return "retryable";
  return "error";
}
function wait(milliseconds) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds); }
function resolveRemote(runCommand, ref, registryConfig) {
  return runCommand("oras", registryConfig ? ["resolve", "--registry-config", registryConfig, ref] : ["resolve", ref]);
}
function resolveWithRetries(runCommand, waitFor, ref, registryConfig, retryAbsence, operation) {
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    const result = resolveRemote(runCommand, ref, registryConfig);
    const state = classifyRemoteResolveFailure(result);
    if (state === "success" || state === "error" || (state === "absent" && !retryAbsence)) return result;
    if (attempt === delays.length) return result;
    waitFor(delays[attempt]);
  }
  throw new Error(`${operation}_retry_state_invalid`);
}
function validateEmptyAuth(path, read) {
  let raw;
  try { raw = read(path); } catch (error) { throw new Error(`anonymous_registry_config_unavailable:${error instanceof Error ? error.message : String(error)}`); }
  if (raw !== emptyAuth || `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}` !== emptyAuthChecksum) throw new Error("anonymous_registry_config_not_exact_empty_auth");
}
export function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]; const value = argv[index + 1];
    if (!/^--(?:archive|local-reference|image|tag|anonymous-registry-config|anonymous-pull-dir)$/u.test(flag ?? "")) throw new Error(`publisher_argument_unknown:${String(flag)}`);
    if (value === undefined || String(value).startsWith("--")) throw new Error(`publisher_argument_missing:${String(flag)}`);
    const key = String(flag).slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
    if (Object.hasOwn(values, key)) throw new Error(`publisher_argument_duplicate:${String(flag)}`);
    values[key] = value;
  }
  for (const key of ["archive", "localReference", "image", "tag"]) if (typeof values[key] !== "string" || values[key] === "") throw new Error(`publisher_argument_invalid:${key}`);
  if (!tagPattern.test(values.tag) || values.localReference !== values.tag) throw new Error("publisher_tag_invalid");
  if (!imagePattern.test(values.image) || /\s|@/u.test(values.archive)) throw new Error("publisher_reference_invalid");
  if ((values.anonymousRegistryConfig === undefined) !== (values.anonymousPullDir === undefined)) throw new Error("publisher_anonymous_pull_pair_required");
  if (values.anonymousRegistryConfig !== undefined && (typeof values.anonymousRegistryConfig !== "string" || values.anonymousRegistryConfig === "" || typeof values.anonymousPullDir !== "string" || values.anonymousPullDir === "")) throw new Error("publisher_argument_invalid:anonymous-pull");
  return Object.freeze(values);
}
export function publishReviewedKnowledgeImageFromOci(input, runCommand = run, waitFor = wait, read = (path) => readFileSync(path, "utf8"), readDirectory = readdirSync) {
  const { archive, localReference, image, tag, anonymousRegistryConfig, anonymousPullDir } = input;
  if (anonymousRegistryConfig !== undefined) validateEmptyAuth(anonymousRegistryConfig, read);
  const localDigest = digest(runCommand("oras", ["resolve", "--oci-layout", `${archive}:${localReference}`]), "local_oci_archive_resolve");
  const remoteTag = `${image}:${tag}`;
  const initial = resolveWithRetries(runCommand, waitFor, remoteTag, undefined, false, "remote_source_tag_resolve");
  const initialState = classifyRemoteResolveFailure(initial);
  let status;
  if (initialState === "success") {
    if (digest(initial, "remote_source_tag_resolve") !== localDigest) throw new Error("immutable_source_tag_digest_mismatch");
    status = "reused";
  } else if (initialState === "absent") {
    const copied = runCommand("oras", ["cp", "--from-oci-layout", `${archive}:${localReference}`, remoteTag]);
    if (copied.status !== 0 || copied.error) throw new Error(`remote_source_tag_publish_failed:${combined(copied) || copied.error?.message || "unknown"}`);
    const after = resolveWithRetries(runCommand, waitFor, remoteTag, undefined, true, "remote_source_tag_post_publish_resolve");
    if (digest(after, "remote_source_tag_post_publish_resolve") !== localDigest) throw new Error("immutable_source_tag_post_publish_digest_mismatch");
    status = "pushed";
  } else throw new Error(`remote_source_tag_resolve_error:${combined(initial) || initial.error?.message || "unknown"}`);
  let anonymousReceipt = null;
  if (anonymousRegistryConfig !== undefined) {
    let entries;
    try { entries = readDirectory(anonymousPullDir); } catch (error) { throw new Error(`anonymous_pull_dir_unavailable:${error instanceof Error ? error.message : String(error)}`); }
    if (!Array.isArray(entries) || entries.length !== 0) throw new Error("anonymous_pull_dir_not_empty");
    const anonymousTag = digest(resolveWithRetries(runCommand, waitFor, remoteTag, anonymousRegistryConfig, true, "anonymous_source_tag_resolve"), "anonymous_source_tag_resolve");
    const anonymousDigest = digest(resolveWithRetries(runCommand, waitFor, `${image}@${localDigest}`, anonymousRegistryConfig, true, "anonymous_digest_resolve"), "anonymous_digest_resolve");
    if (anonymousTag !== localDigest || anonymousDigest !== localDigest) throw new Error("anonymous_digest_pull_verification_mismatch");
    const pulled = runCommand("oras", ["pull", "--registry-config", anonymousRegistryConfig, "--output", anonymousPullDir, `${image}@${localDigest}`]);
    if (pulled.status !== 0 || pulled.error) throw new Error(`anonymous_digest_pull_failed:${combined(pulled) || pulled.error?.message || "unknown"}`);
    const payload = Object.freeze({ schemaVersion: "stadtstack_reviewed_knowledge_anonymous_digest_pull_receipt_v1", canonicalEncoding: "canonical-json", component, imageRepository: image, manifestDigest: localDigest, sourceRevision: tag.slice(7), authContext: "clean-empty-auth-config", authConfigCanonicalSha256: emptyAuthChecksum, resolverIdentity: "oras-resolve-anonymous", resolvedManifestDigest: anonymousDigest });
    anonymousReceipt = Object.freeze({ ...payload, receiptDigest: `sha256:${createHash("sha256").update(canonical(payload), "utf8").digest("hex")}` });
  }
  return Object.freeze({ status, digest: localDigest, component, image, sourceTag: tag, packageVisibility: anonymousReceipt ? "public" : null, anonymousDigestPullReceipt: anonymousReceipt });
}
if (import.meta.url === `file://${process.argv[1]}`) {
  try { process.stdout.write(`${JSON.stringify(publishReviewedKnowledgeImageFromOci(parseArguments(process.argv.slice(2))))}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
