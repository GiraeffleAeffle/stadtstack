# Public boundary exclusions

The public Stadtstack Module deliberately excludes:

- city-specific source adapters, user interfaces, voting flows, and civic
  records;
- private Case journal contents, PII, employee or council rosters, ballots,
  wallet identifiers, and real identities;
- credentials, Nostr private keys, environment files, local databases, build
  output, runtime receipts, or unreviewed external assets;
- deployment, registry, cluster, network, provider, DNS, database,
  apply/rollback, or deletion authority; and
- copied implementation or assets from a separately licensed city product.

Nostr may carry signed public discussion and reviewed permanently public
exchange records. It never becomes the private Case journal, vote ledger,
review authority, or municipal source of truth. A city Adapter owns formal
submission, publication, council decisions, and votes.

The repository's tests use synthetic identifiers and generated process-local
keys. They do not create a public relay event or mutate civic state.
