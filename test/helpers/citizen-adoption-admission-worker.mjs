import { createHash, createPrivateKey, sign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createSqliteAtomicTopicCaseAdmission } from "../../src/adapters/sqlite-atomic-topic-case-admission.ts";

const { config, vector, command, gate } = JSON.parse(readFileSync(process.argv[2], "utf8"));
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
const digest = (value) => createHash("sha256").update(canonical(value)).digest("hex");
config.citizenAdoption = { policy: vector.policy, now: () => new Date(vector.verifiedAt * 1000),
  acceptance: { resolve: async () => vector.adoptionAcceptance },
  fetch: async (_url, options) => {
    const statusCore = { ...vector.signedStatusVector.statusCore, requestNonce: new Headers(options.headers).get("x-stadtstack-status-nonce") };
    const statusChecksum = digest(statusCore);
    const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 84)]), format: "der", type: "pkcs8" });
    const proof = { algorithm: "Ed25519", keyId: vector.policy.issuerKeyId, signature: sign(null,
      Buffer.from(canonical({ domain: "municipal-civic-eligibility-status/v1", schemaVersion: "municipal_civic_eligibility_status_v1", statusChecksum })), key).toString("base64url") };
    return new Response(JSON.stringify({ statusCore, statusChecksum, proof }), { headers: { "content-type": "application/json" } });
  },
};
const originalExec = DatabaseSync.prototype.exec;
let writes = 0;
DatabaseSync.prototype.exec = function(sql) {
  if (sql.trim() === "BEGIN IMMEDIATE" && ++writes === 2) {
    process.send("append_ready");
    const wait = new Int32Array(new SharedArrayBuffer(4));
    const deadline = Date.now() + 10_000;
    while (!existsSync(gate)) {
      if (Date.now() >= deadline) throw Error("append_barrier_timeout");
      Atomics.wait(wait, 0, 0, 5);
    }
  }
  return originalExec.call(this, sql);
};
let adapter;
try {
  adapter = createSqliteAtomicTopicCaseAdmission(config);
  const receipt = await adapter.admission.admitCitizenAdoption(command);
  process.stdout.write(JSON.stringify({ receipt }));
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error.message }));
} finally {
  DatabaseSync.prototype.exec = originalExec;
  adapter?.close();
  process.disconnect();
}
