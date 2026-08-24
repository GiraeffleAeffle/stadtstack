#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const exercisedTests = [
  "an accountable human admits the exact citizen-signed suggestion into the canonical Case",
  "the reviewed outcome is linked back to the signed discussion and powers Mecky plus Mitmachen",
  "admission, outcome, and public knowledge bindings fail closed without mutating the Case",
  "retraction invalidates the public outcome and the Mitmachen knowledge surface",
  "the admitted suggestion and reviewed outcome recover byte-identically from SQLite WAL",
];

execFileSync(process.execPath, [
  "--test",
  `--test-name-pattern=${exercisedTests.map((name) => `(?:${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`).join("|")}`,
  "test/civic-case-outcome-loop.test.ts",
], { cwd: root, stdio: "pipe" });

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

const sourceFiles = [
  "src/citizen-suggestion.ts",
  "src/civic-case-coordinator.ts",
  "src/adapters/sqlite-journal-adapter.ts",
  "src/public-knowledge.ts",
  "src/public-mecky.ts",
  "src/reference-browser.ts",
  "test/civic-case-outcome-loop.test.ts",
];
const sourceBindings = sourceFiles.map((path) => ({
  path,
  sha256: sha256(readFileSync(join(root, path))),
}));
const evidence = {
  schemaVersion: "stadtstack.civic_outcome_loop_evidence.v1",
  status: "completed",
  mode: "offline_synthetic_only",
  scope: {
    municipalityId: "roebel-mueritz",
    sourceCaseId: "marienfelder-strasse",
    caseId: "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
    policyVersion: "case-intake-v1",
  },
  flow: {
    discussion: "nip01_verified",
    signedSuggestion: "human_admitted",
    administrationDepartmentsReviewed: 8,
    citizenBrief: "current_reviewed",
    mitmachen: "advisory_non_binding",
    reviewedOutcome: "public_projection_with_discussion_backlink",
    finalCaseVersion: 30,
  },
  sharedPublicKnowledge: {
    consumers: ["public_mecky", "mitmachen"],
    caseVersionBound: true,
    journalHeadBound: true,
    sourceProjectionChecksumBound: true,
    knowledgeChecksumBound: true,
  },
  governance: {
    advisoryChoiceVisible: true,
    formalVoteAvailable: false,
    formalVoteReason: "separate_legal_authority_binding_required",
    legallyBindingBallot: false,
  },
  correctionAndRetraction: {
    staleOutcomeSuppressed: true,
    discussionBacklinkSuppressed: true,
    staleMitmachenProjectionRejected: true,
  },
  tests: exercisedTests,
  sourceBindings,
  effects: {
    externalNetwork: false,
    publicWrite: false,
    relayPublication: false,
    civicStateOutsideMemory: false,
    formalSubmission: false,
    vote: false,
    paidProvider: false,
  },
  authorityBinding: "none",
  localProofOnly: true,
};
const evidenceChecksum = sha256(canonical(evidence));
process.stdout.write(`${JSON.stringify({ ...evidence, evidenceChecksum }, null, 2)}\n`);
