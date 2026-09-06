import { startCaseRuntime } from "./runtime-entrypoint-common.mjs";

void startCaseRuntime({
  component: "public_binding",
  configurationEnvironment: "STADTSTACK_CASE_PUBLIC_CONFIG_PATH",
  async create(configuration) {
    const { createStagingPublicCaseBindingRuntime } = await import("../../src/staging-public-case-binding-runtime.ts");
    return createStagingPublicCaseBindingRuntime(configuration);
  },
});
