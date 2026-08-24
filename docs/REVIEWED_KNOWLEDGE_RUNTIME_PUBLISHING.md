# Reviewed public knowledge runtime publishing

## Status

This is a source-only, remote-published staging tracer. It is not deployed,
does not create an ingress, and does not publish a real municipal source.

The one `reviewed-public-knowledge-runtime` image bundles exactly two synthetic
`roebel-mueritz` projections prepared through the existing
`prepareReviewedPublicKnowledgeProjection` Module: one `local_news` and one
`ratsinformation`. It serves only the existing exact GET routes through the
`createReviewedPublicKnowledgeServer` Interface. The default listener remains
loopback-only. The bundled entrypoint uses one fixed ClusterIP adapter which
binds `0.0.0.0:8080` but accepts only local Hosts or
`reviewed-public-knowledge.stadtstack-roebel-staging-lab` Service DNS names
(including its `.svc.cluster.local` form) on the reviewed Service port `18080`.
It consults neither environment nor
forwarded headers. An Operations-owned NetworkPolicy must still allow only the
reviewed in-namespace callers, and a later non-HTTP probe must prove process
liveness; Host filtering is not an authorization mechanism.

## Source and authority boundary

The closed archive contains only the container entrypoint and these reviewed
runtime files:

- `src/reviewed-public-knowledge.ts`
- `src/reviewed-public-knowledge-server.ts`
- `src/staging-reviewed-public-knowledge-runtime.ts`
- `src/reviewed-knowledge-runtime-entrypoint.mjs`

There is no CivicCase coordinator, database, model provider, crawler,
credential, environment-secret input, administration connector, vote, treasury
operation, Kubernetes client, Flux client, or write route. The synthetic
records are explicitly non-city data and use `example.invalid` source URLs.

## Immutable remote publication

Only `.github/workflows/reviewed-knowledge-runtime-publish.yml` on public
`main` may publish `ghcr.io/giraeffleaeffle/stadtstack-reviewed-public-knowledge-runtime`.
It creates one closed `git archive` context at the exact GitHub revision, builds
one linux/amd64 OCI archive remotely, and publishes or reuses only
`source-<exact-40-hex>`. A different existing digest fails closed.

The workflow creates and verifies GitHub OIDC SLSA provenance and an SPDX 2.3
SBOM against the exact source revision. It then resolves both the immutable tag
and image digest and performs an ORAS byte pull of that exact digest into a
fresh empty directory with a clean empty ORAS auth configuration. That final
step proves package visibility but does not alter it; package visibility remains
an explicit package-owner operation outside this repository.
