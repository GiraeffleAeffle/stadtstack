# Public implementation roadmap

This clean public lineage starts with the smallest reviewable vertical slices:

1. establish the public boundary and CI;
2. replace the current in-memory lifecycle with the two-operation
   `CivicCaseCoordinator` over an append-only journal;
3. add one department review and a redacted citizen brief;
4. add advisory participation and a read-only council rehearsal;
5. exercise three role-scoped companion contexts;
6. round-trip one reviewed public exchange record through a local Nostr
   Adapter; and
7. prove replay, correction, deletion, and reference-surface evidence locally.

The next accepted product seam keeps ordinary Röbel posts and discussions
Topic-bound until a resident signs a proposal. A registered human steward then
uses one idempotent admission command to create the Case and preserve that
Topic provenance before any department or openDesk round trip begins.

Formal city authority, live operations, second-city federation, and public
relay publication require new owners, ADRs, and exact external-effects gates.
