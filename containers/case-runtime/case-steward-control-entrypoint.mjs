import { startLoopbackCaseRuntime } from "./runtime-entrypoint-common.mjs";

void startLoopbackCaseRuntime({
  component: "steward_control",
  configurationEnvironment: "STADTSTACK_CASE_CONTROL_CONFIG_PATH",
  async create(configuration) {
    const { createStagingCaseControlRuntime } = await import("../../src/staging-case-control-runtime.ts");
    return createStagingCaseControlRuntime(configuration);
  },
});
