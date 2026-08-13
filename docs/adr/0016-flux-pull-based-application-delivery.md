# ADR 0016: Pull reviewed application releases with a namespace-scoped Flux reconciler

- **Status:** proposed
- **Date:** 2026-08-13
- **Extends:** ADR 0005, ADR 0007, ADR 0013, ADR 0015

## Context

The current Talos application-release path proves useful safety properties,
but repeats expensive work for every change: download a short-lived CI
artifact to an operator laptop, copy it into the private registry, ask each
Talos node to pull the image, patch each Deployment imperatively, wait for
rollouts, and assemble evidence locally. It is slow, consumes scarce local
disk, depends on an active operator connection, and turns a reviewed image
digest into several manually coordinated mutations.

Röbel-App and Stadtstack already have the boundaries needed for a safer
pipeline. Application CI can build a scoped linux/amd64 image once. The
existing sovereign registry can retain that immutable digest. Private
application operations can own the exact Kubernetes desired state. What is
missing is a bounded reconciler that carries a reviewed Git change into the
existing cluster without giving application CI a cluster credential.

This decision concerns application delivery only. It must not adopt Talos,
OpenTofu state, Helm platform releases, registry infrastructure, databases,
Ingress controllers, unrelated Röbel/WordPress workloads, Secret values, or
civic authority.

## Decision

Use Flux's pull-based `source-controller` and `kustomize-controller` as the
application GitOps reconciler for the existing Talos cluster.

### Release path

1. Röbel-App or Stadtstack CI tests one source revision, builds only the
   affected component, pushes it once to `registry.agentcart.eu`, and records
   the immutable linux/amd64 manifest digest plus source and build receipts.
2. A narrowly scoped CI identity may open a promotion pull request against
   `stadtstack-operations-private`. It may change only the allowlisted release
   digest, source receipt, rendered manifest lock, and rollback predecessor.
   It has no Kubernetes, Talos, provider, Secret-value, or civic credential.
3. Repository checks render the complete candidate, enforce exact ownership,
   run Kubernetes schema and policy validation, compare the outside-resource
   contract, and verify that every image is digest-pinned. A human merges a
   permanent promotion. Staging may later use an explicit auto-merge policy,
   but only after the same checks and rollback path are proven.
4. Flux reads the private operations repository with a read-only deploy key.
   It reconciles the merged, immutable desired state. It never selects a
   mutable tag and does not write image updates back to Git.
5. Cluster health, browser QA, workflow continuity, and the reconciled Git
   revision/digest form the post-deployment receipt. Failure leaves the change
   unpromoted or triggers the exact predecessor rollback; it never widens the
   owned resource set.

### Reconciler authority

Each application namespace has its own Flux `Kustomization` and Kubernetes
ServiceAccount. RBAC permits only the exact namespaced kinds required by that
release. The staging lab and Röbel web preview therefore do not share a
cluster-admin reconciler identity. The permanent workflow receives a third
separate identity when it is ready.

The first adoption uses `prune: false`, `force: false`, an exact live-object
baseline, server-side dry-run, and an outside-inventory comparison. Pruning is
enabled only after every owned object is represented in Git and deletion has
been rehearsed. PersistentVolumeClaims, PersistentVolumes, storage classes,
Secret values, cluster-wide resources, and pre-existing platform releases are
outside the pruning boundary.

Flux itself is installed in `flux-system` by a separately reviewed platform
operation. The bootstrap commit and controller images are immutable and
reviewed. The initial installation contains only `source-controller` and
`kustomize-controller`; image-reflector and image-automation controllers are
excluded. No public webhook receiver or new Ingress is required: polling the
private repository at a short bounded interval is sufficient for staging.

### Secret and publication boundary

Desired state contains only value-free Secret references. Existing application
Secrets, including the Hetzner inference key used by Public Mecky, are neither
read nor rewritten by Flux. Secret rotation remains a separate person-bound
operation until a dedicated secret controller and recovery contract are
accepted.

CI may publish only to allowlisted repositories in the existing private
registry. Public relay publication, discussion intake, Mecky answers, case
admission, administration review, Mitmachen visibility, votes, treasury
effects, and municipal outcomes remain runtime/domain actions. A successful
Flux reconciliation grants none of those authorities.

### Rollback and emergency operation

Normal rollback is a reviewed Git revert to the exact predecessor image and
manifest digests. Flux reconciles that commit and health checks prove the
predecessor is Ready. Retained journals and backup objects are preserved.

If the reconciler itself is unhealthy, the operator may suspend the affected
`Kustomization` and execute the existing UID/resourceVersion-guarded rollback
for that release. Emergency access does not authorize deleting its namespace,
storage, Flux itself, or unrelated resources. Reconciliation resumes only
after desired state and live state agree again.

## Consequences

The laptop is removed from the normal artifact and deployment data path. A
small service change should require one scoped CI build and one digest-only
promotion; Flux then performs the pull and rollout in-cluster. Web builds can
still take several minutes, but their output is produced once and reused
rather than exported, downloaded, copied, and pulled imperatively per node.

Git becomes the auditable source of application desired state and rollback
predecessors. The cluster gains two small controllers and a private Git deploy
key, so bootstrap, RBAC, network policy, controller upgrades, repository
availability, and disaster recovery require their own evidence. Drift is
corrected automatically only inside the accepted namespace-scoped boundary.

## Rejected alternatives

- **Keep the laptop-driven CRI and patch loop.** Rejected as the normal path
  because it is slow, storage-heavy, connection-sensitive, and hard to repeat.
- **Give application CI a kubeconfig.** Rejected because a source repository
  compromise would become an immediate cluster mutation.
- **Enable Flux image automation from mutable tags.** Rejected because release
  review must bind an exact digest and predecessor before reconciliation.
- **Install Argo CD with its UI and broad default controller.** Rejected for
  the first slice because the cluster needs a small headless pull reconciler,
  not another public/admin application surface. This may be revisited if a
  multi-cluster or rich promotion UI becomes a concrete requirement.
- **Adopt Terraform, Helm, registry, databases, or unrelated workloads into
  the application sync.** Rejected because it violates the established
  platform/application ownership boundary.

This ADR records architecture and preparation. Installing Flux, adding a Git
deploy key, changing registry-write credentials, enabling pruning, or applying
an application release remains a separately reviewed live operation.
