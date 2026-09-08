# Stadtstack

Stadtstack is a municipality-neutral civic coordination Module. It turns a
signed public discussion into reviewable, public-safe information while
keeping private evidence and formal civic authority with the owning city.

The public repository contains the small contracts and local Implementations
that contributors can inspect and test. It does not contain a city's source
records, legal proposal or voting system, deployment authority, credentials,
private operations, or personal data.

## What is here

- an in-memory civic kernel for discussions, suggestions, department review,
  advisory participation, and read-only council rehearsal;
- a NIP-01 discussion Adapter and a policy-bounded local relay Adapter;
- role-scoped public, administration, and council companion contexts;
- deterministic worker and transport seams that never invoke a model or tool;
- an explicit-invocation public Mecky Module that answers from attributed
  discussion and reviewed citations, then prepares a citizen-owned signing
  request without submitting it;
- a human admission event plus one checksum-bound public knowledge projection
  shared by public Mecky and the read-only advisory Mitmachen surface;
- [authenticated citizen-adoption Case admission](docs/adr/0031-citizen-adoption-evidence-before-case-admission.md)
  with issuer verification, atomic nonce consumption, one durable Case journal
  and a public v2 binding receipt; deployment activation remains pending;
- an effect-free human-reviewed source preparer that emits checksum-bound local
  news or Ratsinformationssystem projections without crawling or publishing;
- a credential-free loopback reference transport that serves those immutable
  projections through the two exact GET-only routes consumed by Röbel;
- a separate source-only runtime image tracer with exactly two bundled
  synthetic `roebel-mueritz` reviewed-source projections; it is remote-published
  with provenance and anonymous verification, but intentionally not deployed;
- a provider-neutral administration-workspace Adapter that prepares an exact
  Department task and binds its returned response only as a private draft for
  independent review;
- an effect-free Citizen Brief readiness Adapter that exposes exact Department
  blockers and prepares one checksum-bound human steward command; and
- synthetic tests and architecture decisions describing the authority and
  privacy boundaries.

The checked-in fixture uses `sample-municipality` and `sample-case` identifiers.
All fixture identities and content are synthetic. A fixture is not a city
record, a formal proposal, a vote, a publication, or an authority transition.

## What is deliberately not here

This Module does not own a municipality's official records, publication,
formal submissions, votes, legal decisions, PII, private case journal, or
operations. Nostr is an Adapter for signed discussion and reviewed public
exchange; it is not a private administration store or source of authority.
Worker products such as OpenClaw, Hermes, OpenDesk, or Buzz-like workspaces
can be replaceable Adapters, but they cannot approve, publish, vote, or mutate
civic state through this Module.

## Local verification

Requirements: Node.js 22.18 or newer.

```sh
npm ci
npm test
npm run demo:synthetic
npm run demo:public-mecky
npm run demo:civic-outcome-loop
```

The test suite is offline and deterministic. It uses generated keys only in
process-local synthetic tests; no key is read from the environment or written
to disk. There is no network call, model request, relay publication, database
write, deployment, or civic effect.

The public verification workflow also checks dependency closure, forbidden
paths/imports, secret-shaped text, license attribution, Markdown links, and
Git object integrity. A check that is not configured is reported as a gap; it
is never described as passed by implication.

The three future Case component images have a separate, remote-only publisher
with a closed `git archive` build context, retry-safe immutable source tags,
GitHub-OIDC provenance, SPDX SBOM evidence, and anonymous digest-pull
verification. The images contain only an activation blocker, not Case source
or dependencies. Control and public startup require separately reviewed
Operations bindings and activation evidence; the restore target remains blocked. See
[Case image publishing](docs/CASE_IMAGE_PUBLISHING.md).

The reviewed-source runtime has the same remote-only immutable-source evidence
without Case authority; see [reviewed knowledge runtime publishing](docs/REVIEWED_KNOWLEDGE_RUNTIME_PUBLISHING.md).

## Architecture

Read [`CONTEXT.md`](CONTEXT.md) for the domain language and
[`docs/adr/README.md`](docs/adr/README.md) for accepted decisions. The key
boundaries are:

- `CivicCaseCoordinator` is the future deep external Interface (`handle` and
  `project`) over an append-only private Case journal;
- public discussion and reviewed public exchange records may use Nostr;
- city-owned systems remain authoritative for formal transitions; and
- public, administration, and council companions receive distinct contexts,
  identities, and default-deny tool policies.

The initial Röbel tracer is recorded in the historical
[2026-08-22 staging snapshot](docs/verification/2026-08-22-roebel-staging.md).
[ADR 0031](docs/adr/0031-citizen-adoption-evidence-before-case-admission.md)
describes the current adoption implementation and its remaining activation work.
[ADR 0032](docs/adr/0032-isolate-synthetic-case-admission.md) describes the separate
staging test admission, its no-authority receipt and remaining browser/activation work.

## Administration review reference

[ADR 0033](docs/adr/0033-connected-workspace-identity-and-synthetic-review.md)
records the connected Citizen App / Town Workspace direction, municipal role
mapping, future OIDC/EUDI integration and public versus administration Mecky.

`createAdministrationReviewService` and its unbound HTTP transport provide one
staging-only `GET/POST /v1/staging/administration/review` for a configured
synthetic Case. GET returns the authenticated actor's permitted package view;
POST accepts only assignment, draft and checksum-bound review. The server-owned
staging authenticator binds each credential to one actor, Case and validity
interval. Clients cannot grant themselves a role or name another Case.

The service reuses `DurableCaseContinuation` and the existing SQLite coordinator.
The writer must explicitly enable `syntheticDepartmentReview: true` alongside
its synthetic admission policy and full department registry. Existing stores
keep their configuration fingerprints; this is not an in-place migration.
The eight-department brief requirement is unchanged. The new HTTP path does not
expose brief release, participation or public knowledge. The transport is an
internal administrative-gateway Interface, not a browser login or deployed Town
Workspace. External workspace connectors and the live public return remain
integration work.

[ADR 0034](docs/adr/0034-rehearse-synthetic-review-migration-on-a-copy.md) adds
`prepareSyntheticDepartmentReviewMigration` for an existing admission-only
synthetic Case at version 3. It prepares a private database copy, changes only
the two configuration fingerprints, verifies every civic record and replays
the Case with the added review roles. The source remains unchanged. Its candidate
receipt is integrity evidence for Operations review; it grants no activation
capability and does not replace a shutdown seal or deployment claim.

## Contributing and licensing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`SECURITY.md`](SECURITY.md).
Repository-authored code is MIT-licensed. Third-party dependencies retain
their own terms; see [`NOTICE`](NOTICE).
