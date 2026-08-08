#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root }).toString("utf8").split("\0").filter(Boolean).sort();
const failures = [];
const fail = (message) => failures.push(message);

const forbiddenPath = /(?:^|\/)(?:provenance|deploy|\.secrets?|secrets|node_modules|\.data|dist|build|out|coverage)(?:\/|$)|(?:^|\/)(?:.*\.(?:sqlite|sqlite3|db|tfstate|pem|key|p12|pfx|log|tmp))$/i;
for (const file of tracked) if (forbiddenPath.test(file)) fail(`forbidden tracked path: ${file}`);

const manifestName = "PUBLIC_MANIFEST.sha256";
if (tracked.filter((file) => file === manifestName).length !== 1) fail("exactly one PUBLIC_MANIFEST.sha256 is required");
const manifestFiles = tracked.filter((file) => file !== manifestName).sort();
if (tracked.some((file) => {
  try { return lstatSync(join(root, file)).isSymbolicLink(); } catch { return true; }
})) fail("tracked symlink is forbidden");
for (const file of tracked) {
  const bytes = readFileSync(join(root, file));
  const text = bytes.toString("utf8");
  if (bytes.includes(0)) fail(`binary tracked file is forbidden: ${file}`);
  if (text.startsWith("version https://git-lfs.github.com/spec/v1")) fail(`Git LFS pointer is forbidden: ${file}`);
}
try {
  const manifestLines = readFileSync(join(root, manifestName), "utf8").trimEnd().split("\n");
  const entries = manifestLines.map((line) => {
    const match = /^(?<digest>[a-f0-9]{64})  (?<path>.+)$/.exec(line);
    if (!match?.groups?.digest || !match.groups.path) throw new Error("manifest line invalid");
    return { digest: match.groups.digest, path: match.groups.path };
  });
  if (entries.length !== manifestFiles.length) throw new Error("manifest file count mismatch");
  if (entries.some((entry, index) => entry.path !== manifestFiles[index])) throw new Error("manifest paths are not sorted or do not cover tracked files");
  for (const entry of entries) {
    const actual = createHash("sha256").update(readFileSync(join(root, entry.path))).digest("hex");
    if (entry.digest !== actual) throw new Error(`manifest digest mismatch: ${entry.path}`);
  }
} catch (error) {
  fail(`public manifest invalid: ${error instanceof Error ? error.message : String(error)}`);
}

const forbiddenText = [
  [/^\/Users\//m, "absolute macOS path"],
  [/^\/private\/tmp\//m, "absolute temporary path"],
  [/-----BEGIN (?:OPENSSH|RSA|EC|DSA|PRIVATE) KEY-----/m, "private key block"],
  [/sk-[A-Za-z0-9]{20,}/, "OpenAI-style secret"],
  [/gh[pousr]_[A-Za-z0-9]{20,}/, "GitHub token-style secret"],
  [/AKIA[0-9A-Z]{16}/, "AWS access key"],
  [/xox[baprs]-[A-Za-z0-9-]{20,}/, "Slack token-style secret"],
  [/deploy\/e2e|source-provenance\.json|bootstrap-artifacts\.json/, "private provenance/operations artifact"],
];
for (const file of tracked) {
  const text = readFileSync(join(root, file), "utf8");
  for (const [pattern, label] of forbiddenText) if (pattern.test(text)) fail(`${label}: ${file}`);
}

for (const file of tracked.filter((candidate) => /\.(?:ts|mjs)$/.test(candidate))) {
  const text = readFileSync(join(root, file), "utf8");
  for (const match of text.matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (specifier.startsWith("/")) fail(`absolute import: ${file} -> ${specifier}`);
    if (/(?:^|\/)(?:deploy|provenance|\.secrets?|secrets)(?:\/|$)/i.test(specifier)) {
      fail(`forbidden import: ${file} -> ${specifier}`);
    }
    if (specifier.startsWith(".")) {
      const imported = resolve(root, file, "..", specifier);
      const candidates = [imported, `${imported}.ts`, `${imported}.mjs`, `${imported}.js`];
      if (!candidates.some((candidate) => { try { statSync(candidate); return true; } catch { return false; } })) {
        fail(`missing local import: ${file} -> ${specifier}`);
      }
    }
  }
}

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (packageJson.license !== "MIT") fail("package license is not MIT");
if (!packageJson.dependencies?.["nostr-tools"]) fail("nostr-tools dependency missing");
for (const scriptName of ["test", "typecheck", "lint", "verify:public"]) {
  if (typeof packageJson.scripts?.[scriptName] !== "string" || packageJson.scripts[scriptName].trim() === "") fail(`package script missing: ${scriptName}`);
}
if (!tracked.includes("LICENSE") || !tracked.includes("NOTICE")) fail("LICENSE/NOTICE missing");
const lockText = readFileSync(join(root, "package-lock.json"), "utf8");
if (!/"nostr-tools"/.test(lockText) || !/"license": "Unlicense"/.test(lockText)) fail("dependency license evidence missing from lockfile");

const markdown = tracked.filter((file) => file.endsWith(".md"));
for (const file of markdown) {
  const text = readFileSync(join(root, file), "utf8");
  const links = [...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
  for (const link of links) {
    if (/^(?:https?:|mailto:|#)/i.test(link)) continue;
    const target = resolve(root, file, "..", link.split("#", 1)[0]);
    if (!target.startsWith(`${root}/`) && target !== root) fail(`link escapes root: ${file} -> ${link}`);
    else {
      try { statSync(target); } catch { fail(`broken Markdown link: ${file} -> ${link}`); }
    }
  }
}

try { execFileSync("npm", ["ls", "--omit=dev", "--depth=0"], { cwd: root, stdio: "ignore" }); }
catch { fail("dependency closure: npm ls failed"); }
try { execFileSync("git", ["fsck", "--full", "--strict"], { cwd: root, stdio: "ignore" }); }
catch { fail("git fsck failed"); }

if (failures.length > 0) {
  console.error(JSON.stringify({ status: "failed", failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ status: "passed", trackedFiles: tracked.length, checks: ["forbidden-paths", "forbidden-imports", "secret-patterns", "manifest-digests", "symlink-policy", "binary-policy", "license-notice", "markdown-links", "dependency-closure", "git-fsck"] }, null, 2));
}
