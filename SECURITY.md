# Security policy

Do not open a public issue for a credential, private key, personal data,
unpublished evidence, or a possible authority-boundary bypass. Contact the
repository owner privately with the smallest reproducible description and no
secret values.

The public Module is intentionally fail-closed. Nostr events are verified and
scoped; role contexts are isolated; worker tools are default-deny; and local
fixtures never read credentials or call external providers. A green test is
not authorization to publish, deploy, vote, or change a city system.
