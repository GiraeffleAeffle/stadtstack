# Case image publishing

The Case components have a remote-only, main-branch publisher at
[`case-staging-publish.yml`](../.github/workflows/case-staging-publish.yml).
It is intentionally separate from the Röbel Web/Public Mecky application
publisher: the Case images are published from `GiraeffleAeffle/stadtstack` to
three distinct repositories.

The publisher first materializes a fresh three-file build context with `git
archive $GITHUB_SHA`; Buildx never receives the checkout. The image contains
only the pinned Node runtime and activation blocker, not Stadtstack source,
dependencies, manifests, configuration, or a runnable Case process. It writes
one local OCI archive, resolves its manifest digest, then publishes the
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
independent review. This inert slice does not upload the receipt, create an
artifact, promote a release, or automatically hand anything to Operations;
Operations must independently capture and verify an admitted receipt. It
binds component, image repository, manifest digest, exact source revision,
empty-auth checksum, anonymous ORAS resolver identity, and resolved digest; its
SHA-256 receipt digest covers every field except itself.

These are **not deployable Case runtimes**. The image entrypoint exits with a
stable activation-blocked status before loading Case code, opening a socket,
reading configuration, or touching a volume. It exists to ensure that a
published digest cannot be mistaken for authorization to run the Case control,
public-binding, or restore-verifier process. The activation-blocked entrypoint
may be replaced only by a later reviewed runtime-entrypoint slice that carries
the complete ADR 0023 recovery/claim gate.

The image workflow has no cluster, Flux, runtime Secret, civic-data, or
treasury credential. It is not a deployment workflow and it makes no GitOps
change. The root [`.dockerignore`](../.dockerignore) is a second defensive
allowlist for the three archived files. It excludes source, dependencies,
tests, docs, local state, temporary material, and unrelated repository content.
