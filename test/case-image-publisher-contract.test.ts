import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";

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
  componentSourceClosures: Readonly<Record<string, string | null>>;
  componentBuildContexts: Readonly<Record<string, readonly string[]>>;
  componentRuntimeEntrypoints: Readonly<Record<string, Readonly<{
    entrypoint: string;
    dynamicTypeScriptTarget: string | null;
    readyComponent: string | null;
    configurationEnvironment: string | null;
  }>>>;
  effects: Readonly<Record<string, unknown>>;
}>;

test("the three Case images use distinct GHCR repositories and remain pre-activation", () => {
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
  assert.equal(contract.publication.activation, "loopback_runtime_pending_operations_activation");
  assert.deepEqual(contract.publication.componentActivation, {
    "case-steward-control": "loopback_runtime_pending_operations_activation",
    "case-public-binding": "loopback_runtime_pending_operations_activation",
    "case-restore-verifier": "blocked_pending_reviewed_recovery_evidence",
  });
  assert.deepEqual(contract.components.map(({ component }) => component), [
    "case-steward-control",
    "case-public-binding",
    "case-restore-verifier",
  ]);
  assert.deepEqual(contract.componentSourceClosures, {
    "case-steward-control": "containers/case-runtime/case-steward-control-source-closure.txt",
    "case-public-binding": "containers/case-runtime/case-public-binding-source-closure.txt",
    "case-restore-verifier": null,
  });
  assert.deepEqual(contract.componentRuntimeEntrypoints, {
    "case-steward-control": {
      entrypoint: "containers/case-runtime/case-steward-control-entrypoint.mjs",
      dynamicTypeScriptTarget: "src/staging-case-control-runtime.ts",
      readyComponent: "steward_control",
      configurationEnvironment: "STADTSTACK_CASE_CONTROL_CONFIG_PATH",
    },
    "case-public-binding": {
      entrypoint: "containers/case-runtime/case-public-binding-entrypoint.mjs",
      dynamicTypeScriptTarget: "src/staging-public-case-binding-runtime.ts",
      readyComponent: "public_binding",
      configurationEnvironment: "STADTSTACK_CASE_PUBLIC_CONFIG_PATH",
    },
    "case-restore-verifier": {
      entrypoint: "containers/case-runtime/activation-blocked.mjs",
      dynamicTypeScriptTarget: null,
      readyComponent: null,
      configurationEnvironment: null,
    },
  });
  assert.deepEqual(contract.componentBuildContexts, {
    "case-steward-control": [
      ".dockerignore", "containers/case-runtime/Containerfile", "containers/case-runtime/activation-blocked.mjs",
      "package.json", "package-lock.json", "containers/case-runtime/runtime-entrypoint-common.mjs",
      "containers/case-runtime/case-steward-control-entrypoint.mjs",
    ],
    "case-public-binding": [
      ".dockerignore", "containers/case-runtime/Containerfile", "containers/case-runtime/activation-blocked.mjs",
      "package.json", "package-lock.json", "containers/case-runtime/runtime-entrypoint-common.mjs",
      "containers/case-runtime/case-public-binding-entrypoint.mjs",
    ],
    "case-restore-verifier": [
      ".dockerignore", "containers/case-runtime/Containerfile", "containers/case-runtime/activation-blocked.mjs",
    ],
  });
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

function sourceClosure(path: string): string[] {
  const closure = text(path).trim().split("\n");
  assert.deepEqual(closure, [...closure].sort());
  assert.equal(new Set(closure).size, closure.length);
  return closure;
}

function transitiveSourceClosure(entrypoint: string, sourceOverrides: Readonly<Record<string, string>> = {}): string[] {
  const visited = new Set<string>();
  const visit = (path: string): void => {
    if (visited.has(path)) return;
    visited.add(path);
    for (const match of (sourceOverrides[path] ?? text(path)).matchAll(/from\s+["'](\.[^"']+)["']/gu)) visit(normalize(join(dirname(path), match[1]!)));
  };
  visit(entrypoint);
  return [...visited].sort();
}

function dynamicTypeScriptImportTargets(
  entrypoint: string,
  sourceOverrides: Readonly<Record<string, string>> = {},
): string[] {
  const source = sourceOverrides[entrypoint] ?? text(entrypoint);
  return [...source.matchAll(/\bimport\(\s*([^\n)]+?)\s*\)/gu)]
    .map((match) => {
      const literal = /^["'](\.[^"']+\.ts)["']$/u.exec(match[1]!.trim());
      assert.ok(literal, `${entrypoint} must use only literal relative TypeScript dynamic imports`);
      return normalize(join(dirname(entrypoint), literal[1]!));
    })
    .sort();
}

function launcherSourceClosure(
  entrypoint: string,
  exactTarget: string | null,
  sourceOverrides: Readonly<Record<string, string>> = {},
): string[] {
  const targets = dynamicTypeScriptImportTargets(entrypoint, sourceOverrides);
  assert.deepEqual(
    targets,
    exactTarget === null ? [] : [exactTarget],
    `${entrypoint} must dynamically import only its exact TypeScript runtime target`,
  );
  return exactTarget === null ? [] : transitiveSourceClosure(exactTarget, sourceOverrides);
}

function targetStageSources(containerfile: string, target: string): string[] {
  const stage = new RegExp(`FROM dependencies AS ${target}([\\s\\S]*?)(?=\\nFROM |$)`, "u").exec(containerfile)?.[1];
  assert.ok(stage, `missing ${target} stage`);
  const paths: string[] = [];
  for (const match of stage.matchAll(/^COPY (src\/[a-z0-9/-]+\.ts) (\.\/src\/[a-z0-9/-]+\.ts)$/gmu)) {
    assert.equal(match[2], `./${match[1]}`, `${target} must retain the exact source path`);
    paths.push(match[1]!);
  }
  return paths.sort();
}

function targetStageRuntimeArtifacts(containerfile: string, target: string): string[] {
  const stage = new RegExp(`FROM [^\\n]+ AS ${target}([\\s\\S]*?)(?=\\nFROM |$)`, "u").exec(containerfile)?.[1];
  assert.ok(stage, `missing ${target} stage`);
  const paths: string[] = [];
  for (const match of stage.matchAll(/^COPY (containers\/case-runtime\/[a-z0-9/-]+\.(?:[cm]?js|ts)) \S+$/gmu)) {
    paths.push(match[1]!);
  }
  return paths.sort();
}

const SHARED_CASE_RUNTIME_SOURCES = [
  "src/case-binding-outbox-wire.ts",
  "src/case-binding-outbox.ts",
  "src/case-binding-projection.ts",
  "src/case-id.ts",
  "src/staging-case-runtime-lifecycle.ts",
  "src/staging-case-runtime-listener-capability.ts",
  "src/staging-runtime-probe-server.ts",
] as const;
const CONTROL_ONLY_CASE_RUNTIME_SOURCES = [
  "src/adapters/discussion-adapter.ts",
  "src/adapters/sqlite-atomic-topic-case-admission.ts",
  "src/case-durable-deployment-claim.ts",
  "src/case-shutdown-seal.ts",
  "src/case-state-recovery-evidence.ts",
  "src/case-store-epoch.ts",
  "src/citizen-suggestion.ts",
  "src/civic-case-coordinator.ts",
  "src/credential-free-case-binding-outbox-server.ts",
  "src/roebel-case-steward-control-server.ts",
  "src/roebel-control-service.ts",
  "src/staging-case-control-preflight.ts",
  "src/staging-case-control-runtime.ts",
  "src/staging-case-process-lifecycle.ts",
  "src/staging-case-recovery-activation-authority.ts",
  "src/staging-case-recovery-attestation.ts",
  "src/staging-case-steward-token-authenticator.ts",
  "src/topic-case-admission.ts",
] as const;
const PUBLIC_ONLY_CASE_RUNTIME_SOURCES = [
  "src/case-binding-outbox-projector.ts",
  "src/credential-free-case-binding-outbox-http-client.ts",
  "src/public-case-binding-server.ts",
  "src/staging-public-case-binding-runtime.ts",
] as const;
const SHARED_CASE_RUNTIME_ARTIFACTS = [
  "containers/case-runtime/activation-blocked.mjs",
  "containers/case-runtime/runtime-entrypoint-common.mjs",
] as const;
const CONTROL_ONLY_CASE_RUNTIME_ARTIFACTS = [
  "containers/case-runtime/case-steward-control-entrypoint.mjs",
] as const;
const PUBLIC_ONLY_CASE_RUNTIME_ARTIFACTS = [
  "containers/case-runtime/case-public-binding-entrypoint.mjs",
] as const;

const CASE_RUNTIME_OWNERSHIP = new Map<string, "shared" | "control" | "public">([
  ...SHARED_CASE_RUNTIME_SOURCES.map((path) => [path, "shared"] as const),
  ...CONTROL_ONLY_CASE_RUNTIME_SOURCES.map((path) => [path, "control"] as const),
  ...PUBLIC_ONLY_CASE_RUNTIME_SOURCES.map((path) => [path, "public"] as const),
  ...SHARED_CASE_RUNTIME_ARTIFACTS.map((path) => [path, "shared"] as const),
  ...CONTROL_ONLY_CASE_RUNTIME_ARTIFACTS.map((path) => [path, "control"] as const),
  ...PUBLIC_ONLY_CASE_RUNTIME_ARTIFACTS.map((path) => [path, "public"] as const),
]);

function assertTargetSourceOwnership(target: "control" | "public" | "restore", paths: readonly string[]): void {
  for (const path of paths) {
    const owner = CASE_RUNTIME_OWNERSHIP.get(path);
    assert.ok(owner, `${target} contains unclassified Case runtime source ${path}`);
    assert.ok(owner === "shared" || owner === target, `${target} contains ${owner} Case runtime source ${path}`);
  }
}

function isCaseRuntimeSource(path: string): boolean {
  return /^src\/[a-z0-9/-]+\.ts$/u.test(path) ||
    /^containers\/case-runtime\/[a-z0-9/-]+\.(?:[cm]?js|ts)$/u.test(path);
}

function listMaterializedFiles(directory: string, prefix = ""): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(join(directory, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) paths.push(...listMaterializedFiles(directory, path));
    else if (entry.isFile()) paths.push(path);
    else assert.fail(`unexpected context entry ${path}`);
  }
  return paths.sort();
}

function materializeTargetContext(
  contract: Contract,
  component: "case-steward-control" | "case-public-binding" | "case-restore-verifier",
): { directory: string; expected: string[] } {
  const closurePath = contract.componentSourceClosures[component];
  const expected = [...contract.componentBuildContexts[component]!, ...(closurePath === null ? [] : [closurePath, ...sourceClosure(closurePath)])].sort();
  const directory = mkdtempSync(join(tmpdir(), "stadtstack-case-target-context-"));
  for (const path of expected) {
    const destination = join(directory, path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(resolve(root, path), destination);
  }
  return { directory, expected };
}

function assertTargetMaterializedOwnership(
  target: "control" | "public" | "restore",
  directory: string,
): void {
  assertTargetSourceOwnership(target, listMaterializedFiles(directory).filter(isCaseRuntimeSource));
}

function assertExactTargetContext(component: string, directory: string, expected: readonly string[]): void {
  const actual = listMaterializedFiles(directory);
  const unexpected = actual.filter((path) => !expected.includes(path));
  const missing = expected.filter((path) => !actual.includes(path));
  assert.equal(unexpected.length, 0, `${component} archive contains foreign path ${unexpected.join(",")}`);
  assert.equal(missing.length, 0, `${component} archive omits required path ${missing.join(",")}`);
}

test("the closed runtime context has target-specific loopback entrypoints and an inert restore target", () => {
  const dockerignore = text(".dockerignore");
  assert.match(dockerignore, /^\*\*$/m);
  for (const allowedPath of [
    "!.dockerignore", "!package.json", "!package-lock.json",
    "!containers/case-runtime/Containerfile", "!containers/case-runtime/activation-blocked.mjs",
    "!containers/case-runtime/runtime-entrypoint-common.mjs",
    "!containers/case-runtime/case-steward-control-entrypoint.mjs",
    "!containers/case-runtime/case-public-binding-entrypoint.mjs",
    "!containers/case-runtime/case-steward-control-source-closure.txt",
    "!containers/case-runtime/case-public-binding-source-closure.txt",
  ]) {
    assert.ok(dockerignore.includes(allowedPath), `${allowedPath} must be explicitly included`);
  }
  const containerfile = text("containers/case-runtime/Containerfile");
  assert.match(containerfile, /FROM node:22\.18\.0-slim@sha256:[a-f0-9]{64}/u);
  assert.match(containerfile, /org\.opencontainers\.image\.source="\$\{SOURCE_REPOSITORY\}"/u);
  assert.match(containerfile, /org\.opencontainers\.image\.revision="\$\{SOURCE_REVISION\}"/u);
  assert.match(containerfile, /RUN npm ci --omit=dev --ignore-scripts/u);
  assert.match(containerfile, /test -d node_modules\/nostr-tools/u);
  assert.match(containerfile, /test ! -d node_modules\/typescript/u);
  assert.match(containerfile, /COPY --from=dependencies \/runtime\/node_modules \.\/node_modules/u);
  assert.match(containerfile, /COPY package\.json package-lock\.json \.\//u);
  assert.doesNotMatch(dockerignore, /^!src\/\*\*$/m);
  assert.doesNotMatch(containerfile, /COPY src \.\/src/u);
  assert.match(containerfile, /FROM dependencies AS case-steward-control/u);
  assert.match(containerfile, /FROM dependencies AS case-public-binding/u);
  assert.match(containerfile, /FROM node:22\.18\.0-slim@sha256:[a-f0-9]{64} AS case-restore-verifier/u);
  assert.match(containerfile, /case-steward-control-entrypoint\.mjs/u);
  assert.match(containerfile, /case-public-binding-entrypoint\.mjs/u);
  assert.match(containerfile, /ENTRYPOINT \["node", "\/activation\/activation-blocked\.mjs"\]/u);
  assert.doesNotMatch(containerfile, /COPY \. /u);
  const guard = text("containers/case-runtime/activation-blocked.mjs");
  assert.match(guard, /process\.exitCode = 78/u);
  assert.doesNotMatch(guard, /listen\(|process\.env|fetch\(/u);
});

test("each launcher is bound to its exact TypeScript closure and each target excludes the foreign component", () => {
  const contract = JSON.parse(text("containers/case-runtime/publisher-contract.json")) as Contract;
  const control = sourceClosure("containers/case-runtime/case-steward-control-source-closure.txt");
  const publicBinding = sourceClosure("containers/case-runtime/case-public-binding-source-closure.txt");
  const controlLauncher = contract.componentRuntimeEntrypoints["case-steward-control"]!;
  const publicLauncher = contract.componentRuntimeEntrypoints["case-public-binding"]!;
  const restoreLauncher = contract.componentRuntimeEntrypoints["case-restore-verifier"]!;
  const runtimeArtifacts = listMaterializedFiles(root, "containers/case-runtime").filter(isCaseRuntimeSource);
  assert.deepEqual(control, launcherSourceClosure(controlLauncher.entrypoint, controlLauncher.dynamicTypeScriptTarget));
  assert.deepEqual(publicBinding, launcherSourceClosure(publicLauncher.entrypoint, publicLauncher.dynamicTypeScriptTarget));
  assert.deepEqual(launcherSourceClosure(restoreLauncher.entrypoint, restoreLauncher.dynamicTypeScriptTarget), []);
  for (const [component, launcher] of Object.entries(contract.componentRuntimeEntrypoints)) {
    assert.ok(contract.componentBuildContexts[component]?.includes(launcher.entrypoint), `${component} must publish its declared entrypoint`);
    const source = text(launcher.entrypoint);
    if (launcher.readyComponent === null || launcher.configurationEnvironment === null) {
      assert.equal(launcher.dynamicTypeScriptTarget, null);
      continue;
    }
    assert.ok(source.includes(`component: ${JSON.stringify(launcher.readyComponent)}`), `${component} must use its declared ready component`);
    assert.ok(source.includes(`configurationEnvironment: ${JSON.stringify(launcher.configurationEnvironment)}`), `${component} must use its declared configuration environment`);
  }
  const swappedPublicLauncher = text(publicLauncher.entrypoint).replace(
    "../../src/staging-public-case-binding-runtime.ts",
    "../../src/staging-case-control-runtime.ts",
  );
  assert.throws(
    () => launcherSourceClosure(publicLauncher.entrypoint, publicLauncher.dynamicTypeScriptTarget, {
      [publicLauncher.entrypoint]: swappedPublicLauncher,
    }),
    /must dynamically import only its exact TypeScript runtime target/u,
  );
  const misspelledControlLauncher = text(controlLauncher.entrypoint).replace(
    "../../src/staging-case-control-runtime.ts",
    "../../src/staging-case-contorl-runtime.ts",
  );
  assert.throws(
    () => launcherSourceClosure(controlLauncher.entrypoint, controlLauncher.dynamicTypeScriptTarget, {
      [controlLauncher.entrypoint]: misspelledControlLauncher,
    }),
    /must dynamically import only its exact TypeScript runtime target/u,
  );
  const computedControlLauncher = text(controlLauncher.entrypoint).replace(
    `${"import"}("../../src/staging-case-control-runtime.ts")`,
    `${"import"}(process.env.STADTSTACK_CASE_RUNTIME_TARGET)`,
  );
  assert.throws(
    () => launcherSourceClosure(controlLauncher.entrypoint, controlLauncher.dynamicTypeScriptTarget, {
      [controlLauncher.entrypoint]: computedControlLauncher,
    }),
    /must use only literal relative TypeScript dynamic imports/u,
  );
  assertTargetSourceOwnership("control", control);
  assertTargetSourceOwnership("public", publicBinding);
  assert.deepEqual(control, [...SHARED_CASE_RUNTIME_SOURCES, ...CONTROL_ONLY_CASE_RUNTIME_SOURCES].sort());
  assert.deepEqual(publicBinding, [...SHARED_CASE_RUNTIME_SOURCES, ...PUBLIC_ONLY_CASE_RUNTIME_SOURCES].sort());
  assert.deepEqual(runtimeArtifacts, [
    ...SHARED_CASE_RUNTIME_ARTIFACTS,
    ...CONTROL_ONLY_CASE_RUNTIME_ARTIFACTS,
    ...PUBLIC_ONLY_CASE_RUNTIME_ARTIFACTS,
  ].sort());
  assert.equal(
    CASE_RUNTIME_OWNERSHIP.size,
    new Set([...control, ...publicBinding, ...runtimeArtifacts]).size,
  );
  assert.throws(
    () => assertTargetSourceOwnership("public", [...publicBinding, "src/case-durable-deployment-claim.ts"]),
    /public contains control Case runtime source/u,
  );
  assert.throws(
    () => assertTargetSourceOwnership("control", [...control, "src/staging-public-case-binding-runtime.ts"]),
    /control contains public Case runtime source/u,
  );
  assert.throws(
    () => assertTargetSourceOwnership("public", [...publicBinding, "src/not-classified-case-runtime.ts"]),
    /unclassified Case runtime source/u,
  );
  const injectedPublicImport = `${text("src/staging-public-case-binding-runtime.ts")}\nimport { createCaseDurableDeploymentClaimToken } ${"from"} "./case-durable-deployment-claim.ts";\n`;
  assert.throws(
    () => assertTargetSourceOwnership("public", transitiveSourceClosure("src/staging-public-case-binding-runtime.ts", {
      "src/staging-public-case-binding-runtime.ts": injectedPublicImport,
    })),
    /public contains control Case runtime source/u,
  );

  const containerfile = text("containers/case-runtime/Containerfile");
  const controlCopies = targetStageSources(containerfile, "case-steward-control");
  const publicCopies = targetStageSources(containerfile, "case-public-binding");
  const controlArtifacts = targetStageRuntimeArtifacts(containerfile, "case-steward-control");
  const publicArtifacts = targetStageRuntimeArtifacts(containerfile, "case-public-binding");
  const restoreArtifacts = targetStageRuntimeArtifacts(containerfile, "case-restore-verifier");
  assertTargetSourceOwnership("control", [...controlCopies, ...controlArtifacts]);
  assertTargetSourceOwnership("public", [...publicCopies, ...publicArtifacts]);
  assertTargetSourceOwnership("restore", restoreArtifacts);
  assert.deepEqual(controlCopies, control);
  assert.deepEqual(publicCopies, publicBinding);
  assert.deepEqual(controlArtifacts, [
    "containers/case-runtime/case-steward-control-entrypoint.mjs",
    "containers/case-runtime/runtime-entrypoint-common.mjs",
  ]);
  assert.deepEqual(publicArtifacts, [
    "containers/case-runtime/case-public-binding-entrypoint.mjs",
    "containers/case-runtime/runtime-entrypoint-common.mjs",
  ]);
  assert.deepEqual(restoreArtifacts, ["containers/case-runtime/activation-blocked.mjs"]);
  assert.throws(
    () => assertTargetSourceOwnership("public", [...publicCopies, "src/case-durable-deployment-claim.ts"]),
    /public contains control Case runtime source/u,
  );
  assert.throws(
    () => assertTargetSourceOwnership("public", [...publicArtifacts, "containers/case-runtime/case-steward-control-entrypoint.mjs"]),
    /public contains control Case runtime source/u,
  );
  assert.throws(
    () => assertTargetSourceOwnership("public", [...publicArtifacts, "containers/case-runtime/not-classified-runtime-source.mjs"]),
    /unclassified Case runtime source/u,
  );

  const controlContext = materializeTargetContext(contract, "case-steward-control");
  const publicContext = materializeTargetContext(contract, "case-public-binding");
  const restoreContext = materializeTargetContext(contract, "case-restore-verifier");
  try {
    assertTargetMaterializedOwnership("control", controlContext.directory);
    assertTargetMaterializedOwnership("public", publicContext.directory);
    assertTargetMaterializedOwnership("restore", restoreContext.directory);
    assertExactTargetContext("case-steward-control", controlContext.directory, controlContext.expected);
    assertExactTargetContext("case-public-binding", publicContext.directory, publicContext.expected);
    assertExactTargetContext("case-restore-verifier", restoreContext.directory, restoreContext.expected);
    const injectedOppositeArtifact = "containers/case-runtime/case-public-binding-entrypoint.mjs";
    const oppositeArtifactDestination = join(controlContext.directory, injectedOppositeArtifact);
    mkdirSync(dirname(oppositeArtifactDestination), { recursive: true });
    copyFileSync(resolve(root, injectedOppositeArtifact), oppositeArtifactDestination);
    assert.throws(
      () => assertTargetMaterializedOwnership("control", controlContext.directory),
      /control contains public Case runtime source/u,
    );
    const injectedForeignPath = "src/case-durable-deployment-claim.ts";
    const destination = join(publicContext.directory, injectedForeignPath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(resolve(root, injectedForeignPath), destination);
    assert.throws(
      () => assertTargetMaterializedOwnership("public", publicContext.directory),
      /public contains control Case runtime source/u,
    );
    assert.throws(
      () => assertExactTargetContext("case-public-binding", publicContext.directory, publicContext.expected),
      /foreign path/u,
    );
    const injectedRuntimePath = "containers/case-runtime/not-classified-runtime-source.mjs";
    const runtimeDestination = join(publicContext.directory, injectedRuntimePath);
    mkdirSync(dirname(runtimeDestination), { recursive: true });
    copyFileSync(resolve(root, "containers/case-runtime/activation-blocked.mjs"), runtimeDestination);
    assert.throws(
      () => assertTargetMaterializedOwnership("public", publicContext.directory),
      /unclassified Case runtime source/u,
    );
  } finally {
    rmSync(controlContext.directory, { recursive: true, force: true });
    rmSync(publicContext.directory, { recursive: true, force: true });
    rmSync(restoreContext.directory, { recursive: true, force: true });
  }
  const dockerignore = text(".dockerignore");
  for (const sourcePath of [...control, ...publicBinding]) {
    assert.ok(dockerignore.includes(`!${sourcePath}`), `${sourcePath} must be explicitly included by .dockerignore`);
  }
});

function runEntrypoint(path: string, environment: Record<string, string> = {}) {
  return spawnSync(process.execPath, ["--experimental-strip-types", resolve(root, path)], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ...environment },
  });
}

test("component entrypoints reject cross-capability input and never log configuration", () => {
  const control = runEntrypoint("containers/case-runtime/case-steward-control-entrypoint.mjs");
  assert.equal(control.status, 78);
  assert.equal(control.stdout, "");
  assert.equal(control.stderr, "stadtstack_case_steward_control_start_failed\n");

  const publicWithControlInput = runEntrypoint("containers/case-runtime/case-public-binding-entrypoint.mjs", {
    STADTSTACK_CASE_CONTROL_CONFIG_PATH: "/not-a-public-config.json",
    STADTSTACK_CASE_PUBLIC_CONFIG_PATH: "/not-a-public-config.json",
  });
  assert.equal(publicWithControlInput.status, 78);
  assert.equal(publicWithControlInput.stdout, "");
  assert.equal(publicWithControlInput.stderr, "stadtstack_case_public_binding_start_failed\n");

  const directory = mkdtempSync(join(tmpdir(), "stadtstack-case-runtime-entrypoint-"));
  const configuration = join(directory, "configuration.json");
  const secret = "not-to-be-logged";
  writeFileSync(configuration, `{\"rootDir\":\"/${secret}\",\"credentials\":[\"${secret}\"]}`, "utf8");
  try {
    const invalidPublicConfig = runEntrypoint("containers/case-runtime/case-public-binding-entrypoint.mjs", {
      STADTSTACK_CASE_PUBLIC_CONFIG_PATH: configuration,
    });
    assert.equal(invalidPublicConfig.status, 78);
    assert.equal(invalidPublicConfig.stdout, "");
    assert.equal(invalidPublicConfig.stderr, "stadtstack_case_public_binding_start_failed\n");
    assert.doesNotMatch(`${invalidPublicConfig.stdout}${invalidPublicConfig.stderr}`, new RegExp(secret, "u"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("entrypoint configuration reads are regular-file-only and bounded before allocation", () => {
  const directory = mkdtempSync(join(tmpdir(), "stadtstack-case-runtime-config-read-"));
  const harness = join(directory, "entrypoint-harness.mjs");
  const common = pathToFileURL(resolve(root, "containers/case-runtime/runtime-entrypoint-common.mjs")).href;
  writeFileSync(harness, `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const configurationPath = process.env.CASE_RUNTIME_TEST_CONFIGURATION_PATH;
const replacementPath = process.env.CASE_RUNTIME_TEST_REPLACEMENT_PATH;
const mode = process.env.CASE_RUNTIME_TEST_MODE ?? "none";
let mutated = false;
const originalLstatSync = fs.lstatSync;
const originalOpenSync = fs.openSync;
const originalFstatSync = fs.fstatSync;

if (mode === "fifo-before-open" || mode === "symlink-before-open") {
  fs.lstatSync = (path, options) => {
    const observed = originalLstatSync(path, options);
    if (!mutated && path === configurationPath) {
      mutated = true;
      fs.unlinkSync(configurationPath);
      if (mode === "fifo-before-open") fs.renameSync(replacementPath, configurationPath);
      else fs.symlinkSync(replacementPath, configurationPath);
    }
    return observed;
  };
}
if (mode === "device-after-lstat") {
  fs.openSync = (path, flags) => path === configurationPath
    ? originalOpenSync("/dev/null", flags)
    : originalOpenSync(path, flags);
}
if (mode === "atomic-rename-after-open" || mode === "grow-after-open") {
  fs.fstatSync = (descriptor, options) => {
    const observed = originalFstatSync(descriptor, options);
    if (!mutated) {
      mutated = true;
      if (mode === "atomic-rename-after-open") fs.renameSync(replacementPath, configurationPath);
      else fs.appendFileSync(configurationPath, " ");
    }
    return observed;
  };
}
syncBuiltinESMExports();

const { startLoopbackCaseRuntime } = await import(${JSON.stringify(common)});
void startLoopbackCaseRuntime({
  component: "fixture",
  configurationEnvironment: "STADTSTACK_CASE_FIXTURE_CONFIG_PATH",
  async create(value) {
    if (JSON.stringify(value) !== '{"ok":true}') throw new Error("fixture_invalid");
    return Object.freeze({ async start() {}, async close() {} });
  },
});
`, "utf8");
  const run = (configurationPath: string, mode = "none", replacementPath = "") => spawnSync(process.execPath, [harness], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      STADTSTACK_CASE_FIXTURE_CONFIG_PATH: configurationPath,
      CASE_RUNTIME_TEST_CONFIGURATION_PATH: configurationPath,
      CASE_RUNTIME_TEST_MODE: mode,
      CASE_RUNTIME_TEST_REPLACEMENT_PATH: replacementPath,
    },
    timeout: 1_500,
  });
  const rejected = (configurationPath: string, mode = "none", replacementPath = ""): void => {
    const result = run(configurationPath, mode, replacementPath);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 78);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "stadtstack_case_fixture_start_failed\n");
  };

  try {
    const regular = join(directory, "regular.json");
    writeFileSync(regular, '{"ok":true}', "utf8");
    const accepted = run(regular);
    assert.equal(accepted.error, undefined);
    assert.equal(accepted.status, 0);
    assert.equal(accepted.stdout, "stadtstack_case_fixture_loopback_ready\n");
    assert.equal(accepted.stderr, "");

    const oversized = join(directory, "oversized.json");
    writeFileSync(oversized, Buffer.alloc(1_048_577, 0x20));
    rejected(oversized);

    const symbolic = join(directory, "symbolic.json");
    symlinkSync(regular, symbolic);
    rejected(symbolic);
    rejected(directory);

    const fifo = join(directory, "configuration.fifo");
    const mkfifo = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
    assert.equal(mkfifo.error, undefined);
    assert.equal(mkfifo.status, 0, mkfifo.stderr);
    rejected(fifo);

    const fifoRace = join(directory, "fifo-race.json");
    const fifoReplacement = join(directory, "fifo-race-replacement");
    writeFileSync(fifoRace, '{"ok":true}', "utf8");
    const mkfifoRace = spawnSync("mkfifo", [fifoReplacement], { encoding: "utf8" });
    assert.equal(mkfifoRace.error, undefined);
    assert.equal(mkfifoRace.status, 0, mkfifoRace.stderr);
    rejected(fifoRace, "fifo-before-open", fifoReplacement);

    const symlinkRace = join(directory, "symlink-race.json");
    const symlinkTarget = join(directory, "symlink-race-target.json");
    writeFileSync(symlinkRace, '{"ok":true}', "utf8");
    writeFileSync(symlinkTarget, '{"ok":true}', "utf8");
    rejected(symlinkRace, "symlink-before-open", symlinkTarget);

    const deviceRace = join(directory, "device-race.json");
    writeFileSync(deviceRace, '{"ok":true}', "utf8");
    rejected(deviceRace, "device-after-lstat");
    rejected("/dev/null");

    const atomicRace = join(directory, "atomic-race.json");
    const atomicReplacement = join(directory, "atomic-race-replacement.json");
    writeFileSync(atomicRace, '{"ok":true}', "utf8");
    writeFileSync(atomicReplacement, '{"ok":true}', "utf8");
    rejected(atomicRace, "atomic-rename-after-open", atomicReplacement);

    const growthRace = join(directory, "growth-race.json");
    writeFileSync(growthRace, '{"ok":true}', "utf8");
    rejected(growthRace, "grow-after-open");

  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("public and control launchers never announce readiness after termination starts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "stadtstack-case-runtime-termination-race-"));
  const configuration = join(directory, "configuration.json");
  const harness = join(directory, "termination-race-harness.mjs");
  const common = pathToFileURL(resolve(root, "containers/case-runtime/runtime-entrypoint-common.mjs")).href;
  writeFileSync(configuration, '{"ok":true}', "utf8");
  writeFileSync(harness, `
import { setImmediate as waitImmediate } from "node:timers/promises";
import { startLoopbackCaseRuntime } from ${JSON.stringify(common)};

const [component, configurationEnvironment] = process.argv.slice(2);
let releaseStart;
const startBarrier = new Promise((resolve) => { releaseStart = resolve; });
const keepAlive = setInterval(() => {}, 1_000);
await startLoopbackCaseRuntime({
  component,
  configurationEnvironment,
  async create(value) {
    if (JSON.stringify(value) !== '{"ok":true}') throw new Error("fixture_invalid");
    return Object.freeze({
      async start() {
        process.send?.("start_pending");
        await startBarrier;
      },
      async close() {
        process.send?.("close_requested");
        clearInterval(keepAlive);
        releaseStart();
        await waitImmediate();
        process.send?.("close_completed");
      },
    });
  },
});
process.disconnect?.();
`, "utf8");

  const run = async (component: string, configurationEnvironment: string) => await new Promise<Readonly<{
    status: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    messages: readonly unknown[];
  }>>((resolveResult, reject) => {
    const child = spawn(process.execPath, [harness, component, configurationEnvironment], {
      env: { PATH: process.env.PATH ?? "", [configurationEnvironment]: configuration },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let stdout = "";
    let stderr = "";
    const messages: unknown[] = [];
    let signalled = false;
    child.stdout!.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr!.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("message", (message) => {
      messages.push(message);
      if (message === "start_pending" && !signalled) {
        signalled = true;
        if (!child.kill("SIGTERM")) reject(new Error("termination_signal_not_delivered"));
      }
    });
    child.once("error", reject);
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("termination_race_timed_out"));
    }, 2_000);
    child.once("close", (status, signal) => {
      clearTimeout(timeout);
      resolveResult(Object.freeze({ status, signal, stdout, stderr, messages: Object.freeze([...messages]) }));
    });
  });

  try {
    const contract = JSON.parse(text("containers/case-runtime/publisher-contract.json")) as Contract;
    for (const key of ["case-public-binding", "case-steward-control"] as const) {
      const { readyComponent, configurationEnvironment } = contract.componentRuntimeEntrypoints[key]!;
      assert.ok(readyComponent !== null && configurationEnvironment !== null);
      const result = await run(readyComponent, configurationEnvironment);
      assert.equal(result.status, 0, JSON.stringify(result));
      assert.equal(result.signal, null);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.deepEqual(result.messages, ["start_pending", "close_requested", "close_completed"]);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the remote publisher is main-only, digest-attested, and has no deployment access", () => {
  const workflow = text(".github/workflows/case-staging-publish.yml");
  assert.match(workflow, /branches:\n\s+- main/u);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/u);
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/u);
  assert.match(workflow, /git diff --exit-code/u);
  assert.match(workflow, /git archive --format=tar "\$GITHUB_SHA"/u);
  assert.match(workflow, /SOURCE_REPOSITORY=https:\/\/github\.com\/GiraeffleAeffle\/stadtstack/u);
  assert.match(workflow, /SOURCE_REVISION=\$\{\{ github\.sha \}\}/u);
  assert.match(workflow, /package-lock\.json/u);
  assert.match(workflow, /containers\/case-runtime/u);
  assert.match(workflow, /sourceClosure: containers\/case-runtime\/case-steward-control-source-closure\.txt/u);
  assert.match(workflow, /sourceClosure: containers\/case-runtime\/case-public-binding-source-closure\.txt/u);
  assert.match(workflow, /sourceClosure: ""/u);
  assert.match(workflow, /source_closure='\$\{\{ matrix\.sourceClosure \}\}'/u);
  assert.match(workflow, /context_files=\(\.dockerignore containers\/case-runtime\/Containerfile containers\/case-runtime\/activation-blocked\.mjs\)/u);
  assert.match(workflow, /git archive --format=tar "\$GITHUB_SHA" -- "\$\{context_files\[@\]\}" "\$\{source_files\[@\]\}"/u);
  assert.doesNotMatch(workflow, /git archive[\s\S]*?source-closure\.txt/u);
  assert.match(workflow, /mapfile -t source_files/u);
  assert.match(workflow, /LC_ALL=C sort -u/u);
  assert.match(workflow, /\^src\/\[a-z0-9\/-\]\+\\\.ts\$/u);
  assert.match(workflow, /"\$\{source_files\[@\]\}" \| tar -xf/u);
  assert.match(workflow, /case-build-context/u);
  assert.match(workflow, /target: \$\{\{ matrix\.component \}\}/u);
  assert.ok(workflow.includes("outputs: type=oci,dest=${{ runner.temp }}/${{ matrix.component }}.oci.tar,name=stadtstack.local/stadtstack-case/${{ matrix.component }}:source-${{ github.sha }},annotation.io.containerd.image.name=stadtstack.local/stadtstack-case/${{ matrix.component }}:source-${{ github.sha }},rewrite-timestamp=true"));
  assert.ok(!workflow.includes(".oci.tar,name=source-${{ github.sha }}"));
  assert.equal(workflow.match(/LOCAL_REFERENCE: source-\$\{\{ github\.sha \}\}/gu)?.length, 2);
  assert.match(workflow, /scripts\/publish-case-image-from-oci\.mjs/u);
  assert.match(workflow, /oras-project\/setup-oras@[a-f0-9]{40}/u);
  assert.match(workflow, /platforms: linux\/amd64/u);
  assert.match(workflow, /source-\$\{\{ github\.sha \}\}/u);
  assert.match(workflow, /actions\/attest-build-provenance@[a-f0-9]{40}/u);
  assert.match(workflow, /actions\/attest@[a-f0-9]{40}/u);
  assert.match(workflow, /anchore\/sbom-action@[a-f0-9]{40}/u);
  assert.match(workflow, /https:\/\/spdx\.dev\/Document\/v2\.3/u);
  assert.match(workflow, /gh attestation verify/u);
  assert.match(
    workflow,
    /- name: Verify GitHub OIDC provenance and SPDX evidence[\s\S]*?env:\n\s+GH_TOKEN: \$\{\{ github\.token \}\}/u,
  );
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
    if (argumentsList[0] === "resolve" && calls.filter((value) => value.includes("resolve") && !value.includes("--oci-layout")).length === 1) {
      return failure(`Error response from registry: failed to resolve digest: ${input.image}:${input.tag}: not found`);
    }
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
  assert.equal(classifyRemoteResolveFailure(failure(`Error response from registry: failed to resolve digest: ${input.image}:${input.tag}: not found`)), "absent");
  assert.equal(classifyRemoteResolveFailure(failure("failed to open local archive: not found")), "error");
  assert.equal(classifyRemoteResolveFailure(failure(`Error response from registry: failed to resolve digest: /tmp/case.oci.tar:${input.tag}: not found`)), "error");
  assert.equal(classifyRemoteResolveFailure(failure(`Error response from registry: failed to resolve digest: ${input.image}:${input.tag}: not found\n401 UNAUTHORIZED`)), "error");
  assert.equal(classifyRemoteResolveFailure(failure("429 TOOMANYREQUESTS")), "retryable");
  assert.equal(classifyRemoteResolveFailure(failure("401 UNAUTHORIZED")), "error");
  assert.throws(() => parseArguments(["--archive", "/tmp/a", "--local-reference", "local/x:tag", "--component", "case-steward-control", "--image", "ghcr.io/x/y", "--tag", "latest"]), /publisher_tag_invalid/u);
  assert.throws(() => parseArguments(["--archive", "/tmp/a", "--local-reference", input.tag, "--component", input.component, "--image", input.image, "--tag", input.tag, "--anonymous-registry-config", ""]), /publisher_argument_invalid:anonymous-registry-config/u);
});
