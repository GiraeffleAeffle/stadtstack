import { readRuntimeJsonFile, startCaseRuntime } from "./runtime-entrypoint-common.mjs";

const bindingEnvironment = [
  "STADTSTACK_CASE_CONTROL_REVIEWED_BINDING_PATH",
  "STADTSTACK_CASE_CONTROL_BINDING_SHA256",
];
// A partial Operations configuration must fail rather than fall back to the
// reference runtime. The pin is supplied independently of the binding file.
const reviewed = bindingEnvironment.some((name) => Object.hasOwn(process.env, name));

void startCaseRuntime({
  component: "steward_control",
  configurationEnvironment: "STADTSTACK_CASE_CONTROL_CONFIG_PATH",
  additionalEnvironment: reviewed ? bindingEnvironment : [],
  runtimeMode: reviewed ? "reviewed_control" : "loopback",
  privateConfiguration: reviewed,
  async create(configuration) {
    const { createStagingCaseControlRuntime, createOperationsBoundStagingCaseControlRuntime } =
      await import("../../src/staging-case-control-runtime.ts");
    if (reviewed) {
      return createOperationsBoundStagingCaseControlRuntime({
        application: configuration,
        reviewedBindingSource: {
          read: () => readRuntimeJsonFile(process.env.STADTSTACK_CASE_CONTROL_REVIEWED_BINDING_PATH),
        },
        bindingPinSource: { read: () => process.env.STADTSTACK_CASE_CONTROL_BINDING_SHA256 },
      });
    }
    return createStagingCaseControlRuntime(configuration);
  },
});
