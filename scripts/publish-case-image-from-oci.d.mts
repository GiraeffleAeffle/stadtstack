export type OrasResult = Readonly<{
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  error?: Error;
}>;

export type PublisherInput = Readonly<{
  archive: string;
  localReference: string;
  component: "case-steward-control" | "case-public-binding" | "case-restore-verifier";
  image: string;
  tag: string;
  anonymousRegistryConfig?: string;
}>;

export declare function parseArguments(argv: readonly string[]): PublisherInput;
export declare function classifyRemoteResolveFailure(result: OrasResult): "success" | "absent" | "retryable" | "error";
export declare function publishCaseImageFromOci(
  input: PublisherInput,
  run?: (command: "oras", argumentsList: readonly string[]) => OrasResult,
  wait?: (delayMilliseconds: number, context: Readonly<{ operation: string; attempt: number; state: string }>) => void,
  readRegistryConfig?: (path: string) => string,
): Readonly<{
  status: "pushed" | "reused";
  digest: string;
  component: PublisherInput["component"];
  image: string;
  sourceTag: string;
  packageVisibility: "public" | null;
  anonymousDigestPullReceipt: null | Readonly<{
    schemaVersion: "stadtstack_case_anonymous_digest_pull_receipt_v1";
    canonicalEncoding: "canonical-json";
    component: PublisherInput["component"];
    imageRepository: string;
    manifestDigest: string;
    sourceRevision: string;
    authContext: "clean-empty-auth-config";
    authConfigCanonicalSha256: string;
    resolverIdentity: "oras-resolve-anonymous";
    resolvedManifestDigest: string;
    receiptDigest: string;
  }>;
}>;
