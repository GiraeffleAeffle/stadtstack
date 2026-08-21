/** Public, value-free contracts shared by Mecky and the Case admission seam. */
export type PublicMeckySuggestionDraftV1 = {
  schemaVersion: "public_mecky_suggestion_draft_v1";
  draftId: string;
  sourceAnswerReceiptId: string;
  sourceDiscussionId: string;
  sourceDiscussionRef: string;
  municipalityId: string;
  sourceCaseId: string;
  caseId: string;
  citizenPubkey: string;
  title: string;
  summary: string;
  entryState: "citizen_signature_required";
  authorityBinding: "none";
  submittedToCivicWorkflow: false;
};

export type PublicMeckySigningRequestV1 = {
  schemaVersion: "public_mecky_signing_request_v1";
  citizenPubkey: string;
  sourceAnswerReceiptId: string;
  draft: PublicMeckySuggestionDraftV1;
  unsignedEvent: {
    kind: 1;
    created_at: number;
    tags: string[][];
    content: string;
  };
};

export type CitizenSignedSuggestionV1 = {
  schemaVersion: "citizen_signed_suggestion_v1";
  candidateId: string;
  signerPubkey: string;
  draft: PublicMeckySuggestionDraftV1;
  event: {
    id: string;
    pubkey: string;
    createdAt: number;
    kind: 1;
    tags: string[][];
    content: string;
    signature: string;
  };
  verification: {
    kind: "nostr_nip01";
    verified: true;
  };
  entryState: "awaiting_human_case_admission";
  authorityBinding: "none";
  submittedToCivicWorkflow: false;
};

/**
 * A public Mecky draft that is still bound to a Röbel topic, not a Civic Case.
 * The absence of a Case identifier is intentional: only the later human
 * admission transition may allocate the Case.
 */
export type PublicMeckyTopicSuggestionDraftV1 = {
  schemaVersion: "public_mecky_topic_suggestion_draft_v1";
  draftId: string;
  sourceAnswerReceiptId: string;
  sourceDiscussionId: string;
  sourceDiscussionRef: string;
  municipalityId: string;
  topicId: string;
  citizenPubkey: string;
  title: string;
  summary: string;
  entryState: "citizen_signature_required";
  authorityBinding: "none";
  submittedToCivicWorkflow: false;
};

/** Exact public candidate emitted by the Röbel citizen-signing seam. */
export type CitizenSignedTopicSuggestionV1 = {
  schemaVersion: "citizen_signed_topic_suggestion_v1";
  candidateId: string;
  signerPubkey: string;
  draft: PublicMeckyTopicSuggestionDraftV1;
  event: {
    id: string;
    pubkey: string;
    created_at: number;
    kind: 1;
    tags: string[][];
    content: string;
    sig: string;
  };
  verification: {
    kind: "nostr_nip01";
    verified: true;
  };
  entryState: "awaiting_human_case_admission";
  authorityBinding: "none";
  submittedToCivicWorkflow: false;
};
