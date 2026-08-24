# Case image publishing

The Case components have a remote-only, main-branch publisher at
[`case-staging-publish.yml`](../.github/workflows/case-staging-publish.yml).
It is intentionally separate from the Röbel Web/Public Mecky application
publisher: the Case images are published from `GiraeffleAeffle/stadtstack` to
three distinct repositories.

The publisher first materializes a fresh closed context with `git archive
$GITHUB_SHA`; Buildx never receives the checkout. Each control and public
target has its own reviewed transitive Case source closure and context: the
public archive/image excludes steward, admission, private-outbox-server, and
storage/control source, while the control archive/image excludes the public
binding server/client source. The shared replay-wire verifier is deliberately
one of a small explicit shared source set (together with receipt types and
generic listener mechanics); the publisher contract classifies every runtime
source as public-only, control-only, or shared. Exact package manifests and
lockfile, and the production dependency closure produced by `npm ci
--omit=dev --ignore-scripts`. It writes one local OCI archive, resolves its
manifest digest, then publishes the
immutable `source-<40-lowercase-hex>` tag through a fail-closed ORAS state
machine: an absent tag is pushed, an exact existing tag is reused (including a
retry after a later attestation failure), and a different digest or any
authentication error fails the run. Registry transport failures, HTTP 429,
and HTTP 5xx responses receive at most four attempts with fixed one-, two-,
and four-second waits. Explicit absence on the initial probe is not retried;
absence after publication is retried only to cover bounded registry eventual
consistency. An immutable digest mismatch is never retried. Each resulting manifest
digest receives a GitHub OIDC SLSA provenance attestation and an SPDX 2.3 SBOM
attestation, both verified against the exact repository, source revision,
`refs/heads/main`, and workflow identity from OCI evidence before the run
succeeds. Neither attestation action creates a persistent GitHub storage
record. The later
Operations inventory must independently verify the source repository, source
revision, main ref, manifest/config/layer digest set, and both attestations
before it can prepare a release set.

The three GHCR packages must be public before this workflow is enabled. The
workflow resolves both immutable tag and `@sha256` reference using an empty
anonymous registry configuration after publication. A package that permits the
workflow token but rejects anonymous digest resolution fails closed; make that
package public out of band and rerun the same source revision, which safely
reuses its exact existing tag. No Operations pull secret is introduced for this
slice. Before any anonymous ORAS call, the publisher reads the supplied
registry config and requires its exact bytes and canonical checksum to match
`{"auths":{}}`; missing, malformed, whitespace-varied, extra-field,
credential, or credential-helper content fails before any resolve or publish.
Successful anonymous resolution prints the canonical
`stadtstack_case_anonymous_digest_pull_receipt_v1` to stdout for later
independent review. This runtime-image slice does not upload the receipt,
create an artifact, promote a release, or automatically hand anything to Operations;
Operations must independently capture and verify an admitted receipt. It
binds component, image repository, manifest digest, exact source revision,
empty-auth checksum, anonymous ORAS resolver identity, and resolved digest; its
SHA-256 receipt digest covers every field except itself.

These are **not deployable Case runtimes**. The control and public images have
separate entrypoints which load exactly one mounted JSON configuration file and
can run only the ADR 0022 loopback reference composition. They reject every
other `STADTSTACK_CASE_*` input and never print configuration, exceptions, or
health details. The publisher contract binds each component entrypoint to its
one exact dynamic TypeScript runtime target, and CI derives the reviewed source
closure from that target; a typo or public/control target swap fails closed.
Configuration paths must resolve directly to one non-symlink
regular file: the entrypoint verifies identity and a 1 MiB size ceiling before
allocating, opens with no-follow and non-blocking flags, performs a bounded
descriptor read, then rechecks that the path still names the same regular inode.
FIFO/device swaps cannot stall startup; replacement, mutation and growth fail
closed, and the descriptor closes on every outcome. They provide no Operations binding
source, immutable binding pin, PVC, Service, NetworkPolicy, Kubernetes token,
or non-loopback listener. A termination request suppresses the ready marker
even when it races a delayed startup and close makes that startup settle.
The restore-verifier target still exits with the stable activation-blocked
status before loading Case code. A published digest is therefore not
authorization to expose the Case control, public-binding, or restore-verifier
process; the later ADR 0023/Operations activation gate must provide the
reviewed recovery and network evidence.

The image workflow has no cluster, Flux, runtime Secret, civic-data, or
treasury credential. It is not a deployment workflow and it makes no GitOps
change. The root [`.dockerignore`](../.dockerignore) is a second defensive
allowlist for the union of the exact component closure paths; it contains no
`src/**` wildcard. The workflow then archives only the selected target closure,
and each final Containerfile stage `COPY`s only that target's source paths. It
therefore excludes tests, docs, local state, temporary material, unrelated
repository content, and foreign component source even if a future publisher
attempts to widen its context.

The shared listener mechanics can resolve only the exact opaque bind-plan
objects registered while the reviewed control preflight derives them. There is
no raw host/port capability constructor; structural objects and cloned plans
remain inert, and CI restricts the one internal registration seam to the
control-preflight module. That guard scans repository-relative identities for
the complete `src` implementation tree and every published Case runtime
artifact, so a nested same-basename file or JavaScript entrypoint cannot bypass
the restriction.
