export type OrasResult = Readonly<{
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  error?: Error;
}>;

export type ReviewedKnowledgePublisherInput = Readonly<{
  archive: string;
  localReference: string;
  image: "ghcr.io/giraeffleaeffle/stadtstack-reviewed-public-knowledge-runtime";
  tag: string;
  anonymousRegistryConfig?: string;
  anonymousPullDir?: string;
}>;

export declare function parseArguments(argv: readonly string[]): ReviewedKnowledgePublisherInput;
export declare function classifyRemoteResolveFailure(
  result: OrasResult,
): "success" | "absent" | "retryable" | "error";
export declare function publishReviewedKnowledgeImageFromOci(
  input: ReviewedKnowledgePublisherInput,
  run?: (command: "oras", argumentsList: readonly string[]) => OrasResult,
  wait?: (delayMilliseconds: number) => void,
  readRegistryConfig?: (path: string) => string,
  readPullDirectory?: (path: string) => readonly string[],
): Readonly<{
  status: "pushed" | "reused";
  digest: string;
  component: "reviewed-public-knowledge-runtime";
  image: ReviewedKnowledgePublisherInput["image"];
  sourceTag: string;
  packageVisibility: "public" | null;
  anonymousDigestPullReceipt: null | Readonly<{
    schemaVersion: "stadtstack_reviewed_knowledge_anonymous_digest_pull_receipt_v1";
    canonicalEncoding: "canonical-json";
    component: "reviewed-public-knowledge-runtime";
    imageRepository: ReviewedKnowledgePublisherInput["image"];
    manifestDigest: string;
    sourceRevision: string;
    authContext: "clean-empty-auth-config";
    authConfigCanonicalSha256: string;
    resolverIdentity: "oras-resolve-anonymous";
    resolvedManifestDigest: string;
    receiptDigest: string;
  }>;
}>;
