import { createStagingReviewedPublicKnowledgeRuntime } from "./staging-reviewed-public-knowledge-runtime.ts";

const runtime = createStagingReviewedPublicKnowledgeRuntime();
let closing = false;

async function close(exitCode) {
  if (closing) return;
  closing = true;
  await runtime.close();
  process.exitCode = exitCode;
}

process.once("SIGTERM", () => { void close(0); });
process.once("SIGINT", () => { void close(0); });

try {
  // The only non-loopback listener is a fixed ClusterIP adapter. NetworkPolicy
  // must still restrict callers; it is not an HTTP authorization mechanism.
  await runtime.startInternalClusterIp(8080);
  process.stdout.write(`${JSON.stringify(runtime.health())}\n`);
} catch (error) {
  process.stderr.write(`staging_reviewed_public_knowledge_runtime_failed:${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 78;
}
