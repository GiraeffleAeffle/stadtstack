import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { classifyRemoteResolveFailure, parseArguments, publishCaseImageFromOci } from "../scripts/publish-case-image-from-oci.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const text = (path: string) => readFileSync(resolve(root, path), "utf8");

type Contract = Readonly<{
  schemaVersion: string;
  sourceRepository: string;
  sourceRef: string;
  workflowPath: string;
  publication: Readonly<Record<string, unknown>>;
  components: readonly Readonly<{ component: string; imageRepository: string }>[];
  effects: Readonly<Record<string, unknown>>;
}>;

test("the three Case images use distinct GHCR repositories and remain activation-blocked", () => {
  const contract = JSON.parse(text("containers/case-runtime/publisher-contract.json")) as Contract;
  assert.equal(contract.schemaVersion, "stadtstack_case_remote_publisher_v1");
  assert.equal(contract.sourceRepository, "GiraeffleAeffle/stadtstack");
  assert.equal(contract.sourceRef, "refs/heads/main");
  assert.equal(contract.workflowPath, ".github/workflows/case-staging-publish.yml");
  assert.equal(contract.publication.remoteOnly, true);
  assert.equal(contract.publication.duplicateSourcePublication, "reuse_only_when_exact_digest_matches_fail_closed_otherwise");
  assert.equal(contract.publication.provenancePredicateType, "https://slsa.dev/provenance/v1");
  assert.equal(contract.publication.sbomFormat, "SPDX-2.3");
  assert.equal(contract.publication.sbomPredicateType, "https://spdx.dev/Document/v2.3");
  assert.equal(contract.publication.publicPackageVisibilityRequired, true);
  assert.equal(contract.publication.anonymousDigestPullRequired, true);
  assert.equal(contract.publication.anonymousReceiptOutput, "stdout_for_later_independent_review");
  assert.equal(contract.publication.automaticOperationsHandoff, false);
  assert.deepEqual(contract.publication.registryRetry, {
    maxAttempts: 4,
    delayMilliseconds: [1_000, 2_000, 4_000],
    retryable: "transport_429_or_5xx_only",
    initialExplicitAbsenceRetry: false,
    postPublishAbsenceRetry: true,
    authenticationRetry: false,
    immutableMismatchRetry: false,
  });
  assert.deepEqual(contract.publication.anonymousDigestPullReceipt, {
    schemaVersion: "stadtstack_case_anonymous_digest_pull_receipt_v1",
    canonicalEncoding: "canonical-json",
    authContext: "clean-empty-auth-config",
    authConfigCanonicalJson: '{"auths":{}}',
    authConfigCanonicalSha256: "sha256:ec21c035eccb78eb5ca20ec95628eb351633621e09a130ac8d7e663714d40c7a",
    resolverIdentity: "oras-resolve-anonymous",
    imageReferenceFormat: "<imageRepository>@<manifestDigest>",
    bindings: ["component", "imageRepository", "manifestDigest", "sourceRevision"],
    resolvedManifestDigestMustEqualManifestDigest: true,
    receiptDigest: {
      algorithm: "sha256",
      encoding: "canonical-json",
      covers: ["schemaVersion", "canonicalEncoding", "component", "imageRepository", "manifestDigest", "sourceRevision", "authContext", "authConfigCanonicalSha256", "resolverIdentity", "resolvedManifestDigest"],
    },
  });
  assert.equal(contract.publication.activation, "blocked_pending_reviewed_recovery_evidence");
  assert.deepEqual(contract.components.map(({ component }) => component), [
    "case-steward-control",
    "case-public-binding",
    "case-restore-verifier",
  ]);
  const repositories = contract.components.map(({ imageRepository }) => imageRepository);
  assert.equal(new Set(repositories).size, 3);
  assert.ok(repositories.every((repository) => /^ghcr\.io\/giraeffleaeffle\/stadtstack-case-[a-z-]+$/u.test(repository)));
  assert.deepEqual(contract.effects, {
    localContainerBuild: false,
    clusterMutation: false,
    fluxReconciliation: false,
    secretRead: false,
    civicMutation: false,
    treasuryMutation: false,
  });
});

test("the build context is narrow, pinned, non-root, and cannot activate a Case runtime", () => {
  const dockerignore = text(".dockerignore");
  assert.match(dockerignore, /^\*\*$/m);
  for (const allowedPath of ["!.dockerignore", "!containers/case-runtime/Containerfile", "!containers/case-runtime/activation-blocked.mjs"]) {
    assert.ok(dockerignore.includes(allowedPath), `${allowedPath} must be explicitly included`);
  }
  const containerfile = text("containers/case-runtime/Containerfile");
  assert.match(containerfile, /FROM node:22\.18\.0-slim@sha256:[a-f0-9]{64}/u);
  assert.match(containerfile, /USER node/u);
  assert.match(containerfile, /ENTRYPOINT \["node", "\/activation\/activation-blocked\.mjs"\]/u);
  assert.doesNotMatch(containerfile, /(?:npm ci|node_modules|package(?:-lock)?\.json|COPY src|COPY --from)/u);
  const guard = text("containers/case-runtime/activation-blocked.mjs");
  assert.match(guard, /process\.exitCode = 78/u);
  assert.doesNotMatch(guard, /listen\(|process\.env|fetch\(/u);
});

test("the remote publisher is main-only, digest-attested, and has no deployment access", () => {
  const workflow = text(".github/workflows/case-staging-publish.yml");
  assert.match(workflow, /branches:\n\s+- main/u);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/u);
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/u);
  assert.match(workflow, /git diff --exit-code/u);
  assert.match(workflow, /git archive --format=tar "\$GITHUB_SHA"/u);
  assert.match(workflow, /case-build-context/u);
  assert.match(workflow, /outputs: type=oci,dest=/u);
  assert.match(workflow, /scripts\/publish-case-image-from-oci\.mjs/u);
  assert.match(workflow, /oras-project\/setup-oras@[a-f0-9]{40}/u);
  assert.match(workflow, /platforms: linux\/amd64/u);
  assert.match(workflow, /source-\$\{\{ github\.sha \}\}/u);
  assert.match(workflow, /actions\/attest-build-provenance@[a-f0-9]{40}/u);
  assert.match(workflow, /actions\/attest@[a-f0-9]{40}/u);
  assert.match(workflow, /anchore\/sbom-action@[a-f0-9]{40}/u);
  assert.match(workflow, /https:\/\/spdx\.dev\/Document\/v2\.3/u);
  assert.match(workflow, /gh attestation verify/u);
  assert.match(workflow, /--source-digest "\$GITHUB_SHA"/u);
  assert.match(workflow, /--source-ref refs\/heads\/main/u);
  assert.match(workflow, /anonymous immutable tag and digest pulls/u);
  assert.match(workflow, /\{"auths":\{\}\}/u);
  assert.match(workflow, /attestations: write/u);
  assert.match(workflow, /id-token: write/u);
  assert.match(workflow, /packages: write/u);
  assert.equal(workflow.match(/create-storage-record: false/gu)?.length, 2);
  assert.doesNotMatch(workflow, /kubectl|flux|talos|terraform|helm|KUBECONFIG|STAGING_.*SECRET/u);
});

const digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const otherDigest = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const input = Object.freeze({
  archive: "/tmp/case.oci.tar",
  localReference: "source-0123456789abcdef0123456789abcdef01234567",
  component: "case-steward-control" as const,
  image: "ghcr.io/giraeffleaeffle/stadtstack-case-steward-control",
  tag: "source-0123456789abcdef0123456789abcdef01234567",
});

function success(value = digest) {
  return Object.freeze({ status: 0, signal: null, stdout: `${value}\n`, stderr: "", error: undefined });
}

function failure(message: string) {
  return Object.freeze({ status: 1, signal: null, stdout: "", stderr: message, error: undefined });
}

test("the ORAS state machine pushes only an absent immutable source tag", () => {
  const calls: string[] = [];
  const result = publishCaseImageFromOci(input, (command, argumentsList) => {
    calls.push(`${command} ${argumentsList.join(" ")}`);
    if (argumentsList[0] === "resolve" && argumentsList.includes("--oci-layout")) return success();
    if (argumentsList[0] === "resolve" && calls.filter((value) => value.includes("resolve") && !value.includes("--oci-layout")).length === 1) return failure("404 MANIFEST_UNKNOWN");
    if (argumentsList[0] === "cp") return success("");
    return success();
  });
  assert.equal(result.status, "pushed");
  assert.equal(result.digest, digest);
  assert.equal(calls.filter((call) => call.startsWith("oras cp ")).length, 1);
});

test("the ORAS state machine safely reuses an exact tag after an interrupted attestation", () => {
  const calls: string[] = [];
  const result = publishCaseImageFromOci(input, (command, argumentsList) => {
    calls.push(`${command} ${argumentsList.join(" ")}`);
    return success();
  });
  assert.equal(result.status, "reused");
  assert.equal(calls.filter((call) => call.startsWith("oras cp ")).length, 0);
});

test("the ORAS state machine rejects a tag that points at another digest", () => {
  assert.throws(() => publishCaseImageFromOci(input, (_command, argumentsList) => {
    if (argumentsList.includes("--oci-layout")) return success(digest);
    return success(otherDigest);
  }), /immutable_source_tag_digest_mismatch/u);
});

test("the ORAS state machine retries a transient initial probe and reuses the exact digest", () => {
  let remoteAttempts = 0;
  const waits: number[] = [];
  const result = publishCaseImageFromOci(input, (_command, argumentsList) => {
    if (argumentsList.includes("--oci-layout")) return success();
    remoteAttempts += 1;
    return remoteAttempts === 1 ? failure("429 TOOMANYREQUESTS") : success();
  }, (delay) => waits.push(delay));
  assert.equal(result.status, "reused");
  assert.equal(remoteAttempts, 2);
  assert.deepEqual(waits, [1_000]);
});

test("the ORAS state machine exhausts bounded transient retries without publishing", () => {
  const calls: string[] = [];
  const waits: number[] = [];
  assert.throws(() => publishCaseImageFromOci(input, (command, argumentsList) => {
    calls.push(`${command} ${argumentsList.join(" ")}`);
    if (argumentsList.includes("--oci-layout")) return success();
    return failure("503 UNAVAILABLE");
  }, (delay) => waits.push(delay)), /remote_source_tag_resolve_error/u);
  assert.deepEqual(waits, [1_000, 2_000, 4_000]);
  assert.equal(calls.filter((call) => call.startsWith("oras cp ")).length, 0);
});

test("authentication failures are immediate and never publish", () => {
  const calls: string[] = [];
  assert.throws(() => publishCaseImageFromOci(input, (command, argumentsList) => {
    calls.push(`${command} ${argumentsList.join(" ")}`);
    if (argumentsList.includes("--oci-layout")) return success();
    return failure("403 FORBIDDEN timeout");
  }, () => assert.fail("authentication failure must not wait")), /remote_source_tag_resolve_error/u);
  assert.equal(calls.filter((call) => call.startsWith("oras cp ")).length, 0);
  assert.equal(calls.filter((call) => call.startsWith("oras resolve ") && !call.includes("--oci-layout")).length, 1);
});

test("post-publish resolution retries absence and transient eventual consistency", () => {
  let remoteResolves = 0;
  const waits: number[] = [];
  const result = publishCaseImageFromOci(input, (_command, argumentsList) => {
    if (argumentsList.includes("--oci-layout")) return success();
    if (argumentsList[0] === "cp") return success("");
    remoteResolves += 1;
    if (remoteResolves <= 2) return failure("404 MANIFEST_UNKNOWN");
    if (remoteResolves === 3) return failure("500 INTERNAL_SERVER_ERROR");
    return success();
  }, (delay) => waits.push(delay));
  assert.equal(result.status, "pushed");
  assert.deepEqual(waits, [1_000, 2_000]);
});

test("a transient ORAS copy is retried only while the immutable tag remains absent", () => {
  let resolves = 0;
  let copies = 0;
  const waits: number[] = [];
  const result = publishCaseImageFromOci(input, (_command, argumentsList) => {
    if (argumentsList.includes("--oci-layout")) return success();
    if (argumentsList[0] === "cp") {
      copies += 1;
      return copies === 1 ? failure("connection reset by peer") : success("");
    }
    resolves += 1;
    return resolves <= 2 ? failure("404 MANIFEST_UNKNOWN") : success();
  }, (delay) => waits.push(delay));
  assert.equal(result.status, "pushed");
  assert.equal(copies, 2);
  assert.deepEqual(waits, [1_000]);
});

test("transient ORAS copy retries exhaust without an unbounded loop", () => {
  let copies = 0;
  const waits: number[] = [];
  assert.throws(() => publishCaseImageFromOci(input, (_command, argumentsList) => {
    if (argumentsList.includes("--oci-layout")) return success();
    if (argumentsList[0] === "cp") {
      copies += 1;
      return failure("500 INTERNAL_SERVER_ERROR");
    }
    return failure("404 MANIFEST_UNKNOWN");
  }, (delay) => waits.push(delay)), /remote_source_tag_publish_retry_exhausted/u);
  assert.equal(copies, 4);
  assert.deepEqual(waits, [1_000, 2_000, 4_000]);
});

test("anonymous tag and digest resolution is required once an anonymous registry config is supplied", () => {
  const result = publishCaseImageFromOci({ ...input, anonymousRegistryConfig: "/tmp/anonymous.json" }, (_command, argumentsList) => {
    if (argumentsList.includes("--oci-layout")) return success();
    return success();
  }, () => assert.fail("exact anonymous resolution should not retry"), () => '{"auths":{}}');
  assert.equal(result.packageVisibility, "public");
  const receipt = result.anonymousDigestPullReceipt;
  assert.ok(receipt);
  assert.deepEqual({
    schemaVersion: receipt.schemaVersion,
    canonicalEncoding: receipt.canonicalEncoding,
    component: receipt.component,
    imageRepository: receipt.imageRepository,
    manifestDigest: receipt.manifestDigest,
    sourceRevision: receipt.sourceRevision,
    authContext: receipt.authContext,
    authConfigCanonicalSha256: receipt.authConfigCanonicalSha256,
    resolverIdentity: receipt.resolverIdentity,
    resolvedManifestDigest: receipt.resolvedManifestDigest,
  }, {
    schemaVersion: "stadtstack_case_anonymous_digest_pull_receipt_v1",
    canonicalEncoding: "canonical-json",
    component: input.component,
    imageRepository: input.image,
    manifestDigest: digest,
    sourceRevision: input.tag.slice("source-".length),
    authContext: "clean-empty-auth-config",
    authConfigCanonicalSha256: "sha256:ec21c035eccb78eb5ca20ec95628eb351633621e09a130ac8d7e663714d40c7a",
    resolverIdentity: "oras-resolve-anonymous",
    resolvedManifestDigest: digest,
  });
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value !== null && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  };
  const { receiptDigest, ...covered } = receipt;
  assert.equal(receiptDigest, `sha256:${createHash("sha256").update(canonical(covered), "utf8").digest("hex")}`);
  assert.throws(() => publishCaseImageFromOci({ ...input, anonymousRegistryConfig: "/tmp/anonymous.json" }, (_command, argumentsList) => {
    if (argumentsList.includes("--oci-layout")) return success();
    if (argumentsList.includes("--registry-config") && argumentsList.at(-1)?.includes("@sha256:")) return failure("401 UNAUTHORIZED");
    return success();
  }, () => assert.fail("authentication failure should not retry"), () => '{"auths":{}}'), /anonymous_digest_resolve_failed/u);
});

test("invalid anonymous registry configs fail before any ORAS call or receipt", () => {
  const fixtures = [
    ["missing", () => { throw new Error("ENOENT"); }, /anonymous_registry_config_unavailable/u],
    ["malformed", () => "{", /anonymous_registry_config_json_invalid/u],
    ["extra field", () => '{"auths":{},"currentContext":"desktop"}', /anonymous_registry_config_not_exact_empty_auth/u],
    ["credential", () => '{"auths":{"ghcr.io":{"auth":"Zm9vOmJhcg=="}}}', /anonymous_registry_config_not_exact_empty_auth/u],
    ["credential helper", () => '{"auths":{},"credsStore":"desktop"}', /anonymous_registry_config_not_exact_empty_auth/u],
    ["non-canonical whitespace", () => '{ "auths": {} }', /anonymous_registry_config_not_exact_empty_auth/u],
    ["trailing newline", () => '{"auths":{}}\n', /anonymous_registry_config_not_exact_empty_auth/u],
  ] as const;
  for (const [name, reader, expected] of fixtures) {
    let calls = 0;
    let returned: unknown;
    assert.throws(() => {
      returned = publishCaseImageFromOci(
        { ...input, anonymousRegistryConfig: "/tmp/anonymous.json" },
        () => { calls += 1; return success(); },
        () => assert.fail("invalid config should not wait"),
        reader,
      );
    }, expected, name);
    assert.equal(calls, 0, `${name} must fail before resolve or publish`);
    assert.equal(returned, undefined, `${name} must not emit a receipt`);
  }
});

test("authentication markers override misleading absence markers and never publish", () => {
  const calls: string[] = [];
  assert.equal(classifyRemoteResolveFailure(failure("404 MANIFEST_UNKNOWN; 401 UNAUTHORIZED")), "error");
  assert.throws(() => publishCaseImageFromOci(input, (command, argumentsList) => {
    calls.push(`${command} ${argumentsList.join(" ")}`);
    if (argumentsList.includes("--oci-layout")) return success();
    return failure("404 MANIFEST_UNKNOWN; 403 FORBIDDEN");
  }, () => assert.fail("mixed authentication failure should not wait")), /remote_source_tag_resolve_error/u);
  assert.equal(calls.filter((call) => call.startsWith("oras cp ")).length, 0);
});

test("argument validation and remote failure classification are fail closed", () => {
  assert.equal(classifyRemoteResolveFailure(failure("404 NAME_UNKNOWN")), "absent");
  assert.equal(classifyRemoteResolveFailure(failure("429 TOOMANYREQUESTS")), "retryable");
  assert.equal(classifyRemoteResolveFailure(failure("401 UNAUTHORIZED")), "error");
  assert.throws(() => parseArguments(["--archive", "/tmp/a", "--local-reference", "local/x:tag", "--component", "case-steward-control", "--image", "ghcr.io/x/y", "--tag", "latest"]), /publisher_tag_invalid/u);
  assert.throws(() => parseArguments(["--archive", "/tmp/a", "--local-reference", input.tag, "--component", input.component, "--image", input.image, "--tag", input.tag, "--anonymous-registry-config", ""]), /publisher_argument_invalid:anonymous-registry-config/u);
});
