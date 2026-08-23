# Röbel staging execution snapshot — 2026-08-23

This is the current cross-repository execution receipt. It is not a claim of
municipal readiness, production authority, or a completed browser journey.

## Current exact state

| Boundary | Current evidence | Remaining gate |
| --- | --- | --- |
| Public HTTP and GitOps | Operations `main` is `26459c80b43a44f1d661d26e6fe35a5dccbb0033`. Flux is active for its reviewed namespace scope. The verified public boundary permits GET/HEAD and POST only on exact path `/api/chat/mecky`; all other methods and API paths fail closed. | Keep Flux as the only cluster applier and preserve the exact method/path receipt on every release. |
| Current reviewed Röbel release | Source `5ec17b126c585238c4a94ffd916d14f3f6f876dd` produced Release Set `sha256:98ac937840a4ee0d79d8c2a3524f962616552738d5bb97ebca0a23d0458939c9` and handoff `sha256:08ecd200883375c062b6883c8437d809f68b0e3049c218cc17de92cfeb001f6f`. | A later source may be promoted only from its own verified immutable Release Set; never copy a component tag across source commits. |
| Faster publisher | Röbel PR #47 is green at exact head `b71ff2c8e01cab6d117720c7b349f6e6bdc57176`. It skips the complete Web build when Web-owned inputs are unchanged and reuses only the previously verified immutable component. Operations PR #4 at `e937d11a7ab09dfb536c9a02386c25e91178ebaf` adds the required mixed-source Release Set verifier. | Merge operations #4 before Röbel #47. Structural public/operator extraction follows the live tracer; the cohesive Coordinator console is the first safe candidate. |
| Public candidate journey | Röbel PR #48 is green at exact head `5f4ec51cfd3226a256b32c2659ee12bbdfcb8d0f`. It lets the resident sign a candidate but gives the public client no Case admission, completion, or view capability. | Merge and deploy only with the separate Case Steward/read-service plan; do not describe the candidate as submitted or admitted. |
| Stadtstack control and durability | The green stack is PR #35 `a2cdb71015da14b4707e0d0fe42f14d0455ea0a5`, #36 `784879782a0a69bd4f8cacd32393e518ca3bfaa5`, #37 `baa9fca38549ee123fb16a42f8679c57400043f7`, #38 `ea7a519350a32dcfdbcb5aa16dbcd02e45044d1d`, #39 `70eedc78a83ba397a94f575aeb79eee76a298805`, #40 `bd3cdf8f82eda43b58badd64aefd0d2362e1976d`, #41 `8fcb6830abb602e85d291381388b199d0c7ab80d`, #42 `f3033e40c492d06794e549a2b7e65bb7cd89649f`, #43 `4bb929695267d1e0444f009fe801ff3674d80113`, and pure signed recovery verifier PR #44 `544d948179d17f4107cfc1ddcf8ced341ab52254`. The current stacked slice adds an opaque proof-derived durable deployment claim; canonical fsync'd bootstrap/open-epoch receipts; a claim-bound v2 shutdown seal; and a lock-held v2 activation marker with complete source/target claims and crash-state reconciliation. Existing databases require read/write exact-schema opens and must dominate their clean baseline. Each listener rechecks signed evidence immediately before its own bind; admission is last and a later failed check rolls back earlier listeners through a non-sealing abort, preserving the marker and blocking ordinary startup. Renewed evidence cannot move behind the marker's durable activation time, even after a process restart. Ordinary copied-root startup fails closed. | Merge in dependency order, then supply real PVC/PV/StorageClass/filesystem facts and a successful encrypted fresh-claim restore drill that contains the exact v2 shutdown seal and source claim, checksum-pinned in the manifest/catalog and restored as mode-0600 receipts. Immutable images, a protected policy migration and a separately reviewed same-volume claim-transition design remain required; no live bind is currently authorized. |
| Identity | The staging Web receives the Thirdweb public client ID only. Passkey/Safe/Pimlico remains a no-effect coexistence scaffold. | Complete the Thirdweb-backed tracer first. Do not deploy a Thirdweb server secret merely to support client login; implement real WebAuthn/Safe creation, recovery, sponsorship, and member binding as a later opt-in slice. |

## One canonical product line

The product line is:

`ordinary post → Topic discussion → cited @Mecky answer → citizen-signed candidate → human Case admission → Department feedback and independent review → Citizen Brief → advisory Mitmachen → reviewed outcome`

The first four steps are public and Topic-bound. Human admission creates one
deterministically identified Civic Case. Every later step continues that Case
and journal. A Mini App may render a focused step, but it does not own another
proposal, Case, brief, vote, treasury, or execution state.

## Ordered gates

1. Merge operations #4, Röbel #47/#48, and Stadtstack #35 through #43 only at
   their reviewed exact heads and in dependency order. Protected-main
   exceptions must be bounded and branch protection restored even on failure.
2. Emit and verify the new immutable Röbel Release Set, then let Flux reconcile
   only the reviewed Web and Public Mecky resources.
3. Complete the real reviewed storage observations, signed recovery inputs and
   fresh-claim backup/restore drill through the lock-held activation seam. Only
   then admit immutable control/public/backup/verifier images and a
   protected policy migration for the exact namespace-scoped workloads.
4. Let Flux deploy the sealed staging Case service: staff admission and
   credential-free public receipt discovery use separate identities and
   network surfaces. SQLite remains a single-writer staging decision, not a
   silent production database choice.
5. Wire Röbel's signed-candidate state to discover the Case receipt by signed
   discussion root. The public client never receives the Case Steward
   credential.
6. Run the attributable browser tracer through one Department return,
   independent review, Citizen Brief, advisory Mitmachen, and correction
   withdrawal on the same Case ID and journal checksum line.
7. Only after that tracer, add the live workspace connector and the opt-in
   passkey-owned Safe/Pimlico coexistence path. Formal voting, council
   submission, treasury movement, and execution remain separate decisions.

## Current blockers are explicit

- The signed-candidate UI and faster publisher are reviewed but not merged.
- The durable Case service has sealed transports, separate lifecycle
  composition roots, a staging staff authenticator, credential-free private
  outbox delivery, a fail-before-bind deployment preflight, and a lock-held
  recovery activation seam. Exact live storage observations, a successful
  encrypted restore, cluster workloads and Flux binding do not exist yet.
- Administration, Citizen Brief, Mitmachen, and outcome contracts are composed
  behind one Case-scoped authenticated local facade and durable journal. The
  production staff identity, reviewed live storage/recovery evidence, cluster
  workloads, and browser journey are not implemented yet.
- A live openDesk connector, public source corpus, formal ballot, and treasury
  effect are intentionally absent.

Nothing in this snapshot authorizes Mecky to sign for a resident, admit a
Case, speak for the administration, vote, submit to council, publish an
official decision, or move funds.
