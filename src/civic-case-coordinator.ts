import { createHash } from "node:crypto";

import {
  STADTSTACK_E2E_FIXTURE_TAG,
  createNostrDiscussionAdapter,
  type DiscussionArtifact,
  type DiscussionScope,
} from "./adapters/discussion-adapter.ts";
import {
  getEventHash,
  validateEvent,
  verifyEvent,
  type Event as NostrEvent,
} from "nostr-tools/pure";
import type {
  CitizenSignedSuggestionV1,
  CitizenSignedTopicSuggestionV1,
} from "./citizen-suggestion.ts";
import {
  verifyTopicCaseAdmission,
} from "./topic-case-admission.ts";

export type {
  CitizenSignedSuggestionV1,
  CitizenSignedTopicSuggestionV1,
} from "./citizen-suggestion.ts";

/** The only authority binding admitted by the municipality-neutral tracer. */
export type AuthorityBinding = "none";

export type ActorClass =
  | "citizen"
  | "public"
  | "administration"
  | "council"
  | "case_steward"
  | "department_agent"
  | "department_reviewer"
  | "participation_reviewer";

export type ActorBinding = {
  actorId: string;
  actorClass: ActorClass;
};

/** Private registry metadata; department scope never crosses the envelope seam. */
export type ActorRegistration = ActorBinding & {
  departmentId?: string;
};

export type CaseJurisdiction = {
  scheme: "test";
  value: string;
};

export type SourceReference = {
  type: "nostr_event";
  id: string;
  ref: string;
};

type CommandEnvelopeBase = {
  schemaVersion: "command_envelope_v1";
  caseId: string;
  actorBinding: ActorBinding;
  expectedCaseVersion: number;
  idempotencyKey: string;
  visibility: "private_case";
  policyVersion: string;
  [key: string]: unknown;
};

export type IntakeDiscussionCommand = CommandEnvelopeBase & {
  commandType: "intake_discussion_v1";
  payload: {
    discussion: DiscussionArtifact;
  };
};

export type AdmitSignedSuggestionCommand = CommandEnvelopeBase & {
  commandType: "admit_signed_suggestion_v1";
  payload: {
    signedSuggestion: CitizenSignedSuggestionV1;
  };
};

/**
 * The human-owned transition from a case-free topic proposal to one Case.
 * It is valid only as the first command for the deterministically derived
 * Case identity and appends creation, discussion, and admission atomically.
 */
export type AdmitSignedTopicSuggestionCommand = CommandEnvelopeBase & {
  commandType: "admit_signed_topic_suggestion_v1";
  payload: {
    sourceDiscussion: NostrEvent;
    sourceAnswer: NostrEvent;
    signedSuggestion: CitizenSignedTopicSuggestionV1;
  };
};

export type AssignDepartmentPackageCommand = CommandEnvelopeBase & {
  commandType: "assign_department_package_v1";
  payload: {
    departmentPackage: DepartmentPackageInput;
  };
};

export type RecordDepartmentDraftCommand = CommandEnvelopeBase & {
  commandType: "record_department_draft_v1";
  payload: {
    packageId: string;
    packageChecksum: string;
    draft: DepartmentDraftInput;
  };
};

export type AttestDepartmentReviewCommand = CommandEnvelopeBase & {
  commandType: "attest_department_review_v1";
  payload: {
    review: DepartmentReviewInput;
  };
};

export type ParticipationOptionAggregate = {
  optionId: string;
  label: string;
  aggregateCount: number;
};

export type ParticipationRepresentationAudit = {
  targetPopulationDescription: string;
  recruitmentMethod: string;
  samplingMethod: string | null;
  totalInvited: number | null;
  totalStarted: number;
  totalCompleted: number;
  limitations: string[];
};

export type ParticipationResultInput = {
  schemaVersion: "participation_result_v1";
  id: string;
  contractId: string;
  contractVersion: number;
  methodKind: string;
  methodVersion: string;
  ruleId: string;
  ruleVersion: string;
  authorityBinding: AuthorityBinding;
  question: string;
  options: ParticipationOptionAggregate[];
  totalAccepted: number;
  resultSummary: string;
  unresolvedDissent: string[];
  representationAudit: ParticipationRepresentationAudit;
  limitations: string[];
  openedAt: string;
  closedAt: string;
  reviewedAt: string;
  resultArtifactRef: string;
  minorityReportRef: string | null;
  correctionState: "current";
  checksum: string;
};

export type RecordAdvisoryParticipationCommand = CommandEnvelopeBase & {
  commandType: "record_advisory_participation_v1";
  payload: {
    participation: ParticipationResultInput;
    sourceBrief: {
      id: string;
      briefChecksum: string;
    };
  };
};

export type RetractAdvisoryParticipationCommand = CommandEnvelopeBase & {
  commandType: "retract_advisory_participation_v1";
  payload: {
    retraction: {
      participationId: string;
      participationChecksum: string;
    };
  };
};

export type RecordReviewedOutcomeCommand = CommandEnvelopeBase & {
  commandType: "record_reviewed_outcome_v1";
  payload: {
    outcome: ReviewedOutcomeInput;
  };
};

export type DeriveCitizenBriefCommand = CommandEnvelopeBase & {
  commandType: "derive_citizen_brief_v1";
  payload: {
    brief: CitizenBriefInput;
  };
};

export type CorrectDepartmentDraftCommand = CommandEnvelopeBase & {
  commandType: "correct_department_draft_v1";
  payload: {
    packageId: string;
    packageChecksum: string;
    priorDraftArtifactChecksum: string;
    draft: DepartmentDraftInput;
  };
};

export type RetractDepartmentResponseCommand = CommandEnvelopeBase & {
  commandType: "retract_department_response_v1";
  payload: {
    retraction: DepartmentRetractionInput;
  };
};

export type CommandEnvelope =
  | IntakeDiscussionCommand
  | AdmitSignedSuggestionCommand
  | AdmitSignedTopicSuggestionCommand
  | AssignDepartmentPackageCommand
  | RecordDepartmentDraftCommand
  | AttestDepartmentReviewCommand
  | RecordAdvisoryParticipationCommand
  | RetractAdvisoryParticipationCommand
  | RecordReviewedOutcomeCommand
  | DeriveCitizenBriefCommand
  | CorrectDepartmentDraftCommand
  | RetractDepartmentResponseCommand;

export type DepartmentPackageInput = {
  id: string;
  departmentId: string;
  suggestionId: string;
  request: string;
  assignedAgentActorId: string;
  assignedReviewerActorId: string;
  authorityBinding: AuthorityBinding;
};

export type DepartmentDraftInput = {
  schemaVersion: "department_draft_v1";
  id: string;
  publicSummary: string;
  publicCitations: string[];
  privateEvidenceRefs: string[];
  authorityBinding: AuthorityBinding;
};

export type DepartmentReviewInput = {
  packageId: string;
  draftArtifactChecksum: string;
  decision: "accepted" | "rejected";
  reviewedAt: string;
};

export type BriefSourceBinding = {
  packageId: string;
  packageChecksum: string;
  draftArtifactChecksum: string;
  reviewAttestationChecksum: string;
};

export type CitizenBriefInput = {
  id: string;
  sourceBindings: BriefSourceBinding[];
  authorityBinding: AuthorityBinding;
};

export type ReviewedOutcomeInput = {
  schemaVersion: "reviewed_outcome_input_v1";
  id: string;
  summary: string;
  resultArtifactRef: string;
  reviewedAt: string;
  sourceDiscussionRef: SourceReference;
  sourceBrief: { id: string; briefChecksum: string };
  sourceParticipation: { id: string; participationChecksum: string };
  publicationTarget: "public_knowledge_projection";
  authorityBinding: AuthorityBinding;
};

export type DepartmentRetractionInput = {
  packageId: string;
  packageChecksum: string;
  targetDraftArtifactChecksum: string;
  targetReviewAttestationChecksum: string;
};

export type QueryEnvelope = {
  schemaVersion: "query_envelope_v1";
  queryType: "case_projection_v1";
  caseId: string;
  actorBinding: ActorBinding;
  visibility: "public" | "administration" | "council";
  policyVersion: string;
  atCaseVersion: number | null;
  [key: string]: unknown;
};

export type CommandReceipt = {
  caseVersion: number;
  eventIds: string[];
  journalHeadChecksum: string;
};

export type CaseEventV1 = {
  schemaVersion: "case_event_v1";
  eventId: string;
  caseId: string;
  caseVersion: number;
  eventType:
    | "case_created_v1"
    | "discussion_recorded_v1"
    | "signed_suggestion_admitted_v1"
    | "signed_topic_suggestion_admitted_v1"
    | "department_package_assigned_v1"
    | "department_draft_recorded_v1"
    | "department_review_attested_v1"
    | "citizen_brief_derived_v1"
    | "department_draft_corrected_v1"
    | "department_response_retracted_v1"
    | "advisory_participation_recorded_v1"
    | "advisory_participation_retracted_v1"
    | "reviewed_outcome_recorded_v1";
  priorEventChecksum: string;
  actorBinding: ActorBinding;
  payloadChecksum: string;
  correctionOf: string | null;
  eventChecksum: string;
};

/** Internal durability port; the public coordinator remains handle/project-only. */
export type CoordinatorJournalEvent = CaseEventV1 & { payload: unknown };

export type CoordinatorJournalIdempotency = {
  idempotencyKey: string;
  fingerprint: string;
  receipt: CommandReceipt;
};

export type CoordinatorJournalRecovery = {
  events: CoordinatorJournalEvent[];
  idempotency: CoordinatorJournalIdempotency[];
};

export type CoordinatorJournalAppend = {
  namespace: string;
  caseId: string;
  /** Constructor-derived configuration identity; callers cannot choose it. */
  optionsFingerprint: string;
  expectedCaseVersion: number;
  idempotencyKey: string;
  fingerprint: string;
  events: CoordinatorJournalEvent[];
  receipt: CommandReceipt;
};

export type CoordinatorJournalPort = {
  /** Constructor-only hint used by the durable factory; never exposed by the coordinator. */
  readonly namespace?: string;
  recover(input: { namespace: string; caseId: string; optionsFingerprint: string }): CoordinatorJournalRecovery;
  appendAtomic(input: CoordinatorJournalAppend): { status: "appended" | "duplicate"; receipt: CommandReceipt };
  close(): void;
  deleteExactSynthetic(): void;
};

export type DiscussionProjection = {
  schemaVersion: "discussion_projection_v1";
  id: string;
  source: "nostr";
  sourceRef: string;
  sourceReference: SourceReference;
  scope: DiscussionScope;
  content: string;
  event: DiscussionArtifact["event"];
  verificationProof: DiscussionArtifact["verificationProof"];
  authorityBinding: AuthorityBinding;
  provenance: DiscussionArtifact;
  outcomeRef?: { id: string; outcomeChecksum: string };
};

export type SuggestionProjection = {
  schemaVersion: "suggestion_projection_v1";
  id: string;
  discussionId: string;
  discussionRef: SourceReference;
  title: string;
  summary?: string;
  status: "draft" | "admitted";
  signerPubkey?: string;
  admission?: {
    candidateId: string;
    signedEventId: string;
    sourceAnswerReceiptId: string;
    sourceTopicId?: string;
    admissionChecksum: string;
    admittedByActorClass: "case_steward";
  };
  authorityBinding: AuthorityBinding;
  provenance: SourceReference;
};

export type CaseProjection = {
  schemaVersion: "case_projection_v1";
  caseId: string;
  jurisdiction: CaseJurisdiction;
  municipalityId: string;
  sourceScope: DiscussionScope;
  authorityBinding: AuthorityBinding;
  formalDecision: null;
  discussion: DiscussionProjection;
  discussions: DiscussionProjection[];
  suggestion: SuggestionProjection;
  suggestions: SuggestionProjection[];
  provenance: DiscussionArtifact;
  /** One bounded package for Issue #3, visible only to administration until accepted. */
  departmentPackage?: DepartmentPackageProjection;
  /** Canonical Issue #4 package set; private/admin only until a brief is current. */
  departmentPackages?: DepartmentPackageProjection[];
  reviewedCitizenBrief?: ReviewedCitizenBriefProjection;
  participationResult?: AdvisoryParticipationProjection;
  reviewedOutcome?: ReviewedOutcomeProjection;
  councilDryRunBrief?: CouncilDryRunBrief;
};

export type ProjectionEnvelope = {
  schemaVersion: "projection_envelope_v1";
  caseId: string;
  caseVersion: number;
  journalHeadChecksum: string;
  projectionChecksum: string;
  visibility: "public" | "administration" | "council";
  policyVersion: string;
  projection: CaseProjection;
};

export type CivicCaseCoordinator = {
  handle(command: CommandEnvelope): CommandReceipt;
  project(query: QueryEnvelope): ProjectionEnvelope;
};

export type CivicCaseCoordinatorOptions = {
  /** Source scope used to bind municipality/case tags on the NIP-01 event. */
  scope?: DiscussionScope;
  municipalityId?: string;
  sourceCaseId?: string;
  /** Alias for canonicalCaseId; retained for callers that name the Case ID directly. */
  caseId?: string;
  /** Fixed test jurisdiction value used in the canonical Case ID. */
  jurisdictionValue?: string;
  jurisdiction?: Partial<CaseJurisdiction> & { value?: string };
  /** A pinned UUID-v7. Random UUID generation is deliberately unavailable. */
  uuidV7?: string;
  caseUuidV7?: string;
  canonicalCaseId?: string;
  /** The first release uses one policy version for all commands/queries. */
  policyVersion?: string;
  actors?: readonly ActorRegistration[];
  actorRegistry?: readonly ActorRegistration[] | Readonly<Record<string, ActorRegistration>>;
  syntheticFixtureOnly?: boolean;
  allowedKinds?: readonly number[];
  allowedSignerPubkeys?: readonly string[];
  /** Public Mecky identities accepted for a topic-to-Case admission. */
  allowedAgentPubkeys?: readonly string[];
  fixturePubkey?: string;
  fixtureSignerPubkey?: string;
  /** Issue #4 synthetic fixture: exactly eight unique departments when configured. */
  requiredDepartmentIds?: readonly string[];
  /** When true, department work cannot start before a steward admits a citizen signature. */
  requireSignedSuggestionAdmission?: boolean;
  /** Internal constructor-only journal port used by the durable Adapter. */
  journalPort?: CoordinatorJournalPort;
  journalNamespace?: string;
  [key: string]: unknown;
};

export type CivicCaseCoordinatorConfig = CivicCaseCoordinatorOptions;
export type CaseEvent = CaseEventV1;

type InternalCoordinatorOptions = {
  scope?: DiscussionScope;
  jurisdiction: CaseJurisdiction;
  caseId: string;
  policyVersion: string;
  actors: ReadonlyMap<string, ActorRegistration>;
  syntheticFixtureOnly: boolean;
  allowedKinds: readonly number[];
  allowedSignerPubkeys?: ReadonlySet<string>;
  allowedAgentPubkeys?: ReadonlySet<string>;
  requiredDepartmentIds?: readonly string[];
  requireSignedSuggestionAdmission: boolean;
};

type JournalState = {
  events: StoredCaseEvent[];
  headChecksum: string;
};

type CaseCreatedPayload = {
  caseId: string;
  jurisdiction: CaseJurisdiction;
  authorityBinding: AuthorityBinding;
};

type DiscussionRecordedPayload = {
  discussion: DiscussionArtifact;
  suggestion: {
    id: string;
    discussionId: string;
    title: string;
    authorityBinding: AuthorityBinding;
  };
  authorityBinding: AuthorityBinding;
};

type SignedSuggestionAdmissionPayload = {
  signedSuggestion: CitizenSignedSuggestionV1;
  admissionChecksum: string;
  policyVersion: string;
  authorityBinding: AuthorityBinding;
};

type SignedTopicSuggestionAdmissionPayload = {
  signedSuggestion: CitizenSignedTopicSuggestionV1;
  sourceAnswer: NostrEvent;
  admissionChecksum: string;
  policyVersion: string;
  authorityBinding: AuthorityBinding;
};

type AnySignedSuggestionAdmissionPayload =
  | SignedSuggestionAdmissionPayload
  | SignedTopicSuggestionAdmissionPayload;

type DepartmentPackagePayload = {
  departmentPackage: DepartmentPackageInput;
  packageChecksum: string;
  authorityBinding: AuthorityBinding;
};

type DepartmentDraftPayload = {
  packageId: string;
  packageChecksum: string;
  draft: DepartmentDraftInput;
  draftArtifactChecksum: string;
  authorityBinding: AuthorityBinding;
};

type DepartmentReviewPayload = {
  review: DepartmentReviewInput;
  policyVersion: string;
  attestationChecksum: string;
  authorityBinding: AuthorityBinding;
};

type CitizenBriefPayload = {
  brief: ReviewedCitizenBriefProjection;
  sourceBindings: BriefSourceBinding[];
  briefChecksum: string;
  policyVersion: string;
  authorityBinding: AuthorityBinding;
};

type DepartmentDraftCorrectionPayload = {
  packageId: string;
  packageChecksum: string;
  priorDraftArtifactChecksum: string;
  draft: DepartmentDraftInput;
  draftArtifactChecksum: string;
  authorityBinding: AuthorityBinding;
};

type DepartmentRetractionPayload = {
  retraction: DepartmentRetractionInput;
  authorityBinding: AuthorityBinding;
};

type AdvisoryParticipationSourceBinding = {
  id: string;
  briefChecksum: string;
  briefEventId: string;
};

type AdvisoryParticipationPayload = {
  participation: ParticipationResultInput;
  sourceBrief: AdvisoryParticipationSourceBinding;
  policyVersion: string;
  reviewerActorBinding: ActorBinding;
  reviewAttestationChecksum: string;
  authorityBinding: AuthorityBinding;
};

type AdvisoryParticipationRetractionPayload = {
  retraction: {
    participationId: string;
    participationChecksum: string;
  };
  authorityBinding: AuthorityBinding;
};

type ReviewedOutcomePayload = {
  outcome: ReviewedOutcomeProjection;
  policyVersion: string;
  authorityBinding: AuthorityBinding;
};

type StoredCaseEvent = CaseEventV1 & {
  /** Immutable payload retained only behind the coordinator seam. */
  payload:
    | CaseCreatedPayload
    | DiscussionRecordedPayload
    | SignedSuggestionAdmissionPayload
    | SignedTopicSuggestionAdmissionPayload
    | DepartmentPackagePayload
    | DepartmentDraftPayload
    | DepartmentReviewPayload
    | CitizenBriefPayload
    | DepartmentDraftCorrectionPayload
    | DepartmentRetractionPayload
    | AdvisoryParticipationPayload
    | AdvisoryParticipationRetractionPayload
    | ReviewedOutcomePayload;
};

export type DepartmentPackageProjection = {
  schemaVersion: "department_package_projection_v1";
  id: string;
  departmentId: string;
  suggestionId: string;
  request: string;
  packageChecksum: string;
  assignedAgentActorId?: string;
  assignedReviewerActorId?: string;
  draft?: {
    schemaVersion: "department_draft_projection_v1";
    id: string;
    publicSummary: string;
    publicCitations: string[];
    privateEvidenceRefs?: string[];
    artifactChecksum: string;
    actorId?: string;
  };
  reviewState: "assigned" | "draft_pending_review" | "accepted" | "rejected";
  correctionState: "current" | "corrected" | "retracted";
  review?: {
    decision: "accepted" | "rejected";
    draftArtifactChecksum: string;
    reviewedAt: string;
    policyVersion: string;
    attestationChecksum?: string;
    reviewerActorId?: string;
  };
  artifactChecksum?: string;
  reviewedAt?: string;
  policyVersion?: string;
  publicSummary?: string;
  publicCitations?: string[];
  authorityBinding: AuthorityBinding;
};

export type ReviewedCitizenBriefProjection = {
  schemaVersion: "citizen_brief_projection_v1";
  id: string;
  title: string;
  summary: string;
  responses: Array<{
    departmentId: string;
    publicSummary: string;
    publicCitations: string[];
  }>;
  provenance: {
    sourceDiscussionRef: SourceReference;
    suggestionId: string;
    packageBindings: Array<BriefSourceBinding & {
      departmentId: string;
      reviewedAt: string;
    }>;
  };
  briefChecksum: string;
  policyVersion: string;
  correctionState: "current" | "invalidated";
  authorityBinding: AuthorityBinding;
};

export type AdvisoryParticipationProjection = Omit<ParticipationResultInput, "correctionState"> & {
  correctionState: "current" | "invalidated" | "retracted";
  advisory: true;
  sourceBrief?: {
    id: string;
    briefChecksum: string;
    briefEventId: string;
  };
  reviewerActorBinding?: ActorBinding;
  reviewAttestationChecksum?: string;
};

export type ReviewedOutcomeProjection = Omit<ReviewedOutcomeInput, "schemaVersion"> & {
  schemaVersion: "reviewed_outcome_projection_v1";
  outcomeChecksum: string;
  correctionState: "current";
  advisory: true;
  formalDecision: null;
  externalPublication: false;
};

export type CouncilDryRunBrief = {
  schemaVersion: "council_dry_run_brief_v1";
  state: "dry_run_not_submitted";
  authorityBinding: AuthorityBinding;
  summary: string;
  citizenSignal: ParticipationResultInput | null;
  reviewedDepartmentResponseCount: number;
  formalDecision: null;
  councilSubmissionCreated: false;
  formalVoteStarted: false;
  publicWrite: false;
};

const COMMAND_KEYS = new Set([
  "schemaVersion",
  "commandType",
  "caseId",
  "actorBinding",
  "expectedCaseVersion",
  "idempotencyKey",
  "visibility",
  "policyVersion",
  "payload",
]);
const QUERY_KEYS = new Set([
  "schemaVersion",
  "queryType",
  "caseId",
  "actorBinding",
  "visibility",
  "policyVersion",
  "atCaseVersion",
]);
const PAYLOAD_KEYS = new Set(["discussion"]);
const SIGNED_SUGGESTION_PAYLOAD_KEYS = new Set(["signedSuggestion"]);
const SIGNED_TOPIC_SUGGESTION_PAYLOAD_KEYS = new Set([
  "sourceDiscussion",
  "sourceAnswer",
  "signedSuggestion",
]);
const PACKAGE_PAYLOAD_KEYS = new Set(["departmentPackage"]);
const DRAFT_PAYLOAD_KEYS = new Set(["packageId", "packageChecksum", "draft"]);
const REVIEW_PAYLOAD_KEYS = new Set(["review"]);
const BRIEF_PAYLOAD_KEYS = new Set(["brief"]);
const CORRECTION_PAYLOAD_KEYS = new Set(["packageId", "packageChecksum", "priorDraftArtifactChecksum", "draft"]);
const RETRACTION_PAYLOAD_KEYS = new Set(["retraction"]);
const PARTICIPATION_PAYLOAD_KEYS = new Set(["participation", "sourceBrief"]);
const PARTICIPATION_RETRACTION_PAYLOAD_KEYS = new Set(["retraction"]);
const OUTCOME_PAYLOAD_KEYS = new Set(["outcome"]);
const ACTOR_KEYS = new Set(["actorId", "actorClass"]);
const ACTOR_REGISTRATION_KEYS = new Set(["actorId", "actorClass", "departmentId"]);
const DEPARTMENT_PACKAGE_KEYS = new Set([
  "id",
  "departmentId",
  "suggestionId",
  "request",
  "assignedAgentActorId",
  "assignedReviewerActorId",
  "authorityBinding",
]);
const DEPARTMENT_DRAFT_KEYS = new Set([
  "schemaVersion",
  "id",
  "publicSummary",
  "publicCitations",
  "privateEvidenceRefs",
  "authorityBinding",
]);
const DEPARTMENT_REVIEW_KEYS = new Set(["packageId", "draftArtifactChecksum", "decision", "reviewedAt"]);
const BRIEF_KEYS = new Set(["id", "sourceBindings", "authorityBinding"]);
const SOURCE_BINDING_KEYS = new Set(["packageId", "packageChecksum", "draftArtifactChecksum", "reviewAttestationChecksum"]);
const RETRACTION_KEYS = new Set(["packageId", "packageChecksum", "targetDraftArtifactChecksum", "targetReviewAttestationChecksum"]);
const PARTICIPATION_KEYS = new Set([
  "schemaVersion",
  "id",
  "contractId",
  "contractVersion",
  "methodKind",
  "methodVersion",
  "ruleId",
  "ruleVersion",
  "authorityBinding",
  "question",
  "options",
  "totalAccepted",
  "resultSummary",
  "unresolvedDissent",
  "representationAudit",
  "limitations",
  "openedAt",
  "closedAt",
  "reviewedAt",
  "resultArtifactRef",
  "minorityReportRef",
  "correctionState",
  "checksum",
]);
const PARTICIPATION_OPTION_KEYS = new Set(["optionId", "label", "aggregateCount"]);
const REPRESENTATION_AUDIT_KEYS = new Set([
  "targetPopulationDescription",
  "recruitmentMethod",
  "samplingMethod",
  "totalInvited",
  "totalStarted",
  "totalCompleted",
  "limitations",
]);
const SOURCE_BRIEF_KEYS = new Set(["id", "briefChecksum"]);
const PARTICIPATION_RETRACTION_KEYS = new Set(["participationId", "participationChecksum"]);
const OUTCOME_KEYS = new Set([
  "schemaVersion",
  "id",
  "summary",
  "resultArtifactRef",
  "reviewedAt",
  "sourceDiscussionRef",
  "sourceBrief",
  "sourceParticipation",
  "publicationTarget",
  "authorityBinding",
]);
const SOURCE_REFERENCE_KEYS = new Set(["type", "id", "ref"]);
const OUTCOME_PARTICIPATION_KEYS = new Set(["id", "participationChecksum"]);
const ARTIFACT_KEYS = new Set([
  "schemaVersion",
  "id",
  "source",
  "sourceRef",
  "municipalityId",
  "caseId",
  "authorityBinding",
  "verificationProof",
  "event",
]);
const PROOF_KEYS = new Set(["kind", "verified", "signature"]);
const EVENT_KEYS = new Set([
  "id",
  "pubkey",
  "createdAt",
  "kind",
  "content",
  "tags",
  "relayRefs",
]);
const SCOPE_KEYS = new Set(["municipalityId", "caseId"]);
const SIGNED_SUGGESTION_KEYS = new Set([
  "schemaVersion",
  "candidateId",
  "signerPubkey",
  "draft",
  "event",
  "verification",
  "entryState",
  "authorityBinding",
  "submittedToCivicWorkflow",
]);
const SIGNED_SUGGESTION_DRAFT_KEYS = new Set([
  "schemaVersion",
  "draftId",
  "sourceAnswerReceiptId",
  "sourceDiscussionId",
  "sourceDiscussionRef",
  "municipalityId",
  "sourceCaseId",
  "caseId",
  "citizenPubkey",
  "title",
  "summary",
  "entryState",
  "authorityBinding",
  "submittedToCivicWorkflow",
]);
const SIGNED_SUGGESTION_EVENT_KEYS = new Set([
  "id",
  "pubkey",
  "createdAt",
  "kind",
  "tags",
  "content",
  "signature",
]);
const SIGNED_SUGGESTION_VERIFICATION_KEYS = new Set(["kind", "verified"]);

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CASE_ID = /^urn:stadtstack:case:test:([A-Za-z0-9._~-]+):([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SECRET_MARKER = /(?:nsec1|private[_ -]?key|secret[_ -]?key|password|credential|token|wallet|ballot|participant[_ -]?id|user[_ -]?id)/i;
const SECRET_VALUE_MARKER = /(?:\bnsec1[a-z0-9-]{8,}\b|private[_ -]?key|secret[_ -]?key|password\s*[:=]|credential\s*[:=]|wallet\s*[:=]|ballot\s*[:=])/i;
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const PARTICIPATION_VALUE_MARKER = /(?:\b(?:npub|nsec)1[a-z0-9-]{8,}\b|\b0x[a-f0-9]{40}\b|\b(?:ballot|eligibility|identity|wallet|credential)\b|\b(?:participant|account|user)(?:[_ -]?id)?\s*[:=]|\b(?:private[_ -]?key|prompt|reasoning|tool[_ -]?trace)\b)/i;
const SYNTHETIC_REFERENCE = /^synthetic:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]{1,2040}$/;
const DETERMINISTIC_PARTICIPATION_REVIEWED_AT = "2026-08-08T00:00:05.000Z";

/** Deterministic fixture UUID-v7. It is intentionally not generated at runtime. */
export const DEFAULT_SYNTHETIC_UUID_V7 = "018f0000-0000-7000-8000-000000000001";
export const CASE_EVENT_SCHEMA_VERSION = "case_event_v1" as const;
export const COMMAND_ENVELOPE_SCHEMA_VERSION = "command_envelope_v1" as const;
export const QUERY_ENVELOPE_SCHEMA_VERSION = "query_envelope_v1" as const;
export const PROJECTION_ENVELOPE_SCHEMA_VERSION = "projection_envelope_v1" as const;
export const DETERMINISTIC_OUTCOME_REVIEWED_AT = "2026-08-10T00:00:00.000Z";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(code: string): never {
  throw new Error(code);
}

function ownKeys(value: unknown, allowed: ReadonlySet<string>, path: string): void {
  if (!isRecord(value)) fail(`${path}_invalid`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      fail(`unknown_field:${path}.${String(key)}`);
    }
    if (SECRET_MARKER.test(key)) {
      fail(`private_field_forbidden:${path}.${key}`);
    }
  }
}

function nonEmptyString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(code);
  if (SECRET_MARKER.test(value)) fail(`secret_material_forbidden:${code}`);
  return value.trim();
}

function safeInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail(code);
  return value as number;
}

function canonicalize(value: unknown, path = "value"): unknown {
  if (value === undefined) fail(`canonical_value_invalid:${path}`);
  if (typeof value === "symbol" || typeof value === "function") {
    fail(`canonical_value_invalid:${path}`);
  }
  if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) {
    fail(`canonical_value_invalid:${path}`);
  }
  if (typeof value === "bigint") fail(`canonical_value_invalid:${path}`);
  if (Array.isArray(value)) return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail(`canonical_value_invalid:${path}.[symbol]`);
    result[key] = canonicalize(value[key], `${path}.${key}`);
  }
  return Object.fromEntries(Object.keys(result).sort().map((key) => [key, result[key]]));
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function scopesEqual(left: DiscussionScope, right: DiscussionScope): boolean {
  return left.municipalityId === right.municipalityId && left.caseId === right.caseId;
}

function normalizeScope(value: unknown, code = "discussion_scope_missing"): DiscussionScope {
  ownKeys(value, SCOPE_KEYS, "scope");
  const municipalityId = nonEmptyString((value as Record<string, unknown>).municipalityId, code);
  const caseId = nonEmptyString((value as Record<string, unknown>).caseId, code);
  return { municipalityId, caseId };
}

function normalizeActor(value: unknown, code = "actor_binding_required"): ActorBinding {
  ownKeys(value, ACTOR_KEYS, "actorBinding");
  const actor = value as Record<string, unknown>;
  const actorId = nonEmptyString(actor.actorId, code);
  const actorClass = actor.actorClass;
  if (
    actorClass !== "citizen" &&
    actorClass !== "public" &&
    actorClass !== "administration" &&
    actorClass !== "council" &&
    actorClass !== "case_steward" &&
    actorClass !== "department_agent" &&
    actorClass !== "department_reviewer" &&
    actorClass !== "participation_reviewer"
  ) {
    fail("actor_role_self_assertion");
  }
  return { actorId, actorClass: actorClass as ActorClass };
}

function normalizeActorRegistration(value: unknown): ActorRegistration {
  ownKeys(value, ACTOR_REGISTRATION_KEYS, "actorRegistry");
  if (!isRecord(value)) fail("actor_registry_invalid");
  const actor = normalizeActor({ actorId: value.actorId, actorClass: value.actorClass }, "actor_registry_invalid");
  const departmentId = value.departmentId;
  if (actor.actorClass === "department_agent" || actor.actorClass === "department_reviewer") {
    if (departmentId === undefined) fail("actor_registry_invalid");
    return { ...actor, departmentId: nonEmptyString(departmentId, "actor_registry_invalid") };
  }
  if (departmentId !== undefined) fail("actor_registry_invalid");
  return actor;
}

function normalizeArtifactShape(value: unknown): DiscussionArtifact {
  ownKeys(value, ARTIFACT_KEYS, "discussion");
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== "discussion_artifact_v1") fail("discussion_proof_invalid");
  if (input.source !== "nostr") fail("discussion_proof_invalid");
  if (input.authorityBinding !== "none") fail("authority_field_forbidden:discussion.authorityBinding");
  const id = nonEmptyString(input.id, "discussion_proof_invalid");
  const sourceRef = nonEmptyString(input.sourceRef, "discussion_proof_invalid");
  const municipalityId = nonEmptyString(input.municipalityId, "discussion_scope_missing");
  const caseId = nonEmptyString(input.caseId, "discussion_scope_missing");
  if (!isRecord(input.verificationProof)) fail("discussion_proof_invalid");
  ownKeys(input.verificationProof, PROOF_KEYS, "discussion.verificationProof");
  const proof = input.verificationProof;
  if (proof.kind !== "nostr_nip01" || proof.verified !== true) fail("discussion_proof_invalid");
  const signature = nonEmptyString(proof.signature, "discussion_signature_required");
  if (!isRecord(input.event)) fail("discussion_event_invalid");
  ownKeys(input.event, EVENT_KEYS, "discussion.event");
  const event = input.event;
  const eventId = nonEmptyString(event.id, "discussion_event_invalid");
  const pubkey = nonEmptyString(event.pubkey, "discussion_event_invalid");
  const createdAt = safeInteger(event.createdAt, "discussion_event_invalid");
  const kind = safeInteger(event.kind, "discussion_event_invalid");
  const content = nonEmptyString(event.content, "discussion_event_invalid");
  if (SECRET_VALUE_MARKER.test(content)) fail("secret_material_forbidden:discussion.event.content");
  if (!Array.isArray(event.tags) || event.tags.some((tag) => !Array.isArray(tag) || (tag as unknown[]).some((part: unknown) => typeof part !== "string"))) {
    fail("discussion_event_invalid");
  }
  if (event.tags.some((tag) => (tag as unknown[]).some((part: unknown) => typeof part === "string" && SECRET_VALUE_MARKER.test(part)))) {
    fail("secret_material_forbidden:discussion.event.tags");
  }
  if (!Array.isArray(event.relayRefs) || event.relayRefs.some((ref) => typeof ref !== "string")) {
    fail("discussion_event_invalid");
  }
  if (event.relayRefs.some((ref) => SECRET_VALUE_MARKER.test(ref))) {
    fail("secret_material_forbidden:discussion.event.relayRefs");
  }
  if (eventId !== id) fail("discussion_proof_invalid");
  if (!sourceRef.startsWith("nostr://event/")) fail("discussion_proof_invalid");
  return {
    schemaVersion: "discussion_artifact_v1",
    id,
    source: "nostr",
    sourceRef,
    municipalityId,
    caseId,
    authorityBinding: "none",
    verificationProof: {
      kind: "nostr_nip01",
      verified: true,
      signature,
    },
    event: {
      id: eventId,
      pubkey,
      createdAt,
      kind,
      content,
      tags: event.tags.map((tag) => [...tag] as string[]),
      relayRefs: [...event.relayRefs],
    },
  };
}

function artifactToNip01Event(artifact: DiscussionArtifact): NostrEvent {
  const event = artifact.event;
  if (artifact.verificationProof.kind !== "nostr_nip01") fail("discussion_proof_invalid");
  return {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.createdAt,
    kind: event.kind,
    tags: event.tags.map((tag) => [...tag]),
    content: event.content,
    sig: artifact.verificationProof.signature,
  };
}

function normalizeOptions(options: CivicCaseCoordinatorOptions = {}): InternalCoordinatorOptions {
  ownKeys(options, new Set([
    "scope",
    "municipalityId",
    "sourceCaseId",
    "caseId",
    "jurisdictionValue",
    "jurisdiction",
    "uuidV7",
    "caseUuidV7",
    "canonicalCaseId",
    "policyVersion",
    "actors",
    "actorRegistry",
    "syntheticFixtureOnly",
    "allowedKinds",
    "allowedSignerPubkeys",
    "allowedAgentPubkeys",
    "fixturePubkey",
    "fixtureSignerPubkey",
    "requiredDepartmentIds",
    "requireSignedSuggestionAdmission",
    "journalPort",
    "journalNamespace",
  ]), "options");

  const rawScope = options.scope ?? (
    options.municipalityId !== undefined || options.sourceCaseId !== undefined
      ? {
          municipalityId: options.municipalityId,
          caseId: options.sourceCaseId,
        }
      : undefined
  );
  const scope = rawScope === undefined ? undefined : normalizeScope(rawScope, "scope_required");
  if (options.municipalityId !== undefined && scope && options.municipalityId !== scope.municipalityId) fail("scope_invalid");
  const jurisdictionObject = options.jurisdiction;
  if (jurisdictionObject !== undefined) {
    if (!isRecord(jurisdictionObject)) fail("jurisdiction_invalid");
    ownKeys(jurisdictionObject, new Set(["scheme", "value"]), "jurisdiction");
    if (jurisdictionObject.scheme !== undefined && jurisdictionObject.scheme !== "test") fail("synthetic_case_namespace_forbidden");
  }
  const jurisdictionValue = nonEmptyString(
    options.jurisdictionValue ?? jurisdictionObject?.value ?? scope?.municipalityId ?? "synthetic",
    "jurisdiction_value_required",
  );
  if (!/^[A-Za-z0-9._~-]+$/.test(jurisdictionValue)) fail("jurisdiction_value_invalid");
  const jurisdiction: CaseJurisdiction = { scheme: "test", value: jurisdictionValue };
  const configuredUuid = options.uuidV7 ?? options.caseUuidV7 ?? DEFAULT_SYNTHETIC_UUID_V7;
  if (typeof configuredUuid !== "string" || !UUID_V7.test(configuredUuid)) fail("case_id_invalid");
  const derivedCaseId = `urn:stadtstack:case:test:${jurisdiction.value}:${configuredUuid}`;
  const configuredCaseId = options.canonicalCaseId ?? options.caseId ?? derivedCaseId;
  if (typeof configuredCaseId !== "string" || !CASE_ID.test(configuredCaseId) || configuredCaseId !== derivedCaseId) {
    fail("case_id_invalid");
  }
  const policyVersion = nonEmptyString(options.policyVersion ?? "case-intake-v1", "policy_version_invalid");
  let requiredDepartmentIds: string[] | undefined;
  if (options.requiredDepartmentIds !== undefined) {
    if (!Array.isArray(options.requiredDepartmentIds) || options.requiredDepartmentIds.length !== 8) {
      fail("required_departments_invalid");
    }
    requiredDepartmentIds = options.requiredDepartmentIds.map((departmentId) => {
      const normalized = nonEmptyString(departmentId, "required_departments_invalid");
      if (normalized.length > 256) fail("required_departments_invalid");
      if (!/^[A-Za-z0-9._~-]+$/.test(normalized)) fail("required_departments_invalid");
      return normalized;
    });
    if (new Set(requiredDepartmentIds).size !== requiredDepartmentIds.length) fail("required_departments_unique");
    requiredDepartmentIds.sort();
  }
  const actorValues = options.actors ?? options.actorRegistry ?? [
    { actorId: "synthetic:citizen-1", actorClass: "citizen" },
    { actorId: "synthetic:public-1", actorClass: "public" },
    { actorId: "synthetic:administration-1", actorClass: "administration" },
    { actorId: "synthetic:council-1", actorClass: "council" },
  ];
  const actorList = Array.isArray(actorValues) ? actorValues : Object.values(actorValues);
  if (actorList.length === 0) fail("actor_registry_required");
  const actors = new Map<string, ActorRegistration>();
  for (const actor of actorList) {
    const normalized = normalizeActorRegistration(actor);
    if (actors.has(normalized.actorId)) fail("actor_registry_unique");
    actors.set(normalized.actorId, normalized);
  }
  if (requiredDepartmentIds) {
    for (const departmentId of requiredDepartmentIds) {
      const hasAgent = [...actors.values()].some(
        (actor) => actor.actorClass === "department_agent" && actor.departmentId === departmentId,
      );
      const hasReviewer = [...actors.values()].some(
        (actor) => actor.actorClass === "department_reviewer" && actor.departmentId === departmentId,
      );
      if (!hasAgent || !hasReviewer) fail("department_registry_incomplete");
    }
  }
  if (options.syntheticFixtureOnly === false) fail("synthetic_fixture_required");
  if (
    options.requireSignedSuggestionAdmission !== undefined &&
    typeof options.requireSignedSuggestionAdmission !== "boolean"
  ) fail("signed_suggestion_admission_option_invalid");
  const allowedKinds = options.allowedKinds ?? [1];
  if (!Array.isArray(allowedKinds) || allowedKinds.length !== 1 || allowedKinds[0] !== 1) fail("discussion_kind_forbidden");
  const configuredPubkeys = options.allowedSignerPubkeys ?? (
    options.fixturePubkey === undefined && options.fixtureSignerPubkey === undefined
      ? undefined
      : [options.fixturePubkey ?? options.fixtureSignerPubkey!]
  );
  let allowedSignerPubkeys: ReadonlySet<string> | undefined;
  if (configuredPubkeys !== undefined) {
    if (!Array.isArray(configuredPubkeys) || configuredPubkeys.length === 0) fail("discussion_signer_not_allowed");
    const normalizedPubkeys = configuredPubkeys.map((pubkey) => nonEmptyString(pubkey, "discussion_signer_not_allowed"));
    if (normalizedPubkeys.some((pubkey) => !/^[0-9a-f]{64}$/.test(pubkey))) fail("discussion_signer_not_allowed");
    allowedSignerPubkeys = new Set(normalizedPubkeys);
  }
  let allowedAgentPubkeys: ReadonlySet<string> | undefined;
  if (options.allowedAgentPubkeys !== undefined) {
    if (
      !Array.isArray(options.allowedAgentPubkeys) ||
      options.allowedAgentPubkeys.length === 0
    ) {
      fail("topic_suggestion_agent_registry_invalid");
    }
    const normalizedAgentPubkeys = options.allowedAgentPubkeys.map((pubkey) =>
      nonEmptyString(pubkey, "topic_suggestion_agent_registry_invalid"),
    );
    if (
      normalizedAgentPubkeys.some((pubkey) => !/^[0-9a-f]{64}$/.test(pubkey)) ||
      new Set(normalizedAgentPubkeys).size !== normalizedAgentPubkeys.length
    ) {
      fail("topic_suggestion_agent_registry_invalid");
    }
    allowedAgentPubkeys = new Set(normalizedAgentPubkeys);
  }
  return {
    scope,
    jurisdiction,
    caseId: configuredCaseId,
    policyVersion,
    actors,
    syntheticFixtureOnly: true,
    allowedKinds: [...allowedKinds],
    allowedSignerPubkeys,
    allowedAgentPubkeys,
    requiredDepartmentIds,
    requireSignedSuggestionAdmission: options.requireSignedSuggestionAdmission === true,
  };
}

function genesisChecksum(caseId: string): string {
  return sha256({ schemaVersion: "case_genesis_v1", caseId });
}

function durableOptionsFingerprint(options: InternalCoordinatorOptions): string {
  return sha256({
    caseId: options.caseId,
    policyVersion: options.policyVersion,
    jurisdiction: options.jurisdiction,
    scope: options.scope ?? null,
    syntheticFixtureOnly: options.syntheticFixtureOnly,
    allowedKinds: options.allowedKinds,
    allowedSignerPubkeys: options.allowedSignerPubkeys ? [...options.allowedSignerPubkeys].sort() : null,
    allowedAgentPubkeys: options.allowedAgentPubkeys ? [...options.allowedAgentPubkeys].sort() : null,
    requiredDepartmentIds: options.requiredDepartmentIds ?? null,
    requireSignedSuggestionAdmission: options.requireSignedSuggestionAdmission,
    actors: [...options.actors.values()].map((actor) => ({ actorId: actor.actorId, actorClass: actor.actorClass, departmentId: actor.departmentId ?? null })).sort((left, right) => left.actorId.localeCompare(right.actorId)),
  });
}

function appendEvent(
  state: JournalState,
  options: InternalCoordinatorOptions,
  actorBinding: ActorBinding,
  eventType: CaseEventV1["eventType"],
  payload: unknown,
  correctionOf: string | null = null,
): StoredCaseEvent {
  const caseVersion = state.events.length + 1;
  const priorEventChecksum = state.events.length === 0
    ? genesisChecksum(options.caseId)
    : state.headChecksum;
  const payloadChecksum = sha256(payload);
  const eventWithoutChecksum = {
    schemaVersion: CASE_EVENT_SCHEMA_VERSION,
    eventId: `urn:stadtstack:case-event:${options.caseId}:${caseVersion}`,
    caseId: options.caseId,
    caseVersion,
    eventType,
    priorEventChecksum,
    actorBinding,
    payloadChecksum,
    correctionOf,
  } as const;
  const event: StoredCaseEvent = {
    ...eventWithoutChecksum,
    eventChecksum: sha256(eventWithoutChecksum),
    payload: clone(payload) as StoredCaseEvent["payload"],
  };
  state.events.push(event);
  state.headChecksum = event.eventChecksum;
  return clone(event);
}

const PRIVATE_DEPARTMENT_VALUE_MARKER = /(?:\bnsec1[a-z0-9-]{8,}\b|\bnpub1[a-z0-9-]{8,}\b|\b0x[a-f0-9]{40,}\b|private[_ -]?key|secret[_ -]?key|password|credential|wallet|ballot|participant[_ -]?id|employee|prompt|reasoning|tool[_ -]?trace|user[_ -]?id)/i;
export const DETERMINISTIC_REVIEWED_AT = "2026-08-08T00:00:05.000Z";

function departmentSafeString(value: unknown, code: string): string {
  const result = nonEmptyString(value, code);
  if (PRIVATE_DEPARTMENT_VALUE_MARKER.test(result)) fail(`private_field_forbidden:${code}`);
  return result;
}

function boundedDepartmentString(value: unknown, code: string, limit: number): string {
  const result = departmentSafeString(value, code);
  if (result.length > limit) fail(`department_value_too_large:${code}`);
  return result;
}

function normalizeDepartmentPackage(value: unknown): DepartmentPackageInput {
  ownKeys(value, DEPARTMENT_PACKAGE_KEYS, "departmentPackage");
  if (!isRecord(value)) fail("department_package_invalid");
  const result: DepartmentPackageInput = {
    id: boundedDepartmentString(value.id, "department_package_invalid", 512),
    departmentId: boundedDepartmentString(value.departmentId, "department_package_invalid", 256),
    suggestionId: boundedDepartmentString(value.suggestionId, "department_package_invalid", 512),
    request: boundedDepartmentString(value.request, "department_package_invalid", 4000),
    assignedAgentActorId: boundedDepartmentString(value.assignedAgentActorId, "department_package_invalid", 256),
    assignedReviewerActorId: boundedDepartmentString(value.assignedReviewerActorId, "department_package_invalid", 256),
    authorityBinding: value.authorityBinding === "none" ? "none" : fail("authority_field_forbidden:departmentPackage.authorityBinding"),
  };
  if (!result.suggestionId.startsWith("urn:stadtstack:suggestion:")) fail("department_suggestion_invalid");
  if (result.assignedAgentActorId === result.assignedReviewerActorId) fail("department_reviewer_not_distinct");
  return result;
}

function normalizeDepartmentDraft(value: unknown): DepartmentDraftInput {
  ownKeys(value, DEPARTMENT_DRAFT_KEYS, "draft");
  if (!isRecord(value)) fail("department_draft_invalid");
  if (value.schemaVersion !== "department_draft_v1") fail("department_draft_schema_invalid");
  if (value.authorityBinding !== "none") fail("authority_field_forbidden:draft.authorityBinding");
  const citations = value.publicCitations;
  const privateRefs = value.privateEvidenceRefs;
  if (!Array.isArray(citations) || citations.some((item) => typeof item !== "string")) fail("department_draft_invalid");
  if (!Array.isArray(privateRefs) || privateRefs.some((item) => typeof item !== "string")) fail("department_draft_invalid");
  if (citations.length > 64 || privateRefs.length > 64) fail("department_draft_too_large");
  const publicCitations = citations.map((item) => boundedDepartmentString(item, "department_draft_invalid", 2048));
  const privateEvidenceRefs = privateRefs.map((item) => boundedDepartmentString(item, "department_draft_invalid", 2048));
  if (publicCitations.some((item) => item.trim() === "") || privateEvidenceRefs.some((item) => item.trim() === "")) {
    fail("department_draft_invalid");
  }
  const referencePattern = /^synthetic:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]{1,2040}$/;
  if (publicCitations.some((item) => !referencePattern.test(item)) || privateEvidenceRefs.some((item) => !referencePattern.test(item))) {
    fail("department_reference_invalid");
  }
  return {
    schemaVersion: "department_draft_v1",
    id: boundedDepartmentString(value.id, "department_draft_invalid", 512),
    publicSummary: boundedDepartmentString(value.publicSummary, "department_draft_invalid", 4000),
    publicCitations,
    privateEvidenceRefs,
    authorityBinding: "none",
  };
}

function normalizeDepartmentReview(value: unknown): DepartmentReviewInput {
  ownKeys(value, DEPARTMENT_REVIEW_KEYS, "review");
  if (!isRecord(value)) fail("department_review_invalid");
  const reviewedAt = value.reviewedAt;
  if (typeof reviewedAt !== "string" || !RFC3339_UTC.test(reviewedAt) || reviewedAt !== DETERMINISTIC_REVIEWED_AT) {
    fail("department_review_time_invalid");
  }
  if (value.decision !== "accepted" && value.decision !== "rejected") fail("department_review_decision_invalid");
  const draftArtifactChecksum = nonEmptyString(value.draftArtifactChecksum, "department_review_invalid");
  if (!SHA256.test(draftArtifactChecksum)) fail("department_review_checksum_invalid");
  return {
    packageId: nonEmptyString(value.packageId, "department_review_invalid"),
    draftArtifactChecksum,
    decision: value.decision,
    reviewedAt,
  };
}

function participationString(value: unknown, code: string, limit = 4000): string {
  const normalized = nonEmptyString(value, code);
  if (normalized.length > limit) fail(`participation_value_too_large:${code}`);
  if (PARTICIPATION_VALUE_MARKER.test(normalized)) fail(`raw_participation_data_forbidden:${code}`);
  return normalized;
}

function participationStringArray(value: unknown, code: string, limit = 64): string[] {
  if (!Array.isArray(value) || value.length > limit || value.some((item) => typeof item !== "string")) {
    fail(`participation_result_shape_invalid:${code}`);
  }
  return value.map((item) => participationString(item, code, 2048)).sort();
}

function participationCount(value: unknown, code: string): number {
  const result = safeInteger(value, code);
  if (result < 0) fail(`participation_count_invalid:${code}`);
  return result;
}

function normalizeParticipationResult(value: unknown): ParticipationResultInput {
  ownKeys(value, PARTICIPATION_KEYS, "participation");
  if (!isRecord(value)) fail("participation_result_shape_invalid:participation");
  if (value.schemaVersion !== "participation_result_v1") fail("participation_result_schema_invalid");
  if (value.authorityBinding !== "none") fail("participation_result_authority_invalid");
  if (value.correctionState !== "current") fail("participation_correction_state_invalid");
  const optionsValue = value.options;
  if (!Array.isArray(optionsValue) || optionsValue.length > 64) fail("participation_result_shape_invalid:options");
  const options = optionsValue.map((option, index) => {
    ownKeys(option, PARTICIPATION_OPTION_KEYS, `participation.options[${index}]`);
    if (!isRecord(option)) fail(`participation_result_shape_invalid:options[${index}]`);
    return {
      optionId: participationString(option.optionId, `participation.options[${index}].optionId`, 256),
      label: participationString(option.label, `participation.options[${index}].label`, 1000),
      aggregateCount: participationCount(option.aggregateCount, `participation.options[${index}].aggregateCount`),
    };
  }).sort((left, right) => left.optionId < right.optionId ? -1 : left.optionId > right.optionId ? 1 : 0);
  if (new Set(options.map((option) => option.optionId)).size !== options.length) fail("participation_option_duplicate");
  ownKeys(value.representationAudit, REPRESENTATION_AUDIT_KEYS, "participation.representationAudit");
  if (!isRecord(value.representationAudit)) fail("participation_result_shape_invalid:representationAudit");
  const audit = value.representationAudit;
  const totalInvited = audit.totalInvited === null ? null : participationCount(audit.totalInvited, "representationAudit.totalInvited");
  const normalizedAudit: ParticipationRepresentationAudit = {
    targetPopulationDescription: participationString(audit.targetPopulationDescription, "representationAudit.targetPopulationDescription"),
    recruitmentMethod: participationString(audit.recruitmentMethod, "representationAudit.recruitmentMethod"),
    samplingMethod: audit.samplingMethod === null ? null : participationString(audit.samplingMethod, "representationAudit.samplingMethod"),
    totalInvited,
    totalStarted: participationCount(audit.totalStarted, "representationAudit.totalStarted"),
    totalCompleted: participationCount(audit.totalCompleted, "representationAudit.totalCompleted"),
    limitations: participationStringArray(audit.limitations, "representationAudit.limitations"),
  };
  if (
    (totalInvited !== null && totalInvited < normalizedAudit.totalStarted) ||
    normalizedAudit.totalCompleted > normalizedAudit.totalStarted
  ) fail("representation_count_inconsistent");
  const contractVersion = participationCount(value.contractVersion, "participation.contractVersion");
  if (contractVersion < 1) fail("participation_version_invalid:contractVersion");
  const totalAccepted = participationCount(value.totalAccepted, "totalAccepted");
  if (normalizedAudit.totalCompleted < totalAccepted) fail("representation_count_inconsistent");
  const aggregateTotal = options.reduce((total, option) => total + option.aggregateCount, 0);
  if (aggregateTotal !== totalAccepted) fail("participation_option_count_inconsistent");
  const timestamps = [value.openedAt, value.closedAt, value.reviewedAt];
  if (timestamps.some((timestamp) => typeof timestamp !== "string" || !RFC3339_UTC.test(timestamp))) fail("participation_timestamp_invalid");
  const timestampMillis = timestamps.map((timestamp) => Date.parse(timestamp as string));
  if (timestampMillis.some((timestamp) => !Number.isFinite(timestamp))) fail("participation_timestamp_invalid");
  if (timestampMillis[0]! > timestampMillis[1]! || timestampMillis[1]! > timestampMillis[2]!) fail("participation_timestamp_order_invalid");
  if (value.reviewedAt !== DETERMINISTIC_PARTICIPATION_REVIEWED_AT) fail("participation_review_time_invalid");
  const resultArtifactRef = participationString(value.resultArtifactRef, "participation.resultArtifactRef", 2048);
  const minorityReportRef = value.minorityReportRef === null ? null : participationString(value.minorityReportRef, "participation.minorityReportRef", 2048);
  if (!SYNTHETIC_REFERENCE.test(resultArtifactRef) || (minorityReportRef !== null && !SYNTHETIC_REFERENCE.test(minorityReportRef))) fail("participation_reference_invalid");
  const checksum = nonEmptyString(value.checksum, "participation_checksum_required");
  if (!SHA256.test(checksum)) fail("participation_checksum_invalid");
  return {
    schemaVersion: "participation_result_v1",
    id: participationString(value.id, "participation.id", 512),
    contractId: participationString(value.contractId, "participation.contractId", 512),
    contractVersion,
    methodKind: participationString(value.methodKind, "participation.methodKind", 256),
    methodVersion: participationString(value.methodVersion, "participation.methodVersion", 256),
    ruleId: participationString(value.ruleId, "participation.ruleId", 256),
    ruleVersion: participationString(value.ruleVersion, "participation.ruleVersion", 256),
    authorityBinding: "none",
    question: participationString(value.question, "participation.question"),
    options,
    totalAccepted,
    resultSummary: participationString(value.resultSummary, "participation.resultSummary"),
    unresolvedDissent: participationStringArray(value.unresolvedDissent, "participation.unresolvedDissent"),
    representationAudit: normalizedAudit,
    limitations: participationStringArray(value.limitations, "participation.limitations"),
    openedAt: timestamps[0] as string,
    closedAt: timestamps[1] as string,
    reviewedAt: timestamps[2] as string,
    resultArtifactRef,
    minorityReportRef,
    correctionState: "current",
    checksum,
  };
}

function participationWithoutChecksum(result: ParticipationResultInput): Omit<ParticipationResultInput, "checksum"> {
  return Object.fromEntries(
    Object.entries(result).filter(([key]) => key !== "checksum"),
  ) as Omit<ParticipationResultInput, "checksum">;
}

function participationChecksumFor(
  result: ParticipationResultInput,
  sourceBrief: AdvisoryParticipationSourceBinding,
  policyVersion: string,
  actorBinding: ActorBinding,
  reviewedAt: string,
): string {
  return sha256({
    participation: participationWithoutChecksum(result),
    sourceBrief,
    policyVersion,
    actorBinding,
    reviewedAt,
  });
}

function participationAttestationChecksumFor(
  participationChecksum: string,
  sourceBrief: AdvisoryParticipationSourceBinding,
  policyVersion: string,
  actorBinding: ActorBinding,
  reviewedAt: string,
): string {
  return sha256({ participationChecksum, sourceBrief, policyVersion, actorBinding, reviewedAt });
}

function normalizeParticipationSourceBrief(value: unknown): { id: string; briefChecksum: string } {
  ownKeys(value, SOURCE_BRIEF_KEYS, "sourceBrief");
  if (!isRecord(value)) fail("participation_source_brief_invalid");
  const id = nonEmptyString(value.id, "participation_source_brief_invalid");
  const briefChecksum = nonEmptyString(value.briefChecksum, "participation_source_brief_invalid");
  if (!SHA256.test(briefChecksum)) fail("participation_source_brief_checksum_invalid");
  return { id, briefChecksum };
}

function normalizeParticipationRetraction(value: unknown): { participationId: string; participationChecksum: string } {
  ownKeys(value, PARTICIPATION_RETRACTION_KEYS, "retraction");
  if (!isRecord(value)) fail("participation_retraction_invalid");
  const participationId = nonEmptyString(value.participationId, "participation_retraction_invalid");
  const participationChecksum = nonEmptyString(value.participationChecksum, "participation_retraction_checksum_invalid");
  if (!SHA256.test(participationChecksum)) fail("participation_retraction_checksum_invalid");
  return { participationId, participationChecksum };
}

function normalizeSignedSuggestion(
  value: unknown,
  options: InternalCoordinatorOptions,
  discussion: DiscussionArtifact,
): CitizenSignedSuggestionV1 {
  ownKeys(value, SIGNED_SUGGESTION_KEYS, "signedSuggestion");
  if (!isRecord(value)) fail("signed_suggestion_invalid");
  ownKeys(value.draft, SIGNED_SUGGESTION_DRAFT_KEYS, "signedSuggestion.draft");
  ownKeys(value.event, SIGNED_SUGGESTION_EVENT_KEYS, "signedSuggestion.event");
  ownKeys(value.verification, SIGNED_SUGGESTION_VERIFICATION_KEYS, "signedSuggestion.verification");
  if (!isRecord(value.draft) || !isRecord(value.event) || !isRecord(value.verification)) {
    fail("signed_suggestion_invalid");
  }
  const draftCore = {
    sourceAnswerReceiptId: nonEmptyString(value.draft.sourceAnswerReceiptId, "signed_suggestion_receipt_invalid"),
    sourceDiscussionId: nonEmptyString(value.draft.sourceDiscussionId, "signed_suggestion_discussion_invalid"),
    sourceDiscussionRef: nonEmptyString(value.draft.sourceDiscussionRef, "signed_suggestion_discussion_invalid"),
    municipalityId: nonEmptyString(value.draft.municipalityId, "signed_suggestion_scope_invalid"),
    sourceCaseId: nonEmptyString(value.draft.sourceCaseId, "signed_suggestion_scope_invalid"),
    caseId: nonEmptyString(value.draft.caseId, "signed_suggestion_case_invalid"),
    citizenPubkey: nonEmptyString(value.draft.citizenPubkey, "signed_suggestion_signer_invalid"),
    title: boundedDepartmentString(value.draft.title, "signed_suggestion_title_invalid", 240),
    summary: boundedDepartmentString(value.draft.summary, "signed_suggestion_summary_invalid", 2_000),
  };
  const draft = {
    schemaVersion: "public_mecky_suggestion_draft_v1" as const,
    draftId: nonEmptyString(value.draft.draftId, "signed_suggestion_draft_invalid"),
    ...draftCore,
    entryState: "citizen_signature_required" as const,
    authorityBinding: "none" as const,
    submittedToCivicWorkflow: false as const,
  };
  if (
    value.schemaVersion !== "citizen_signed_suggestion_v1" ||
    value.draft.schemaVersion !== "public_mecky_suggestion_draft_v1" ||
    value.draft.entryState !== "citizen_signature_required" ||
    value.draft.authorityBinding !== "none" ||
    value.draft.submittedToCivicWorkflow !== false ||
    value.verification.kind !== "nostr_nip01" ||
    value.verification.verified !== true ||
    value.entryState !== "awaiting_human_case_admission" ||
    value.authorityBinding !== "none" ||
    value.submittedToCivicWorkflow !== false ||
    !/^urn:stadtstack:mecky-answer:[a-f0-9]{64}$/.test(draft.sourceAnswerReceiptId) ||
    !/^[a-f0-9]{64}$/.test(draft.citizenPubkey) ||
    draft.draftId !== `urn:stadtstack:suggestion-draft:${sha256(draftCore).slice("sha256:".length)}` ||
    draft.caseId !== options.caseId ||
    draft.municipalityId !== discussion.municipalityId ||
    draft.sourceCaseId !== discussion.caseId ||
    draft.sourceDiscussionId !== discussion.id ||
    draft.sourceDiscussionRef !== discussion.sourceRef ||
    draft.citizenPubkey !== discussion.event.pubkey
  ) fail("signed_suggestion_binding_invalid");
  if (!Array.isArray(value.event.tags) || value.event.tags.some((tag) => !Array.isArray(tag) || tag.some((part) => typeof part !== "string"))) {
    fail("signed_suggestion_event_invalid");
  }
  const createdAt = safeInteger(value.event.createdAt, "signed_suggestion_event_invalid");
  const event: NostrEvent = {
    id: nonEmptyString(value.event.id, "signed_suggestion_event_invalid"),
    pubkey: nonEmptyString(value.event.pubkey, "signed_suggestion_event_invalid"),
    created_at: createdAt,
    kind: safeInteger(value.event.kind, "signed_suggestion_event_invalid"),
    tags: value.event.tags.map((tag) => [...tag] as string[]),
    content: boundedDepartmentString(value.event.content, "signed_suggestion_event_invalid", 8_192),
    sig: nonEmptyString(value.event.signature, "signed_suggestion_event_invalid"),
  };
  const expectedTags = [
    ["schema", "citizen_signed_suggestion_v1"],
    ["municipality", draft.municipalityId],
    ["case", draft.sourceCaseId],
    ["e", draft.sourceDiscussionId, "", "root"],
    ["mecky-receipt", draft.sourceAnswerReceiptId],
  ];
  let contentDraft: unknown;
  try {
    contentDraft = JSON.parse(event.content);
  } catch {
    fail("signed_suggestion_event_invalid");
  }
  if (
    !validateEvent(event) ||
    getEventHash(event) !== event.id ||
    !verifyEvent(event) ||
    event.kind !== 1 ||
    event.pubkey !== draft.citizenPubkey ||
    canonicalJson(event.tags) !== canonicalJson(expectedTags) ||
    canonicalJson(contentDraft) !== canonicalJson(draft) ||
    value.signerPubkey !== event.pubkey ||
    value.candidateId !== `urn:stadtstack:signed-suggestion:${event.id}`
  ) fail("signed_suggestion_signature_invalid");
  return {
    schemaVersion: "citizen_signed_suggestion_v1",
    candidateId: value.candidateId,
    signerPubkey: event.pubkey,
    draft,
    event: {
      id: event.id,
      pubkey: event.pubkey,
      createdAt: event.created_at,
      kind: 1,
      tags: event.tags.map((tag) => [...tag]),
      content: event.content,
      signature: event.sig,
    },
    verification: { kind: "nostr_nip01", verified: true },
    entryState: "awaiting_human_case_admission",
    authorityBinding: "none",
    submittedToCivicWorkflow: false,
  };
}

function normalizeReviewedOutcome(value: unknown): ReviewedOutcomeInput {
  ownKeys(value, OUTCOME_KEYS, "outcome");
  if (!isRecord(value)) fail("reviewed_outcome_invalid");
  ownKeys(value.sourceDiscussionRef, SOURCE_REFERENCE_KEYS, "outcome.sourceDiscussionRef");
  ownKeys(value.sourceBrief, SOURCE_BRIEF_KEYS, "outcome.sourceBrief");
  ownKeys(value.sourceParticipation, OUTCOME_PARTICIPATION_KEYS, "outcome.sourceParticipation");
  if (!isRecord(value.sourceDiscussionRef) || !isRecord(value.sourceBrief) || !isRecord(value.sourceParticipation)) {
    fail("reviewed_outcome_source_invalid");
  }
  if (
    value.schemaVersion !== "reviewed_outcome_input_v1" ||
    value.publicationTarget !== "public_knowledge_projection" ||
    value.authorityBinding !== "none" ||
    value.sourceDiscussionRef.type !== "nostr_event" ||
    value.reviewedAt !== DETERMINISTIC_OUTCOME_REVIEWED_AT
  ) fail("reviewed_outcome_invalid");
  const briefChecksum = nonEmptyString(value.sourceBrief.briefChecksum, "reviewed_outcome_brief_invalid");
  const participationChecksum = nonEmptyString(value.sourceParticipation.participationChecksum, "reviewed_outcome_participation_invalid");
  if (!SHA256.test(briefChecksum) || !SHA256.test(participationChecksum)) fail("reviewed_outcome_checksum_invalid");
  const resultArtifactRef = participationString(value.resultArtifactRef, "outcome.resultArtifactRef", 2_048);
  if (!SYNTHETIC_REFERENCE.test(resultArtifactRef)) fail("reviewed_outcome_reference_invalid");
  return {
    schemaVersion: "reviewed_outcome_input_v1",
    id: boundedDepartmentString(value.id, "reviewed_outcome_invalid", 512),
    summary: boundedDepartmentString(value.summary, "reviewed_outcome_invalid", 4_096),
    resultArtifactRef,
    reviewedAt: DETERMINISTIC_OUTCOME_REVIEWED_AT,
    sourceDiscussionRef: {
      type: "nostr_event",
      id: nonEmptyString(value.sourceDiscussionRef.id, "reviewed_outcome_discussion_invalid"),
      ref: nonEmptyString(value.sourceDiscussionRef.ref, "reviewed_outcome_discussion_invalid"),
    },
    sourceBrief: {
      id: nonEmptyString(value.sourceBrief.id, "reviewed_outcome_brief_invalid"),
      briefChecksum,
    },
    sourceParticipation: {
      id: nonEmptyString(value.sourceParticipation.id, "reviewed_outcome_participation_invalid"),
      participationChecksum,
    },
    publicationTarget: "public_knowledge_projection",
    authorityBinding: "none",
  };
}

function reviewedOutcomeProjection(input: ReviewedOutcomeInput): ReviewedOutcomeProjection {
  const base: Omit<ReviewedOutcomeProjection, "outcomeChecksum"> = {
    ...clone(input),
    schemaVersion: "reviewed_outcome_projection_v1",
    correctionState: "current",
    advisory: true,
    formalDecision: null,
    externalPublication: false,
  };
  return { ...base, outcomeChecksum: sha256(base) };
}

function normalizeSourceBinding(value: unknown): BriefSourceBinding {
  ownKeys(value, SOURCE_BINDING_KEYS, "brief.sourceBindings");
  if (!isRecord(value)) fail("citizen_brief_binding_invalid");
  const packageId = nonEmptyString(value.packageId, "citizen_brief_binding_invalid");
  const packageChecksum = nonEmptyString(value.packageChecksum, "citizen_brief_binding_invalid");
  const draftArtifactChecksum = nonEmptyString(value.draftArtifactChecksum, "citizen_brief_binding_invalid");
  const reviewAttestationChecksum = nonEmptyString(value.reviewAttestationChecksum, "citizen_brief_binding_invalid");
  if (!SHA256.test(packageChecksum) || !SHA256.test(draftArtifactChecksum) || !SHA256.test(reviewAttestationChecksum)) {
    fail("citizen_brief_binding_checksum_invalid");
  }
  return { packageId, packageChecksum, draftArtifactChecksum, reviewAttestationChecksum };
}

function normalizeCitizenBrief(value: unknown): CitizenBriefInput {
  ownKeys(value, BRIEF_KEYS, "brief");
  if (!isRecord(value)) fail("citizen_brief_invalid");
  if (value.authorityBinding !== "none") fail("authority_field_forbidden:brief.authorityBinding");
  if (!Array.isArray(value.sourceBindings) || value.sourceBindings.length === 0) fail("citizen_brief_bindings_required");
  const sourceBindings = value.sourceBindings.map(normalizeSourceBinding);
  if (new Set(sourceBindings.map((binding) => binding.packageId)).size !== sourceBindings.length) {
    fail("citizen_brief_binding_duplicate");
  }
  sourceBindings.sort((left, right) => left.packageId < right.packageId ? -1 : left.packageId > right.packageId ? 1 : 0);
  return {
    id: boundedDepartmentString(value.id, "citizen_brief_invalid", 512),
    sourceBindings,
    authorityBinding: "none",
  };
}

function normalizeDepartmentRetraction(value: unknown): DepartmentRetractionInput {
  ownKeys(value, RETRACTION_KEYS, "retraction");
  if (!isRecord(value)) fail("department_retraction_invalid");
  const targetDraftArtifactChecksum = nonEmptyString(value.targetDraftArtifactChecksum, "department_retraction_invalid");
  const targetReviewAttestationChecksum = nonEmptyString(value.targetReviewAttestationChecksum, "department_retraction_invalid");
  const packageChecksum = nonEmptyString(value.packageChecksum, "department_retraction_invalid");
  if (!SHA256.test(packageChecksum) || !SHA256.test(targetDraftArtifactChecksum) || !SHA256.test(targetReviewAttestationChecksum)) {
    fail("department_retraction_checksum_invalid");
  }
  return {
    packageId: nonEmptyString(value.packageId, "department_retraction_invalid"),
    packageChecksum,
    targetDraftArtifactChecksum,
    targetReviewAttestationChecksum,
  };
}

function briefChecksumFor(brief: ReviewedCitizenBriefProjection): string {
  const withoutChecksum = Object.fromEntries(
    Object.entries(brief).filter(([key]) => key !== "briefChecksum"),
  );
  return sha256(withoutChecksum);
}

function validateBriefBindings(
  sourceBindings: readonly BriefSourceBinding[],
  departments: ReadonlyMap<string, ReplayedDepartmentState>,
  options: InternalCoordinatorOptions,
): BriefSourceBinding[] {
  const required = options.requiredDepartmentIds;
  if (!required || required.length !== 8 || sourceBindings.length !== required.length) fail("citizen_brief_departments_incomplete");
  const byPackage = new Map(sourceBindings.map((binding) => [binding.packageId, binding]));
  if (byPackage.size !== sourceBindings.length) fail("citizen_brief_binding_duplicate");
  const ordered: BriefSourceBinding[] = [];
  for (const departmentId of required) {
    const department = [...departments.values()].find((item) => item.departmentPackage.departmentId === departmentId);
    if (!department?.draft || !department.review || department.review.review.decision !== "accepted" || department.correctionState !== "current") {
      fail("citizen_brief_review_incomplete");
    }
    const binding = byPackage.get(department.departmentPackage.id);
    if (
      !binding ||
      binding.packageChecksum !== department.packageChecksum ||
      binding.draftArtifactChecksum !== department.draft.draftArtifactChecksum ||
      binding.reviewAttestationChecksum !== department.review.attestationChecksum
    ) fail("citizen_brief_binding_stale");
    ordered.push(clone(binding));
  }
  return ordered;
}

function deriveBriefProjection(
  options: InternalCoordinatorOptions,
  discussion: DiscussionArtifact,
  suggestion: DiscussionRecordedPayload["suggestion"],
  departments: ReadonlyMap<string, ReplayedDepartmentState>,
  id: string,
  sourceBindings: readonly BriefSourceBinding[],
): ReviewedCitizenBriefProjection {
  const orderedDepartments = options.requiredDepartmentIds ?? [];
  const responses = orderedDepartments.map((departmentId) => {
    const department = [...departments.values()].find((item) => item.departmentPackage.departmentId === departmentId);
    if (!department?.draft || !department.review || department.review.review.decision !== "accepted") fail("citizen_brief_review_incomplete");
    return {
      departmentId,
      publicSummary: department.draft.draft.publicSummary,
      publicCitations: [...new Set(department.draft.draft.publicCitations)].sort(),
    };
  });
  const packageBindings = orderedDepartments.map((departmentId, index) => {
    const department = [...departments.values()].find((item) => item.departmentPackage.departmentId === departmentId);
    const review = department?.review;
    if (!department?.draft || !review) fail("citizen_brief_review_incomplete");
    return {
      ...sourceBindings[index]!,
      departmentId,
      reviewedAt: review.review.reviewedAt,
    };
  });
  const base: Omit<ReviewedCitizenBriefProjection, "briefChecksum"> = {
    schemaVersion: "citizen_brief_projection_v1",
    id,
    title: suggestion.title,
    summary: responses.map((response) => `${response.departmentId}: ${response.publicSummary}`).join(" "),
    responses,
    provenance: {
      sourceDiscussionRef: {
        type: "nostr_event",
        id: discussion.event.id,
        ref: discussion.sourceRef,
      },
      suggestionId: suggestion.id,
      packageBindings,
    },
    policyVersion: options.policyVersion,
    correctionState: "current",
    authorityBinding: "none",
  };
  const brief = { ...base, briefChecksum: "" } as ReviewedCitizenBriefProjection;
  brief.briefChecksum = briefChecksumFor(brief);
  return brief;
}

type ReplayedDepartmentState = {
  departmentPackage: DepartmentPackageInput;
  packageChecksum: string;
  draft?: {
    draft: DepartmentDraftInput;
    draftArtifactChecksum: string;
    actorBinding: ActorBinding;
    eventId: string;
  };
  review?: {
    review: DepartmentReviewInput;
    policyVersion: string;
    actorBinding: ActorBinding;
    attestationChecksum: string;
    eventId: string;
  };
  correctionState: "current" | "corrected" | "retracted";
};

type ReplayedCaseState = {
  discussion: DiscussionArtifact;
  suggestion: DiscussionRecordedPayload["suggestion"];
  signedSuggestionAdmission?: AnySignedSuggestionAdmissionPayload & { eventId: string };
  departments: Map<string, ReplayedDepartmentState>;
  department?: ReplayedDepartmentState;
  brief?: ReviewedCitizenBriefProjection;
  briefEventId?: string;
  briefSourceEventIds?: Map<string, { draftEventId: string; reviewEventId: string }>;
  participation?: ReplayedParticipationState;
  outcome?: { outcome: ReviewedOutcomeProjection; eventId: string };
};

type ReplayedParticipationState = {
  participation: ParticipationResultInput;
  sourceBrief: AdvisoryParticipationSourceBinding;
  policyVersion: string;
  reviewerActorBinding: ActorBinding;
  reviewAttestationChecksum: string;
  eventId: string;
  retracted: boolean;
};

function replayJournal(
  state: JournalState,
  options: InternalCoordinatorOptions,
): ReplayedCaseState | undefined {
  let prior = genesisChecksum(options.caseId);
  let discussion: DiscussionArtifact | undefined;
  let suggestion: DiscussionRecordedPayload["suggestion"] | undefined;
  let signedSuggestionAdmission:
    | (AnySignedSuggestionAdmissionPayload & { eventId: string })
    | undefined;
  const departments = new Map<string, ReplayedDepartmentState>();
  let brief: ReviewedCitizenBriefProjection | undefined;
  let briefEventId: string | undefined;
  let briefSourceEventIds: Map<string, { draftEventId: string; reviewEventId: string }> | undefined;
  let participation: ReplayedParticipationState | undefined;
  let outcome: { outcome: ReviewedOutcomeProjection; eventId: string } | undefined;
  for (const [index, event] of state.events.entries()) {
    const expectedVersion = index + 1;
    if (
      event.schemaVersion !== CASE_EVENT_SCHEMA_VERSION ||
      event.caseId !== options.caseId ||
      event.caseVersion !== expectedVersion ||
      event.priorEventChecksum !== prior ||
      !SHA256.test(event.payloadChecksum) ||
      !SHA256.test(event.eventChecksum) ||
      event.eventId !== `urn:stadtstack:case-event:${options.caseId}:${expectedVersion}`
    ) {
      fail("journal_chain_invalid");
    }
    const { payload, eventChecksum, ...eventWithoutChecksum } = event;
    if (sha256(eventWithoutChecksum) !== eventChecksum) fail("event_checksum_invalid");
    if (sha256(payload) !== event.payloadChecksum) fail("payload_checksum_invalid");
    if (event.eventType === "case_created_v1") {
      const casePayload = payload as CaseCreatedPayload;
      if (index !== 0 || casePayload.caseId !== options.caseId || casePayload.authorityBinding !== "none" || event.correctionOf !== null) {
        fail("journal_chain_invalid");
      }
    } else if (event.eventType === "discussion_recorded_v1") {
      const discussionPayload = payload as DiscussionRecordedPayload;
      if (index !== 1 || discussionPayload.authorityBinding !== "none" || event.correctionOf !== null) fail("journal_chain_invalid");
      const candidate = normalizeArtifactShape(discussionPayload.discussion);
      if (!candidate || candidate.id !== candidate.event.id) fail("journal_chain_invalid");
      if (
        !isRecord(discussionPayload.suggestion) ||
        typeof discussionPayload.suggestion.id !== "string" ||
        typeof discussionPayload.suggestion.discussionId !== "string" ||
        typeof discussionPayload.suggestion.title !== "string" ||
        discussionPayload.suggestion.authorityBinding !== "none" ||
        discussionPayload.suggestion.discussionId !== candidate.id
      ) {
        fail("journal_chain_invalid");
      }
      discussion = clone(candidate);
      suggestion = clone(discussionPayload.suggestion);
    } else if (event.eventType === "signed_suggestion_admitted_v1") {
      if (!discussion || !suggestion || signedSuggestionAdmission || departments.size !== 0 || event.correctionOf !== null) {
        fail("journal_chain_invalid");
      }
      const admissionPayload = payload as SignedSuggestionAdmissionPayload;
      const registration = options.actors.get(event.actorBinding.actorId);
      const signedSuggestion = normalizeSignedSuggestion(admissionPayload.signedSuggestion, options, discussion);
      const expectedChecksum = sha256({
        signedSuggestion,
        policyVersion: options.policyVersion,
        actorBinding: event.actorBinding,
      });
      if (
        admissionPayload.authorityBinding !== "none" ||
        admissionPayload.policyVersion !== options.policyVersion ||
        admissionPayload.admissionChecksum !== expectedChecksum ||
        event.actorBinding.actorClass !== "case_steward" ||
        !registration ||
        registration.actorClass !== "case_steward"
      ) fail("journal_chain_invalid");
      signedSuggestionAdmission = {
        signedSuggestion,
        admissionChecksum: expectedChecksum,
        policyVersion: options.policyVersion,
        authorityBinding: "none",
        eventId: event.eventId,
      };
      suggestion = {
        ...suggestion,
        title: signedSuggestion.draft.title,
      };
    } else if (event.eventType === "signed_topic_suggestion_admitted_v1") {
      if (
        !discussion ||
        !suggestion ||
        signedSuggestionAdmission ||
        departments.size !== 0 ||
        event.correctionOf !== null
      ) {
        fail("journal_chain_invalid");
      }
      const admissionPayload = payload as SignedTopicSuggestionAdmissionPayload;
      const registration = options.actors.get(event.actorBinding.actorId);
      const verified = verifyTopicCaseAdmission({
        sourceDiscussion: artifactToNip01Event(discussion),
        sourceAnswer: admissionPayload.sourceAnswer,
        signedSuggestion: admissionPayload.signedSuggestion,
        allowedAgentPubkeys: [...(options.allowedAgentPubkeys ?? [])],
      });
      const expectedChecksum = sha256({
        signedSuggestion: verified.signedSuggestion,
        sourceAnswer: verified.sourceAnswer,
        caseId: verified.identity.caseId,
        policyVersion: options.policyVersion,
        actorBinding: event.actorBinding,
      });
      if (
        verified.identity.caseId !== options.caseId ||
        verified.identity.municipalityId !== options.jurisdiction.value ||
        canonicalJson(verified.discussion) !== canonicalJson(discussion) ||
        admissionPayload.authorityBinding !== "none" ||
        admissionPayload.policyVersion !== options.policyVersion ||
        admissionPayload.admissionChecksum !== expectedChecksum ||
        event.actorBinding.actorClass !== "case_steward" ||
        !registration ||
        registration.actorClass !== "case_steward"
      ) {
        fail("journal_chain_invalid");
      }
      signedSuggestionAdmission = {
        signedSuggestion: verified.signedSuggestion,
        sourceAnswer: verified.sourceAnswer,
        admissionChecksum: expectedChecksum,
        policyVersion: options.policyVersion,
        authorityBinding: "none",
        eventId: event.eventId,
      };
      suggestion = {
        ...suggestion,
        title: verified.signedSuggestion.draft.title,
      };
    } else if (event.eventType === "department_package_assigned_v1") {
      if (index < 2 || !discussion || !suggestion || event.correctionOf !== null) fail("journal_chain_invalid");
      if (options.requireSignedSuggestionAdmission && !signedSuggestionAdmission) fail("journal_chain_invalid");
      const packagePayload = payload as DepartmentPackagePayload;
      const departmentPackage = normalizeDepartmentPackage(packagePayload.departmentPackage);
      const stewardRegistration = options.actors.get(event.actorBinding.actorId);
      if (departments.has(departmentPackage.id) || [...departments.values()].some((item) => item.departmentPackage.departmentId === departmentPackage.departmentId)) {
        fail("journal_chain_invalid");
      }
      if (options.requiredDepartmentIds && !options.requiredDepartmentIds.includes(departmentPackage.departmentId)) {
        fail("journal_chain_invalid");
      }
      if (
        packagePayload.authorityBinding !== "none" ||
        packagePayload.packageChecksum !== sha256(departmentPackage) ||
        departmentPackage.suggestionId !== suggestion.id ||
        event.actorBinding.actorClass !== "case_steward" ||
        !stewardRegistration ||
        stewardRegistration.actorClass !== "case_steward"
      ) fail("journal_chain_invalid");
      departments.set(departmentPackage.id, {
        departmentPackage,
        packageChecksum: packagePayload.packageChecksum,
        correctionState: "current",
      });
    } else if (event.eventType === "department_draft_recorded_v1") {
      const draftPayload = payload as DepartmentDraftPayload;
      const department = departments.get(draftPayload.packageId);
      if (!department || department.draft || event.correctionOf !== null) fail("journal_chain_invalid");
      const draft = normalizeDepartmentDraft(draftPayload.draft);
      const registration = options.actors.get(event.actorBinding.actorId);
      if (
        draftPayload.authorityBinding !== "none" ||
        draftPayload.packageId !== department.departmentPackage.id ||
        draftPayload.packageChecksum !== department.packageChecksum ||
        draftPayload.draftArtifactChecksum !== sha256(draft) ||
        event.actorBinding.actorClass !== "department_agent" ||
        !registration ||
        registration.actorClass !== "department_agent" ||
        registration.departmentId !== department.departmentPackage.departmentId ||
        event.actorBinding.actorId !== department.departmentPackage.assignedAgentActorId
      ) fail("journal_chain_invalid");
      department.draft = {
        draft,
        draftArtifactChecksum: draftPayload.draftArtifactChecksum,
        actorBinding: clone(event.actorBinding),
        eventId: event.eventId,
      };
      department.correctionState = "current";
    } else if (event.eventType === "department_review_attested_v1") {
      const reviewPayload = payload as DepartmentReviewPayload;
      const department = departments.get(reviewPayload.review.packageId);
      if (!department?.draft || department.review || event.correctionOf !== null) fail("journal_chain_invalid");
      const review = normalizeDepartmentReview(reviewPayload.review);
      const registration = options.actors.get(event.actorBinding.actorId);
      if (
        reviewPayload.authorityBinding !== "none" ||
        reviewPayload.policyVersion !== options.policyVersion ||
        reviewPayload.attestationChecksum !== sha256({
          review,
          policyVersion: reviewPayload.policyVersion,
          actorBinding: event.actorBinding,
        }) ||
        review.packageId !== department.departmentPackage.id ||
        review.draftArtifactChecksum !== department.draft.draftArtifactChecksum ||
        event.actorBinding.actorClass !== "department_reviewer" ||
        !registration ||
        registration.actorClass !== "department_reviewer" ||
        registration.departmentId !== department.departmentPackage.departmentId ||
        event.actorBinding.actorId === department.draft.actorBinding.actorId ||
        event.actorBinding.actorId !== department.departmentPackage.assignedReviewerActorId
      ) fail("journal_chain_invalid");
      department.review = {
        review,
        policyVersion: reviewPayload.policyVersion,
        actorBinding: clone(event.actorBinding),
        attestationChecksum: reviewPayload.attestationChecksum,
        eventId: event.eventId,
      };
      department.correctionState = "current";
    } else if (event.eventType === "department_draft_corrected_v1") {
      const correctionPayload = payload as DepartmentDraftCorrectionPayload;
      const department = departments.get(correctionPayload.packageId);
      if (!department?.draft || !department.review || department.review.review.decision !== "accepted" || event.correctionOf !== department.draft.eventId) fail("journal_chain_invalid");
      const draft = normalizeDepartmentDraft(correctionPayload.draft);
      const registration = options.actors.get(event.actorBinding.actorId);
      if (
        correctionPayload.authorityBinding !== "none" ||
        correctionPayload.packageChecksum !== department.packageChecksum ||
        correctionPayload.priorDraftArtifactChecksum !== department.draft.draftArtifactChecksum ||
        correctionPayload.draftArtifactChecksum !== sha256(draft) ||
        event.actorBinding.actorClass !== "department_agent" ||
        !registration ||
        registration.actorClass !== "department_agent" ||
        registration.departmentId !== department.departmentPackage.departmentId ||
        event.actorBinding.actorId !== department.departmentPackage.assignedAgentActorId
      ) fail("journal_chain_invalid");
      department.draft = {
        draft,
        draftArtifactChecksum: correctionPayload.draftArtifactChecksum,
        actorBinding: clone(event.actorBinding),
        eventId: event.eventId,
      };
      department.review = undefined;
      department.correctionState = "corrected";
    } else if (event.eventType === "department_response_retracted_v1") {
      const retractionPayload = payload as DepartmentRetractionPayload;
      const department = departments.get(retractionPayload.retraction.packageId);
      if (!department?.draft || !department.review || department.review.review.decision !== "accepted" || event.correctionOf !== department.review.eventId) fail("journal_chain_invalid");
      const retraction = normalizeDepartmentRetraction(retractionPayload.retraction);
      const registration = options.actors.get(event.actorBinding.actorId);
      if (
        retractionPayload.authorityBinding !== "none" ||
        retraction.packageChecksum !== department.packageChecksum ||
        retraction.targetDraftArtifactChecksum !== department.draft.draftArtifactChecksum ||
        retraction.targetReviewAttestationChecksum !== department.review.attestationChecksum ||
        event.actorBinding.actorClass !== "case_steward" ||
        !registration ||
        registration.actorClass !== "case_steward"
      ) fail("journal_chain_invalid");
      department.draft = undefined;
      department.review = undefined;
      department.correctionState = "retracted";
    } else if (event.eventType === "citizen_brief_derived_v1") {
      if (!discussion || !suggestion || event.correctionOf !== null) fail("journal_chain_invalid");
      const briefPayload = payload as CitizenBriefPayload;
      const registration = options.actors.get(event.actorBinding.actorId);
      if (
        briefPayload.authorityBinding !== "none" ||
        briefPayload.policyVersion !== options.policyVersion ||
        event.actorBinding.actorClass !== "case_steward" ||
        !registration ||
        registration.actorClass !== "case_steward"
      ) fail("journal_chain_invalid");
      const validatedBindings = validateBriefBindings(briefPayload.sourceBindings, departments, options);
      const derived = deriveBriefProjection(options, discussion, suggestion, departments, briefPayload.brief.id, validatedBindings);
      if (
        canonicalJson(derived) !== canonicalJson(briefPayload.brief) ||
        briefPayload.briefChecksum !== briefChecksumFor(derived) ||
        briefPayload.briefChecksum !== briefPayload.brief.briefChecksum
      ) fail("journal_chain_invalid");
      brief = clone(briefPayload.brief);
      briefEventId = event.eventId;
      briefSourceEventIds = new Map(
        validatedBindings.map((binding) => {
          const department = departments.get(binding.packageId);
          if (!department?.draft || !department.review) fail("journal_chain_invalid");
          return [binding.packageId, { draftEventId: department.draft.eventId, reviewEventId: department.review.eventId }] as const;
        }),
      );
    } else if (event.eventType === "advisory_participation_recorded_v1") {
      const participationPayload = payload as AdvisoryParticipationPayload;
      const registration = options.actors.get(event.actorBinding.actorId);
      if (event.correctionOf !== null || participation || !discussion || !suggestion || !brief || !briefEventId || !briefSourceEventIds) fail("journal_chain_invalid");
      const snapshot: ReplayedCaseState = {
        discussion,
        suggestion,
        departments,
        brief,
        briefEventId,
        briefSourceEventIds,
      };
      if (!briefIsCurrent(options, snapshot, brief)) fail("journal_chain_invalid");
      const normalizedParticipation = normalizeParticipationResult(participationPayload.participation);
      if (
        participationPayload.authorityBinding !== "none" ||
        participationPayload.policyVersion !== options.policyVersion ||
        event.actorBinding.actorClass !== "participation_reviewer" ||
        canonicalJson(participationPayload.reviewerActorBinding) !== canonicalJson(event.actorBinding) ||
        !registration ||
        registration.actorClass !== "participation_reviewer" ||
        participationPayload.sourceBrief.id !== brief.id ||
        participationPayload.sourceBrief.briefChecksum !== brief.briefChecksum ||
        participationPayload.sourceBrief.briefEventId !== briefEventId ||
        participationPayload.reviewAttestationChecksum !== participationAttestationChecksumFor(
          normalizedParticipation.checksum,
          participationPayload.sourceBrief,
          participationPayload.policyVersion,
          event.actorBinding,
          normalizedParticipation.reviewedAt,
        ) ||
        normalizedParticipation.checksum !== participationChecksumFor(
          normalizedParticipation,
          participationPayload.sourceBrief,
          participationPayload.policyVersion,
          event.actorBinding,
          normalizedParticipation.reviewedAt,
        )
      ) fail("journal_chain_invalid");
      participation = {
        participation: normalizedParticipation,
        sourceBrief: clone(participationPayload.sourceBrief),
        policyVersion: participationPayload.policyVersion,
        reviewerActorBinding: clone(event.actorBinding),
        reviewAttestationChecksum: participationPayload.reviewAttestationChecksum,
        eventId: event.eventId,
        retracted: false,
      };
    } else if (event.eventType === "advisory_participation_retracted_v1") {
      const retractionPayload = payload as AdvisoryParticipationRetractionPayload;
      if (!participation || participation.retracted || event.correctionOf !== participation.eventId) fail("journal_chain_invalid");
      const retraction = normalizeParticipationRetraction(retractionPayload.retraction);
      const registration = options.actors.get(event.actorBinding.actorId);
      if (
        retractionPayload.authorityBinding !== "none" ||
        event.actorBinding.actorClass !== "case_steward" ||
        !registration ||
        registration.actorClass !== "case_steward" ||
        retraction.participationId !== participation.participation.id ||
        retraction.participationChecksum !== participation.participation.checksum
      ) fail("journal_chain_invalid");
      participation.retracted = true;
    } else if (event.eventType === "reviewed_outcome_recorded_v1") {
      if (!discussion || !suggestion || !brief || !briefEventId || !participation || participation.retracted || outcome || event.correctionOf !== null) {
        fail("journal_chain_invalid");
      }
      const outcomePayload = payload as ReviewedOutcomePayload;
      const registration = options.actors.get(event.actorBinding.actorId);
      const normalizedInput = normalizeReviewedOutcome({
        schemaVersion: "reviewed_outcome_input_v1",
        id: outcomePayload.outcome.id,
        summary: outcomePayload.outcome.summary,
        resultArtifactRef: outcomePayload.outcome.resultArtifactRef,
        reviewedAt: outcomePayload.outcome.reviewedAt,
        sourceDiscussionRef: outcomePayload.outcome.sourceDiscussionRef,
        sourceBrief: outcomePayload.outcome.sourceBrief,
        sourceParticipation: outcomePayload.outcome.sourceParticipation,
        publicationTarget: outcomePayload.outcome.publicationTarget,
        authorityBinding: outcomePayload.outcome.authorityBinding,
      });
      const derived = reviewedOutcomeProjection(normalizedInput);
      const discussionRef = { type: "nostr_event" as const, id: discussion.event.id, ref: discussion.sourceRef };
      if (
        outcomePayload.authorityBinding !== "none" ||
        outcomePayload.policyVersion !== options.policyVersion ||
        event.actorBinding.actorClass !== "case_steward" ||
        !registration ||
        registration.actorClass !== "case_steward" ||
        canonicalJson(derived) !== canonicalJson(outcomePayload.outcome) ||
        canonicalJson(derived.sourceDiscussionRef) !== canonicalJson(discussionRef) ||
        derived.sourceBrief.id !== brief.id ||
        derived.sourceBrief.briefChecksum !== brief.briefChecksum ||
        derived.sourceParticipation.id !== participation.participation.id ||
        derived.sourceParticipation.participationChecksum !== participation.participation.checksum ||
        !briefIsCurrent(options, { discussion, suggestion, signedSuggestionAdmission, departments, brief, briefEventId, briefSourceEventIds, participation }, brief) ||
        !participationIsCurrent(options, { discussion, suggestion, signedSuggestionAdmission, departments, brief, briefEventId, briefSourceEventIds, participation }, participation)
      ) fail("journal_chain_invalid");
      outcome = { outcome: derived, eventId: event.eventId };
    } else {
      fail("journal_chain_invalid");
    }
    prior = eventChecksum;
  }
  if (state.headChecksum !== prior) fail("journal_chain_invalid");
  if (options.requiredDepartmentIds && departments.size > options.requiredDepartmentIds.length) fail("journal_chain_invalid");
  if (!discussion || !suggestion) return undefined;
  const department = departments.size === 1 ? [...departments.values()][0] : undefined;
  return { discussion, suggestion, signedSuggestionAdmission, departments, department, brief, briefEventId, briefSourceEventIds, participation, outcome };
}

function normalizeAndVerifyDiscussion(
  artifactInput: unknown,
  options: InternalCoordinatorOptions,
): DiscussionArtifact {
  const artifact = normalizeArtifactShape(artifactInput);
  const artifactScope = { municipalityId: artifact.municipalityId, caseId: artifact.caseId };
  if (options.scope && !scopesEqual(artifactScope, options.scope)) fail("discussion_scope_mismatch");
  const municipalityTags = artifact.event.tags.filter((tag) => tag[0] === "municipality");
  const caseTags = artifact.event.tags.filter((tag) => tag[0] === "case");
  if (artifact.event.tags.some((tag) => (tag[0] === "municipality" || tag[0] === "case") && tag.length !== 2)) {
    fail("discussion_scope_invalid");
  }
  if (municipalityTags.length !== 1 || municipalityTags[0]?.[1] !== artifact.municipalityId || caseTags.length !== 1 || caseTags[0]?.[1] !== artifact.caseId) {
    fail("discussion_scope_mismatch");
  }
  if (artifact.event.tags.some((tag) => (tag[0] === "municipality_id" || tag[0] === "municipalityId" || tag[0] === "case_id" || tag[0] === "caseId"))) {
    fail("discussion_scope_invalid");
  }
  const fixtureMarkers = artifact.event.tags.filter((tag) => tag[0] === STADTSTACK_E2E_FIXTURE_TAG[0]);
  if (fixtureMarkers.length !== 1 || fixtureMarkers[0]?.length !== 2 || fixtureMarkers[0]?.[1] !== STADTSTACK_E2E_FIXTURE_TAG[1]) {
    fail("discussion_fixture_marker_required");
  }
  if (options.allowedSignerPubkeys && !options.allowedSignerPubkeys.has(artifact.event.pubkey)) {
    fail("discussion_signer_not_allowed");
  }
  if (!options.allowedSignerPubkeys) {
    fail("discussion_signer_not_allowed");
  }
  const adapter = createNostrDiscussionAdapter({
    scope: options.scope,
    allowedKinds: options.allowedKinds,
    syntheticFixtureOnly: options.syntheticFixtureOnly,
  });
  let normalized: DiscussionArtifact;
  try {
    normalized = adapter.normalize(artifactToNip01Event(artifact) as NostrEvent);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("discussion_event_invalid");
  }
  if (canonicalJson(normalized) !== canonicalJson(artifact)) fail("discussion_proof_invalid");
  return clone(normalized);
}

function discussionProjection(
  artifact: DiscussionArtifact,
  outcome?: { outcome: ReviewedOutcomeProjection; eventId: string },
): DiscussionProjection {
  const sourceReference: SourceReference = {
    type: "nostr_event",
    id: artifact.event.id,
    ref: artifact.sourceRef,
  };
  return {
    schemaVersion: "discussion_projection_v1",
    id: artifact.id,
    source: "nostr",
    sourceRef: artifact.sourceRef,
    sourceReference,
    scope: { municipalityId: artifact.municipalityId, caseId: artifact.caseId },
    content: artifact.event.content,
    event: clone(artifact.event),
    verificationProof: clone(artifact.verificationProof),
    authorityBinding: "none",
    provenance: clone(artifact),
    ...(outcome ? { outcomeRef: { id: outcome.outcome.id, outcomeChecksum: outcome.outcome.outcomeChecksum } } : {}),
  };
}

function suggestionProjection(
  artifact: DiscussionArtifact,
  payload?: DiscussionRecordedPayload["suggestion"],
  admission?: AnySignedSuggestionAdmissionPayload & { eventId: string },
): SuggestionProjection {
  const discussionReference: SourceReference = {
    type: "nostr_event",
    id: artifact.event.id,
    ref: artifact.sourceRef,
  };
  const id = payload?.id ?? `urn:stadtstack:suggestion:${artifact.event.id}`;
  if (admission) {
    return {
      schemaVersion: "suggestion_projection_v1",
      id,
      discussionId: artifact.id,
      discussionRef: discussionReference,
      title: admission.signedSuggestion.draft.title,
      summary: admission.signedSuggestion.draft.summary,
      status: "admitted",
      signerPubkey: admission.signedSuggestion.signerPubkey,
      admission: {
        candidateId: admission.signedSuggestion.candidateId,
        signedEventId: admission.signedSuggestion.event.id,
        sourceAnswerReceiptId: admission.signedSuggestion.draft.sourceAnswerReceiptId,
        ...("topicId" in admission.signedSuggestion.draft
          ? { sourceTopicId: admission.signedSuggestion.draft.topicId }
          : {}),
        admissionChecksum: admission.admissionChecksum,
        admittedByActorClass: "case_steward",
      },
      authorityBinding: "none",
      provenance: discussionReference,
    };
  }
  return {
    schemaVersion: "suggestion_projection_v1",
    id,
    discussionId: artifact.id,
    discussionRef: discussionReference,
    title: payload?.title ?? artifact.event.content,
    status: "draft",
    authorityBinding: "none",
    provenance: discussionReference,
  };
}

function suggestionPayload(artifact: DiscussionArtifact): DiscussionRecordedPayload["suggestion"] {
  return {
    id: `urn:stadtstack:suggestion:${artifact.event.id}`,
    discussionId: artifact.id,
    title: artifact.event.content,
    authorityBinding: "none",
  };
}

function departmentPackageProjection(
  department: ReplayedDepartmentState,
  visibility: QueryEnvelope["visibility"],
): DepartmentPackageProjection | undefined {
  const review = department.review;
  if (visibility !== "administration" && (department.correctionState !== "current" || !review || review.review.decision !== "accepted")) return undefined;
  if (visibility !== "administration" && review) {
    const draft = department.draft;
    if (!draft) return undefined;
    return {
      schemaVersion: "department_package_projection_v1",
      id: department.departmentPackage.id,
      departmentId: department.departmentPackage.departmentId,
      suggestionId: department.departmentPackage.suggestionId,
      request: department.departmentPackage.request,
      packageChecksum: department.packageChecksum,
      reviewState: "accepted",
      correctionState: department.correctionState,
      artifactChecksum: review.review.draftArtifactChecksum,
      reviewedAt: review.review.reviewedAt,
      policyVersion: review.policyVersion,
      publicSummary: draft.draft.publicSummary,
      publicCitations: clone(draft.draft.publicCitations),
      authorityBinding: "none",
    };
  }
  const result: DepartmentPackageProjection = {
    schemaVersion: "department_package_projection_v1",
    id: department.departmentPackage.id,
    departmentId: department.departmentPackage.departmentId,
    suggestionId: department.departmentPackage.suggestionId,
    request: department.departmentPackage.request,
    packageChecksum: department.packageChecksum,
    assignedAgentActorId: department.departmentPackage.assignedAgentActorId,
    assignedReviewerActorId: department.departmentPackage.assignedReviewerActorId,
    reviewState: department.review?.review.decision ?? (department.draft ? "draft_pending_review" : "assigned"),
    correctionState: department.correctionState,
    authorityBinding: "none",
  };
  if (department.draft) {
    result.draft = {
      schemaVersion: "department_draft_projection_v1",
      id: department.draft.draft.id,
      publicSummary: department.draft.draft.publicSummary,
      publicCitations: clone(department.draft.draft.publicCitations),
      privateEvidenceRefs: clone(department.draft.draft.privateEvidenceRefs),
      artifactChecksum: department.draft.draftArtifactChecksum,
      actorId: department.draft.actorBinding.actorId,
    };
  }
  if (department.review) {
    result.review = {
      decision: department.review.review.decision,
      draftArtifactChecksum: department.review.review.draftArtifactChecksum,
      reviewedAt: department.review.review.reviewedAt,
      policyVersion: department.review.policyVersion,
      attestationChecksum: department.review.attestationChecksum,
      reviewerActorId: department.review.actorBinding.actorId,
    };
  }
  return result;
}

function briefIsCurrent(
  options: InternalCoordinatorOptions,
  replayed: ReplayedCaseState,
  brief: ReviewedCitizenBriefProjection,
): boolean {
  if (brief.correctionState !== "current") return false;
  try {
    if (!replayed.briefSourceEventIds || replayed.briefSourceEventIds.size !== brief.provenance.packageBindings.length) return false;
    for (const binding of brief.provenance.packageBindings) {
      const department = replayed.departments.get(binding.packageId);
      const sourceEvents = replayed.briefSourceEventIds.get(binding.packageId);
      if (!department?.draft || !department.review || !sourceEvents || department.draft.eventId !== sourceEvents.draftEventId || department.review.eventId !== sourceEvents.reviewEventId) {
        return false;
      }
    }
    const bindings = brief.provenance.packageBindings.map(({ departmentId: _departmentId, reviewedAt: _reviewedAt, ...binding }) => binding);
    const validated = validateBriefBindings(bindings, replayed.departments, options);
    const derived = deriveBriefProjection(options, replayed.discussion, replayed.suggestion, replayed.departments, brief.id, validated);
    return canonicalJson(derived) === canonicalJson(brief) && briefChecksumFor(brief) === brief.briefChecksum;
  } catch {
    return false;
  }
}

function invalidatedBriefProjection(brief: ReviewedCitizenBriefProjection): ReviewedCitizenBriefProjection {
  return {
    ...clone(brief),
    summary: "",
    responses: [],
    correctionState: "invalidated",
  };
}

function participationIsCurrent(
  options: InternalCoordinatorOptions,
  replayed: ReplayedCaseState,
  participation: ReplayedParticipationState,
): boolean {
  if (participation.retracted || !replayed.brief || !replayed.briefEventId) return false;
  if (!briefIsCurrent(options, replayed, replayed.brief)) return false;
  if (
    participation.sourceBrief.id !== replayed.brief.id ||
    participation.sourceBrief.briefChecksum !== replayed.brief.briefChecksum ||
    participation.sourceBrief.briefEventId !== replayed.briefEventId
  ) return false;
  return participation.participation.checksum === participationChecksumFor(
    participation.participation,
    participation.sourceBrief,
    participation.policyVersion,
    participation.reviewerActorBinding,
    participation.participation.reviewedAt,
  );
}

function participationProjection(
  participation: ReplayedParticipationState,
  correctionState: AdvisoryParticipationProjection["correctionState"],
  administration: boolean,
): AdvisoryParticipationProjection {
  const projected: AdvisoryParticipationProjection = {
    ...clone(participation.participation),
    correctionState,
    advisory: true,
  };
  if (administration) {
    projected.sourceBrief = clone(participation.sourceBrief);
    projected.reviewerActorBinding = clone(participation.reviewerActorBinding);
    projected.reviewAttestationChecksum = participation.reviewAttestationChecksum;
  }
  return projected;
}

function outcomeIsCurrent(options: InternalCoordinatorOptions, replayed: ReplayedCaseState): boolean {
  const outcome = replayed.outcome?.outcome;
  const participation = replayed.participation;
  const brief = replayed.brief;
  if (!outcome || !participation || !brief) return false;
  if (!briefIsCurrent(options, replayed, brief) || !participationIsCurrent(options, replayed, participation)) return false;
  const discussionRef = { type: "nostr_event" as const, id: replayed.discussion.event.id, ref: replayed.discussion.sourceRef };
  return (
    outcome.correctionState === "current" &&
    outcome.outcomeChecksum === sha256(Object.fromEntries(Object.entries(outcome).filter(([key]) => key !== "outcomeChecksum"))) &&
    canonicalJson(outcome.sourceDiscussionRef) === canonicalJson(discussionRef) &&
    outcome.sourceBrief.id === brief.id &&
    outcome.sourceBrief.briefChecksum === brief.briefChecksum &&
    outcome.sourceParticipation.id === participation.participation.id &&
    outcome.sourceParticipation.participationChecksum === participation.participation.checksum
  );
}

function buildProjection(
  options: InternalCoordinatorOptions,
  replayed: ReplayedCaseState,
  visibility: QueryEnvelope["visibility"],
): CaseProjection {
  const { discussion } = replayed;
  const currentOutcome = outcomeIsCurrent(options, replayed) ? replayed.outcome : undefined;
  const projectedDiscussion = discussionProjection(discussion, currentOutcome);
  const projectedSuggestion = suggestionProjection(discussion, replayed.suggestion, replayed.signedSuggestionAdmission);
  const result: CaseProjection = {
    schemaVersion: "case_projection_v1",
    caseId: options.caseId,
    jurisdiction: clone(options.jurisdiction),
    municipalityId: discussion.municipalityId,
    sourceScope: { municipalityId: discussion.municipalityId, caseId: discussion.caseId },
    authorityBinding: "none",
    formalDecision: null,
    discussion: projectedDiscussion,
    discussions: [clone(projectedDiscussion)],
    suggestion: projectedSuggestion,
    suggestions: [clone(projectedSuggestion)],
    provenance: clone(discussion),
  };
  const departments = [...replayed.departments.values()].sort((left, right) => {
    const leftId = left.departmentPackage.departmentId;
    const rightId = right.departmentPackage.departmentId;
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
  const projectedDepartments = departments
    .map((department) => departmentPackageProjection(department, visibility))
    .filter((department): department is DepartmentPackageProjection => Boolean(department));
  if (visibility === "administration") {
    if (projectedDepartments.length > 0) result.departmentPackages = projectedDepartments;
  } else if (projectedDepartments.length > 0) {
    result.departmentPackages = projectedDepartments;
  }
  if (departments.length === 1) {
    const departmentProjection = departmentPackageProjection(departments[0]!, visibility);
    if (departmentProjection) result.departmentPackage = departmentProjection;
  }
  if (replayed.brief) {
    result.reviewedCitizenBrief = briefIsCurrent(options, replayed, replayed.brief)
      ? clone(replayed.brief)
      : invalidatedBriefProjection(replayed.brief);
    if (visibility !== "administration" && !briefIsCurrent(options, replayed, replayed.brief)) {
      result.reviewedCitizenBrief = invalidatedBriefProjection(replayed.brief);
    }
  }
  if (replayed.participation) {
    const current = participationIsCurrent(options, replayed, replayed.participation);
    if (visibility === "administration") {
      result.participationResult = participationProjection(
        replayed.participation,
        replayed.participation.retracted ? "retracted" : current ? "current" : "invalidated",
        true,
      );
    } else if (current) {
      result.participationResult = participationProjection(replayed.participation, "current", false);
    }
  }
  if (currentOutcome) {
    result.reviewedOutcome = clone(currentOutcome.outcome);
  }
  if (visibility === "council" && replayed.brief && briefIsCurrent(options, replayed, replayed.brief)) {
    const currentParticipation = replayed.participation && participationIsCurrent(options, replayed, replayed.participation)
      ? clone(replayed.participation.participation)
      : null;
    const reviewedDepartmentResponseCount = [...replayed.departments.values()].filter(
      (department) => department.review?.review.decision === "accepted" && department.correctionState === "current",
    ).length;
    result.councilDryRunBrief = {
      schemaVersion: "council_dry_run_brief_v1",
      state: "dry_run_not_submitted",
      authorityBinding: "none",
      summary: replayed.brief.summary,
      citizenSignal: currentParticipation,
      reviewedDepartmentResponseCount,
      formalDecision: null,
      councilSubmissionCreated: false,
      formalVoteStarted: false,
      publicWrite: false,
    };
  }
  return result;
}

type NormalizedCommand = {
  actor: ActorBinding;
  expectedCaseVersion: number;
  idempotencyKey: string;
  caseId: string;
  policyVersion: string;
  commandType: CommandEnvelope["commandType"];
  discussion?: DiscussionArtifact;
  signedSuggestion?: CitizenSignedSuggestionV1;
  sourceDiscussion?: NostrEvent;
  sourceAnswer?: NostrEvent;
  signedTopicSuggestion?: CitizenSignedTopicSuggestionV1;
  departmentPackage?: DepartmentPackageInput;
  packageId?: string;
  packageChecksum?: string;
  priorDraftArtifactChecksum?: string;
  draft?: DepartmentDraftInput;
  review?: DepartmentReviewInput;
  brief?: CitizenBriefInput;
  retraction?: DepartmentRetractionInput;
  participation?: ParticipationResultInput;
  sourceBrief?: { id: string; briefChecksum: string };
  participationRetraction?: { participationId: string; participationChecksum: string };
  outcome?: ReviewedOutcomeInput;
};

function normalizeCommand(command: CommandEnvelope): NormalizedCommand {
  ownKeys(command, COMMAND_KEYS, "envelope");
  if (!isRecord(command) || command.schemaVersion !== COMMAND_ENVELOPE_SCHEMA_VERSION) fail("schema_version_unsupported");
  const commandType = command.commandType;
  if (
    commandType !== "intake_discussion_v1" &&
    commandType !== "admit_signed_suggestion_v1" &&
    commandType !== "admit_signed_topic_suggestion_v1" &&
    commandType !== "assign_department_package_v1" &&
    commandType !== "record_department_draft_v1" &&
    commandType !== "attest_department_review_v1" &&
    commandType !== "record_advisory_participation_v1" &&
    commandType !== "retract_advisory_participation_v1" &&
    commandType !== "record_reviewed_outcome_v1" &&
    commandType !== "derive_citizen_brief_v1" &&
    commandType !== "correct_department_draft_v1" &&
    commandType !== "retract_department_response_v1"
  ) fail("command_type_invalid");
  const caseId = nonEmptyString(command.caseId, "case_id_required");
  const actor = normalizeActor(command.actorBinding);
  const expectedCaseVersion = safeInteger(command.expectedCaseVersion, "expected_case_version_invalid");
  if (expectedCaseVersion < 0) fail("expected_case_version_invalid");
  const idempotencyKey = nonEmptyString(command.idempotencyKey, "idempotency_key_required");
  if (idempotencyKey.length > 256) fail("idempotency_key_invalid");
  if (command.visibility !== "private_case") fail("visibility_invalid");
  const policyVersion = nonEmptyString(command.policyVersion, "policy_version_invalid");
  if (!isRecord(command.payload)) fail("payload_invalid");
  const result: NormalizedCommand = {
    actor,
    expectedCaseVersion,
    idempotencyKey,
    caseId,
    policyVersion,
    commandType,
  };
  if (commandType === "intake_discussion_v1") {
    ownKeys(command.payload, PAYLOAD_KEYS, "payload");
    result.discussion = normalizeArtifactShape(command.payload.discussion);
  } else if (commandType === "admit_signed_suggestion_v1") {
    ownKeys(command.payload, SIGNED_SUGGESTION_PAYLOAD_KEYS, "payload");
    // Full source/case validation happens after the current discussion has
    // been replayed; retain an isolated clone until then.
    result.signedSuggestion = clone(command.payload.signedSuggestion) as CitizenSignedSuggestionV1;
  } else if (commandType === "admit_signed_topic_suggestion_v1") {
    ownKeys(command.payload, SIGNED_TOPIC_SUGGESTION_PAYLOAD_KEYS, "payload");
    result.sourceDiscussion = clone(command.payload.sourceDiscussion) as NostrEvent;
    result.sourceAnswer = clone(command.payload.sourceAnswer) as NostrEvent;
    result.signedTopicSuggestion = clone(
      command.payload.signedSuggestion,
    ) as CitizenSignedTopicSuggestionV1;
  } else if (commandType === "assign_department_package_v1") {
    ownKeys(command.payload, PACKAGE_PAYLOAD_KEYS, "payload");
    result.departmentPackage = normalizeDepartmentPackage(command.payload.departmentPackage);
  } else if (commandType === "record_department_draft_v1") {
    ownKeys(command.payload, DRAFT_PAYLOAD_KEYS, "payload");
    const packageId = nonEmptyString(command.payload.packageId, "department_package_invalid");
    const packageChecksum = nonEmptyString(command.payload.packageChecksum, "department_package_checksum_invalid");
    if (!SHA256.test(packageChecksum)) fail("department_package_checksum_invalid");
    result.packageId = packageId;
    result.packageChecksum = packageChecksum;
    result.draft = normalizeDepartmentDraft(command.payload.draft);
  } else if (commandType === "derive_citizen_brief_v1") {
    ownKeys(command.payload, BRIEF_PAYLOAD_KEYS, "payload");
    result.brief = normalizeCitizenBrief(command.payload.brief);
  } else if (commandType === "record_advisory_participation_v1") {
    ownKeys(command.payload, PARTICIPATION_PAYLOAD_KEYS, "payload");
    result.participation = normalizeParticipationResult(command.payload.participation);
    result.sourceBrief = normalizeParticipationSourceBrief(command.payload.sourceBrief);
  } else if (commandType === "retract_advisory_participation_v1") {
    ownKeys(command.payload, PARTICIPATION_RETRACTION_PAYLOAD_KEYS, "payload");
    result.participationRetraction = normalizeParticipationRetraction(command.payload.retraction);
  } else if (commandType === "record_reviewed_outcome_v1") {
    ownKeys(command.payload, OUTCOME_PAYLOAD_KEYS, "payload");
    result.outcome = normalizeReviewedOutcome(command.payload.outcome);
  } else if (commandType === "correct_department_draft_v1") {
    ownKeys(command.payload, CORRECTION_PAYLOAD_KEYS, "payload");
    const packageId = nonEmptyString(command.payload.packageId, "department_package_invalid");
    const packageChecksum = nonEmptyString(command.payload.packageChecksum, "department_package_checksum_invalid");
    const priorDraftArtifactChecksum = nonEmptyString(command.payload.priorDraftArtifactChecksum, "department_draft_checksum_invalid");
    if (!SHA256.test(packageChecksum) || !SHA256.test(priorDraftArtifactChecksum)) fail("department_draft_checksum_invalid");
    result.packageId = packageId;
    result.packageChecksum = packageChecksum;
    result.priorDraftArtifactChecksum = priorDraftArtifactChecksum;
    result.draft = normalizeDepartmentDraft(command.payload.draft);
  } else if (commandType === "retract_department_response_v1") {
    ownKeys(command.payload, RETRACTION_PAYLOAD_KEYS, "payload");
    result.retraction = normalizeDepartmentRetraction(command.payload.retraction);
  } else {
    ownKeys(command.payload, REVIEW_PAYLOAD_KEYS, "payload");
    result.review = normalizeDepartmentReview(command.payload.review);
  }
  return result;
}

function normalizeQuery(query: QueryEnvelope): {
  query: Record<string, unknown>;
  actor: ActorBinding;
  caseId: string;
  visibility: "public" | "administration" | "council";
  policyVersion: string;
  atCaseVersion: number | null;
} {
  ownKeys(query, QUERY_KEYS, "query");
  if (!isRecord(query) || query.schemaVersion !== QUERY_ENVELOPE_SCHEMA_VERSION) fail("schema_version_unsupported");
  if (query.queryType !== "case_projection_v1") fail("query_type_invalid");
  const caseId = nonEmptyString(query.caseId, "case_id_required");
  const actor = normalizeActor(query.actorBinding);
  const visibility = query.visibility;
  if (visibility !== "public" && visibility !== "administration" && visibility !== "council") fail("visibility_invalid");
  const policyVersion = nonEmptyString(query.policyVersion, "policy_version_invalid");
  if (query.atCaseVersion !== null && query.atCaseVersion !== undefined) {
    const atCaseVersion = safeInteger(query.atCaseVersion, "expected_case_version_invalid");
    if (atCaseVersion < 0) fail("expected_case_version_invalid");
    return {
      query: clone(query),
      actor,
      caseId,
      visibility,
      policyVersion,
      atCaseVersion,
    };
  }
  if (query.atCaseVersion === undefined) fail("at_case_version_required");
  return {
    query: clone(query),
    actor,
    caseId,
    visibility,
    policyVersion,
    atCaseVersion: null,
  };
}

function cloneReceipt(receipt: CommandReceipt): CommandReceipt {
  return { caseVersion: receipt.caseVersion, eventIds: [...receipt.eventIds], journalHeadChecksum: receipt.journalHeadChecksum };
}

export function createCivicCaseCoordinator(
  input: CivicCaseCoordinatorOptions = {},
): CivicCaseCoordinator {
  const options = normalizeOptions(input);
  const journalPort = input.journalPort;
  const journalNamespace = input.journalNamespace ?? journalPort?.namespace ?? "default";
  if (!journalPort && input.journalNamespace !== undefined) fail("journal_port_invalid");
  if (journalPort !== undefined) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(journalNamespace) || journalNamespace.includes("..")) {
      fail("journal_namespace_invalid");
    }
  }
  const optionsFingerprint = durableOptionsFingerprint(options);
  const state: JournalState = {
    events: [],
    headChecksum: genesisChecksum(options.caseId),
  };
  const idempotency = new Map<string, { fingerprint: string; receipt: CommandReceipt }>();

  const loadDurableState = (): void => {
    if (!journalPort) return;
    const recovered = journalPort.recover({
      namespace: journalNamespace,
      caseId: options.caseId,
      optionsFingerprint,
    });
    const events = recovered.events.map((event) => clone(event) as StoredCaseEvent);
    const headChecksum = events.length > 0
      ? events[events.length - 1]!.eventChecksum
      : genesisChecksum(options.caseId);
    const nextState: JournalState = { events, headChecksum };
    if (events.length > 0 && !replayJournal(nextState, options)) fail("journal_chain_invalid");
    state.events = events;
    state.headChecksum = headChecksum;
    idempotency.clear();
    for (const entry of recovered.idempotency) {
      idempotency.set(entry.idempotencyKey, {
        fingerprint: entry.fingerprint,
        receipt: cloneReceipt(entry.receipt),
      });
    }
  };

  loadDurableState();

  const handle = (command: CommandEnvelope): CommandReceipt => {
    loadDurableState();
    const normalized = normalizeCommand(command);
    if (normalized.caseId !== options.caseId) fail("case_id_invalid");
    if (normalized.policyVersion !== options.policyVersion) fail("policy_version_invalid");
    const registeredActor = options.actors.get(normalized.actor.actorId);
    if (!registeredActor) fail("actor_not_registered");
    if (registeredActor.actorClass !== normalized.actor.actorClass) fail("actor_binding_mismatch");
    const discussion = normalized.commandType === "intake_discussion_v1"
      ? normalizeAndVerifyDiscussion(normalized.discussion, options)
      : undefined;
    const topicAdmission =
      normalized.commandType === "admit_signed_topic_suggestion_v1"
        ? verifyTopicCaseAdmission({
            sourceDiscussion: normalized.sourceDiscussion as NostrEvent,
            sourceAnswer: normalized.sourceAnswer as NostrEvent,
            signedSuggestion:
              normalized.signedTopicSuggestion as CitizenSignedTopicSuggestionV1,
            allowedAgentPubkeys: [...(options.allowedAgentPubkeys ?? [])],
          })
        : undefined;
    const existing = replayJournal(state, options);
    if (normalized.commandType === "admit_signed_suggestion_v1") {
      if (!existing || !normalized.signedSuggestion) fail("signed_suggestion_case_required");
      normalized.signedSuggestion = normalizeSignedSuggestion(normalized.signedSuggestion, options, existing.discussion);
    }
    const fingerprint = sha256({
      schemaVersion: COMMAND_ENVELOPE_SCHEMA_VERSION,
      commandType: normalized.commandType,
      caseId: normalized.caseId,
      actorBinding: normalized.actor,
      expectedCaseVersion: normalized.expectedCaseVersion,
      visibility: "private_case",
      policyVersion: normalized.policyVersion,
      payload: normalized.commandType === "intake_discussion_v1"
        ? { discussion }
        : normalized.commandType === "admit_signed_suggestion_v1"
          ? { signedSuggestion: normalized.signedSuggestion }
        : normalized.commandType === "admit_signed_topic_suggestion_v1"
          ? {
              sourceDiscussion: topicAdmission?.discussion,
              sourceAnswer: topicAdmission?.sourceAnswer,
              signedSuggestion: topicAdmission?.signedSuggestion,
              caseIdentity: topicAdmission?.identity,
            }
        : normalized.commandType === "assign_department_package_v1"
          ? { departmentPackage: normalized.departmentPackage }
          : normalized.commandType === "record_department_draft_v1"
            ? { packageId: normalized.packageId, packageChecksum: normalized.packageChecksum, draft: normalized.draft }
            : normalized.commandType === "attest_department_review_v1"
              ? { review: normalized.review }
              : normalized.commandType === "record_advisory_participation_v1"
                ? { participation: normalized.participation, sourceBrief: normalized.sourceBrief }
                : normalized.commandType === "retract_advisory_participation_v1"
                  ? { retraction: normalized.participationRetraction }
                  : normalized.commandType === "record_reviewed_outcome_v1"
                    ? { outcome: normalized.outcome }
              : normalized.commandType === "derive_citizen_brief_v1"
                ? { brief: normalized.brief }
                : normalized.commandType === "correct_department_draft_v1"
                  ? {
                      packageId: normalized.packageId,
                      packageChecksum: normalized.packageChecksum,
                      priorDraftArtifactChecksum: normalized.priorDraftArtifactChecksum,
                      draft: normalized.draft,
                    }
                  : { retraction: normalized.retraction },
    });
    const previous = idempotency.get(normalized.idempotencyKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint) fail("idempotency_conflict");
      return cloneReceipt(previous.receipt);
    }
    if (normalized.expectedCaseVersion !== state.events.length) fail("case_version_conflict");
    if (normalized.commandType === "intake_discussion_v1") {
      if (registeredActor.actorClass !== "citizen") fail("actor_role_forbidden");
      if (!discussion) fail("discussion_proof_invalid");
      if (existing) {
        if (canonicalJson(existing.discussion) === canonicalJson(discussion)) fail("discussion_already_recorded");
        fail("discussion_conflict");
      }
      if (state.events.length !== 0) fail("case_version_conflict");
    } else if (normalized.commandType === "admit_signed_suggestion_v1") {
      if (registeredActor.actorClass !== "case_steward") fail("actor_role_forbidden");
      if (!existing || !normalized.signedSuggestion) fail("signed_suggestion_case_required");
      if (existing.signedSuggestionAdmission) fail("signed_suggestion_already_admitted");
      if (existing.departments.size > 0 || existing.brief || existing.participation) fail("signed_suggestion_admission_too_late");
    } else if (normalized.commandType === "admit_signed_topic_suggestion_v1") {
      if (registeredActor.actorClass !== "case_steward") {
        fail("actor_role_forbidden");
      }
      if (!topicAdmission) fail("topic_suggestion_invalid");
      if (existing || state.events.length !== 0) fail("topic_case_already_created");
      if (
        topicAdmission.identity.caseId !== options.caseId ||
        topicAdmission.identity.municipalityId !== options.jurisdiction.value ||
        options.scope !== undefined ||
        !options.allowedSignerPubkeys?.has(
          topicAdmission.signedSuggestion.signerPubkey,
        )
      ) {
        fail("topic_case_binding_invalid");
      }
    } else if (normalized.commandType === "assign_department_package_v1") {
      if (registeredActor.actorClass !== "case_steward") fail("actor_role_forbidden");
      if (!existing || !normalized.departmentPackage) fail("case_not_found");
      if (options.requireSignedSuggestionAdmission && !existing.signedSuggestionAdmission) fail("signed_suggestion_admission_required");
      const departmentPackage = normalized.departmentPackage;
      if (departmentPackage.suggestionId !== existing.suggestion.id) fail("department_suggestion_mismatch");
      if (existing.departments.has(departmentPackage.id) || [...existing.departments.values()].some((item) => item.departmentPackage.departmentId === departmentPackage.departmentId)) {
        fail("department_package_already_recorded");
      }
      if (!options.requiredDepartmentIds && existing.departments.size > 0) {
        fail("department_package_already_recorded");
      }
      if (options.requiredDepartmentIds && (!options.requiredDepartmentIds.includes(departmentPackage.departmentId) || existing.departments.size >= options.requiredDepartmentIds.length)) {
        fail("department_department_not_required");
      }
      const agent = options.actors.get(departmentPackage.assignedAgentActorId);
      const reviewer = options.actors.get(departmentPackage.assignedReviewerActorId);
      if (
        !agent ||
        agent.actorClass !== "department_agent" ||
        agent.departmentId !== departmentPackage.departmentId ||
        !reviewer ||
        reviewer.actorClass !== "department_reviewer" ||
        reviewer.departmentId !== departmentPackage.departmentId
      ) fail("department_actor_scope_mismatch");
    } else if (normalized.commandType === "record_department_draft_v1") {
      if (registeredActor.actorClass !== "department_agent") fail("actor_role_forbidden");
      const department = normalized.packageId ? existing?.departments.get(normalized.packageId) : undefined;
      if (!department || !normalized.draft || !normalized.packageId || !normalized.packageChecksum) {
        fail("department_package_not_assigned");
      }
      if (department.draft) fail("department_draft_already_recorded");
      if (normalized.packageId !== department.departmentPackage.id) fail("department_package_mismatch");
      if (normalized.packageChecksum !== department.packageChecksum) fail("department_package_checksum_invalid");
      if (normalized.actor.actorId !== department.departmentPackage.assignedAgentActorId) {
        fail("department_agent_not_assigned");
      }
      if (registeredActor.departmentId !== department.departmentPackage.departmentId) {
        fail("department_actor_scope_mismatch");
      }
    } else if (normalized.commandType === "attest_department_review_v1") {
      if (registeredActor.actorClass !== "department_reviewer") fail("actor_role_forbidden");
      const department = normalized.review ? existing?.departments.get(normalized.review.packageId) : undefined;
      if (!department?.draft || !normalized.review) fail("department_draft_not_recorded");
      const draft = department.draft;
      if (!draft) fail("department_draft_not_recorded");
      if (department.review) fail("department_review_already_recorded");
      if (normalized.review.packageId !== department.departmentPackage.id) fail("department_package_mismatch");
      if (normalized.review.draftArtifactChecksum !== draft.draftArtifactChecksum) fail("department_draft_checksum_invalid");
      if (registeredActor.departmentId !== department.departmentPackage.departmentId) fail("department_actor_scope_mismatch");
      if (normalized.actor.actorId !== department.departmentPackage.assignedReviewerActorId) fail("department_reviewer_not_assigned");
      if (normalized.actor.actorId === draft.actorBinding.actorId) fail("department_reviewer_not_distinct");
    } else if (normalized.commandType === "record_advisory_participation_v1") {
      if (registeredActor.actorClass !== "participation_reviewer") fail("actor_role_forbidden");
      if (!existing || !normalized.participation || !normalized.sourceBrief || !existing.brief || !existing.briefEventId) fail("participation_source_brief_required");
      if (!briefIsCurrent(options, existing, existing.brief)) fail("participation_source_brief_stale");
      if (existing.participation) fail(existing.participation.retracted ? "participation_retracted" : "participation_already_recorded");
      if (normalized.sourceBrief.id !== existing.brief.id || normalized.sourceBrief.briefChecksum !== existing.brief.briefChecksum) {
        fail("participation_source_brief_mismatch");
      }
      const sourceBrief: AdvisoryParticipationSourceBinding = {
        ...normalized.sourceBrief,
        briefEventId: existing.briefEventId,
      };
      if (normalized.participation.reviewedAt !== DETERMINISTIC_PARTICIPATION_REVIEWED_AT) fail("participation_review_time_invalid");
      if (normalized.participation.checksum !== participationChecksumFor(normalized.participation, sourceBrief, normalized.policyVersion, normalized.actor, normalized.participation.reviewedAt)) {
        fail("participation_checksum_invalid");
      }
    } else if (normalized.commandType === "record_reviewed_outcome_v1") {
      if (registeredActor.actorClass !== "case_steward") fail("actor_role_forbidden");
      if (!existing || !normalized.outcome || !existing.brief || !existing.participation) fail("reviewed_outcome_sources_required");
      if (existing.outcome) fail("reviewed_outcome_already_recorded");
      if (!briefIsCurrent(options, existing, existing.brief) || !participationIsCurrent(options, existing, existing.participation)) {
        fail("reviewed_outcome_sources_stale");
      }
      const discussionRef = { type: "nostr_event" as const, id: existing.discussion.event.id, ref: existing.discussion.sourceRef };
      if (
        canonicalJson(normalized.outcome.sourceDiscussionRef) !== canonicalJson(discussionRef) ||
        normalized.outcome.sourceBrief.id !== existing.brief.id ||
        normalized.outcome.sourceBrief.briefChecksum !== existing.brief.briefChecksum ||
        normalized.outcome.sourceParticipation.id !== existing.participation.participation.id ||
        normalized.outcome.sourceParticipation.participationChecksum !== existing.participation.participation.checksum
      ) fail("reviewed_outcome_source_mismatch");
    } else if (normalized.commandType === "derive_citizen_brief_v1") {
      if (registeredActor.actorClass !== "case_steward") fail("actor_role_forbidden");
      if (!existing || !normalized.brief || !options.requiredDepartmentIds) fail("citizen_brief_departments_incomplete");
      if (existing.brief && briefIsCurrent(options, existing, existing.brief)) fail("citizen_brief_already_current");
      validateBriefBindings(normalized.brief.sourceBindings, existing.departments, options);
    } else if (normalized.commandType === "correct_department_draft_v1") {
      if (registeredActor.actorClass !== "department_agent") fail("actor_role_forbidden");
      const department = normalized.packageId ? existing?.departments.get(normalized.packageId) : undefined;
      if (!department?.draft || !department.review || !normalized.draft || !normalized.packageId || !normalized.packageChecksum || !normalized.priorDraftArtifactChecksum) {
        fail("department_draft_not_recorded");
      }
      if (normalized.packageChecksum !== department.packageChecksum) fail("department_package_checksum_invalid");
      if (normalized.priorDraftArtifactChecksum !== department.draft.draftArtifactChecksum) fail("department_draft_checksum_invalid");
      if (department.review.review.decision !== "accepted") fail("department_review_not_accepted");
      if (normalized.actor.actorId !== department.departmentPackage.assignedAgentActorId) fail("department_agent_not_assigned");
      if (registeredActor.departmentId !== department.departmentPackage.departmentId) fail("department_actor_scope_mismatch");
    } else if (normalized.commandType === "retract_advisory_participation_v1") {
      if (registeredActor.actorClass !== "case_steward") fail("actor_role_forbidden");
      if (!existing?.participation || !normalized.participationRetraction) fail("participation_not_found");
      if (existing.participation.retracted) fail("participation_already_retracted");
      if (
        normalized.participationRetraction.participationId !== existing.participation.participation.id ||
        normalized.participationRetraction.participationChecksum !== existing.participation.participation.checksum
      ) fail("participation_retraction_checksum_invalid");
    } else {
      if (registeredActor.actorClass !== "case_steward") fail("actor_role_forbidden");
      const retraction = normalized.retraction;
      const department = retraction ? existing?.departments.get(retraction.packageId) : undefined;
      if (!department?.draft || !department.review || !retraction) fail("department_response_not_found");
      if (retraction.packageChecksum !== department.packageChecksum) fail("department_package_checksum_invalid");
      if (retraction.targetDraftArtifactChecksum !== department.draft.draftArtifactChecksum || retraction.targetReviewAttestationChecksum !== department.review.attestationChecksum) {
        fail("department_response_checksum_invalid");
      }
      if (department.review.review.decision !== "accepted") fail("department_review_not_accepted");
    }

    // Build the complete append on a temporary clone so a later validation
    // failure cannot leave a partial journal behind.
    const nextState: JournalState = {
      events: state.events.map((event) => clone(event)),
      headChecksum: state.headChecksum,
    };
    const appended: StoredCaseEvent[] = [];
    if (normalized.commandType === "intake_discussion_v1") {
      if (!discussion) fail("discussion_proof_invalid");
      const payloadCase = {
        caseId: options.caseId,
        jurisdiction: options.jurisdiction,
        authorityBinding: "none" as const,
      };
      const payloadDiscussion = {
        discussion: clone(discussion),
        suggestion: suggestionPayload(discussion),
        authorityBinding: "none" as const,
      };
      appended.push(appendEvent(nextState, options, normalized.actor, "case_created_v1", payloadCase));
      appended.push(appendEvent(nextState, options, normalized.actor, "discussion_recorded_v1", payloadDiscussion));
    } else if (normalized.commandType === "admit_signed_topic_suggestion_v1") {
      if (!topicAdmission) fail("topic_suggestion_invalid");
      const payloadCase: CaseCreatedPayload = {
        caseId: options.caseId,
        jurisdiction: options.jurisdiction,
        authorityBinding: "none",
      };
      const payloadDiscussion: DiscussionRecordedPayload = {
        discussion: clone(topicAdmission.discussion),
        suggestion: suggestionPayload(topicAdmission.discussion),
        authorityBinding: "none",
      };
      const signedSuggestion = clone(topicAdmission.signedSuggestion);
      const sourceAnswer = clone(topicAdmission.sourceAnswer);
      const admissionChecksum = sha256({
        signedSuggestion,
        sourceAnswer,
        caseId: topicAdmission.identity.caseId,
        policyVersion: normalized.policyVersion,
        actorBinding: normalized.actor,
      });
      appended.push(
        appendEvent(
          nextState,
          options,
          normalized.actor,
          "case_created_v1",
          payloadCase,
        ),
      );
      appended.push(
        appendEvent(
          nextState,
          options,
          normalized.actor,
          "discussion_recorded_v1",
          payloadDiscussion,
        ),
      );
      appended.push(
        appendEvent(
          nextState,
          options,
          normalized.actor,
          "signed_topic_suggestion_admitted_v1",
          {
            signedSuggestion,
            sourceAnswer,
            admissionChecksum,
            policyVersion: normalized.policyVersion,
            authorityBinding: "none",
          } satisfies SignedTopicSuggestionAdmissionPayload,
        ),
      );
    } else if (normalized.commandType === "admit_signed_suggestion_v1") {
      if (!normalized.signedSuggestion) fail("signed_suggestion_invalid");
      const signedSuggestion = clone(normalized.signedSuggestion);
      appended.push(appendEvent(nextState, options, normalized.actor, "signed_suggestion_admitted_v1", {
        signedSuggestion,
        admissionChecksum: sha256({
          signedSuggestion,
          policyVersion: normalized.policyVersion,
          actorBinding: normalized.actor,
        }),
        policyVersion: normalized.policyVersion,
        authorityBinding: "none" as const,
      } satisfies SignedSuggestionAdmissionPayload));
    } else if (normalized.commandType === "assign_department_package_v1") {
      if (!normalized.departmentPackage) fail("department_package_invalid");
      const departmentPackage = clone(normalized.departmentPackage);
      appended.push(appendEvent(nextState, options, normalized.actor, "department_package_assigned_v1", {
        departmentPackage,
        packageChecksum: sha256(departmentPackage),
        authorityBinding: "none" as const,
      } satisfies DepartmentPackagePayload));
    } else if (normalized.commandType === "record_department_draft_v1") {
      if (!normalized.packageId || !normalized.packageChecksum || !normalized.draft) fail("department_draft_invalid");
      appended.push(appendEvent(nextState, options, normalized.actor, "department_draft_recorded_v1", {
        packageId: normalized.packageId,
        packageChecksum: normalized.packageChecksum,
        draft: clone(normalized.draft),
        draftArtifactChecksum: sha256(normalized.draft),
        authorityBinding: "none" as const,
      } satisfies DepartmentDraftPayload));
    } else if (normalized.commandType === "attest_department_review_v1") {
      if (!normalized.review) fail("department_review_invalid");
      appended.push(appendEvent(nextState, options, normalized.actor, "department_review_attested_v1", {
        review: clone(normalized.review),
        policyVersion: normalized.policyVersion,
        attestationChecksum: sha256({
          review: normalized.review,
          policyVersion: normalized.policyVersion,
          actorBinding: normalized.actor,
        }),
        authorityBinding: "none" as const,
      } satisfies DepartmentReviewPayload));
    } else if (normalized.commandType === "record_advisory_participation_v1") {
      if (!existing || !existing.brief || !existing.briefEventId || !normalized.participation || !normalized.sourceBrief) fail("participation_source_brief_required");
      const sourceBrief: AdvisoryParticipationSourceBinding = {
        ...normalized.sourceBrief,
        briefEventId: existing.briefEventId,
      };
      appended.push(appendEvent(nextState, options, normalized.actor, "advisory_participation_recorded_v1", {
        participation: clone(normalized.participation),
        sourceBrief,
        policyVersion: normalized.policyVersion,
        reviewerActorBinding: clone(normalized.actor),
        reviewAttestationChecksum: participationAttestationChecksumFor(
          normalized.participation.checksum,
          sourceBrief,
          normalized.policyVersion,
          normalized.actor,
          normalized.participation.reviewedAt,
        ),
        authorityBinding: "none" as const,
      } satisfies AdvisoryParticipationPayload));
    } else if (normalized.commandType === "record_reviewed_outcome_v1") {
      if (!normalized.outcome) fail("reviewed_outcome_invalid");
      appended.push(appendEvent(nextState, options, normalized.actor, "reviewed_outcome_recorded_v1", {
        outcome: reviewedOutcomeProjection(normalized.outcome),
        policyVersion: normalized.policyVersion,
        authorityBinding: "none" as const,
      } satisfies ReviewedOutcomePayload));
    } else if (normalized.commandType === "derive_citizen_brief_v1") {
      if (!existing || !normalized.brief || !options.requiredDepartmentIds) fail("citizen_brief_invalid");
      const sourceBindings = validateBriefBindings(normalized.brief.sourceBindings, existing.departments, options);
      const brief = deriveBriefProjection(options, existing.discussion, existing.suggestion, existing.departments, normalized.brief.id, sourceBindings);
      appended.push(appendEvent(nextState, options, normalized.actor, "citizen_brief_derived_v1", {
        brief,
        sourceBindings,
        briefChecksum: brief.briefChecksum,
        policyVersion: normalized.policyVersion,
        authorityBinding: "none" as const,
      } satisfies CitizenBriefPayload));
    } else if (normalized.commandType === "correct_department_draft_v1") {
      if (!existing || !normalized.packageId || !normalized.packageChecksum || !normalized.priorDraftArtifactChecksum || !normalized.draft) fail("department_draft_invalid");
      const department = existing.departments.get(normalized.packageId);
      if (!department?.draft) fail("department_draft_not_recorded");
      appended.push(appendEvent(nextState, options, normalized.actor, "department_draft_corrected_v1", {
        packageId: normalized.packageId,
        packageChecksum: normalized.packageChecksum,
        priorDraftArtifactChecksum: normalized.priorDraftArtifactChecksum,
        draft: clone(normalized.draft),
        draftArtifactChecksum: sha256(normalized.draft),
        authorityBinding: "none" as const,
      } satisfies DepartmentDraftCorrectionPayload, department.draft.eventId));
    } else if (normalized.commandType === "retract_advisory_participation_v1") {
      if (!existing?.participation || !normalized.participationRetraction) fail("participation_retraction_invalid");
      appended.push(appendEvent(nextState, options, normalized.actor, "advisory_participation_retracted_v1", {
        retraction: clone(normalized.participationRetraction),
        authorityBinding: "none" as const,
      } satisfies AdvisoryParticipationRetractionPayload, existing.participation.eventId));
    } else {
      if (!normalized.retraction || !existing) fail("department_retraction_invalid");
      const department = existing.departments.get(normalized.retraction.packageId);
      if (!department?.review) fail("department_response_not_found");
      appended.push(appendEvent(nextState, options, normalized.actor, "department_response_retracted_v1", {
        retraction: clone(normalized.retraction),
        authorityBinding: "none" as const,
      } satisfies DepartmentRetractionPayload, department.review.eventId));
    }
    const receipt: CommandReceipt = {
      caseVersion: nextState.events.length,
      eventIds: appended.map((event) => event.eventId),
      journalHeadChecksum: nextState.headChecksum,
    };
    if (journalPort) {
      const committed = journalPort.appendAtomic({
        namespace: journalNamespace,
        caseId: options.caseId,
        optionsFingerprint,
        expectedCaseVersion: state.events.length,
        idempotencyKey: normalized.idempotencyKey,
        fingerprint,
        events: appended as CoordinatorJournalEvent[],
        receipt,
      });
      if (committed.status === "duplicate") {
        loadDurableState();
        return cloneReceipt(committed.receipt);
      }
    }
    state.events = nextState.events;
    state.headChecksum = nextState.headChecksum;
    idempotency.set(normalized.idempotencyKey, { fingerprint, receipt: cloneReceipt(receipt) });
    return cloneReceipt(receipt);
  };

  const project = (query: QueryEnvelope): ProjectionEnvelope => {
    loadDurableState();
    const normalized = normalizeQuery(query);
    if (normalized.caseId !== options.caseId) fail("case_id_invalid");
    if (normalized.policyVersion !== options.policyVersion) fail("policy_version_invalid");
    const registeredActor = options.actors.get(normalized.actor.actorId);
    if (!registeredActor) fail("actor_not_registered");
    if (registeredActor.actorClass !== normalized.actor.actorClass) fail("actor_binding_mismatch");
    if (normalized.visibility === "public" && registeredActor.actorClass !== "public") fail("projection_visibility_forbidden");
    if (normalized.visibility === "administration" && registeredActor.actorClass !== "administration") fail("projection_visibility_forbidden");
    if (normalized.visibility === "council" && registeredActor.actorClass !== "council") fail("projection_visibility_forbidden");
    const caseVersion = state.events.length;
    const replayed = replayJournal(state, options);
    if (caseVersion === 0 || !replayed) fail("case_not_found");
    if (normalized.atCaseVersion !== null && normalized.atCaseVersion !== caseVersion) fail("case_version_not_found");
    const projection = buildProjection(options, replayed, normalized.visibility);
    const projectionChecksum = sha256({
      schemaVersion: PROJECTION_ENVELOPE_SCHEMA_VERSION,
      caseId: options.caseId,
      caseVersion,
      visibility: normalized.visibility,
      policyVersion: options.policyVersion,
      projection,
    });
    return {
      schemaVersion: PROJECTION_ENVELOPE_SCHEMA_VERSION,
      caseId: options.caseId,
      caseVersion,
      journalHeadChecksum: state.headChecksum,
      projectionChecksum,
      visibility: normalized.visibility,
      policyVersion: options.policyVersion,
      projection: clone(projection),
    };
  };

  // Keep the deep Module seam closed: callers can only issue commands or
  // role-bound queries. The journal, adapter, and registries remain private.
  return Object.freeze({ handle, project });
}

/**
 * Constructor-only durable variant. The returned object deliberately exposes
 * the same handle/project seam as the in-memory coordinator.
 */
export function createDurableCivicCaseCoordinator(
  input: CivicCaseCoordinatorOptions,
  journalPort: CoordinatorJournalPort,
): CivicCaseCoordinator {
  if (!journalPort || typeof journalPort.recover !== "function" || typeof journalPort.appendAtomic !== "function") {
    fail("journal_port_invalid");
  }
  return createCivicCaseCoordinator({ ...input, journalPort });
}

export const createCaseCoordinator = createCivicCaseCoordinator;
export const createInMemoryCivicCaseCoordinator = createCivicCaseCoordinator;
