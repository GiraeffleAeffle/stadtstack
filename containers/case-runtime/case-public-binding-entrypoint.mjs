import { readRuntimeJsonFile, startCaseRuntime } from "./runtime-entrypoint-common.mjs";

const bindingEnvironment = ["STADTSTACK_CASE_PUBLIC_REVIEWED_BINDING_PATH", "STADTSTACK_CASE_PUBLIC_BINDING_SHA256"];
const reviewed = bindingEnvironment.some((name) => Object.hasOwn(process.env, name));

void startCaseRuntime({
  component: "public_binding",
  configurationEnvironment: "STADTSTACK_CASE_PUBLIC_CONFIG_PATH",
  additionalEnvironment: reviewed ? bindingEnvironment : [],
  runtimeMode: reviewed ? "reviewed_public" : "loopback",
  async create(configuration) {
    const { createStagingPublicCaseBindingRuntime, createOperationsBoundStagingPublicCaseBindingRuntime } =
      await import("../../src/staging-public-case-binding-runtime.ts");
    if (reviewed) {
      return createOperationsBoundStagingPublicCaseBindingRuntime({
        application: configuration,
        reviewedBindingSource: { read: () => readRuntimeJsonFile(process.env.STADTSTACK_CASE_PUBLIC_REVIEWED_BINDING_PATH) },
        bindingPinSource: { read: () => process.env.STADTSTACK_CASE_PUBLIC_BINDING_SHA256 },
      });
    }
    return createStagingPublicCaseBindingRuntime(configuration);
  },
});
