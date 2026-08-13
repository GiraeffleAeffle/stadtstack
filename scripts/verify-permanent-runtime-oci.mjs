#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const ENTRYPOINT = ["node", "--experimental-strip-types", "/app/src/permanent-runtime-cli.ts"];
const COMMAND = ["serve", "--config", "/etc/stadtstack/runtime.json", "--actor-tokens", "/var/run/secrets/stadtstack/actor-tokens.json"];
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export function verifyPermanentRuntimeOci(root, sourceRevision) {
  if (typeof root !== "string" || !REVISION.test(sourceRevision ?? "")) throw new Error("usage");
  const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
  const readBlob = (descriptor, label) => {
    if (!descriptor || !SHA256.test(descriptor.digest ?? "") || !Number.isSafeInteger(descriptor.size) || descriptor.size < 1) {
      throw new Error(`${label}_descriptor_invalid`);
    }
    const bytes = readFileSync(join(root, "blobs", "sha256", descriptor.digest.slice(7)));
    if (bytes.length !== descriptor.size || digest(bytes) !== descriptor.digest) throw new Error(`${label}_blob_invalid`);
    return bytes;
  };

  const layout = readJson(join(root, "oci-layout"));
  if (JSON.stringify(layout) !== JSON.stringify({ imageLayoutVersion: "1.0.0" })) throw new Error("layout_invalid");
  const index = readJson(join(root, "index.json"));
  if (index.schemaVersion !== 2 || index.mediaType !== "application/vnd.oci.image.index.v1+json" || !Array.isArray(index.manifests) || index.manifests.length !== 1) {
    throw new Error("index_invalid");
  }
  const descriptor = index.manifests[0];
  if (descriptor.mediaType !== "application/vnd.oci.image.manifest.v1+json" || descriptor.platform?.os !== "linux" || descriptor.platform?.architecture !== "amd64") {
    throw new Error("platform_invalid");
  }
  const importName = `stadtstack.local/roebel-staging-lab/stadtstack-runtime:source-${sourceRevision}`;
  if (descriptor.annotations?.["io.containerd.image.name"] !== importName) throw new Error("import_name_invalid");
  const manifest = JSON.parse(readBlob(descriptor, "manifest"));
  if (manifest.schemaVersion !== 2 || manifest.mediaType !== "application/vnd.oci.image.manifest.v1+json" || !Array.isArray(manifest.layers) || manifest.layers.length < 1) {
    throw new Error("manifest_invalid");
  }
  const config = JSON.parse(readBlob(manifest.config, "config"));
  if (config.os !== "linux" || config.architecture !== "amd64") throw new Error("config_platform_invalid");
  const layerDigests = manifest.layers.map((layer, indexValue) => {
    readBlob(layer, `layer_${indexValue}`);
    return layer.digest;
  });
  const referenced = new Set([descriptor.digest.slice(7), manifest.config.digest.slice(7), ...layerDigests.map((value) => value.slice(7))]);
  const blobFiles = readdirSync(join(root, "blobs", "sha256")).sort();
  if (blobFiles.length !== referenced.size || blobFiles.some((file) => !referenced.has(file))) throw new Error("unreferenced_blob");

  const runtime = config.config ?? {};
  if (runtime.User !== "10001:10001" || runtime.WorkingDir !== "/app") throw new Error("runtime_identity_invalid");
  if (JSON.stringify(runtime.Entrypoint) !== JSON.stringify(ENTRYPOINT) || JSON.stringify(runtime.Cmd) !== JSON.stringify(COMMAND)) throw new Error("runtime_command_invalid");
  for (const required of ["HOME=/tmp", "TMPDIR=/tmp", "NODE_ENV=production"]) {
    if (!runtime.Env?.includes(required)) throw new Error(`runtime_env_missing:${required}`);
  }
  if ((runtime.Env ?? []).some((entry) => /(?:TOKEN|SECRET|PASSWORD|API_KEY)=/u.test(entry))) throw new Error("runtime_secret_embedded");
  const labels = runtime.Labels ?? {};
  if (labels["org.opencontainers.image.source"] !== "https://github.com/GiraeffleAeffle/stadtstack" || labels["org.opencontainers.image.revision"] !== sourceRevision || labels["org.opencontainers.image.licenses"] !== "MIT") {
    throw new Error("labels_invalid");
  }

  return {
    schemaVersion: "stadtstack_permanent_runtime_oci_receipt_v1",
    sourceRevision,
    component: "stadtstack-runtime",
    importName,
    podReference: `stadtstack.local/roebel-staging-lab/stadtstack-runtime@${descriptor.digest}`,
    manifestDigest: descriptor.digest,
    configDigest: manifest.config.digest,
    layerDigests,
    user: runtime.User,
    entrypoint: runtime.Entrypoint,
    command: runtime.Cmd,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [root, sourceRevision, outputPath] = process.argv.slice(2);
  const receipt = verifyPermanentRuntimeOci(root, sourceRevision);
  const bytes = `${JSON.stringify(receipt, null, 2)}\n`;
  if (outputPath) writeFileSync(outputPath, bytes);
  process.stdout.write(bytes);
}
