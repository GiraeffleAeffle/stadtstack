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

The control and public images have separate entrypoints. With only their
`STADTSTACK_CASE_CONTROL_CONFIG_PATH` or `STADTSTACK_CASE_PUBLIC_CONFIG_PATH`
input they run the ADR 0022 loopback reference composition. Each also supports
its reviewed Operations factory: add that component's
`STADTSTACK_CASE_{CONTROL,PUBLIC}_REVIEWED_BINDING_PATH` and independent
`STADTSTACK_CASE_{CONTROL,PUBLIC}_BINDING_SHA256` input. Both must be supplied;
a partial or mixed configuration fails instead of falling back to loopback.
The binding pins staging workload identity and fixed listeners; the control
factory additionally verifies its retained storage through the filesystem
observer. The public factory derives only the same-namespace private outbox
origin and the public/probe listeners.

Each configuration path must directly name a regular, non-symlink file. The
common reader checks identity and a 1 MiB ceiling, opens with no-follow and
non-blocking flags, reads through the bounded descriptor and rechecks the same
inode. FIFO/device swaps, replacement, growth and mutation fail closed. The
reviewed control application's credential-bearing file must be mode 0600 and
owned by the runtime UID. A projected Secret symlink therefore needs an
Operations-reviewed regular-file materialization; it cannot be passed directly
as this configuration. Neither launcher prints configuration, exceptions or
health details. Termination suppresses a racing ready marker and settles startup.

The publisher contract pins each entrypoint's exact dynamic runtime target and
CI derives its source closure. The restore-verifier image still exits with its
activation-blocked status before loading Case code. Publishing these digests
creates no storage, Service, NetworkPolicy, staff credential or deployment.
Operations must separately provide reviewed bindings, immutable pins, retained
storage/recovery evidence and network configuration before staging activation.
The control application's `citizenAdoption` and `syntheticAdoption` modes are
mutually exclusive; [ADR 0032](adr/0032-isolate-synthetic-case-admission.md)
describes the isolated test protocol and its remaining browser activation work.

The image workflow has no cluster, Flux, runtime Secret, civic-data, or
treasury credential. It is not a deployment workflow and it makes no GitOps
change. The root [`.dockerignore`](../.dockerignore) is a second defensive
allowlist for the union of the exact component closure paths; it contains no
`src/**` wildcard. The workflow then archives only the selected target closure,
and each final Containerfile stage `COPY`s only that target's source paths. It
therefore excludes tests, docs, local state, temporary material, unrelated
repository content, and foreign component source even if a future publisher
attempts to widen its context.

The shared listener mechanics resolve only opaque bind-plan objects registered
by the reviewed factories. Raw host/port objects and cloned plans remain inert.
CI restricts control registration to the control-preflight module and the
separate, public-port-only registration to the public runtime module. The guard
scans repository-relative identities throughout `src` and every published Case
runtime artifact, including nested files and JavaScript entrypoints.
