import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dockerfile = new URL("../container/permanent-runtime/Dockerfile", import.meta.url);

test("permanent runtime image is digest-pinned, non-root and contains no secret or release config", () => {
  const source = readFileSync(dockerfile, "utf8");
  assert.match(source, /^ARG NODE_BASE_IMAGE=docker\.io\/library\/node$/m);
  assert.match(source, /^ARG NODE_BASE_DIGEST$/m);
  assert.match(source, /^FROM \$\{NODE_BASE_IMAGE\}@\$\{NODE_BASE_DIGEST\} AS dependencies$/m);
  assert.match(source, /^FROM \$\{NODE_BASE_IMAGE\}@\$\{NODE_BASE_DIGEST\} AS runtime$/m);
  assert.match(source, /npm ci --ignore-scripts --omit=dev/);
  assert.match(source, /^USER 10001:10001$/m);
  assert.match(source, /ENTRYPOINT \["node","--experimental-strip-types","\/app\/src\/permanent-runtime-cli\.ts"\]/);
  assert.match(source, /CMD \["serve","--config","\/etc\/stadtstack\/runtime\.json","--actor-tokens","\/var\/run\/secrets\/stadtstack\/actor-tokens\.json"\]/);
  assert.doesNotMatch(source, /COPY .*runtime\.json|COPY .*actor-tokens|ENV .*TOKEN|ENV .*SECRET|curl|wget|apt-get/);
});
