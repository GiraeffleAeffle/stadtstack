import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { verifyPermanentRuntimeOci } from "./verify-permanent-runtime-oci.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function writeBlob(root, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  const hash = sha256(bytes);
  writeFileSync(join(root, "blobs", "sha256", hash), bytes);
  return { digest: `sha256:${hash}`, size: bytes.length };
}

function writeLayout(root, sourceRevision, mutate) {
  mkdirSync(join(root, "blobs", "sha256"), { recursive: true });
  const layerBytes = Buffer.from("synthetic-runtime-layer");
  const layerHash = sha256(layerBytes);
  writeFileSync(join(root, "blobs", "sha256", layerHash), layerBytes);
  const configValue = {
    architecture: "amd64",
    os: "linux",
    config: {
      User: "10001:10001",
      Entrypoint: ["node", "--experimental-strip-types", "/app/src/permanent-runtime-cli.ts"],
      Cmd: ["serve", "--config", "/etc/stadtstack/runtime.json", "--actor-tokens", "/var/run/secrets/stadtstack/actor-tokens.json"],
      WorkingDir: "/app",
      Env: ["HOME=/tmp", "TMPDIR=/tmp", "NODE_ENV=production"],
      Labels: {
        "org.opencontainers.image.source": "https://github.com/GiraeffleAeffle/stadtstack",
        "org.opencontainers.image.revision": sourceRevision,
        "org.opencontainers.image.licenses": "MIT",
      },
    },
    rootfs: { type: "layers", diff_ids: [`sha256:${layerHash}`] },
  };
  mutate?.(configValue);
  const config = writeBlob(root, configValue);
  const manifest = writeBlob(root, {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { mediaType: "application/vnd.oci.image.config.v1+json", ...config },
    layers: [{ mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", digest: `sha256:${layerHash}`, size: layerBytes.length }],
  });
  const importName = `stadtstack.local/roebel-staging-lab/stadtstack-runtime:source-${sourceRevision}`;
  writeFileSync(join(root, "oci-layout"), JSON.stringify({ imageLayoutVersion: "1.0.0" }));
  writeFileSync(join(root, "index.json"), JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [{
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      ...manifest,
      platform: { os: "linux", architecture: "amd64" },
      annotations: { "io.containerd.image.name": importName },
    }],
  }));
  return { config, importName, layerHash, manifest };
}

test("accepts one exact CRI-named linux/amd64 permanent runtime", () => {
  const root = mkdtempSync(join(tmpdir(), "stadtstack-runtime-oci-"));
  const revision = "a".repeat(40);
  try {
    const expected = writeLayout(root, revision);
    assert.deepEqual(verifyPermanentRuntimeOci(root, revision), {
      schemaVersion: "stadtstack_permanent_runtime_oci_receipt_v1",
      sourceRevision: revision,
      component: "stadtstack-runtime",
      importName: expected.importName,
      podReference: `stadtstack.local/roebel-staging-lab/stadtstack-runtime@${expected.manifest.digest}`,
      manifestDigest: expected.manifest.digest,
      configDigest: expected.config.digest,
      layerDigests: [`sha256:${expected.layerHash}`],
      user: "10001:10001",
      entrypoint: ["node", "--experimental-strip-types", "/app/src/permanent-runtime-cli.ts"],
      command: ["serve", "--config", "/etc/stadtstack/runtime.json", "--actor-tokens", "/var/run/secrets/stadtstack/actor-tokens.json"],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects a credential embedded in the permanent runtime image", () => {
  const root = mkdtempSync(join(tmpdir(), "stadtstack-runtime-oci-secret-"));
  const revision = "a".repeat(40);
  try {
    writeLayout(root, revision, (config) => config.config.Env.push("ACTOR_TOKEN=must-not-be-in-image"));
    assert.throws(() => verifyPermanentRuntimeOci(root, revision), /runtime_secret_embedded/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
