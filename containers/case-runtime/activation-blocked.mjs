#!/usr/bin/env node

// Image publication is evidence preparation, not deployment authority.  This
// command intentionally exposes no port, reads no configuration, and exits
// before loading any Case module.  A later reviewed runtime-entrypoint slice
// must replace it only together with the ADR 0023 recovery/claim gate.
process.stderr.write("stadtstack_case_image_activation_blocked\n");
process.exitCode = 78;
