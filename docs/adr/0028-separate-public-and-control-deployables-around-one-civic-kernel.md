# ADR 0028: Separate public and control deployables around one Civic coordination kernel

- **Status:** proposed
- **Date:** 2026-08-24

## Context

Stadtstack currently packages public presentation, staff control, coordination
logic and a large HTTP surface in one Next.js application. The Röbel product
has the same boundary pressure: public routes, operator routes and creator
tools are compiled together even when a change affects only one surface. This
raises build and rollback cost and makes browser sessions, secrets and network
authority harder to reason about.

The current exact-source Röbel pipeline baseline is 342.1 seconds: 237.7
seconds of Next.js compilation, 58.1 seconds of dependency
fetch/materialisation, 18.4 seconds of OCI packaging and 27.9 seconds of other
work. Removing the duplicate main-branch build is the first safe improvement;
smaller affected-only deployables address the dominant compile scope.

Framework replacement alone does not solve that coupling. The current products
depend deeply on Next.js routing, rendering and request primitives, and a
whole-application rewrite would delay the first complete staging tracer. At the
same time, continuing to add control handlers inside the public application
would make the web framework the accidental owner of Civic case semantics.

## Decision

Deepen the existing two-operation **CivicCaseCoordinator** together with its
accepted Durable Case continuation facade into one **Civic coordination
kernel** behind a small framework-neutral Interface. This is a name for the
existing canonical writer and continuation boundary, not a second owner or
writer. It owns domain commands, Case-journal continuity and role-scoped
projection contracts. Its Interface accepts and returns canonical domain types;
it does not expose Next.js request, response, cookie, cache or route objects.
The existing Next.js handlers become thin Adapters that authenticate, bound
and decode transport input, call one kernel operation, and encode the result.
Stadtstack Control is the sole write-capable web Adapter; public Adapters are
projection-only.

Keep a modular monolith while moving coherent tracer slices behind this seam.
Do not create a service for every civic term. A new process boundary is added
only when identity, secret, network, scaling, release or rollback ownership is
meaningfully different.

Split the deployable surfaces incrementally:

1. **Public Stadtstack** renders credential-free public projections and has no
   staff mutation capability.
2. **Stadtstack Control** serves authenticated staff operations on a separate
   origin, image, session boundary, service account, network policy and Flux
   reconciliation unit.

The observed Röbel build and route coupling is evidence for a corresponding
Röbel-owned ADR. This Stadtstack decision does not assign Röbel routes,
sessions, images or product ownership. It only requires that any Röbel Adapter
consume the same canonical kernel contracts and projections.

Next.js remains the current Stadtstack public and control presentation Adapter.
A small Vite application is acceptable for isolated Stage Tools or a future
private Control UI only after the kernel seam exists. There is no whole-product
Vite rewrite on the golden-tracer critical path.

Each deployable has an independent immutable image, origin, configuration,
session namespace, health/readiness evidence and rollback. CI builds only
affected deployables and never builds the same source digest twice. Shared code
is consumed from an exact workspace graph; it is not copied between apps.

Before changing the production build tool, run a no-deploy comparison of the
current exact source against Next.js 16/Turbopack with the same semantic route,
page-data, OCI, SBOM and provenance gates. Adopt it only if three comparable
runs pass every gate and materially reduce the median affected-deployable build
without widening a capability or authority boundary. The Röbel repository may
adopt its own measured threshold in its corresponding ADR.

## Consequences

Public and staff changes can be built, reconciled and rolled back independently
without creating a second Case model. Secrets and control capability no longer
share the resident application's deployment boundary. The kernel becomes a
deep Module that can be tested without starting Next.js and can later serve a
different UI Adapter without rewriting civic contracts.

The extraction and route ownership inventory are real migration work. Shared
presentational code, authentication and framework-specific utilities must be
classified rather than blindly moved. Cross-origin navigation between public,
operator and creator surfaces may perform a full page load; navigation within
the resident Civic Journey remains inside one public deployable.

## Rejected alternatives

- **Rewrite all frontends in Vite now:** does not prove a faster production
  build and would migrate hundreds of framework and authentication bindings
  before the end-to-end tracer works.
- **Keep every route in one Next.js deployment:** preserves avoidable build,
  secret, session and rollback coupling.
- **Create one microservice per civic concept:** distributes the Case lifecycle
  and increases operational coordination without a distinct authority owner.
- **Let the control UI own Case state:** creates a second workflow source of
  truth instead of using the canonical journal.

## Acceptance conditions

This decision can move to `accepted` after one complete Civic Journey operation
is served through the framework-neutral kernel Interface, the public and staff
Adapters fail closed against each other's capabilities, affected-only CI emits
one verified artifact per source digest, and independent rollback preserves the
same Case journal and projection checksums.
