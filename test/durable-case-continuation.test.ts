import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { finalizeEvent, getPublicKey, type Event as NostrEvent } from "nostr-tools/pure";
import { checksumAdministrationWorkspaceResponse, type AdministrationWorkspaceHandoffReceiptV1, type AdministrationWorkspaceResponseV1, type AdministrationWorkRequestV1 } from "../src/adapters/administration-workspace-adapter.ts";
import { createSqliteAtomicTopicCaseAdmission, type SqliteAtomicTopicCaseAdmission, type SqliteAtomicTopicCaseAdmissionOptions } from "../src/adapters/sqlite-atomic-topic-case-admission.ts";
import { createDurableCaseContinuation, type DurableCaseContinuation, type DurableContinuationRoleAuthenticator } from "../src/durable-case-continuation.ts";
import { DETERMINISTIC_OUTCOME_REVIEWED_AT, type ActorBinding, type DepartmentPackageInput, type ParticipationResultInput, type ReviewedOutcomeInput } from "../src/civic-case-coordinator.ts";
import type { CitizenSignedTopicSuggestionV1 } from "../src/citizen-suggestion.ts";
import { verifyTopicCaseAdmission } from "../src/topic-case-admission.ts";
import type { AtomicTopicCaseAdmissionV1 } from "../src/roebel-control-service.ts";

const municipalityId = "roebel-mueritz";
const topicId = "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse";
const policyVersion = "case-intake-v1";
const citizenSecret = new Uint8Array(32).fill(21);
const agentSecret = new Uint8Array(32).fill(22);
const citizenPubkey = getPublicKey(citizenSecret);
const agentPubkey = getPublicKey(agentSecret);
const departmentIds = ["planning", "traffic", "public-space", "environment", "social", "finance", "law", "participation"] as const;
const roots = new Set<string>();
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function digest(value: unknown): string { return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`; }
function plain(event: NostrEvent): NostrEvent { return JSON.parse(JSON.stringify(event)) as NostrEvent; }

function candidate(suffix = "one"): { sourceDiscussion: NostrEvent; sourceAnswer: NostrEvent; signedSuggestion: CitizenSignedTopicSuggestionV1 } {
  const sourceDiscussion = plain(finalizeEvent({ kind: 1, created_at: 1_787_356_800, content: `@Mecky Welche geprüften Möglichkeiten gibt es? (${suffix})`, tags: [["p", agentPubkey], ["t", "stadtstack-civic-discussion"], ["municipality", municipalityId], ["topic", topicId], ["stance", "root"], ["argument-root", "self"]] }, citizenSecret));
  const sourceAnswer = plain(finalizeEvent({ kind: 1, created_at: sourceDiscussion.created_at + 1, content: `Geprüfte Unterlagen beschreiben Varianten. (${suffix})`, tags: [["e", sourceDiscussion.id, "", "reply"], ["p", citizenPubkey], ["municipality", municipalityId], ["topic", topicId], ["mecky-receipt", `urn:stadtstack:mecky-answer:${"a".repeat(64)}`], ["evidence", `sha256:${"c".repeat(64)}`, "https://www.roebel-mueritz.de/rathaus/reviewed/crossing-options"]] }, agentSecret));
  const core = { sourceAnswerReceiptId: `urn:stadtstack:mecky-answer:${"a".repeat(64)}`, sourceDiscussionId: sourceDiscussion.id, sourceDiscussionRef: `nostr://event/${sourceDiscussion.id}`, municipalityId, topicId, citizenPubkey, title: "Sichere Querung gemeinsam prüfen", summary: "Geprüfte Varianten sollen öffentlich abgewogen werden und menschlich in einen Case übergehen." };
  const draft = { schemaVersion: "public_mecky_topic_suggestion_draft_v1" as const, draftId: `urn:stadtstack:topic-suggestion-draft:${digest(core).slice(7)}`, ...core, entryState: "citizen_signature_required" as const, authorityBinding: "none" as const, submittedToCivicWorkflow: false as const };
  const event = plain(finalizeEvent({ kind: 1, created_at: sourceAnswer.created_at + 1, content: JSON.stringify(draft), tags: [["schema", "citizen_signed_topic_suggestion_v1"], ["municipality", municipalityId], ["topic", topicId], ["e", sourceDiscussion.id, "", "root"], ["mecky-receipt", core.sourceAnswerReceiptId]] }, citizenSecret));
  return { sourceDiscussion, sourceAnswer, signedSuggestion: { schemaVersion: "citizen_signed_topic_suggestion_v1", candidateId: `urn:stadtstack:signed-topic-suggestion:${event.id}`, signerPubkey: event.pubkey, draft, event: { ...event, kind: 1 }, verification: { kind: "nostr_nip01", verified: true }, entryState: "awaiting_human_case_admission", authorityBinding: "none", submittedToCivicWorkflow: false } };
}

function options(rootDir: string): SqliteAtomicTopicCaseAdmissionOptions {
  return { rootDir, municipalityId, policyVersion, requiredDepartmentIds: [...departmentIds], actorRegistry: [
    { actorId: "roebel:case-steward", actorClass: "case_steward" }, { actorId: "roebel:public", actorClass: "public" }, { actorId: "roebel:administration", actorClass: "administration" },
    { actorId: "roebel:participation-result-reviewer", actorClass: "participation_reviewer" },
    ...departmentIds.flatMap((departmentId) => [{ actorId: `roebel:${departmentId}-agent`, actorClass: "department_agent" as const, departmentId }, { actorId: `roebel:${departmentId}-reviewer`, actorClass: "department_reviewer" as const, departmentId }]),
  ], allowedSignerPubkeys: [citizenPubkey], allowedAgentPubkeys: [agentPubkey] };
}
function admission(suffix = "one"): AtomicTopicCaseAdmissionV1 {
  const value = candidate(suffix); const verified = verifyTopicCaseAdmission({ ...value, allowedAgentPubkeys: [agentPubkey] });
  return { schemaVersion: "atomic_topic_case_admission_v1", municipalityId, rootEventId: verified.discussion.id, caseId: verified.identity.caseId, actorBinding: { actorId: "roebel:case-steward", actorClass: "case_steward" }, expectedCaseVersion: 0, idempotencyKey: `roebel:admit-signed-topic-suggestion:${verified.signedSuggestion.event.id}`, policyVersion, sourceDiscussion: value.sourceDiscussion, verifiedAdmission: verified };
}

const actors = {
  caseSteward: { actorId: "roebel:case-steward", actorClass: "case_steward" as const },
  administrationReader: { actorId: "roebel:administration", actorClass: "administration" as const },
  publicReader: { actorId: "roebel:public", actorClass: "public" as const },
  participationReviewer: { actorId: "roebel:participation-result-reviewer", actorClass: "participation_reviewer" as const },
};
type AuthorizationFixture = { roleAuthenticator: DurableContinuationRoleAuthenticator; grant(actor: ActorBinding, caseId: string): symbol };
function authorizationFixture(): AuthorizationFixture {
  const grants = new Map<symbol, { actor: ActorBinding; caseIds: Set<string> }>();
  return { roleAuthenticator: { async authenticate({ authorization, caseId }) { if (typeof authorization !== "symbol") return null; const grant = grants.get(authorization); return grant?.caseIds.has(caseId) ? { ...grant.actor } : null; } }, grant(actor, caseId) { const token = Symbol(actor.actorId); grants.set(token, { actor: { ...actor }, caseIds: new Set([caseId]) }); return token; } };
}
function continuation(adapter: SqliteAtomicTopicCaseAdmission, auth: AuthorizationFixture, configuredDepartments: readonly string[] = departmentIds): DurableCaseContinuation {
  return createDurableCaseContinuation({ caseCoordinators: adapter.caseCoordinators, roleAuthenticator: auth.roleAuthenticator, municipalityId, policyVersion, actors, departments: configuredDepartments.map((departmentId) => ({ departmentId, agent: { actorId: `roebel:${departmentId}-agent`, actorClass: "department_agent" as const }, reviewer: { actorId: `roebel:${departmentId}-reviewer`, actorClass: "department_reviewer" as const } })) });
}
function allTokens(auth: AuthorizationFixture, caseId: string): Record<string, symbol> {
  const result: Record<string, symbol> = { steward: auth.grant(actors.caseSteward, caseId), administration: auth.grant(actors.administrationReader, caseId), participation: auth.grant(actors.participationReviewer, caseId) };
  for (const departmentId of departmentIds) { result[`${departmentId}:agent`] = auth.grant({ actorId: `roebel:${departmentId}-agent`, actorClass: "department_agent" }, caseId); result[`${departmentId}:reviewer`] = auth.grant({ actorId: `roebel:${departmentId}-reviewer`, actorClass: "department_reviewer" }, caseId); }
  return result;
}
function adminProjection(adapter: SqliteAtomicTopicCaseAdmission, caseId: string) { return adapter.caseCoordinators.open(caseId).project({ schemaVersion: "query_envelope_v1", queryType: "case_projection_v1", caseId, actorBinding: actors.administrationReader, visibility: "administration", policyVersion, atCaseVersion: null }); }
function publicProjection(adapter: SqliteAtomicTopicCaseAdmission, caseId: string) { return adapter.caseCoordinators.open(caseId).project({ schemaVersion: "query_envelope_v1", queryType: "case_projection_v1", caseId, actorBinding: actors.publicReader, visibility: "public", policyVersion, atCaseVersion: null }); }
function packageInput(departmentId: typeof departmentIds[number], suggestionId: string): DepartmentPackageInput { return { id: `package:${departmentId}`, departmentId, suggestionId, request: `Bitte geprüfte Varianten für ${departmentId} einordnen.`, assignedAgentActorId: `roebel:${departmentId}-agent`, assignedReviewerActorId: `roebel:${departmentId}-reviewer`, authorityBinding: "none" }; }
function observation(request: AdministrationWorkRequestV1, departmentId: string) { return { schemaVersion: "administration_workspace_handoff_observation_v1" as const, requestId: request.requestId, requestChecksum: request.contentChecksum, targetSystem: request.target.system, externalWorkspaceRef: "workspace:roebel", externalTaskRef: `task:crossing-${departmentId}`, acknowledgedAt: "2026-08-23T12:00:00.000Z", authorityBinding: "none" as const }; }
function response(request: AdministrationWorkRequestV1, receipt: AdministrationWorkspaceHandoffReceiptV1, departmentId: string): AdministrationWorkspaceResponseV1 { return checksumAdministrationWorkspaceResponse({ schemaVersion: "administration_workspace_response_v1", responseId: `response:crossing-${departmentId}`, requestId: request.requestId, requestChecksum: request.contentChecksum, handoffReceiptId: receipt.receiptId, handoffReceiptChecksum: receipt.receiptChecksum, caseId: request.caseBinding.caseId, packageId: request.packageBinding.packageId, packageChecksum: request.packageBinding.packageChecksum, returnedAt: "2026-08-23T12:01:00.000Z", sourceSystem: { kind: request.target.system, recordRef: receipt.externalTaskRef }, draft: { publicSummary: `Geprüfte Einordnung für ${departmentId}.`, publicCitations: [`https://www.roebel-mueritz.de/rathaus/reviewed/${departmentId}`], privateEvidenceRefs: [] }, authorityBinding: "none" }); }
function participationInput(sourceBrief: { id: string; briefChecksum: string }, briefEventId: string): ParticipationResultInput {
  const base = { schemaVersion: "participation_result_v1" as const, id: "participation:crossing", contractId: "synthetic:roebel-mitmachen-advisory", contractVersion: 1, methodKind: "survey", methodVersion: "synthetic-survey-v1", ruleId: "advisory-signal", ruleVersion: "1", authorityBinding: "none" as const, question: "Welche Variante soll zuerst geprüft werden?", options: [{ optionId: "crossing", label: "Markierte Querung", aggregateCount: 6 }, { optionId: "lighting", label: "Beleuchtung", aggregateCount: 2 }], totalAccepted: 8, resultSummary: "Die markierte Querung erhielt das stärkste beratende Signal.", unresolvedDissent: [], representationAudit: { targetPopulationDescription: "Anwohnende", recruitmentMethod: "Synthetic opt-in", samplingMethod: "Voluntary response", totalInvited: null, totalStarted: 8, totalCompleted: 8, limitations: ["Synthetic data; not representative."] }, limitations: ["Advisory signal only."], openedAt: "2026-08-01T00:00:00Z", closedAt: "2026-08-02T00:00:00Z", reviewedAt: "2026-08-08T00:00:05.000Z", resultArtifactRef: "synthetic://roebel/crossing/participation", minorityReportRef: null, correctionState: "current" as const };
  return { ...base, checksum: digest({ participation: base, sourceBrief: { ...sourceBrief, briefEventId }, policyVersion, actorBinding: actors.participationReviewer, reviewedAt: base.reviewedAt }) };
}

async function completeEightDepartmentLine(input: { adapter: SqliteAtomicTopicCaseAdmission; facade: DurableCaseContinuation; caseId: string; tokens: Record<string, symbol> }) {
  const { adapter, facade, caseId, tokens } = input;
  const suggestionId = publicProjection(adapter, caseId).projection.suggestion.id;
  for (const departmentId of departmentIds) await facade.assignDepartmentPackage({ authorization: tokens.steward, caseId, departmentPackage: packageInput(departmentId, suggestionId) });
  for (const departmentId of departmentIds) {
    const packageId = `package:${departmentId}`;
    const request = await facade.prepareAdministrationWork({ authorization: tokens.administration, caseId, packageId, targetSystem: "openDesk" });
    const handoff = await facade.acceptAdministrationHandoff({ authorization: tokens.administration, caseId, packageId, targetSystem: "openDesk", observation: observation(request, departmentId) });
    await facade.acceptAdministrationResponse({ authorization: tokens[`${departmentId}:agent`], administrationAuthorization: tokens.administration, caseId, packageId, targetSystem: "openDesk", observation: observation(request, departmentId), response: response(request, handoff, departmentId) });
    const department = adminProjection(adapter, caseId).projection.departmentPackages!.find((item) => item.departmentId === departmentId)!;
    await facade.attestDepartmentReview({ authorization: tokens[`${departmentId}:reviewer`], caseId, review: { packageId, draftArtifactChecksum: department.draft!.artifactChecksum, decision: "accepted", reviewedAt: "2026-08-08T00:00:05.000Z" } });
  }
  const readiness = await facade.assessCitizenBrief({ authorization: tokens.administration, caseId }); assert.equal(readiness.status, "ready_for_case_steward");
  const prepared = await facade.prepareCitizenBrief({ authorization: tokens.steward, caseId, briefId: "brief:crossing" });
  await assert.rejects(facade.applyCitizenBrief({ authorization: tokens.steward, caseId, briefId: "brief:crossing", preparationChecksum: `sha256:${"0".repeat(64)}` }), /durable_continuation_brief_stale/);
  const briefReceipt = await facade.applyCitizenBrief({ authorization: tokens.steward, caseId, briefId: "brief:crossing", preparationChecksum: prepared.preparationChecksum });
  assert.equal(briefReceipt.caseVersion, 28);
  const brief = (await facade.assessCitizenBrief({ authorization: tokens.administration, caseId })).currentBrief!;
  const sourceBrief = { id: brief.id, briefChecksum: brief.briefChecksum };
  const participation = participationInput(sourceBrief, briefReceipt.eventIds[0]!);
  assert.equal((await facade.recordAdvisoryParticipation({ authorization: tokens.participation, caseId, participation, sourceBrief })).caseVersion, 29);
  const discussion = publicProjection(adapter, caseId).projection.discussion;
  const outcome: ReviewedOutcomeInput = { schemaVersion: "reviewed_outcome_input_v1", id: "outcome:crossing", summary: "Die markierte Querung wird als stärkstes beratendes Ergebnis weiter geprüft.", resultArtifactRef: "synthetic://roebel/crossing/outcome", reviewedAt: DETERMINISTIC_OUTCOME_REVIEWED_AT, sourceDiscussionRef: { type: "nostr_event", id: discussion.id, ref: discussion.sourceRef }, sourceBrief, sourceParticipation: { id: participation.id, participationChecksum: participation.checksum }, publicationTarget: "public_knowledge_projection", authorityBinding: "none" };
  assert.equal((await facade.recordReviewedOutcome({ authorization: tokens.steward, caseId, outcome })).caseVersion, 30);
  return facade.currentPublicKnowledge({ caseId });
}

test("continues one atomically admitted Case through authenticated administration, brief, participation, and public knowledge", async () => {
  const root = mkdtempSync(join(tmpdir(), "stadtstack-continuation-")); roots.add(root);
  const adapter = createSqliteAtomicTopicCaseAdmission(options(root)); const admitted = await adapter.admission.admit(admission());
  const auth = authorizationFixture(); const tokens = allTokens(auth, admitted.caseId); const facade = continuation(adapter, auth);
  const knowledge = await completeEightDepartmentLine({ adapter, facade, caseId: admitted.caseId, tokens });
  assert.equal(knowledge.caseVersion, 30); assert.equal(knowledge.suggestion.sourceTopicId, topicId); assert.equal(knowledge.citizenBrief.reviewedDepartmentCount, 8);
  assert.deepEqual(knowledge.citizenBrief.reviewedCitations, departmentIds.map((id) => `https://www.roebel-mueritz.de/rathaus/reviewed/${id}`).sort());
  assert.equal(knowledge.participation.advisory, true); assert.equal(knowledge.governance.formalVoteAvailable, false); assert.equal(knowledge.authorityBinding, "none");
  const before = JSON.stringify(knowledge); const snapshot = { journalHeadChecksum: knowledge.journalHeadChecksum, sourceProjectionChecksum: knowledge.sourceProjectionChecksum, knowledgeChecksum: knowledge.knowledgeChecksum };
  adapter.close();
  const reopened = createSqliteAtomicTopicCaseAdmission(options(root)); const reopenedKnowledge = continuation(reopened, auth).currentPublicKnowledge({ caseId: admitted.caseId });
  assert.equal(JSON.stringify(reopenedKnowledge), before); assert.equal(reopenedKnowledge.caseVersion, 30);
  assert.deepEqual({ journalHeadChecksum: reopenedKnowledge.journalHeadChecksum, sourceProjectionChecksum: reopenedKnowledge.sourceProjectionChecksum, knowledgeChecksum: reopenedKnowledge.knowledgeChecksum }, snapshot);
  reopened.close();
});

test("fails closed before durable mutation for unauthenticated, cross-Case, swapped, stale, and malformed requests", async () => {
  const root = mkdtempSync(join(tmpdir(), "stadtstack-continuation-fail-")); roots.add(root);
  const adapter = createSqliteAtomicTopicCaseAdmission(options(root)); const auth = authorizationFixture(); const admitted = await adapter.admission.admit(admission("one")); const other = await adapter.admission.admit(admission("two"));
  const tokens = allTokens(auth, admitted.caseId); const facade = continuation(adapter, auth); const suggestionId = publicProjection(adapter, admitted.caseId).projection.suggestion.id; const planning = packageInput("planning", suggestionId);
  await assert.rejects(facade.assignDepartmentPackage({ authorization: "not-a-token", caseId: admitted.caseId, departmentPackage: planning }), /durable_continuation_authentication_required/);
  await assert.rejects(facade.assignDepartmentPackage({ authorization: tokens.administration, caseId: admitted.caseId, departmentPackage: planning }), /durable_continuation_actor_forbidden/);
  await assert.rejects(facade.assignDepartmentPackage({ authorization: tokens.steward, caseId: other.caseId, departmentPackage: planning }), /durable_continuation_authentication_required/);
  await assert.rejects(facade.assignDepartmentPackage({ authorization: tokens.steward, caseId: admitted.caseId, departmentPackage: planning, unexpected: true } as never), /durable_continuation_assignment_invalid/);
  await assert.rejects(facade.assignDepartmentPackage(new Proxy({ authorization: tokens.steward, caseId: admitted.caseId, departmentPackage: planning }, {}) as never), /durable_continuation_assignment_invalid/);
  const accessor = { authorization: tokens.steward, caseId: admitted.caseId, get departmentPackage() { return planning; } }; await assert.rejects(facade.assignDepartmentPackage(accessor as never), /durable_continuation_assignment_invalid/);
  await assert.rejects(facade.assignDepartmentPackage({ authorization: tokens.steward, caseId: admitted.caseId, departmentPackage: new Proxy(planning, {}) as never }), /durable_continuation_assignment_invalid/);
  await facade.assignDepartmentPackage({ authorization: tokens.steward, caseId: admitted.caseId, departmentPackage: planning });
  const traffic = packageInput("traffic", suggestionId); await facade.assignDepartmentPackage({ authorization: tokens.steward, caseId: admitted.caseId, departmentPackage: traffic });
  const request = await facade.prepareAdministrationWork({ authorization: tokens.administration, caseId: admitted.caseId, packageId: planning.id, targetSystem: "openDesk" });
  const handoff = await facade.acceptAdministrationHandoff({ authorization: tokens.administration, caseId: admitted.caseId, packageId: planning.id, targetSystem: "openDesk", observation: observation(request, "planning") });
  const correctResponse = response(request, handoff, "planning");
  await assert.rejects(facade.acceptAdministrationResponse({ authorization: tokens["traffic:agent"], administrationAuthorization: tokens.administration, caseId: admitted.caseId, packageId: planning.id, targetSystem: "openDesk", observation: observation(request, "planning"), response: correctResponse }), /durable_continuation_actor_forbidden/);
  await assert.rejects(facade.acceptAdministrationResponse({ authorization: tokens["planning:agent"], administrationAuthorization: tokens.administration, caseId: admitted.caseId, packageId: traffic.id, targetSystem: "openDesk", observation: observation(request, "traffic"), response: correctResponse }), /durable_continuation_actor_forbidden/);
  await facade.assignDepartmentPackage({ authorization: tokens.steward, caseId: admitted.caseId, departmentPackage: packageInput("public-space", suggestionId) });
  await assert.rejects(facade.acceptAdministrationResponse({ authorization: tokens["planning:agent"], administrationAuthorization: tokens.administration, caseId: admitted.caseId, packageId: planning.id, targetSystem: "openDesk", observation: observation(request, "planning"), response: correctResponse }), /administration_handoff_binding_invalid|administration_response_case_binding_invalid|administration_response_request_binding_invalid/);
  const currentRequest = await facade.prepareAdministrationWork({ authorization: tokens.administration, caseId: admitted.caseId, packageId: planning.id, targetSystem: "openDesk" });
  const currentHandoff = await facade.acceptAdministrationHandoff({ authorization: tokens.administration, caseId: admitted.caseId, packageId: planning.id, targetSystem: "openDesk", observation: observation(currentRequest, "planning") });
  await facade.acceptAdministrationResponse({ authorization: tokens["planning:agent"], administrationAuthorization: tokens.administration, caseId: admitted.caseId, packageId: planning.id, targetSystem: "openDesk", observation: observation(currentRequest, "planning"), response: response(currentRequest, currentHandoff, "planning") });
  const draft = adminProjection(adapter, admitted.caseId).projection.departmentPackages!.find((item) => item.departmentId === "planning")!.draft!;
  await assert.rejects(facade.attestDepartmentReview({ authorization: tokens["traffic:reviewer"], caseId: admitted.caseId, review: { packageId: planning.id, draftArtifactChecksum: draft.artifactChecksum, decision: "accepted", reviewedAt: "2026-08-08T00:00:05.000Z" } }), /durable_continuation_actor_forbidden/);
  assert.equal(adminProjection(adapter, admitted.caseId).caseVersion, 7);
  assert.throws(() => continuation(adapter, auth, departmentIds.slice(0, 7)), /durable_continuation_config_invalid/);
  assert.throws(() => createDurableCaseContinuation({ caseCoordinators: adapter.caseCoordinators, roleAuthenticator: auth.roleAuthenticator, municipalityId, policyVersion, actors, departments: departmentIds.map((departmentId) => ({ departmentId, agent: { actorId: departmentId === "planning" ? actors.caseSteward.actorId : `roebel:${departmentId}-agent`, actorClass: "department_agent" as const }, reviewer: { actorId: `roebel:${departmentId}-reviewer`, actorClass: "department_reviewer" as const } })) }), /durable_continuation_config_invalid/);
  const sparseDepartments: unknown[] = []; sparseDepartments.length = 4_000_000_000;
  assert.throws(() => createDurableCaseContinuation({ caseCoordinators: adapter.caseCoordinators, roleAuthenticator: auth.roleAuthenticator, municipalityId, policyVersion, actors, departments: sparseDepartments as never }), /durable_continuation_config_invalid/);
  adapter.close();
});
