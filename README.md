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
  shared by public Mecky and the read-only advisory Mitmachen surface; and
- a provider-neutral administration-workspace Adapter that prepares an exact
  Department task and binds its returned response only as a private draft for
  independent review; and
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

## Contributing and licensing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`SECURITY.md`](SECURITY.md).
Repository-authored code is MIT-licensed. Third-party dependencies retain
their own terms; see [`NOTICE`](NOTICE).
