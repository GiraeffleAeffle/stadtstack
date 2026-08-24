import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { classifyRemoteResolveFailure, parseArguments, publishReviewedKnowledgeImageFromOci } from "../scripts/publish-reviewed-knowledge-image-from-oci.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const text = (path: string) => readFileSync(resolve(root, path), "utf8");
const digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const input = Object.freeze({ archive: "/tmp/reviewed.oci.tar", localReference: "source-0123456789abcdef0123456789abcdef01234567", image: "ghcr.io/giraeffleaeffle/stadtstack-reviewed-public-knowledge-runtime", tag: "source-0123456789abcdef0123456789abcdef01234567" });
const ok = (value = digest) => Object.freeze({ status: 0, signal: null, stdout: `${value}\n`, stderr: "", error: undefined });
const fail = (message: string) => Object.freeze({ status: 1, signal: null, stdout: "", stderr: message, error: undefined });

test("the reviewed-knowledge image is closed-context, source-only and non-deploying", () => {
  const contract = JSON.parse(text("containers/reviewed-knowledge-runtime/publisher-contract.json"));
  assert.equal(contract.component, "reviewed-public-knowledge-runtime");
  assert.equal(contract.imageRepository, input.image);
  assert.equal(contract.publication.remoteOnly, true);
  assert.equal(contract.publication.publicPackageVisibilityRequired, true);
  assert.equal(contract.publication.anonymousTagAndDigestBytePullRequired, true);
  assert.equal(contract.publication.activation, "not_deployed");
  assert.deepEqual(contract.effects, { localContainerBuild: false, clusterMutation: false, fluxReconciliation: false, secretRead: false, civicCaseAuthority: false, civicMutation: false, administrationWrite: false, vote: false, treasury: false });
  const containerfile = text("containers/reviewed-knowledge-runtime/Containerfile");
  assert.match(containerfile, /FROM node:22\.18\.0-slim@sha256:[a-f0-9]{64}/u);
  assert.match(containerfile, /USER node/u);
  assert.match(containerfile, /--experimental-strip-types/u);
  assert.doesNotMatch(containerfile, /npm ci|node_modules|package(?:-lock)?\.json|COPY src\/civic-case/u);
  const dockerignore = text(".dockerignore");
  for (const allowed of [
    "!src/", "!src/reviewed-public-knowledge.ts", "!src/reviewed-public-knowledge-server.ts",
    "!src/staging-reviewed-public-knowledge-runtime.ts", "!src/reviewed-knowledge-runtime-entrypoint.mjs",
  ]) assert.ok(dockerignore.includes(allowed), `${allowed} must remain in the closed context allowlist`);
  const workflow = text(".github/workflows/reviewed-knowledge-runtime-publish.yml");
  const pushPathBlock = workflow.match(/paths:\n(?<paths>(?:\s+- [^\n]+\n)+)\s+workflow_dispatch:/u)?.groups?.paths ?? "";
  assert.match(pushPathBlock, /src\/reviewed-knowledge-runtime-entrypoint\.mjs/u);
  assert.match(workflow, /git archive --format=tar "\$GITHUB_SHA"/u);
  assert.match(workflow, /src\/staging-reviewed-public-knowledge-runtime\.ts/u);
  assert.match(
    workflow,
    /LC_ALL=C sort\)" = "\$\(printf '%s\\n' [^\n]*src\/reviewed-public-knowledge-server\.ts src\/reviewed-public-knowledge\.ts/u,
  );
  assert.match(workflow, /actions\/attest-build-provenance@[a-f0-9]{40}/u);
  assert.match(workflow, /anchore\/sbom-action@[a-f0-9]{40}/u);
  assert.match(workflow, /anonymous immutable tag and digest pulls/u);
  assert.match(text("scripts/publish-reviewed-knowledge-image-from-oci.mjs"), /oras", \["pull", "--registry-config"/u);
  assert.doesNotMatch(workflow, /kubectl|flux|talos|terraform|helm|KUBECONFIG|SECRET/u);
});

test("the immutable publisher only creates an absent exact tag and verifies anonymous tag plus digest", () => {
  const calls: string[] = [];
  const result = publishReviewedKnowledgeImageFromOci(input, (_command, argumentsList) => {
    calls.push(argumentsList.join(" "));
    if (argumentsList.includes("--oci-layout")) return ok();
    if (argumentsList[0] === "resolve" && calls.filter((call) => call.startsWith("resolve") && !call.includes("--oci-layout")).length === 1) return fail(`Error response from registry: failed to resolve digest: ${input.image}:${input.tag}: not found`);
    return argumentsList[0] === "cp" ? ok("") : ok();
  });
  assert.equal(result.status, "pushed");
  assert.equal(result.digest, digest);
  assert.equal(calls.filter((call) => call.startsWith("cp ")).length, 1);
  const anonymousCalls: string[] = [];
  const verified = publishReviewedKnowledgeImageFromOci({ ...input, anonymousRegistryConfig: "/tmp/empty-auth.json", anonymousPullDir: "/tmp/empty-pull" }, (_command, argumentsList) => {
    anonymousCalls.push(argumentsList.join(" "));
    return argumentsList.includes("--oci-layout") ? ok() : ok();
  }, () => assert.fail("no retry expected"), () => '{"auths":{}}', () => []);
  assert.equal(verified.status, "reused");
  assert.equal(verified.packageVisibility, "public");
  assert.equal(verified.anonymousDigestPullReceipt?.resolvedManifestDigest, digest);
  assert.ok(anonymousCalls.some((call) => call === `pull --registry-config /tmp/empty-auth.json --output /tmp/empty-pull ${input.image}@${digest}`));
});

test("wrong registries, credentials, malformed input, and local absence fail closed", () => {
  assert.equal(classifyRemoteResolveFailure(fail(`Error response from registry: failed to resolve digest: ${input.image}:${input.tag}: not found`)), "absent");
  assert.equal(classifyRemoteResolveFailure(fail("failed to open local archive: not found")), "error");
  assert.equal(classifyRemoteResolveFailure(fail("401 UNAUTHORIZED")), "error");
  assert.equal(classifyRemoteResolveFailure(fail("429 TOOMANYREQUESTS")), "retryable");
  assert.throws(() => parseArguments(["--archive", "/tmp/a", "--local-reference", input.tag, "--image", "ghcr.io/giraeffleaeffle/another", "--tag", input.tag]), /reference_invalid/u);
  assert.throws(() => parseArguments(["--archive", "/tmp/a", "--local-reference", input.tag, "--image", input.image, "--tag", input.tag, "--anonymous-registry-config", "/tmp/a"]), /pair_required/u);
  assert.throws(() => publishReviewedKnowledgeImageFromOci({ ...input, anonymousRegistryConfig: "/tmp/not-empty", anonymousPullDir: "/tmp/pull" }, () => ok(), () => undefined, () => '{"auths":{"ghcr.io":{}}}', () => []), /not_exact_empty_auth/u);
  assert.throws(() => publishReviewedKnowledgeImageFromOci({ ...input, anonymousRegistryConfig: "/tmp/empty", anonymousPullDir: "/tmp/nonempty" }, () => ok(), () => undefined, () => '{"auths":{}}', () => ["unexpected"]), /pull_dir_not_empty/u);
});
