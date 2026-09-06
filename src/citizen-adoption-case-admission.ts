import type { DiscussionArtifact } from "./adapters/discussion-adapter.ts";
import { canonicalMunicipalCaseId, canonicalSyntheticCaseId, deriveCaseUuidV7 } from "./case-id.ts";
import { createAdoptedCaseBindingReceipt, createSyntheticCaseBindingReceipt } from "./case-binding-projection.ts";
import { verifyRecordedSyntheticAdoptionEvidence, type SyntheticAdoptionEvidencePolicy, verifyRecordedCitizenAdoptionEvidence, type CitizenAdoptionEvidencePolicy } from "./citizen-adoption-evidence.ts";

function caseDiscussion(root: import("nostr-tools/pure").Event, municipalityId: string, caseId: string): DiscussionArtifact {
  return {
    schemaVersion: "discussion_artifact_v1", id: root.id, source: "nostr", sourceRef: `nostr://event/${root.id}`,
    municipalityId, caseId, authorityBinding: "none",
    verificationProof: { kind: "nostr_nip01", verified: true, signature: root.sig },
    event: { id: root.id, pubkey: root.pubkey, createdAt: root.created_at, kind: 1,
      content: root.content, tags: structuredClone(root.tags), relayRefs: [] },
  };
}

/** Reconstructs the Case binding from the complete, recorded adoption proof.
 * The durable writer owns the fresh ledger/status reads and nonce consumption. */
export function verifyCitizenAdoptionCaseAdmission(input: unknown, policy: CitizenAdoptionEvidencePolicy) {
  const evidence = verifyRecordedCitizenAdoptionEvidence(input, policy);
  const { sourceDiscussion: root, sourceAnswer, adoptionEvent } = evidence.bundle;
  const content = JSON.parse(adoptionEvent.content) as Record<string, string>;
  const caseUuidV7 = deriveCaseUuidV7(adoptionEvent);
  const caseId = canonicalMunicipalCaseId(policy.municipalityId, caseUuidV7)!;
  const identity = { municipalityId: policy.municipalityId, topicId: content.topicId!,
    candidateId: content.adoptionId!, caseUuidV7, caseId };
  const discussion = caseDiscussion(root, policy.municipalityId, caseId);
  return { evidence, identity, discussion, sourceAnswer, candidateEventId: adoptionEvent.id,
    title: content.title!, summary: content.summary!, adopterPubkey: adoptionEvent.pubkey,
    sourceAnswerReceiptId: content.sourceAnswerReceiptId!,
    requestNonce: (evidence.eligibilityStatus.statusCore as Record<string, string>).requestNonce!,
    idempotencyKey: `roebel:admit-citizen-adoption:${adoptionEvent.id}` };
}

export type VerifiedCitizenAdoptionCaseAdmission = ReturnType<typeof verifyCitizenAdoptionCaseAdmission>;

/** Public receipt construction remains downstream of the atomic journal append. */
export function citizenAdoptionBindingReceipt(verified: VerifiedCitizenAdoptionCaseAdmission,
  journal: Readonly<{ eventIds: readonly string[]; journalHeadChecksum: string }>) {
  const { evidence, identity } = verified;
  const receipt = evidence.bundle.eligibilityReceipt;
  const core = receipt.eligibilityCore as Record<string, string>;
  return createAdoptedCaseBindingReceipt({
    rootEventId: verified.discussion.id, topicId: identity.topicId, candidateId: identity.candidateId,
    candidateEventId: verified.candidateEventId, participantSuggestionEventId: evidence.bundle.participantSuggestionEvent.id,
    adopterPubkey: verified.adopterPubkey, eligibilityReceiptId: receipt.receiptId as string,
    eligibilityReceiptChecksum: receipt.payloadChecksum as string, eligibilityPolicyVersion: core.policyVersion!,
    eligibilityIssuer: core.issuer!, adoptionAcceptanceReceiptChecksum: evidence.adoptionAcceptance.receiptChecksum as string,
    sourceAnswerEventId: verified.sourceAnswer.id, sourceAnswerReceiptId: verified.sourceAnswerReceiptId,
    caseId: identity.caseId, caseVersion: 3, caseEventIds: [journal.eventIds[0]!, journal.eventIds[1]!, journal.eventIds[2]!],
    journalHeadChecksum: journal.journalHeadChecksum, admissionEventChecksum: journal.journalHeadChecksum,
  });
}

/** A test challenge and accepted tracer are never converted to eligibility. */
export function verifySyntheticAdoptionCaseAdmission(input: unknown, policy: SyntheticAdoptionEvidencePolicy) {
  const evidence = verifyRecordedSyntheticAdoptionEvidence(input, policy);
  const { sourceDiscussion: root, sourceAnswer, proofEvent } = evidence.bundle;
  const tracer = evidence.projection.tracer as Record<string, string>;
  const caseUuidV7 = deriveCaseUuidV7(proofEvent);
  const caseId = canonicalSyntheticCaseId(policy.municipalityId, caseUuidV7)!;
  const identity = { municipalityId: policy.municipalityId, topicId: tracer.topicId!,
    candidateId: tracer.tracerId!, caseUuidV7, caseId };
  const discussion = caseDiscussion(root, policy.municipalityId, caseId);
  return { evidence, identity, discussion, sourceAnswer, candidateEventId: proofEvent.id,
    title: tracer.title!, summary: tracer.summary!, adopterPubkey: proofEvent.pubkey,
    sourceAnswerReceiptId: tracer.sourceAnswerReceiptId!, idempotencyKey: `roebel:admit-synthetic-adoption:${proofEvent.id}` };
}
export type VerifiedSyntheticAdoptionCaseAdmission = ReturnType<typeof verifySyntheticAdoptionCaseAdmission>;

export function syntheticAdoptionBindingReceipt(verified: VerifiedSyntheticAdoptionCaseAdmission,
  journal: Readonly<{ eventIds: readonly string[]; journalHeadChecksum: string }>) {
  const { evidence, identity } = verified;
  const acceptance = evidence.projection.acceptanceReceipt as Record<string, string>;
  return createSyntheticCaseBindingReceipt({
    rootEventId: verified.discussion.id, topicId: identity.topicId, candidateId: identity.candidateId,
    candidateEventId: verified.candidateEventId, participantSuggestionEventId: evidence.bundle.participantSuggestionEvent.id,
    adopterPubkey: verified.adopterPubkey, testPolicyVersion: acceptance.policyVersion!,
    adoptionAcceptanceReceiptChecksum: acceptance.receiptChecksum!, sourceAnswerEventId: verified.sourceAnswer.id,
    sourceAnswerReceiptId: verified.sourceAnswerReceiptId, caseId: identity.caseId, caseVersion: 3,
    caseEventIds: [journal.eventIds[0]!, journal.eventIds[1]!, journal.eventIds[2]!],
    journalHeadChecksum: journal.journalHeadChecksum, admissionEventChecksum: journal.journalHeadChecksum,
  });
}
