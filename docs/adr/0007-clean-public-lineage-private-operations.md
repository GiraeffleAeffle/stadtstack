# ADR 0007: Publish the neutral Module from a clean lineage

- **Status:** accepted; execution remains separately gated
- **Date:** 2026-08-08

## Context

Open collaboration is desirable, but the mixed bootstrap contains unnecessary
source inventory, local paths, personal commit metadata, and temporary
operations material. Publishing that history in place would expose unrelated
content and make the public Module's provenance difficult to audit.

## Decision

Create the public Module from one reviewed clean root commit using a no-reply
author identity. Include only municipality-neutral source, tests, public
specifications, synthetic fixtures, CI, MIT licensing, and reviewed notices.
Keep the bootstrap and all deployment/apply/rollback material in private
archives. Use a separate private operations repository when an operations
owner and extraction scope are named. Do not make unrelated product
repositories public as part of this decision.

## Consequences

Contributors receive a small, auditable Interface without private history or
operations authority. The transition is a one-time lineage cut; later
cross-repository changes use versioned contracts instead of copied code.

## Rejected alternatives

- flipping a mixed repository public in place;
- force-rewriting a public history while losing the private archive; and
- making every related product and operations repository public together.
